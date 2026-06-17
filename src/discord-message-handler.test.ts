import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";
import {
  handleDiscordMessage,
  handleForumPostEdit,
} from "./discord-message-handler";
import type { AgentService } from "./agent-service";
import type { SessionRegistry } from "./session-registry";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const {
  executeSessionCommandMock,
  readTextAttachmentsMock,
  readMediaAttachmentsMock,
  resolveMediaAttachmentsForPromptMock,
  addReactionMock,
  addWorkingReactionMock,
  removeReactionMock,
  removeWorkingReactionMock,
  sendReplyMock,
  sendCommandReplyMock,
  startTypingForChannelMock,
  stopTypingForChannelMock,
  runAgentTurnMock,
} = vi.hoisted(() => {
  return {
    executeSessionCommandMock: vi.fn(),
    readTextAttachmentsMock: vi.fn(),
    readMediaAttachmentsMock: vi.fn(),
    resolveMediaAttachmentsForPromptMock: vi.fn(),
    addReactionMock: vi.fn(),
    addWorkingReactionMock: vi.fn(),
    removeReactionMock: vi.fn(),
    removeWorkingReactionMock: vi.fn(),
    sendReplyMock: vi.fn(),
    sendCommandReplyMock: vi.fn(),
    startTypingForChannelMock: vi.fn(),
    stopTypingForChannelMock: vi.fn(),
    runAgentTurnMock: vi.fn(),
  };
});

vi.mock("./session-commands", () => {
  return {
    executeSessionCommand: executeSessionCommandMock,
  };
});

vi.mock("./discord-attachments", () => {
  return {
    readTextAttachments: readTextAttachmentsMock,
    readMediaAttachments: readMediaAttachmentsMock,
  };
});

vi.mock("./discord-media-resolution", () => {
  return {
    resolveMediaAttachmentsForPrompt: resolveMediaAttachmentsForPromptMock,
  };
});

vi.mock("./discord-replies", () => {
  return {
    addReaction: addReactionMock,
    addWorkingReaction: addWorkingReactionMock,
    removeReaction: removeReactionMock,
    removeWorkingReaction: removeWorkingReactionMock,
    sendReply: sendReplyMock,
    sendCommandReply: sendCommandReplyMock,
  };
});

vi.mock("./discord-typing", () => {
  return {
    startTypingForChannel: startTypingForChannelMock,
    stopTypingForChannel: stopTypingForChannelMock,
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
    promptTransform: vi.fn(
      async (ctx: {
        rawContent: string;
        discordMetadata: string;
        now: () => string;
        userMessage: () => string;
      }) => `transformed:${ctx.rawContent}`,
    ),
    startupMessage: false,
    shutdownOnSignals: true,
    visionModelId: null,
    discordAllowedForumChannelIds: ["forum-1"],
    discordAllowedUserIds: ["user-1", "user-2"],
    discordCommandPrefixes: ["!"],
    discordCommandRegistrationScope: "none",
    discordCommandRegistrationGuildIds: [],
    ...overrides,
  };
}

const accessConfig: GatewayAccessConfig = {
  discordAllowedUserId: "user-1",
  discordAllowedForumChannelIds: ["forum-1"],
  discordAllowedUserIds: ["user-1", "user-2"],
  startupMessage: false,
};

function createSession() {
  return {
    model: { provider: "openrouter", id: "model-1" },
  };
}

function createPromptQueue(overrides: Record<string, unknown> = {}) {
  return {
    getSnapshot: vi.fn(() => ({ pending: 0, busy: false })),
    enqueue: vi.fn(async (task: () => Promise<string>) => {
      return task();
    }),
    ...overrides,
  };
}

function createSessionRegistry(
  entryOverrides: Record<string, unknown> = {},
): SessionRegistry {
  return {
    getOrCreate: vi.fn(async () => {
      return {
        created: false,
        entry: {
          session: createSession(),
          promptQueue: createPromptQueue(),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          workingEmoji: "⚙️",
          ...entryOverrides,
        },
      };
    }),
    remove: vi.fn(async () => undefined),
  } as unknown as SessionRegistry;
}

function createAgentService(): AgentService {
  return {} as AgentService;
}

function createMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const channel = {
    id: "channel-1",
    type: ChannelType.DM,
    isThread: () => false,
    isSendable: () => true,
    send: vi.fn(async () => undefined),
    ...((overrides.channel as Record<string, unknown> | undefined) ?? {}),
  };

  return {
    id: "message-1",
    content: "hello there",
    createdAt: new Date("2026-05-18T10:00:00.000Z"),
    system: false,
    author: {
      id: "user-1",
      username: "alice",
      globalName: "Alice",
      bot: false,
      ...((overrides.author as Record<string, unknown> | undefined) ?? {}),
    },
    member: null,
    attachments: new Map(),
    reactions: { cache: new Map() },
    reply: vi.fn(async () => undefined),
    client: { user: { id: "bot-user" } },
    ...overrides,
    channel,
  };
}

function createForumStarterMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return createMessage({
    id: "thread-1",
    content: "original topic",
    editedAt: new Date("2026-05-18T10:05:00.000Z"),
    channel: {
      id: "thread-1",
      type: ChannelType.PublicThread,
      name: "Bug report",
      parentId: "forum-1",
      isThread: () => true,
      isSendable: () => true,
      send: vi.fn(async () => undefined),
    },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  executeSessionCommandMock.mockResolvedValue({ handled: false });
  readTextAttachmentsMock.mockResolvedValue([]);
  readMediaAttachmentsMock.mockResolvedValue([]);
  resolveMediaAttachmentsForPromptMock.mockImplementation(
    async (_media, content) => {
      return {
        content,
        images: [],
      };
    },
  );
  addReactionMock.mockResolvedValue(undefined);
  addWorkingReactionMock.mockResolvedValue(undefined);
  removeReactionMock.mockResolvedValue(undefined);
  removeWorkingReactionMock.mockResolvedValue(undefined);
  sendReplyMock.mockResolvedValue(undefined);
  sendCommandReplyMock.mockResolvedValue(undefined);
  startTypingForChannelMock.mockImplementation(() => undefined);
  stopTypingForChannelMock.mockImplementation(() => undefined);
  runAgentTurnMock.mockResolvedValue("agent reply");
});

