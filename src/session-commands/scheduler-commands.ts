import { DEFAULT_PROMPT_TIME_ZONE } from "../prompt-context";
import { parseReminderCommand } from "../reminder-command-parser";
import type { SessionScope } from "../session-registry";
import type { TaskSchedulerService } from "../task-scheduler-service";
import type {
  TaskJobRuntimeState,
  TaskJobSchedule,
  TaskResultTarget,
  TaskSchedulerStatus,
  TaskSessionTarget,
} from "../types";
import type { CommandHandler } from "./shared";
import {
  formatCommandUsage,
  getPrimaryCommandPrefix,
  INTERNAL_COMMAND_PREFIX,
  stringifyCommandError,
} from "./shared";

const JOB_PROMPT_PREVIEW_LENGTH = 80;
const RESERVED_JOB_SUBCOMMANDS = new Set(["run", "run-here", "info", "update"]);
const weekDayLabels: Record<string, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

type RunScheduledJobCommandOptions = {
  runHere: boolean;
};

async function handleJobsCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}jobs` &&
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}jobs reload`
  ) {
    return null;
  }

  if (!context.taskScheduler) {
    return {
      handled: true,
      response: "Task scheduler is not enabled.",
    };
  }

  if (trimmedInput === `${INTERNAL_COMMAND_PREFIX}jobs reload`) {
    const reloadedStatus = await context.taskScheduler.reload();
    return {
      handled: true,
      response: formatJobsResponse(
        reloadedStatus,
        context.taskScheduler.listJobs(),
        ["Task scheduler reloaded."],
      ),
    };
  }

  return {
    handled: true,
    response: formatJobsResponse(
      context.taskScheduler.getStatus(),
      context.taskScheduler.listJobs(),
    ),
  };
}

async function runScheduledJobCommand(
  jobId: string,
  context: Parameters<CommandHandler>[1],
  options: RunScheduledJobCommandOptions,
) {
  if (!context.taskScheduler) {
    return {
      handled: true,
      response: "Task scheduler is not enabled.",
    };
  }

  const job = context.taskScheduler.getJob(jobId);
  if (!job) {
    return {
      handled: true,
      response: `Scheduled job not found: ${jobId}`,
    };
  }

  let resultOverride: TaskResultTarget | undefined;
  let targetResolution: string | undefined;

  if (options.runHere) {
    if (!context.channelId) {
      return {
        handled: true,
        response: "This command requires a Discord channel context.",
      };
    }

    resultOverride = {
      target: "discord-channel",
      channelId: context.channelId,
    };
    targetResolution = formatReminderTargetResolution(
      context.scope,
      context.channelId,
    );
  }

  try {
    const runResult = await context.taskScheduler.runJobNow(jobId, {
      resultOverride,
    });
    const updatedJob = context.taskScheduler.getJob(jobId);
    const deliveryTarget = resultOverride ?? job.result;

    return {
      handled: true,
      response: [
        `${options.runHere ? "Manual job run here finished" : "Manual job run finished"}: ${job.id}`,
        `status: ${runResult.ok ? "success" : "failed"}`,
        `delivery-target: ${formatResultTarget(deliveryTarget)}`,
        ...(resultOverride
          ? [
              `configured-target: ${formatResultTarget(job.result)}`,
              `target-resolution: ${targetResolution}`,
            ]
          : []),
        ...(updatedJob
          ? [
              `next-run-at: ${updatedJob.nextRunAt ?? "(unknown)"}`,
              `last-run-at: ${updatedJob.lastRunAt ?? "(never)"}`,
              `last-success-at: ${updatedJob.lastSuccessAt ?? "(never)"}`,
              `last-error: ${updatedJob.lastErrorMessage ?? "(none)"}`,
            ]
          : []),
        ...(runResult.ok || !runResult.errorMessage
          ? []
          : [`error: ${runResult.errorMessage}`]),
      ].join("\n"),
    };
  } catch (error) {
    return {
      handled: true,
      response: stringifyCommandError(error),
    };
  }
}

