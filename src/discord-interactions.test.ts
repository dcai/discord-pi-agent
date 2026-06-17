import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType, MessageFlags } from "discord.js";
import {
  handleDiscordInteraction,
  syncDiscordApplicationCommands,
} from "./discord-interactions";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const { executeSessionCommandMock } = vi.hoisted(() => {
  return {
    executeSessionCommandMock: vi.fn(),
  };
});

vi.mock("./session-commands", () => {
  return {
    executeSessionCommand: executeSessionCommandMock,
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
    promptTransform: async (ctx) => ctx.rawContent,
    startupMessage: false,
    shutdownOnSignals: true,
    visionModelId: null,
    discordAllowedForumChannelIds: ["forum-1"],
    discordAllowedUserIds: ["user-1"],
    discordCommandPrefixes: ["!", ";"],
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

function createSessionRegistry() {
  return {
    getOrCreate: vi.fn(async () => {
      return {
        created: true,
        entry: {
          session: { sessionId: "session-1" },
          promptQueue: {
            enqueue: vi.fn(),
            getSnapshot: vi.fn(),
            getCancellationCount: vi.fn(() => 0),
          },
          createdAt: new Date(),
          workingEmoji: "⚙️",
        },
      };
    }),
    get: vi.fn(() => undefined),
    remove: vi.fn(async () => undefined),
  };
}

function createAgentService() {
  return {
    getSession: vi.fn(() => null),
    models: {
      listModelChoices: vi.fn(async () => [
        {
          name: "openrouter/model-1",
          value: "openrouter/model-1",
        },
        {
          name: "openrouter/model-2",
          value: "openrouter/model-2",
        },
      ]),
    },
  };
}

function createChatInputInteraction(options: {
  commandName: string;
  stringOptions?: Record<string, string | null>;
  subcommand?: string;
}) {
  return {
    channel: {
      type: ChannelType.DM,
      isThread: () => false,
    },
    channelId: "dm-channel-1",
    user: { id: "user-1" },
    commandName: options.commandName,
    deferred: false,
    replied: false,
    options: {
      getString: (name: string, required?: boolean) => {
        const value = options.stringOptions?.[name] ?? null;
        if (required && value === null) {
          throw new Error(`Missing required option: ${name}`);
        }

        return value;
      },
      getSubcommand: () => {
        if (!options.subcommand) {
          throw new Error("Missing subcommand");
        }

        return options.subcommand;
      },
    },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    showModal: vi.fn(async () => undefined),
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
  };
}

function createAutocompleteInteraction(options: {
  commandName: string;
  focusedName: string;
  focusedValue: string;
}) {
  return {
    channel: {
      type: ChannelType.DM,
      isThread: () => false,
    },
    user: { id: "user-1" },
    commandName: options.commandName,
    options: {
      getFocused: () => ({
        name: options.focusedName,
        value: options.focusedValue,
      }),
    },
    respond: vi.fn(async () => undefined),
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
  };
}

function createButtonInteraction(customId: string) {
  return {
    channel: {
      type: ChannelType.DM,
      isThread: () => false,
    },
    channelId: "dm-channel-1",
    user: { id: "user-1" },
    customId,
    deferred: false,
    replied: false,
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
  };
}

describe("discord interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeSessionCommandMock.mockResolvedValue({
      handled: true,
      response: "ok",
    });
  });

  it("routes slash commands through the existing command engine", async () => {
    const interaction = createChatInputInteraction({
      commandName: "jobs",
    });
    const agentService = createAgentService();
    const sessionRegistry = createSessionRegistry();

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      agentService as never,
      sessionRegistry as never,
      accessConfig,
      null,
    );

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(executeSessionCommandMock).toHaveBeenCalledWith(
      "!jobs",
      expect.objectContaining({
        channelId: "dm-channel-1",
        commandPrefixes: ["!", ";"],
        scope: "dm",
      }),
    );
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("shows a modal for /remind without a request", async () => {
    const interaction = createChatInputInteraction({
      commandName: "remind",
    });

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      createSessionRegistry() as never,
      accessConfig,
      null,
    );

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(executeSessionCommandMock).not.toHaveBeenCalled();
  });

  it("responds to autocomplete from model choices", async () => {
    const interaction = createAutocompleteInteraction({
      commandName: "model",
      focusedName: "target",
      focusedValue: "model-2",
    });

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      createSessionRegistry() as never,
      accessConfig,
      null,
    );

    expect(interaction.respond).toHaveBeenCalledWith([
      {
        name: "openrouter/model-2",
        value: "openrouter/model-2",
      },
    ]);
  });

  it("routes button interactions through the command engine", async () => {
    const interaction = createButtonInteraction("jobs:reload");

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      createSessionRegistry() as never,
      accessConfig,
      null,
    );

    expect(executeSessionCommandMock).toHaveBeenCalledWith(
      "!jobs reload",
      expect.objectContaining({
        scope: "dm",
      }),
    );
  });

  it("maps the abort button to the abort command", async () => {
    const interaction = createButtonInteraction("session:abort");

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      createSessionRegistry() as never,
      accessConfig,
      null,
    );

    expect(executeSessionCommandMock).toHaveBeenCalledWith(
      "!abort",
      expect.objectContaining({
        scope: "dm",
      }),
    );
  });

  it("adds an abort button to /status responses", async () => {
    const interaction = createChatInputInteraction({
      commandName: "status",
    });

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      createSessionRegistry() as never,
      accessConfig,
      null,
    );

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [
          expect.objectContaining({
            components: [
              expect.objectContaining({
                data: expect.objectContaining({
                  custom_id: "session:abort",
                  label: "Abort run",
                }),
              }),
            ],
          }),
        ],
      }),
    );
  });
});

describe("syncDiscordApplicationCommands", () => {
  it("syncs commands globally when configured", async () => {
    const set = vi.fn(async () => undefined);

    await syncDiscordApplicationCommands(
      {
        application: {
          commands: {
            set,
          },
        },
      } as never,
      createConfig({
        discordCommandRegistrationScope: "global",
      }),
    );

    expect(set).toHaveBeenCalledTimes(1);
  });

  it("syncs commands to configured guilds", async () => {
    const set = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => {
      return {
        commands: {
          set,
        },
      };
    });

    await syncDiscordApplicationCommands(
      {
        application: {
          commands: {
            set: vi.fn(),
          },
        },
        guilds: {
          fetch,
        },
      } as never,
      createConfig({
        discordCommandRegistrationScope: "guild",
        discordCommandRegistrationGuildIds: ["guild-1", "guild-2"],
      }),
    );

    expect(fetch).toHaveBeenCalledWith("guild-1");
    expect(fetch).toHaveBeenCalledWith("guild-2");
    expect(set).toHaveBeenCalledTimes(2);
  });
});
