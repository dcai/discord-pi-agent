import type { Message } from "discord.js";
import { createModuleLogger } from "./logger";
import { chunkMessage } from "./message-chunker";

const logger = createModuleLogger("discord-replies");

const DISCORD_MESSAGE_LIMIT = 2000;
const FENCE_OVERHEAD = 8; // \`\`\`\n + \n\`\`\`
const MAX_CODE_FENCE_CONTENT = DISCORD_MESSAGE_LIMIT - FENCE_OVERHEAD;

/**
 * Splits text by newlines into chunks that fit within maxSize.
 * Keeps lines intact unless a single line exceeds maxSize.
 */
function chunkByLines(text: string, maxSize: number): string[] {
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

const WORKING_EMOJI = "\u2699\uFE0F";

export async function addWorkingReaction(message: Message): Promise<void> {
  try {
    await message.react(WORKING_EMOJI);
  } catch (error) {
    logger.debug(
      { messageId: message.id, error },
      "failed to add working reaction",
    );
  }
}

export async function removeWorkingReaction(message: Message): Promise<void> {
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

  const chunks = chunkByLines(text, MAX_CODE_FENCE_CONTENT).map(
    (c) => `\`\`\`\n${c}\n\`\`\``,
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
      "send command reply failed",
    );
  }
}
