import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadScheduledJobs,
  resolveTaskSchedulerConfig,
} from "./scheduled-job-loader";

const tempDirs: string[] = [];

async function createJobsModule(source: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scheduled-jobs-"));
  const filePath = path.join(tempDir, "scheduled-jobs.mjs");
  tempDirs.push(tempDir);
  await fs.writeFile(filePath, source, "utf8");
  return filePath;
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

  it("loads jobs from defineJobs()", async () => {
    const jobsFile = await createJobsModule(`
      export function defineJobs() {
        return [
          {
            id: "daily-standup",
            prompt: "Review current work.",
            schedule: { type: "daily-at", hour: 9, minute: 0, timeZone: "UTC" },
            session: { strategy: "scope", scope: "dm" },
            result: { target: "discord-dm", userId: "123" },
          },
        ];
      }
    `);

    await expect(
      loadScheduledJobs({
        jobsFile,
      }),
    ).resolves.toEqual([
      {
        id: "daily-standup",
        prompt: "Review current work.",
        description: undefined,
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
        reuseSession: false,
        result: {
          target: "discord-dm",
          userId: "123",
        },
      },
    ]);
  });

  it("loads jobs from a default export array", async () => {
    const jobsFile = await createJobsModule(`
      export default [
        {
          id: "heartbeat",
          prompt: "Ping",
          schedule: { type: "every-minutes", interval: 15 },
        },
      ];
    `);

    await expect(
      loadScheduledJobs({
        jobsFile,
      }),
    ).resolves.toEqual([
      {
        id: "heartbeat",
        prompt: "Ping",
        description: undefined,
        schedule: { type: "every-minutes", interval: 15 },
        session: undefined,
        reuseSession: false,
        result: undefined,
      },
    ]);
  });

  it("fails when the module export is not an array", async () => {
    const jobsFile = await createJobsModule(`
      export default { nope: true };
    `);

    await expect(
      loadScheduledJobs({
        jobsFile,
      }),
    ).rejects.toThrow();
  });

  it("fails on invalid schedule data", async () => {
    const jobsFile = await createJobsModule(`
      export const jobs = [
        {
          id: "bad-job",
          prompt: "Do a thing",
          schedule: { type: "every-minutes", interval: 0 },
        },
      ];
    `);

    await expect(
      loadScheduledJobs({
        jobsFile,
      }),
    ).rejects.toThrow();
  });

  it("reloads the latest file contents after the jobs file changes", async () => {
    const jobsFile = await createJobsModule(`
      export const jobs = [
        {
          id: "hello-dm",
          prompt: "Say hello",
          schedule: { type: "daily-at", hour: 19, minute: 32 },
        },
      ];
    `);

    await expect(
      loadScheduledJobs({
        jobsFile,
      }),
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
        export const jobs = [
          {
            id: "hello-dm",
            prompt: "Say hello",
            schedule: { type: "daily-at", hour: 19, minute: 50 },
          },
        ];
      `,
      "utf8",
    );

    await expect(
      loadScheduledJobs({
        jobsFile,
      }),
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
});
