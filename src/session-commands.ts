import type { AgentSession, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { AgentService } from "./agent-service";
import type { PromptQueue } from "./prompt-queue";
import type { SessionRegistry, SessionScope } from "./session-registry";
import type { TaskSchedulerService } from "./task-scheduler-service";
import type {
  TaskJobRuntimeState,
  TaskResultTarget,
  TaskJobSchedule,
  TaskSchedulerStatus,
  TaskSessionTarget,
  ThinkingLevel,
} from "./types";
import { parseReminderCommand } from "./reminder-command-parser";

export type CommandResult = {
  handled: boolean;
  response?: string;
  forwardedInput?: string;
  /** Set to true when the command wants to archive the current thread. */
  archive?: boolean;
  /** When set, update the session's working reaction emoji. */
  workingEmoji?: string;
  /** When set, the command created a new session that should replace the current one. */
  newSession?: AgentSession;
};

export type CommandContext = {
  agentService: AgentService;
  promptQueue: PromptQueue;
  session?: AgentSession;
  taskScheduler?: TaskSchedulerService | null;
  sessionRegistry?: SessionRegistry;
  channelId?: string;
  promptTimeZone?: string;
  promptLocale?: string;
  /** Session scope ("dm" or "thread:<id>") for session lifecycle commands. */
  scope: SessionScope;
  /** Current working reaction emoji for this session. */
  workingEmoji: string;
  /** Accepted command prefixes in display preference order. */
  commandPrefixes?: string[];
};

type CommandHandler = (
  trimmedInput: string,
  context: CommandContext,
) => Promise<CommandResult | null>;

const INTERNAL_COMMAND_PREFIX = "!";

const JOB_PROMPT_PREVIEW_LENGTH = 80;
const weekDayLabels: Record<string, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

function getSessionStatusText(
  session: AgentSession,
  promptQueue: PromptQueue,
  extras?: {
    tools?: ToolInfo[];
    extensionsSummary?: string;
    skillsSummary?: string;
  },
): string {
  const model = session.model
    ? `${session.model.provider}/${session.model.id}`
    : "(no model selected)";
  const contextUsage = session.getContextUsage();
  const contextLine = contextUsage
    ? contextUsage.tokens === null || contextUsage.percent === null
      ? `context: ?/${contextUsage.contextWindow}`
      : `context: ${contextUsage.tokens}/${contextUsage.contextWindow} (${Math.round(contextUsage.percent)}%)`
    : "context: (unavailable)";
  const thinkingInfo = session.supportsThinking()
    ? `thinking: ${session.thinkingLevel} (available: ${session.getAvailableThinkingLevels().join(", ")})`
    : "thinking: not supported";
  const queueStatus = promptQueue.getSnapshot();

  const lines = [
    `model: ${model}`,
    `session-id: ${session.sessionId}`,
    `session-file: ${session.sessionFile ?? "(none)"}`,
    `streaming: ${session.isStreaming}`,
    thinkingInfo,
    contextLine,
    `queue-pending: ${queueStatus.pending}`,
    `queue-busy: ${queueStatus.busy}`,
  ];

  if (extras?.tools && extras.tools.length > 0) {
    const toolNames = extras.tools.map((tool) => tool.name);
    lines.push("", `Tools (${extras.tools.length}): ${toolNames.join(", ")}`);
  }

  if (extras?.skillsSummary) {
    lines.push("", extras.skillsSummary);
  }

  if (extras?.extensionsSummary) {
    lines.push("", extras.extensionsSummary);
  }

  return lines.join("\n");
}

function getEffectiveSession(context: CommandContext): AgentSession | null {
  return context.session ?? context.agentService.getSession();
}

function getPrimaryCommandPrefix(context: CommandContext): string {
  return context.commandPrefixes?.[0] ?? INTERNAL_COMMAND_PREFIX;
}

function formatCommandUsage(context: CommandContext, body: string): string {
  return `${getPrimaryCommandPrefix(context)}${body}`;
}

function normalizeCommandInput(
  input: string,
  commandPrefixes: string[],
): string | null {
  for (const prefix of commandPrefixes) {
    if (!prefix) {
      continue;
    }

    if (input === prefix) {
      return INTERNAL_COMMAND_PREFIX;
    }

    if (input.startsWith(prefix)) {
      return `${INTERNAL_COMMAND_PREFIX}${input.slice(prefix.length)}`;
    }
  }

  return null;
}

function requireEffectiveSession(
  context: CommandContext,
): CommandResult | { session: AgentSession } {
  const session = getEffectiveSession(context);
  if (!session) {
    return {
      handled: true,
      response: "No active session.",
    };
  }

  return { session };
}

async function handleHelpCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}help`) {
    return null;
  }

  const extraCommands = context.session
    ? `\n${formatCommandUsage(context, "archive")} - archive this thread and end the session`
    : "";

  return {
    handled: true,
    response: [
      "Commands:",
      `${formatCommandUsage(context, "help")} - show this message`,
      `${formatCommandUsage(context, "status")} - show current session status`,
      `${formatCommandUsage(context, "thinking")} - show or set thinking/reasoning level`,
      `${formatCommandUsage(context, "model")} - list available models or switch to one`,
      `${formatCommandUsage(context, "compact")} - compact the persistent session`,
      `${formatCommandUsage(context, "session reset <scope|here>")} - reset persisted session data for a scope`,
      `${formatCommandUsage(context, "abort")} - abort the active run and clear queued prompts`,
      `${formatCommandUsage(context, "reload")} - reload resources (AGENTS.md, extensions, skills, etc.)`,
      `${formatCommandUsage(context, "remind <when>, <task>")} - create a one-off runtime reminder`,
      `${formatCommandUsage(context, "jobs")} - list loaded scheduled jobs`,
      `${formatCommandUsage(context, "job <id>")} - run one scheduled job in this conversation`,
      `${formatCommandUsage(context, "job info <id>")} - show one scheduled job`,
      `${formatCommandUsage(context, "job run <id>")} - run one scheduled job now (configured target)`,
      `${formatCommandUsage(context, "job run-here <id>")} - run one scheduled job now in this conversation`,
      `${formatCommandUsage(context, "job update <what you want changed>")} - edit the jobs file via the agent`,
      `${formatCommandUsage(context, "jobs reload")} - reload scheduled jobs from the jobs file`,
      `${formatCommandUsage(context, "reaction")} - show or set the working reaction emoji`,
      extraCommands,
      "Any other text goes to the agent session.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function handleArchiveCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}archive`) {
    return null;
  }

  if (!context.session) {
    return {
      handled: true,
      response: `${formatCommandUsage(context, "archive")} is only available in forum threads.`,
    };
  }

  return {
    handled: true,
    archive: true,
    response: "Archiving thread and shutting down session.",
  };
}

