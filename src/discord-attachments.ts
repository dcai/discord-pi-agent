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

const AUDIO_EXTENSIONS = [".ogg", ".mp3", ".wav", ".flac", ".m4a", ".webm"];

const MAX_AUDIO_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_FETCH_TIMEOUT_MS = 30_000;

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

export type AudioAttachmentContent = {
  filename: string;
  data: Buffer;
  mimeType: string;
  /** Duration in seconds, available for Discord voice messages. */
  durationSecs: number | null;
};

type FetchedAttachment = {
  response: Response;
  bytes: Uint8Array;
};

async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        totalBytes += result.value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error(`attachment response exceeds ${maxBytes} bytes`);
        }

        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  if (typeof response.arrayBuffer === "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`attachment response exceeds ${maxBytes} bytes`);
    }
    return bytes;
  }

  if (typeof response.text === "function") {
    const bytes = new TextEncoder().encode(await response.text());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`attachment response exceeds ${maxBytes} bytes`);
    }
    return bytes;
  }

  throw new Error("attachment response has no readable body");
}

async function fetchAttachment(
  url: string,
  maxBytes: number,
): Promise<FetchedAttachment> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, ATTACHMENT_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { response, bytes: new Uint8Array() };
    }

    const declaredSize = response.headers?.get("content-length");
    const declaredSizeBytes = declaredSize ? Number(declaredSize) : NaN;
    if (Number.isFinite(declaredSizeBytes) && declaredSizeBytes > maxBytes) {
      throw new Error(`attachment response exceeds ${maxBytes} bytes`);
    }

    return {
      response,
      bytes: await readResponseBytes(response, maxBytes),
    };
  } finally {
    clearTimeout(timeout);
  }
}

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
      const { response, bytes } = await fetchAttachment(
        attachment.url,
        MAX_TEXT_ATTACHMENT_SIZE_BYTES,
      );
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

      const content = new TextDecoder().decode(bytes);
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

export function isSupportedAudioAttachment(attachment: {
  name: string | null;
  contentType: string | null;
}): boolean {
  const contentType = attachment.contentType;
  if (!contentType) {
    return false;
  }

  if (!contentType.startsWith("audio/")) {
    return false;
  }

  const ext = attachment.name
    ?.slice(attachment.name.lastIndexOf("."))
    .toLowerCase();

  return Boolean(ext && AUDIO_EXTENSIONS.includes(ext));
}

export async function readAudioAttachments(
  message: Message,
): Promise<AudioAttachmentContent[]> {
  const attachments = message.attachments;
  if (attachments.size === 0) {
    return [];
  }

  const results: AudioAttachmentContent[] = [];

  for (const [, attachment] of attachments) {
    if (!isSupportedAudioAttachment(attachment)) {
      continue;
    }

    if (attachment.size > MAX_AUDIO_ATTACHMENT_SIZE_BYTES) {
      logger.warn(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
        },
        "audio attachment too large, skipping",
      );
      continue;
    }

    try {
      logger.info(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
          duration: attachment.duration,
        },
        "fetching audio attachment",
      );
      const { response, bytes } = await fetchAttachment(
        attachment.url,
        MAX_AUDIO_ATTACHMENT_SIZE_BYTES,
      );
      if (!response.ok) {
        logger.warn(
          {
            messageId: message.id,
            filename: attachment.name,
            status: response.status,
          },
          "failed to fetch audio attachment",
        );
        continue;
      }

      const buffer = Buffer.from(bytes);
      results.push({
        filename: attachment.name,
        data: buffer,
        mimeType: attachment.contentType ?? "audio/ogg",
        durationSecs: attachment.duration ?? null,
      });
    } catch (error) {
      logger.error(
        { messageId: message.id, filename: attachment.name, error },
        "error fetching audio attachment",
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
      const { response, bytes } = await fetchAttachment(
        attachment.url,
        MAX_MEDIA_ATTACHMENT_SIZE_BYTES,
      );
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

      results.push({
        filename: attachment.name,
        data: Buffer.from(bytes).toString("base64"),
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
