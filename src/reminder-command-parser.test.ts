import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseReminderCommand } from "./reminder-command-parser";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    messages: [],
    prompt: vi.fn(async () => undefined),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as AgentSession;
}

function createAgentService(session: AgentSession) {
  return {
    createTemporarySession: vi.fn(async () => session),
    models: {
      ensureSessionHasConfiguredModel: vi.fn(async () => undefined),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseReminderCommand", () => {
  it("parses a reminder response from an in-memory session", async () => {
    const session = createSession({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: [
                "```json",
                '{"runAt":"2026-06-11T04:00:00.000Z","prompt":"Check what AAPL\'s latest share price is.","description":"AAPL reminder"}',
                "```",
              ].join("\n"),
            },
          ],
        } as never,
      ],
    });
    const agentService = createAgentService(session);

    await expect(
      parseReminderCommand({
        agentService: agentService as never,
        input: "tomorrow 14:00, check what is aapl's latest share price",
        now: new Date("2026-06-10T10:57:20.984Z"),
        timeZone: "Australia/Sydney",
        locale: "en-AU",
      }),
    ).resolves.toEqual({
      runAt: "2026-06-11T04:00:00.000Z",
      prompt: "Check what AAPL's latest share price is.",
      description: "AAPL reminder",
    });

    expect(agentService.createTemporarySession).toHaveBeenCalledOnce();
    expect(
      agentService.models.ensureSessionHasConfiguredModel,
    ).toHaveBeenCalledWith(session);
    expect(session.prompt).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it("throws the parser error when the model reports ambiguity", async () => {
    const session = createSession({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: '{"error":"I could not safely determine the reminder time."}',
            },
          ],
        } as never,
      ],
    });

    await expect(
      parseReminderCommand({
        agentService: createAgentService(session) as never,
        input: "remind me sometime tomorrow",
        now: new Date("2026-06-10T10:57:20.984Z"),
        timeZone: "Australia/Sydney",
        locale: "en-AU",
      }),
    ).rejects.toThrow("I could not safely determine the reminder time.");
    expect(session.dispose).toHaveBeenCalledOnce();
  });
});
