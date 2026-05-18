import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { AgentService } from "./agent-service";
import type { PromptQueue } from "./prompt-queue";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

function createPromptQueueMock(): PromptQueue {
  return {
    getSnapshot: () => ({ pending: 0, busy: false }),
    enqueue: vi.fn(async (task: () => Promise<string>) => {
      return task();
    }),
  } as unknown as PromptQueue;
}

function createSessionMock(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: "session-1",
    sessionFile: "/tmp/session-1.jsonl",
    isStreaming: false,
    model: { provider: "openrouter", id: "model-1" },
    getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
    supportsThinking: () => true,
    thinkingLevel: "medium",
    getAvailableThinkingLevels: () => ["low", "medium", "high"],
    setThinkingLevel: vi.fn(),
    getAllTools: () => [],
    compact: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as AgentSession;
}

function createAgentServiceMock(session: AgentSession | null): AgentService {
  return {
    getSession: () => session,
    getExtensionsSummary: () => "Extensions: (none loaded)",
    getSkillsSummary: () => "Skills: (none loaded)",
    getCurrentModelDisplay: () => "openrouter/model-1",
    listModels: vi.fn().mockResolvedValue("Available models (1):\n  openrouter/model-1"),
    switchModel: vi.fn().mockResolvedValue("Switched."),
    reloadResources: vi.fn().mockResolvedValue("Resources reloaded."),
    resetSession: vi.fn().mockResolvedValue("Started a fresh session."),
  } as unknown as AgentService;
}

describe("handleCommand", () => {
  it("returns handled false for non-command input", async () => {
    const result = await handleCommand("hello", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
    });

    expect(result).toEqual({ handled: false });
  });

  it("returns no active session for commands that require a session", async () => {
    const result = await handleCommand("!status", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
    });

    expect(result).toEqual({
      handled: true,
      response: "No active session.",
    });
  });

  it("shows thinking info when no level is passed", async () => {
    const session = createSessionMock();
    const result = await handleCommand("!thinking", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
    });

    expect(result).toEqual({
      handled: true,
      response: [
        "Current: medium",
        "Available: low, medium, high",
        "Usage: !thinking <level>",
      ].join("\n"),
    });
  });

  it("sets the requested thinking level when valid", async () => {
    const setThinkingLevel = vi.fn();
    const session = createSessionMock({ setThinkingLevel });

    const result = await handleCommand("!thinking high", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
    });

    expect(setThinkingLevel).toHaveBeenCalledWith("high");
    expect(result).toEqual({
      handled: true,
      response: 'Thinking level set to "high".',
    });
  });

  it("shows current model and available models", async () => {
    const session = createSessionMock();
    const agentService = createAgentServiceMock(session);

    const result = await handleCommand("!model", {
      agentService,
      promptQueue: createPromptQueueMock(),
      session,
    });

    expect(result).toEqual({
      handled: true,
      response:
        "Current model: openrouter/model-1\n\nAvailable models (1):\n  openrouter/model-1",
    });
  });

  it("archives threads only when thread session exists", async () => {
    const result = await handleCommand("!archive", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
    });

    expect(result).toEqual({
      handled: true,
      response: "!archive is only available in forum threads.",
    });
  });
});
