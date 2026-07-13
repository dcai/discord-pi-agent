import type { Message } from "discord.js";
import { createModuleLogger } from "./logger";
import { chunkMessage } from "./message-chunker";

const logger = createModuleLogger("discord-replies");

const DISCORD_MESSAGE_LIMIT = 2000;
const FENCE_OVERHEAD = 8; // \`\`\`\n + \n\`\`\`
const MAX_CODE_FENCE_CONTENT = DISCORD_MESSAGE_LIMIT - FENCE_OVERHEAD;

/**
 * Splits plain text by newlines into chunks that fit within maxSize.
 * Keeps lines intact unless a single line exceeds maxSize.
 *
 * Unlike chunkMessage (markdown-aware, token-level), this is for
 * raw text without markdown structure (e.g. command output).
 */
function splitPlainTextIntoChunks(text: string, maxSize: number): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? current + "\n" + line : line;
    if (candidate.length > maxSize) {
      if (current) {
        chunks.push(current);
        current = line;
      } else {
        // A single line exceeds maxSize; split it mid-line.
        chunks.push(line.slice(0, maxSize));
        current = line.slice(maxSize);
      }
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export const DEFAULT_WORKING_EMOJI = "⚙️";

export function formatCommandReplyChunks(text: string): string[] {
  return splitPlainTextIntoChunks(text, MAX_CODE_FENCE_CONTENT).map((chunk) => {
    return `\`\`\`\n${chunk}\n\`\`\``;
  });
}

function normalizeEmoji(value: string): string {
  return value.normalize("NFKC").replace(/\uFE0F/g, "");
}

function findReactionByEmoji(message: Message, emoji: string) {
  const directMatch = message.reactions.cache.get(emoji);
  if (directMatch) {
    return directMatch;
  }

  const normalizedEmoji = normalizeEmoji(emoji);
  const normalizedMatch = Array.from(message.reactions.cache.entries()).find(
    ([key, reaction]) => {
      if (normalizeEmoji(String(key)) === normalizedEmoji) {
        return true;
      }

      if (typeof reaction.emoji?.name === "string") {
        return normalizeEmoji(reaction.emoji.name) === normalizedEmoji;
      }

      return false;
    },
  )?.[1];

  if (!normalizedMatch) {
    logger.debug(
      {
        messageId: message.id,
        emoji,
        normalizedEmoji,
        reactionKeys: Array.from(message.reactions.cache.keys()),
      },
      "reaction not found in cache",
    );
  }

  return normalizedMatch;
}

export async function addReaction(
  message: Message,
  emoji: string,
): Promise<void> {
  try {
    await message.react(emoji);
  } catch (error) {
    logger.debug(
      { messageId: message.id, emoji, error },
      "failed to add reaction",
    );
  }
}

export async function removeReaction(
  message: Message,
  emoji: string,
): Promise<void> {
  try {
    const reaction = findReactionByEmoji(message, emoji);
    if (reaction) {
      await reaction.users.remove(message.client.user!);
    }
  } catch (error) {
    logger.debug(
      { messageId: message.id, emoji, error },
      "failed to remove reaction",
    );
  }
}

export async function addWorkingReaction(
  message: Message,
  emoji: string = DEFAULT_WORKING_EMOJI,
): Promise<void> {
  await addReaction(message, emoji);
}

export async function removeWorkingReaction(
  message: Message,
  emoji: string = DEFAULT_WORKING_EMOJI,
): Promise<void> {
  await removeReaction(message, emoji);
}

export async function sendReply(message: Message, text: string): Promise<void> {
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
    throw error;
  }
}

export async function sendFollowUp(
  message: Message,
  text: string,
): Promise<void> {
  const channel = message.channel;
  if (!channel.isSendable()) {
    logger.debug(
      {
        messageId: message.id,
      },
      "follow-up skipped, channel not sendable",
    );
    return;
  }

  const chunks = chunkMessage(text);

  if (chunks.length === 0) {
    return;
  }

  try {
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  } catch (error) {
    logger.error(
      {
        messageId: message.id,
        error,
      },
      "send follow-up failed",
    );
    throw error;
  }
}

/**
 * Sends a command response wrapped in triple backticks.
 * Splits by newlines so each chunk stays within Discord's 2000-char limit.
 */
export async function sendCommandReply(
  message: Message,
  text: string,
): Promise<void> {
  const channel = message.channel;
  if (!channel.isSendable()) {
    logger.debug(
      {
        messageId: message.id,
      },
      "command reply skipped, channel not sendable",
    );
    return;
  }

  const chunks = formatCommandReplyChunks(text);
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
      "send command reply failed",
    );
    throw error;
  }
}
