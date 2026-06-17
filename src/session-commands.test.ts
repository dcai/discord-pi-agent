import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSessionCommand } from "./session-commands";
import type { AgentService } from "./agent-service";
import type { PromptQueue } from "./prompt-queue";
import type { SessionScope } from "./session-registry";
import type { TaskSchedulerService } from "./task-scheduler-service";
import type { TaskJobRuntimeState, TaskSchedulerStatus } from "./types";
import type { AgentSession, ToolInfo } from "@earendil-works/pi-coding-agent";

const DM_SCOPE: SessionScope = "dm";

const { parseReminderCommandMock } = vi.hoisted(() => {
  return {
    parseReminderCommandMock: vi.fn(),
  };
});

vi.mock("./reminder-command-parser", () => {
  return {
    parseReminderCommand: parseReminderCommandMock,
  };
});

function createPromptQueueMock(
  overrides: Partial<PromptQueue> = {},
): PromptQueue {
  return {
    getSnapshot: () => ({ pending: 0, busy: false }),
    getCancellationCount: () => 0,
    enqueue: vi.fn(async (task: () => Promise<string>) => {
      return task();
    }),
    cancelPending: vi.fn(() => 0),
    markAbort: vi.fn(),
    ...overrides,
  } as unknown as PromptQueue;
}

function createSessionMock(
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    sessionId: "session-1",
    sessionFile: "/tmp/session-1.jsonl",
    isStreaming: false,
    model: { provider: "openrouter", id: "model-1" },
    getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
    supportsThinking: () => true,
    thinkingLevel: "medium",
    getAvailableThinkingLevels: () => ["low", "medium", "high"],
    setThinkingLevel: vi.fn(),
    getAllTools: () => [],
    compact: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as AgentSession;
}

function createAgentServiceMock(
  session: AgentSession | null,
  overrides: Partial<AgentService> = {},
): AgentService {
  return {
    getSession: () => session,
    getAgentDir: () => "/tmp/.pi-agent",
    resources: {
      getExtensionsSummary: () => "Extensions: (none loaded)",
      getSkillsSummary: () => "Skills: (none loaded)",
      reloadResources: vi.fn().mockResolvedValue("Resources reloaded."),
    },
    models: {
      getCurrentModelDisplay: () => "openrouter/model-1",
      listModels: vi
        .fn()
        .mockResolvedValue("Available models (1):\n  openrouter/model-1"),
      switchModel: vi.fn().mockResolvedValue("Switched."),
      getThinkingLevel: (currentSession: AgentSession) => ({
        current: currentSession.thinkingLevel,
        available: currentSession.getAvailableThinkingLevels(),
        supported: currentSession.supportsThinking(),
      }),
      setThinkingLevel: (currentSession: AgentSession, level: string) => {
        currentSession.setThinkingLevel(level as never);
        return `Thinking level set to "${level}".`;
      },
    },
    createSession: vi
      .fn()
      .mockResolvedValue(createSessionMock({ sessionId: "new-session" })),
    createTemporarySession: vi
      .fn()
      .mockResolvedValue(createSessionMock({ sessionId: "temp-session" })),
    ...overrides,
  } as unknown as AgentService;
}