async function handleJobRunCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  const parts = trimmedInput.split(/\s+/);
  if (parts[0] !== `${INTERNAL_COMMAND_PREFIX}job`) {
    return null;
  }

  const subcommand = parts[1];
  if (subcommand !== "run" && subcommand !== "run-here") {
    return null;
  }

  if (parts.length !== 3) {
    return {
      handled: true,
      response:
        subcommand === "run-here"
          ? `Usage: ${formatCommandUsage(context, "job run-here <id>")}`
          : `Usage: ${formatCommandUsage(context, "job run <id>")}`,
    };
  }

  return runScheduledJobCommand(parts[2], context, {
    runHere: subcommand === "run-here",
  });
}

async function handleJobInfoCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  const parts = trimmedInput.split(/\s+/);
  if (parts[0] !== `${INTERNAL_COMMAND_PREFIX}job` || parts[1] !== "info") {
    return null;
  }

  if (!context.taskScheduler) {
    return {
      handled: true,
      response: "Task scheduler is not enabled.",
    };
  }

  if (parts.length !== 3) {
    return {
      handled: true,
      response: `Usage: ${formatCommandUsage(context, "job info <id>")}`,
    };
  }

  const job = context.taskScheduler.getJob(parts[2]);
  if (!job) {
    return {
      handled: true,
      response: `Scheduled job not found: ${parts[2]}`,
    };
  }

  return {
    handled: true,
    response: [
      `id: ${job.id}`,
      `description: ${job.description ?? "(none)"}`,
      ...formatJobPromptLines(job.prompt),
      `source: ${formatJobSource(job.source)}`,
      `schedule: ${formatTaskSchedule(job.schedule)}`,
      `model: ${formatJobModel(job)}`,
      `session: ${formatSessionTarget(job.session)}`,
      `session-mode: ${formatSessionStrategy(job.session)}`,
      `result: ${formatResultTarget(job.result)}`,
      `next-run-at: ${job.nextRunAt ?? "(unknown)"}`,
      `last-run-at: ${job.lastRunAt ?? "(never)"}`,
      `last-success-at: ${job.lastSuccessAt ?? "(never)"}`,
      `last-error-at: ${job.lastErrorAt ?? "(never)"}`,
      `last-error: ${job.lastErrorMessage ?? "(none)"}`,
      `running: ${job.running}`,
    ].join("\n"),
  };
}

async function handleJobImplicitRunHereCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  const parts = trimmedInput.split(/\s+/);
  if (parts[0] !== `${INTERNAL_COMMAND_PREFIX}job`) {
    return null;
  }

  if (parts.length !== 2 || RESERVED_JOB_SUBCOMMANDS.has(parts[1])) {
    return null;
  }

  return runScheduledJobCommand(parts[1], context, {
    runHere: true,
  });
}

