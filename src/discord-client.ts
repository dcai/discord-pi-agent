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
import { createModuleLogger, logPayload } from "./logger";
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
    logger.info(
      {
        direction: "IN",
        messageId: message.id,
        authorId: message.author.id,
        channelType: message.channel.type,
      },
      "message received",
    );
    logPayload(logger, {
      direction: "IN",
      label: "discord message content",
      content: message.content,
      context: {
        messageId: message.id,
        authorId: message.author.id,
      },
    });
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

  // Start typing before command handling so slow commands (!compact, etc.) show typing
  const typingInterval = await startTypingInterval(message.channel);

  const commandResult = await handleCommand(content, {
    agentService,
    promptQueue,
  });
  if (commandResult.handled) {
    stopTypingInterval(typingInterval);
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
    stopTypingInterval(typingInterval);
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

  const response = await promptQueue.enqueue(async () => {
    logger.debug({ messageId: message.id }, "processing message");
    return agentService.prompt(content);
  });

  stopTypingInterval(typingInterval);
  logger.info(
    {
      direction: "OUT",
      messageId: message.id,
      responseLength: response.length,
      preview: response.slice(0, 200),
    },
    "response ready",
  );
  logPayload(logger, {
    direction: "OUT",
    label: "discord response content",
    content: response,
    context: {
      messageId: message.id,
    },
  });
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
  logger.info(
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

const TYPING_INTERVAL_MS = 8000;

function startTypingInterval(channel: SendableChannels): NodeJS.Timeout {
  void channel.sendTyping();
  return setInterval(() => {
    void channel.sendTyping();
  }, TYPING_INTERVAL_MS);
}

function stopTypingInterval(interval: NodeJS.Timeout): void {
  clearInterval(interval);
}
