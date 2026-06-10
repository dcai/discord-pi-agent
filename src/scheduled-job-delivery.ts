import type { Client, TextBasedChannel } from "discord.js";
import { chunkMessage } from "./message-chunker";
import { createModuleLogger } from "./logger";
import type { ScheduledTaskDefinition, TaskResultTarget } from "./types";

const logger = createModuleLogger("scheduled-job-delivery");

export class ScheduledJobDeliveryService {
  private readonly client: Client | null;

  constructor(client: Client | null) {
    this.client = client;
  }

  async deliverResult(
    job: ScheduledTaskDefinition,
    text: string,
  ): Promise<void> {
    const resultTarget = job.result ?? { target: "logs" as const };
    const message = `## Scheduled job: ${job.id}\n\n${text}`;

    if (resultTarget.target === "logs") {
      logger.info({ jobId: job.id, text }, "scheduled job result");
      return;
    }

    const client = this.requireClient(resultTarget);

    if (resultTarget.target === "discord-dm") {
      const user = await client.users.fetch(resultTarget.userId);
      const dmChannel = await user.createDM();
      await sendChunkedText(dmChannel, message);
      return;
    }

    const channel = await client.channels.fetch(resultTarget.channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(
        `Configured result channel is not text-based for scheduled job ${job.id}.`,
      );
    }

    await sendChunkedText(channel, message);
  }

  async deliverError(job: ScheduledTaskDefinition, error: unknown): Promise<void> {
    const message = `Job failed: ${stringifyError(error)}`;
    logger.error({ error, jobId: job.id }, "scheduled job failed");
    await this.deliverResult(job, message);
  }

  private requireClient(target: Exclude<TaskResultTarget, { target: "logs" }>): Client {
    if (!this.client) {
      throw new Error(
        `Scheduled job delivery target ${target.target} requires a Discord client.`,
      );
    }

    return this.client;
  }
}

async function sendChunkedText(
  channel: TextBasedChannel,
  text: string,
): Promise<void> {
  const chunks = chunkMessage(text);
  const sendableChannel = channel as TextBasedChannel & {
    send: (value: string) => Promise<unknown>;
  };

  for (const chunk of chunks) {
    await sendableChannel.send(chunk);
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