function createTaskSchedulerMock(
  overrides: Partial<TaskSchedulerService> = {},
): TaskSchedulerService {
  return {
    getStatus: () => ({
      jobsFile: "/tmp/scheduled-jobs.ts",
      jobCount: 1,
      nextTickAt: "2026-01-01T00:05:00.000Z",
      running: true,
    }),
    listJobs: () => [
      {
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
        model: undefined,
        effectiveModel: {
          provider: "openrouter",
          id: "model-1",
        },
        result: {
          target: "discord-dm",
          userId: "user-1",
        },
        nextRunAt: "2026-01-01T09:00:00.000Z",
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        running: false,
      },
    ],
    getJob: (jobId: string) => {
      if (jobId !== "daily-summary") {
        return null;
      }

      return {
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
        model: undefined,
        effectiveModel: {
          provider: "openrouter",
          id: "model-1",
        },
        result: {
          target: "discord-dm",
          userId: "user-1",
        },
        nextRunAt: "2026-01-01T09:00:00.000Z",
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        running: false,
      };
    },
    reload: vi.fn().mockResolvedValue({
      jobsFile: "/tmp/scheduled-jobs.ts",
      jobCount: 2,
      nextTickAt: "2026-01-01T00:05:00.000Z",
      running: true,
    }),
    runJobNow: vi.fn().mockResolvedValue({
      ok: true,
      errorMessage: null,
    }),
    addRuntimeReminder: vi.fn((input) => {
      return {
        id: input.id,
        prompt: input.prompt,
        description: input.description,
        source: "runtime",
        schedule: {
          type: "run-at",
          runAt: input.runAt,
        },
        session: undefined,
        model: undefined,
        effectiveModel: {
          provider: "openrouter",
          id: "model-1",
        },
        result: input.result,
        nextRunAt: input.runAt,
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        running: false,
      };
    }),
    ...overrides,
  } as unknown as TaskSchedulerService;
}

beforeEach(() => {
  vi.clearAllMocks();
  parseReminderCommandMock.mockResolvedValue({
    runAt: "2026-01-02T04:00:00.000Z",
    prompt: "Check what AAPL's latest share price is.",
    description: "AAPL reminder",
  });
});

