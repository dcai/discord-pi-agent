import type { Client } from "discord.js";

export type PromptTransform = (input: string) => string | Promise<string>;

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

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
};

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

export type DiscordGateway = {
  client: Client;
  stop: () => Promise<void>;
  getStatus: () => AgentStatus;
};
