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

const {
  executeSessionCommandMock,
  runAgentTurnMock,
  generatePostReplyFollowUpMock,
} = vi.hoisted(() => {
  return {
    executeSessionCommandMock: vi.fn(),
    runAgentTurnMock: vi.fn(),
    generatePostReplyFollowUpMock: vi.fn(),
  };
});

vi.mock("./session-commands", () => {
  return {
    executeSessionCommand: executeSessionCommandMock,
  };
});

vi.mock("./agent-turn-runner", () => {
  return {
    runAgentTurn: runAgentTurnMock,
  };
});

vi.mock("./discord-reply-reflection", () => {
  return {
    generatePostReplyFollowUp: generatePostReplyFollowUpMock,
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
    replyReflection: {
      enabled: false,
      maxFollowUpLength: 600,
    },
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
  const entry = {
    session: {
      sessionId: "session-1",
      abort: vi.fn(async () => undefined),
    },
    promptQueue: {
      enqueue: vi.fn(async (task: () => Promise<string>) => task()),
      getSnapshot: vi.fn(() => ({ pending: 0, busy: false })),
      getCancellationCount: vi.fn(() => 0),
      markAbort: vi.fn(),
      cancelPending: vi.fn(() => 0),
    },
    createdAt: new Date(),
    workingEmoji: "⚙️",
  };

  return {
    getOrCreate: vi.fn(async () => {
      return {
        created: true,
        entry,
      };
    }),
    get: vi.fn(() => entry),
    getScopes: vi.fn(() => ["dm", "thread:123"]),
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
      isSendable: () => true,
      send: vi.fn(async () => undefined),
    },
    channelId: "dm-channel-1",
    id: "interaction-1",
    createdAt: new Date("2026-06-17T07:01:00.000Z"),
    user: { id: "user-1", username: "alice", globalName: "Alice" },
    member: null,
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
    isRepliable: () => true,
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
    user: { id: "user-1", username: "alice", globalName: "Alice" },
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
    user: { id: "user-1", username: "alice", globalName: "Alice" },
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
    runAgentTurnMock.mockResolvedValue("prompt reply");
    generatePostReplyFollowUpMock.mockResolvedValue(null);
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

  it.each(["prompt", "p"])(
    "runs %s through the shared slash prompt handler",
    async (commandName) => {
      const interaction = createChatInputInteraction({
        commandName,
        stringOptions: { text: "hello from slash" },
      });

      await handleDiscordInteraction(
        interaction as never,
        createConfig(),
        createAgentService() as never,
        createSessionRegistry() as never,
        accessConfig,
        null,
      );

      expect(interaction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
      expect(runAgentTurnMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-1" }),
        "hello from slash",
      );
      expect(interaction.channel.send).toHaveBeenCalledWith({
        content: "prompt reply",
        flags: MessageFlags.SuppressEmbeds,
      });
      expect(interaction.editReply).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          content: "Running prompt...",
          components: [
            expect.objectContaining({
              components: [
                expect.objectContaining({
                  data: expect.objectContaining({
                    custom_id: "abort:dm",
                    label: "Abort run",
                  }),
                }),
              ],
            }),
          ],
        }),
      );
      expect(interaction.editReply).toHaveBeenLastCalledWith({
        content: "Prompt completed.",
        components: [],
      });
      expect(executeSessionCommandMock).not.toHaveBeenCalled();
    },
  );

  it("completes a deferred reply when interaction handling fails", async () => {
    const interaction = createChatInputInteraction({
      commandName: "jobs",
    });
    interaction.deferred = true;
    const sessionRegistry = createSessionRegistry();
    sessionRegistry.getOrCreate.mockRejectedValue(new Error("session failed"));

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      sessionRegistry as never,
      accessConfig,
      null,
    );

    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: "Something went wrong while processing that interaction.",
      components: [],
    });
  });

  it("can send one extra proactive follow-up after a slash prompt", async () => {
    const config = createConfig({
      replyReflection: {
        enabled: true,
        maxFollowUpLength: 280,
      },
    });
    const interaction = createChatInputInteraction({
      commandName: "prompt",
      stringOptions: { text: "hello from slash" },
    });

    generatePostReplyFollowUpMock.mockResolvedValue(
      "One more thing: the env change only applies after a restart.",
    );

    await handleDiscordInteraction(
      interaction as never,
      config,
      createAgentService() as never,
      createSessionRegistry() as never,
      accessConfig,
      null,
    );

    expect(generatePostReplyFollowUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        promptText: "hello from slash",
        assistantReply: "prompt reply",
        sourceModel: undefined,
      }),
    );
    expect(interaction.channel.send).toHaveBeenNthCalledWith(2, {
      content: "One more thing: the env change only applies after a restart.",
      flags: MessageFlags.SuppressEmbeds,
    });
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

  it("responds to autocomplete from known session scopes", async () => {
    const interaction = createAutocompleteInteraction({
      commandName: "session-reset",
      focusedName: "scope",
      focusedValue: "job:",
    });

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      createSessionRegistry() as never,
      accessConfig,
      {
        listJobs: vi.fn(() => [
          {
            id: "daily-summary",
          },
        ]),
      } as never,
    );

    expect(interaction.respond).toHaveBeenCalledWith([
      {
        name: "job:daily-summary",
        value: "job:daily-summary",
      },
    ]);
  });

  it("routes session reset slash commands through the existing command engine", async () => {
    const interaction = createChatInputInteraction({
      commandName: "session-reset",
      stringOptions: { scope: "job:daily-summary" },
    });

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      createSessionRegistry() as never,
      accessConfig,
      null,
    );

    expect(executeSessionCommandMock).toHaveBeenCalledWith(
      "!session reset job:daily-summary",
      expect.objectContaining({
        scope: "dm",
      }),
    );
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

  it("routes prompt abort buttons through the abort command", async () => {
    const interaction = createButtonInteraction("abort:dm");
    const sessionRegistry = createSessionRegistry();
    sessionRegistry.get().promptQueue.getSnapshot.mockReturnValue({
      pending: 0,
      busy: true,
    });

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      sessionRegistry as never,
      accessConfig,
      null,
    );

    expect(sessionRegistry.get().promptQueue.markAbort).toHaveBeenCalledTimes(
      1,
    );
    expect(sessionRegistry.get().session.abort).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "```\nAborted the active run.\n```",
      }),
    );
    expect(executeSessionCommandMock).not.toHaveBeenCalled();
  });

  it("shows the shared abort button while running slash job commands", async () => {
    const interaction = createChatInputInteraction({
      commandName: "job",
      subcommand: "run",
      stringOptions: { id: "daily-summary" },
    });
    const sessionRegistry = createSessionRegistry();
    const taskScheduler = {
      getJob: vi.fn(() => ({
        id: "daily-summary",
        session: undefined,
      })),
    };

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      sessionRegistry as never,
      accessConfig,
      taskScheduler as never,
    );

    expect(interaction.editReply).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: "Running job...",
        components: [
          expect.objectContaining({
            components: [
              expect.objectContaining({
                data: expect.objectContaining({
                  custom_id: "abort:job:daily-summary",
                  label: "Abort run",
                }),
              }),
            ],
          }),
        ],
      }),
    );
    expect(executeSessionCommandMock).toHaveBeenCalledWith(
      "!job run daily-summary",
      expect.objectContaining({
        scope: "dm",
      }),
    );
  });

  it("reports cancelled for fresh slash job runs using the replacement queue", async () => {
    const interaction = createChatInputInteraction({
      commandName: "job",
      subcommand: "run",
      stringOptions: { id: "daily-summary" },
    });
    const dmEntry = {
      session: {
        sessionId: "session-1",
        abort: vi.fn(async () => undefined),
      },
      promptQueue: {
        enqueue: vi.fn(async (task: () => Promise<string>) => task()),
        getSnapshot: vi.fn(() => ({ pending: 0, busy: false })),
        getCancellationCount: vi.fn(() => 0),
        markAbort: vi.fn(),
        cancelPending: vi.fn(() => 0),
      },
      createdAt: new Date(),
      workingEmoji: "⚙️",
    };
    const freshJobEntry = {
      session: {
        sessionId: "job-session-1",
        abort: vi.fn(async () => undefined),
      },
      promptQueue: {
        enqueue: vi.fn(async (task: () => Promise<string>) => task()),
        getSnapshot: vi.fn(() => ({ pending: 0, busy: false })),
        getCancellationCount: vi.fn(() => 1),
        markAbort: vi.fn(),
        cancelPending: vi.fn(() => 0),
      },
      createdAt: new Date(),
      workingEmoji: "⚙️",
    };
    let activeJobEntry: typeof freshJobEntry | null = null;
    const sessionRegistry = {
      getOrCreate: vi.fn(async (scope: string) => {
        if (scope === "dm") {
          return {
            created: true,
            entry: dmEntry,
          };
        }

        throw new Error(`Unexpected scope: ${scope}`);
      }),
      get: vi.fn((scope: string) => {
        if (scope === "job:daily-summary") {
          return activeJobEntry;
        }

        return scope === "dm" ? dmEntry : undefined;
      }),
      getScopes: vi.fn(() => ["dm"]),
      remove: vi.fn(async () => undefined),
    };
    const taskScheduler = {
      getJob: vi.fn(() => ({
        id: "daily-summary",
        session: undefined,
      })),
    };
    executeSessionCommandMock.mockImplementationOnce(async () => {
      activeJobEntry = freshJobEntry;
      return {
        handled: true,
        response: "ok",
      };
    });

    await handleDiscordInteraction(
      interaction as never,
      createConfig(),
      createAgentService() as never,
      sessionRegistry as never,
      accessConfig,
      taskScheduler as never,
    );

    expect(sessionRegistry.getOrCreate).toHaveBeenCalledTimes(1);
    expect(sessionRegistry.getOrCreate).toHaveBeenCalledWith("dm");
    expect(interaction.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: "```\nCancelled.\n```",
        components: [],
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
