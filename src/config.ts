import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import {
  formatDiscordPromptTime,
  getDefaultPromptLocale,
  getDefaultPromptTimeZone,
} from "./prompt-context";
import type {
  AudioTranscriptionConfig,
  CommandRegistrationScope,
  DiscordGatewayConfig,
  ReplyReflectionConfig,
  ResolvedAudioTranscriptionConfig,
  ResolvedDiscordGatewayConfig,
  ResolvedReplyReflectionConfig,
  ThinkingLevel,
} from "./types";

const DEFAULT_AUDIO_TRANSCRIPTION_PROVIDER = "openai";
const DEFAULT_AUDIO_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

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
  const replyReflection = resolveReplyReflectionConfig(config.replyReflection);
  const audioTranscription = resolveAudioTranscriptionConfig(
    config.audioTranscription,
  );

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
    replyReflection,
    audioTranscription,
    discordCommandRegistrationScope,
    discordCommandRegistrationGuildIds,
  };
}

export function loadDiscordGatewayConfigFromEnv(
  overrides: Partial<DiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  dotenv.config();

  const envReplyReflection = readBooleanFromEnv("DISCORD_REPLY_REFLECTION");
  const envReplyReflectionMaxFollowUpLength = readNumberFromEnv(
    "DISCORD_REPLY_REFLECTION_MAX_FOLLOW_UP_LENGTH",
  );
  const envAudioTranscription = buildAudioTranscriptionConfigFromEnv();

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
    replyReflection:
      overrides.replyReflection ??
      buildReplyReflectionConfigFromEnv(
        envReplyReflection,
        envReplyReflectionMaxFollowUpLength,
      ),
    audioTranscription: overrides.audioTranscription ?? envAudioTranscription,
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

function resolveReplyReflectionConfig(
  value: ReplyReflectionConfig | undefined,
): ResolvedReplyReflectionConfig {
  if (typeof value === "boolean") {
    return {
      enabled: value,
      maxFollowUpLength: 600,
      instructions: undefined,
    };
  }

  if (!value) {
    return {
      enabled: false,
      maxFollowUpLength: 600,
      instructions: undefined,
    };
  }

  return {
    enabled: value.enabled ?? true,
    maxFollowUpLength: normalizePositiveInteger(value.maxFollowUpLength) ?? 600,
    instructions: normalizeOptionalText(value.instructions),
  };
}

function buildReplyReflectionConfigFromEnv(
  enabled: boolean | undefined,
  maxFollowUpLength: number | undefined,
): ReplyReflectionConfig | undefined {
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

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return undefined;
  }

  return trimmedValue;
}

function buildAudioTranscriptionConfigFromEnv():
  AudioTranscriptionConfig | false | undefined {
  const enabled = readBooleanFromEnv("PI_AUDIO_TRANSCRIPTION_ENABLED");
  const provider = process.env.PI_AUDIO_TRANSCRIPTION_PROVIDER?.trim();
  const model = process.env.PI_AUDIO_TRANSCRIPTION_MODEL?.trim();
  const apiKey = process.env.PI_AUDIO_TRANSCRIPTION_API_KEY?.trim();
  const endpoint = process.env.PI_AUDIO_TRANSCRIPTION_ENDPOINT?.trim();

  if (enabled === false) {
    return false;
  }

  if (enabled !== true && !provider && !model && !apiKey && !endpoint) {
    return undefined;
  }

  return {
    provider: provider || undefined,
    model: model || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || undefined,
  };
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

function resolveAudioTranscriptionConfig(
  value: AudioTranscriptionConfig | false | undefined,
): ResolvedAudioTranscriptionConfig {
  if (value === false) {
    return createDisabledAudioTranscriptionConfig();
  }

  if (!value) {
    return createEnabledAudioTranscriptionConfig({});
  }

  const provider = normalizeAudioTranscriptionProvider(value.provider);
  const endpoint = normalizeOptionalText(value.endpoint) ?? null;

  if (provider !== DEFAULT_AUDIO_TRANSCRIPTION_PROVIDER && !endpoint) {
    throw new Error(
      'audioTranscription.provider currently only supports "openai" unless audioTranscription.endpoint is set.',
    );
  }

  return createEnabledAudioTranscriptionConfig({
    provider,
    model:
      normalizeOptionalText(value.model) ?? DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
    apiKey: normalizeOptionalText(value.apiKey) ?? null,
    endpoint,
  });
}

function createEnabledAudioTranscriptionConfig(
  overrides: Partial<ResolvedAudioTranscriptionConfig>,
): ResolvedAudioTranscriptionConfig {
  return {
    enabled: true,
    provider: DEFAULT_AUDIO_TRANSCRIPTION_PROVIDER,
    model: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
    apiKey: null,
    endpoint: null,
    ...overrides,
  };
}

function createDisabledAudioTranscriptionConfig(): ResolvedAudioTranscriptionConfig {
  return {
    enabled: false,
    provider: DEFAULT_AUDIO_TRANSCRIPTION_PROVIDER,
    model: DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
    apiKey: null,
    endpoint: null,
  };
}

function normalizeAudioTranscriptionProvider(
  value: string | undefined,
): string {
  return value?.trim().toLowerCase() || DEFAULT_AUDIO_TRANSCRIPTION_PROVIDER;
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
