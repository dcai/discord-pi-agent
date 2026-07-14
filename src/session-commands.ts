import { coreCommandHandlers } from "./session-commands/core-commands";
import { schedulerCommandHandlers } from "./session-commands/scheduler-commands";
import { recordCommandUsage } from "./command-usage";
import { classifySessionCommand } from "./command-registry";
import { PromptQueueCancelledError } from "./prompt-queue";
import {
  type CommandContext,
  type CommandResult,
  formatCommandUsage,
  INTERNAL_COMMAND_PREFIX,
  normalizeCommandInput,
} from "./session-commands/shared";

export type { CommandContext, CommandResult } from "./session-commands/shared";

const commandHandlers = [...coreCommandHandlers, ...schedulerCommandHandlers];

export async function executeSessionCommand(
  input: string,
  context: CommandContext,
): Promise<CommandResult> {
  const trimmedInput = input.trim();
  const normalizedCommandInput = normalizeCommandInput(
    trimmedInput,
    context.commandPrefixes ?? [INTERNAL_COMMAND_PREFIX],
  );
  if (!normalizedCommandInput) {
    return { handled: false };
  }

  const commandId = classifySessionCommand(normalizedCommandInput) ?? "unknown";
  const startedAt = performance.now();

  try {
    for (const handler of commandHandlers) {
      const result = await handler(normalizedCommandInput, context);
      if (result) {
        await recordCommandUsage(context.commandUsage, {
          commandId,
          surface: context.commandSurface ?? "prefix",
          alias: context.commandAlias,
          outcome: result.forwardedInput ? "forwarded" : "success",
          durationMs: performance.now() - startedAt,
          scope: context.scope,
        });
        return result;
      }
    }

    await recordCommandUsage(context.commandUsage, {
      commandId,
      surface: context.commandSurface ?? "prefix",
      alias: context.commandAlias,
      outcome: "success",
      durationMs: performance.now() - startedAt,
      scope: context.scope,
    });

    return {
      handled: true,
      response:
        `Unknown command: ${trimmedInput}. ` +
        `Try ${formatCommandUsage(context, "help")}.`,
    };
  } catch (error) {
    await recordCommandUsage(context.commandUsage, {
      commandId,
      surface: context.commandSurface ?? "prefix",
      alias: context.commandAlias,
      outcome:
        error instanceof PromptQueueCancelledError ? "cancelled" : "failed",
      durationMs: performance.now() - startedAt,
      scope: context.scope,
    });
    throw error;
  }
}
