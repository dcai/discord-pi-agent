import type { ImageContent } from "@earendil-works/pi-ai";
import type { Message } from "discord.js";
import type { AgentService } from "./agent-service";
import { executeSessionCommand } from "./session-commands";
import {
  readMediaAttachments,
  readTextAttachments,
} from "./discord-attachments";
import {
  getAuthorDisplayName,
  isAuthorizedMessage,
  resolveMessageScope,
} from "./discord-auth";
import {
  addWorkingReaction,
  removeWorkingReaction,
  sendCommandReply,
  sendReply,
} from "./discord-replies";
import { resolveMediaAttachmentsForPrompt } from "./discord-media-resolution";
import { startTypingForChannel, stopTypingForChannel } from "./discord-typing";
import { createModuleLogger } from "./logger";
import {
  buildDiscordMessageContextPrompt,
  formatDiscordPromptTime,
} from "./prompt-context";
import { runAgentTurn } from "./agent-turn-runner";
import type { SessionRegistry } from "./session-registry";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const logger = createModuleLogger("discord-message-handler");

function buildDiscordPromptContent(
  message: Message,
  scope: string,
  content: string,
  config: ResolvedDiscordGatewayConfig,
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

export async function handleDiscordMessage(
  message: Message,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
): Promise<void> {
  if (message.author.bot) {
    logger.debug("ignored bot message");
    return;
  }

  if (message.system) {
    logger.debug({ messageId: message.id }, "ignored system message");
    return;
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
    return;
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
    return;
  }

  let content = message.content.trim();
  const textAttachments = await readTextAttachments(message);
  if (textAttachments.length > 0) {
    const attachmentSuffix = textAttachments
      .map((attachment) => {
        return `\n\n--- Attachment: ${attachment.filename} ---\n${attachment.content}`;
      })
      .join("");
    content = content
      ? content + attachmentSuffix
      : textAttachments[0]!.content;
  }

  const mediaAttachments = await readMediaAttachments(message);
  if (!content && mediaAttachments.length === 0) {
    logger.debug(
      { messageId: message.id },
      "ignored empty message (no text or images)",
    );
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

  const channelKey = message.channel.id;
  if (message.channel.isSendable()) {
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

  const commandResult = await executeSessionCommand(content, {
    agentService,
    promptQueue,
    session,
    workingEmoji: entry.workingEmoji,
  });

  if (commandResult.handled) {
    stopTypingForChannel(channelKey);

    if (commandResult.workingEmoji) {
      entry.workingEmoji = commandResult.workingEmoji;
      logger.info(
        { scope, emoji: commandResult.workingEmoji },
        "working emoji updated",
      );
    }

    if (commandResult.archive && scope.startsWith("thread:")) {
      logger.info({ scope }, "archiving thread");
      const archiveChannel = message.channel;
      if (archiveChannel.isSendable()) {
        await archiveChannel.send(
          `\`\`\`\n${commandResult.response ?? "Archiving..."}\n\`\`\``,
        );
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
      `command handled: ${content}`,
    );

    if (commandResult.response) {
      await sendCommandReply(message, commandResult.response);
    }

    return;
  }

  if (!message.channel.isSendable()) {
    stopTypingForChannel(channelKey);
    logger.debug({ messageId: message.id }, "channel not sendable");
    return;
  }

  await addWorkingReaction(message, entry.workingEmoji);

  const queuePosition = promptQueue.getSnapshot().pending;
  if (queuePosition > 0) {
    await sendReply(
      message,
      `Queued. ${queuePosition} request(s) ahead of this one.`,
    );
  }

  let response: string;
  try {
    response = await promptQueue.enqueue(async () => {
      let promptContent = content;
      let promptImages: ImageContent[] | undefined;

      if (mediaAttachments.length > 0) {
        const resolvedPromptMedia = await resolveMediaAttachmentsForPrompt(
          mediaAttachments,
          promptContent,
          session.model,
          config,
          agentService,
        );
        promptContent = resolvedPromptMedia.content;
        if (resolvedPromptMedia.images.length > 0) {
          promptImages = resolvedPromptMedia.images;
        }
      }

      const wrappedContent = buildDiscordPromptContent(
        message,
        scope,
        promptContent,
        config,
      );
      const transformedPrompt = await config.promptTransform(wrappedContent);
      return runAgentTurn(session, transformedPrompt, {
        images: promptImages,
      });
    });
  } finally {
    stopTypingForChannel(channelKey);
    await removeWorkingReaction(message, entry.workingEmoji);
  }

  await sendReply(message, response);
}
