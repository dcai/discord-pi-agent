import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TaskSchedulerService } from "./task-scheduler-service";
import type {
  ResolvedDiscordGatewayConfig,
  ResolvedTaskSchedulerConfig,
  ScheduledTaskDefinition,
} from "./types";
import type { SessionRegistry } from "./session-registry";
import type { ScheduledJobDeliveryService } from "./scheduled-job-delivery";

const { runAgentTurnMock } = vi.hoisted(() => {
  return {
    runAgentTurnMock: vi.fn(),
  };
});

vi.mock("./agent-turn-runner", () => {
  return {
    runAgentTurn: runAgentTurnMock,
  };
});

function createConfig(
  overrides: Partial<ResolvedDiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  return {
    discordBotToken: "token",
    discordAllowedUserId: "user-1",
    cwd: "/repo",
    agentDir: "/repo/.pi-agent",
    modelProvider: "openrouter",
    modelId: "model-1",
    thinkingLevel: "medium",
    promptTimeZone: "UTC",
    promptLocale: "en-AU",
    promptTransform: async (ctx) => ctx.rawContent,
    startupMessage: false,
    shutdownOnSignals: true,
    visionModelId: null,
    discordAllowedForumChannelIds: [],
    discordAllowedUserIds: ["user-1"],
    ...overrides,
  };
}

function createSchedulerConfig(
  overrides: Partial<ResolvedTaskSchedulerConfig> = {},
): ResolvedTaskSchedulerConfig {
  return {
    jobsFile: "/repo/scheduled-jobs.ts",
    ...overrides,
  };
}

function createSessionRegistry(): {
  registry: SessionRegistry;
  getOrCreateMock: ReturnType<typeof vi.fn>;
  enqueueMock: ReturnType<typeof vi.fn>;
} {
  const enqueueMock = vi.fn(async (task: () => Promise<string>) => {
    return task();
  });
  const getOrCreateMock = vi.fn(async () => {
    return {
      created: true,
      entry: {
        session: { sessionId: "session-1" },
        promptQueue: {
          enqueue: enqueueMock,
        },
      },
    };
  });

  return {
    registry: {
      getOrCreate: getOrCreateMock,
    } as unknown as SessionRegistry,
    getOrCreateMock,
    enqueueMock,
  };
}

function createDeliveryService(): {
  deliveryService: ScheduledJobDeliveryService;
  deliverResultMock: ReturnType<typeof vi.fn>;
  deliverErrorMock: ReturnType<typeof vi.fn>;
} {
  const deliverResultMock = vi.fn(async () => undefined);
  const deliverErrorMock = vi.fn(async () => undefined);

  return {
    deliveryService: {
      deliverResult: deliverResultMock,
      deliverError: deliverErrorMock,
    } as unknown as ScheduledJobDeliveryService,
    deliverResultMock,
    deliverErrorMock,
  };
}

function createService(jobs: ScheduledTaskDefinition[]) {
  const { registry, getOrCreateMock, enqueueMock } = createSessionRegistry();
  const { deliveryService, deliverResultMock, deliverErrorMock } =
    createDeliveryService();
  const service = new TaskSchedulerService({
    config: createConfig(),
    schedulerConfig: createSchedulerConfig(),
    jobs,
    sessionRegistry: registry,
    deliveryService,
  });

  return {
    service,
    getOrCreateMock,
    enqueueMock,
    deliverResultMock,
    deliverErrorMock,
  };
}

describe("TaskSchedulerService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:04:30.000Z"));
    vi.clearAllMocks();
    runAgentTurnMock.mockResolvedValue("scheduled reply");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs every-minutes jobs on the next matching minute", async () => {
    const { service, getOrCreateMock, deliverResultMock } = createService([
      {
        id: "heartbeat",
        prompt: "Ping the world",
        schedule: { type: "every-minutes", interval: 5 },
      },
    ]);

    service.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getOrCreateMock).toHaveBeenCalledWith("job:heartbeat", {
      reuseExisting: false,
    });
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.anything(),
      "Ping the world",
    );
    expect(deliverResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "heartbeat" }),
      "scheduled reply",
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
  });

  it("runs daily-at jobs with scope reuse", async () => {
    vi.setSystemTime(new Date("2026-01-01T08:59:30.000Z"));

    const { service, getOrCreateMock, deliverResultMock } = createService([
      {
        id: "daily-summary",
        prompt: "Write the summary",
        schedule: {
          type: "daily-at",
          hour: 9,
          minute: 0,
          timeZone: "UTC",
        },
        session: {
          strategy: "scope",
          scope: "dm",
        },
        reuseSession: true,
      },
    ]);

    service.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getOrCreateMock).toHaveBeenCalledWith("dm", {
      reuseExisting: true,
    });
    expect(deliverResultMock).toHaveBeenCalledOnce();
  });

  it("surfaces delivery errors when job execution fails", async () => {
    runAgentTurnMock.mockRejectedValue(new Error("boom"));
    const { service, deliverErrorMock } = createService([
      {
        id: "broken-job",
        prompt: "Break",
        schedule: { type: "every-minutes", interval: 5 },
      },
    ]);

    service.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(deliverErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "broken-job" }),
      expect.any(Error),
    );
  });

  it("lists jobs with runtime state and reloads definitions", async () => {
    const { service } = createService([
      {
        id: "daily-summary",
        prompt: "Write the summary",
        description: "Daily update",
        schedule: {
          type: "daily-at",
          hour: 9,
          minute: 0,
          timeZone: "UTC",
        },
        result: {
          target: "logs",
        },
      },
    ]);

    const scheduledJobLoader = await import("./scheduled-job-loader");
    const loadScheduledJobsSpy = vi
      .spyOn(scheduledJobLoader, "loadScheduledJobs")
      .mockResolvedValue([
        {
          id: "heartbeat",
          prompt: "Ping",
          schedule: {
            type: "every-minutes",
            interval: 15,
          },
        },
      ]);

    expect(service.getJob("daily-summary")).toEqual({
      id: "daily-summary",
      description: "Daily update",
      schedule: {
        type: "daily-at",
        hour: 9,
        minute: 0,
        timeZone: "UTC",
      },
      session: undefined,
      reuseSession: false,
      result: {
        target: "logs",
      },
      nextRunAt: "2026-01-01T09:00:00.000Z",
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      running: false,
    });

    await expect(service.reload()).resolves.toEqual({
      jobsFile: "/repo/scheduled-jobs.ts",
      jobCount: 1,
      nextTickAt: null,
      running: false,
    });
    expect(loadScheduledJobsSpy).toHaveBeenCalledWith({
      jobsFile: "/repo/scheduled-jobs.ts",
    });
    expect(service.listJobs()).toEqual([
      {
        id: "heartbeat",
        description: undefined,
        schedule: {
          type: "every-minutes",
          interval: 15,
        },
        session: undefined,
        reuseSession: false,
        result: undefined,
        nextRunAt: "2026-01-01T00:15:00.000Z",
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        running: false,
      },
    ]);
  });
});
