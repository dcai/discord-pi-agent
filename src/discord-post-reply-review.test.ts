import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePostReplyFollowUp } from "./discord-post-reply-review";
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
    promptTransform: async (ctx) => ctx.rawContent,
    startupMessage: false,
    shutdownOnSignals: true,
    visionModelId: null,
    discordAllowedForumChannelIds: ["forum-1"],
    discordAllowedUserIds: ["user-1"],
    discordCommandPrefixes: ["!"],
    postReplyReview: {
      enabled: true,
      maxFollowUpLength: 120,
    },
    discordCommandRegistrationScope: "none",
    discordCommandRegistrationGuildIds: [],
    ...overrides,
  };
}

function createAgentService(): AgentService & {
  createTemporarySession: ReturnType<typeof vi.fn>;
  models: {
    ensureSessionUsesModel: ReturnType<typeof vi.fn>;
  };
  reviewSession: {
    sessionId: string;
    dispose: ReturnType<typeof vi.fn>;
  };
} {
  const reviewSession = {
    sessionId: "review-session-1",
    dispose: vi.fn(() => undefined),
  };

  return {
    createTemporarySession: vi.fn(async () => reviewSession),
    models: {
      ensureSessionUsesModel: vi.fn(async () => undefined),
    },
    reviewSession,
  } as unknown as AgentService & {
    createTemporarySession: ReturnType<typeof vi.fn>;
    models: {
      ensureSessionUsesModel: ReturnType<typeof vi.fn>;
    };
    reviewSession: {
      sessionId: string;
      dispose: ReturnType<typeof vi.fn>;
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runAgentTurnMock.mockResolvedValue("<no_follow_up/>");
});

describe("generatePostReplyFollowUp", () => {
  it("returns null when post-reply review is disabled", async () => {
    const agentService = createAgentService();

    const result = await generatePostReplyFollowUp({
      config: createConfig({
        postReplyReview: {
          enabled: false,
          maxFollowUpLength: 120,
        },
      }),
      agentService,
      promptText: "hello",
      assistantReply: "hi",
      sourceModel: {
        provider: "openrouter",
        id: "model-1",
      },
    });

    expect(result).toBeNull();
    expect(agentService.createTemporarySession).not.toHaveBeenCalled();
  });

  it("uses a temporary session on the same model and returns a parsed follow-up", async () => {
    const agentService = createAgentService();
    runAgentTurnMock.mockResolvedValue(
      "<follow_up>One more thing: restart the bot after changing the env file.</follow_up>",
    );

    const result = await generatePostReplyFollowUp({
      config: createConfig(),
      agentService,
      promptText: "how do i enable this?",
      assistantReply: "Set the env var and restart the process.",
      discordMetadata:
        '<discord_message_context>{"scope":"dm"}</discord_message_context>',
      sourceModel: {
        provider: "openrouter",
        id: "model-2",
      },
    });

    expect(result).toBe(
      "One more thing: restart the bot after changing the env file.",
    );
    expect(agentService.createTemporarySession).toHaveBeenCalledWith();
    expect(agentService.models.ensureSessionUsesModel).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      {
        provider: "openrouter",
        id: "model-2",
      },
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining(
        "<assistant_reply>Set the env var and restart the process.</assistant_reply>",
      ),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining("<discord_message_context>"),
    );
    expect(agentService.reviewSession.dispose).toHaveBeenCalledTimes(1);
  });

  it("falls back to the configured default model when the source model is missing", async () => {
    const agentService = createAgentService();

    await generatePostReplyFollowUp({
      config: createConfig({
        modelProvider: "github-copilot",
        modelId: "gpt-5",
      }),
      agentService,
      promptText: "hello",
      assistantReply: "hi",
    });

    expect(agentService.models.ensureSessionUsesModel).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      {
        provider: "github-copilot",
        id: "gpt-5",
      },
    );
  });

  it("returns null when the reviewer says no follow-up is needed", async () => {
    const agentService = createAgentService();
    runAgentTurnMock.mockResolvedValue("<no_follow_up/>");

    const result = await generatePostReplyFollowUp({
      config: createConfig(),
      agentService,
      promptText: "hello",
      assistantReply: "hi",
    });

    expect(result).toBeNull();
  });

  it("drops follow-ups that exceed the configured max length", async () => {
    const agentService = createAgentService();
    runAgentTurnMock.mockResolvedValue(
      `<follow_up>${"x".repeat(121)}</follow_up>`,
    );

    const result = await generatePostReplyFollowUp({
      config: createConfig(),
      agentService,
      promptText: "hello",
      assistantReply: "hi",
    });

    expect(result).toBeNull();
  });

  it("swallows review failures and always disposes the temporary session", async () => {
    const agentService = createAgentService();
    agentService.createTemporarySession.mockResolvedValueOnce(
      agentService.reviewSession,
    );
    runAgentTurnMock.mockRejectedValueOnce(new Error("review failed"));

    const result = await generatePostReplyFollowUp({
      config: createConfig(),
      agentService,
      promptText: "hello",
      assistantReply: "hi",
    });

    expect(result).toBeNull();
    expect(agentService.reviewSession.dispose).toHaveBeenCalledTimes(1);
  });
});
