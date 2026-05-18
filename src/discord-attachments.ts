import type { Message } from "discord.js";
import { createModuleLogger } from "./logger";

const logger = createModuleLogger("discord-attachments");

const TEXT_ATTACHMENT_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".log",
  ".yml",
  ".yaml",
  ".xml",
  ".toml",
  ".ini",
  ".cfg",
];

const MAX_TEXT_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

const MEDIA_ATTACHMENT_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls",
];

const MAX_MEDIA_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

const OFFICE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export type TextAttachmentContent = {
  filename: string;
  content: string;
};

export type MediaAttachmentContent = {
  filename: string;
  data: string;
  mimeType: string;
};

export function isSupportedTextAttachment(attachment: {
  name: string | null;
}): boolean {
  const ext = attachment.name
    ?.slice(attachment.name.lastIndexOf("."))
    .toLowerCase();

  return Boolean(ext && TEXT_ATTACHMENT_EXTENSIONS.includes(ext));
}

export function isSupportedMediaAttachment(attachment: {
  name: string | null;
  contentType: string | null;
}): boolean {
  const ext = attachment.name
    ?.slice(attachment.name.lastIndexOf("."))
    .toLowerCase();
  if (!ext || !MEDIA_ATTACHMENT_EXTENSIONS.includes(ext)) {
    return false;
  }

  const contentType = attachment.contentType;
  if (!contentType) {
    return false;
  }

  return contentType.startsWith("image/") || OFFICE_MIME_TYPES.has(contentType);
}

export async function readTextAttachments(
  message: Message,
): Promise<TextAttachmentContent[]> {
  const attachments = message.attachments;
  if (attachments.size === 0) {
    return [];
  }

  const results: TextAttachmentContent[] = [];

  for (const [, attachment] of attachments) {
    if (!isSupportedTextAttachment(attachment)) {
      logger.debug(
        { messageId: message.id, filename: attachment.name },
        "skipping non-text attachment",
      );
      continue;
    }

    if (attachment.size > MAX_TEXT_ATTACHMENT_SIZE_BYTES) {
      logger.warn(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
        },
        "attachment too large, skipping",
      );
      continue;
    }

    try {
      logger.info(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
        },
        "fetching attachment",
      );
      const response = await fetch(attachment.url);
      if (!response.ok) {
        logger.warn(
          {
            messageId: message.id,
            filename: attachment.name,
            status: response.status,
          },
          "failed to fetch attachment",
        );
        continue;
      }

      const content = await response.text();
      results.push({ filename: attachment.name, content });
    } catch (error) {
      logger.error(
        { messageId: message.id, filename: attachment.name, error },
        "error fetching attachment",
      );
    }
  }

  return results;
}

export async function readMediaAttachments(
  message: Message,
): Promise<MediaAttachmentContent[]> {
  const attachments = message.attachments;
  if (attachments.size === 0) {
    return [];
  }

  const results: MediaAttachmentContent[] = [];

  for (const [, attachment] of attachments) {
    if (!isSupportedMediaAttachment(attachment)) {
      continue;
    }

    if (attachment.size > MAX_MEDIA_ATTACHMENT_SIZE_BYTES) {
      logger.warn(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
        },
        "media attachment too large, skipping",
      );
      continue;
    }

    try {
      logger.info(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
        },
        "fetching media attachment",
      );
      const response = await fetch(attachment.url);
      if (!response.ok) {
        logger.warn(
          {
            messageId: message.id,
            filename: attachment.name,
            status: response.status,
          },
          "failed to fetch media attachment",
        );
        continue;
      }

      const buffer = await response.arrayBuffer();
      results.push({
        filename: attachment.name,
        data: Buffer.from(buffer).toString("base64"),
        mimeType: attachment.contentType ?? "application/octet-stream",
      });
    } catch (error) {
      logger.error(
        { messageId: message.id, filename: attachment.name, error },
        "error fetching media attachment",
      );
    }
  }

  return results;
}
