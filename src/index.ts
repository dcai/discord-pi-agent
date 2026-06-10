import type { Client } from "discord.js";
import { AgentService } from "./agent-service";
import { resolveConfig } from "./config";
import { createDiscordClient, loginDiscordClient } from "./discord-client";
import { startGatewayClient } from "./discord-gateway-client";
import { createModuleLogger } from "./logger";
import {
  loadScheduledJobs,
  resolveTaskSchedulerConfig,
} from "./scheduled-job-loader";
import { ScheduledJobDeliveryService } from "./scheduled-job-delivery";
import { SessionRegistry } from "./session-registry";
import { TaskSchedulerService } from "./task-scheduler-service";
import type {
  DiscordGateway,
  DiscordGatewayConfig,
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
  StartDiscordGatewayOptions,
  TaskScheduler,
  TaskSchedulerConfig,
  TaskSchedulerStatus,
} from "./types";

const logger = createModuleLogger("index");

export { formatDiscordPromptTime } from "./prompt-context";
export { loadDiscordGatewayConfigFromEnv, resolveConfig } from "./config";
export { loadScheduledJobs, resolveTaskSchedulerConfig } from "./scheduled-job-loader";
export type {
  AgentStatus,
  DiscordGateway,
  DiscordGatewayConfig,
  DailyAtTaskSchedule,
  EveryMinutesTaskSchedule,
  ScheduledTaskDefinition,
  PromptTransform,
  PromptTransformContext,
  ResolvedDiscordGatewayConfig,
  GatewayAccessConfig,
  StartDiscordGatewayOptions,
  TaskResultTarget,
  TaskSchedule,
  TaskScheduler,
  TaskSchedulerConfig,
  TaskSchedulerStatus,
  TaskSessionTarget,
} from "./types";

/**
 * Start the unified Discord gateway. Supports DM and forum thread sessions
 * out of the box. Set discordAllowedForumChannelIds to enable forum support.
 */
export async function startDiscordGateway(
  config: DiscordGatewayConfig,
  options: StartDiscordGatewayOptions = {},
): Promise<DiscordGateway> {
  const runtime = await startRuntime(config, {
    enableGatewayHandlers: true,
    schedulerConfig: options.scheduler,
  });

  if (runtime.config.shutdownOnSignals) {
    registerSignalHandlers(runtime.stop);
  }

  return {
    client: runtime.client!,
    stop: runtime.stop,
    getStatus: () => {
      return runtime.agentService.getStatus();
    },
    getTaskSchedulerStatus: () => {
      return runtime.taskScheduler?.getStatus() ?? null;
    },
  };
}

export async function startTaskScheduler(
  config: DiscordGatewayConfig,
  schedulerConfig: TaskSchedulerConfig,
): Promise<TaskScheduler> {
  const runtime = await startRuntime(config, {
    enableGatewayHandlers: false,
    schedulerConfig,
  });

  if (!runtime.taskScheduler) {
    throw new Error("Task scheduler failed to initialize.");
  }

  if (runtime.config.shutdownOnSignals) {
    registerSignalHandlers(runtime.stop);
  }

  return {
    client: runtime.client,
    stop: runtime.stop,
    getAgentStatus: () => {
      return runtime.agentService.getStatus();
    },
    getTaskSchedulerStatus: () => {
      return runtime.taskScheduler!.getStatus();
    },
  };
}

async function startRuntime(
  config: DiscordGatewayConfig,
  options: {
    enableGatewayHandlers: boolean;
    schedulerConfig?: TaskSchedulerConfig;
  },
): Promise<{
  agentService: AgentService;
  client: Client | null;
  config: ResolvedDiscordGatewayConfig;
  stop: () => Promise<void>;
  taskScheduler: TaskSchedulerService | null;
}> {
  const resolvedConfig = resolveConfig(config);
  const agentService = new AgentService(resolvedConfig);

  logger.info("initializing agent service");
  await agentService.initialize();
  logger.info(agentService.getStatus(), "agent ready");

  const accessConfig = createGatewayAccessConfig(resolvedConfig);
  const sessionRegistry = new SessionRegistry(agentService);
  const taskScheduler = options.schedulerConfig
    ? await createTaskScheduler(
        resolvedConfig,
        options.schedulerConfig,
        sessionRegistry,
      )
    : null;

  let client: Client | null = null;

  if (options.enableGatewayHandlers) {
    client = await startGatewayClient(
      resolvedConfig,
      agentService,
      sessionRegistry,
      accessConfig,
      taskScheduler,
    );
  } else if (taskScheduler?.usesDiscordDelivery()) {
    client = createDiscordClient(resolvedConfig, accessConfig);
    await loginDiscordClient(client, resolvedConfig);
  }

  if (taskScheduler) {
    replaceTaskSchedulerDeliveryClient(taskScheduler, client);
    taskScheduler.start();
  }

  const stop = createGatewayStopHandler(
    client,
    agentService,
    sessionRegistry,
    resolvedConfig,
    taskScheduler,
  );

  return {
    agentService,
    client,
    config: resolvedConfig,
    stop,
    taskScheduler,
  };
}

function createGatewayAccessConfig(
  config: ResolvedDiscordGatewayConfig,
): GatewayAccessConfig {
  return {
    discordAllowedUserId: config.discordAllowedUserId,
    discordAllowedForumChannelIds: config.discordAllowedForumChannelIds,
    discordAllowedUserIds: config.discordAllowedUserIds,
    startupMessage: config.startupMessage,
  };
}

async function createTaskScheduler(
  config: ResolvedDiscordGatewayConfig,
  schedulerConfig: TaskSchedulerConfig,
  sessionRegistry: SessionRegistry,
): Promise<TaskSchedulerService> {
  const resolvedSchedulerConfig = resolveTaskSchedulerConfig(
    schedulerConfig,
    config.cwd,
  );
  const jobs = await loadScheduledJobs(resolvedSchedulerConfig);

  return new TaskSchedulerService({
    config,
    schedulerConfig: resolvedSchedulerConfig,
    jobs,
    sessionRegistry,
    deliveryService: new ScheduledJobDeliveryService(null),
  });
}

function replaceTaskSchedulerDeliveryClient(
  taskScheduler: TaskSchedulerService,
  client: Client | null,
): void {
  taskScheduler.setDeliveryService(new ScheduledJobDeliveryService(client));
}

function createGatewayStopHandler(
  client: Client | null,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  config: ResolvedDiscordGatewayConfig,
  taskScheduler: TaskSchedulerService | null,
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
    taskScheduler?.stop();
    client?.destroy();
    await sessionRegistry.shutdownAll();
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