describe("executeSessionCommand", () => {
  it("returns handled false for non-command input", async () => {
    const result = await executeSessionCommand("hello", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({ handled: false });
  });

  it("returns no active session for commands that require a session", async () => {
    const result = await executeSessionCommand("!status", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: "No active session.",
    });
  });

  it("accepts configurable prefixes and uses the primary prefix in responses", async () => {
    const helpResult = await executeSessionCommand(";help", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      commandPrefixes: [";", "!"],
    });

    expect(helpResult.response).toContain(";help - show this message");

    const unknownResult = await executeSessionCommand(";wat", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      commandPrefixes: [";", "!"],
    });

    expect(unknownResult.response).toBe("Unknown command: ;wat. Try ;help.");
  });

  it("shows help and includes archive only for thread sessions", async () => {
    const dmResult = await executeSessionCommand("!help", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(dmResult.response).not.toContain("!archive - archive this thread");

    const threadResult = await executeSessionCommand("!help", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      session: createSessionMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(threadResult).toEqual({
      handled: true,
      response: expect.stringContaining(
        "!archive - archive this thread and end the session",
      ),
    });
    expect(dmResult.response).toContain("!jobs - list loaded scheduled jobs");
    expect(dmResult.response).toContain(
      "!job <id> - run one scheduled job in this conversation",
    );
    expect(dmResult.response).toContain(
      "!job info <id> - show one scheduled job",
    );
    expect(dmResult.response).toContain(
      "!job run <id> - run one scheduled job now (configured target)",
    );
    expect(dmResult.response).toContain(
      "!job run-here <id> - run one scheduled job now in this conversation",
    );
    expect(dmResult.response).toContain(
      "!job update <what you want changed> - edit the jobs file via the agent",
    );
    expect(dmResult.response).toContain(
      "!jobs reload - reload scheduled jobs from the jobs file",
    );
    expect(dmResult.response).toContain(
      "!remind <when>, <task> - create a one-off runtime reminder",
    );
  });

  it("shows status including queue, tools, skills, and extensions", async () => {
    const tool: ToolInfo = { name: "bash" } as ToolInfo;
    const session = createSessionMock({ getAllTools: () => [tool] });
    const promptQueue = createPromptQueueMock({
      getSnapshot: () => ({ pending: 2, busy: true }),
    });

    const result = await executeSessionCommand("!status", {
      agentService: createAgentServiceMock(session),
      promptQueue,
      session,
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: [
        "model: openrouter/model-1",
        "session-id: session-1",
        "session-file: /tmp/session-1.jsonl",
        "streaming: false",
        "thinking: medium (available: low, medium, high)",
        "context: 100/1000 (10%)",
        "queue-pending: 2",
        "queue-busy: true",
        "",
        "Tools (1): bash",
        "",
        "Skills: (none loaded)",
        "",
        "Extensions: (none loaded)",
      ].join("\n"),
    });
  });

  it("shows thinking info when no level is passed", async () => {
    const session = createSessionMock();
    const result = await executeSessionCommand("!thinking", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: [
        "Current: medium",
        "Available: low, medium, high",
        "Usage: !thinking <level>",
      ].join("\n"),
    });
  });

  it("reports when the current model does not support thinking", async () => {
    const session = createSessionMock({ supportsThinking: () => false });
    const agentService = createAgentServiceMock(session);
    agentService.models.getThinkingLevel = () => {
      return {
        current: "off",
        available: [],
        supported: false,
      };
    };

    const result = await executeSessionCommand("!thinking", {
      agentService,
      promptQueue: createPromptQueueMock(),
      session,
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: "Current model does not support reasoning/thinking.",
    });
  });

  it("sets the requested thinking level when valid", async () => {
    const setThinkingLevel = vi.fn();
    const session = createSessionMock({ setThinkingLevel });

    const result = await executeSessionCommand("!thinking high", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(setThinkingLevel).toHaveBeenCalledWith("high");
    expect(result).toEqual({
      handled: true,
      response: 'Thinking level set to "high".',
    });
  });

  it("shows current model and available models", async () => {
    const session = createSessionMock();
    const agentService = createAgentServiceMock(session);

    const result = await executeSessionCommand("!model", {
      agentService,
      promptQueue: createPromptQueueMock(),
      session,
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response:
        "Current model: openrouter/model-1\n\nAvailable models (1):\n  openrouter/model-1",
    });
  });

  it("shows usage help for invalid model syntax", async () => {
    const session = createSessionMock();

    const result = await executeSessionCommand("!model openrouter", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response:
        "Usage: !model <provider/modelId>\n" +
        "Example: !model openrouter/anthropic/claude-sonnet-4\n" +
        "Use !model without args to see available models.",
    });
  });

  it("switches models when provider and model id are passed", async () => {
    const session = createSessionMock();
    const agentService = createAgentServiceMock(session);

    const result = await executeSessionCommand(
      "!model openrouter/google/gemini-2.5-flash",
      {
        agentService,
        promptQueue: createPromptQueueMock(),
        session,
        taskScheduler: createTaskSchedulerMock(),
        scope: DM_SCOPE,
        workingEmoji: "⚙️",
      },
    );

    expect(agentService.models.switchModel).toHaveBeenCalledWith(
      "openrouter",
      "google/gemini-2.5-flash",
      session,
    );
    expect(result).toEqual({ handled: true, response: "Switched." });
  });

  it("archives threads only when thread session exists", async () => {
    const dmResult = await executeSessionCommand("!archive", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(dmResult).toEqual({
      handled: true,
      response: "!archive is only available in forum threads.",
    });

    const session = createSessionMock();
    const threadResult = await executeSessionCommand("!archive", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(threadResult).toEqual({
      handled: true,
      archive: true,
      response: "Archiving thread and shutting down session.",
    });
  });

  it("enqueues compaction and reload work", async () => {
    const session = createSessionMock();
    const promptQueue = createPromptQueueMock();
    const agentService = createAgentServiceMock(session);

    const compactResult = await executeSessionCommand("!compact", {
      agentService,
      promptQueue,
      session,
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });
    const reloadResult = await executeSessionCommand("!reload", {
      agentService,
      promptQueue,
      session,
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(promptQueue.enqueue).toHaveBeenCalledTimes(2);
    expect(session.compact).toHaveBeenCalled();
    expect(agentService.resources.reloadResources).toHaveBeenCalled();
    expect(compactResult).toEqual({
      handled: true,
      response: "Compaction finished for session session-1.",
    });
    expect(reloadResult).toEqual({
      handled: true,
      response: "Resources reloaded.",
    });
  });

  it("aborts active work and clears queued prompts", async () => {
    const session = createSessionMock();
    const promptQueue = createPromptQueueMock({
      getSnapshot: () => ({ pending: 2, busy: true }),
      cancelPending: vi.fn(() => 2),
      markAbort: vi.fn(),
    });

    const result = await executeSessionCommand("!abort", {
      agentService: createAgentServiceMock(session),
      promptQueue,
      session,
      taskScheduler: createTaskSchedulerMock(),
      scope: "thread:123" as SessionScope,
      workingEmoji: "⚙️",
    });

    expect(promptQueue.markAbort).toHaveBeenCalledTimes(1);
    expect(promptQueue.cancelPending).toHaveBeenCalledTimes(1);
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      handled: true,
      response: "Aborted the active run and cleared 2 queued request(s).",
    });
  });

  it("reports when nothing is running or queued to abort", async () => {
    const session = createSessionMock();
    const promptQueue = createPromptQueueMock({
      getSnapshot: () => ({ pending: 0, busy: false }),
      cancelPending: vi.fn(() => 0),
      markAbort: vi.fn(),
    });

    const result = await executeSessionCommand("!abort", {
      agentService: createAgentServiceMock(session),
      promptQueue,
      session,
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      handled: true,
      response: "Nothing was running or queued.",
    });
  });

  it("returns unknown command help for unsupported commands", async () => {
    const result = await executeSessionCommand("!wat", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: "Unknown command: !wat. Try !help.",
    });
  });

  it("lists scheduled jobs from runtime state", async () => {
    const result = await executeSessionCommand("!jobs", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: expect.stringContaining("- daily-summary"),
    });
    expect(result.response).toContain("prompt: Write the summary");
    expect(result.response).toContain("source: file");
    expect(result.response).toContain("schedule: daily at 09:00 (UTC)");
    expect(result.response).toContain("model: default (openrouter/model-1)");
    expect(result.response).toContain("target: discord-dm:user-1");
    expect(result.response).toContain("session-mode: fresh");
  });

  it("shows daysOfWeek in scheduled job formatting", async () => {
    const taskScheduler = createTaskSchedulerMock({
      listJobs: () => [
        {
          id: "weekday-summary",
          prompt: "Write the summary",
          description: "Weekday update",
          source: "file",
          schedule: {
            type: "daily-at",
            hour: 9,
            minute: 0,
            timeZone: "UTC",
            daysOfWeek: ["mon", "tue", "wed", "thu", "fri"],
          },
          session: undefined,
          model: undefined,
          effectiveModel: {
            provider: "openrouter",
            id: "model-1",
          },
          result: {
            target: "logs",
          },
          nextRunAt: "2026-01-02T09:00:00.000Z",
          lastRunAt: null,
          lastSuccessAt: null,
          lastErrorAt: null,
          lastErrorMessage: null,
          running: false,
        },
      ],
    });

    const result = await executeSessionCommand("!jobs", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler,
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result.response).toContain(
      "schedule: daily at 09:00 (UTC) on Mon, Tue, Wed, Thu, Fri",
    );
  });

  it("shows one scheduled job from runtime state via !job info", async () => {
    const result = await executeSessionCommand("!job info daily-summary", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: expect.stringContaining("id: daily-summary"),
    });
    expect(result.response).toContain("description: Daily update");
    expect(result.response).toContain("prompt:\n  Write the summary");
    expect(result.response).toContain("source: file");
    expect(result.response).toContain("model: default (openrouter/model-1)");
    expect(result.response).toContain("next-run-at: 2026-01-01T09:00:00.000Z");
    expect(result.response).toContain("session-mode: fresh");
  });

  it("runs a scheduled job immediately with its configured target", async () => {
    const taskScheduler = createTaskSchedulerMock();

    const result = await executeSessionCommand("!job run daily-summary", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler,
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      channelId: "channel-123",
    });

    expect(taskScheduler.runJobNow).toHaveBeenCalledWith("daily-summary", {
      resultOverride: undefined,
    });
    expect(result).toEqual({
      handled: true,
      response: expect.stringContaining(
        "Manual job run finished: daily-summary",
      ),
    });
    expect(result.response).toContain("status: success");
    expect(result.response).toContain("delivery-target: discord-dm:user-1");
    expect(result.response).toContain("next-run-at: 2026-01-01T09:00:00.000Z");
  });

  it("runs a scheduled job immediately in the current conversation", async () => {
    const taskScheduler = createTaskSchedulerMock();

    const result = await executeSessionCommand("!job run-here daily-summary", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler,
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      channelId: "channel-123",
    });

    expect(taskScheduler.runJobNow).toHaveBeenCalledWith("daily-summary", {
      resultOverride: {
        target: "discord-channel",
        channelId: "channel-123",
      },
    });
    expect(result).toEqual({
      handled: true,
      response: expect.stringContaining(
        "Manual job run here finished: daily-summary",
      ),
    });
    expect(result.response).toContain(
      "delivery-target: discord-channel:channel-123",
    );
    expect(result.response).toContain("configured-target: discord-dm:user-1");
    expect(result.response).toContain(
      "target-resolution: current DM via message.channel.id -> discord-channel:channel-123",
    );
  });

  it("runs a job here when no subcommand is given", async () => {
    const taskScheduler = createTaskSchedulerMock();

    const result = await executeSessionCommand("!job daily-summary", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler,
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      channelId: "channel-123",
    });

    expect(taskScheduler.runJobNow).toHaveBeenCalledWith("daily-summary", {
      resultOverride: {
        target: "discord-channel",
        channelId: "channel-123",
      },
    });
    expect(result).toEqual({
      handled: true,
      response: expect.stringContaining(
        "Manual job run here finished: daily-summary",
      ),
    });
    expect(result.response).toContain("status: success");
    expect(result.response).toContain(
      "delivery-target: discord-channel:channel-123",
    );
    expect(result.response).toContain("configured-target: discord-dm:user-1");
    expect(result.response).toContain(
      "target-resolution: current DM via message.channel.id -> discord-channel:channel-123",
    );
  });

  it("shows usage when !job run or !job run-here is missing an id", async () => {
    const runResult = await executeSessionCommand("!job run", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      channelId: "channel-123",
    });
    const runHereResult = await executeSessionCommand("!job run-here", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      channelId: "channel-123",
    });

    expect(runResult).toEqual({
      handled: true,
      response: "Usage: !job run <id>",
    });
    expect(runHereResult).toEqual({
      handled: true,
      response: "Usage: !job run-here <id>",
    });
  });

  it("requires a Discord channel context for !job run-here", async () => {
    const result = await executeSessionCommand("!job run-here daily-summary", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: "This command requires a Discord channel context.",
    });
  });

  it("requires a Discord channel context for !job <id> (implicit run-here)", async () => {
    const result = await executeSessionCommand("!job daily-summary", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: "This command requires a Discord channel context.",
    });
  });

  it("creates a runtime reminder from natural language", async () => {
    const taskScheduler = createTaskSchedulerMock({
      listJobs: () => {
        return [];
      },
    });

    const result = await executeSessionCommand(
      "!remind tomorrow 14:00, check what is aapl's latest share price",
      {
        agentService: createAgentServiceMock(createSessionMock()),
        promptQueue: createPromptQueueMock(),
        taskScheduler,
        scope: DM_SCOPE,
        workingEmoji: "⚙️",
        channelId: "channel-123",
        promptTimeZone: "Australia/Sydney",
        promptLocale: "en-AU",
      },
    );

    expect(parseReminderCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "tomorrow 14:00, check what is aapl's latest share price",
        timeZone: "Australia/Sydney",
        locale: "en-AU",
      }),
    );
    expect(taskScheduler.addRuntimeReminder).toHaveBeenCalledWith({
      id: "reminder-202601020400-check-what-aapl-s-latest",
      prompt: "Check what AAPL's latest share price is.",
      runAt: "2026-01-02T04:00:00.000Z",
      description: "AAPL reminder",
      result: {
        target: "discord-channel",
        channelId: "channel-123",
      },
    });
    expect(result).toEqual({
      handled: true,
      response: [
        "Reminder created: reminder-202601020400-check-what-aapl-s-latest",
        "run-at: 2026-01-02T04:00:00.000Z",
        "source: runtime",
        "target: discord-channel:channel-123",
        "target-resolution: current DM via message.channel.id -> discord-channel:channel-123",
        "session-mode: fresh",
      ].join("\n"),
    });
  });

  it("notes how thread reminders resolve their result target", async () => {
    const taskScheduler = createTaskSchedulerMock({
      listJobs: () => {
        return [];
      },
    });

    const result = await executeSessionCommand("!remind tomorrow 14:00", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler,
      scope: "thread:thread-123",
      workingEmoji: "⚙️",
      channelId: "thread-123",
    });

    expect(result).toEqual({
      handled: true,
      response: [
        "Reminder created: reminder-202601020400-check-what-aapl-s-latest",
        "run-at: 2026-01-02T04:00:00.000Z",
        "source: runtime",
        "target: discord-channel:thread-123",
        "target-resolution: current thread via message.channel.id -> discord-channel:thread-123",
        "session-mode: fresh",
      ].join("\n"),
    });
  });

  it("shows usage when !remind has no request", async () => {
    const result = await executeSessionCommand("!remind", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      channelId: "channel-123",
    });

    expect(result).toEqual({
      handled: true,
      response: "Usage: !remind <when>, <what you want to be reminded about>",
    });
  });

  it("surfaces reminder parsing errors", async () => {
    parseReminderCommandMock.mockRejectedValueOnce(
      new Error("I could not safely determine the reminder time."),
    );

    const result = await executeSessionCommand("!remind sometime tomorrow", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      channelId: "channel-123",
    });

    expect(result).toEqual({
      handled: true,
      response: "I could not safely determine the reminder time.",
    });
  });

  it("reloads scheduled jobs when requested", async () => {
    let status: TaskSchedulerStatus = {
      jobsFile: "/tmp/scheduled-jobs.ts",
      jobCount: 1,
      nextTickAt: "2026-01-01T00:05:00.000Z",
      running: true,
    };
    let jobs: Array<TaskJobRuntimeState> = [
      {
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
        model: undefined,
        effectiveModel: {
          provider: "openrouter",
          id: "model-1",
        },
        result: {
          target: "discord-dm",
          userId: "user-1",
        },
        nextRunAt: "2026-01-01T09:00:00.000Z",
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        running: false,
      },
    ];
    const reload = vi.fn().mockImplementation(async () => {
      status = {
        jobsFile: "/tmp/scheduled-jobs.ts",
        jobCount: 2,
        nextTickAt: "2026-01-01T00:05:00.000Z",
        running: true,
      };
      jobs = [
        ...jobs,
        {
          id: "hello-dm",
          prompt: "Say hello in the DM",
          description: "Send a hello DM",
          source: "file",
          schedule: {
            type: "daily-at",
            hour: 19,
            minute: 50,
            timeZone: "UTC",
          },
          session: undefined,
          model: {
            provider: "openai",
            id: "gpt-5",
          },
          effectiveModel: {
            provider: "openai",
            id: "gpt-5",
          },
          result: {
            target: "discord-dm",
            userId: "user-2",
          },
          nextRunAt: "2026-01-01T19:50:00.000Z",
          lastRunAt: null,
          lastSuccessAt: null,
          lastErrorAt: null,
          lastErrorMessage: null,
          running: false,
        },
      ];

      return status;
    });
    const taskScheduler = createTaskSchedulerMock({
      getStatus: () => {
        return status;
      },
      listJobs: () => {
        return jobs;
      },
      reload,
    });

    const result = await executeSessionCommand("!jobs reload", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler,
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.handled).toBe(true);
    const response = result.response ?? "";
    expect(response).toContain("Task scheduler reloaded.");
    expect(response).toContain("jobs-file: /tmp/scheduled-jobs.ts");
    expect(response).toContain("job-count: 2");
    expect(response).toContain("task-scheduler-running: true");
    expect(response).toContain("next-tick-at: 2026-01-01T00:05:00.000Z");
    expect(response).toContain("- daily-summary");
    expect(response).toContain("prompt: Write the summary");
    expect(response).toContain("model: default (openrouter/model-1)");
    expect(response).toContain("- hello-dm");
    expect(response).toContain("prompt: Say hello in the DM");
    expect(response).toContain("schedule: daily at 19:50 (UTC)");
    expect(response).toContain("model: openai/gpt-5");
  });

  it("builds a scheduler-aware agent prompt for !job update", async () => {
    const result = await executeSessionCommand(
      "!job update can you update hello-dm to run 19:50 every day",
      {
        agentService: createAgentServiceMock(createSessionMock()),
        promptQueue: createPromptQueueMock(),
        taskScheduler: createTaskSchedulerMock(),
        scope: DM_SCOPE,
        workingEmoji: "⚙️",
      },
    );

    expect(result).toEqual({
      handled: false,
      forwardedInput: expect.stringContaining(
        "User request:\ncan you update hello-dm to run 19:50 every day",
      ),
    });
    expect(result.forwardedInput).toContain(
      "Jobs file: /tmp/scheduled-jobs.ts",
    );
    expect(result.forwardedInput).toContain("Loaded scheduler runtime state:");
    expect(result.forwardedInput).toContain("prompt: Write the summary");
    expect(result.forwardedInput).toContain(
      "model: default (openrouter/model-1)",
    );
    expect(result.forwardedInput).toContain(
      "- Jobs may optionally set model: { provider, id }. Omit it to use the gateway default model.",
    );
    expect(result.forwardedInput).toContain(
      "- After editing, remind the user to run `!jobs reload` to reload the scheduler.",
    );
    expect(result.forwardedInput).toContain(
      "- Also remind the user to run `!jobs` to see the latest scheduled jobs.",
    );
  });

  it("shows usage when !job update has no freeform request", async () => {
    const result = await executeSessionCommand("!job update", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      taskScheduler: createTaskSchedulerMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: "Usage: !job update <what you want changed>",
    });
  });

  it("reports when scheduler commands are used without a scheduler", async () => {
    const jobsResult = await executeSessionCommand("!jobs", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });
    const jobResult = await executeSessionCommand("!job missing", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });
    const jobInfoResult = await executeSessionCommand("!job info missing", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });
    const jobUpdateResult = await executeSessionCommand("!job update fix it", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
    });
    const remindResult = await executeSessionCommand("!remind tomorrow 14:00", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      scope: DM_SCOPE,
      workingEmoji: "⚙️",
      channelId: "channel-123",
    });

    expect(jobsResult).toEqual({
      handled: true,
      response: "Task scheduler is not enabled.",
    });
    expect(jobResult).toEqual({
      handled: true,
      response: "Task scheduler is not enabled.",
    });
    expect(jobInfoResult).toEqual({
      handled: true,
      response: "Task scheduler is not enabled.",
    });
    expect(jobUpdateResult).toEqual({
      handled: true,
      response: "Task scheduler is not enabled.",
    });
    expect(remindResult).toEqual({
      handled: true,
      response: "Task scheduler is not enabled.",
    });
  });
});
