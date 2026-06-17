import { createModuleLogger } from "./logger";
import { wrapXmlTag, formatDiscordPromptTime } from "./prompt-context";
import { runAgentTurn } from "./agent-turn-runner";
import type { AgentService } from "./agent-service";
import type { SessionScope, SessionRegistry } from "./session-registry";
import type {
  CreateRuntimeReminderInput,
  DailyAtTaskSchedule,
  ResolvedDiscordGatewayConfig,
  ResolvedTaskSchedulerConfig,
  RunAtTaskSchedule,
  EveryMinutesTaskSchedule,
  ScheduledTaskDefinition,
  TaskModelTarget,
  TaskJobRuntimeState,
  TaskJobSource,
  TaskJobSchedule,
  TaskSchedulerStatus,
  TaskResultTarget,
  TaskSessionStrategy,
  TaskSessionTarget,
} from "./types";
import { ScheduledJobDeliveryService } from "./scheduled-job-delivery";
import { loadScheduledJobs } from "./scheduled-job-loader";

const logger = createModuleLogger("task-scheduler-service");
const weekDayOrder = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type TaskSchedulerServiceOptions = {
  config: ResolvedDiscordGatewayConfig;
  schedulerConfig: ResolvedTaskSchedulerConfig;
  jobs: ScheduledTaskDefinition[];
  agentService: AgentService;
  sessionRegistry: SessionRegistry;
  deliveryService: ScheduledJobDeliveryService;
};

type RunDecision = {
  due: boolean;
  runKey: string;
};

type JobRunResult = {
  ok: boolean;
  errorMessage: string | null;
};

type RunJobNowOptions = {
  resultOverride?: TaskResultTarget;
  now?: Date;
};

type MutableJobState = {
  definition: ManagedJobDefinition;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  running: boolean;
};

type FileBackedJobDefinition = ScheduledTaskDefinition & {
  source: "file";
};

type RuntimeReminderJobDefinition = {
  id: string;
  prompt: string;
  description?: string;
  schedule: RunAtTaskSchedule;
  session?: TaskSessionTarget;
  model?: undefined;
  result: TaskResultTarget;
  source: "runtime";
  deleteAfterRun: true;
};

type ManagedJobDefinition =
  | FileBackedJobDefinition
  | RuntimeReminderJobDefinition;

export class TaskSchedulerService {
  private readonly config: ResolvedDiscordGatewayConfig;
  private readonly schedulerConfig: ResolvedTaskSchedulerConfig;
  private fileJobs: FileBackedJobDefinition[];
  private readonly runtimeJobs = new Map<
    string,
    RuntimeReminderJobDefinition
  >();
  private readonly agentService: AgentService;
  private readonly sessionRegistry: SessionRegistry;
  private deliveryService: ScheduledJobDeliveryService;
  private jobStates = new Map<string, MutableJobState>();
  private readonly lastRunKeys = new Map<string, string>();
  private timeoutId: NodeJS.Timeout | null = null;
  private nextTickAt: Date | null = null;
  private running = false;

  constructor(options: TaskSchedulerServiceOptions) {
    this.config = options.config;
    this.schedulerConfig = options.schedulerConfig;
    this.fileJobs = options.jobs.map(asFileBackedJob);
    this.agentService = options.agentService;
    this.sessionRegistry = options.sessionRegistry;
    this.deliveryService = options.deliveryService;
    this.jobStates = buildJobStateMap(this.getAllJobs(), this.jobStates);
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    logger.info(
      {
        jobsFile: this.schedulerConfig.jobsFile,
        jobCount: this.getAllJobs().length,
      },
      "task scheduler started",
    );
    this.scheduleNextTick();
  }

  getStatus(): TaskSchedulerStatus {
    return {
      jobsFile: this.schedulerConfig.jobsFile,
      jobCount: this.getAllJobs().length,
      nextTickAt: this.nextTickAt ? this.nextTickAt.toISOString() : null,
      running: this.running,
    };
  }

  listJobs(now: Date = new Date()): TaskJobRuntimeState[] {
    return this.getAllJobs().map((job) => {
      return this.getJobState(job.id, now);
    });
  }

