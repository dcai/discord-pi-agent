import type { SessionScope } from "../session-registry";
import type { ThinkingLevel } from "../types";
import { formatCommandInventoryHelp } from "../command-registry";
import type { CommandHandler } from "./shared";
import {
  buildAbortResponse,
  formatCommandUsage,
  getPrimaryCommandPrefix,
  getSessionStatusText,
  INTERNAL_COMMAND_PREFIX,
  requireEffectiveSession,
} from "./shared";

async function handleHelpCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}help`) {
    return null;
  }

  return {
    handled: true,
    response: formatCommandInventoryHelp(context),
  };
}

async function handleArchiveCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}archive`) {
    return null;
  }

  if (!context.session) {
    return {
      handled: true,
      response: `${formatCommandUsage(context, "archive")} is only available in forum threads.`,
    };
  }

  return {
    handled: true,
    archive: true,
    response: "Archiving thread and shutting down session.",
  };
}

async function handleStatusCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}status`) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  return {
    handled: true,
    response: getSessionStatusText(
      effectiveSession.session,
      context.promptQueue,
      {
        tools: effectiveSession.session.getAllTools(),
        extensionsSummary:
          context.agentService.resources.getExtensionsSummary(),
        skillsSummary: context.agentService.resources.getSkillsSummary(),
      },
    ),
  };
}

async function handleThinkingCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}thinking` &&
    !trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}thinking `)
  ) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const parts = trimmedInput.split(" ");
  if (parts.length === 1) {
    const info = context.agentService.models.getThinkingLevel(
      effectiveSession.session,
    );
    if (!info.supported) {
      return {
        handled: true,
        response: "Current model does not support reasoning/thinking.",
      };
    }

    return {
      handled: true,
      response: [
        `Current: ${info.current}`,
        `Available: ${info.available.join(", ")}`,
        `Usage: ${formatCommandUsage(context, "thinking <level>")}`,
      ].join("\n"),
    };
  }

  return {
    handled: true,
    response: context.agentService.models.setThinkingLevel(
      effectiveSession.session,
      parts[1] as ThinkingLevel,
    ),
  };
}

async function handleModelCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}model` &&
    !trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}model `)
  ) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const parts = trimmedInput.split(" ");
  if (parts.length === 1) {
    const current = context.agentService.models.getCurrentModelDisplay(
      effectiveSession.session,
    );
    const modelList = await context.agentService.models.listModels(
      effectiveSession.session,
      getPrimaryCommandPrefix(context),
    );

    return {
      handled: true,
      response: `Current model: ${current}\n\n${modelList}`,
    };
  }

  const argument = parts.slice(1).join(" ");
  const slashIndex = argument.indexOf("/");
  if (slashIndex === -1) {
    return {
      handled: true,
      response:
        `Usage: ${formatCommandUsage(context, "model <provider/modelId>")}\n` +
        `Example: ${formatCommandUsage(context, "model openrouter/anthropic/claude-sonnet-4")}\n` +
        `Use ${formatCommandUsage(context, "model")} without args to see available models.`,
    };
  }

  return {
    handled: true,
    response: await context.agentService.models.switchModel(
      argument.substring(0, slashIndex).trim(),
      argument.substring(slashIndex + 1).trim(),
      effectiveSession.session,
    ),
  };
}

async function handleCompactCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}compact`) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  return {
    handled: true,
    response: await context.promptQueue.enqueue(async () => {
      await effectiveSession.session.compact();
      return `Compaction finished for session ${effectiveSession.session.sessionId}.`;
    }),
  };
}

async function handleReloadCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}reload`) {
    return null;
  }

  return {
    handled: true,
    response: await context.promptQueue.enqueue(async () => {
      return context.agentService.resources.reloadResources();
    }),
  };
}

async function handleAbortCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (trimmedInput !== `${INTERNAL_COMMAND_PREFIX}abort`) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const queueStatus = context.promptQueue.getSnapshot();
  context.promptQueue.markAbort();
  const clearedCount = context.promptQueue.cancelPending();
  await effectiveSession.session.abort();

  return {
    handled: true,
    response: buildAbortResponse(queueStatus, clearedCount),
  };
}

async function handleSessionResetCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}session reset` &&
    !trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}session reset `)
  ) {
    return null;
  }

  const target = trimmedInput
    .slice(`${INTERNAL_COMMAND_PREFIX}session reset`.length)
    .trim();
  if (!target) {
    return {
      handled: true,
      response: `Usage: ${formatCommandUsage(context, "session reset <scope|here>")}`,
    };
  }

  if (!context.sessionRegistry) {
    return {
      handled: true,
      response:
        "Session reset is unavailable because the session registry is not configured.",
    };
  }

  const scope = resolveSessionResetScope(target, context.scope);
  if (!scope) {
    return {
      handled: true,
      response:
        `Unknown session scope: ${target}\n` +
        "Supported scopes: dm, thread:<id>, job:<id>, or here",
    };
  }

  await context.sessionRegistry.reset(scope);
  return {
    handled: true,
    response:
      scope === context.scope
        ? `Reset session data for ${scope}. The next message will start a fresh session.`
        : `Reset session data for ${scope}.`,
  };
}

async function handleReactionCommand(
  trimmedInput: string,
  context: Parameters<CommandHandler>[1],
) {
  if (
    trimmedInput !== `${INTERNAL_COMMAND_PREFIX}reaction` &&
    !trimmedInput.startsWith(`${INTERNAL_COMMAND_PREFIX}reaction `)
  ) {
    return null;
  }

  const parts = trimmedInput.split(" ");
  if (parts.length === 1) {
    return {
      handled: true,
      response:
        `Current working reaction: ${context.workingEmoji}\n` +
        `Usage: ${formatCommandUsage(context, "reaction <emoji>")} to change it.\n` +
        `Examples: ${formatCommandUsage(context, "reaction 🔄")} or ${formatCommandUsage(context, "reaction ⏳")}`,
    };
  }

  const emoji = parts.slice(1).join(" ").trim();
  if (!emoji) {
    return {
      handled: true,
      response: `Please provide an emoji. Example: ${formatCommandUsage(context, "reaction 🔄")}`,
    };
  }

  return {
    handled: true,
    workingEmoji: emoji,
    response: `Working reaction emoji set to ${emoji}`,
  };
}

function resolveSessionResetScope(
  value: string,
  currentScope: SessionScope,
): SessionScope | null {
  if (value === "here") {
    return currentScope;
  }

  if (
    value === "dm" ||
    value.startsWith("thread:") ||
    value.startsWith("job:")
  ) {
    return value as SessionScope;
  }

  return null;
}

export const coreCommandHandlers: CommandHandler[] = [
  handleHelpCommand,
  handleArchiveCommand,
  handleStatusCommand,
  handleThinkingCommand,
  handleModelCommand,
  handleCompactCommand,
  handleSessionResetCommand,
  handleAbortCommand,
  handleReloadCommand,
  handleReactionCommand,
];