async function handleStatusCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}status`) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const tools = effectiveSession.session.getAllTools();
  const extensionsSummary =
    context.agentService.resources.getExtensionsSummary();
  const skillsSummary = context.agentService.resources.getSkillsSummary();

  return {
    handled: true,
    response: getSessionStatusText(
      effectiveSession.session,
      context.promptQueue,
      {
        tools,
        extensionsSummary,
        skillsSummary,
      },
    ),
  };
}

async function handleThinkingCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}thinking` &&
    !trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}thinking `)
  ) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const parts = trimmedInput.split(" ");
  if (parts.length === 1) {
    const info = context.agentService.models.getThinkingLevel(
      effectiveSession.session,
    );
    if (!info.supported) {
      return {
        handled: true,
        response: "Current model does not support reasoning/thinking.",
      };
    }

    return {
      handled: true,
      response: [
        `Current: ${info.current}`,
        `Available: ${info.available.join(", ")}`,
        `Usage: ${formatCommandUsage(context, "thinking <level>")}`,
      ].join("\n"),
    };
  }

  const requestedLevel = parts[1] as ThinkingLevel;
  return {
    handled: true,
    response: context.agentService.models.setThinkingLevel(
      effectiveSession.session,
      requestedLevel,
    ),
  };
}

async function handleModelCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}model` &&
    !trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}model `)
  ) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const parts = trimmedInput.split(" ");
  if (parts.length === 1) {
    const current = context.agentService.models.getCurrentModelDisplay(
      effectiveSession.session,
    );
    const modelList = await context.agentService.models.listModels(
      effectiveSession.session,
      getPrimaryCommandPrefix(context),
    );

    return {
      handled: true,
      response: `Current model: ${current}\n\n${modelList}`,
    };
  }

  const argument = parts.slice(1).join(" ");
  const slashIndex = argument.indexOf("/");
  if (slashIndex === -1) {
    return {
      handled: true,
      response:
        `Usage: ${formatCommandUsage(context, "model <provider/modelId>")}\n` +
        `Example: ${formatCommandUsage(context, "model openrouter/anthropic/claude-sonnet-4")}\n` +
        `Use ${formatCommandUsage(context, "model")} without args to see available models.`,
    };
  }

  const provider = argument.substring(0, slashIndex).trim();
  const modelId = argument.substring(slashIndex + 1).trim();

  return {
    handled: true,
    response: await context.agentService.models.switchModel(
      provider,
      modelId,
      effectiveSession.session,
    ),
  };
}

async function handleCompactCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}compact`) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  return {
    handled: true,
    response: await context.promptQueue.enqueue(async () => {
      await effectiveSession.session.compact();
      return `Compaction finished for session ${effectiveSession.session.sessionId}.`;
    }),
  };
}