  getJob(jobId: string, now: Date = new Date()): TaskJobRuntimeState | null {
    return this.jobStates.has(jobId) ? this.getJobState(jobId, now) : null;
  }

  async runJobNow(
    jobId: string,
    options: RunJobNowOptions = {},
  ): Promise<JobRunResult> {
    const jobState = this.jobStates.get(jobId);
    if (!jobState) {
      throw new Error(`Unknown scheduled job: ${jobId}`);
    }

    if (jobState.running) {
      throw new Error(`Scheduled job is already running: ${jobId}`);
    }

    const job = options.resultOverride
      ? ({
          ...jobState.definition,
          result: options.resultOverride,
        } as ManagedJobDefinition)
      : jobState.definition;

    return this.runJob(job, options.now ?? new Date());
  }

  addRuntimeReminder(input: CreateRuntimeReminderInput): TaskJobRuntimeState {
    if (this.jobStates.has(input.id)) {
      throw new Error(`Scheduled job already exists: ${input.id}`);
    }

    if (Number.isNaN(Date.parse(input.runAt))) {
      throw new Error(`Invalid reminder datetime: ${input.runAt}`);
    }

    this.runtimeJobs.set(input.id, {
      id: input.id,
      prompt: input.prompt,
      description: input.description,
      schedule: {
        type: "run-at",
        runAt: input.runAt,
      },
      session: input.session,
      result: input.result,
      source: "runtime",
      deleteAfterRun: true,
    });
    this.syncJobStates();
    logger.info(
      {
        jobId: input.id,
        runAt: input.runAt,
      },
      "runtime reminder added",
    );

    return this.getJobState(input.id, new Date());
  }

  async reload(): Promise<TaskSchedulerStatus> {
    const reloadedJobs = await loadScheduledJobs(this.schedulerConfig, {
      config: this.config,
      schedulerConfig: this.schedulerConfig,
    });
    this.fileJobs = reloadedJobs.map(asFileBackedJob);
    this.syncJobStates();

    logger.info(
      {
        jobsFile: this.schedulerConfig.jobsFile,
        jobCount: this.getAllJobs().length,
      },
      "task scheduler reloaded",
    );

    return this.getStatus();
  }

  stop(): void {
    this.running = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    this.nextTickAt = null;
  }

  setDeliveryService(deliveryService: ScheduledJobDeliveryService): void {
    this.deliveryService = deliveryService;
  }

  usesDiscordDelivery(): boolean {
    return this.getAllJobs().some((job) => {
      return (job.result?.target ?? "logs") !== "logs";
    });
  }

  private scheduleNextTick(): void {
    if (!this.running) {
      return;
    }

    const now = new Date();
    const nextTickAt = new Date(now);
    nextTickAt.setSeconds(0, 0);
    nextTickAt.setMinutes(nextTickAt.getMinutes() + 1);

    this.nextTickAt = nextTickAt;
    this.timeoutId = setTimeout(() => {
      this.timeoutId = null;
      void this.handleTick(new Date());
    }, nextTickAt.getTime() - now.getTime());
  }

  private async handleTick(now: Date): Promise<void> {
    if (!this.running) {
      return;
    }

    this.scheduleNextTick();

    const tickTime = toMinuteBoundary(now);
    const dueJobs = this.getAllJobs()
      .map((job) => {
        return {
          job,
          decision: this.getRunDecision(job, tickTime),
        };
      })
      .filter((entry) => entry.decision.due);

    await Promise.allSettled(
      dueJobs.map(async ({ job, decision }) => {
        this.lastRunKeys.set(job.id, decision.runKey);
        await this.runJob(job, tickTime);
      }),
    );
  }

  private getRunDecision(job: ManagedJobDefinition, now: Date): RunDecision {
    if (job.schedule.type === "every-minutes") {
      const minuteKey = String(Math.floor(now.getTime() / 60_000));
      const due = matchesEveryMinutesSchedule(
        job.schedule,
        minuteKey,
        now,
        this.config.promptTimeZone,
      );

      return {
        due: due && this.lastRunKeys.get(job.id) !== minuteKey,
        runKey: minuteKey,
      };
    }

    if (job.schedule.type === "run-at") {
      return {
        due:
          now.getTime() >= Date.parse(job.schedule.runAt) &&
          this.lastRunKeys.get(job.id) !== job.schedule.runAt,
        runKey: job.schedule.runAt,
      };
    }

    const timeZone = job.schedule.timeZone ?? this.config.promptTimeZone;
    const parts = getTimeParts(now, timeZone);
    const runKey = `${parts.year}-${parts.month}-${parts.day}`;
    const due =
      matchesDailyAtSchedule(job.schedule, parts) &&
      this.lastRunKeys.get(job.id) !== runKey;

    return {
      due,
      runKey,
    };
  }