async function handleRemindCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (!trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}remind`)) {
    return null;
  }

  if (!context.taskScheduler) {
    return {
      handled: true,
      response: "Task scheduler is not enabled.",
    };
  }

  const request = trimmedInput
    .slice(`${INTERNAL_COMMAND_PREFIX}remind`.length)
    .trim();
  if (!request) {
    return {
      handled: true,
      response: `Usage: ${formatCommandUsage(
        context,
        "remind <when>, <what you want to be reminded about>",
      )}`,
    };
  }

  if (!context.channelId) {
    return {
      handled: true,
      response: "This reminder command requires a Discord channel context.",
    };
  }

  try {
    const parsedReminder = await parseReminderCommand({
      agentService: context.agentService,
      input: request,
      now: new Date(),
      timeZone: context.promptTimeZone ?? DEFAULT_PROMPT_TIME_ZONE,
      locale: context.promptLocale ?? "en-US",
    });
    const reminderId = buildReminderId(
      parsedReminder.runAt,
      parsedReminder.prompt,
      context.taskScheduler.listJobs(),
    );
    const reminder = context.taskScheduler.addRuntimeReminder({
      id: reminderId,
      prompt: parsedReminder.prompt,
      runAt: parsedReminder.runAt,
      description: parsedReminder.description,
      result: {
        target: "discord-channel",
        channelId: context.channelId,
      },
    });

    return {
      handled: true,
      response: [
        `Reminder created: ${reminder.id}`,
        `run-at: ${reminder.nextRunAt ?? parsedReminder.runAt}`,
        `source: ${formatJobSource(reminder.source)}`,
        `target: ${formatResultTarget(reminder.result)}`,
        `target-resolution: ${formatReminderTargetResolution(context.scope, context.channelId)}`,
        `session-mode: ${formatSessionStrategy(reminder.session)}`,
      ].join("\n"),
    };
  } catch (error) {
    return {
      handled: true,
      response: stringifyCommandError(error),
    };
  }
}

async function handleJobUpdateCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (!trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}job update`)) {
    return null;
  }

  if (!context.taskScheduler) {
    return {
      handled: true,
      response: "Task scheduler is not enabled.",
    };
  }

  const request = trimmedInput
    .slice(`${INTERNAL_COMMAND_PREFIX}job update`.length)
    .trim();
  if (!request) {
    return {
      handled: true,
      response: `Usage: ${formatCommandUsage(
        context,
        "job update <what you want changed>",
      )}`,
    };
  }

  const schedulerStatus = context.taskScheduler.getStatus();
  const jobs = context.taskScheduler.listJobs();

  return {
    handled: false,
    forwardedInput: buildJobUpdatePrompt(
      request,
      getPrimaryCommandPrefix(context),
      schedulerStatus.jobsFile,
      jobs,
    ),
  };
}

function formatJobsResponse(
  status: TaskSchedulerStatus,
  jobs: TaskJobRuntimeState[],
  prefixLines: string[] = [],
): string {
  if (jobs.length === 0) {
    return [
      ...prefixLines,
      "Task scheduler is enabled, but no jobs are loaded.",
      `jobs-file: ${status.jobsFile}`,
      `job-count: ${status.jobCount}`,
      `task-scheduler-running: ${status.running}`,
      `next-tick-at: ${status.nextTickAt ?? "(none)"}`,
    ].join("\n");
  }

  return [
    ...prefixLines,
    `task-scheduler-running: ${status.running}`,
    `jobs-file: ${status.jobsFile}`,
    `job-count: ${status.jobCount}`,
    `next-tick-at: ${status.nextTickAt ?? "(none)"}`,
    "",
    ...jobs.map((job) => {
      return [
        `- ${job.id}`,
        `  prompt: ${formatJobPromptPreview(job.prompt)}`,
        `  source: ${formatJobSource(job.source)}`,
        `  schedule: ${formatTaskSchedule(job.schedule)}`,
        `  model: ${formatJobModel(job)}`,
        `  next-run-at: ${job.nextRunAt ?? "(unknown)"}`,
        `  target: ${formatResultTarget(job.result)}`,
        `  session: ${formatSessionTarget(job.session)}`,
        `  session-mode: ${formatSessionStrategy(job.session)}`,
        `  running: ${job.running}`,
      ].join("\n");
    }),
  ].join("\n");
}

