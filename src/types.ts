import type { Client } from "discord.js";

export type PromptTransform = (input: string) => string | Promise<string>;

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type DiscordPiBridgeConfig = {
  discordBotToken: string;
  discordAllowedUserId: string;
  cwd: string;
  agentDir?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  promptTransform?: PromptTransform;
  startupMessage?: string | false;
  shutdownOnSignals?: boolean;
};

export type ResolvedDiscordPiBridgeConfig = {
  discordBotToken: string;
  discordAllowedUserId: string;
  cwd: string;
  agentDir: string;
  modelProvider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  promptTransform: PromptTransform;
  startupMessage: string | false;
  shutdownOnSignals: boolean;
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

export type DiscordPiBridge = {
  client: Client;
  stop: () => Promise<void>;
  getStatus: () => AgentStatus;
};

export type DiscordGatewayConfig = DiscordPiBridgeConfig & {
  /** Which forum channels the bot responds in (absent = forum disabled). */
  discordAllowedForumChannelIds?: string[];
  /** Which users can interact in forum threads (defaults to [discordAllowedUserId]). */
  discordAllowedUserIds?: string[];
  /** Auto-shutdown idle thread sessions after this many ms. */
  sessionIdleTimeoutMs?: number;
};

export type ResolvedDiscordGatewayConfig = ResolvedDiscordPiBridgeConfig & {
  discordAllowedForumChannelIds: string[];
  discordAllowedUserIds: string[];
  sessionIdleTimeoutMs: number | null;
};

export type DiscordGateway = {
  client: Client;
  stop: () => Promise<void>;
  getStatus: () => AgentStatus;
};
