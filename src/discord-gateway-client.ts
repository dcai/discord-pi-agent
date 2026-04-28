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
import { chunkMessage } from "./message-chunker";
import { collectReply } from "./reply-buffer";
import type { SessionRegistry } from "./session-registry";
import type { ResolvedDiscordPiBridgeConfig } from "./types";

export type GatewayAuthConfig = {
  discordAllowedUserId: string;
  discordAllowedForumChannelIds: string[];
  discordAllowedUserIds: string[];
  startupMessage: string | false;
};

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
    console.log("[gateway] reply skipped, channel not sendable", {
      messageId: message.id,
    });
    return;
  }

  const chunks = chunkMessage(text);
  console.log("[gateway] sending reply", {
    messageId: message.id,
    chunkCount: chunks.length,
    textLength: text.length,
  });

  const [firstChunk, ...remainingChunks] = chunks;
  if (!firstChunk) {
    return;
  }

  await message.reply(firstChunk);
  for (const chunk of remainingChunks) {
    await channel.send(chunk);
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
    console.log(`[gateway] logged in as ${readyClient.user.tag}`);

    if (!authConfig.startupMessage) {
      return;
    }

    try {
      const user = await readyClient.users.fetch(
        authConfig.discordAllowedUserId,
      );
      const dmChannel = await user.createDM();
      await dmChannel.send(authConfig.startupMessage);
      console.log("[gateway] sent startup dm", {
        userId: authConfig.discordAllowedUserId,
      });
    } catch (error) {
      console.error("[gateway] failed to send startup dm", error);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    // Debug: dump full thread channel info for diagnostics
    if (message.channel.isThread()) {
      console.log("[gateway:debug] thread message raw", {
        messageId: message.id,
        authorId: message.author.id,
        authorTag: message.author.tag,
        channelId: message.channel.id,
        channelType: message.channel.type,
        parentId: message.channel.parentId,
        parentType: message.channel.parent?.type,
        guildId: message.guild?.id,
        content: message.content.slice(0, 500),
      });
    }

    console.log("[gateway] message received", {
      messageId: message.id,
      authorId: message.author.id,
      channelType: message.channel.type,
      content: message.content.slice(0, 200),
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
      console.error("[gateway] message handling failed", error);
      await sendReply(
        message,
        "The bot hit an error while handling that message.",
      );
    }
  });

  client.on(Events.ThreadDelete, async (thread) => {
    const scope = `thread:${thread.id}`;
    console.log("[gateway] thread deleted", { threadId: thread.id, scope });
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
    console.log("[gateway] ignored bot message", { messageId: message.id });
    return;
  }

  const scope = resolveScope(message);
  if (scope === null) {
    console.log("[gateway] unsupported channel type, ignoring", {
      messageId: message.id,
      channelType: message.channel.type,
    });
    return;
  }

  if (!isAuthorized(message, scope, authConfig)) {
    console.log("[gateway] unauthorized", {
      messageId: message.id,
      authorId: message.author.id,
      scope,
    });
    return;
  }

  const content = message.content.trim();
  if (!content) {
    console.log("[gateway] ignored empty message", { messageId: message.id });
    return;
  }

  const { session, promptQueue } = await sessionRegistry.getOrCreate(scope);

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
      console.log("[gateway] archiving thread", { scope });
      const archiveChannel = message.channel;
      if (archiveChannel.isSendable()) {
        await archiveChannel.send(commandResult.response ?? "Archiving...");
      }
      try {
        if (archiveChannel.isThread()) {
          await archiveChannel.setArchived(true);
        }
      } catch (error) {
        console.error("[gateway] failed to archive thread", error);
      }
      await sessionRegistry.remove(scope);
      return;
    }

    console.log("[gateway] command handled", {
      messageId: message.id,
      command: content,
      hasResponse: Boolean(commandResult.response),
    });

    if (commandResult.response) {
      await sendReply(message, commandResult.response);
    }

    return;
  }

  // Not a command — enqueue as prompt
  if (!message.channel.isSendable()) {
    stopTypingInterval(typingInterval);
    console.log("[gateway] channel not sendable", { messageId: message.id });
    return;
  }

  const queuePosition = promptQueue.getSnapshot().pending;
  console.log("[queue] enqueue request", {
    scope,
    messageId: message.id,
    queuePosition,
  });

  if (queuePosition > 0) {
    await sendReply(
      message,
      `Queued. ${queuePosition} request(s) ahead of this one.`,
    );
  }

  const response = await promptQueue.enqueue(async () => {
    console.log(`[queue] processing message ${message.id} in scope ${scope}`);
    const transformedPrompt = await config.promptTransform(content);
    return collectReply(session, transformedPrompt, {
      logPrefix: `[agent:${session.sessionId}]`,
    });
  });

  stopTypingInterval(typingInterval);
  console.log("[gateway] response ready", {
    scope,
    messageId: message.id,
    responseLength: response.length,
    preview: response.slice(0, 200),
  });
  await sendReply(message, response);
}