describe("handleForumPostEdit", () => {
  it("reuses the normal prompt pipeline for edited forum starter posts", async () => {
    const config = createConfig();
    const session = createSession();
    const promptQueue = createPromptQueue();
    const registry = createSessionRegistry({ session, promptQueue });
    const oldMessage = createForumStarterMessage({ content: "old topic" });
    const newMessage = createForumStarterMessage({ content: "new topic" });

    await handleForumPostEdit(
      oldMessage as never,
      newMessage as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    expect(executeSessionCommandMock).not.toHaveBeenCalled();
    expect(startTypingForChannelMock).toHaveBeenCalledWith(
      newMessage.channel,
      "thread-1",
    );
    expect(addWorkingReactionMock).toHaveBeenCalledWith(newMessage, "⚙️");
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      session,
      "transformed:new topic",
      expect.objectContaining({
        images: undefined,
        onToolStart: expect.any(Function),
        onToolEnd: expect.any(Function),
      }),
    );
    expect(config.promptTransform).toHaveBeenCalledWith(
      expect.objectContaining({
        rawContent: "new topic",
        discordMetadata: expect.stringContaining(
          '"event_type": "thread_starter_edit"',
        ),
      }),
    );
    expect(config.promptTransform).toHaveBeenCalledWith(
      expect.objectContaining({
        discordMetadata: expect.stringContaining(
          '"edited_at": "2026-05-18T10:05:00.000Z"',
        ),
      }),
    );
    expect(sendReplyMock).toHaveBeenCalledWith(newMessage, "agent reply");
    expect(stopTypingForChannelMock).toHaveBeenCalledWith("thread-1");
    expect(removeWorkingReactionMock).toHaveBeenCalledWith(newMessage, "⚙️");
  });

  it("ignores unchanged edits and non-starter thread messages", async () => {
    const config = createConfig();
    const registry = createSessionRegistry();

    await handleForumPostEdit(
      createForumStarterMessage({ content: "same topic" }) as never,
      createForumStarterMessage({ content: "same topic" }) as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    await handleForumPostEdit(
      createForumStarterMessage({
        id: "message-2",
        content: "old reply",
      }) as never,
      createForumStarterMessage({
        id: "message-2",
        content: "new reply",
      }) as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    expect(runAgentTurnMock).not.toHaveBeenCalled();
    expect(sendReplyMock).not.toHaveBeenCalled();
    expect(startTypingForChannelMock).not.toHaveBeenCalled();
  });
});

describe("handleDiscordMessage", () => {
  it("ignores bot, system, unsupported, unauthorized, and empty messages", async () => {
    const config = createConfig();
    const registry = createSessionRegistry();

    await handleDiscordMessage(
      createMessage({ author: { bot: true } }) as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    await handleDiscordMessage(
      createMessage({ system: true }) as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    await handleDiscordMessage(
      createMessage({
        channel: {
          id: "guild-1",
          type: ChannelType.GuildText,
          isThread: () => false,
          isSendable: () => true,
        },
      }) as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    await handleDiscordMessage(
      createMessage({ author: { id: "intruder" } }) as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    await handleDiscordMessage(
      createMessage({ content: "   " }) as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    expect(executeSessionCommandMock).not.toHaveBeenCalled();
    expect(startTypingForChannelMock).not.toHaveBeenCalled();
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("appends text attachments and sends a transformed prompt reply", async () => {
    const config = createConfig();
    const session = createSession();
    const promptQueue = createPromptQueue();
    const registry = createSessionRegistry({ session, promptQueue });
    const message = createMessage();

    readTextAttachmentsMock.mockResolvedValue([
      { filename: "notes.md", content: "Attachment body" },
    ]);

    await handleDiscordMessage(
      message as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    expect(startTypingForChannelMock).toHaveBeenCalledWith(
      message.channel,
      "channel-1",
    );
    expect(addWorkingReactionMock).toHaveBeenCalledWith(message, "⚙️");
    expect(executeSessionCommandMock).toHaveBeenCalledWith(
      "hello there\n\n--- Attachment: notes.md ---\nAttachment body",
      expect.objectContaining({ session }),
    );
    expect(resolveMediaAttachmentsForPromptMock).not.toHaveBeenCalled();
    expect(config.promptTransform).toHaveBeenCalledWith(
      expect.objectContaining({
        rawContent: expect.stringContaining(
          "hello there\n\n--- Attachment: notes.md ---\nAttachment body",
        ),
      }),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      session,
      "transformed:hello there\n\n--- Attachment: notes.md ---\nAttachment body",
      expect.objectContaining({
        images: undefined,
        onToolStart: expect.any(Function),
        onToolEnd: expect.any(Function),
      }),
    );
    expect(sendReplyMock).toHaveBeenCalledWith(message, "agent reply");
    expect(stopTypingForChannelMock).toHaveBeenCalledWith("channel-1");
    expect(removeWorkingReactionMock).toHaveBeenCalledWith(message, "⚙️");
  });

  it("adds and removes mapped and fallback tool reactions during a prompt", async () => {
    const config = createConfig();
    const registry = createSessionRegistry();
    const message = createMessage();

    runAgentTurnMock.mockImplementation(async (_session, _prompt, options) => {
      await options.onToolStart({ toolName: "read", toolCallId: "call-1" });
      await options.onToolEnd({ toolName: "read", toolCallId: "call-1" });
      await options.onToolStart({
        toolName: "custom-tool",
        toolCallId: "call-2",
      });
      await options.onToolEnd({
        toolName: "custom-tool",
        toolCallId: "call-2",
      });
      return "agent reply";
    });

    await handleDiscordMessage(
      message as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    expect(addReactionMock).toHaveBeenNthCalledWith(1, message, "👀");
    expect(removeReactionMock).toHaveBeenNthCalledWith(1, message, "👀");
    expect(addReactionMock).toHaveBeenNthCalledWith(2, message, "🔧");
    expect(removeReactionMock).toHaveBeenNthCalledWith(2, message, "🔧");
    expect(removeWorkingReactionMock).toHaveBeenCalledWith(message, "⚙️");
  });

  it("serializes fast tool reaction operations so short-lived tools still clean up", async () => {
    const config = createConfig();
    const registry = createSessionRegistry();
    const message = createMessage();

    addReactionMock.mockImplementation(async () => {
      await Promise.resolve();
    });

    runAgentTurnMock.mockImplementation(async (_session, _prompt, options) => {
      const startPromise = options.onToolStart({
        toolName: "read",
        toolCallId: "call-1",
      });
      const endPromise = options.onToolEnd({
        toolName: "read",
        toolCallId: "call-1",
      });

      await Promise.all([startPromise, endPromise]);
      return "agent reply";
    });

    await handleDiscordMessage(
      message as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    expect(addReactionMock).toHaveBeenCalledWith(message, "👀");
    expect(removeReactionMock).toHaveBeenCalledWith(message, "👀");
  });

  it("ref-counts overlapping tool reactions and removes leftovers on failure", async () => {
    const config = createConfig();
    const registry = createSessionRegistry();
    const message = createMessage();

    runAgentTurnMock.mockImplementation(async (_session, _prompt, options) => {
      await options.onToolStart({ toolName: "read", toolCallId: "call-1" });
      await options.onToolStart({ toolName: "read", toolCallId: "call-2" });
      await options.onToolEnd({ toolName: "read", toolCallId: "call-1" });
      throw new Error("prompt failed");
    });

    await expect(
      handleDiscordMessage(
        message as never,
        config,
        createAgentService(),
        registry,
        accessConfig,
      ),
    ).rejects.toThrow("prompt failed");

    expect(addReactionMock).toHaveBeenCalledTimes(1);
    expect(addReactionMock).toHaveBeenCalledWith(message, "👀");
    expect(removeReactionMock).toHaveBeenCalledTimes(1);
    expect(removeReactionMock).toHaveBeenCalledWith(message, "👀");
    expect(removeWorkingReactionMock).toHaveBeenCalledWith(message, "⚙️");
  });

  it("handles commands without prompting the agent", async () => {
    const config = createConfig();
    const registry = createSessionRegistry();
    const message = createMessage({ content: "!help" });

    executeSessionCommandMock.mockResolvedValue({
      handled: true,
      response: "command reply",
    });

    await handleDiscordMessage(
      message as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    expect(sendCommandReplyMock).toHaveBeenCalledWith(message, "command reply");
    expect(runAgentTurnMock).not.toHaveBeenCalled();
    expect(addWorkingReactionMock).not.toHaveBeenCalled();
    expect(stopTypingForChannelMock).toHaveBeenCalledWith("channel-1");
  });

  it("forwards command-built input into the agent prompt pipeline", async () => {
    const config = createConfig();
    const registry = createSessionRegistry();
    const message = createMessage({ content: "!job update hello-dm" });

    executeSessionCommandMock.mockResolvedValue({
      handled: false,
      forwardedInput: "scheduler aware prompt",
    });

    await handleDiscordMessage(
      message as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.anything(),
      "transformed:scheduler aware prompt",
      expect.objectContaining({
        images: undefined,
        onToolStart: expect.any(Function),
        onToolEnd: expect.any(Function),
      }),
    );
    expect(sendReplyMock).toHaveBeenCalledWith(message, "agent reply");
  });

  it("sends queue notice, resolves media, and still cleans up on prompt failure", async () => {
    const config = createConfig();
    const session = createSession();
    const promptQueue = createPromptQueue({
      getSnapshot: vi.fn(() => ({ pending: 2, busy: true })),
    });
    const registry = createSessionRegistry({ session, promptQueue });
    const message = createMessage();
    const mediaAttachment = {
      filename: "photo.png",
      data: "base64-data",
      mimeType: "image/png",
    };

    readMediaAttachmentsMock.mockResolvedValue([mediaAttachment]);
    resolveMediaAttachmentsForPromptMock.mockResolvedValue({
      content: "resolved media content",
      images: [{ type: "image", data: "base64-data", mimeType: "image/png" }],
    });
    runAgentTurnMock.mockRejectedValue(new Error("prompt failed"));

    await expect(
      handleDiscordMessage(
        message as never,
        config,
        createAgentService(),
        registry,
        accessConfig,
      ),
    ).rejects.toThrow("prompt failed");

    expect(sendReplyMock).toHaveBeenCalledWith(
      message,
      "Queued. 2 request(s) ahead of this one.",
    );
    expect(resolveMediaAttachmentsForPromptMock).toHaveBeenCalledWith(
      [mediaAttachment],
      "hello there",
      session.model,
      config,
      expect.anything(),
    );
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      session,
      "transformed:resolved media content",
      expect.objectContaining({
        images: [{ type: "image", data: "base64-data", mimeType: "image/png" }],
        onToolStart: expect.any(Function),
        onToolEnd: expect.any(Function),
      }),
    );
    expect(stopTypingForChannelMock).toHaveBeenCalledWith("channel-1");
    expect(removeWorkingReactionMock).toHaveBeenCalledWith(message, "⚙️");
  });

  it("returns early when the channel is not sendable after a command miss", async () => {
    const config = createConfig();
    const registry = createSessionRegistry();
    const message = createMessage({
      channel: {
        id: "channel-1",
        type: ChannelType.DM,
        isThread: () => false,
        isSendable: () => false,
      },
    });

    await handleDiscordMessage(
      message as never,
      config,
      createAgentService(),
      registry,
      accessConfig,
    );

    expect(addWorkingReactionMock).not.toHaveBeenCalled();
    expect(runAgentTurnMock).not.toHaveBeenCalled();
    expect(stopTypingForChannelMock).toHaveBeenCalledWith("channel-1");
  });
});
