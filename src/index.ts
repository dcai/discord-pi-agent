import type { Client } from "discord.js";
import { AgentService } from "./agent-service";
import { resolveConfig, resolveGatewayConfig } from "./config";
import { startDiscordClient } from "./discord-client";
import { startGatewayClient } from "./discord-gateway-client";
import type { GatewayAuthConfig } from "./discord-gateway-client";
import { createModuleLogger } from "./logger";
import { PromptQueue } from "./prompt-queue";
import { SessionRegistry } from "./session-registry";
import type {
  DiscordGateway,
  DiscordGatewayConfig,
  DiscordPiBridge,
  DiscordPiBridgeConfig,
  ResolvedDiscordPiBridgeConfig,
} from "./types";

const logger = createModuleLogger("index");

export {
  buildDiscordMessageContextPrompt,
  formatDiscordPromptTime,
  type DiscordMessageContextPromptOptions,
  type DiscordPromptScope,
  type DiscordPromptTimeFormatOptions,
} from "./prompt-context";
export {
  loadDiscordPiBridgeConfigFromEnv,
  loadDiscordGatewayConfigFromEnv,
  resolveConfig,
} from "./config";
export type {
  AgentStatus,
  DiscordGateway,
  DiscordGatewayConfig,
  DiscordPiBridge,
  DiscordPiBridgeConfig,
  PromptTransform,
  ResolvedDiscordPiBridgeConfig,
} from "./types";

/**
 * Start the unified Discord gateway. Supports DM and forum thread sessions
 * out of the box. Set discordAllowedForumChannelIds to enable forum support.
 */
export async function startDiscordGateway(
  config: DiscordGatewayConfig,
): Promise<DiscordGateway> {
  const resolvedConfig = resolveGatewayConfig(config);
  const agentService = new AgentService(resolvedConfig);

  logger.info("initializing agent service");
  await agentService.initialize();
  logger.info(agentService.getStatus(), "agent ready");

  const authConfig: GatewayAuthConfig = {
    discordAllowedUserId: resolvedConfig.discordAllowedUserId,
    discordAllowedForumChannelIds: resolvedConfig.discordAllowedForumChannelIds,
    discordAllowedUserIds: resolvedConfig.discordAllowedUserIds,
    startupMessage: resolvedConfig.startupMessage,
  };

  const sessionRegistry = new SessionRegistry(agentService);

  const client = await startGatewayClient(
    resolvedConfig,
    agentService,
    sessionRegistry,
    authConfig,
  );

  const stop = createGatewayStopHandler(
    client,
    agentService,
    sessionRegistry,
    resolvedConfig,
  );

  if (resolvedConfig.shutdownOnSignals) {
    registerSignalHandlers(stop);
  }

  return {
    client,
    stop,
    getStatus: () => {
      return agentService.getStatus();
    },
  };
}

/**
 * Legacy DM-only entry point. Now a thin wrapper over startDiscordGateway.
 */
export async function startDiscordPiBridge(
  config: DiscordPiBridgeConfig,
): Promise<DiscordPiBridge> {
  return startDiscordGateway(config);
}

function createGatewayStopHandler(
  client: Client,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  config: ResolvedDiscordPiBridgeConfig,
): () => Promise<void> {
  let stopped = false;

  return async () => {
    if (stopped) {
      return;
    }

    stopped = true;
    logger.info(
      {
        cwd: config.cwd,
        agentDir: config.agentDir,
      },
      "stopping discord gateway",
    );
    client.destroy();
    await sessionRegistry.shutdownAll();
    await agentService.shutdown();
  };
}

function createStopHandler(
  client: Client,
  agentService: AgentService,
  config: ResolvedDiscordPiBridgeConfig,
): () => Promise<void> {
  let stopped = false;

  return async () => {
    if (stopped) {
      return;
    }

    stopped = true;
    logger.info(
      {
        cwd: config.cwd,
        agentDir: config.agentDir,
      },
      "stopping discord pi bridge",
    );
    client.destroy();
    await agentService.shutdown();
  };
}

function registerSignalHandlers(stop: () => Promise<void>): void {
  const handleSignal = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "received signal");
    void stop().finally(() => {
      logger.info("done");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => {
    handleSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    handleSignal("SIGTERM");
  });
}
