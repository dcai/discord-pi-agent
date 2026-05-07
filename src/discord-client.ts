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
import { logger } from "./logger";
import { chunkMessage } from "./message-chunker";
import type { PromptQueue } from "./prompt-queue";
import type { ResolvedDiscordPiBridgeConfig } from "./types";

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
    logger.info({ userTag: readyClient.user.tag }, "[discord] logged in");
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
        "[discord] sent startup dm",
      );
    } catch (error) {
      logger.error({ error }, "[discord] failed to send startup dm");
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    logger.info(
      {
        messageId: message.id,
        authorId: message.author.id,
        channelType: message.channel.type,
        content: message.content,
      },
      "[discord] message received",
    );
    try {
      await onMessage(message, config, agentService, promptQueue);
    } catch (error) {
      logger.error({ error }, "[discord] message handling failed");
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
    logger.debug({ messageId: message.id }, "[discord] ignored bot message");
    return;
  }

  if (message.author.id !== config.discordAllowedUserId) {
    logger.debug(
      {
        messageId: message.id,
        authorId: message.author.id,
      },
      "[discord] ignored unauthorized user",
    );
    return;
  }

  if (message.channel.type !== ChannelType.DM) {
    logger.debug(
      {
        messageId: message.id,
        channelType: message.channel.type,
      },
      "[discord] ignored non-dm message",
    );
    return;
  }

  const content = message.content.trim();
  if (!content) {
    logger.debug({ messageId: message.id }, "[discord] ignored empty message");
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
      "[discord] command handled",
    );
    if (commandResult.response) {
      await sendReply(message, commandResult.response);
    }
    return;
  }

  // Not a command — typing already started, keep it going

  if (!message.channel.isSendable()) {
    stopTypingInterval(typingInterval);
    logger.debug(
      { messageId: message.id },
      "[discord] channel is not sendable",
    );
    return;
  }

  const queuePosition = promptQueue.getSnapshot().pending;
  logger.debug(
    {
      messageId: message.id,
      queuePosition,
    },
    "[queue] enqueue request",
  );
  if (queuePosition > 0) {
    await sendReply(
      message,
      `Queued. ${queuePosition} request(s) ahead of this one.`,
    );
  }

  const response = await promptQueue.enqueue(async () => {
    logger.debug({ messageId: message.id }, "[queue] processing message");
    return agentService.prompt(content);
  });

  stopTypingInterval(typingInterval);
  logger.info(
    {
      messageId: message.id,
      responseLength: response.length,
      preview: response.slice(0, 200),
    },
    "[discord] response ready",
  );
  await sendReply(message, response);
}

async function sendReply(message: Message, text: string): Promise<void> {
  if (!message.channel.isSendable()) {
    logger.debug(
      {
        messageId: message.id,
      },
      "[discord] reply skipped, channel not sendable",
    );
    return;
  }

  const chunks = chunkMessage(text);
  logger.info(
    {
      messageId: message.id,
      chunkCount: chunks.length,
      textLength: text.length,
    },
    "[discord] sending reply",
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