async function handleReloadCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}reload`) {
    return null;
  }

  return {
    handled: true,
    response: await context.promptQueue.enqueue(async () => {
      return context.agentService.resources.reloadResources();
    }),
  };
}

async function handleAbortCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}abort`) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const queueStatus = context.promptQueue.getSnapshot();
  context.promptQueue.markAbort();
  const clearedCount = context.promptQueue.cancelPending();
  await effectiveSession.session.abort();

  let response = "Aborted the active run.";
  if (!queueStatus.busy && clearedCount === 0) {
    response = "Nothing was running or queued.";
  } else if (!queueStatus.busy && clearedCount > 0) {
    response = `Cleared ${clearedCount} queued request(s).`;
  } else if (clearedCount > 0) {
    response = `Aborted the active run and cleared ${clearedCount} queued request(s).`;
  }

  return {
    handled: true,
    response,
  };
}

async function handleSessionResetCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}session reset` &&
    !trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}session reset `)
  ) {
    return null;
  }

  const target = trimmedInput
    .slice(`${INTERNAL_COMMAND_PREFIX}session reset`.length)
    .trim();
  if (!target) {
    return {
      handled: true,
      response: `Usage: ${formatCommandUsage(context, "session reset <scope|here>")}`,
    };
  }

  if (!context.sessionRegistry) {
    return {
      handled: true,
      response:
        "Session reset is unavailable because the session registry is not configured.",
    };
  }

  const scope = resolveSessionResetScope(target, context.scope);
  if (!scope) {
    return {
      handled: true,
      response:
        `Unknown session scope: ${target}\n` +
        `Supported scopes: dm, thread:<id>, job:<id>, or here`,
    };
  }

  await context.sessionRegistry.reset(scope);
  return {
    handled: true,
    response:
      scope === context.scope
        ? `Reset session data for ${scope}. The next message will start a fresh session.`
        : `Reset session data for ${scope}.`,
  };
}

async function handleReactionCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}reaction` &&
    !trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}reaction `)
  ) {
    return null;
  }

  const parts = trimmedInput.split(" ");
  if (parts.length === 1) {
    return {
      handled: true,
      response:
        `Current working reaction: ${context.workingEmoji}\n` +
        `Usage: ${formatCommandUsage(context, "reaction <emoji>")} to change it.\n` +
        `Examples: ${formatCommandUsage(context, "reaction 🔄")} or ${formatCommandUsage(context, "reaction ⏳")}`,
    };
  }

  const emoji = parts.slice(1).join(" ").trim();

  if (!emoji) {
    return {
      handled: true,
      response: `Please provide an emoji. Example: ${formatCommandUsage(context, "reaction 🔄")}`,
    };
  }

  return {
    handled: true,
    workingEmoji: emoji,
    response: `Working reaction emoji set to ${emoji}`,
  };
}

