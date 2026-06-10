import { Events, type Client } from "discord.js";
import type { AgentService } from "./agent-service";
import { createDiscordClient, loginDiscordClient } from "./discord-client";
import { handleDiscordMessage } from "./discord-message-handler";
import { sendReply } from "./discord-replies";
import { createModuleLogger } from "./logger";
import type { SessionRegistry, SessionScope } from "./session-registry";
import type { TaskSchedulerService } from "./task-scheduler-service";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const logger = createModuleLogger("discord-gateway");

export async function startGatewayClient(
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
  taskScheduler?: TaskSchedulerService | null,
): Promise<Client> {
  const client = createDiscordClient(config, accessConfig);

  client.on(Events.MessageCreate, async (message) => {
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

  client.on(Events.ThreadDelete, async (thread) => {
    const scope: SessionScope = `thread:${thread.id}`;
    logger.info({ threadId: thread.id, scope }, "thread deleted");
    await sessionRegistry.remove(scope);
  });

  await loginDiscordClient(client, config);
  return client;
}
