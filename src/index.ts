import type { Client } from "discord.js";
import { AgentService } from "./agent-service";
import { resolveConfig } from "./config";
import { startDiscordClient } from "./discord-client";
import { PromptQueue } from "./prompt-queue";
import type {
  DiscordPiBridge,
  DiscordPiBridgeConfig,
  ResolvedDiscordPiBridgeConfig,
} from "./types";

export {
  buildTimeContextPrompt,
  type TimeContextPromptOptions,
} from "./prompt-context";
export { loadDiscordPiBridgeConfigFromEnv, resolveConfig } from "./config";
export type {
  AgentStatus,
  DiscordPiBridge,
  DiscordPiBridgeConfig,
  PromptTransform,
  ResolvedDiscordPiBridgeConfig,
} from "./types";

export async function startDiscordPiBridge(
  config: DiscordPiBridgeConfig,
): Promise<DiscordPiBridge> {
  const resolvedConfig = resolveConfig(config);
  const agentService = new AgentService(resolvedConfig);
  const promptQueue = new PromptQueue();

  console.log("[boot] initializing persistent agent session");
  await agentService.initialize();
  console.log("[boot] agent ready", agentService.getStatus());

  const client = await startDiscordClient(
    resolvedConfig,
    agentService,
    promptQueue,
  );
  const stop = createStopHandler(client, agentService, resolvedConfig);

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
