import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeScheduledJobs } from "./scheduled-job-definition";
import type {
  ResolvedTaskSchedulerConfig,
  ScheduledTaskDefinition,
  TaskSchedulerConfig,
} from "./types";

type JobsModule = {
  default?: unknown;
  jobs?: unknown;
  defineJobs?: (() => unknown | Promise<unknown>) | unknown;
};

const execFileAsync = promisify(execFile);

export function resolveTaskSchedulerConfig(
  config: TaskSchedulerConfig,
  cwd: string,
): ResolvedTaskSchedulerConfig {
  const jobsFile = config.jobsFile.trim();
  if (!jobsFile) {
    throw new Error("Missing required scheduler config value: jobsFile");
  }

  return {
    jobsFile: path.isAbsolute(jobsFile)
      ? jobsFile
      : path.resolve(cwd, jobsFile),
  };
}

export async function loadScheduledJobs(
  config: ResolvedTaskSchedulerConfig,
): Promise<ScheduledTaskDefinition[]> {
  const exportedValue = await loadJobsFromSubprocess(config.jobsFile);
  return normalizeScheduledJobs(exportedValue, config.jobsFile);
}

async function loadJobsFromSubprocess(jobsFile: string): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", buildJobsLoaderScript(), jobsFile],
      {
        maxBuffer: 1024 * 1024 * 10,
      },
    );

    return JSON.parse(stdout);
  } catch (error) {
    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";

    if (stderr) {
      throw new Error(
        `Failed to load scheduled jobs from ${jobsFile}:\n${stderr}`,
      );
    }

    if (error instanceof SyntaxError) {
      throw new Error(
        `Scheduled jobs loader returned invalid JSON for ${jobsFile}: ${error.message}`,
      );
    }

    throw error;
  }
}

function buildJobsLoaderScript(): string {
  return [
    'import { pathToFileURL } from "node:url";',
    "",
    "const jobsFile = process.argv[1];",
    "const importedModule = await import(pathToFileURL(jobsFile).href);",
    "const exportedValue = await resolveJobsExport(importedModule);",
    "process.stdout.write(JSON.stringify(exportedValue));",
    "",
    "async function resolveJobsExport(module) {",
    '  if (typeof module.defineJobs === "function") {',
    "    return module.defineJobs();",
    "  }",
    "  if (Array.isArray(module.jobs)) {",
    "    return module.jobs;",
    "  }",
    '  if (typeof module.default === "function") {',
    "    return module.default();",
    "  }",
    "  return module.default;",
    "}",
  ].join("\n");
}
