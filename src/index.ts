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
  CommandUsageOptions,
  DiscordGateway,
  DiscordGatewayConfig,
  ResolvedDiscordGatewayConfig,
  StartDiscordGatewayOptions,
  StartTaskSchedulerOptions,
  TaskScheduler,
  TaskSchedulerConfig,
  TaskSchedulerStatus,
} from "./types";

const logger = createModuleLogger("index");

export { formatDiscordPromptTime } from "./prompt-context";
export { loadDiscordGatewayConfigFromEnv, resolveConfig } from "./config";
export {
  loadScheduledJobs,
  resolveTaskSchedulerConfig,
} from "./scheduled-job-loader";
export type {
  AgentStatus,
  AudioTranscriptionConfig,
  CommandUsageEvent,
  CommandUsageOptions,
  CommandUsageOutcome,
  CommandUsageSurface,
  CommandRegistrationScope,
  DiscordGateway,
  DiscordGatewayConfig,
  DailyAtTaskSchedule,
  EveryMinutesTaskSchedule,
  ScheduledTaskDefinition,
  PromptTransform,
  PromptTransformContext,
  ResolvedDiscordGatewayConfig,
  GatewayAccessConfig,
  LoadScheduleJobs,
  ReplyReflectionConfig,
  ResolvedReplyReflectionConfig,
  ScheduledJobsContext,
  StartDiscordGatewayOptions,
  StartTaskSchedulerOptions,
  TaskResultTarget,
  TaskSchedule,
  TaskScheduleDayOfWeek,
  TaskScheduler,
  TaskSchedulerConfig,
  TaskSchedulerStatus,
  TaskSessionScope,
  TaskSessionStrategy,
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
    commandUsage: options.commandUsage,
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
  options: StartTaskSchedulerOptions = {},
): Promise<TaskScheduler> {
  const runtime = await startRuntime(config, {
    enableGatewayHandlers: false,
    schedulerConfig,
    commandUsage: options.commandUsage,
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
    commandUsage?: CommandUsageOptions;
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

  const sessionRegistry = new SessionRegistry(agentService);
  let client: Client | null = null;
  const taskScheduler = options.schedulerConfig
    ? await createTaskScheduler(
        resolvedConfig,
        options.schedulerConfig,
        agentService,
        sessionRegistry,
        new ScheduledJobDeliveryService(() => {
          return client;
        }),
        options.commandUsage,
      )
    : null;

  if (options.enableGatewayHandlers) {
    if (options.commandUsage) {
      client = await startGatewayClient(
        resolvedConfig,
        agentService,
        sessionRegistry,
        resolvedConfig,
        taskScheduler,
        options.commandUsage,
      );
    } else {
      client = await startGatewayClient(
        resolvedConfig,
        agentService,
        sessionRegistry,
        resolvedConfig,
        taskScheduler,
      );
    }
  } else if (taskScheduler?.usesDiscordDelivery()) {
    client = createDiscordClient(resolvedConfig, resolvedConfig);
    await loginDiscordClient(client, resolvedConfig);
  }

  if (taskScheduler) {
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

async function createTaskScheduler(
  config: ResolvedDiscordGatewayConfig,
  schedulerConfig: TaskSchedulerConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  deliveryService: ScheduledJobDeliveryService,
  commandUsage?: CommandUsageOptions,
): Promise<TaskSchedulerService> {
  const resolvedSchedulerConfig = resolveTaskSchedulerConfig(
    schedulerConfig,
    config.cwd,
  );
  const jobs = await loadScheduledJobs(resolvedSchedulerConfig, {
    config,
    schedulerConfig: resolvedSchedulerConfig,
  });

  return new TaskSchedulerService({
    config,
    schedulerConfig: resolvedSchedulerConfig,
    jobs,
    agentService,
    sessionRegistry,
    deliveryService,
    commandUsage,
  });
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

    let cleanupError: unknown = null;

    try {
      await taskScheduler?.stop();
    } catch (error) {
      cleanupError ??= error;
      logger.error({ error }, "task scheduler shutdown failed");
    }

    try {
      client?.destroy();
    } catch (error) {
      cleanupError ??= error;
      logger.error({ error }, "discord client shutdown failed");
    }

    try {
      await sessionRegistry.shutdownAll();
    } catch (error) {
      cleanupError ??= error;
      logger.error({ error }, "session registry shutdown failed");
    }

    try {
      await agentService.shutdown();
    } catch (error) {
      cleanupError ??= error;
      logger.error({ error }, "agent service shutdown failed");
    }

    if (cleanupError) {
      throw cleanupError;
    }
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