  private async runJob(
    job: ManagedJobDefinition,
    now: Date,
  ): Promise<JobRunResult> {
    const sessionStrategy = getTaskSessionStrategy(job.session);
    const scope = sessionStrategy === "ephemeral" ? null : resolveJobScope(job);
    const effectiveModel = resolveJobModel(job, this.config);
    const jobState = this.jobStates.get(job.id);
    logger.info(
      {
        jobId: job.id,
        scope,
        sessionStrategy,
        model: `${effectiveModel.provider}/${effectiveModel.id}`,
      },
      "running scheduled job",
    );

    if (jobState?.running) {
      const errorMessage = `Scheduled job is already running: ${job.id}`;
      logger.warn(
        { jobId: job.id, scope, sessionStrategy },
        "scheduled job run skipped because it is already running",
      );
      return {
        ok: false,
        errorMessage,
      };
    }

    if (jobState) {
      jobState.running = true;
      jobState.lastRunAt = now;
      jobState.lastErrorAt = null;
      jobState.lastErrorMessage = null;
    }

    try {
      assertJobModelScopeIsSafe(job, scope);
      const prompt = await buildTaskPrompt(job, this.config, now);
      let response: string;

      if (sessionStrategy === "ephemeral") {
        response = await this.runEphemeralJob(prompt, effectiveModel);
      } else {
        const persistentScope = resolveJobScope(job);
        response = await this.runPersistentJob(
          persistentScope,
          sessionStrategy,
          prompt,
          effectiveModel,
        );
      }

      await this.deliveryService.deliverResult(job, response);
      if (jobState) {
        jobState.lastSuccessAt = now;
      }
      logger.info(
        { jobId: job.id, scope, sessionStrategy },
        "scheduled job finished",
      );
      return {
        ok: true,
        errorMessage: null,
      };
    } catch (error) {
      const errorMessage = stringifyError(error);
      if (jobState) {
        jobState.lastErrorAt = now;
        jobState.lastErrorMessage = errorMessage;
      }
      await this.deliveryService.deliverError(job, error);
      return {
        ok: false,
        errorMessage,
      };
    } finally {
      if (jobState) {
        jobState.running = false;
      }

      if (isRuntimeReminderJob(job)) {
        this.removeRuntimeJob(job.id);
      }
    }
  }

  private async runPersistentJob(
    scope: SessionScope,
    sessionStrategy: "fresh" | "reuse",
    prompt: string,
    model: TaskModelTarget,
  ): Promise<string> {
    const { entry } = await this.sessionRegistry.getOrCreate(scope, {
      reuseExisting: sessionStrategy === "reuse",
    });

    return entry.promptQueue.enqueue(async () => {
      await this.agentService.models.ensureSessionUsesModel(
        entry.session,
        model,
      );
      return runAgentTurn(entry.session, prompt);
    });
  }

  private async runEphemeralJob(
    prompt: string,
    model: TaskModelTarget,
  ): Promise<string> {
    const session = await this.agentService.createTemporarySession({
      thinkingLevel: this.config.thinkingLevel,
    });

    try {
      await this.agentService.models.ensureSessionUsesModel(session, model);
      return runAgentTurn(session, prompt);
    } finally {
      session.dispose();
    }
  }

