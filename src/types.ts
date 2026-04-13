import type { Client } from "discord.js";

export type PromptTransform = (input: string) => string | Promise<string>;

export type DiscordPiBridgeConfig = {
	discordBotToken: string;
	discordAllowedUserId: string;
	cwd: string;
	agentDir?: string;
	modelProvider?: string;
	modelId?: string;
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
	promptTransform: PromptTransform;
	startupMessage: string | false;
	shutdownOnSignals: boolean;
};

export type AgentStatus = {
	sessionId: string;
	sessionFile: string | undefined;
	model: string;
	streaming: boolean;
};

export type DiscordPiBridge = {
	client: Client;
	stop: () => Promise<void>;
	getStatus: () => AgentStatus;
};
