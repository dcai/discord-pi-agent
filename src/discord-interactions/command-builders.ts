import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { CommandResult } from "../session-commands";
import type { ResolvedDiscordGatewayConfig } from "../types";

export const JOBS_RELOAD_BUTTON_ID = "jobs:reload";
export const JOB_RUN_HERE_BUTTON_PREFIX = "job:run-here:";
export const REMIND_MODAL_ID = "remind:create";
export const REMIND_MODAL_WHEN_FIELD = "when";
export const REMIND_MODAL_TASK_FIELD = "task";

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

export function buildRemindModal(): ModalBuilder {
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

export function buildCommandTextFromInteraction(
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
    case "session-reset":
      return `${primaryPrefix}session reset ${interaction.options.getString("scope", true)}`;
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
    case "job":
      return `${primaryPrefix}job ${interaction.options.getSubcommand()} ${interaction.options.getString("id", true)}`;
    default:
      return null;
  }
}

export function buildInteractionComponents(
  interaction:
    ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
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

export function isPromptCommandName(commandName: string): boolean {
  return commandName === "prompt" || commandName === "p";
}

export function getPrimaryPrefix(config: ResolvedDiscordGatewayConfig): string {
  return config.discordCommandPrefixes[0] ?? "!";
}

function applyDefaultCommandContexts<
  T extends { setContexts: (...args: any[]) => T },
>(builder: T): T {
  return builder.setContexts(
    InteractionContextType.BotDM,
    InteractionContextType.Guild,
  );
}
