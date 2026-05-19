import { describe, expect, it, vi } from "vitest";
import { executeSessionCommand } from "./session-commands";
import type { AgentService } from "./agent-service";
import type { PromptQueue } from "./prompt-queue";
import type { AgentSession, ToolInfo } from "@earendil-works/pi-coding-agent";

function createPromptQueueMock(
  overrides: Partial<PromptQueue> = {},
): PromptQueue {
  return {
    getSnapshot: () => ({ pending: 0, busy: false }),
    enqueue: vi.fn(async (task: () => Promise<string>) => {
      return task();
    }),
    ...overrides,
  } as unknown as PromptQueue;
}

function createSessionMock(
  overrides: Partial<AgentSession> = {},
): AgentSession {
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
    resources: {
      getExtensionsSummary: () => "Extensions: (none loaded)",
      getSkillsSummary: () => "Skills: (none loaded)",
      reloadResources: vi.fn().mockResolvedValue("Resources reloaded."),
    },
    models: {
      getCurrentModelDisplay: () => "openrouter/model-1",
      listModels: vi
        .fn()
        .mockResolvedValue("Available models (1):\n  openrouter/model-1"),
      switchModel: vi.fn().mockResolvedValue("Switched."),
      getThinkingLevel: (currentSession: AgentSession) => ({
        current: currentSession.thinkingLevel,
        available: currentSession.getAvailableThinkingLevels(),
        supported: currentSession.supportsThinking(),
      }),
      setThinkingLevel: (currentSession: AgentSession, level: string) => {
        currentSession.setThinkingLevel(level as never);
        return `Thinking level set to "${level}".`;
      },
    },
    resetSession: vi.fn().mockResolvedValue("Started a fresh session."),
  } as unknown as AgentService;
}

