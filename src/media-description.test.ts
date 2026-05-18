import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeMediaAttachment } from "./media-description";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    messages: [],
    setModel: vi.fn(async () => undefined),
    prompt: vi.fn(async () => undefined),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as AgentSession;
}

function createAgentService(session: AgentSession) {
  return {
    createTemporarySession: vi.fn(async () => session),
  };
}

const visionModel = {
  provider: "openrouter",
  id: "google/gemini-2.5-flash",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("describeMediaAttachment", () => {
  it("describes images with user text", async () => {
    const session = createSession({
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "A cat on a chair" }],
        } as never,
      ],
    });
    const agentService = createAgentService(session);

    await expect(
      describeMediaAttachment(
        agentService as never,
        "base64-data",
        "image/png",
        "what do you see?",
        visionModel as never,
      ),
    ).resolves.toBe("A cat on a chair");

    expect(session.setModel).toHaveBeenCalledWith(visionModel);
    expect(session.prompt).toHaveBeenCalledWith(
      expect.stringContaining('The user sent this image with the following message: "what do you see?"'),
      {
        images: [
          {
            type: "image",
            data: "base64-data",
            mimeType: "image/png",
          },
        ],
      },
    );
    expect(session.dispose).toHaveBeenCalled();
  });

  it("uses the document prompt for non-image files", async () => {
    const session = createSession({
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Document summary" }],
        } as never,
      ],
    });

    await describeMediaAttachment(
      createAgentService(session) as never,
      "base64-data",
      "application/pdf",
      "",
      visionModel as never,
    );

    expect(session.prompt).toHaveBeenCalledWith(
      expect.stringContaining("Please extract and summarize the text content of this document."),
      expect.anything(),
    );
  });

  it("returns a fallback when the vision prompt fails", async () => {
    const session = createSession({
      prompt: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    await expect(
      describeMediaAttachment(
        createAgentService(session) as never,
        "base64-data",
        "image/png",
        "",
        visionModel as never,
      ),
    ).resolves.toBe("(Vision model failed to process the file.)");
    expect(session.dispose).toHaveBeenCalled();
  });

  it("returns a fallback when the vision model gives no assistant text", async () => {
    const session = createSession({
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] } as never,
      ],
    });

    await expect(
      describeMediaAttachment(
        createAgentService(session) as never,
        "base64-data",
        "image/png",
        "",
        visionModel as never,
      ),
    ).resolves.toBe("(Vision model returned no description.)");
  });
});
