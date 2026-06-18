import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Events,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
  type TextBasedChannel,
} from "discord.js";
import type { AgentService } from "./agent-service";
import { formatCommandReplyChunks } from "./discord-replies";
import { runAgentTurn } from "./agent-turn-runner";
import { createModuleLogger } from "./logger";
import { chunkMessage } from "./message-chunker";
import { formatDiscordPromptTime, wrapXmlTag } from "./prompt-context";
import type { SessionRegistry, SessionScope } from "./session-registry";
import { PromptQueueCancelledError, type PromptQueue } from "./prompt-queue";
import { executeSessionCommand, type CommandResult } from "./session-commands";
import type { TaskSchedulerService } from "./task-scheduler-service";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
  ThinkingLevel,
} from "./types";

const logger = createModuleLogger("discord-interactions");

const JOBS_RELOAD_BUTTON_ID = "jobs:reload";
const JOB_RUN_HERE_BUTTON_PREFIX = "job:run-here:";
const ABORT_BUTTON_PREFIX = "abort:";
const REMIND_MODAL_ID = "remind:create";
const REMIND_MODAL_WHEN_FIELD = "when";
const REMIND_MODAL_TASK_FIELD = "task";

type AbortControl = {
  scope: SessionScope;
  queue: PromptQueue;
  queuedMessage?: string;
  runningMessage?: string;
};

export function buildDiscordApplicationCommands(): ReturnType<
  SlashCommandBuilder["toJSON"]
>[] {
  return [
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show the built-in Discord gateway commands."),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("status")
        .setDescription("Show the current session status."),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("thinking")
        .setDescription("Show or set the current thinking level.")
        .addStringOption((option) => {
          return option
            .setName("level")
            .setDescription("Thinking level to set.")
            .setAutocomplete(true)
            .setRequired(false);
        }),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("model")
        .setDescription("Show or switch the current model.")
        .addStringOption((option) => {
          return option
            .setName("target")
            .setDescription("Provider/modelId to switch to.")
            .setAutocomplete(true)
            .setRequired(false);
        }),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("compact")
        .setDescription("Compact the current persistent session."),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("session-reset")
        .setDescription("Reset persisted session data for a scope.")
        .addStringOption((option) => {
          return option
            .setName("scope")
            .setDescription("Session scope to reset.")
            .setRequired(true)
            .setAutocomplete(true);
        }),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("reload")
        .setDescription("Reload AGENTS.md, skills, extensions, and resources."),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("prompt")
        .setDescription(
          "Send a prompt through the current DM or thread session.",
        )
        .addStringOption((option) => {
          return option
            .setName("text")
            .setDescription("Prompt text to send to the agent.")
            .setRequired(true);
        }),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("p")
        .setDescription("Short alias for /prompt.")
        .addStringOption((option) => {
          return option
            .setName("text")
            .setDescription("Prompt text to send to the agent.")
            .setRequired(true);
        }),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("remind")
        .setDescription("Create a one-off runtime reminder.")
        .addStringOption((option) => {
          return option
            .setName("request")
            .setDescription("Natural language reminder request.")
            .setRequired(false);
        }),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("jobs")
        .setDescription("List loaded scheduled jobs."),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("jobs-reload")
        .setDescription("Reload scheduled jobs from the jobs file."),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("job")
        .setDescription("Inspect or run one scheduled job.")
        .addSubcommand((subcommand) => {
          return subcommand
            .setName("info")
            .setDescription("Show one scheduled job.")
            .addStringOption((option) => {
              return option
                .setName("id")
                .setDescription("Scheduled job id.")
                .setRequired(true)
                .setAutocomplete(true);
            });
        })
        .addSubcommand((subcommand) => {
          return subcommand
            .setName("run")
            .setDescription(
              "Run one scheduled job now with its configured target.",
            )
            .addStringOption((option) => {
              return option
                .setName("id")
                .setDescription("Scheduled job id.")
                .setRequired(true)
                .setAutocomplete(true);
            });
        })
        .addSubcommand((subcommand) => {
          return subcommand
            .setName("run-here")
            .setDescription("Run one scheduled job now in this conversation.")
            .addStringOption((option) => {
              return option
                .setName("id")
                .setDescription("Scheduled job id.")
                .setRequired(true)
                .setAutocomplete(true);
            });
        }),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("abort")
        .setDescription("Abort the active run and clear queued prompts."),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("reaction")
        .setDescription("Show or set the working reaction emoji.")
        .addStringOption((option) => {
          return option
            .setName("emoji")
            .setDescription("Emoji to use while work is running.")
            .setRequired(false);
        }),
    ).toJSON(),
    applyDefaultCommandContexts(
      new SlashCommandBuilder()
        .setName("archive")
        .setDescription(
          "Archive the current forum thread and end its session.",
        ),
    ).toJSON(),
  ];
}

