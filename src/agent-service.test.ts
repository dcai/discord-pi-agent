import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "./agent-service";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ResolvedDiscordGatewayConfig } from "./types";

const {
  mkdirMock,
  createAgentSessionMock,
  authStorageCreateMock,
  modelRegistryCreateMock,
  settingsManagerCreateMock,
  sessionManagerInMemoryMock,
  sessionManagerContinueRecentMock,
  sessionManagerCreateMock,
  defaultResourceLoaderCtorMock,
  runPromptAndCollectReplyMock,
} = vi.hoisted(() => {
  return {
    mkdirMock: vi.fn(async () => undefined),
    createAgentSessionMock: vi.fn(),
    authStorageCreateMock: vi.fn(() => ({ kind: "auth-storage" })),
    modelRegistryCreateMock: vi.fn(() => ({ kind: "model-registry" })),
    settingsManagerCreateMock: vi.fn(() => ({ flush: vi.fn(async () => undefined) })),
    sessionManagerInMemoryMock: vi.fn(() => ({ kind: "in-memory" })),
    sessionManagerContinueRecentMock: vi.fn((cwd: string, sessionDir: string) => {
      return { kind: "continue-recent", cwd, sessionDir };
    }),
    sessionManagerCreateMock: vi.fn((cwd: string, sessionDir: string) => {
      return { kind: "create", cwd, sessionDir };
    }),
    defaultResourceLoaderCtorMock: vi.fn(),
    runPromptAndCollectReplyMock: vi.fn(),
  };
});