async function handleJobsCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
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
    const jobs = context.taskScheduler.listJobs();

    return {
      handled: true,
      response: formatJobsResponse(reloadedStatus, jobs, [
        "Task scheduler reloaded.",
      ]),
    };
  }

  const status = context.taskScheduler.getStatus();
  const jobs = context.taskScheduler.listJobs();

  return {
    handled: true,
    response: formatJobsResponse(status, jobs),
  };
}

function formatJobsResponse(
  status: TaskSchedulerStatus,
  jobs: Array<TaskJobRuntimeState>,
  prefixLines: Array<string> = [],
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

const RESERVED_JOB_SUBCOMMANDS = new Set(["run", "run-here", "info", "update"]);

type RunScheduledJobCommandOptions = {
  runHere: boolean;
};

async function runScheduledJobCommand(
  jobId: string,
  context: CommandContext,
  options: RunScheduledJobCommandOptions,
): Promise<CommandResult> {
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
  context: CommandContext,
): Promise<CommandResult | null> {
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
  context: CommandContext,
): Promise<CommandResult | null> {
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
  context: CommandContext,
): Promise<CommandResult | null> {
  const parts = trimmedInput.split(/\s+/);
  if (parts[0] !== `${INTERNAL_COMMAND_PREFIX}job`) {
    return null;
  }

  if (parts.length !== 2) {
    return null;
  }

  if (RESERVED_JOB_SUBCOMMANDS.has(parts[1])) {
    return null;
  }

  return runScheduledJobCommand(parts[1], context, {
    runHere: true,
  });
}

async function handleRemindCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
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
      timeZone: context.promptTimeZone ?? "UTC",
      locale: context.promptLocale ?? "en-AU",
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
        // We always target the current Discord conversation. In DMs,
        // message.channel.id is the DM channel ID. In forum threads, it is the
        // thread ID.
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
  context: CommandContext,
): Promise<CommandResult | null> {
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
  if (!result) {
    return "logs";
  }

  if (result.target === "logs") {
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
): string {
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
  const promptLines = prompt.replace(/\r\n/g, "\n").split("\n");

  return ["prompt:", ...promptLines.map((line) => `  ${line}`)];
}

function formatJobSource(source: TaskJobRuntimeState["source"]): string {
  return source;
}

function formatJobModel(job: TaskJobRuntimeState): string {
  const effectiveModel = `${job.effectiveModel.provider}/${job.effectiveModel.id}`;

  if (!job.model) {
    return `default (${effectiveModel})`;
  }

  return effectiveModel;
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

const commandHandlers: CommandHandler[] = [
  handleHelpCommand,
  handleArchiveCommand,
  handleStatusCommand,
  handleThinkingCommand,
  handleModelCommand,
  handleCompactCommand,
  handleSessionResetCommand,
  handleAbortCommand,
  handleReloadCommand,
  handleRemindCommand,
  handleJobsCommand,
  handleJobUpdateCommand,
  handleJobRunCommand,
  handleJobImplicitRunHereCommand,
  handleJobInfoCommand,
  handleReactionCommand,
];

export async function executeSessionCommand(
  input: string,
  context: CommandContext,
): Promise<CommandResult> {
  const trimmedInput = input.trim();
  const normalizedCommandInput = normalizeCommandInput(
    trimmedInput,
    context.commandPrefixes ?? [INTERNAL_COMMAND_PREFIX],
  );
  if (!normalizedCommandInput) {
    return { handled: false };
  }

  for (const handler of commandHandlers) {
    const result = await handler(normalizedCommandInput, context);
    if (result) {
      return result;
    }
  }

  return {
    handled: true,
    response:
      `Unknown command: ${trimmedInput}. ` +
      `Try ${formatCommandUsage(context, "help")}.`,
  };
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

function resolveSessionResetScope(
  value: string,
  currentScope: SessionScope,
): SessionScope | null {
  if (value === "here") {
    return currentScope;
  }

  if (
    value === "dm" ||
    value.startsWith("thread:") ||
    value.startsWith("job:")
  ) {
    return value as SessionScope;
  }

  return null;
}

function stringifyCommandError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
