import type { SendableChannels } from "discord.js";
import { createModuleLogger } from "./logger";

const logger = createModuleLogger("discord-typing");

const TYPING_INTERVAL_MS = 9000;

const typingIntervals = new Map<
  string,
  { interval: NodeJS.Timeout; refs: number }
>();

export async function sendTypingSafe(
  channel: SendableChannels,
  channelKey: string,
): Promise<void> {
  try {
    const token = channel.client.token;
    const url = `https://discord.com/api/v10/channels/${channel.id}/typing`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
    });

    if (response.ok) {
      // logger.debug("[TYPING] STATUS UPDATED OK");
      return;
    }

    if (response.status === 429) {
      const body = await response.text();
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
        { channelKey, retryMs, response: body },
        `[TYPING] 429, retrying after ${retryMs}ms delay`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bot ${token}` },
      });
      logger.warn({ channelKey }, "[TYPING] retry done");
      return;
    }

    logger.warn(
      { channelKey, status: response.status },
      "[TYPING] unexpected status",
    );
  } catch (error: unknown) {
    logger.error({ channelKey, error }, "[TYPING] FAILED");
  }
}

export function startTypingForChannel(
  channel: SendableChannels,
  channelKey: string,
): void {
  const existing = typingIntervals.get(channelKey);
  if (existing) {
    existing.refs += 1;
    // logger.debug(
    //   { channelKey, refs: existing.refs },
    //   "[TYPING] ref++ (reusing existing interval)",
    // );
    return;
  }

  logger.debug("[TYPING] started new interval");
  void sendTypingSafe(channel, channelKey);

  const interval = setInterval(() => {
    void sendTypingSafe(channel, channelKey);
  }, TYPING_INTERVAL_MS);

  typingIntervals.set(channelKey, { interval, refs: 1 });
}

export function stopTypingForChannel(channelKey: string): void {
  const entry = typingIntervals.get(channelKey);
  if (!entry) {
    // logger.debug({ channelKey }, "[TYPING] stop called but no entry found");
    return;
  }

  entry.refs -= 1;
  if (entry.refs <= 0) {
    clearInterval(entry.interval);
    typingIntervals.delete(channelKey);
    // logger.debug("[TYPING] interval cleared (refs hit 0)");
    return;
  }

  // logger.debug("[TYPING] ref-- (interval still active)");
}
