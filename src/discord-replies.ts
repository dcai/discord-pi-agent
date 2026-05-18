import type { Message } from "discord.js";
import { createModuleLogger } from "./logger";
import { chunkMessage } from "./message-chunker";

const logger = createModuleLogger("discord-replies");

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
