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
import {
  buildDiscordMessageContextPrompt,
  formatDiscordPromptTime,
} from "./prompt-context";
import { collectReply } from "./reply-buffer";
import type { SessionRegistry } from "./session-registry";
import type { ResolvedDiscordPiBridgeConfig } from "./types";

const logger = createModuleLogger("discord-gateway");

export type GatewayAuthConfig = {
  discordAllowedUserId: string;
  discordAllowedForumChannelIds: string[];
  discordAllowedUserIds: string[];
  startupMessage: string | false;
};

function getAuthorDisplayName(message: Message): string {
  return (
    message.member?.displayName ||
    message.author.globalName ||
    message.author.username
  );
}

function buildDiscordPromptContent(
  message: Message,
  scope: string,
  content: string,
  config: ResolvedDiscordPiBridgeConfig,
): string {
  const isThread = scope.startsWith("thread:") && message.channel.isThread();

  return buildDiscordMessageContextPrompt(content, {
    scope: scope === "dm" ? "dm" : "thread",
    sentAt: message.createdAt.toISOString(),
    sentAtLocal: formatDiscordPromptTime(message.createdAt, {
      timeZone: config.promptTimeZone,
      locale: config.promptLocale,
    }),
    messageId: message.id,
    authorId: message.author.id,
    authorName: getAuthorDisplayName(message),
    threadId: isThread ? message.channel.id : undefined,
    threadTitle: isThread ? message.channel.name : undefined,
    forumChannelId: isThread ? message.channel.parentId : undefined,
  });
}

/**
 * Determine the session scope from an incoming message.
 * Returns null for unsupported channel types (silently ignored).
 */
function resolveScope(message: Message): string | null {
  if (message.channel.type === ChannelType.DM) {
    return "dm";
  }

  if (message.channel.isThread()) {
    return `thread:${message.channel.id}`;
  }

  return null;
}

function isAuthorized(
  message: Message,
  scope: string,
  authConfig: GatewayAuthConfig,
): boolean {
  // DM scope: check against discordAllowedUserId
  if (scope === "dm") {
    return message.author.id === authConfig.discordAllowedUserId;
  }

  // Thread scope: check user is in allowed list and forum channel is allowed
  if (scope.startsWith("thread:")) {
    const channel = message.channel;
    if (!channel.isThread()) {
      return false;
    }

    const parentId = channel.parentId;
    if (
      !parentId ||
      !authConfig.discordAllowedForumChannelIds.includes(parentId)
    ) {
      return false;
    }

    return authConfig.discordAllowedUserIds.includes(message.author.id);
  }

  return false;
}

const TYPING_INTERVAL_MS = 8000;

function startTypingInterval(channel: SendableChannels): NodeJS.Timeout {
  void channel.sendTyping();
  return setInterval(() => {
    void channel.sendTyping();
  }, TYPING_INTERVAL_MS);
}

function stopTypingInterval(interval: NodeJS.Timeout | null): void {
  if (interval) {
    clearInterval(interval);
  }
}

async function sendReply(message: Message, text: string): Promise<void> {
  const channel = message.channel;
  if (!channel.isSendable()) {
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

  try {
    await message.reply(firstChunk);
    for (const chunk of remainingChunks) {
      await channel.send(chunk);
    }
  } catch (error) {
    logger.error(
      {
        messageId: message.id,
        error,
      },
      "send reply failed",
    );
  }
}

export async function startGatewayClient(
  config: ResolvedDiscordPiBridgeConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  authConfig: GatewayAuthConfig,
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ userTag: readyClient.user.tag }, "logged in");

    if (!authConfig.startupMessage) {
      return;
    }

    try {
      const user = await readyClient.users.fetch(
        authConfig.discordAllowedUserId,
      );
      const dmChannel = await user.createDM();
      await dmChannel.send(authConfig.startupMessage);
      logger.info(
        {
          userId: authConfig.discordAllowedUserId,
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
        preview: message.content.slice(0, 200),
      },
      "message received",
    );
    logPayload(logger, {
      direction: "IN",
      label: "gateway message content",
      content: message.content,
      context: {
        messageId: message.id,
        authorId: message.author.id,
      },
    });

    try {
      await onMessage(
        message,
        config,
        agentService,
        sessionRegistry,
        authConfig,
      );
    } catch (error) {
      logger.error({ error, direction: "IN" }, "message handling failed");
      await sendReply(
        message,
        "The bot hit an error while handling that message.",
      );
    }
  });

  client.on(Events.ThreadDelete, async (thread) => {
    const scope = `thread:${thread.id}`;
    logger.info({ threadId: thread.id, scope }, "thread deleted");
    await sessionRegistry.remove(scope);
  });

  await client.login(config.discordBotToken);
  return client;
}

