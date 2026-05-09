import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type SendableChannels,
} from "discord.js";
import type { AgentService } from "./agent-service";
import { handleCommand } from "./commands";
import { createModuleLogger } from "./logger";
import { chunkMessage } from "./message-chunker";
import type { PromptQueue } from "./prompt-queue";
import type { ResolvedDiscordPiBridgeConfig } from "./types";

const logger = createModuleLogger("discord-client");

export async function startDiscordClient(
  config: ResolvedDiscordPiBridgeConfig,
  agentService: AgentService,
  promptQueue: PromptQueue,
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ userTag: readyClient.user.tag }, "logged in");
    if (!config.startupMessage) {
      return;
    }

    try {
      const user = await readyClient.users.fetch(config.discordAllowedUserId);
      const dmChannel = await user.createDM();
      await dmChannel.send(config.startupMessage);
      logger.info(
        {
          userId: config.discordAllowedUserId,
        },
        "sent startup dm",
      );
    } catch (error) {
      logger.error({ error }, "failed to send startup dm");
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await onMessage(message, config, agentService, promptQueue);
    } catch (error) {
      logger.error({ error, direction: "IN" }, "message handling failed");
      await sendReply(
        message,
        "The bot hit an error while handling that message.",
      );
    }
  });

  await client.login(config.discordBotToken);
  return client;
}

async function onMessage(
  message: Message,
  config: ResolvedDiscordPiBridgeConfig,
  agentService: AgentService,
  promptQueue: PromptQueue,
): Promise<void> {
  if (message.author.bot) {
    logger.debug({ messageId: message.id }, "ignored bot message");
    return;
  }

  if (message.author.id !== config.discordAllowedUserId) {
    logger.debug(
      {
        messageId: message.id,
        authorId: message.author.id,
      },
      "ignored unauthorized user",
    );
    return;
  }

  if (message.channel.type !== ChannelType.DM) {
    logger.debug(
      {
        messageId: message.id,
        channelType: message.channel.type,
      },
      "ignored non-dm message",
    );
    return;
  }

  const content = message.content.trim();
  if (!content) {
    logger.debug({ messageId: message.id }, "ignored empty message");
    return;
  }

  logger.info(
    {
      direction: "IN",
      messageId: message.id,
      authorId: message.author.id,
      channelType: message.channel.type,
      content,
    },
    "message received",
  );

  // Start typing before command handling so slow commands (!compact, etc.) show typing
  const channelKey = message.channel.id;
  startTypingForChannel(message.channel, channelKey);

  const commandResult = await handleCommand(content, {
    agentService,
    promptQueue,
  });
  if (commandResult.handled) {
    stopTypingForChannel(channelKey);
    logger.info(
      {
        messageId: message.id,
        command: content,
        hasResponse: Boolean(commandResult.response),
      },
      "command handled",
    );
    if (commandResult.response) {
      await sendReply(message, commandResult.response);
    }
    return;
  }

  // Not a command — typing already started, keep it going

  if (!message.channel.isSendable()) {
    stopTypingForChannel(channelKey);
    logger.debug({ messageId: message.id }, "channel is not sendable");
    return;
  }

  const queuePosition = promptQueue.getSnapshot().pending;
  logger.debug(
    {
      messageId: message.id,
      queuePosition,
    },
    "enqueue request",
  );
  if (queuePosition > 0) {
    await sendReply(
      message,
      `Queued. ${queuePosition} request(s) ahead of this one.`,
    );
  }

  let response: string;
  try {
    response = await promptQueue.enqueue(async () => {
      logger.debug({ messageId: message.id }, "processing message");
      return agentService.prompt(content);
    });
  } finally {
    stopTypingForChannel(channelKey);
  }
  logger.info(
    {
      direction: "OUT",
      messageId: message.id,
      responseLength: response.length,
      response,
    },
    "response ready",
  );
  await sendReply(message, response);
}

async function sendReply(message: Message, text: string): Promise<void> {
  if (!message.channel.isSendable()) {
    logger.debug(
      {
        messageId: message.id,
      },
      "reply skipped, channel not sendable",
    );
    return;
  }

  const chunks = chunkMessage(text);
  logger.debug(
    {
      direction: "OUT",
      messageId: message.id,
      chunkCount: chunks.length,
      textLength: text.length,
    },
    "sending reply",
  );

  const [firstChunk, ...remainingChunks] = chunks;
  if (!firstChunk) {
    return;
  }

  await message.reply(firstChunk);
  for (const chunk of remainingChunks) {
    await message.channel.send(chunk);
  }
}

// 9 seconds keeps us clear of Discord's 10-second typing rate limit
const TYPING_INTERVAL_MS = 9000;

// Per-channel typing tracker to prevent duplicate intervals from
// concurrent onMessage calls hammering Discord's rate limit.
const typingIntervals = new Map<string, { interval: NodeJS.Timeout; refs: number }>();

function startTypingForChannel(channel: SendableChannels, channelKey: string): void {
  const existing = typingIntervals.get(channelKey);
  if (existing) {
    existing.refs += 1;
    return;
  }
  void channel.sendTyping();
  const interval = setInterval(() => {
    void channel.sendTyping();
  }, TYPING_INTERVAL_MS);
  typingIntervals.set(channelKey, { interval, refs: 1 });
}

function stopTypingForChannel(channelKey: string): void {
  const entry = typingIntervals.get(channelKey);
  if (!entry) {
    return;
  }
  entry.refs -= 1;
  if (entry.refs <= 0) {
    clearInterval(entry.interval);
    typingIntervals.delete(channelKey);
  }
}
