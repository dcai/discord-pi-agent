import type { ImageContent } from "@earendil-works/pi-ai";
import type { Message } from "discord.js";
import type { AgentService } from "./agent-service";
import {
  readMediaAttachments,
  readTextAttachments,
  type MediaAttachmentContent,
} from "./discord-attachments";
import { isAuthorizedMessage, resolveMessageScope } from "./discord-auth";
import { resolveMediaAttachmentsForPrompt } from "./discord-media-resolution";
import {
  addReaction,
  addWorkingReaction,
  removeReaction,
  removeWorkingReaction,
  sendCommandReply,
  sendReply,
} from "./discord-replies";
import { executeSessionCommand, type CommandResult } from "./session-commands";
import { startTypingForChannel, stopTypingForChannel } from "./discord-typing";
import { createModuleLogger } from "./logger";
import {
  buildDiscordMessageMetadata,
  formatDiscordPromptTime,
  wrapXmlTag,
} from "./prompt-context";
import { runAgentTurn } from "./agent-turn-runner";
import type {
  ScopedSessionEntry,
  SessionRegistry,
  SessionScope,
} from "./session-registry";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const logger = createModuleLogger("discord-message-handler");

const TOOL_REACTION_EMOJIS: Record<string, string> = {
  bash: "🖥️",
  edit: "✏️",
  read: "👀",
  write: "📝",
};

const DEFAULT_TOOL_REACTION_EMOJI = "🔧";

type PreparedDiscordMessage = {
  scope: SessionScope;
  content: string;
  mediaAttachments: MediaAttachmentContent[];
};

export async function handleDiscordMessage(
  message: Message,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
): Promise<void> {
  const preparedMessage = await prepareDiscordMessage(message, accessConfig);
  if (!preparedMessage) {
    return;
  }

  logger.info(
    {
      scope: preparedMessage.scope,
      content: preparedMessage.content,
    },
    "message received",
  );

  const channelKey = message.channel.id;
  startTypingIfPossible(message, channelKey);

  const { entry, created } = await sessionRegistry.getOrCreate(
    preparedMessage.scope,
  );
  logNewThreadSession(message, preparedMessage.scope, created);

  const commandResult = await executeSessionCommand(preparedMessage.content, {
    agentService,
    promptQueue: entry.promptQueue,
    session: entry.session,
    scope: preparedMessage.scope,
    workingEmoji: entry.workingEmoji,
  });

  if (commandResult.handled) {
    await handleCommandResult(
      message,
      sessionRegistry,
      preparedMessage.scope,
      entry,
      commandResult,
      preparedMessage.content,
      channelKey,
    );
    return;
  }

  await processAgentPrompt(
    message,
    config,
    agentService,
    entry,
    preparedMessage,
    channelKey,
  );
}

async function prepareDiscordMessage(
  message: Message,
  accessConfig: GatewayAccessConfig,
): Promise<PreparedDiscordMessage | null> {
  if (message.author.bot || message.system) {
    return null;
  }

  const scope = resolveMessageScope(message);
  if (scope === null) {
    logger.debug(
      {
        messageId: message.id,
        channelType: message.channel.type,
      },
      "unsupported channel type, ignoring",
    );
    return null;
  }

  if (!isAuthorizedMessage(message, scope, accessConfig)) {
    logger.debug(
      {
        messageId: message.id,
        authorId: message.author.id,
        scope,
      },
      "unauthorized",
    );
    return null;
  }

  const content = await buildMessageContent(message);
  const mediaAttachments = await readMediaAttachments(message);

  if (!content && mediaAttachments.length === 0) {
    logger.debug(
      { messageId: message.id },
      "ignored empty message (no text or images)",
    );
    return null;
  }

  return {
    scope,
    content,
    mediaAttachments,
  };
}

async function buildMessageContent(message: Message): Promise<string> {
  const baseContent = message.content.trim();
  const textAttachments = await readTextAttachments(message);

  if (textAttachments.length === 0) {
    return baseContent;
  }

  const attachmentText = textAttachments
    .map((attachment) => {
      return `\n\n--- Attachment: ${attachment.filename} ---\n${attachment.content}`;
    })
    .join("");

  if (!baseContent) {
    return textAttachments[0]?.content ?? "";
  }

  return baseContent + attachmentText;
}

function startTypingIfPossible(message: Message, channelKey: string): void {
  if (message.channel.isSendable()) {
    startTypingForChannel(message.channel, channelKey);
  }
}

function logNewThreadSession(
  message: Message,
  scope: SessionScope,
  created: boolean,
): void {
  if (!created || !scope.startsWith("thread:") || !message.channel.isThread()) {
    return;
  }

  logger.info(
    {
      scope,
      threadName: message.channel.name,
    },
    "new thread session",
  );
}

async function handleCommandResult(
  message: Message,
  sessionRegistry: SessionRegistry,
  scope: SessionScope,
  entry: ScopedSessionEntry,
  commandResult: CommandResult,
  content: string,
  channelKey: string,
): Promise<void> {
  stopTypingForChannel(channelKey);

  if (commandResult.workingEmoji) {
    entry.workingEmoji = commandResult.workingEmoji;
    logger.info(
      { scope, emoji: commandResult.workingEmoji },
      "working emoji updated",
    );
  }

  if (commandResult.newSession) {
    entry.session = commandResult.newSession;
    logger.info(
      { scope, sessionId: commandResult.newSession.sessionId },
      "session replaced",
    );
  }

  if (commandResult.archive && scope.startsWith("thread:")) {
    await archiveThreadSession(message, sessionRegistry, scope, commandResult);
    return;
  }

  logger.info(
    {
      messageId: message.id,
      command: content,
      hasResponse: Boolean(commandResult.response),
    },
    `command handled: ${content}`,
  );

  if (commandResult.response) {
    await sendCommandReply(message, commandResult.response);
  }
}

