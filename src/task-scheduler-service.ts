import { createModuleLogger } from "./logger";
import { wrapXmlTag, formatDiscordPromptTime } from "./prompt-context";
import { runAgentTurn } from "./agent-turn-runner";
import type { SessionScope, SessionRegistry } from "./session-registry";
import type {
  ResolvedDiscordGatewayConfig,
  ResolvedTaskSchedulerConfig,
  ScheduledTaskDefinition,
  TaskSchedulerStatus,
} from "./types";
import { ScheduledJobDeliveryService } from "./scheduled-job-delivery";

const logger = createModuleLogger("task-scheduler-service");

type TaskSchedulerServiceOptions = {
  config: ResolvedDiscordGatewayConfig;
  schedulerConfig: ResolvedTaskSchedulerConfig;
  jobs: ScheduledTaskDefinition[];
  sessionRegistry: SessionRegistry;
  deliveryService: ScheduledJobDeliveryService;
};

type RunDecision = {
  due: boolean;
  runKey: string;
};

export class TaskSchedulerService {
  private readonly config: ResolvedDiscordGatewayConfig;
  private readonly schedulerConfig: ResolvedTaskSchedulerConfig;
  private readonly jobs: ScheduledTaskDefinition[];
  private readonly sessionRegistry: SessionRegistry;
  private deliveryService: ScheduledJobDeliveryService;
  private readonly lastRunKeys = new Map<string, string>();
  private timeoutId: NodeJS.Timeout | null = null;
  private nextTickAt: Date | null = null;
  private running = false;

  constructor(options: TaskSchedulerServiceOptions) {
    this.config = options.config;
    this.schedulerConfig = options.schedulerConfig;
    this.jobs = options.jobs;
    this.sessionRegistry = options.sessionRegistry;
    this.deliveryService = options.deliveryService;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    logger.info(
      {
        jobsFile: this.schedulerConfig.jobsFile,
        jobCount: this.jobs.length,
      },
      "task scheduler started",
    );
    this.scheduleNextTick();
  }

  getStatus(): TaskSchedulerStatus {
    return {
      jobsFile: this.schedulerConfig.jobsFile,
      jobCount: this.jobs.length,
      nextTickAt: this.nextTickAt ? this.nextTickAt.toISOString() : null,
      running: this.running,
    };
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
    return this.jobs.some((job) => {
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
    const dueJobs = this.jobs
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

  private getRunDecision(
    job: ScheduledTaskDefinition,
    now: Date,
  ): RunDecision {
    if (job.schedule.type === "every-minutes") {
      const minuteKey = String(Math.floor(now.getTime() / 60_000));
      const due = Number(minuteKey) % job.schedule.interval === 0;

      return {
        due: due && this.lastRunKeys.get(job.id) !== minuteKey,
        runKey: minuteKey,
      };
    }

    const timeZone = job.schedule.timeZone ?? this.config.promptTimeZone;
    const parts = getTimeParts(now, timeZone);
    const runKey = `${parts.year}-${parts.month}-${parts.day}`;
    const due =
      parts.hour === job.schedule.hour &&
      parts.minute === job.schedule.minute &&
      this.lastRunKeys.get(job.id) !== runKey;

    return {
      due,
      runKey,
    };
  }

  private async runJob(job: ScheduledTaskDefinition, now: Date): Promise<void> {
    const scope = resolveJobScope(job);
    logger.info({ jobId: job.id, scope }, "running scheduled job");

    try {
      const { entry } = await this.sessionRegistry.getOrCreate(scope);
      const prompt = await buildTaskPrompt(job, this.config, now);
      const response = await entry.promptQueue.enqueue(async () => {
        return runAgentTurn(entry.session, prompt);
      });

      await this.deliveryService.deliverResult(job, response);
      logger.info({ jobId: job.id, scope }, "scheduled job finished");
    } catch (error) {
      await this.deliveryService.deliverError(job, error);
    }
  }
}

function resolveJobScope(job: ScheduledTaskDefinition): SessionScope {
  const session = job.session;

  if (!session || session.strategy === "dedicated") {
    return `job:${job.id}`;
  }

  return session.strategy === "scope" ? session.scope : `job:${job.id}`;
}

async function buildTaskPrompt(
  job: ScheduledTaskDefinition,
  config: ResolvedDiscordGatewayConfig,
  now: Date,
): Promise<string> {
  const prompt = job.prompt;
  const timeZone =
    job.schedule.type === "daily-at"
      ? job.schedule.timeZone ?? config.promptTimeZone
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

function getTimeParts(date: Date, timeZone: string): {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
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
    hour: Number(requirePart(parts, "hour")),
    minute: Number(requirePart(parts, "minute")),
  };
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
