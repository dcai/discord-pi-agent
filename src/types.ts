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
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type CommandRegistrationScope = "none" | "global" | "guild";

export type CommandUsageSurface =
  "prefix" | "slash" | "button" | "modal" | "scheduled";

export type CommandUsageOutcome =
  "success" | "failed" | "cancelled" | "forwarded";

export type CommandUsageEvent = {
  eventId: string;
  occurredAt: string;
  commandId: string;
  surface: CommandUsageSurface;
  alias?: string;
  resourceName?: string;
  scopeType: "dm" | "thread" | "job";
  outcome: CommandUsageOutcome;
  durationMs: number;
};

export type CommandUsageOptions = {
  record: (event: CommandUsageEvent) => void | Promise<void>;
};

export type AudioTranscriptionConfig = {
  /** Provider for audio transcription (e.g. "openai"). Default: "openai". */
  provider?: string;
  /** Model ID for transcription (e.g. "gpt-4o-mini-transcribe"). Default: "gpt-4o-mini-transcribe". */
  model?: string;
  /** API key for the transcription service. */
  apiKey?: string;
  /** Custom endpoint URL for the transcription API (defaults to provider's standard endpoint). */
  endpoint?: string;
  /** Executable used to convert Discord audio formats unsupported by OpenAI. Defaults to "ffmpeg". */
  ffmpegPath?: string;
  /** Optional context for the transcription model, such as names and technical terms. */
  transcriptionPrompt?: string;
  /** Optional extra prompt guidance for transcript cleanup.
   * The cleanup pass keeps the same language and returns only the cleaned text. */
  prompt?: string;
  /** Whether to send the cleaned transcript back into Discord as a quick reference.
   * Defaults to true. */
  echoToDiscord?: boolean;
};

export type ResolvedAudioTranscriptionConfig = {
  enabled: boolean;
  provider: string;
  model: string;
  apiKey: string | null;
  endpoint: string | null;
  ffmpegPath: string;
  transcriptionPrompt?: string;
  prompt?: string;
  echoToDiscord: boolean;
};

export type ReplyReflectionConfig =
  | boolean
  | {
      enabled?: boolean;
      maxFollowUpLength?: number;
      /** Optional host-specific guidance appended to the default review prompt. */
      instructions?: string;
    };

export type ResolvedReplyReflectionConfig = {
  enabled: boolean;
  maxFollowUpLength: number;
  instructions?: string;
};

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
  /** Optional second-pass reflection that can send one extra follow-up message. */
  replyReflection?: ReplyReflectionConfig;
  /** Audio transcription config. Enabled by default.
   * Audio attachments (.mp3, .wav, etc.) are transcribed to text via a
   * third-party API and included in the prompt.
   * Set to false to disable.
   * Default model: gpt-4o-mini-transcribe (cheapest + better WER than whisper-1). */
  audioTranscription?: AudioTranscriptionConfig | false;
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
  timeZone?: string;
  daysOfWeek?: TaskScheduleDayOfWeek[];
  startTime?: string;
  endTime?: string;
};

export type DailyAtTaskSchedule = {
  type: "daily-at";
  hour: number;
  minute: number;
  timeZone?: string;
  daysOfWeek?: TaskScheduleDayOfWeek[];
};

export type TaskScheduleDayOfWeek =
  "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

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
  commandUsage?: CommandUsageOptions;
};

export type StartTaskSchedulerOptions = {
  commandUsage?: CommandUsageOptions;
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
  replyReflection: ResolvedReplyReflectionConfig;
  audioTranscription: ResolvedAudioTranscriptionConfig;
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

export type GatewayAccessConfig = Pick<
  ResolvedDiscordGatewayConfig,
  | "discordAllowedUserId"
  | "discordAllowedForumChannelIds"
  | "discordAllowedUserIds"
  | "startupMessage"
>;

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