vi.mock("node:fs/promises", () => {
  return {
    default: {
      mkdir: mkdirMock,
    },
    mkdir: mkdirMock,
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => {
  class DefaultResourceLoaderMock {
    reload = vi.fn(async () => undefined);
    getExtensions = vi.fn(() => ({
      extensions: [{ path: "/ext/one" }],
      errors: [],
    }));
    getAgentsFiles = vi.fn(() => ({
      agentsFiles: [{ path: "/repo/AGENTS.md" }],
    }));
    getSkills = vi.fn(() => ({ skills: [], errors: [] }));

    constructor(args: unknown) {
      defaultResourceLoaderCtorMock(args);
    }
  }

  return {
    AuthStorage: {
      create: authStorageCreateMock,
    },
    ModelRegistry: {
      create: modelRegistryCreateMock,
    },
    SettingsManager: {
      create: settingsManagerCreateMock,
    },
    SessionManager: {
      inMemory: sessionManagerInMemoryMock,
      continueRecent: sessionManagerContinueRecentMock,
      create: sessionManagerCreateMock,
    },
    DefaultResourceLoader: DefaultResourceLoaderMock,
    createAgentSession: createAgentSessionMock,
  };
});

vi.mock("./reply-buffer", () => {
  return {
    runPromptAndCollectReply: runPromptAndCollectReplyMock,
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
    promptTransform: vi.fn(async (input: string) => `wrapped:${input}`),
    startupMessage: false,
    shutdownOnSignals: true,
    visionModelId: null,
    discordAllowedForumChannelIds: [],
    discordAllowedUserIds: ["user-1"],
    ...overrides,
  };
}

function createSession(
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    sessionId: "session-1",
    sessionFile: "/repo/.pi-agent/sessions/session-1.jsonl",
    model: { provider: "openrouter", id: "model-1" },
    isStreaming: false,
    thinkingLevel: "medium",
    compact: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
    prompt: vi.fn(async () => undefined),
    supportsThinking: vi.fn(() => true),
    getAvailableThinkingLevels: vi.fn(() => ["low", "medium", "high"]),
    getContextUsage: vi.fn(() => ({ tokens: 123, contextWindow: 1000, percent: 12.3 })),
    ...overrides,
  } as unknown as AgentSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  createAgentSessionMock.mockResolvedValue({
    session: createSession(),
  });
  runPromptAndCollectReplyMock.mockResolvedValue("agent reply");
});

describe("AgentService", () => {
  it("initializes resources, resumes a session, and ensures the configured model", async () => {
    const service = new AgentService(createConfig());
    const ensureModelSpy = vi
      .spyOn(service.models, "ensureSessionHasConfiguredModel")
      .mockResolvedValue(undefined);

    await service.initialize();

    expect(mkdirMock).toHaveBeenCalledWith("/repo/.pi-agent", { recursive: true });
    expect(mkdirMock).toHaveBeenCalledWith("/repo/.pi-agent/sessions", {
      recursive: true,
    });
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        agentDir: "/repo/.pi-agent",
        thinkingLevel: "medium",
        sessionManager: {
          kind: "continue-recent",
          cwd: "/repo",
          sessionDir: "/repo/.pi-agent/sessions",
        },
      }),
    );
    expect(ensureModelSpy).toHaveBeenCalled();
    expect(service.getSession()).not.toBeNull();
    expect(service.getAgentDir()).toBe("/repo/.pi-agent");
  });

  it("creates a temporary session in memory", async () => {
    const service = new AgentService(createConfig());
    const tempSession = createSession({ sessionId: "temp-session" });
    createAgentSessionMock.mockResolvedValueOnce({ session: tempSession });

    await expect(service.createTemporarySession()).resolves.toBe(tempSession);
    expect(sessionManagerInMemoryMock).toHaveBeenCalled();
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: "off", sessionManager: { kind: "in-memory" } }),
    );
  });

  it("creates a scoped session and ensures the configured model", async () => {
    const service = new AgentService(createConfig());
    const scopedSession = createSession({ sessionId: "thread-session" });
    createAgentSessionMock.mockResolvedValueOnce({ session: scopedSession });
    const ensureModelSpy = vi
      .spyOn(service.models, "ensureSessionHasConfiguredModel")
      .mockResolvedValue(undefined);

    await expect(service.createSession("/repo/.pi-agent/sessions/thread-1")).resolves.toBe(
      scopedSession,
    );

    expect(mkdirMock).toHaveBeenCalledWith("/repo/.pi-agent/sessions/thread-1", {
      recursive: true,
    });
    expect(sessionManagerContinueRecentMock).toHaveBeenCalledWith(
      "/repo",
      "/repo/.pi-agent/sessions/thread-1",
    );
    expect(ensureModelSpy).toHaveBeenCalledWith(scopedSession);
  });

  it("transforms prompts before collecting replies", async () => {
    const service = new AgentService(createConfig());
    const session = createSession();
    createAgentSessionMock.mockResolvedValueOnce({ session });
    vi.spyOn(service.models, "ensureSessionHasConfiguredModel").mockResolvedValue(undefined);

    await service.initialize();

    await expect(service.prompt("hello")).resolves.toBe("agent reply");
    expect(runPromptAndCollectReplyMock).toHaveBeenCalledWith(
      session,
      "wrapped:hello",
    );
  });

  it("compacts, reports status, resets, and shuts down", async () => {
    const service = new AgentService(createConfig());
    const firstSession = createSession({ sessionId: "session-1" });
    const secondSession = createSession({
      sessionId: "session-2",
      sessionFile: "/repo/.pi-agent/sessions/session-2.jsonl",
    });

    createAgentSessionMock
      .mockResolvedValueOnce({ session: firstSession })
      .mockResolvedValueOnce({ session: secondSession });

    vi.spyOn(service.models, "ensureSessionHasConfiguredModel").mockResolvedValue(undefined);
    vi.spyOn(service.models, "getCurrentModelDisplay").mockReturnValue(
      "openrouter/model-1",
    );

    await service.initialize();

    await expect(service.compact()).resolves.toBe(
      "Compaction finished for session session-1.",
    );

    expect(service.getStatus()).toEqual({
      sessionId: "session-1",
      sessionFile: "/repo/.pi-agent/sessions/session-1.jsonl",
      model: "openrouter/model-1",
      streaming: false,
      contextUsage: { tokens: 123, contextWindow: 1000, percent: 12.3 },
      thinkingInfo: "thinking: medium (available: low, medium, high)",
    });

    await expect(service.resetSession()).resolves.toBe(
      "Started a fresh session. Old session kept at /repo/.pi-agent/sessions/session-1.jsonl.",
    );
    expect(firstSession.abort).toHaveBeenCalled();
    expect(firstSession.dispose).toHaveBeenCalled();
    expect(sessionManagerCreateMock).toHaveBeenCalledWith(
      "/repo",
      "/repo/.pi-agent/sessions",
    );

    const settingsManager = settingsManagerCreateMock.mock.results[0]?.value as {
      flush: ReturnType<typeof vi.fn>;
    };

    await service.shutdown();
    expect(secondSession.abort).toHaveBeenCalled();
    expect(secondSession.dispose).toHaveBeenCalled();
    expect(settingsManager.flush).toHaveBeenCalled();
  });

  it("throws when session-dependent methods are used before initialization", async () => {
    const service = new AgentService(createConfig());

    await expect(service.prompt("hello")).rejects.toThrow(
      "Agent session has not been initialized.",
    );
    await expect(service.compact()).rejects.toThrow(
      "Agent session has not been initialized.",
    );
    expect(() => {
      service.getStatus();
    }).toThrow("Agent session has not been initialized.");
    await expect(service.resetSession()).rejects.toThrow(
      "Agent session has not been initialized.",
    );
  });
});