async function archiveThreadSession(
  message: Message,
  sessionRegistry: SessionRegistry,
  scope: SessionScope,
  commandResult: CommandResult,
): Promise<void> {
  logger.info({ scope }, "archiving thread");

  if (message.channel.isSendable()) {
    await message.channel.send(
      `\`\`\`\n${commandResult.response ?? "Archiving..."}\n\`\`\``,
    );
  }

  try {
    if (message.channel.isThread()) {
      await message.channel.setArchived(true);
    }
  } catch (error) {
    logger.error({ error }, "failed to archive thread");
  }

  await sessionRegistry.remove(scope);
}

function resolveToolReactionEmoji(toolName: string): string {
  return TOOL_REACTION_EMOJIS[toolName] ?? DEFAULT_TOOL_REACTION_EMOJI;
}

async function processAgentPrompt(
  message: Message,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  entry: ScopedSessionEntry,
  preparedMessage: PreparedDiscordMessage,
  channelKey: string,
): Promise<void> {
  if (!message.channel.isSendable()) {
    stopTypingForChannel(channelKey);
    logger.debug({ messageId: message.id }, "channel not sendable");
    return;
  }

  await addWorkingReaction(message, entry.workingEmoji);
  await notifyIfPromptQueued(message, entry.promptQueue.getSnapshot().pending);

  const toolEmojiByCallId = new Map<string, string>();
  const activeToolCountByEmoji = new Map<string, number>();
  let reactionOperationChain = Promise.resolve();

  try {
    const response = await entry.promptQueue.enqueue(async () => {
      const promptInput = await buildPromptInput(
        message,
        config,
        agentService,
        entry,
        preparedMessage,
      );

      return runAgentTurn(entry.session, promptInput.prompt, {
        images: promptInput.images,
        onToolStart: async ({ toolName, toolCallId }) => {
          reactionOperationChain = reactionOperationChain.then(async () => {
            const emoji = resolveToolReactionEmoji(toolName);
            toolEmojiByCallId.set(toolCallId, emoji);

            const activeCount = activeToolCountByEmoji.get(emoji) ?? 0;
            activeToolCountByEmoji.set(emoji, activeCount + 1);

            if (activeCount === 0) {
              await addReaction(message, emoji);
            }
          });

          await reactionOperationChain;
        },
        onToolEnd: async ({ toolCallId }) => {
          reactionOperationChain = reactionOperationChain.then(async () => {
            const emoji = toolEmojiByCallId.get(toolCallId);
            if (!emoji) {
              return;
            }

            toolEmojiByCallId.delete(toolCallId);
            const activeCount = activeToolCountByEmoji.get(emoji) ?? 0;
            if (activeCount <= 1) {
              activeToolCountByEmoji.delete(emoji);
              await removeReaction(message, emoji);
              return;
            }

            activeToolCountByEmoji.set(emoji, activeCount - 1);
          });

          await reactionOperationChain;
        },
      });
    });

    await sendReply(message, response);
  } finally {
    stopTypingForChannel(channelKey);

    const activeEmojis = Array.from(activeToolCountByEmoji.keys());
    await Promise.all(
      activeEmojis.map(async (emoji) => {
        await removeReaction(message, emoji);
      }),
    );
    await removeWorkingReaction(message, entry.workingEmoji);
  }
}

async function notifyIfPromptQueued(
  message: Message,
  pendingCount: number,
): Promise<void> {
  if (pendingCount > 0) {
    await sendReply(
      message,
      `Queued. ${pendingCount} request(s) ahead of this one.`,
    );
  }
}

async function buildPromptInput(
  message: Message,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  entry: ScopedSessionEntry,
  preparedMessage: PreparedDiscordMessage,
): Promise<{ prompt: string; images: ImageContent[] | undefined }> {
  const resolvedPromptMedia = await resolvePromptMedia(
    preparedMessage,
    entry,
    config,
    agentService,
  );
  const discordMetadata = buildDiscordMessageMetadata(
    message,
    preparedMessage.scope,
  );

  const prompt = await config.promptTransform({
    rawContent: resolvedPromptMedia.content,
    discordMetadata,
    now: () => {
      return wrapXmlTag(
        "datetime",
        formatDiscordPromptTime(new Date(), {
          timeZone: config.promptTimeZone,
          locale: config.promptLocale,
        }),
      );
    },
    userMessage: () => {
      return wrapXmlTag("user_message", resolvedPromptMedia.content);
    },
  });

  return {
    prompt,
    images:
      resolvedPromptMedia.images.length > 0
        ? resolvedPromptMedia.images
        : undefined,
  };
}

async function resolvePromptMedia(
  preparedMessage: PreparedDiscordMessage,
  entry: ScopedSessionEntry,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
): Promise<{ content: string; images: ImageContent[] }> {
  if (preparedMessage.mediaAttachments.length === 0) {
    return {
      content: preparedMessage.content,
      images: [],
    };
  }

  return resolveMediaAttachmentsForPrompt(
    preparedMessage.mediaAttachments,
    preparedMessage.content,
    entry.session.model,
    config,
    agentService,
  );
}
