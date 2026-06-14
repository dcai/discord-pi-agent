import { beforeEach, describe, expect, it, vi } from "vitest";
import { Events } from "discord.js";
import { startGatewayClient } from "./discord-gateway-client";
import type { AgentService } from "./agent-service";
import type { SessionRegistry } from "./session-registry";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const {
  clientState,
  handleDiscordMessageMock,
  handleForumPostEditMock,
  sendReplyMock,
} = vi.hoisted(() => {
  return {
    clientState: {
      instances: [] as Array<Record<string, unknown>>,
    },
    handleDiscordMessageMock: vi.fn(),
    handleForumPostEditMock: vi.fn(),
    sendReplyMock: vi.fn(),
  };
});

vi.mock("discord.js", async () => {
  const actual =
    await vi.importActual<typeof import("discord.js")>("discord.js");

  class ClientMock {
    options: unknown;
    onceHandlers = new Map<string, (value: any) => Promise<void> | void>();
    onHandlers = new Map<string, (value: any) => Promise<void> | void>();
    users = { fetch: vi.fn() };
    login = vi.fn(async () => "logged-in");

    constructor(options: unknown) {
      this.options = options;
      clientState.instances.push(this as unknown as Record<string, unknown>);
    }

    once(event: string, handler: (value: any) => Promise<void> | void) {
      this.onceHandlers.set(event, handler);
      return this;
    }

    on(event: string, handler: (value: any) => Promise<void> | void) {
      this.onHandlers.set(event, handler);
      return this;
    }
  }

  return {
    ...actual,
    Client: ClientMock,
  };
});

vi.mock("./discord-message-handler", () => {
  return {
    handleDiscordMessage: handleDiscordMessageMock,
    handleForumPostEdit: handleForumPostEditMock,
  };
});

vi.mock("./discord-replies", () => {
  return {
    sendReply: sendReplyMock,
  };
});

function createConfig(
  overrides: Partial<ResolvedDiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  return {
    discordBotToken: "bot-token",
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
    ...overrides,
  };
}

const accessConfig: GatewayAccessConfig = {
  discordAllowedUserId: "user-1",
  discordAllowedForumChannelIds: ["forum-1"],
  discordAllowedUserIds: ["user-1"],
  startupMessage: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  clientState.instances.length = 0;
  handleDiscordMessageMock.mockResolvedValue(undefined);
  handleForumPostEditMock.mockResolvedValue(undefined);
  sendReplyMock.mockResolvedValue(undefined);
});

describe("startGatewayClient", () => {
  it("logs in and wires message, edit, and thread handlers", async () => {
    const sessionRegistry = {
      remove: vi.fn(async () => undefined),
    } as unknown as SessionRegistry;

    const client = (await startGatewayClient(
      createConfig(),
      {} as AgentService,
      sessionRegistry,
      accessConfig,
    )) as unknown as {
      login: ReturnType<typeof vi.fn>;
      onHandlers: Map<string, (value: any) => Promise<void> | void>;
    };

    expect(client.login).toHaveBeenCalledWith("bot-token");

    const messageHandler = client.onHandlers.get(Events.MessageCreate);
    const messageUpdateHandler = client.onHandlers.get(Events.MessageUpdate);
    const threadDeleteHandler = client.onHandlers.get(Events.ThreadDelete);

    const message = { id: "message-1" };
    await messageHandler?.(message);

    expect(handleDiscordMessageMock).toHaveBeenCalledWith(
      message,
      expect.anything(),
      expect.anything(),
      sessionRegistry,
      accessConfig,
      undefined,
    );

    const oldMessage = { id: "message-1", content: "old" };
    const newMessage = { id: "message-1", content: "new" };
    await messageUpdateHandler?.(oldMessage, newMessage);

    expect(handleForumPostEditMock).toHaveBeenCalledWith(
      oldMessage,
      newMessage,
      expect.anything(),
      expect.anything(),
      sessionRegistry,
      accessConfig,
    );

    await threadDeleteHandler?.({ id: "thread-1" });
    expect(sessionRegistry.remove).toHaveBeenCalledWith("thread:thread-1");
  });

  it("sends startup dm when configured", async () => {
    const dmSend = vi.fn(async () => undefined);
    const createDM = vi.fn(async () => ({ send: dmSend }));

    const client = (await startGatewayClient(
      createConfig(),
      {} as AgentService,
      {} as SessionRegistry,
      {
        ...accessConfig,
        startupMessage: "Bot is online and ready.",
      },
    )) as unknown as {
      users: { fetch: ReturnType<typeof vi.fn> };
      onceHandlers: Map<string, (value: any) => Promise<void> | void>;
    };

    client.users.fetch.mockResolvedValue({ createDM });

    await client.onceHandlers.get(Events.ClientReady)?.({
      user: { tag: "bot#1234" },
      users: client.users,
    });

    expect(client.users.fetch).toHaveBeenCalledWith("user-1");
    expect(createDM).toHaveBeenCalled();
    expect(dmSend).toHaveBeenCalledWith("Bot is online and ready.");
  });

  it("skips startup dm when disabled", async () => {
    const client = (await startGatewayClient(
      createConfig(),
      {} as AgentService,
      {} as SessionRegistry,
      accessConfig,
    )) as unknown as {
      users: { fetch: ReturnType<typeof vi.fn> };
      onceHandlers: Map<string, (value: any) => Promise<void> | void>;
    };

    await client.onceHandlers.get(Events.ClientReady)?.({
      user: { tag: "bot#1234" },
      users: client.users,
    });

    expect(client.users.fetch).not.toHaveBeenCalled();
  });

  it("sends a fallback reply when message handling fails", async () => {
    handleDiscordMessageMock.mockRejectedValue(new Error("boom"));

    const client = (await startGatewayClient(
      createConfig(),
      {} as AgentService,
      {} as SessionRegistry,
      accessConfig,
    )) as unknown as {
      onHandlers: Map<string, (value: any) => Promise<void> | void>;
    };

    const message = { id: "message-1" };
    await client.onHandlers.get(Events.MessageCreate)?.(message);

    expect(sendReplyMock).toHaveBeenCalledWith(
      message,
      "The bot hit an error while handling that message.",
    );
  });
});
