import type { ImageContent } from "@earendil-works/pi-ai";
import type { Message, PartialMessage } from "discord.js";
import type { AgentService } from "./agent-service";
import {
  readAudioAttachments,
  readMediaAttachments,
  readTextAttachments,
  type AudioAttachmentContent,
  type MediaAttachmentContent,
} from "./discord-attachments";
import { isAuthorizedMessage, resolveMessageScope } from "./discord-auth";
import { resolveMediaAttachmentsForPrompt } from "./discord-media-resolution";
import { generatePostReplyFollowUp } from "./discord-reply-reflection";
import { transcribeAudioAttachments } from "./audio-transcription";
import {
  addReaction,
  addWorkingReaction,
  removeReaction,
  removeWorkingReaction,
  sendCommandReply,
  sendFollowUp,
  sendReply,
} from "./discord-replies";
import { PromptQueueCancelledError } from "./prompt-queue";
import { executeSessionCommand, type CommandResult } from "./session-commands";
import { startTypingForChannel, stopTypingForChannel } from "./discord-typing";
import { createModuleLogger } from "./logger";
import {
  buildDiscordMessageMetadata,
  formatDiscordPromptTime,
  wrapXmlTag,
  type DiscordMessageMetadataOptions,
} from "./prompt-context";
import { runAgentTurn } from "./agent-turn-runner";
import type {
  ScopedSessionEntry,
  SessionRegistry,
  SessionScope,
} from "./session-registry";
import type { TaskSchedulerService } from "./task-scheduler-service";
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
  audioAttachments: AudioAttachmentContent[];
  metadataOptions?: DiscordMessageMetadataOptions;
};

type BuiltPromptInput = {
  prompt: string;
  images: ImageContent[] | undefined;
  rawContent: string;
  discordMetadata: string;
};

/**
 * Handle edited messages. Currently only processes forum thread starter
 * message edits (post body updates). The edited content is sent to the pi
 * session so the agent stays aware of topic changes.
 */
export async function handleForumPostEdit(
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
): Promise<void> {
  const message = await resolveFullMessage(newMessage);
  if (!message) {
    return;
  }

  if (!isForumThreadStarterMessage(message)) {
    return;
  }

  if (!didMessageContentChange(oldMessage, message)) {
    return;
  }

  const preparedMessage = await prepareDiscordMessage(message, accessConfig);
  if (!preparedMessage || preparedMessage.scope === "dm") {
    return;
  }

  logger.info(
    {
      scope: preparedMessage.scope,
      content: preparedMessage.content,
    },
    "forum post edited",
  );

  const channelKey = message.channel.id;
  startTypingIfPossible(message, channelKey);

  const { entry } = await sessionRegistry.getOrCreate(preparedMessage.scope);
  await processAgentPrompt(
    message,
    config,
    agentService,
    entry,
    {
      ...preparedMessage,
      metadataOptions: {
        eventType: "thread_starter_edit",
        editedAt: message.editedAt ?? new Date(),
      },
    },
    channelKey,
  );
}

