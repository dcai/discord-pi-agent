import { Events, type Client } from "discord.js";
import type { AgentService } from "./agent-service";
import { createDiscordClient, loginDiscordClient } from "./discord-client";
import {
  handleDiscordInteraction,
  syncDiscordApplicationCommands,
} from "./discord-interactions";
import {
  handleDiscordMessage,
  handleForumPostEdit,
} from "./discord-message-handler";
import { sendReply } from "./discord-replies";
import { createModuleLogger } from "./logger";
import type { SessionRegistry, SessionScope } from "./session-registry";
import type { TaskSchedulerService } from "./task-scheduler-service";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const logger = createModuleLogger("discord-gateway");

type GatewayMessageLogInput = {
  type?: unknown;
  content?: string | null;
  partial?: boolean;
};

type RawGatewayEventInput = {
  t?: unknown;
  s?: unknown;
  op?: unknown;
  d?: unknown;
};

function shortenMessageForLog(
  content: string | null | undefined,
  maxLength = 120,
): string {
  const normalized = (content ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty)";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function logGatewayMessageSummary(
  eventName: "message create" | "message update",
  message: GatewayMessageLogInput,
): void {
  logger.info(
    {
      eventName,
      messageType: String(message.type ?? "unknown"),
      partial: message.partial ?? false,
      preview: shortenMessageForLog(message.content),
    },
    `${eventName} received`,
  );
}

function isRawGatewayEventLoggingEnabled(): boolean {
  const value = process.env.DISCORD_PI_AGENT_LOG_RAW_EVENTS;

  return value === "1" || value === "true";
}

function getRawGatewayEventData(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getRawGatewayEventStringField(
  data: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = data?.[key];

  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value;
}

function logRawGatewayEventSummary(packet: RawGatewayEventInput): void {
  const data = getRawGatewayEventData(packet.d);
  const preview =
    getRawGatewayEventStringField(data, "content") ??
    getRawGatewayEventStringField(data, "name") ??
    getRawGatewayEventStringField(data, "topic");

  logger.info(
    {
      eventType: typeof packet.t === "string" ? packet.t : "unknown",
      opcode: packet.op,
      sequence: packet.s,
      id: getRawGatewayEventStringField(data, "id"),
      channelId: getRawGatewayEventStringField(data, "channel_id"),
      guildId: getRawGatewayEventStringField(data, "guild_id"),
      preview: preview ? shortenMessageForLog(preview) : undefined,
    },
    "raw gateway event",
  );
}

function maybeAttachRawGatewayEventLogger(client: Client): void {
  if (!isRawGatewayEventLoggingEnabled()) {
    return;
  }

  client.on(Events.Raw, (packet) => {
    logRawGatewayEventSummary(packet as RawGatewayEventInput);
  });
}

export async function startGatewayClient(
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
  taskScheduler?: TaskSchedulerService | null,
): Promise<Client> {
  const client = createDiscordClient(config, accessConfig);
  maybeAttachRawGatewayEventLogger(client);

  client.once(Events.ClientReady, async (readyClient) => {
    try {
      await syncDiscordApplicationCommands(readyClient, config);
    } catch (error) {
      logger.error({ error }, "application command sync failed");
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    logGatewayMessageSummary("message create", message);

    try {
      await handleDiscordMessage(
        message,
        config,
        agentService,
        sessionRegistry,
        accessConfig,
        taskScheduler,
      );
    } catch (error) {
      logger.error({ error, direction: "IN" }, "message handling failed");
      await sendReply(
        message,
        "The bot hit an error while handling that message.",
      );
    }
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    logGatewayMessageSummary("message update", newMessage);

    try {
      await handleForumPostEdit(
        oldMessage,
        newMessage,
        config,
        agentService,
        sessionRegistry,
        accessConfig,
      );
    } catch (error) {
      logger.error({ error }, "message update handling failed");
    }
  });

  client.on(Events.ThreadDelete, async (thread) => {
    const scope: SessionScope = `thread:${thread.id}`;
    logger.info({ threadId: thread.id, scope }, "thread deleted");
    await sessionRegistry.remove(scope);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleDiscordInteraction(
        interaction,
        config,
        agentService,
        sessionRegistry,
        accessConfig,
        taskScheduler,
      );
    } catch (error) {
      logger.error({ error }, "interaction handling failed");
    }
  });

  await loginDiscordClient(client, config);
  return client;
}
