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

const WORKING_EMOJI = "\u2699\uFE0F"; // ⚙️ gear emoji

async function addWorkingReaction(message: Message): Promise<void> {
  try {
    await message.react(WORKING_EMOJI);
  } catch (error) {
    logger.debug(
      { messageId: message.id, error },
      "failed to add working reaction",
    );
  }
}

async function removeWorkingReaction(message: Message): Promise<void> {
  try {
    const reaction = message.reactions.cache.get(WORKING_EMOJI);
    if (reaction) {
      await reaction.users.remove(message.client.user!);
    }
  } catch (error) {
    logger.debug(
      { messageId: message.id, error },
      "failed to remove working reaction",
    );
  }
}

// 9 seconds keeps us clear of Discord's 10-second typing rate limit
const TYPING_INTERVAL_MS = 9000;

// Per-channel typing tracker to prevent duplicate intervals from
// concurrent onMessage calls hammering Discord's rate limit.
const typingIntervals = new Map<
  string,
  { interval: NodeJS.Timeout; refs: number }
>();

async function sendTypingSafe(
  channel: SendableChannels,
  channelKey: string,
): Promise<void> {
  try {
    const token = channel.client.token;
    const url = `https://discord.com/api/v10/channels/${channel.id}/typing`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.ok) {
      logger.debug({ channelKey }, "[TYPING] OK");
      return;
    }
    if (res.status === 429) {
      const body = await res.text();
      let retryMs = 3_000;
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.retry_after === "number") {
          retryMs = parsed.retry_after * 1_000 + 500;
        }
      } catch {
        // ignore parse errors
      }
      logger.warn(
        { channelKey, retryMs },
        "[TYPING] 429, retrying after delay",
      );
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bot ${token}` },
      });
      logger.info({ channelKey }, "[TYPING] retry done");
      return;
    }
    logger.warn(
      { channelKey, status: res.status },
      "[TYPING] unexpected status",
    );
  } catch (error: unknown) {
    logger.warn({ channelKey, error }, "[TYPING] FAILED");
  }
}

function startTypingForChannel(
  channel: SendableChannels,
  channelKey: string,
): void {
  const existing = typingIntervals.get(channelKey);
  if (existing) {
    existing.refs += 1;
    logger.debug(
      { channelKey, refs: existing.refs },
      "[TYPING] ref++ (reusing existing interval)",
    );
    return;
  }
  logger.debug({ channelKey }, "[TYPING] started new interval");
  void sendTypingSafe(channel, channelKey);
  const interval = setInterval(() => {
    void sendTypingSafe(channel, channelKey);
  }, TYPING_INTERVAL_MS);
  typingIntervals.set(channelKey, { interval, refs: 1 });
}

function stopTypingForChannel(channelKey: string): void {
  const entry = typingIntervals.get(channelKey);
  if (!entry) {
    logger.debug({ channelKey }, "[TYPING] stop called but no entry found");
    return;
  }
  entry.refs -= 1;
  if (entry.refs <= 0) {
    clearInterval(entry.interval);
    typingIntervals.delete(channelKey);
    logger.debug({ channelKey }, "[TYPING] interval cleared (refs hit 0)");
  } else {
    logger.debug(
      { channelKey, refs: entry.refs },
      "[TYPING] ref-- (interval still active)",
    );
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

  logger.info(
    {
      direction: "IN",
      scope,
      messageId: message.id,
      authorId: message.author.id,
      channelType: message.channel.type,
      content,
    },
    "message received",
  );

  // Start typing BEFORE session creation to give 429 retry a head start
  const channelKey = message.channel.id;
  const canSend = message.channel.isSendable();
  if (canSend) {
    startTypingForChannel(message.channel, channelKey);
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

  // Try commands first
  const commandResult = await handleCommand(content, {
    agentService,
    promptQueue,
    session,
  });

  if (commandResult.handled) {
    stopTypingForChannel(channelKey);

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
    stopTypingForChannel(channelKey);
    logger.debug({ messageId: message.id }, "channel not sendable");
    return;
  }

  await addWorkingReaction(message);

  const queuePosition = promptQueue.getSnapshot().pending;
  // logger.debug(
  //   {
  //     scope,
  //     messageId: message.id,
  //     queuePosition,
  //   },
  //   "enqueue request",
  // );

  if (queuePosition > 0) {
    await sendReply(
      message,
      `Queued. ${queuePosition} request(s) ahead of this one.`,
    );
  }

  let response: string;
  try {
    response = await promptQueue.enqueue(async () => {
      // logger.debug(
      //   {
      //     messageId: message.id,
      //     scope,
      //   },
      //   "processing message",
      // );
      const promptContent = buildDiscordPromptContent(
        message,
        scope,
        content,
        config,
      );
      const transformedPrompt = await config.promptTransform(promptContent);
      return collectReply(session, transformedPrompt, {
        logPrefix: `[agent:${session.sessionId}]`,
      });
    });
  } finally {
    stopTypingForChannel(channelKey);
    await removeWorkingReaction(message);
  }
  await sendReply(message, response);
}
