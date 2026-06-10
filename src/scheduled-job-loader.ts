import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DailyAtTaskSchedule,
  EveryMinutesTaskSchedule,
  ResolvedTaskSchedulerConfig,
  ScheduledTaskDefinition,
  TaskResultTarget,
  TaskSchedule,
  TaskSchedulerConfig,
  TaskSessionTarget,
} from "./types";

type JobsModule = {
  default?: unknown;
  jobs?: unknown;
  defineJobs?: (() => unknown | Promise<unknown>) | unknown;
};

export function resolveTaskSchedulerConfig(
  config: TaskSchedulerConfig,
  cwd: string,
): ResolvedTaskSchedulerConfig {
  const jobsFile = config.jobsFile.trim();
  if (!jobsFile) {
    throw new Error("Missing required scheduler config value: jobsFile");
  }

  return {
    jobsFile: path.isAbsolute(jobsFile) ? jobsFile : path.resolve(cwd, jobsFile),
  };
}

export async function loadScheduledJobs(
  config: ResolvedTaskSchedulerConfig,
): Promise<ScheduledTaskDefinition[]> {
  const moduleUrl = new URL(
    `?t=${Date.now()}`,
    pathToFileURL(config.jobsFile),
  ).href;
  const importedModule = (await import(moduleUrl)) as JobsModule;
  const exportedValue = await resolveJobsExport(importedModule);

  if (!Array.isArray(exportedValue)) {
    throw new Error(
      `Scheduled jobs module must export an array or defineJobs() must return an array: ${config.jobsFile}`,
    );
  }

  return exportedValue.map((job, index) => {
    return normalizeScheduledJob(job, index, config.jobsFile);
  });
}

async function resolveJobsExport(module: JobsModule): Promise<unknown> {
  if (typeof module.defineJobs === "function") {
    return module.defineJobs();
  }

  if (Array.isArray(module.jobs)) {
    return module.jobs;
  }

  if (typeof module.default === "function") {
    return module.default();
  }

  return module.default;
}

function normalizeScheduledJob(
  value: unknown,
  index: number,
  jobsFile: string,
): ScheduledTaskDefinition {
  if (!isRecord(value)) {
    throw new Error(
      `Scheduled job at index ${index} in ${jobsFile} must be an object.`,
    );
  }

  const id = requireString(value.id, `jobs[${index}].id`, jobsFile).trim();
  const prompt = requireString(
    value.prompt,
    `jobs[${index}].prompt`,
    jobsFile,
  ).trim();

  if (!id) {
    throw new Error(`jobs[${index}].id in ${jobsFile} must not be empty.`);
  }

  if (!prompt) {
    throw new Error(`jobs[${index}].prompt in ${jobsFile} must not be empty.`);
  }

  const description = normalizeOptionalString(value.description);

  return {
    id,
    prompt,
    description,
    schedule: normalizeSchedule(value.schedule, index, jobsFile),
    session: normalizeSession(value.session, index, jobsFile),
    result: normalizeResult(value.result, index, jobsFile),
  };
}

function normalizeSchedule(
  value: unknown,
  index: number,
  jobsFile: string,
): TaskSchedule {
  if (!isRecord(value)) {
    throw new Error(
      `jobs[${index}].schedule in ${jobsFile} must be an object.`,
    );
  }

  const type = requireString(value.type, `jobs[${index}].schedule.type`, jobsFile);

  if (type === "every-minutes") {
    return normalizeEveryMinutesSchedule(value, index, jobsFile);
  }

  if (type === "daily-at") {
    return normalizeDailyAtSchedule(value, index, jobsFile);
  }

  throw new Error(
    `jobs[${index}].schedule.type in ${jobsFile} must be "every-minutes" or "daily-at".`,
  );
}

