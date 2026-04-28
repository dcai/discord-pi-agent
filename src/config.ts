import path from "node:path";
import dotenv from "dotenv";
import type {
  DiscordGatewayConfig,
  DiscordPiBridgeConfig,
  ResolvedDiscordGatewayConfig,
  ResolvedDiscordPiBridgeConfig,
  ThinkingLevel,
} from "./types";

export function resolveConfig(
  config: DiscordPiBridgeConfig,
): ResolvedDiscordPiBridgeConfig {
  return {
    discordBotToken: readRequiredValue(
      "discordBotToken",
      config.discordBotToken,
    ),
    discordAllowedUserId: readRequiredValue(
      "discordAllowedUserId",
      config.discordAllowedUserId,
    ),
    cwd: readRequiredValue("cwd", config.cwd),
    agentDir: config.agentDir?.trim() || path.join(config.cwd, ".pi-agent"),
    modelProvider: config.modelProvider?.trim() || "openrouter",
    modelId: config.modelId?.trim() || "anthropic/claude-3.5-haiku",
    thinkingLevel: parseThinkingLevel(config.thinkingLevel) || "medium",
    promptTransform: config.promptTransform || identityPromptTransform,
    startupMessage:
      config.startupMessage === undefined
        ? "Bot is online and ready."
        : config.startupMessage,
    shutdownOnSignals: config.shutdownOnSignals ?? true,
  };
}

export function loadDiscordPiBridgeConfigFromEnv(
  overrides: Partial<DiscordPiBridgeConfig> = {},
): ResolvedDiscordPiBridgeConfig {
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
    promptTransform: overrides.promptTransform,
    startupMessage: overrides.startupMessage ?? readStartupMessageFromEnv(),
    shutdownOnSignals: overrides.shutdownOnSignals,
  });
}

/**
 * Load gateway config from env vars + overrides.
 * Preserves gateway-specific fields (forum channels, etc.) that
 * loadDiscordPiBridgeConfigFromEnv would drop.
 */
export function loadDiscordGatewayConfigFromEnv(
  overrides: Partial<DiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  const base = loadDiscordPiBridgeConfigFromEnv(overrides);
  return {
    ...base,
    discordAllowedForumChannelIds:
      overrides.discordAllowedForumChannelIds ??
      parseStringArrayFromEnv("DISCORD_FORUM_CHANNEL_IDS") ??
      [],
    discordAllowedUserIds: overrides.discordAllowedUserIds ??
      parseStringArrayFromEnv("DISCORD_ALLOWED_USER_IDS") ?? [
        base.discordAllowedUserId,
      ],
    sessionIdleTimeoutMs:
      overrides.sessionIdleTimeoutMs ??
      parseOptionalIntFromEnv("DISCORD_SESSION_IDLE_TIMEOUT_MS") ??
      null,
  };
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

export function resolveGatewayConfig(
  config: DiscordGatewayConfig,
): ResolvedDiscordGatewayConfig {
  const base = resolveConfig(config);
  return {
    ...base,
    discordAllowedForumChannelIds: config.discordAllowedForumChannelIds ?? [],
    discordAllowedUserIds: config.discordAllowedUserIds ?? [
      base.discordAllowedUserId,
    ],
    sessionIdleTimeoutMs: config.sessionIdleTimeoutMs ?? null,
  };
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

function parseOptionalIntFromEnv(key: string): number | undefined {
  const value = process.env[key];
  if (!value) {
    return undefined;
  }

  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