export async function syncDiscordApplicationCommands(
  client: Client<true>,
  config: ResolvedDiscordGatewayConfig,
): Promise<void> {
  if (config.discordCommandRegistrationScope === "none") {
    return;
  }

  const commands = buildDiscordApplicationCommands();

  if (config.discordCommandRegistrationScope === "global") {
    await client.application.commands.set(commands);
    logger.info(
      { count: commands.length, scope: "global" },
      "synced application commands",
    );
    return;
  }

  await Promise.all(
    config.discordCommandRegistrationGuildIds.map(async (guildId) => {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(commands);
    }),
  );

  logger.info(
    {
      count: commands.length,
      scope: "guild",
      guildIds: config.discordCommandRegistrationGuildIds,
    },
    "synced application commands",
  );
}

export async function handleDiscordInteraction(
  interaction: Interaction,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
  taskScheduler?: TaskSchedulerService | null,
): Promise<void> {
  if (interaction.isAutocomplete()) {
    await handleAutocompleteInteraction(
      interaction,
      agentService,
      sessionRegistry,
      accessConfig,
      taskScheduler,
    );
    return;
  }

  if (interaction.isChatInputCommand()) {
    await handleChatInputInteraction(
      interaction,
      config,
      agentService,
      sessionRegistry,
      accessConfig,
      taskScheduler,
    );
    return;
  }

  if (interaction.isButton()) {
    await handleButtonCommandInteraction(
      interaction,
      config,
      agentService,
      sessionRegistry,
      accessConfig,
      taskScheduler,
    );
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModalCommandInteraction(
      interaction,
      config,
      agentService,
      sessionRegistry,
      accessConfig,
      taskScheduler,
    );
  }
}

function applyDefaultCommandContexts<
  T extends { setContexts: (...args: any[]) => T },
>(builder: T): T {
  return builder.setContexts(
    InteractionContextType.BotDM,
    InteractionContextType.Guild,
  );
}

async function handleAutocompleteInteraction(
  interaction: AutocompleteInteraction,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
  taskScheduler?: TaskSchedulerService | null,
): Promise<void> {
  const scope = resolveInteractionScope(interaction);
  if (!scope || !isAuthorizedInteraction(interaction, scope, accessConfig)) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused(true);
  if (interaction.commandName === "thinking" && focused.name === "level") {
    const choices = buildThinkingChoices(
      resolveSessionForAutocomplete(scope, agentService, sessionRegistry),
    );
    await interaction.respond(filterChoices(choices, focused.value));
    return;
  }

  if (interaction.commandName === "model" && focused.name === "target") {
    const choices = await agentService.models.listModelChoices();
    await interaction.respond(filterChoices(choices, focused.value));
    return;
  }

  if (interaction.commandName === "job" && focused.name === "id") {
    const choices = (taskScheduler?.listJobs() ?? []).map((job) => {
      return {
        name: job.id,
        value: job.id,
      };
    });
    await interaction.respond(filterChoices(choices, focused.value));
    return;
  }

  if (interaction.commandName === "session-reset" && focused.name === "scope") {
    await interaction.respond(
      filterChoices(
        buildSessionScopeChoices(scope, sessionRegistry, taskScheduler),
        focused.value,
      ),
    );
    return;
  }

  await interaction.respond([]);
}

