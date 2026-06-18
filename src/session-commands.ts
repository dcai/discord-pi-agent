import { coreCommandHandlers } from "./session-commands/core-commands";
import { schedulerCommandHandlers } from "./session-commands/scheduler-commands";
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

  for (const handler of commandHandlers) {
    const result = await handler(normalizedCommandInput, context);
    if (result) {
      return result;
    }
  }

  return {
    handled: true,
    response:
      `Unknown command: ${trimmedInput}. ` +
      `Try ${formatCommandUsage(context, "help")}.`,
  };
}