function formatTaskSchedule(schedule: TaskJobSchedule): string {
  if (schedule.type === "every-minutes") {
    const daysOfWeek = schedule.daysOfWeek?.length
      ? ` on ${schedule.daysOfWeek.map((day) => weekDayLabels[day]).join(", ")}`
      : "";
    const timeWindow =
      schedule.startTime && schedule.endTime
        ? ` between ${schedule.startTime} and ${schedule.endTime}`
        : "";
    const timeZone = schedule.timeZone ? ` (${schedule.timeZone})` : "";

    return `every ${schedule.interval} minute(s)${timeZone}${daysOfWeek}${timeWindow}`;
  }

  if (schedule.type === "run-at") {
    return `once at ${schedule.runAt}`;
  }

  const daysOfWeek = schedule.daysOfWeek?.length
    ? ` on ${schedule.daysOfWeek.map((day) => weekDayLabels[day]).join(", ")}`
    : "";

  return `daily at ${String(schedule.hour).padStart(2, "0")}:${String(
    schedule.minute,
  ).padStart(
    2,
    "0",
  )} (${schedule.timeZone ?? "default timezone"})${daysOfWeek}`;
}

function formatResultTarget(result: TaskResultTarget | undefined): string {
  if (!result || result.target === "logs") {
    return "logs";
  }

  if (result.target === "discord-dm") {
    return `discord-dm:${result.userId}`;
  }

  return `discord-channel:${result.channelId}`;
}

function formatReminderTargetResolution(
  scope: SessionScope,
  channelId: string,
) {
  if (scope === "dm") {
    return `current DM via message.channel.id -> discord-channel:${channelId}`;
  }

  if (scope.startsWith("thread:")) {
    return `current thread via message.channel.id -> discord-channel:${channelId}`;
  }

  return `current Discord conversation via message.channel.id -> discord-channel:${channelId}`;
}

function formatSessionTarget(session: TaskSessionTarget | undefined): string {
  if (session?.strategy === "ephemeral") {
    return "ephemeral";
  }

  return session?.scope ? `scope:${session.scope}` : "dedicated";
}

function formatSessionStrategy(session: TaskSessionTarget | undefined): string {
  if (session?.strategy === "ephemeral") {
    return "ephemeral";
  }

  return session?.strategy ?? "fresh";
}

function formatJobPromptPreview(prompt: string): string {
  const singleLinePrompt = prompt.replace(/\s+/g, " ").trim();
  if (singleLinePrompt.length <= JOB_PROMPT_PREVIEW_LENGTH) {
    return singleLinePrompt;
  }

  return `${singleLinePrompt.slice(0, JOB_PROMPT_PREVIEW_LENGTH - 3)}...`;
}

function formatJobPromptLines(prompt: string): string[] {
  return [
    "prompt:",
    ...prompt
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => `  ${line}`),
  ];
}

function formatJobSource(source: TaskJobRuntimeState["source"]): string {
  return source;
}

function formatJobModel(job: TaskJobRuntimeState): string {
  const effectiveModel = `${job.effectiveModel.provider}/${job.effectiveModel.id}`;
  return job.model ? effectiveModel : `default (${effectiveModel})`;
}