async function handleChatInputInteraction(
  interaction: ChatInputCommandInteraction,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
  taskScheduler?: TaskSchedulerService | null,
): Promise<void> {
  const scope = resolveInteractionScope(interaction);
  if (!scope) {
    await replyUnsupportedInteraction(interaction);
    return;
  }

  if (!isAuthorizedInteraction(interaction, scope, accessConfig)) {
    await replyUnauthorizedInteraction(interaction);
    return;
  }

  if (interaction.commandName === "remind") {
    const request = interaction.options.getString("request");
    if (!request) {
      await interaction.showModal(buildRemindModal());
      return;
    }
  }

  if (isPromptCommandName(interaction.commandName)) {
    const promptText = interaction.options.getString("text", true).trim();
    await executePromptInteraction(
      interaction,
      promptText,
      config,
      sessionRegistry,
      scope,
    );
    return;
  }

  const commandText = buildCommandTextFromInteraction(interaction, config);
  if (!commandText) {
    await replyUnsupportedInteraction(interaction);
    return;
  }

  const abortControl = await resolveInteractionAbortControl(
    interaction,
    sessionRegistry,
    taskScheduler,
  );

  await executeInteractionCommand(
    interaction,
    commandText,
    config,
    agentService,
    sessionRegistry,
    taskScheduler,
    scope,
    abortControl,
  );
}

async function handleButtonCommandInteraction(
  interaction: ButtonInteraction,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
  taskScheduler?: TaskSchedulerService | null,
): Promise<void> {
  const scope = resolveInteractionScope(interaction);
  if (!scope) {
    await replyUnsupportedInteraction(interaction);
    return;
  }

  if (!isAuthorizedInteraction(interaction, scope, accessConfig)) {
    await replyUnauthorizedInteraction(interaction);
    return;
  }

  if (interaction.customId.startsWith(ABORT_BUTTON_PREFIX)) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await sendInteractionCommandResult(
      interaction,
      await abortInteractionScope(
        parseAbortButtonScope(interaction.customId),
        sessionRegistry,
      ),
      [],
    );
    return;
  }

  const primaryPrefix = getPrimaryPrefix(config);
  let commandText: string | null = null;

  if (interaction.customId === JOBS_RELOAD_BUTTON_ID) {
    commandText = `${primaryPrefix}jobs reload`;
  } else if (interaction.customId.startsWith(JOB_RUN_HERE_BUTTON_PREFIX)) {
    const jobId = interaction.customId.slice(JOB_RUN_HERE_BUTTON_PREFIX.length);
    commandText = `${primaryPrefix}job run-here ${jobId}`;
  }

  if (!commandText) {
    await replyUnsupportedInteraction(interaction);
    return;
  }

  await executeInteractionCommand(
    interaction,
    commandText,
    config,
    agentService,
    sessionRegistry,
    taskScheduler,
    scope,
  );
}

async function handleModalCommandInteraction(
  interaction: ModalSubmitInteraction,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  accessConfig: GatewayAccessConfig,
  taskScheduler?: TaskSchedulerService | null,
): Promise<void> {
  const scope = resolveInteractionScope(interaction);
  if (!scope) {
    await replyUnsupportedInteraction(interaction);
    return;
  }

  if (!isAuthorizedInteraction(interaction, scope, accessConfig)) {
    await replyUnauthorizedInteraction(interaction);
    return;
  }

  let commandText: string | null = null;
  const primaryPrefix = getPrimaryPrefix(config);

  if (interaction.customId === REMIND_MODAL_ID) {
    const when = interaction.fields
      .getTextInputValue(REMIND_MODAL_WHEN_FIELD)
      .trim();
    const task = interaction.fields
      .getTextInputValue(REMIND_MODAL_TASK_FIELD)
      .trim();
    commandText = `${primaryPrefix}remind ${when}, ${task}`;
  }

  if (!commandText) {
    await replyUnsupportedInteraction(interaction);
    return;
  }

  await executeInteractionCommand(
    interaction,
    commandText,
    config,
    agentService,
    sessionRegistry,
    taskScheduler,
    scope,
  );
}