describe("executeSessionCommand", () => {
  it("returns handled false for non-command input", async () => {
    const result = await executeSessionCommand("hello", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({ handled: false });
  });

  it("returns no active session for commands that require a session", async () => {
    const result = await executeSessionCommand("!status", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: "No active session.",
    });
  });

  it("shows help and includes archive only for thread sessions", async () => {
    const dmResult = await executeSessionCommand("!help", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      workingEmoji: "⚙️",
    });

    expect(dmResult.response).not.toContain("!archive - archive this thread");

    const threadResult = await executeSessionCommand("!help", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      session: createSessionMock(),
      workingEmoji: "⚙️",
    });

    expect(threadResult).toEqual({
      handled: true,
      response: expect.stringContaining(
        "!archive - archive this thread and end the session",
      ),
    });
  });

  it("shows status including queue, tools, skills, and extensions", async () => {
    const tool: ToolInfo = { name: "bash" } as ToolInfo;
    const session = createSessionMock({ getAllTools: () => [tool] });
    const promptQueue = createPromptQueueMock({
      getSnapshot: () => ({ pending: 2, busy: true }),
    });

    const result = await executeSessionCommand("!status", {
      agentService: createAgentServiceMock(session),
      promptQueue,
      session,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: [
        "model: openrouter/model-1",
        "session-id: session-1",
        "session-file: /tmp/session-1.jsonl",
        "streaming: false",
        "thinking: medium (available: low, medium, high)",
        "context: 100/1000 (10%)",
        "queue-pending: 2",
        "queue-busy: true",
        "",
        "Tools (1): bash",
        "",
        "Skills: (none loaded)",
        "",
        "Extensions: (none loaded)",
      ].join("\n"),
    });
  });

  it("shows thinking info when no level is passed", async () => {
    const session = createSessionMock();
    const result = await executeSessionCommand("!thinking", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
      workingEmoji: "⚙️",
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

  it("reports when the current model does not support thinking", async () => {
    const session = createSessionMock({ supportsThinking: () => false });
    const agentService = createAgentServiceMock(session);
    agentService.models.getThinkingLevel = () => {
      return {
        current: "off",
        available: [],
        supported: false,
      };
    };

    const result = await executeSessionCommand("!thinking", {
      agentService,
      promptQueue: createPromptQueueMock(),
      session,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: "Current model does not support reasoning/thinking.",
    });
  });

  it("sets the requested thinking level when valid", async () => {
    const setThinkingLevel = vi.fn();
    const session = createSessionMock({ setThinkingLevel });

    const result = await executeSessionCommand("!thinking high", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
      workingEmoji: "⚙️",
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

    const result = await executeSessionCommand("!model", {
      agentService,
      promptQueue: createPromptQueueMock(),
      session,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response:
        "Current model: openrouter/model-1\n\nAvailable models (1):\n  openrouter/model-1",
    });
  });

  it("shows usage help for invalid model syntax", async () => {
    const session = createSessionMock();

    const result = await executeSessionCommand("!model openrouter", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response:
        "Usage: !model <provider/modelId>\n" +
        "Example: !model openrouter/anthropic/claude-sonnet-4\n" +
        "Use !model without args to see available models.",
    });
  });

  it("switches models when provider and model id are passed", async () => {
    const session = createSessionMock();
    const agentService = createAgentServiceMock(session);

    const result = await executeSessionCommand(
      "!model openrouter/google/gemini-2.5-flash",
      {
        agentService,
        promptQueue: createPromptQueueMock(),
        session,
        workingEmoji: "⚙️",
      },
    );

    expect(agentService.models.switchModel).toHaveBeenCalledWith(
      "openrouter",
      "google/gemini-2.5-flash",
      session,
    );
    expect(result).toEqual({ handled: true, response: "Switched." });
  });

  it("archives threads only when thread session exists", async () => {
    const dmResult = await executeSessionCommand("!archive", {
      agentService: createAgentServiceMock(null),
      promptQueue: createPromptQueueMock(),
      workingEmoji: "⚙️",
    });

    expect(dmResult).toEqual({
      handled: true,
      response: "!archive is only available in forum threads.",
    });

    const session = createSessionMock();
    const threadResult = await executeSessionCommand("!archive", {
      agentService: createAgentServiceMock(session),
      promptQueue: createPromptQueueMock(),
      session,
      workingEmoji: "⚙️",
    });

    expect(threadResult).toEqual({
      handled: true,
      archive: true,
      response: "Archiving thread and shutting down session.",
    });
  });

  it("enqueues compaction and reload work", async () => {
    const session = createSessionMock();
    const promptQueue = createPromptQueueMock();
    const agentService = createAgentServiceMock(session);

    const compactResult = await executeSessionCommand("!compact", {
      agentService,
      promptQueue,
      session,
      workingEmoji: "⚙️",
    });
    const reloadResult = await executeSessionCommand("!reload", {
      agentService,
      promptQueue,
      session,
      workingEmoji: "⚙️",
    });

    expect(promptQueue.enqueue).toHaveBeenCalledTimes(2);
    expect(session.compact).toHaveBeenCalled();
    expect(agentService.resources.reloadResources).toHaveBeenCalled();
    expect(compactResult).toEqual({
      handled: true,
      response: "Compaction finished for session session-1.",
    });
    expect(reloadResult).toEqual({
      handled: true,
      response: "Resources reloaded.",
    });
  });

  it("resets thread sessions locally and persistent sessions through agent service", async () => {
    const threadSession = createSessionMock();
    const threadQueue = createPromptQueueMock();

    const threadResult = await executeSessionCommand("!reset-session", {
      agentService: createAgentServiceMock(threadSession),
      promptQueue: threadQueue,
      session: threadSession,
      workingEmoji: "⚙️",
    });

    expect(threadSession.abort).toHaveBeenCalled();
    expect(threadSession.dispose).toHaveBeenCalled();
    expect(threadResult).toEqual({
      handled: true,
      response:
        "Session reset. Old session kept at /tmp/session-1.jsonl. Use !archive to archive the thread and start fresh.",
    });

    const dmSession = createSessionMock();
    const agentService = createAgentServiceMock(dmSession);
    const dmResult = await executeSessionCommand("!reset-session", {
      agentService,
      promptQueue: createPromptQueueMock(),
      workingEmoji: "⚙️",
    });

    expect(agentService.resetSession).toHaveBeenCalled();
    expect(dmResult).toEqual({
      handled: true,
      response: "Started a fresh session.",
    });
  });

  it("returns unknown command help for unsupported commands", async () => {
    const result = await executeSessionCommand("!wat", {
      agentService: createAgentServiceMock(createSessionMock()),
      promptQueue: createPromptQueueMock(),
      workingEmoji: "⚙️",
    });

    expect(result).toEqual({
      handled: true,
      response: "Unknown command: !wat. Try !help.",
    });
  });
});
