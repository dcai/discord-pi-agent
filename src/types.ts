import type { Client } from "discord.js";

/** Context object passed to promptTransform so consumers can optionally
 * wrap the raw content with Discord metadata. */
export type PromptTransformContext = {
  /** The raw user content without any XML wrapping. */
  rawContent: string;
  /** XML string with Discord message metadata (context JSON block). */
  discordMetadata: string;
  /** Returns current datetime formatted using the gateway config's
   * promptTimeZone and promptLocale, wrapped in a <datetime> tag. */
  now: () => string;
  /** Returns rawContent wrapped in a <user_message> tag. */
  userMessage: () => string;
};

export type PromptTransform = (
  ctx: PromptTransformContext,
) => string | Promise<string>;

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type CommandRegistrationScope = "none" | "global" | "guild";

export type DiscordGatewayConfig = {
  discordBotToken: string;
  discordAllowedUserId: string;
  cwd: string;
  agentDir?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  promptTimeZone?: string;
  promptLocale?: string;
  promptTransform?: PromptTransform;
  startupMessage?: string | false;
  shutdownOnSignals?: boolean;
  /**
   * Vision model to use for describing images when the main model
   * lacks vision support. Format: "provider/modelId"
   * (e.g. "openrouter/google/gemini-2.5-flash").
   * Defaults to null (image handling disabled).
   */
  visionModelId?: string | null;
  /** Which forum channels the bot responds in (absent = forum disabled). */
  discordAllowedForumChannelIds?: string[];
  /** Which users can interact in forum threads (defaults to [discordAllowedUserId]). */
  discordAllowedUserIds?: string[];
  /** Accepted message command prefixes (defaults to ["!"]). */
  discordCommandPrefixes?: string[];
  /**
   * Optional slash command sync mode.
   * - "none": do not auto-register commands
   * - "global": sync commands globally
   * - "guild": sync commands to the guild IDs below
   */
  discordCommandRegistrationScope?: CommandRegistrationScope;
  /** Guild IDs used when discordCommandRegistrationScope is "guild". */
  discordCommandRegistrationGuildIds?: string[];
};

export type EveryMinutesTaskSchedule = {
  type: "every-minutes";
  interval: number;
};

export type DailyAtTaskSchedule = {
  type: "daily-at";
  hour: number;
  minute: number;
  timeZone?: string;
};

export type TaskSchedule = EveryMinutesTaskSchedule | DailyAtTaskSchedule;

export type RunAtTaskSchedule = {
  type: "run-at";
  runAt: string;
};

export type TaskJobSchedule = TaskSchedule | RunAtTaskSchedule;

export type TaskResultTarget =
  | {
      target: "logs";
    }
  | {
      target: "discord-dm";
      userId: string;
    }
  | {
      target: "discord-channel";
      channelId: string;
    };

export type TaskSessionScope = "dm" | `thread:${string}` | `job:${string}`;

export type TaskSessionStrategy = "fresh" | "reuse" | "ephemeral";

export type TaskSessionTarget =
  | {
      strategy?: "fresh" | "reuse";
      scope?: TaskSessionScope;
    }
  | {
      strategy: "ephemeral";
      scope?: undefined;
    };

export type TaskModelTarget = {
  provider: string;
  id: string;
};

export type ScheduledTaskDefinition = {
  id: string;
  prompt: string;
  description?: string;
  schedule: TaskSchedule;
  /**
   * Session execution for this job.
   *
   * Omit for the default: a fresh dedicated persistent session under
   * sessions/job-<id>/.
   */
  session?: TaskSessionTarget;
  /**
   * Optional model override for this job. Omit to use the gateway default
   * model from the resolved config.
   */
  model?: TaskModelTarget;
  result?: TaskResultTarget;
};

export type TaskSchedulerConfig = {
  jobsFile: string;
};

export type ResolvedTaskSchedulerConfig = {
  jobsFile: string;
};

export type StartDiscordGatewayOptions = {
  scheduler?: TaskSchedulerConfig;
};

export type ResolvedDiscordGatewayConfig = {
  discordBotToken: string;
  discordAllowedUserId: string;
  cwd: string;
  agentDir: string;
  modelProvider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  promptTimeZone: string;
  promptLocale: string;
  promptTransform: PromptTransform;
  startupMessage: string | false;
  shutdownOnSignals: boolean;
  /** Vision model provider/modelId for image description (null = disabled). */
  visionModelId: string | null;
  discordAllowedForumChannelIds: string[];
  discordAllowedUserIds: string[];
  discordCommandPrefixes: string[];
  discordCommandRegistrationScope: CommandRegistrationScope;
  discordCommandRegistrationGuildIds: string[];
};

export type ScheduledJobsContext = {
  config: ResolvedDiscordGatewayConfig;
  schedulerConfig: ResolvedTaskSchedulerConfig;
};

export type LoadScheduleJobs = (
  context: ScheduledJobsContext,
) => ScheduledTaskDefinition[] | Promise<ScheduledTaskDefinition[]>;

export type ContextUsageStatus = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
};

export type AgentStatus = {
  sessionId: string;
  sessionFile: string | undefined;
  model: string;
  streaming: boolean;
  contextUsage: ContextUsageStatus | undefined;
  thinkingInfo: string;
};

export type GatewayAccessConfig = {
  discordAllowedUserId: string;
  discordAllowedForumChannelIds: string[];
  discordAllowedUserIds: string[];
  startupMessage: string | false;
};

export type TaskSchedulerStatus = {
  jobsFile: string;
  jobCount: number;
  nextTickAt: string | null;
  running: boolean;
};

export type TaskJobSource = "file" | "runtime";

export type TaskJobRuntimeState = {
  id: string;
  prompt: string;
  description?: string;
  source: TaskJobSource;
  schedule: TaskJobSchedule;
  session: TaskSessionTarget | undefined;
  model: TaskModelTarget | undefined;
  effectiveModel: TaskModelTarget;
  result: TaskResultTarget | undefined;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  running: boolean;
};

export type CreateRuntimeReminderInput = {
  id: string;
  prompt: string;
  runAt: string;
  description?: string;
  session?: TaskSessionTarget;
  result: TaskResultTarget;
};

export type DiscordGateway = {
  client: Client;
  stop: () => Promise<void>;
  getStatus: () => AgentStatus;
  getTaskSchedulerStatus: () => TaskSchedulerStatus | null;
};

export type TaskScheduler = {
  client: Client | null;
  stop: () => Promise<void>;
  getAgentStatus: () => AgentStatus;
  getTaskSchedulerStatus: () => TaskSchedulerStatus;
};