  private getJobState(jobId: string, now: Date): TaskJobRuntimeState {
    const jobState = this.jobStates.get(jobId);

    if (!jobState) {
      throw new Error(`Unknown scheduled job: ${jobId}`);
    }

    return {
      id: jobState.definition.id,
      prompt: jobState.definition.prompt,
      description: jobState.definition.description,
      source: jobState.definition.source,
      schedule: jobState.definition.schedule,
      session: jobState.definition.session,
      model: jobState.definition.model,
      effectiveModel: resolveJobModel(jobState.definition, this.config),
      result: jobState.definition.result,
      nextRunAt: formatDate(
        findNextRunAt(jobState.definition, now, this.config.promptTimeZone),
      ),
      lastRunAt: formatDate(jobState.lastRunAt),
      lastSuccessAt: formatDate(jobState.lastSuccessAt),
      lastErrorAt: formatDate(jobState.lastErrorAt),
      lastErrorMessage: jobState.lastErrorMessage,
      running: jobState.running,
    };
  }

  private getAllJobs(): ManagedJobDefinition[] {
    return [...this.fileJobs, ...Array.from(this.runtimeJobs.values())];
  }

  private syncJobStates(): void {
    this.jobStates = buildJobStateMap(this.getAllJobs(), this.jobStates);

    for (const jobId of Array.from(this.lastRunKeys.keys())) {
      if (!this.jobStates.has(jobId)) {
        this.lastRunKeys.delete(jobId);
      }
    }
  }

  private removeRuntimeJob(jobId: string): void {
    if (!this.runtimeJobs.delete(jobId)) {
      return;
    }

    this.syncJobStates();
    logger.info({ jobId }, "runtime reminder removed");
  }
}

function resolveJobScope(job: ManagedJobDefinition): SessionScope {
  const session = job.session;

  if (session?.strategy === "ephemeral") {
    throw new Error(`Ephemeral jobs do not have a persistent scope: ${job.id}`);
  }

  return session?.scope ?? `job:${job.id}`;
}

function getTaskSessionStrategy(
  session: TaskSessionTarget | undefined,
): TaskSessionStrategy {
  if (session?.strategy === "ephemeral") {
    return "ephemeral";
  }

  return session?.strategy ?? "fresh";
}

function resolveJobModel(
  job: ManagedJobDefinition,
  config: ResolvedDiscordGatewayConfig,
): TaskModelTarget {
  return (
    job.model ?? {
      provider: config.modelProvider,
      id: config.modelId,
    }
  );
}

function assertJobModelScopeIsSafe(
  job: ManagedJobDefinition,
  scope: SessionScope | null,
): void {
  if (!job.model || !scope) {
    return;
  }

  if (scope === "dm" || scope.startsWith("thread:")) {
    throw new Error(
      `Scheduled job model overrides are not supported with shared session scope "${scope}" for job "${job.id}". Use a dedicated job:<id> scope or omit model to use the default gateway model.`,
    );
  }
}

async function buildTaskPrompt(
  job: ManagedJobDefinition,
  config: ResolvedDiscordGatewayConfig,
  now: Date,
): Promise<string> {
  const prompt = job.prompt;
  const timeZone =
    job.schedule.type === "daily-at" || job.schedule.type === "every-minutes"
      ? (job.schedule.timeZone ?? config.promptTimeZone)
      : config.promptTimeZone;

  return config.promptTransform({
    rawContent: prompt,
    discordMetadata: "",
    now: () => {
      return wrapXmlTag(
        "datetime",
        formatDiscordPromptTime(now, {
          timeZone,
          locale: config.promptLocale,
        }),
      );
    },
    userMessage: () => {
      return wrapXmlTag("user_message", prompt);
    },
  });
}

function toMinuteBoundary(date: Date): Date {
  const normalizedDate = new Date(date);
  normalizedDate.setSeconds(0, 0);
  return normalizedDate;
}

function getTimeParts(
  date: Date,
  timeZone: string,
): {
  year: string;
  month: string;
  day: string;
  dayOfWeek: (typeof weekDayOrder)[number];
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);

  return {
    year: requirePart(parts, "year"),
    month: requirePart(parts, "month"),
    day: requirePart(parts, "day"),
    dayOfWeek: normalizeWeekDay(requirePart(parts, "weekday")),
    hour: Number(requirePart(parts, "hour")),
    minute: Number(requirePart(parts, "minute")),
  };
}

function normalizeWeekDay(value: string): (typeof weekDayOrder)[number] {
  const normalizedValue = value.toLowerCase().slice(0, 3);

  if (weekDayOrder.includes(normalizedValue as (typeof weekDayOrder)[number])) {
    return normalizedValue as (typeof weekDayOrder)[number];
  }

  throw new Error(`Unsupported weekday value: ${value}.`);
}

function requirePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const part = parts.find((entry) => entry.type === type)?.value;

  if (!part) {
    throw new Error(`Missing datetime part ${type}.`);
  }

  return part;
}

function buildJobStateMap(
  jobs: ManagedJobDefinition[],
  previousState: Map<string, MutableJobState>,
): Map<string, MutableJobState> {
  const nextState = new Map<string, MutableJobState>();

  for (const job of jobs) {
    const previousJobState = previousState.get(job.id);

    nextState.set(job.id, {
      definition: job,
      lastRunAt: previousJobState?.lastRunAt ?? null,
      lastSuccessAt: previousJobState?.lastSuccessAt ?? null,
      lastErrorAt: previousJobState?.lastErrorAt ?? null,
      lastErrorMessage: previousJobState?.lastErrorMessage ?? null,
      running: false,
    });
  }

  return nextState;
}

function findNextRunAt(
  job: ManagedJobDefinition,
  now: Date,
  defaultTimeZone: string,
): Date | null {
  if (job.schedule.type === "run-at") {
    const runAt = new Date(job.schedule.runAt);
    return Number.isNaN(runAt.getTime()) ? null : runAt;
  }

  const candidate = toMinuteBoundary(new Date(now));
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let offset = 0; offset < 60 * 24 * 8; offset += 1) {
    const attempt = new Date(candidate);
    attempt.setMinutes(candidate.getMinutes() + offset);

    if (job.schedule.type === "every-minutes") {
      const minuteKey = Math.floor(attempt.getTime() / 60_000);
      if (
        matchesEveryMinutesSchedule(
          job.schedule,
          String(minuteKey),
          attempt,
          defaultTimeZone,
        )
      ) {
        return attempt;
      }
      continue;
    }

    const timeZone = job.schedule.timeZone ?? defaultTimeZone;
    const parts = getTimeParts(attempt, timeZone);
    if (matchesDailyAtSchedule(job.schedule, parts)) {
      return attempt;
    }
  }

  return null;
}

function asFileBackedJob(
  job: ScheduledTaskDefinition,
): FileBackedJobDefinition {
  return {
    ...job,
    source: "file",
  };
}

function isRuntimeReminderJob(
  job: ManagedJobDefinition,
): job is RuntimeReminderJobDefinition {
  return job.source === "runtime";
}

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function matchesDailyAtSchedule(
  schedule: DailyAtTaskSchedule,
  parts: ReturnType<typeof getTimeParts>,
): boolean {
  if (parts.hour !== schedule.hour || parts.minute !== schedule.minute) {
    return false;
  }

  if (!schedule.daysOfWeek?.length) {
    return true;
  }

  return schedule.daysOfWeek.includes(parts.dayOfWeek);
}

function matchesEveryMinutesSchedule(
  schedule: EveryMinutesTaskSchedule,
  minuteKey: string,
  now: Date,
  defaultTimeZone: string,
): boolean {
  if (!usesLocalEveryMinutesRules(schedule)) {
    return Number(minuteKey) % schedule.interval === 0;
  }

  const timeZone = schedule.timeZone ?? defaultTimeZone;
  const parts = getTimeParts(now, timeZone);

  if (
    schedule.daysOfWeek?.length &&
    !schedule.daysOfWeek.includes(parts.dayOfWeek)
  ) {
    return false;
  }

  const currentMinute = parts.hour * 60 + parts.minute;
  const startMinute = schedule.startTime
    ? parseTimeOfDayToMinutes(schedule.startTime)
    : 0;
  const endMinute = schedule.endTime
    ? parseTimeOfDayToMinutes(schedule.endTime)
    : 23 * 60 + 59;

  if (currentMinute < startMinute || currentMinute > endMinute) {
    return false;
  }

  return (currentMinute - startMinute) % schedule.interval === 0;
}

function usesLocalEveryMinutesRules(
  schedule: EveryMinutesTaskSchedule,
): boolean {
  return Boolean(
    schedule.timeZone ||
    schedule.daysOfWeek?.length ||
    schedule.startTime ||
    schedule.endTime,
  );
}

function parseTimeOfDayToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
