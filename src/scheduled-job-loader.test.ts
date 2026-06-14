import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadScheduledJobs,
  resolveTaskSchedulerConfig,
} from "./scheduled-job-loader";
import type { ScheduledJobsContext } from "./types";

const tempDirs: string[] = [];

async function createJobsModule(source: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scheduled-jobs-"));
  const filePath = path.join(tempDir, "scheduled-jobs.ts");
  tempDirs.push(tempDir);
  await fs.writeFile(filePath, source, "utf8");
  return filePath;
}

function createScheduledJobsContext(jobsFile: string): ScheduledJobsContext {
  return {
    config: {
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
    },
    schedulerConfig: {
      jobsFile,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("scheduled-job-loader", () => {
  it("resolves relative jobs file paths from cwd", () => {
    expect(
      resolveTaskSchedulerConfig(
        { jobsFile: "config/scheduled-jobs.ts" },
        "/repo",
      ),
    ).toEqual({
      jobsFile: "/repo/config/scheduled-jobs.ts",
    });
  });

  it("loads jobs from loadScheduleJobs(context)", async () => {
    const jobsFile = await createJobsModule(`
      export function loadScheduleJobs(context) {
        return [
          {
            id: "daily-standup",
            prompt: "Review " + context.config.cwd,
            schedule: { type: "daily-at", hour: 9, minute: 0, timeZone: "UTC" },
            session: { strategy: "reuse", scope: "dm" },
            result: { target: "discord-dm", userId: "123" },
          },
        ];
      }
    `);

    await expect(
      loadScheduledJobs(
        {
          jobsFile,
        },
        createScheduledJobsContext(jobsFile),
      ),
    ).resolves.toEqual([
      {
        id: "daily-standup",
        prompt: "Review /repo",
        description: undefined,
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
        result: {
          target: "discord-dm",
          userId: "123",
        },
      },
    ]);
  });

  it("supports async loadScheduleJobs(context)", async () => {
    const jobsFile = await createJobsModule(`
      export async function loadScheduleJobs(context) {
        return [
          {
            id: "heartbeat",
            prompt: "Ping " + context.schedulerConfig.jobsFile,
            schedule: { type: "every-minutes", interval: 15 },
          },
        ];
      }
    `);

    await expect(
      loadScheduledJobs(
        {
          jobsFile,
        },
        createScheduledJobsContext(jobsFile),
      ),
    ).resolves.toEqual([
      {
        id: "heartbeat",
        prompt: `Ping ${jobsFile}`,
        description: undefined,
        schedule: { type: "every-minutes", interval: 15 },
        session: undefined,
        result: undefined,
      },
    ]);
  });

  it("fails when loadScheduleJobs is missing", async () => {
    const jobsFile = await createJobsModule(`
      export const jobs = [];
    `);

    await expect(
      loadScheduledJobs(
        {
          jobsFile,
        },
        createScheduledJobsContext(jobsFile),
      ),
    ).rejects.toThrow(
      "Scheduled jobs file must export `loadScheduleJobs(context)`.",
    );
  });

  it("fails on invalid schedule data", async () => {
    const jobsFile = await createJobsModule(`
      export function loadScheduleJobs() {
        return [
          {
            id: "bad-job",
            prompt: "Do a thing",
            schedule: { type: "every-minutes", interval: 0 },
          },
        ];
      }
    `);

    await expect(
      loadScheduledJobs(
        {
          jobsFile,
        },
        createScheduledJobsContext(jobsFile),
      ),
    ).rejects.toThrow();
  });

  it("reloads the latest file contents after the jobs file changes", async () => {
    const jobsFile = await createJobsModule(`
      export function loadScheduleJobs(context) {
        return [
          {
            id: "hello-dm",
            prompt: "Say hello from " + context.config.cwd,
            schedule: { type: "daily-at", hour: 19, minute: 32 },
          },
        ];
      }
    `);

    await expect(
      loadScheduledJobs(
        {
          jobsFile,
        },
        createScheduledJobsContext(jobsFile),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "hello-dm",
        schedule: {
          type: "daily-at",
          hour: 19,
          minute: 32,
          timeZone: undefined,
        },
      }),
    ]);

    await fs.writeFile(
      jobsFile,
      `
        export function loadScheduleJobs(context) {
          return [
            {
              id: "hello-dm",
              prompt: "Say hello from " + context.config.cwd,
              schedule: { type: "daily-at", hour: 19, minute: 50 },
            },
          ];
        }
      `,
      "utf8",
    );

    await expect(
      loadScheduledJobs(
        {
          jobsFile,
        },
        createScheduledJobsContext(jobsFile),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "hello-dm",
        schedule: {
          type: "daily-at",
          hour: 19,
          minute: 50,
          timeZone: undefined,
        },
      }),
    ]);
  });

  it("reloads imported TypeScript helpers after they change", async () => {
    const jobsFile = await createJobsModule(`
      import { promptSuffix } from "./prompt-helper.ts";

      export function loadScheduleJobs() {
        return [
          {
            id: "hello-dm",
            prompt: "Say hello " + promptSuffix,
            schedule: { type: "every-minutes", interval: 15 },
          },
        ];
      }
    `);
    const helperFile = path.join(path.dirname(jobsFile), "prompt-helper.ts");

    await fs.writeFile(
      helperFile,
      'export const promptSuffix = "today";\n',
      "utf8",
    );

    await expect(
      loadScheduledJobs(
        {
          jobsFile,
        },
        createScheduledJobsContext(jobsFile),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "hello-dm",
        prompt: "Say hello today",
      }),
    ]);

    await fs.writeFile(
      helperFile,
      'export const promptSuffix = "tomorrow";\n',
      "utf8",
    );

    await expect(
      loadScheduledJobs(
        {
          jobsFile,
        },
        createScheduledJobsContext(jobsFile),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "hello-dm",
        prompt: "Say hello tomorrow",
      }),
    ]);
  });
});
