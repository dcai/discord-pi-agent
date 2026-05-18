import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addWorkingReaction,
  removeWorkingReaction,
  sendReply,
} from "./discord-replies";

const { chunkMessageMock } = vi.hoisted(() => {
  return {
    chunkMessageMock: vi.fn(),
  };
});

vi.mock("./message-chunker", () => {
  return {
    chunkMessage: chunkMessageMock,
  };
});

function createMessage(overrides: Record<string, unknown> = {}) {
  const channel = {
    isSendable: () => true,
    send: vi.fn(async () => undefined),
    ...((overrides.channel as Record<string, unknown> | undefined) ?? {}),
  };

  return {
    id: "message-1",
    react: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    reactions: {
      cache: new Map(),
    },
    client: { user: { id: "bot-user" } },
    ...overrides,
    channel,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  chunkMessageMock.mockImplementation((text: string) => [text]);
});

describe("discord-replies", () => {
  it("adds and removes the working reaction safely", async () => {
    const remove = vi.fn(async () => undefined);
    const message = createMessage({
      reactions: {
        cache: new Map([["⚙️", { users: { remove } }]]),
      },
    });

    await addWorkingReaction(message as never);
    await removeWorkingReaction(message as never);

    expect(message.react).toHaveBeenCalledWith("⚙️");
    expect(remove).toHaveBeenCalledWith(message.client.user);
  });

  it("swallows reaction errors and missing reactions", async () => {
    const message = createMessage({
      react: vi.fn(async () => {
        throw new Error("nope");
      }),
    });

    await expect(addWorkingReaction(message as never)).resolves.toBeUndefined();
    await expect(
      removeWorkingReaction(message as never),
    ).resolves.toBeUndefined();
  });

  it("skips replies for non-sendable channels", async () => {
    const message = createMessage({
      channel: {
        isSendable: () => false,
        send: vi.fn(async () => undefined),
      },
    });

    await sendReply(message as never, "hello");

    expect(message.reply).not.toHaveBeenCalled();
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it("replies in chunks and sends overflow chunks to the channel", async () => {
    chunkMessageMock.mockReturnValue(["chunk-1", "chunk-2", "chunk-3"]);
    const message = createMessage();

    await sendReply(message as never, "long reply");

    expect(message.reply).toHaveBeenCalledWith("chunk-1");
    expect(message.channel.send).toHaveBeenNthCalledWith(1, "chunk-2");
    expect(message.channel.send).toHaveBeenNthCalledWith(2, "chunk-3");
  });

  it("returns early when chunking yields no content and swallows reply errors", async () => {
    chunkMessageMock.mockReturnValueOnce([]).mockReturnValueOnce(["chunk-1"]);
    const message = createMessage({
      reply: vi.fn(async () => {
        throw new Error("cannot reply");
      }),
    });

    await expect(sendReply(message as never, "empty")).resolves.toBeUndefined();
    await expect(
      sendReply(message as never, "broken"),
    ).resolves.toBeUndefined();

    expect(message.channel.send).not.toHaveBeenCalled();
  });
});
