import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDiscordGatewayConfigFromEnv, resolveConfig } from "./config";
import { formatDiscordPromptTime } from "./prompt-context";
import type { DiscordGatewayConfig } from "./types";

vi.mock("node:os", () => {
  return {
    default: {
      hostname: vi.fn(() => "test-host"),
    },
  };
});

vi.mock("dotenv", () => {
  return {
    default: {
      config: vi.fn(),
    },
  };
});

function createBaseConfig(
  overrides: Partial<DiscordGatewayConfig> = {},
): DiscordGatewayConfig {
  return {
    discordBotToken: " bot-token ",
    discordAllowedUserId: " user-1 ",
    cwd: " /repo ",
    ...overrides,
  };
}

function withEnv(
  env: Record<string, string | undefined>,
  callback: () => void,
): void {
  const previous = {
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    DISCORD_ALLOWED_USER_ID: process.env.DISCORD_ALLOWED_USER_ID,
    PI_AGENT_CWD: process.env.PI_AGENT_CWD,
    PI_AGENT_DIR: process.env.PI_AGENT_DIR,
    PI_MODEL_PROVIDER: process.env.PI_MODEL_PROVIDER,
    PI_MODEL_ID: process.env.PI_MODEL_ID,
    PI_THINKING_LEVEL: process.env.PI_THINKING_LEVEL,
    PI_PROMPT_TIME_ZONE: process.env.PI_PROMPT_TIME_ZONE,
    PI_PROMPT_LOCALE: process.env.PI_PROMPT_LOCALE,
    DISCORD_STARTUP_MESSAGE: process.env.DISCORD_STARTUP_MESSAGE,
    PI_VISION_MODEL_ID: process.env.PI_VISION_MODEL_ID,
    DISCORD_FORUM_CHANNEL_IDS: process.env.DISCORD_FORUM_CHANNEL_IDS,
    DISCORD_ALLOWED_USER_IDS: process.env.DISCORD_ALLOWED_USER_IDS,
    DISCORD_COMMAND_PREFIXES: process.env.DISCORD_COMMAND_PREFIXES,
    DISCORD_REPLY_REFLECTION: process.env.DISCORD_REPLY_REFLECTION,
    DISCORD_REPLY_REFLECTION_MAX_FOLLOW_UP_LENGTH:
      process.env.DISCORD_REPLY_REFLECTION_MAX_FOLLOW_UP_LENGTH,
    DISCORD_COMMAND_REGISTRATION_SCOPE:
      process.env.DISCORD_COMMAND_REGISTRATION_SCOPE,
    DISCORD_COMMAND_REGISTRATION_GUILD_IDS:
      process.env.DISCORD_COMMAND_REGISTRATION_GUILD_IDS,
    PI_AUDIO_TRANSCRIPTION_ENABLED: process.env.PI_AUDIO_TRANSCRIPTION_ENABLED,
    PI_AUDIO_TRANSCRIPTION_API_KEY: process.env.PI_AUDIO_TRANSCRIPTION_API_KEY,
    PI_AUDIO_TRANSCRIPTION_PROVIDER:
      process.env.PI_AUDIO_TRANSCRIPTION_PROVIDER,
    PI_AUDIO_TRANSCRIPTION_MODEL: process.env.PI_AUDIO_TRANSCRIPTION_MODEL,
    PI_AUDIO_TRANSCRIPTION_ENDPOINT:
      process.env.PI_AUDIO_TRANSCRIPTION_ENDPOINT,
    PI_AUDIO_TRANSCRIPTION_PROMPT: process.env.PI_AUDIO_TRANSCRIPTION_PROMPT,
  };

  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });

  try {
    callback();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("config", () => {
  describe("resolveConfig", () => {
    it("trims required values and fills defaults", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-18T01:51:03.618Z"));
      const config = resolveConfig(createBaseConfig());

      expect(config.discordBotToken).toBe("bot-token");
      expect(config.discordAllowedUserId).toBe("user-1");
      expect(config.cwd).toBe("/repo");
      expect(config.agentDir).toBe("/repo/.pi-agent");
      expect(config.modelProvider).toBe("openrouter");
      expect(config.modelId).toBe("anthropic/claude-3.5-haiku");
      expect(config.thinkingLevel).toBe("medium");
      expect(config.promptTimeZone).toBe("UTC");
      expect(config.promptLocale).toBe("en-AU");
      expect(config.startupMessage).toBe(
        [
          "Bot is online and ready.",
          "```",
          "Host: test-host",
          `Started: ${formatDiscordPromptTime(
            new Date("2026-06-18T01:51:03.618Z"),
            {
              timeZone: "UTC",
              locale: "en-AU",
            },
          )}`,
          "```",
        ].join("\n"),
      );
      expect(config.shutdownOnSignals).toBe(true);
      expect(config.visionModelId).toBeNull();
      expect(config.discordAllowedForumChannelIds).toEqual([]);
      expect(config.discordAllowedUserIds).toEqual(["user-1"]);
      expect(config.discordCommandPrefixes).toEqual(["!"]);
      expect(config.replyReflection).toEqual({
        enabled: false,
        maxFollowUpLength: 600,
        instructions: undefined,
      });
      expect(config.audioTranscription).toEqual({
        enabled: true,
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
        apiKey: null,
        endpoint: null,
      });
      expect(config.discordCommandRegistrationScope).toBe("none");
      expect(config.discordCommandRegistrationGuildIds).toEqual([]);
      expect(
        config.promptTransform({
          rawContent: "hello",
          discordMetadata: "",
          now: () => "now",
          userMessage: () => "<user_message>hello</user_message>",
        }),
      ).toBe("now\n<user_message>hello</user_message>");
    });

    it("preserves explicit values including false startup message", () => {
      const promptTransform = vi.fn(
        async (ctx: {
          rawContent: string;
          discordMetadata: string;
          now: () => string;
          userMessage: () => string;
        }) => {
          return `wrapped:${ctx.rawContent}`;
        },
      );

      const config = resolveConfig(
        createBaseConfig({
          agentDir: " /custom-agent ",
          modelProvider: " openai ",
          modelId: " gpt-5-mini ",
          thinkingLevel: "HIGH" as never,
          promptTimeZone: " Australia/Sydney ",
          promptLocale: " en-US ",
          promptTransform,
          startupMessage: false,
          shutdownOnSignals: false,
          visionModelId: " openrouter/google/gemini-3.1-flash ",
          discordAllowedForumChannelIds: ["forum-1"],
          discordAllowedUserIds: ["user-1", "user-2"],
          discordCommandPrefixes: [";", "!"],
          replyReflection: {
            enabled: true,
            maxFollowUpLength: 280,
            instructions: " Be warm when effort deserves encouragement. ",
          },
          audioTranscription: {
            provider: " custom-provider ",
            model: " whisper-2 ",
            apiKey: " sk-custom-key ",
            endpoint: " https://custom.example.com/transcribe ",
            prompt: " Keep the same language. Be conservative. ",
          },
          discordCommandRegistrationScope: "guild",
          discordCommandRegistrationGuildIds: ["guild-1", "guild-2"],
        }),
      );

      expect(config.agentDir).toBe("/custom-agent");
      expect(config.modelProvider).toBe("openai");
      expect(config.modelId).toBe("gpt-5-mini");
      expect(config.thinkingLevel).toBe("high");
      expect(config.promptTimeZone).toBe("Australia/Sydney");
      expect(config.promptLocale).toBe("en-US");
      expect(config.promptTransform).toBe(promptTransform);
      expect(config.startupMessage).toBe(false);
      expect(config.shutdownOnSignals).toBe(false);
      expect(config.visionModelId).toBe("openrouter/google/gemini-3.1-flash");
      expect(config.discordAllowedForumChannelIds).toEqual(["forum-1"]);
      expect(config.discordAllowedUserIds).toEqual(["user-1", "user-2"]);
      expect(config.discordCommandPrefixes).toEqual([";", "!"]);
      expect(config.replyReflection).toEqual({
        enabled: true,
        maxFollowUpLength: 280,
        instructions: "Be warm when effort deserves encouragement.",
      });
      expect(config.audioTranscription).toEqual({
        enabled: true,
        provider: "custom-provider",
        model: "whisper-2",
        apiKey: "sk-custom-key",
        endpoint: "https://custom.example.com/transcribe",
        prompt: "Keep the same language. Be conservative.",
      });
      expect(config.discordCommandRegistrationScope).toBe("guild");
      expect(config.discordCommandRegistrationGuildIds).toEqual([
        "guild-1",
        "guild-2",
      ]);
    });

    it("disables audio transcription when passed false", () => {
      const config = resolveConfig(
        createBaseConfig({
          audioTranscription: false,
        }),
      );

      expect(config.audioTranscription).toEqual({
        enabled: false,
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
        apiKey: null,
        endpoint: null,
      });
    });

    it("rejects unsupported audio providers without an explicit endpoint", () => {
      expect(() => {
        resolveConfig(
          createBaseConfig({
            audioTranscription: {
              provider: "gemini",
            },
          }),
        );
      }).toThrow(
        'audioTranscription.provider currently only supports "openai" unless audioTranscription.endpoint is set.',
      );
    });

    it("uses prompt defaults from env when prompt settings are omitted", () => {
      withEnv(
        {
          PI_PROMPT_TIME_ZONE: "Asia/Bangkok",
          PI_PROMPT_LOCALE: "th-TH",
        },
        () => {
          const config = resolveConfig(createBaseConfig());

          expect(config.promptTimeZone).toBe("Asia/Bangkok");
          expect(config.promptLocale).toBe("th-TH");
        },
      );
    });

    it("falls back to medium when thinking level is invalid", () => {
      const config = resolveConfig(
        createBaseConfig({
          thinkingLevel: "banana" as never,
        }),
      );

      expect(config.thinkingLevel).toBe("medium");
    });

    it("throws when required values are blank", () => {
      expect(() => {
        resolveConfig(createBaseConfig({ discordBotToken: "   " }));
      }).toThrow("Missing required config value: discordBotToken");

      expect(() => {
        resolveConfig(createBaseConfig({ discordAllowedUserId: "   " }));
      }).toThrow("Missing required config value: discordAllowedUserId");

      expect(() => {
        resolveConfig(createBaseConfig({ cwd: "   " }));
      }).toThrow("Missing required config value: cwd");
    });

    it("requires guild IDs when guild command registration is enabled", () => {
      expect(() => {
        resolveConfig(
          createBaseConfig({
            discordCommandRegistrationScope: "guild",
          }),
        );
      }).toThrow(
        'discordCommandRegistrationGuildIds is required when discordCommandRegistrationScope is "guild".',
      );
    });
  });

  describe("loadDiscordGatewayConfigFromEnv", () => {
    it("loads values from env and parses array fields", () => {
      withEnv(
        {
          DISCORD_BOT_TOKEN: "env-token",
          DISCORD_ALLOWED_USER_ID: "env-user",
          PI_AGENT_CWD: "/env-repo",
          PI_AGENT_DIR: "/env-agent",
          PI_MODEL_PROVIDER: "openai",
          PI_MODEL_ID: "gpt-5",
          PI_THINKING_LEVEL: "xhigh",
          PI_PROMPT_TIME_ZONE: "Asia/Bangkok",
          PI_PROMPT_LOCALE: "th-TH",
          DISCORD_STARTUP_MESSAGE: " hello from env ",
          PI_VISION_MODEL_ID: "openrouter/google/gemini-3.1-flash-lite",
          DISCORD_FORUM_CHANNEL_IDS: "forum-1, forum-2",
          DISCORD_ALLOWED_USER_IDS: "user-1, user-2",
          DISCORD_COMMAND_PREFIXES: "!, ;",
          DISCORD_REPLY_REFLECTION: "true",
          DISCORD_REPLY_REFLECTION_MAX_FOLLOW_UP_LENGTH: "420",
          DISCORD_COMMAND_REGISTRATION_SCOPE: "guild",
          DISCORD_COMMAND_REGISTRATION_GUILD_IDS: "guild-1, guild-2",
          PI_AUDIO_TRANSCRIPTION_ENABLED: "true",
          PI_AUDIO_TRANSCRIPTION_API_KEY: "env-audio-key",
          PI_AUDIO_TRANSCRIPTION_PROVIDER: "openai",
          PI_AUDIO_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe",
          PI_AUDIO_TRANSCRIPTION_PROMPT: " Keep the same language. ",
        },
        () => {
          const config = loadDiscordGatewayConfigFromEnv();

          expect(config.discordBotToken).toBe("env-token");
          expect(config.discordAllowedUserId).toBe("env-user");
          expect(config.cwd).toBe("/env-repo");
          expect(config.agentDir).toBe("/env-agent");
          expect(config.modelProvider).toBe("openai");
          expect(config.modelId).toBe("gpt-5");
          expect(config.thinkingLevel).toBe("xhigh");
          expect(config.promptTimeZone).toBe("Asia/Bangkok");
          expect(config.promptLocale).toBe("th-TH");
          expect(config.startupMessage).toBe("hello from env");
          expect(config.visionModelId).toBe(
            "openrouter/google/gemini-3.1-flash-lite",
          );
          expect(config.discordAllowedForumChannelIds).toEqual([
            "forum-1",
            "forum-2",
          ]);
          expect(config.discordAllowedUserIds).toEqual(["user-1", "user-2"]);
          expect(config.discordCommandPrefixes).toEqual(["!", ";"]);
          expect(config.replyReflection).toEqual({
            enabled: true,
            maxFollowUpLength: 420,
            instructions: undefined,
          });
          expect(config.discordCommandRegistrationScope).toBe("guild");
          expect(config.discordCommandRegistrationGuildIds).toEqual([
            "guild-1",
            "guild-2",
          ]);
          expect(config.audioTranscription).toEqual({
            enabled: true,
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
            apiKey: "env-audio-key",
            endpoint: null,
            prompt: "Keep the same language.",
          });
        },
      );
    });

    it("loads audio transcription from env with defaults", () => {
      withEnv(
        {
          DISCORD_BOT_TOKEN: "env-token",
          DISCORD_ALLOWED_USER_ID: "env-user",
          PI_AGENT_CWD: "/env-repo",
          PI_AUDIO_TRANSCRIPTION_API_KEY: "sk-audio-key",
        },
        () => {
          const config = loadDiscordGatewayConfigFromEnv();

          expect(config.audioTranscription).toEqual({
            enabled: true,
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
            apiKey: "sk-audio-key",
            endpoint: null,
          });
        },
      );
    });

    it("merges audio transcription overrides with env values", () => {
      withEnv(
        {
          DISCORD_BOT_TOKEN: "env-token",
          DISCORD_ALLOWED_USER_ID: "env-user",
          PI_AGENT_CWD: "/env-repo",
          PI_AUDIO_TRANSCRIPTION_API_KEY: "env-audio-key",
        },
        () => {
          const config = loadDiscordGatewayConfigFromEnv({
            audioTranscription: {
              prompt: " Keep the same language. ",
            },
          });

          expect(config.audioTranscription).toEqual({
            enabled: true,
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
            apiKey: "env-audio-key",
            endpoint: null,
            prompt: "Keep the same language.",
          });
        },
      );
    });

    it("lets overrides win over env values", () => {
      withEnv(
        {
          DISCORD_BOT_TOKEN: "env-token",
          DISCORD_ALLOWED_USER_ID: "env-user",
          PI_AGENT_CWD: "/env-repo",
        },
        () => {
          const config = loadDiscordGatewayConfigFromEnv({
            discordBotToken: "override-token",
            discordAllowedUserId: "override-user",
            cwd: "/override-repo",
            startupMessage: false,
            discordAllowedUserIds: ["override-user", "friend"],
            discordCommandPrefixes: [";", "!"],
            replyReflection: {
              enabled: true,
              maxFollowUpLength: 333,
              instructions: " Add confidence-building support when it helps. ",
            },
            discordCommandRegistrationScope: "global",
          });

          expect(config.discordBotToken).toBe("override-token");
          expect(config.discordAllowedUserId).toBe("override-user");
          expect(config.cwd).toBe("/override-repo");
          expect(config.startupMessage).toBe(false);
          expect(config.discordAllowedUserIds).toEqual([
            "override-user",
            "friend",
          ]);
          expect(config.discordCommandPrefixes).toEqual([";", "!"]);
          expect(config.replyReflection).toEqual({
            enabled: true,
            maxFollowUpLength: 333,
            instructions: "Add confidence-building support when it helps.",
          });
          expect(config.discordCommandRegistrationScope).toBe("global");
        },
      );
    });

    it("lets env disable audio transcription explicitly", () => {
      withEnv(
        {
          DISCORD_BOT_TOKEN: "env-token",
          DISCORD_ALLOWED_USER_ID: "env-user",
          PI_AGENT_CWD: "/env-repo",
          PI_AUDIO_TRANSCRIPTION_ENABLED: "false",
          PI_AUDIO_TRANSCRIPTION_API_KEY: "sk-audio-key",
        },
        () => {
          expect(loadDiscordGatewayConfigFromEnv().audioTranscription).toEqual({
            enabled: false,
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
            apiKey: null,
            endpoint: null,
          });
        },
      );
    });

    it("treats blank or false startup env as disabled", () => {
      withEnv(
        {
          DISCORD_BOT_TOKEN: "env-token",
          DISCORD_ALLOWED_USER_ID: "env-user",
          PI_AGENT_CWD: "/env-repo",
          DISCORD_STARTUP_MESSAGE: " false ",
        },
        () => {
          expect(loadDiscordGatewayConfigFromEnv().startupMessage).toBe(false);
        },
      );

      withEnv(
        {
          DISCORD_BOT_TOKEN: "env-token",
          DISCORD_ALLOWED_USER_ID: "env-user",
          PI_AGENT_CWD: "/env-repo",
          DISCORD_STARTUP_MESSAGE: "   ",
        },
        () => {
          expect(loadDiscordGatewayConfigFromEnv().startupMessage).toBe(false);
        },
      );
    });
  });
});
