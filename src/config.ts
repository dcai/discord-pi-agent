import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import {
  formatDiscordPromptTime,
  getDefaultPromptLocale,
  getDefaultPromptTimeZone,
} from "./prompt-context";
import type {
  CommandRegistrationScope,
  DiscordGatewayConfig,
  PostReplyReviewConfig,
  ResolvedDiscordGatewayConfig,
  ResolvedPostReplyReviewConfig,
  ThinkingLevel,
} from "./types";

export function resolveConfig(
  config: DiscordGatewayConfig,
): ResolvedDiscordGatewayConfig {
  const discordAllowedUserId = requireNonEmptyConfigValue(
    "discordAllowedUserId",
    config.discordAllowedUserId,
  );
  const cwd = requireNonEmptyConfigValue("cwd", config.cwd);
  const discordCommandRegistrationScope =
    parseCommandRegistrationScope(config.discordCommandRegistrationScope) ??
    "none";
  const discordCommandRegistrationGuildIds =
    config.discordCommandRegistrationGuildIds ?? [];
  const promptTimeZone =
    config.promptTimeZone?.trim() || getDefaultPromptTimeZone();
  const promptLocale = config.promptLocale?.trim() || getDefaultPromptLocale();
  const postReplyReview = resolvePostReplyReviewConfig(config.postReplyReview);

  if (
    discordCommandRegistrationScope === "guild" &&
    discordCommandRegistrationGuildIds.length === 0
  ) {
    throw new Error(
      'discordCommandRegistrationGuildIds is required when discordCommandRegistrationScope is "guild".',
    );
  }

  return {
    discordBotToken: requireNonEmptyConfigValue(
      "discordBotToken",
      config.discordBotToken,
    ),
    discordAllowedUserId,
    cwd,
    agentDir: config.agentDir?.trim() || path.join(cwd, ".pi-agent"),
    modelProvider: config.modelProvider?.trim() || "openrouter",
    modelId: config.modelId?.trim() || "anthropic/claude-3.5-haiku",
    thinkingLevel: parseThinkingLevel(config.thinkingLevel) || "medium",
    promptTimeZone,
    promptLocale,
    promptTransform: config.promptTransform || defaultPromptTransform,
    startupMessage:
      config.startupMessage === undefined
        ? [
            "Bot is online and ready.",
            "```",
            `Host: ${os.hostname()}`,
            `Started: ${formatDiscordPromptTime(new Date(), {
              timeZone: promptTimeZone,
              locale: promptLocale,
            })}`,
            "```",
          ].join("\n")
        : config.startupMessage,
    shutdownOnSignals: config.shutdownOnSignals ?? true,
    visionModelId: config.visionModelId?.trim() || null,
    discordAllowedForumChannelIds: config.discordAllowedForumChannelIds ?? [],
    discordAllowedUserIds: config.discordAllowedUserIds ?? [
      discordAllowedUserId,
    ],
    discordCommandPrefixes: normalizeCommandPrefixes(
      config.discordCommandPrefixes,
    ),
    postReplyReview,
    discordCommandRegistrationScope,
    discordCommandRegistrationGuildIds,
  };
}

export function loadDiscordGatewayConfigFromEnv(
  overrides: Partial<DiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  dotenv.config();

  const envPostReplyReview = readBooleanFromEnv("DISCORD_POST_REPLY_REVIEW");
  const envPostReplyReviewMaxFollowUpLength = readNumberFromEnv(
    "DISCORD_POST_REPLY_REVIEW_MAX_FOLLOW_UP_LENGTH",
  );

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
    discordCommandPrefixes:
      overrides.discordCommandPrefixes ??
      parseStringArrayFromEnv("DISCORD_COMMAND_PREFIXES"),
    postReplyReview:
      overrides.postReplyReview ??
      buildPostReplyReviewConfigFromEnv(
        envPostReplyReview,
        envPostReplyReviewMaxFollowUpLength,
      ),
    discordCommandRegistrationScope:
      parseCommandRegistrationScope(
        overrides.discordCommandRegistrationScope ??
          process.env.DISCORD_COMMAND_REGISTRATION_SCOPE,
      ) ?? undefined,
    discordCommandRegistrationGuildIds:
      overrides.discordCommandRegistrationGuildIds ??
      parseStringArrayFromEnv("DISCORD_COMMAND_REGISTRATION_GUILD_IDS"),
  });
}

function requireNonEmptyConfigValue(name: string, value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error(`Missing required config value: ${name}`);
  }

  return trimmedValue;
}

function resolvePostReplyReviewConfig(
  value: PostReplyReviewConfig | undefined,
): ResolvedPostReplyReviewConfig {
  if (typeof value === "boolean") {
    return {
      enabled: value,
      maxFollowUpLength: 600,
    };
  }

  if (!value) {
    return {
      enabled: false,
      maxFollowUpLength: 600,
    };
  }

  return {
    enabled: value.enabled ?? true,
    maxFollowUpLength: normalizePositiveInteger(value.maxFollowUpLength) ?? 600,
  };
}

function buildPostReplyReviewConfigFromEnv(
  enabled: boolean | undefined,
  maxFollowUpLength: number | undefined,
): PostReplyReviewConfig | undefined {
  if (enabled === undefined && maxFollowUpLength === undefined) {
    return undefined;
  }

  return {
    enabled,
    maxFollowUpLength,
  };
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

function parseCommandRegistrationScope(
  value: string | undefined,
): CommandRegistrationScope | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  const validScopes: CommandRegistrationScope[] = ["none", "global", "guild"];

  if (validScopes.includes(trimmed as CommandRegistrationScope)) {
    return trimmed as CommandRegistrationScope;
  }

  return undefined;
}

function defaultPromptTransform(ctx: {
  rawContent: string;
  discordMetadata: string;
  now: () => string;
  userMessage: () => string;
}): string {
  return [ctx.now(), ctx.discordMetadata, "", ctx.userMessage()]
    .filter(Boolean)
    .join("\n");
}

function readBooleanFromEnv(key: string): boolean | undefined {
  const value = process.env[key];

  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === "true" || normalizedValue === "1") {
    return true;
  }

  if (normalizedValue === "false" || normalizedValue === "0") {
    return false;
  }

  return undefined;
}

function readNumberFromEnv(key: string): number | undefined {
  const value = process.env[key];

  if (value === undefined) {
    return undefined;
  }

  return normalizePositiveInteger(Number(value.trim()));
}

function normalizePositiveInteger(
  value: number | undefined,
): number | undefined {
  if (
    value === undefined ||
    !Number.isInteger(value) ||
    value <= 0 ||
    !Number.isFinite(value)
  ) {
    return undefined;
  }

  return value;
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

function normalizeCommandPrefixes(prefixes: string[] | undefined): string[] {
  const normalized = (prefixes ?? ["!"])
    .map((prefix) => {
      return prefix.trim();
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    return ["!"];
  }

  return Array.from(new Set(normalized));
}
