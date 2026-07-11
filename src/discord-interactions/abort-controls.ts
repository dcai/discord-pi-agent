import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { buildAbortResponse } from "../session-commands/shared";
import type { CommandResult } from "../session-commands";
import type { PromptQueue } from "../prompt-queue";
import type { SessionRegistry, SessionScope } from "../session-registry";
import type { TaskSchedulerService } from "../task-scheduler-service";

const ABORT_BUTTON_PREFIX = "abort:";

export type AbortControl = {
  scope: SessionScope;
  queue?: PromptQueue;
  queuedMessage?: string;
  runningMessage?: string;
};

export function parseAbortButtonScope(customId: string): SessionScope | null {
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

export async function showAbortControlReply(
  interaction:
    ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  abortControl: AbortControl,
  queue?: PromptQueue | null,
): Promise<void> {
  const pendingCount = queue?.getSnapshot().pending ?? 0;
  await interaction.editReply({
    content:
      queue && pendingCount > 0
        ? (abortControl.queuedMessage ??
          `Queued. ${pendingCount} request(s) ahead of this one.`)
        : (abortControl.runningMessage ?? "Running..."),
    components: [buildAbortButtonRow(abortControl.scope)],
  });
}

export function resolveAbortControlQueue(
  abortControl: AbortControl,
  sessionRegistry: SessionRegistry,
): PromptQueue | null {
  return (
    sessionRegistry.get(abortControl.scope)?.promptQueue ??
    abortControl.queue ??
    null
  );
}

export async function abortInteractionScope(
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

  return {
    handled: true,
    response: buildAbortResponse(queueStatus, clearedCount),
  };
}

export async function resolveInteractionAbortControl(
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
  const job = taskScheduler.getJob(jobId);
  if (!job) {
    return null;
  }

  const scope = resolveAbortScopeForJob(job, jobId);
  if (!scope) {
    return null;
  }

  if ((job.session?.strategy ?? "fresh") === "fresh") {
    return {
      scope,
      runningMessage:
        subcommand === "run-here" ? "Running job here..." : "Running job...",
    };
  }

  const { entry } = await sessionRegistry.getOrCreate(scope);
  return {
    scope,
    queue: entry.promptQueue,
    runningMessage:
      subcommand === "run-here" ? "Running job here..." : "Running job...",
  };
}

function buildAbortButtonCustomId(scope: SessionScope): string {
  return `${ABORT_BUTTON_PREFIX}${scope}`;
}

function buildAbortButtonRow(scope: SessionScope) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildAbortButtonCustomId(scope))
      .setLabel("Abort run")
      .setStyle(ButtonStyle.Danger),
  );
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
