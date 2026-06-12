import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "../src/agent-service";
import { startTaskScheduler } from "../src/index";
import {
  loadScheduledJobs,
  resolveTaskSchedulerConfig,
} from "../src/scheduled-job-loader";
import type {
  ScheduledJobsContext,
  ScheduledTaskDefinition,
} from "../src/types";

type FakeAgentSession = {
  agent: {
    state: {
      errorMessage: string | null;
    };
  };
  messages: Array<{
    role: string;
    content: Array<{
      type: string;
      text: string;
    }>;
  }>;
  model: null;
  sessionFile: string;
  sessionId: string;
  abort: () => Promise<void>;
  dispose: () => void;
  prompt: (prompt: string) => Promise<void>;
  subscribe: () => () => void;
};

const smokePrefix = "[smoke-task-scheduler]";
const tempDirs: string[] = [];
const capturedPrompts: string[] = [];

function createFakeAgentSession(sessionDir: string): FakeAgentSession {
  const session: FakeAgentSession = {
    agent: {
      state: {
        errorMessage: null,
      },
    },
    messages: [],
    model: null,
    sessionFile: path.join(sessionDir, "smoke-session.jsonl"),
    sessionId: `smoke-${Math.random().toString(36).slice(2, 10)}`,
    abort: async () => {
      return undefined;
    },
    dispose: () => {
      return undefined;
    },
    prompt: async (prompt: string) => {
      capturedPrompts.push(prompt);
      session.messages = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `captured prompt\n${prompt}`,
            },
          ],
        },
      ];
    },
    subscribe: () => {
      return () => {
        return undefined;
      };
    },
  };

  return session;
}

