import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeScheduledJobs } from "./scheduled-job-definition";
import type {
  LoadScheduleJobs,
  ResolvedTaskSchedulerConfig,
  ScheduledJobsContext,
  ScheduledTaskDefinition,
  TaskSchedulerConfig,
} from "./types";

type JobsModule = {
  loadScheduleJobs?: unknown;
};

// Node caches ESM imports by URL, so each reload gets a unique query string.
let jobsModuleImportVersion = 0;

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
  context: ScheduledJobsContext,
): Promise<ScheduledTaskDefinition[]> {
  const exportedValue = await loadJobsFromModule(config.jobsFile, context);
  return normalizeScheduledJobs(exportedValue, config.jobsFile);
}

async function loadJobsFromModule(
  jobsFile: string,
  context: ScheduledJobsContext,
): Promise<unknown> {
  try {
    const importedModule = await importJobsModule(jobsFile);
    const loadScheduleJobs = getLoadScheduleJobs(importedModule);

    return await loadScheduleJobs(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Failed to load scheduled jobs from ${jobsFile}:\n${message}`,
    );
  }
}

async function importJobsModule(jobsFile: string): Promise<JobsModule> {
  const jobsFileUrl = pathToFileURL(jobsFile);
  jobsFileUrl.searchParams.set("v", String((jobsModuleImportVersion += 1)));
  return import(jobsFileUrl.href);
}

function getLoadScheduleJobs(importedModule: JobsModule): LoadScheduleJobs {
  const { loadScheduleJobs } = importedModule;

  if (typeof loadScheduleJobs !== "function") {
    throw new Error(
      "Scheduled jobs file must export `loadScheduleJobs(context)`.",
    );
  }

  return loadScheduleJobs as LoadScheduleJobs;
}
