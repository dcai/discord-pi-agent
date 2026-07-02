import {
  Events,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
  type TextBasedChannel,
} from "discord.js";
import type { AgentService } from "./agent-service";
import { runAgentTurn } from "./agent-turn-runner";
import { generatePostReplyFollowUp } from "./discord-reply-reflection";
import {
  abortInteractionScope,
  parseAbortButtonScope,
  resolveAbortControlQueue,
  resolveInteractionAbortControl,
  showAbortControlReply,
  type AbortControl,
} from "./discord-interactions/abort-controls";
import {
  buildCommandTextFromInteraction,
  buildDiscordApplicationCommands,
  buildInteractionComponents,
  buildRemindModal,
  getPrimaryPrefix,
  isPromptCommandName,
  JOB_RUN_HERE_BUTTON_PREFIX,
  JOBS_RELOAD_BUTTON_ID,
  REMIND_MODAL_ID,
  REMIND_MODAL_TASK_FIELD,
  REMIND_MODAL_WHEN_FIELD,
} from "./discord-interactions/command-builders";
import {
  buildSessionScopeChoices,
  buildThinkingChoices,
  filterChoices,
  isAuthorizedInteraction,
  resolveInteractionScope,
  resolveSessionForAutocomplete,
} from "./discord-interactions/scope";
import { formatCommandReplyChunks } from "./discord-replies";
import { createModuleLogger } from "./logger";
import { chunkMessage } from "./message-chunker";
import { formatDiscordPromptTime, wrapXmlTag } from "./prompt-context";
import { PromptQueueCancelledError, type PromptQueue } from "./prompt-queue";
import type { SessionRegistry, SessionScope } from "./session-registry";
import { executeSessionCommand, type CommandResult } from "./session-commands";
import type { TaskSchedulerService } from "./task-scheduler-service";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const logger = createModuleLogger("discord-interactions");

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
    await interaction.respond(
      filterChoices(
        buildThinkingChoices(
          resolveSessionForAutocomplete(scope, agentService, sessionRegistry),
        ),
        focused.value,
      ),
    );
    return;
  }

  if (interaction.commandName === "model" && focused.name === "target") {
    await interaction.respond(
      filterChoices(
        await agentService.models.listModelChoices(),
        focused.value,
      ),
    );
    return;
  }

  if (interaction.commandName === "job" && focused.name === "id") {
    await interaction.respond(
      filterChoices(
        (taskScheduler?.listJobs() ?? []).map((job) => {
          return {
            name: job.id,
            value: job.id,
          };
        }),
        focused.value,
      ),
    );
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
    await executePromptInteraction(
      interaction,
      interaction.options.getString("text", true).trim(),
      config,
      agentService,
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

  await executeInteractionCommand(
    interaction,
    commandText,
    config,
    agentService,
    sessionRegistry,
    taskScheduler,
    scope,
    await resolveInteractionAbortControl(
      interaction,
      sessionRegistry,
      taskScheduler,
    ),
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

  if (interaction.customId.startsWith("abort:")) {
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
    commandText =
      `${primaryPrefix}job run-here ` +
      interaction.customId.slice(JOB_RUN_HERE_BUTTON_PREFIX.length);
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
  const cancellationCount = getInteractionCancellationCount(
    abortControl,
    sessionRegistry,
    entry.promptQueue,
  );

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
      getInteractionCancellationCount(
        abortControl,
        sessionRegistry,
        entry.promptQueue,
      ) !== cancellationCount
    ) {
      await sendInteractionCommandResult(
        interaction,
        { handled: true, response: "Cancelled." },
        [],
      );
      return;
    }

    throw error;
  }

  if (
    getInteractionCancellationCount(
      abortControl,
      sessionRegistry,
      entry.promptQueue,
    ) !== cancellationCount
  ) {
    await sendInteractionCommandResult(
      interaction,
      { handled: true, response: "Cancelled." },
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

  await sendInteractionCommandResult(
    interaction,
    result,
    buildInteractionComponents(interaction, result, Boolean(taskScheduler)),
  );
}

function getInteractionCancellationCount(
  abortControl: AbortControl | null | undefined,
  sessionRegistry: SessionRegistry,
  fallbackQueue: PromptQueue,
): number {
  if (!abortControl) {
    return fallbackQueue.getCancellationCount();
  }

  return (
    resolveAbortControlQueue(
      abortControl,
      sessionRegistry,
    )?.getCancellationCount() ?? 0
  );
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

async function executePromptInteraction(
  interaction: ChatInputCommandInteraction,
  promptText: string,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
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
  const cancellationCount = entry.promptQueue.getCancellationCount();
  await showAbortControlReply(interaction, abortControl, entry.promptQueue);

  try {
    const discordMetadata = buildInteractionPromptMetadata(
      interaction,
      scope,
      config,
    );
    const response = await entry.promptQueue.enqueue(async () => {
      const transformedPrompt = await config.promptTransform({
        rawContent: promptText,
        discordMetadata,
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

    if (config.replyReflection.enabled) {
      const followUp = await generatePostReplyFollowUp({
        config,
        agentService,
        promptText,
        assistantReply: response,
        discordMetadata,
        sourceModel: entry.session.model,
      });

      if (followUp) {
        await sendPromptOutputToChannel(interaction.channel, followUp);
      }
    }
    await interaction.editReply({
      content: "Prompt completed.",
      components: [],
    });
  } catch (error) {
    if (
      error instanceof PromptQueueCancelledError ||
      entry.promptQueue.getCancellationCount() !== cancellationCount
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
  components: ReturnType<typeof buildInteractionComponents>,
): Promise<void> {
  const chunks = formatCommandReplyChunks(result.response ?? "Done.");
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

  for (const chunk of chunkMessage(text)) {
    await sendableChannel.send({
      content: chunk,
      flags: MessageFlags.SuppressEmbeds,
    });
  }
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
