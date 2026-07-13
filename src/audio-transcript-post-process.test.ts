import { beforeEach, describe, expect, it, vi } from "vitest";
import { postProcessAudioTranscript } from "./audio-transcript-post-process";
import type { AgentService } from "./agent-service";
import type { ResolvedDiscordGatewayConfig } from "./types";

const { runAgentTurnMock } = vi.hoisted(() => {
  return {
    runAgentTurnMock: vi.fn(),
  };
});

vi.mock("./agent-turn-runner", () => {
  return {
    runAgentTurn: runAgentTurnMock,
  };
});

function createConfig(
  overrides: Partial<ResolvedDiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  return {
    discordBotToken: "token",
    discordAllowedUserId: "user-1",
    cwd: "/repo",
    agentDir: "/repo/.pi-agent",
    modelProvider: "openrouter",
    modelId: "model-1",
    thinkingLevel: "medium",
    promptTimeZone: "UTC",
    promptLocale: "en-AU",
    promptTransform: (ctx) => ctx.rawContent,
    startupMessage: false,
    shutdownOnSignals: true,
    visionModelId: null,
    discordAllowedForumChannelIds: [],
    discordAllowedUserIds: ["user-1"],
    discordCommandPrefixes: ["!"],
    replyReflection: {
      enabled: false,
      maxFollowUpLength: 600,
    },
    audioTranscription: {
      enabled: true,
      provider: "openai",
      model: "gpt-4o-mini-transcribe",
      apiKey: "sk-audio",
      endpoint: null,
    },
    discordCommandRegistrationScope: "none",
    discordCommandRegistrationGuildIds: [],
    ...overrides,
  };
}

function createAgentService() {
  const session = {
    dispose: vi.fn(),
  };

  const agentService = {
    createTemporarySession: vi.fn(async () => session),
    models: {
      ensureSessionUsesModel: vi.fn(async () => undefined),
    },
  } as unknown as AgentService;

  return {
    agentService,
    session,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runAgentTurnMock.mockResolvedValue("Cleaned transcript.");
});

describe("audio-transcript-post-process", () => {
  it("uses a temporary pi session and returns cleaned text", async () => {
    const { agentService, session } = createAgentService();
    const config = createConfig();

    const result = await postProcessAudioTranscript({
      agentService,
      config,
      filename: "voice-message.ogg",
      transcript: "hello from audio",
      sourceModel: {
        provider: "openrouter",
        id: "model-1",
      },
    });

    expect(agentService.createTemporarySession).toHaveBeenCalledTimes(1);
    expect(agentService.models.ensureSessionUsesModel).toHaveBeenCalledWith(
      session,
      {
        provider: "openrouter",
        id: "model-1",
      },
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      session,
      expect.stringContaining("Keep the same language as the input."),
    );
    expect(result).toBe("Cleaned transcript.");
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it("falls back to the config model when source model is absent", async () => {
    const { agentService, session } = createAgentService();
    const config = createConfig({
      modelProvider: "openai",
      modelId: "gpt-5-mini",
    });

    await postProcessAudioTranscript({
      agentService,
      config,
      filename: "voice-message.ogg",
      transcript: "hello from audio",
    });

    expect(agentService.models.ensureSessionUsesModel).toHaveBeenCalledWith(
      session,
      {
        provider: "openai",
        id: "gpt-5-mini",
      },
    );
  });

  it("appends custom host prompt guidance", async () => {
    const { agentService, session } = createAgentService();
    const config = createConfig({
      audioTranscription: {
        enabled: true,
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
        apiKey: "sk-audio",
        endpoint: null,
        prompt: "Be conservative and preserve technical wording.",
      },
    });

    await postProcessAudioTranscript({
      agentService,
      config,
      filename: "voice-message.ogg",
      transcript: "hello from audio",
      sourceModel: {
        provider: "openrouter",
        id: "model-1",
      },
    });

    expect(runAgentTurnMock).toHaveBeenCalledWith(
      session,
      expect.stringContaining(
        "Be conservative and preserve technical wording.",
      ),
    );
  });

  it("cleans long transcripts in ordered chunks without dropping text", async () => {
    const { agentService, session } = createAgentService();
    const firstChunk = `${"a".repeat(11_999)} `;
    const secondChunk = "second part";
    runAgentTurnMock
      .mockResolvedValueOnce("cleaned first part")
      .mockResolvedValueOnce("cleaned second part");

    const result = await postProcessAudioTranscript({
      agentService,
      config: createConfig(),
      filename: "long-audio.mp3",
      transcript: `${firstChunk}${secondChunk}`,
    });

    expect(result).toBe("cleaned first part\ncleaned second part");
    expect(runAgentTurnMock).toHaveBeenCalledTimes(2);
    expect(runAgentTurnMock).toHaveBeenNthCalledWith(
      1,
      session,
      expect.stringContaining("This is transcript part 1 of 2."),
    );
    expect(runAgentTurnMock).toHaveBeenNthCalledWith(
      2,
      session,
      expect.stringContaining("This is transcript part 2 of 2."),
    );
  });

  it("returns null when cleanup fails", async () => {
    const { agentService } = createAgentService();
    const config = createConfig();

    runAgentTurnMock.mockRejectedValue(new Error("cleanup failed"));

    const result = await postProcessAudioTranscript({
      agentService,
      config,
      filename: "voice-message.ogg",
      transcript: "hello from audio",
    });

    expect(result).toBeNull();
  });

  it("returns null for blank transcripts", async () => {
    const { agentService } = createAgentService();
    const config = createConfig();

    const result = await postProcessAudioTranscript({
      agentService,
      config,
      filename: "voice-message.ogg",
      transcript: "   ",
    });

    expect(result).toBeNull();
    expect(agentService.createTemporarySession).not.toHaveBeenCalled();
  });
});
