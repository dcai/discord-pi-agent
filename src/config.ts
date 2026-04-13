import path from "node:path";
import dotenv from "dotenv";
import type { DiscordPiBridgeConfig, ResolvedDiscordPiBridgeConfig } from "./types";

export function resolveConfig(config: DiscordPiBridgeConfig): ResolvedDiscordPiBridgeConfig {
	return {
		discordBotToken: readRequiredValue("discordBotToken", config.discordBotToken),
		discordAllowedUserId: readRequiredValue("discordAllowedUserId", config.discordAllowedUserId),
		cwd: readRequiredValue("cwd", config.cwd),
		agentDir: config.agentDir?.trim() || path.join(config.cwd, ".pi-agent"),
		modelProvider: config.modelProvider?.trim() || "moonshot-cn",
		modelId: config.modelId?.trim() || "kimi-k2.5",
		promptTransform: config.promptTransform || identityPromptTransform,
		startupMessage: config.startupMessage === undefined ? "Bot is online and ready." : config.startupMessage,
		shutdownOnSignals: config.shutdownOnSignals ?? true,
	};
}

export function loadDiscordPiBridgeConfigFromEnv(
	overrides: Partial<DiscordPiBridgeConfig> = {},
): ResolvedDiscordPiBridgeConfig {
	dotenv.config();

	return resolveConfig({
		discordBotToken: overrides.discordBotToken || process.env.DISCORD_BOT_TOKEN || "",
		discordAllowedUserId: overrides.discordAllowedUserId || process.env.DISCORD_ALLOWED_USER_ID || "",
		cwd: overrides.cwd || process.env.PI_AGENT_CWD || process.cwd(),
		agentDir: overrides.agentDir || process.env.PI_AGENT_DIR,
		modelProvider: overrides.modelProvider || process.env.PI_MODEL_PROVIDER,
		modelId: overrides.modelId || process.env.PI_MODEL_ID,
		promptTransform: overrides.promptTransform,
		startupMessage: overrides.startupMessage ?? readStartupMessageFromEnv(),
		shutdownOnSignals: overrides.shutdownOnSignals,
	});
}

function readRequiredValue(name: string, value: string): string {
	const trimmedValue = value.trim();

	if (!trimmedValue) {
		throw new Error(`Missing required config value: ${name}`);
	}

	return trimmedValue;
}

function readStartupMessageFromEnv(): string | false | undefined {
	const value = process.env.DISCORD_STARTUP_MESSAGE;

	if (value === undefined) {
		return undefined;
	}

	const trimmedValue = value.trim();
	if (!trimmedValue || trimmedValue.toLowerCase() === "false") {
		return false;
	}

	return trimmedValue;
}

function identityPromptTransform(input: string): string {
	return input;
}
