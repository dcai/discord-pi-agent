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