function buildJobUpdatePrompt(
  request: string,
  commandPrefix: string,
  jobsFile: string,
  jobs: ReturnType<TaskSchedulerService["listJobs"]>,
): string {
  const jobSummary = jobs.length
    ? jobs
        .map((job) => {
          return [
            `- id: ${job.id}`,
            `  prompt: ${formatJobPromptPreview(job.prompt)}`,
            `  source: ${formatJobSource(job.source)}`,
            `  schedule: ${formatTaskSchedule(job.schedule)}`,
            `  model: ${formatJobModel(job)}`,
            `  session: ${formatSessionTarget(job.session)}`,
            `  session-mode: ${formatSessionStrategy(job.session)}`,
            `  result: ${formatResultTarget(job.result)}`,
            `  next-run-at: ${job.nextRunAt ?? "(unknown)"}`,
            `  last-error: ${job.lastErrorMessage ?? "(none)"}`,
          ].join("\n");
        })
        .join("\n")
    : "(no jobs loaded)";

  const examples = [
    "  // Run every 60 minutes on weekdays between 09:00 and 22:00 in Sydney",
    "  {",
    '    id: "heartbeat",',
    '    prompt: "Check system health and report any issues.",',
    "    schedule: {",
    '      type: "every-minutes",',
    "      interval: 60,",
    '      timeZone: "Australia/Sydney",',
    '      daysOfWeek: ["mon", "tue", "wed", "thu", "fri"],',
    '      startTime: "09:00",',
    '      endTime: "22:00",',
    "    },",
    "    session: {",
    '      strategy: "fresh",',
    '      scope: "job:heartbeat",',
    "    },",
    "    result: {",
    '      target: "logs",',
    "    },",
    "  },",
    "",
    "  // Run on weekdays at 9:00 AM AEST, reuse the same session, deliver to a Discord channel",
    "  {",
    '    id: "morning-summary",',
    '    prompt: "Summarize overnight activity across all channels.",',
    "    schedule: {",
    '      type: "daily-at",',
    "      hour: 9,",
    "      minute: 0,",
    '      timeZone: "Australia/Sydney",',
    '      daysOfWeek: ["mon", "tue", "wed", "thu", "fri"],',
    "    },",
    "    session: {",
    '      strategy: "reuse",',
    '      scope: "job:morning-summary",',
    "    },",
    "    model: {",
    '      provider: "openrouter",',
    '      id: "anthropic/claude-sonnet-4",',
    "    },",
    "    result: {",
    '      target: "discord-channel",',
    '      channelId: "<channel-id>",',
    "    },",
    "  },",
    "",
    "  // Omit model to use the gateway default model from config",
    "",
    "  // Available session types:",
    '  //   { strategy: "fresh", scope: "job:<id>" }     — fresh session each run',
    '  //   { strategy: "reuse", scope: "job:<id>" }    — reuse session across runs',
    '  //   { strategy: "ephemeral" }                     — temp in-memory session, no persistence',
    '  //   scope can be "dm", "thread:<id>", or "job:<id>"',
    "",
    "  // Available result.target types (discriminated union on target):",
    '  //   { target: "logs" }',
    '  //   { target: "discord-dm", userId: "<user-id>" }',
    '  //   { target: "discord-channel", channelId: "<channel-id>" }',
  ].join("\n");

  return [
    "Update the scheduled jobs configuration for this repository.",
    "",
    `Jobs file: ${jobsFile}`,
    "",
    "Loaded scheduler runtime state:",
    jobSummary,
    "",
    "User request:",
    request,
    "",
    "Requirements:",
    "- Edit the scheduled jobs file, not runtime state directly.",
    "- Preserve unrelated jobs and unrelated fields unless the user asked to change them.",
    "- Use the loaded runtime state for context, then read the jobs file if you need full source details.",
    "- If the target job is missing or ambiguous, inspect the jobs file and explain what you found.",
    "- Jobs may optionally set model: { provider, id }. Omit it to use the gateway default model.",
    "- Do not add a model override on shared dm/thread session scopes. Use a dedicated job:<id> scope instead.",
    `- After editing, remind the user to run \`${commandPrefix}jobs reload\` to reload the scheduler.`,
    `- Also remind the user to run \`${commandPrefix}jobs\` to see the latest scheduled jobs.`,
    `- Do not claim the live scheduler has changed until \`${commandPrefix}jobs reload\` is run.`,
    "",
    "Job definition examples:",
    examples,
  ].join("\n");
}

function buildReminderId(
  runAt: string,
  prompt: string,
  existingJobs: TaskJobRuntimeState[],
): string {
  const datePart = runAt.replace(/[-:TZ.]/g, "").slice(0, 12) || "runtime";
  const promptSlug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "reminder";
  const baseId = `reminder-${datePart}-${promptSlug}`;
  const existingIds = new Set(
    existingJobs.map((job) => {
      return job.id;
    }),
  );

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}

export const schedulerCommandHandlers: CommandHandler[] = [
  handleRemindCommand,
  handleJobsCommand,
  handleJobUpdateCommand,
  handleJobRunCommand,
  handleJobImplicitRunHereCommand,
  handleJobInfoCommand,
];