export async function handleDiscordMessage(
  message: Message,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
  taskScheduler?: TaskSchedulerService | null,
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

  const promptTemplateCommand =
    agentService.resources.expandPromptTemplateCommand(
      preparedMessage.content,
      config.discordCommandPrefixes,
    );
  if (promptTemplateCommand.matched) {
    logger.info(
      {
        scope: preparedMessage.scope,
        templateName: promptTemplateCommand.template.name,
      },
      "prompt template command received",
    );
    await processAgentPrompt(
      message,
      config,
      agentService,
      entry,
      {
        ...preparedMessage,
        content: promptTemplateCommand.expandedPrompt,
      },
      channelKey,
    );
    return;
  }

  const commandResult = await executeSessionCommand(preparedMessage.content, {
    agentService,
    promptQueue: entry.promptQueue,
    session: entry.session,
    sessionRegistry,
    taskScheduler,
    channelId: message.channel.id,
    promptTimeZone: config.promptTimeZone,
    promptLocale: config.promptLocale,
    scope: preparedMessage.scope,
    workingEmoji: entry.workingEmoji,
    commandPrefixes: config.discordCommandPrefixes,
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
    commandResult.forwardedInput
      ? {
          ...preparedMessage,
          content: commandResult.forwardedInput,
        }
      : preparedMessage,
    channelKey,
  );
}

async function resolveFullMessage(
  message: Message | PartialMessage,
): Promise<Message | null> {
  if (!message.partial) {
    return message;
  }

  try {
    return await message.fetch();
  } catch {
    return null;
  }
}

function isForumThreadStarterMessage(message: Message): boolean {
  if (!message.channel.isThread()) {
    return false;
  }

  return message.id === message.channel.id;
}

function didMessageContentChange(
  oldMessage: Message | PartialMessage,
  newMessage: Message,
): boolean {
  if (oldMessage.partial) {
    return true;
  }

  return (oldMessage.content ?? "") !== (newMessage.content ?? "");
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
  const audioAttachments = await readAudioAttachments(message);

  if (
    !content &&
    mediaAttachments.length === 0 &&
    audioAttachments.length === 0
  ) {
    logger.debug(
      { messageId: message.id },
      "ignored empty message (no text, images, or audio)",
    );
    return null;
  }

  return {
    scope,
    content,
    mediaAttachments,
    audioAttachments,
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
  const cancellationCount = entry.promptQueue.getCancellationCount();

  try {
    const result = await entry.promptQueue.enqueue(async () => {
      const promptInput = await buildPromptInput(
        message,
        config,
        agentService,
        entry,
        preparedMessage,
      );

      const response = await runAgentTurn(entry.session, promptInput.prompt, {
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

      return {
        response,
        promptInput,
      };
    });

    await sendReply(message, result.response);

    if (config.replyReflection.enabled) {
      const followUp = await generatePostReplyFollowUp({
        config,
        agentService,
        promptText: result.promptInput.rawContent,
        assistantReply: result.response,
        discordMetadata: result.promptInput.discordMetadata,
        sourceModel: entry.session.model,
      });

      if (followUp) {
        logger.info(
          { messageId: message.id, scope: preparedMessage.scope },
          "sending post-reply follow-up",
        );
        await sendFollowUp(message, followUp);
      }
    }
  } catch (error) {
    if (
      error instanceof PromptQueueCancelledError ||
      entry.promptQueue.getCancellationCount() !== cancellationCount
    ) {
      await sendReply(message, "Cancelled.");
      return;
    }

    throw error;
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
): Promise<BuiltPromptInput> {
  const contentWithAudio = await resolveAudio(preparedMessage, config);
  const resolvedPromptMedia = await resolvePromptMedia(
    { ...preparedMessage, content: contentWithAudio },
    entry,
    config,
    agentService,
  );
  const discordMetadata = buildDiscordMessageMetadata(
    message,
    preparedMessage.scope,
    preparedMessage.metadataOptions,
    {
      timeZone: config.promptTimeZone,
      locale: config.promptLocale,
    },
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
    rawContent: resolvedPromptMedia.content,
    discordMetadata,
  };
}

async function resolveAudio(
  preparedMessage: PreparedDiscordMessage,
  config: ResolvedDiscordGatewayConfig,
): Promise<string> {
  if (preparedMessage.audioAttachments.length === 0) {
    return preparedMessage.content;
  }

  if (!config.audioTranscription.enabled) {
    const names = preparedMessage.audioAttachments
      .map((a) => a.filename)
      .join(", ");
    const note = `\n\n[Audio file(s) received: ${names}]\n(Audio transcription not configured. Set audioTranscription in config to enable.)`;
    return preparedMessage.content ? preparedMessage.content + note : note;
  }

  const transcriptText = await transcribeAudioAttachments(
    preparedMessage.audioAttachments,
    config.audioTranscription,
  );

  if (!transcriptText) {
    return preparedMessage.content;
  }

  return preparedMessage.content
    ? `${transcriptText}\n\n---\n${preparedMessage.content}`
    : transcriptText;
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
