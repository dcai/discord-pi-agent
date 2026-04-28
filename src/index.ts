import type { Client } from "discord.js";
import { AgentService } from "./agent-service";
import { resolveConfig, resolveGatewayConfig } from "./config";
import { startDiscordClient } from "./discord-client";
import { startGatewayClient } from "./discord-gateway-client";
import type { GatewayAuthConfig } from "./discord-gateway-client";
import { PromptQueue } from "./prompt-queue";
import { SessionRegistry } from "./session-registry";
import type {
  DiscordGateway,
  DiscordGatewayConfig,
  DiscordPiBridge,
  DiscordPiBridgeConfig,
  ResolvedDiscordPiBridgeConfig,
} from "./types";

export {
  buildTimeContextPrompt,
  type TimeContextPromptOptions,
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

  console.log("[gateway] initializing agent service");
  await agentService.initialize();
  console.log("[gateway] agent ready", agentService.getStatus());

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
    console.log("[shutdown] stopping discord gateway", {
      cwd: config.cwd,
      agentDir: config.agentDir,
    });
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
    console.log("[shutdown] stopping discord pi bridge", {
      cwd: config.cwd,
      agentDir: config.agentDir,
    });
    client.destroy();
    await agentService.shutdown();
  };
}

function registerSignalHandlers(stop: () => Promise<void>): void {
  const handleSignal = (signal: NodeJS.Signals) => {
    console.log(`[shutdown] received ${signal}`);
    void stop().finally(() => {
      console.log("[shutdown] done");
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