async function executeInteractionCommand(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  commandText: string,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  taskScheduler: TaskSchedulerService | null | undefined,
  scope: SessionScope,
  abortControl?: AbortControl | null,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { entry } = await sessionRegistry.getOrCreate(scope);
  const cancellationTracker = abortControl
    ? resolveAbortControlQueue(abortControl, sessionRegistry)
    : entry.promptQueue;
  const cancellationCount = cancellationTracker.getCancellationCount();

  if (abortControl) {
    await showAbortControlReply(
      interaction,
      abortControl,
      resolveAbortControlQueue(abortControl, sessionRegistry),
    );
  }

  let result: CommandResult;

  try {
    result = await executeSessionCommand(commandText, {
      agentService,
      promptQueue: entry.promptQueue,
      session: entry.session,
      sessionRegistry,
      taskScheduler,
      channelId: interaction.channelId ?? undefined,
      promptTimeZone: config.promptTimeZone,
      promptLocale: config.promptLocale,
      scope,
      workingEmoji: entry.workingEmoji,
      commandPrefixes: config.discordCommandPrefixes,
    });
  } catch (error) {
    if (
      error instanceof PromptQueueCancelledError ||
      cancellationTracker.getCancellationCount() !== cancellationCount
    ) {
      await sendInteractionCommandResult(
        interaction,
        {
          handled: true,
          response: "Cancelled.",
        },
        [],
      );
      return;
    }

    throw error;
  }

  if (cancellationTracker.getCancellationCount() !== cancellationCount) {
    await sendInteractionCommandResult(
      interaction,
      {
        handled: true,
        response: "Cancelled.",
      },
      [],
    );
    return;
  }

  await applyInteractionCommandSideEffects(
    interaction,
    sessionRegistry,
    scope,
    entry,
    result,
  );

  const components = buildInteractionComponents(
    interaction,
    result,
    Boolean(taskScheduler),
  );
  await sendInteractionCommandResult(interaction, result, components);
}

async function applyInteractionCommandSideEffects(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  sessionRegistry: SessionRegistry,
  scope: SessionScope,
  entry: Awaited<ReturnType<SessionRegistry["getOrCreate"]>>["entry"],
  commandResult: CommandResult,
): Promise<void> {
  if (commandResult.workingEmoji) {
    entry.workingEmoji = commandResult.workingEmoji;
    logger.info(
      { scope, emoji: commandResult.workingEmoji },
      "working emoji updated from interaction",
    );
  }

  if (commandResult.newSession) {
    entry.session = commandResult.newSession;
    logger.info(
      { scope, sessionId: commandResult.newSession.sessionId },
      "session replaced from interaction",
    );
  }

  if (!commandResult.archive || !scope.startsWith("thread:")) {
    return;
  }

  if (interaction.channel?.isThread()) {
    await interaction.channel.setArchived(true);
  }
  await sessionRegistry.remove(scope);
}