async function createDefaultJobsFile(tempDir: string): Promise<string> {
  const jobsFile = path.join(tempDir, "scheduled-jobs.mjs");

  await fs.writeFile(
    jobsFile,
    [
      "export function loadScheduleJobs() {",
      "  return [",
      "    {",
      '      id: "smoke-default-job",',
      '      prompt: "Smoke test prompt from scheduled job definition.",',
      '      schedule: { type: "every-minutes", interval: 1 },',
      '      result: { target: "logs" },',
      "    },",
      "  ];",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  return jobsFile;
}

async function createWrappedJobsFile(
  tempDir: string,
  sourceJobsFile: string,
): Promise<string> {
  const wrappedFile = path.join(tempDir, "scheduled-jobs-wrapper.mjs");
  const moduleUrl = pathToFileURL(sourceJobsFile).href;

  await fs.writeFile(
    wrappedFile,
    [
      `const sourceModule = await import(${JSON.stringify(moduleUrl)});`,
      "export async function loadScheduleJobs(context) {",
      '  if (typeof sourceModule.loadScheduleJobs !== "function") {',
      '    throw new Error("Source jobs file must export loadScheduleJobs(context).");',
      "  }",
      "  const sourceJobs = await sourceModule.loadScheduleJobs(context);",
      "  if (!Array.isArray(sourceJobs)) {",
      '    throw new Error("Source jobs file did not return an array of jobs.");',
      "  }",
      "  return sourceJobs.map((job, index) => ({",
      "    ...job,",
      "    id: String(job.id ?? `smoke-job-${index + 1}`),",
      '    schedule: { type: "every-minutes", interval: 1 },',
      '    result: { target: "logs" },',
      "  }));",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  return wrappedFile;
}

function createScheduledJobsContext(jobsFile: string): ScheduledJobsContext {
  return {
    config: {
      discordBotToken: "smoke-test-token",
      discordAllowedUserId: "smoke-test-user",
      cwd: path.dirname(jobsFile),
      agentDir: path.join(path.dirname(jobsFile), ".pi-agent"),
      modelProvider: "openrouter",
      modelId: "smoke-model",
      thinkingLevel: "medium",
      promptTimeZone: "UTC",
      promptLocale: "en-AU",
      promptTransform: async (ctx) => ctx.rawContent,
      startupMessage: false,
      shutdownOnSignals: true,
      visionModelId: null,
      discordAllowedForumChannelIds: [],
      discordAllowedUserIds: ["smoke-test-user"],
    },
    schedulerConfig: {
      jobsFile,
    },
  };
}

async function createSmokeJobsFiles(): Promise<{
  expectedJobs: ScheduledTaskDefinition[];
  schedulerJobsFile: string;
}> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "discord-pi-agent-smoke-"),
  );
  tempDirs.push(tempDir);

  const sourceJobsFile = process.env.SMOKE_JOBS_FILE
    ? path.resolve(process.cwd(), process.env.SMOKE_JOBS_FILE)
    : await createDefaultJobsFile(tempDir);
  const schedulerJobsFile = process.env.SMOKE_JOBS_FILE
    ? await createWrappedJobsFile(tempDir, sourceJobsFile)
    : sourceJobsFile;
  const resolvedSourceJobsConfig = resolveTaskSchedulerConfig(
    {
      jobsFile: sourceJobsFile,
    },
    process.cwd(),
  );
  const expectedJobs = await loadScheduledJobs(
    resolvedSourceJobsConfig,
    createScheduledJobsContext(resolvedSourceJobsConfig.jobsFile),
  );

  return {
    expectedJobs,
    schedulerJobsFile,
  };
}

describe("task scheduler smoke", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));
    vi.clearAllMocks();
    capturedPrompts.length = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("parses jobs and sends the transformed prompt into the pi session", async () => {
    const { expectedJobs, schedulerJobsFile } = await createSmokeJobsFiles();

    expect(expectedJobs.length).toBeGreaterThan(0);

    vi.spyOn(AgentService.prototype, "initialize").mockResolvedValue(undefined);
    vi.spyOn(AgentService.prototype, "shutdown").mockResolvedValue(undefined);
    vi.spyOn(AgentService.prototype, "getStatus").mockReturnValue({
      sessionId: "smoke-session",
      sessionFile: undefined,
      model: "smoke/fake-model",
      streaming: false,
      contextUsage: undefined,
      thinkingInfo: "thinking: not supported",
    });
    vi.spyOn(AgentService.prototype, "createSession").mockImplementation(
      async (sessionDir: string) => {
        return createFakeAgentSession(sessionDir) as never;
      },
    );

    const scheduler = await startTaskScheduler(
      {
        discordBotToken: "smoke-test-token",
        discordAllowedUserId: "smoke-test-user",
        cwd: path.dirname(schedulerJobsFile),
        agentDir: path.join(path.dirname(schedulerJobsFile), ".pi-agent"),
        startupMessage: false,
        shutdownOnSignals: false,
        promptTimeZone: "UTC",
        promptLocale: "en-AU",
        promptTransform: ({ now, rawContent, userMessage }) => {
          return [now(), smokePrefix, userMessage(), `RAW:${rawContent}`].join(
            "\n",
          );
        },
      },
      {
        jobsFile: schedulerJobsFile,
      },
    );

    await vi.advanceTimersByTimeAsync(30_000);

    expect(scheduler.getTaskSchedulerStatus().jobCount).toBe(
      expectedJobs.length,
    );
    expect(capturedPrompts).toHaveLength(expectedJobs.length);

    expectedJobs.forEach((job) => {
      const matchingPrompt = capturedPrompts.find((capturedPrompt) => {
        return (
          capturedPrompt.includes(smokePrefix) &&
          capturedPrompt.includes(
            `<user_message>${job.prompt}</user_message>`,
          ) &&
          capturedPrompt.includes(`RAW:${job.prompt}`) &&
          capturedPrompt.includes("<datetime>")
        );
      });

      expect(matchingPrompt, `captured prompt for ${job.id}`).toBeDefined();
    });

    await scheduler.stop();
  });
});
