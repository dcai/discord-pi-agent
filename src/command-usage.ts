import { randomUUID } from "node:crypto";
import { createModuleLogger } from "./logger";
import type {
  CommandUsageEvent,
  CommandUsageOptions,
  CommandUsageOutcome,
  CommandUsageSurface,
} from "./types";
import type { SessionScope } from "./session-registry";

const logger = createModuleLogger("command-usage");

export async function recordCommandUsage(
  options: CommandUsageOptions | undefined,
  input: {
    commandId: string;
    surface: CommandUsageSurface;
    alias?: string;
    resourceName?: string;
    outcome: CommandUsageOutcome;
    durationMs: number;
    scope: SessionScope;
  },
): Promise<void> {
  if (!options) {
    return;
  }

  const event: CommandUsageEvent = {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    commandId: input.commandId,
    surface: input.surface,
    alias: input.alias,
    resourceName: input.resourceName,
    scopeType: getScopeType(input.scope),
    outcome: input.outcome,
    durationMs: Math.max(0, Math.round(input.durationMs)),
  };

  try {
    await options.record(event);
  } catch (error) {
    logger.warn(
      { error, commandId: event.commandId, surface: event.surface },
      "command usage recorder failed",
    );
  }
}

function getScopeType(scope: SessionScope): CommandUsageEvent["scopeType"] {
  if (scope === "dm") {
    return "dm";
  }

  if (scope.startsWith("thread:")) {
    return "thread";
  }

  return "job";
}
