import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TaskSchedulerService } from "./task-scheduler-service";
import type { AgentService } from "./agent-service";
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

function createAgentService(): {
  agentService: AgentService;
  createTemporarySessionMock: ReturnType<typeof vi.fn>;
  ensureSessionHasConfiguredModelMock: ReturnType<typeof vi.fn>;
  tempSession: {
    sessionId: string;
    dispose: ReturnType<typeof vi.fn>;
  };
} {
  const tempSession = {
    sessionId: "temp-session-1",
    dispose: vi.fn(),
  };
  const createTemporarySessionMock = vi.fn(async () => tempSession);
  const ensureSessionHasConfiguredModelMock = vi.fn(async () => undefined);

  return {
    agentService: {
      createTemporarySession: createTemporarySessionMock,
      models: {
        ensureSessionHasConfiguredModel: ensureSessionHasConfiguredModelMock,
      },
    } as unknown as AgentService,
    createTemporarySessionMock,
    ensureSessionHasConfiguredModelMock,
    tempSession,
  };
}

function createService(jobs: ScheduledTaskDefinition[]) {
  const { registry, getOrCreateMock, enqueueMock } = createSessionRegistry();
  const { deliveryService, deliverResultMock, deliverErrorMock } =
    createDeliveryService();
  const {
    agentService,
    createTemporarySessionMock,
    ensureSessionHasConfiguredModelMock,
    tempSession,
  } = createAgentService();
  const service = new TaskSchedulerService({
    config: createConfig(),
    schedulerConfig: createSchedulerConfig(),
    jobs,
    agentService,
    sessionRegistry: registry,
    deliveryService,
  });

  return {
    service,
    getOrCreateMock,
    enqueueMock,
    deliverResultMock,
    deliverErrorMock,
    createTemporarySessionMock,
    ensureSessionHasConfiguredModelMock,
    tempSession,
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
          strategy: "reuse",
          scope: "dm",
        },
      },
    ]);

    service.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getOrCreateMock).toHaveBeenCalledWith("dm", {
      reuseExisting: true,
    });
    expect(deliverResultMock).toHaveBeenCalledOnce();
  });

  it("runs ephemeral jobs in a temporary in-memory session", async () => {
    const {
      service,
      getOrCreateMock,
      deliverResultMock,
      createTemporarySessionMock,
      ensureSessionHasConfiguredModelMock,
      tempSession,
    } = createService([
      {
        id: "ephemeral-summary",
        prompt: "Write a one-shot summary",
        schedule: { type: "every-minutes", interval: 5 },
        session: {
          strategy: "ephemeral",
        },
      },
    ]);

    service.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getOrCreateMock).not.toHaveBeenCalled();
    expect(createTemporarySessionMock).toHaveBeenCalledWith({
      thinkingLevel: "medium",
    });
    expect(ensureSessionHasConfiguredModelMock).toHaveBeenCalledWith(
      tempSession,
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      tempSession,
      "Write a one-shot summary",
    );
    expect(tempSession.dispose).toHaveBeenCalledOnce();
    expect(deliverResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ephemeral-summary" }),
      "scheduled reply",
    );
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

  it("runs a job immediately on demand", async () => {
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
        result: {
          target: "discord-dm",
          userId: "user-1",
        },
      },
    ]);

    await expect(service.runJobNow("daily-summary")).resolves.toEqual({
      ok: true,
      errorMessage: null,
    });

    expect(getOrCreateMock).toHaveBeenCalledWith("job:daily-summary", {
      reuseExisting: false,
    });
    expect(deliverResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "daily-summary",
        result: {
          target: "discord-dm",
          userId: "user-1",
        },
      }),
      "scheduled reply",
    );
    expect(service.getJob("daily-summary")).toEqual(
      expect.objectContaining({
        lastRunAt: "2026-01-01T00:04:30.000Z",
        lastSuccessAt: "2026-01-01T00:04:30.000Z",
        lastErrorAt: null,
        lastErrorMessage: null,
        running: false,
      }),
    );
  });

  it("can override the result target for a manual run", async () => {
    const { service, deliverResultMock } = createService([
      {
        id: "daily-summary",
        prompt: "Write the summary",
        schedule: {
          type: "daily-at",
          hour: 9,
          minute: 0,
          timeZone: "UTC",
        },
        result: {
          target: "discord-dm",
          userId: "user-1",
        },
      },
    ]);

    await service.runJobNow("daily-summary", {
      resultOverride: {
        target: "discord-channel",
        channelId: "channel-123",
      },
    });

    expect(deliverResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "daily-summary",
        result: {
          target: "discord-channel",
          channelId: "channel-123",
        },
      }),
      "scheduled reply",
    );
    expect(service.getJob("daily-summary")).toEqual(
      expect.objectContaining({
        result: {
          target: "discord-dm",
          userId: "user-1",
        },
      }),
    );
  });

  it("rejects a manual run when the job is already running", async () => {
    let releaseRun: (() => void) | null = null;
    runAgentTurnMock.mockImplementation(
      async () =>
        await new Promise<string>((resolve) => {
          releaseRun = () => {
            resolve("scheduled reply");
          };
        }),
    );

    const { service } = createService([
      {
        id: "daily-summary",
        prompt: "Write the summary",
        schedule: {
          type: "daily-at",
          hour: 9,
          minute: 0,
          timeZone: "UTC",
        },
      },
    ]);

    const firstRun = service.runJobNow("daily-summary");
    await Promise.resolve();

    await expect(service.runJobNow("daily-summary")).rejects.toThrow(
      "Scheduled job is already running: daily-summary",
    );

    releaseRun?.();
    await firstRun;
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
      prompt: "Write the summary",
      description: "Daily update",
      source: "file",
      schedule: {
        type: "daily-at",
        hour: 9,
        minute: 0,
        timeZone: "UTC",
      },
      session: undefined,
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
        prompt: "Ping",
        description: undefined,
        source: "file",
        schedule: {
          type: "every-minutes",
          interval: 15,
        },
        session: undefined,
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

  it("adds a runtime reminder, lists it, and forgets it after the run", async () => {
    const { service, getOrCreateMock, deliverResultMock } = createService([]);

    expect(
      service.addRuntimeReminder({
        id: "reminder-aapl",
        prompt: "Check AAPL share price",
        runAt: "2026-01-01T00:05:00.000Z",
        description: "AAPL reminder",
        result: {
          target: "discord-channel",
          channelId: "channel-1",
        },
      }),
    ).toEqual({
      id: "reminder-aapl",
      prompt: "Check AAPL share price",
      description: "AAPL reminder",
      source: "runtime",
      schedule: {
        type: "run-at",
        runAt: "2026-01-01T00:05:00.000Z",
      },
      session: undefined,
      result: {
        target: "discord-channel",
        channelId: "channel-1",
      },
      nextRunAt: "2026-01-01T00:05:00.000Z",
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      running: false,
    });

    expect(service.listJobs()).toEqual([
      expect.objectContaining({
        id: "reminder-aapl",
        source: "runtime",
      }),
    ]);

    service.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getOrCreateMock).toHaveBeenCalledWith("job:reminder-aapl", {
      reuseExisting: false,
    });
    expect(deliverResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reminder-aapl", source: "runtime" }),
      "scheduled reply",
    );
    expect(service.listJobs()).toEqual([]);
    expect(service.getStatus()).toEqual({
      jobsFile: "/repo/scheduled-jobs.ts",
      jobCount: 0,
      nextTickAt: "2026-01-01T00:06:00.000Z",
      running: true,
    });
  });
});
