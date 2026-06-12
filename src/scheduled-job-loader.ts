import path from "node:path";
import { createJiti } from "jiti/static";
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

const createJobsLoader = () => {
  return createJiti(import.meta.url, {
    fsCache: false,
    moduleCache: false,
    interopDefault: true,
  });
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
  const jobsLoader = createJobsLoader();
  return jobsLoader.import<JobsModule>(jobsFile);
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