function normalizeEveryMinutesSchedule(
  value: Record<string, unknown>,
  index: number,
  jobsFile: string,
): EveryMinutesTaskSchedule {
  const interval = requireInteger(
    value.interval,
    `jobs[${index}].schedule.interval`,
    jobsFile,
  );

  if (interval <= 0) {
    throw new Error(
      `jobs[${index}].schedule.interval in ${jobsFile} must be greater than 0.`,
    );
  }

  return {
    type: "every-minutes",
    interval,
  };
}

function normalizeDailyAtSchedule(
  value: Record<string, unknown>,
  index: number,
  jobsFile: string,
): DailyAtTaskSchedule {
  const hour = requireInteger(value.hour, `jobs[${index}].schedule.hour`, jobsFile);
  const minute = requireInteger(
    value.minute,
    `jobs[${index}].schedule.minute`,
    jobsFile,
  );
  const timeZone = normalizeOptionalString(value.timeZone);

  if (hour < 0 || hour > 23) {
    throw new Error(
      `jobs[${index}].schedule.hour in ${jobsFile} must be between 0 and 23.`,
    );
  }

  if (minute < 0 || minute > 59) {
    throw new Error(
      `jobs[${index}].schedule.minute in ${jobsFile} must be between 0 and 59.`,
    );
  }

  if (timeZone) {
    assertValidTimeZone(timeZone, `jobs[${index}].schedule.timeZone`, jobsFile);
  }

  return {
    type: "daily-at",
    hour,
    minute,
    timeZone,
  };
}

function normalizeSession(
  value: unknown,
  index: number,
  jobsFile: string,
): TaskSessionTarget | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`jobs[${index}].session in ${jobsFile} must be an object.`);
  }

  const strategy =
    value.strategy === undefined
      ? "dedicated"
      : requireString(value.strategy, `jobs[${index}].session.strategy`, jobsFile);

  if (strategy === "dedicated") {
    return { strategy: "dedicated" };
  }

  if (strategy === "scope") {
    const scope = requireString(value.scope, `jobs[${index}].session.scope`, jobsFile);
    if (!isValidSessionScope(scope)) {
      throw new Error(
        `jobs[${index}].session.scope in ${jobsFile} must be "dm", "thread:<id>", or "job:<id>".`,
      );
    }

    return {
      strategy: "scope",
      scope,
    };
  }

  throw new Error(
    `jobs[${index}].session.strategy in ${jobsFile} must be "dedicated" or "scope".`,
  );
}

function normalizeResult(
  value: unknown,
  index: number,
  jobsFile: string,
): TaskResultTarget | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`jobs[${index}].result in ${jobsFile} must be an object.`);
  }

  const target = requireString(value.target, `jobs[${index}].result.target`, jobsFile);

  if (target === "logs") {
    return { target: "logs" };
  }

  if (target === "discord-dm") {
    return {
      target: "discord-dm",
      userId: requireString(value.userId, `jobs[${index}].result.userId`, jobsFile),
    };
  }

  if (target === "discord-channel") {
    return {
      target: "discord-channel",
      channelId: requireString(
        value.channelId,
        `jobs[${index}].result.channelId`,
        jobsFile,
      ),
    };
  }

  throw new Error(
    `jobs[${index}].result.target in ${jobsFile} must be "logs", "discord-dm", or "discord-channel".`,
  );
}

function assertValidTimeZone(
  value: string,
  fieldName: string,
  jobsFile: string,
): void {
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
      hour: "2-digit",
    }).format(new Date());
  } catch {
    throw new Error(`${fieldName} in ${jobsFile} is not a valid IANA time zone.`);
  }
}

function requireString(
  value: unknown,
  fieldName: string,
  jobsFile: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} in ${jobsFile} must be a string.`);
  }

  return value;
}

function requireInteger(
  value: unknown,
  fieldName: string,
  jobsFile: string,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${fieldName} in ${jobsFile} must be an integer.`);
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidSessionScope(
  value: string,
): value is "dm" | `thread:${string}` | `job:${string}` {
  return value === "dm" || value.startsWith("thread:") || value.startsWith("job:");
}
