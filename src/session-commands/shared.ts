import type { AgentSession, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { AgentService } from "../agent-service";
import type { PromptQueue } from "../prompt-queue";
import type { SessionRegistry, SessionScope } from "../session-registry";
import type { TaskSchedulerService } from "../task-scheduler-service";
import type { CommandUsageOptions, CommandUsageSurface } from "../types";

export type CommandResult = {
  handled: boolean;
  response?: string;
  forwardedInput?: string;
  archive?: boolean;
  workingEmoji?: string;
  newSession?: AgentSession;
};

export type CommandContext = {
  agentService: AgentService;
  promptQueue: PromptQueue;
  session?: AgentSession;
  taskScheduler?: TaskSchedulerService | null;
  sessionRegistry?: SessionRegistry;
  channelId?: string;
  promptTimeZone?: string;
  promptLocale?: string;
  scope: SessionScope;
  workingEmoji: string;
  commandPrefixes?: string[];
  commandUsage?: CommandUsageOptions;
  commandSurface?: CommandUsageSurface;
  commandAlias?: string;
};

export type CommandHandler = (
  trimmedInput: string,
  context: CommandContext,
) => Promise<CommandResult | null>;

export const INTERNAL_COMMAND_PREFIX = "!";

export function getSessionStatusText(
  session: AgentSession,
  promptQueue: PromptQueue,
  extras?: {
    tools?: ToolInfo[];
    extensionsSummary?: string;
    skillsSummary?: string;
  },
): string {
  const model = session.model
    ? `${session.model.provider}/${session.model.id}`
    : "(no model selected)";
  const contextUsage = session.getContextUsage();
  const contextLine = contextUsage
    ? contextUsage.tokens === null || contextUsage.percent === null
      ? `context: ?/${contextUsage.contextWindow}`
      : `context: ${contextUsage.tokens}/${contextUsage.contextWindow} (${Math.round(contextUsage.percent)}%)`
    : "context: (unavailable)";
  const thinkingInfo = session.supportsThinking()
    ? `thinking: ${session.thinkingLevel} (available: ${session.getAvailableThinkingLevels().join(", ")})`
    : "thinking: not supported";
  const queueStatus = promptQueue.getSnapshot();

  const lines = [
    `model: ${model}`,
    `session-id: ${session.sessionId}`,
    `session-file: ${session.sessionFile ?? "(none)"}`,
    `streaming: ${session.isStreaming}`,
    thinkingInfo,
    contextLine,
    `queue-pending: ${queueStatus.pending}`,
    `queue-busy: ${queueStatus.busy}`,
  ];

  if (extras?.tools && extras.tools.length > 0) {
    lines.push(
      "",
      `Tools (${extras.tools.length}): ${extras.tools.map((tool) => tool.name).join(", ")}`,
    );
  }

  if (extras?.skillsSummary) {
    lines.push("", extras.skillsSummary);
  }

  if (extras?.extensionsSummary) {
    lines.push("", extras.extensionsSummary);
  }

  return lines.join("\n");
}

export function getEffectiveSession(
  context: CommandContext,
): AgentSession | null {
  return context.session ?? context.agentService.getSession();
}

export function getPrimaryCommandPrefix(context: CommandContext): string {
  return context.commandPrefixes?.[0] ?? INTERNAL_COMMAND_PREFIX;
}

export function formatCommandUsage(
  context: CommandContext,
  body: string,
): string {
  return `${getPrimaryCommandPrefix(context)}${body}`;
}

export function normalizeCommandInput(
  input: string,
  commandPrefixes: string[],
): string | null {
  for (const prefix of commandPrefixes) {
    if (!prefix) {
      continue;
    }

    if (input === prefix) {
      return INTERNAL_COMMAND_PREFIX;
    }

    if (input.startsWith(prefix)) {
      return `${INTERNAL_COMMAND_PREFIX}${input.slice(prefix.length)}`;
    }
  }

  return null;
}

export function requireEffectiveSession(
  context: CommandContext,
): CommandResult | { session: AgentSession } {
  const session = getEffectiveSession(context);
  if (!session) {
    return {
      handled: true,
      response: "No active session.",
    };
  }

  return { session };
}

export function buildAbortResponse(
  queueStatus: {
    busy: boolean;
  },
  clearedCount: number,
): string {
  if (!queueStatus.busy && clearedCount === 0) {
    return "Nothing was running or queued.";
  }

  if (!queueStatus.busy && clearedCount > 0) {
    return `Cleared ${clearedCount} queued request(s).`;
  }

  if (clearedCount > 0) {
    return `Aborted the active run and cleared ${clearedCount} queued request(s).`;
  }

  return "Aborted the active run.";
}

export function stringifyCommandError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