function buildInteractionComponents(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  commandResult: CommandResult,
  hasTaskScheduler: boolean,
) {
  if (!commandResult.handled) {
    return [];
  }

  if (
    hasTaskScheduler &&
    interaction.isChatInputCommand() &&
    interaction.commandName === "jobs"
  ) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(JOBS_RELOAD_BUTTON_ID)
          .setLabel("Reload jobs")
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  if (
    hasTaskScheduler &&
    interaction.isChatInputCommand() &&
    interaction.commandName === "job" &&
    interaction.options.getSubcommand() === "info"
  ) {
    const jobId = interaction.options.getString("id", true);

    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${JOB_RUN_HERE_BUTTON_PREFIX}${jobId}`)
          .setLabel("Run here")
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  return [];
}

async function executePromptInteraction(
  interaction: ChatInputCommandInteraction,
  promptText: string,
  config: ResolvedDiscordGatewayConfig,
  sessionRegistry: SessionRegistry,
  scope: SessionScope,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { entry } = await sessionRegistry.getOrCreate(scope);
  const abortControl: AbortControl = {
    scope,
    queue: entry.promptQueue,
    runningMessage: "Running prompt...",
  };
  const cancellationCount = abortControl.queue.getCancellationCount();
  await showAbortControlReply(interaction, abortControl, abortControl.queue);

  try {
    const response = await abortControl.queue.enqueue(async () => {
      const transformedPrompt = await config.promptTransform({
        rawContent: promptText,
        discordMetadata: buildInteractionPromptMetadata(
          interaction,
          scope,
          config,
        ),
        now: () => {
          return wrapXmlTag(
            "datetime",
            formatDiscordPromptTime(new Date(), {
              timeZone: config.promptTimeZone,
              locale: config.promptLocale,
            }),
          );
        },
        userMessage: () => {
          return wrapXmlTag("user_message", promptText);
        },
      });

      return runAgentTurn(entry.session, transformedPrompt);
    });

    await sendPromptOutputToChannel(interaction.channel, response);
    await interaction.editReply({
      content: "Prompt completed.",
      components: [],
    });
  } catch (error) {
    if (
      error instanceof PromptQueueCancelledError ||
      abortControl.queue.getCancellationCount() !== cancellationCount
    ) {
      await interaction.editReply({
        content: "Cancelled.",
        components: [],
      });
      return;
    }

    throw error;
  }
}

async function sendInteractionCommandResult(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  result: CommandResult,
  components: Array<ActionRowBuilder<ButtonBuilder>>,
): Promise<void> {
  const text = result.response ?? "Done.";
  const chunks = formatCommandReplyChunks(text);
  const [firstChunk, ...remainingChunks] = chunks;

  await interaction.editReply({
    content: firstChunk ?? "```text\nDone.\n```",
    components,
  });

  for (const chunk of remainingChunks) {
    await interaction.followUp({
      content: chunk,
      flags: MessageFlags.Ephemeral,
    });
  }
}

function buildRemindModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(REMIND_MODAL_ID)
    .setTitle("Create reminder")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(REMIND_MODAL_WHEN_FIELD)
          .setLabel("When")
          .setPlaceholder("tomorrow 9am")
          .setRequired(true)
          .setStyle(TextInputStyle.Short),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(REMIND_MODAL_TASK_FIELD)
          .setLabel("Task")
          .setPlaceholder("review the overnight alerts")
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph),
      ),
    );
}

function buildCommandTextFromInteraction(
  interaction: ChatInputCommandInteraction,
  config: ResolvedDiscordGatewayConfig,
): string | null {
  const primaryPrefix = getPrimaryPrefix(config);

  switch (interaction.commandName) {
    case "help":
    case "status":
    case "compact":
    case "abort":
    case "reload":
    case "jobs":
    case "jobs-reload":
    case "archive":
      return `${primaryPrefix}${interaction.commandName.replace("jobs-reload", "jobs reload")}`;
    case "session-reset": {
      const scope = interaction.options.getString("scope", true);
      return `${primaryPrefix}session reset ${scope}`;
    }
    case "thinking": {
      const level = interaction.options.getString("level");
      return level
        ? `${primaryPrefix}thinking ${level}`
        : `${primaryPrefix}thinking`;
    }
    case "model": {
      const target = interaction.options.getString("target");
      return target
        ? `${primaryPrefix}model ${target}`
        : `${primaryPrefix}model`;
    }
    case "reaction": {
      const emoji = interaction.options.getString("emoji");
      return emoji
        ? `${primaryPrefix}reaction ${emoji}`
        : `${primaryPrefix}reaction`;
    }
    case "remind": {
      const request = interaction.options.getString("request");
      return request ? `${primaryPrefix}remind ${request}` : null;
    }

    case "job": {
      const subcommand = interaction.options.getSubcommand();
      const id = interaction.options.getString("id", true);
      return `${primaryPrefix}job ${subcommand} ${id}`;
    }
    default:
      return null;
  }
}

function isPromptCommandName(commandName: string): boolean {
  return commandName === "prompt" || commandName === "p";
}

function buildAbortButtonCustomId(scope: SessionScope): string {
  return `${ABORT_BUTTON_PREFIX}${scope}`;
}

function parseAbortButtonScope(customId: string): SessionScope | null {
  if (!customId.startsWith(ABORT_BUTTON_PREFIX)) {
    return null;
  }

  const scope = customId.slice(ABORT_BUTTON_PREFIX.length);
  if (
    scope === "dm" ||
    scope.startsWith("thread:") ||
    scope.startsWith("job:")
  ) {
    return scope as SessionScope;
  }

  return null;
}

function buildAbortButtonRow(
  scope: SessionScope,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildAbortButtonCustomId(scope))
      .setLabel("Abort run")
      .setStyle(ButtonStyle.Danger),
  );
}

async function showAbortControlReply(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  abortControl: AbortControl,
  queue: PromptQueue,
): Promise<void> {
  const pendingCount = queue.getSnapshot().pending;
  await interaction.editReply({
    content:
      pendingCount > 0
        ? (abortControl.queuedMessage ??
          `Queued. ${pendingCount} request(s) ahead of this one.`)
        : (abortControl.runningMessage ?? "Running..."),
    components: [buildAbortButtonRow(abortControl.scope)],
  });
}

function resolveAbortControlQueue(
  abortControl: AbortControl,
  sessionRegistry: SessionRegistry,
): PromptQueue {
  return (
    sessionRegistry.get(abortControl.scope)?.promptQueue ?? abortControl.queue
  );
}

async function abortInteractionScope(
  scope: SessionScope | null,
  sessionRegistry: SessionRegistry,
): Promise<CommandResult> {
  if (!scope) {
    return {
      handled: true,
      response: "Nothing was running or queued.",
    };
  }

  const entry = sessionRegistry.get(scope);
  if (!entry) {
    return {
      handled: true,
      response: "Nothing was running or queued.",
    };
  }

  const queueStatus = entry.promptQueue.getSnapshot();
  entry.promptQueue.markAbort();
  const clearedCount = entry.promptQueue.cancelPending();
  await entry.session.abort();

  let response = "Aborted the active run.";
  if (!queueStatus.busy && clearedCount === 0) {
    response = "Nothing was running or queued.";
  } else if (!queueStatus.busy && clearedCount > 0) {
    response = `Cleared ${clearedCount} queued request(s).`;
  } else if (clearedCount > 0) {
    response = `Aborted the active run and cleared ${clearedCount} queued request(s).`;
  }

  return {
    handled: true,
    response,
  };
}

async function resolveInteractionAbortControl(
  interaction: ChatInputCommandInteraction,
  sessionRegistry: SessionRegistry,
  taskScheduler?: TaskSchedulerService | null,
): Promise<AbortControl | null> {
  if (interaction.commandName !== "job") {
    return null;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== "run" && subcommand !== "run-here") {
    return null;
  }

  if (!taskScheduler) {
    return null;
  }

  const jobId = interaction.options.getString("id", true);
  const scope = resolveAbortScopeForJob(taskScheduler.getJob(jobId), jobId);
  if (!scope) {
    return null;
  }

  const { entry } = await sessionRegistry.getOrCreate(scope);
  return {
    scope,
    queue: entry.promptQueue,
    runningMessage:
      subcommand === "run-here" ? "Running job here..." : "Running job...",
  };
}

function resolveAbortScopeForJob(
  job: ReturnType<TaskSchedulerService["getJob"]>,
  jobId: string,
): SessionScope | null {
  if (!job || job.session?.strategy === "ephemeral") {
    return null;
  }

  return job.session?.scope ?? `job:${jobId}`;
}

function buildInteractionPromptMetadata(
  interaction: ChatInputCommandInteraction,
  scope: SessionScope,
  config: ResolvedDiscordGatewayConfig,
): string {
  const isThread =
    scope.startsWith("thread:") && interaction.channel?.isThread();
  const rawAuthorName =
    interaction.member && "displayName" in interaction.member
      ? interaction.member.displayName
      : interaction.user.globalName || interaction.user.username;
  const authorName = (rawAuthorName ?? "").replace(/\s+/g, " ").trim();
  const contextEntries = [
    ["scope", scope === "dm" ? "dm" : "thread"],
    ["event_type", "slash_prompt"],
    ["sent_at", interaction.createdAt.toISOString()],
    [
      "sent_at_local",
      formatDiscordPromptTime(interaction.createdAt, {
        timeZone: config.promptTimeZone,
        locale: config.promptLocale,
      }),
    ],
    ["message_id", `interaction:${interaction.id}`],
    ["author_name", authorName || undefined],
    ["author_id", interaction.user.id],
    [
      "thread_title",
      isThread
        ? (interaction.channel?.name ?? "").replace(/\s+/g, " ").trim()
        : undefined,
    ],
    [
      "thread_id",
      isThread ? (interaction.channel?.id ?? undefined) : undefined,
    ],
    [
      "forum_channel_id",
      isThread ? (interaction.channel?.parentId ?? undefined) : undefined,
    ],
  ].filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string" && entry[1].length > 0;
  });

  return wrapXmlTag(
    "discord_message_context",
    JSON.stringify(Object.fromEntries(contextEntries), null, 2),
  );
}

async function sendPromptOutputToChannel(
  channel: ChatInputCommandInteraction["channel"],
  text: string,
): Promise<void> {
  if (!channel || !("isSendable" in channel) || !channel.isSendable()) {
    throw new Error("Prompt output channel is not sendable.");
  }

  const sendableChannel = channel as TextBasedChannel & {
    send: (value: { content: string; flags: MessageFlags }) => Promise<unknown>;
  };
  const chunks = chunkMessage(text);

  for (const chunk of chunks) {
    await sendableChannel.send({
      content: chunk,
      flags: MessageFlags.SuppressEmbeds,
    });
  }
}

function resolveInteractionScope(
  interaction:
    | Interaction
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction
    | AutocompleteInteraction,
): SessionScope | null {
  if (!interaction.channel) {
    return null;
  }

  if (interaction.channel.type === ChannelType.DM) {
    return "dm";
  }

  if (interaction.channel.isThread()) {
    return `thread:${interaction.channel.id}`;
  }

  return null;
}

function isAuthorizedInteraction(
  interaction:
    | Interaction
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction
    | AutocompleteInteraction,
  scope: SessionScope,
  accessConfig: GatewayAccessConfig,
): boolean {
  if (scope === "dm") {
    return interaction.user.id === accessConfig.discordAllowedUserId;
  }

  if (!scope.startsWith("thread:") || !interaction.channel?.isThread()) {
    return false;
  }

  const parentId = interaction.channel.parentId;
  if (
    !parentId ||
    !accessConfig.discordAllowedForumChannelIds.includes(parentId)
  ) {
    return false;
  }

  return accessConfig.discordAllowedUserIds.includes(interaction.user.id);
}

function resolveSessionForAutocomplete(
  scope: SessionScope,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
) {
  if (scope === "dm") {
    return sessionRegistry.get("dm")?.session ?? agentService.getSession();
  }

  return sessionRegistry.get(scope)?.session ?? null;
}

function buildThinkingChoices(session: ReturnType<AgentService["getSession"]>) {
  const levels: ThinkingLevel[] = session?.supportsThinking()
    ? session.getAvailableThinkingLevels()
    : ["off", "minimal", "low", "medium", "high", "xhigh"];

  return levels.map((level) => {
    return {
      name: level,
      value: level,
    };
  });
}

function buildSessionScopeChoices(
  currentScope: SessionScope,
  sessionRegistry: SessionRegistry,
  taskScheduler?: TaskSchedulerService | null,
) {
  const scopes = new Set<SessionScope>();
  scopes.add("dm");
  scopes.add(currentScope);

  for (const scope of sessionRegistry.getScopes()) {
    scopes.add(scope);
  }

  for (const job of taskScheduler?.listJobs() ?? []) {
    scopes.add(`job:${job.id}` as SessionScope);
  }

  return Array.from(scopes)
    .sort((left, right) => left.localeCompare(right))
    .map((scope) => {
      return {
        name: scope,
        value: scope,
      };
    });
}

function filterChoices(
  choices: Array<{ name: string; value: string }>,
  focusedValue: string,
): Array<{ name: string; value: string }> {
  const normalizedFocus = focusedValue.trim().toLowerCase();
  const rankedChoices = choices
    .filter((choice) => {
      if (!normalizedFocus) {
        return true;
      }

      return choice.name.toLowerCase().includes(normalizedFocus);
    })
    .sort((left, right) => {
      const leftStartsWith = left.name
        .toLowerCase()
        .startsWith(normalizedFocus);
      const rightStartsWith = right.name
        .toLowerCase()
        .startsWith(normalizedFocus);

      if (leftStartsWith === rightStartsWith) {
        return left.name.localeCompare(right.name);
      }

      return leftStartsWith ? -1 : 1;
    });

  return rankedChoices.slice(0, 25);
}

function getPrimaryPrefix(config: ResolvedDiscordGatewayConfig): string {
  return config.discordCommandPrefixes[0] ?? "!";
}

async function replyUnsupportedInteraction(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({
      content:
        "This interaction is only supported in DMs and allowed forum threads.",
      components: [],
    });
    return;
  }

  await interaction.reply({
    content:
      "This interaction is only supported in DMs and allowed forum threads.",
    flags: MessageFlags.Ephemeral,
  });
}

async function replyUnauthorizedInteraction(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({
      content: "You are not allowed to use this bot here.",
      components: [],
    });
    return;
  }

  await interaction.reply({
    content: "You are not allowed to use this bot here.",
    flags: MessageFlags.Ephemeral,
  });
}

export const discordInteractionEventName = Events.InteractionCreate;
