import path from "node:path";
import dotenv from "dotenv";
import type {
  DiscordGatewayConfig,
  ResolvedDiscordGatewayConfig,
  ThinkingLevel,
} from "./types";

export function resolveConfig(
  config: DiscordGatewayConfig,
): ResolvedDiscordGatewayConfig {
  const discordAllowedUserId = requireNonEmptyConfigValue(
    "discordAllowedUserId",
    config.discordAllowedUserId,
  );

  return {
    discordBotToken: requireNonEmptyConfigValue(
      "discordBotToken",
      config.discordBotToken,
    ),
    discordAllowedUserId,
    cwd: requireNonEmptyConfigValue("cwd", config.cwd),
    agentDir: config.agentDir?.trim() || path.join(config.cwd, ".pi-agent"),
    modelProvider: config.modelProvider?.trim() || "openrouter",
    modelId: config.modelId?.trim() || "anthropic/claude-3.5-haiku",
    thinkingLevel: parseThinkingLevel(config.thinkingLevel) || "medium",
    promptTimeZone: config.promptTimeZone?.trim() || "UTC",
    promptLocale: config.promptLocale?.trim() || "en-AU",
    promptTransform: config.promptTransform || identityPromptTransform,
    startupMessage:
      config.startupMessage === undefined
        ? "Bot is online and ready."
        : config.startupMessage,
    shutdownOnSignals: config.shutdownOnSignals ?? true,
    visionModelId: config.visionModelId?.trim() || null,
    discordAllowedForumChannelIds: config.discordAllowedForumChannelIds ?? [],
    discordAllowedUserIds: config.discordAllowedUserIds ?? [discordAllowedUserId],
  };
}

export function loadDiscordGatewayConfigFromEnv(
  overrides: Partial<DiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  dotenv.config();

  return resolveConfig({
    discordBotToken:
      overrides.discordBotToken || process.env.DISCORD_BOT_TOKEN || "",
    discordAllowedUserId:
      overrides.discordAllowedUserId ||
      process.env.DISCORD_ALLOWED_USER_ID ||
      "",
    cwd: overrides.cwd || process.env.PI_AGENT_CWD || process.cwd(),
    agentDir: overrides.agentDir || process.env.PI_AGENT_DIR,
    modelProvider: overrides.modelProvider || process.env.PI_MODEL_PROVIDER,
    modelId: overrides.modelId || process.env.PI_MODEL_ID,
    thinkingLevel: parseThinkingLevel(
      overrides.thinkingLevel || process.env.PI_THINKING_LEVEL,
    ),
    promptTimeZone: overrides.promptTimeZone || process.env.PI_PROMPT_TIME_ZONE,
    promptLocale: overrides.promptLocale || process.env.PI_PROMPT_LOCALE,
    promptTransform: overrides.promptTransform,
    startupMessage: overrides.startupMessage ?? readStartupMessageFromEnv(),
    shutdownOnSignals: overrides.shutdownOnSignals,
    visionModelId: overrides.visionModelId ?? process.env.PI_VISION_MODEL_ID,
    discordAllowedForumChannelIds:
      overrides.discordAllowedForumChannelIds ??
      parseStringArrayFromEnv("DISCORD_FORUM_CHANNEL_IDS") ??
      [],
    discordAllowedUserIds:
      overrides.discordAllowedUserIds ??
      parseStringArrayFromEnv("DISCORD_ALLOWED_USER_IDS"),
  });
}

function requireNonEmptyConfigValue(name: string, value: string): string {
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

function parseThinkingLevel(
  value: string | undefined,
): ThinkingLevel | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  const validLevels: ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ];

  if (validLevels.includes(trimmed as ThinkingLevel)) {
    return trimmed as ThinkingLevel;
  }

  return undefined;
}

function identityPromptTransform(input: string): string {
  return input;
}

function parseStringArrayFromEnv(key: string): string[] | undefined {
  const value = process.env[key];
  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

