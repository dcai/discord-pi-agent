import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { runAgentTurn } from "./agent-turn-runner";

const { debugPrintMock, formatResponseForDiscordMock } = vi.hoisted(() => {
  return {
    debugPrintMock: vi.fn(),
    formatResponseForDiscordMock: vi.fn(async (text: string) => {
      return `transformed:${text}`;
    }),
  };
});

vi.mock("./debug-print", () => {
  return {
    debugPrint: debugPrintMock,
  };
});

vi.mock("./discord-response-formatter", () => {
  return {
    formatResponseForDiscord: formatResponseForDiscordMock,
  };
});

function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const listeners: Array<(event: AgentSessionEvent) => void> = [];

  return {
    model: { provider: "openrouter", id: "model-1" },
    agent: { state: { errorMessage: undefined } } as never,
    messages: [],
    subscribe: vi.fn((callback: (event: AgentSessionEvent) => void) => {
      listeners.push(callback);
      return vi.fn(() => undefined);
    }),
    prompt: vi.fn(async () => {
      return undefined;
    }),
    ...overrides,
    __listeners: listeners,
  } as unknown as AgentSession;
}

function emit(session: AgentSession, event: AgentSessionEvent): void {
  const listeners = (
    session as unknown as {
      __listeners: Array<(event: AgentSessionEvent) => void>;
    }
  ).__listeners;
  listeners.forEach((listener) => {
    listener(event);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runAgentTurn", () => {
  it("collects streamed text deltas, transforms the final text, and emits tool callbacks", async () => {
    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();
    const session = createSession({
      prompt: vi.fn(async () => {
        emit(session, {
          type: "message_update",
          assistantMessageEvent: { type: "thinking_delta", delta: "ignore me" },
        } as AgentSessionEvent);
        emit(session, {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Hello " },
        } as AgentSessionEvent);
        emit(session, {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "world" },
        } as AgentSessionEvent);
        emit(session, {
          type: "tool_execution_start",
          toolName: "bash",
          toolCallId: "call-1",
          args: { command: "echo hi" },
        } as AgentSessionEvent);
        emit(session, {
          type: "tool_execution_end",
          toolName: "bash",
          toolCallId: "call-1",
          isError: false,
          result: { ok: true },
        } as AgentSessionEvent);
      }),
    });

    await expect(
      runAgentTurn(session, "prompt", { onToolStart, onToolEnd }),
    ).resolves.toBe("transformed:Hello world");
    expect(session.prompt).toHaveBeenCalledWith("prompt", {
      images: undefined,
    });
    expect(formatResponseForDiscordMock).toHaveBeenCalledWith("Hello world");
    expect(debugPrintMock).toHaveBeenCalledWith("prompt", "Full Prompt");
    expect(onToolStart).toHaveBeenCalledWith({
      toolName: "bash",
      toolCallId: "call-1",
    });
    expect(onToolEnd).toHaveBeenCalledWith({
      toolName: "bash",
      toolCallId: "call-1",
      isError: false,
    });
  });

  it("falls back to the latest assistant text when no stream text is emitted", async () => {
    const session = createSession({
      messages: [
        { role: "user", content: [{ type: "text", text: "user" }] } as never,
        {
          role: "assistant",
          content: [{ type: "text", text: "old reply" }],
        } as never,
        {
          role: "assistant",
          content: [
            { type: "text", text: "latest" },
            { type: "text", text: "reply" },
          ],
        } as never,
      ],
    });

    await expect(runAgentTurn(session, "prompt")).resolves.toBe(
      "transformed:latest\nreply",
    );
  });

  it("returns partial response with note when error occurs after streaming", async () => {
    const session = createSession({
      agent: { state: { errorMessage: "  model exploded  " } } as never,
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "partial response" }],
        } as never,
      ],
      prompt: vi.fn(async () => {
        emit(session, {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "streamed " },
        } as AgentSessionEvent);
        emit(session, {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "text" },
        } as AgentSessionEvent);
      }),
    });

    await expect(runAgentTurn(session, "prompt")).resolves.toBe(
      "transformed:streamed text\n\n> *[Response cut off — the model provider encountered a network error. Try again.]*",
    );
    expect(formatResponseForDiscordMock).toHaveBeenCalledWith("streamed text");
  });

  it("returns fallback text with note when error occurs without streaming", async () => {
    const session = createSession({
      agent: { state: { errorMessage: "  model exploded  " } } as never,
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "fallback text" }],
        } as never,
      ],
    });

    await expect(runAgentTurn(session, "prompt")).resolves.toBe(
      "transformed:fallback text\n\n> *[Response cut off — the model provider encountered a network error. Try again.]*",
    );
    expect(formatResponseForDiscordMock).toHaveBeenCalledWith("fallback text");
  });

  it("returns friendly error when session errors with no text at all", async () => {
    const session = createSession({
      agent: { state: { errorMessage: "  socket died  " } } as never,
    });

    await expect(runAgentTurn(session, "prompt")).resolves.toBe(
      "The model provider returned an error. This is usually a temporary network issue — please try again.\n\n> `socket died`",
    );
    expect(formatResponseForDiscordMock).not.toHaveBeenCalled();
  });

  it("returns a default message when no assistant text exists", async () => {
    const session = createSession();

    await expect(runAgentTurn(session, "prompt")).resolves.toBe(
      "No response generated.",
    );
  });

  it("always unsubscribes even when prompt throws", async () => {
    const unsubscribe = vi.fn();
    const session = createSession({
      subscribe: vi.fn(() => unsubscribe),
      prompt: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    await expect(runAgentTurn(session, "prompt")).rejects.toThrow("boom");
    expect(unsubscribe).toHaveBeenCalled();
  });
});