async function onMessage(
  message: Message,
  config: ResolvedDiscordPiBridgeConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  authConfig: GatewayAuthConfig,
): Promise<void> {
  if (message.author.bot) {
    logger.debug({ messageId: message.id }, "ignored bot message");
    return;
  }

  if (message.system) {
    logger.debug({ messageId: message.id }, "ignored system message");
    return;
  }

  const scope = resolveScope(message);
  if (scope === null) {
    logger.debug(
      {
        messageId: message.id,
        channelType: message.channel.type,
      },
      "unsupported channel type, ignoring",
    );
    return;
  }

  if (!isAuthorized(message, scope, authConfig)) {
    logger.debug(
      {
        messageId: message.id,
        authorId: message.author.id,
        scope,
      },
      "unauthorized",
    );
    return;
  }

  const content = message.content.trim();
  if (!content) {
    logger.debug({ messageId: message.id }, "ignored empty message");
    return;
  }

  const { entry, created } = await sessionRegistry.getOrCreate(scope);
  const { session, promptQueue } = entry;

  if (created && scope.startsWith("thread:") && message.channel.isThread()) {
    logger.info(
      {
        scope,
        threadName: message.channel.name,
      },
      "new thread session",
    );
  }

  // Start typing indicator
  let typingInterval: NodeJS.Timeout | null = null;
  if (message.channel.isSendable()) {
    typingInterval = startTypingInterval(message.channel);
  }

  // Try commands first
  const commandResult = await handleCommand(content, {
    agentService,
    promptQueue,
    session,
  });

  if (commandResult.handled) {
    stopTypingInterval(typingInterval);

    if (commandResult.archive && scope.startsWith("thread:")) {
      logger.info({ scope }, "archiving thread");
      const archiveChannel = message.channel;
      if (archiveChannel.isSendable()) {
        await archiveChannel.send(commandResult.response ?? "Archiving...");
      }
      try {
        if (archiveChannel.isThread()) {
          await archiveChannel.setArchived(true);
        }
      } catch (error) {
        logger.error({ error }, "failed to archive thread");
      }
      await sessionRegistry.remove(scope);
      return;
    }

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

  // Not a command — enqueue as prompt
  if (!message.channel.isSendable()) {
    stopTypingInterval(typingInterval);
    logger.debug({ messageId: message.id }, "channel not sendable");
    return;
  }

  const queuePosition = promptQueue.getSnapshot().pending;
  logger.debug(
    {
      scope,
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
    logger.debug(
      {
        messageId: message.id,
        scope,
      },
      "processing message",
    );
    const promptContent = buildDiscordPromptContent(
      message,
      scope,
      content,
      config,
    );
    logPayload(logger, {
      direction: "IN",
      label: "gateway prompt content",
      content: promptContent,
      context: {
        scope,
        messageId: message.id,
      },
    });
    const transformedPrompt = await config.promptTransform(promptContent);
    return collectReply(session, transformedPrompt, {
      logPrefix: `[agent:${session.sessionId}]`,
    });
  });

  stopTypingInterval(typingInterval);
  logger.info(
    {
      direction: "OUT",
      scope,
      messageId: message.id,
      responseLength: response.length,
      preview: response.slice(0, 200),
    },
    "response ready",
  );
  logPayload(logger, {
    direction: "OUT",
    label: "gateway response content",
    content: response,
    context: {
      scope,
      messageId: message.id,
    },
  });
  await sendReply(message, response);
}
