import { beforeEach, describe, expect, it, vi } from "vitest";
import { Events, Partials } from "discord.js";
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
  handleDiscordInteractionMock,
  handleForumPostEditMock,
  sendReplyMock,
  syncDiscordApplicationCommandsMock,
} = vi.hoisted(() => {
  return {
    clientState: {
      instances: [] as Array<Record<string, unknown>>,
    },
    handleDiscordMessageMock: vi.fn(),
    handleDiscordInteractionMock: vi.fn(),
    handleForumPostEditMock: vi.fn(),
    sendReplyMock: vi.fn(),
    syncDiscordApplicationCommandsMock: vi.fn(),
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
      const previousHandler = this.onceHandlers.get(event);
      if (!previousHandler) {
        this.onceHandlers.set(event, handler);
        return this;
      }

      this.onceHandlers.set(event, async (value: any) => {
        await previousHandler(value);
        await handler(value);
      });
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

vi.mock("./discord-interactions", () => {
  return {
    handleDiscordInteraction: handleDiscordInteractionMock,
    syncDiscordApplicationCommands: syncDiscordApplicationCommandsMock,
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
    discordCommandPrefixes: ["!"],
    discordCommandRegistrationScope: "none",
    discordCommandRegistrationGuildIds: [],
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
  delete process.env.DISCORD_PI_AGENT_LOG_RAW_EVENTS;
  handleDiscordMessageMock.mockResolvedValue(undefined);
  handleDiscordInteractionMock.mockResolvedValue(undefined);
  handleForumPostEditMock.mockResolvedValue(undefined);
  sendReplyMock.mockResolvedValue(undefined);
  syncDiscordApplicationCommandsMock.mockResolvedValue(undefined);
});

describe("startGatewayClient", () => {
  it("logs in and wires message, interaction, edit, and thread handlers", async () => {
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
      onceHandlers: Map<string, (value: any) => Promise<void> | void>;
    };

    expect(client.login).toHaveBeenCalledWith("bot-token");
    expect(clientState.instances[0]?.options).toMatchObject({
      partials: expect.arrayContaining([Partials.Channel, Partials.Message]),
    });

    const messageHandler = client.onHandlers.get(Events.MessageCreate);
    const interactionHandler = client.onHandlers.get(Events.InteractionCreate);
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

    const interaction = { id: "interaction-1" };
    await interactionHandler?.(interaction);

    expect(handleDiscordInteractionMock).toHaveBeenCalledWith(
      interaction,
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

    await client.onceHandlers.get(Events.ClientReady)?.({
      application: {
        commands: {
          set: vi.fn(),
        },
      },
      guilds: {
        fetch: vi.fn(),
      },
      user: { tag: "bot#1234" },
      users: client.users,
    });
    expect(syncDiscordApplicationCommandsMock).toHaveBeenCalled();
  });

  it("wires raw gateway handler when enabled by env", async () => {
    process.env.DISCORD_PI_AGENT_LOG_RAW_EVENTS = "true";

    const client = (await startGatewayClient(
      createConfig(),
      {} as AgentService,
      {} as SessionRegistry,
      accessConfig,
    )) as unknown as {
      onHandlers: Map<
        string,
        (value: any, value2?: any) => Promise<void> | void
      >;
    };

    const rawHandler = client.onHandlers.get(Events.Raw);

    expect(rawHandler).toBeDefined();
    await rawHandler?.({
      t: "MESSAGE_UPDATE",
      s: 123,
      op: 0,
      d: {
        id: "message-1",
        channel_id: "channel-1",
        guild_id: "guild-1",
        content: "updated topic body",
      },
    });
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

  it("does not reject when the fallback error reply also fails", async () => {
    handleDiscordMessageMock.mockRejectedValue(new Error("boom"));
    sendReplyMock.mockRejectedValue(new Error("discord unavailable"));

    const client = (await startGatewayClient(
      createConfig(),
      {} as AgentService,
      {} as SessionRegistry,
      accessConfig,
    )) as unknown as {
      onHandlers: Map<string, (value: any) => Promise<void> | void>;
    };

    await expect(
      client.onHandlers.get(Events.MessageCreate)?.({ id: "message-1" }),
    ).resolves.toBeUndefined();
  });

  it("contains thread cleanup failures", async () => {
    const sessionRegistry = {
      remove: vi.fn(async () => {
        throw new Error("cleanup failed");
      }),
    } as unknown as SessionRegistry;

    const client = (await startGatewayClient(
      createConfig(),
      {} as AgentService,
      sessionRegistry,
      accessConfig,
    )) as unknown as {
      onHandlers: Map<string, (value: any) => Promise<void> | void>;
    };

    await expect(
      client.onHandlers.get(Events.ThreadDelete)?.({ id: "thread-1" }),
    ).resolves.toBeUndefined();
  });
});
