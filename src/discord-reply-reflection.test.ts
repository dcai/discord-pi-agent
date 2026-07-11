import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePostReplyFollowUp } from "./discord-reply-reflection";
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
    replyReflection: {
      enabled: true,
      maxFollowUpLength: 120,
      instructions: undefined,
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
  it("returns a deterministic follow-up when the FOLLOW_UP_TEST token is present", async () => {
    const agentService = createAgentService();

    const result = await generatePostReplyFollowUp({
      config: createConfig(),
      agentService,
      promptText: "Please do a FOLLOW_UP_TEST now.",
      assistantReply: "Main reply.",
    });

    expect(result).toBe(
      "Test follow-up: deterministic FOLLOW_UP_TEST trigger worked.",
    );
    expect(agentService.createTemporarySession).not.toHaveBeenCalled();
    expect(runAgentTurnMock).not.toHaveBeenCalled();
  });

  it("returns null when reply reflection is disabled", async () => {
    const agentService = createAgentService();

    const result = await generatePostReplyFollowUp({
      config: createConfig({
        replyReflection: {
          enabled: false,
          maxFollowUpLength: 120,
          instructions: undefined,
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

  it("includes an explicit follow-up test escape hatch in the review prompt", async () => {
    const agentService = createAgentService();
    runAgentTurnMock.mockResolvedValue(
      "<follow_up>Test follow-up sent as requested.</follow_up>",
    );

    await generatePostReplyFollowUp({
      config: createConfig(),
      agentService,
      promptText: "Please send a follow-up for testing.",
      assistantReply: "Main reply.",
    });

    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining(
        "the user would likely benefit from a short, sincere, supportive follow-up with warmth, positivity, empathy, and sensitivity because the context calls for it",
      ),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining(
        "Supportive follow-ups are appropriate not only for stress or vulnerability, but also when a brief warm, encouraging, or affirming message would help the user feel supported, seen, or motivated in a real way.",
      ),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining(
        "This can include moments where they are trying hard, making progress, asking for help, taking a risk, dealing with uncertainty, or starting a new long-term process such as learning a skill, building a habit, or taking up a hobby.",
      ),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining(
        "In those cases, if the main reply is useful but emotionally flat, you may add a short confidence-building follow-up that acknowledges their effort, affirms that steady progress is enough, or gently encourages them to keep going.",
      ),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining(
        "If the review turn finds any materially helpful addition worth telling the user, send it as the follow-up instead of withholding it just because the original reply was technically correct.",
      ),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining(
        "the user explicitly asks you to send a follow-up or says this is a follow-up test, including the literal token FOLLOW_UP_TEST",
      ),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining(
        "unless the user explicitly asked for a follow-up test such as FOLLOW_UP_TEST.",
      ),
    );
  });

  it("includes host review instructions without exposing the XML contract", async () => {
    const agentService = createAgentService();
    runAgentTurnMock.mockResolvedValue(
      "<follow_up>Nice work sticking with it.</follow_up>",
    );

    await generatePostReplyFollowUp({
      config: createConfig({
        replyReflection: {
          enabled: true,
          maxFollowUpLength: 120,
          instructions:
            "Be extra encouraging when the user starts a long-term skill or hobby.",
        },
      }),
      agentService,
      promptText: "I just started learning guitar.",
      assistantReply: "Practice 10 minutes a day and focus on chord changes.",
    });

    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining("Additional host instructions:"),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "review-session-1" }),
      expect.stringContaining(
        "<host_review_instructions>Be extra encouraging when the user starts a long-term skill or hobby.</host_review_instructions>",
      ),
    );
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
