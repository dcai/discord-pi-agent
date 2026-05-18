import type { AgentSession, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { AgentService } from "./agent-service";
import type { PromptQueue } from "./prompt-queue";
import type { ThinkingLevel } from "./types";

export type CommandResult = {
  handled: boolean;
  response?: string;
  /** Set to true when the command wants to archive the current thread. */
  archive?: boolean;
};

export type CommandContext = {
  agentService: AgentService;
  promptQueue: PromptQueue;
  session?: AgentSession;
};

type CommandHandler = (
  trimmedInput: string,
  context: CommandContext,
) => Promise<CommandResult | null>;

function getSessionStatusText(
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
    const toolNames = extras.tools.map((tool) => tool.name);
    lines.push("", `Tools (${extras.tools.length}): ${toolNames.join(", ")}`);
  }

  if (extras?.skillsSummary) {
    lines.push("", extras.skillsSummary);
  }

  if (extras?.extensionsSummary) {
    lines.push("", extras.extensionsSummary);
  }

  return lines.join("\n");
}

function getThinkingInfo(session: AgentSession): {
  current: ThinkingLevel;
  available: ThinkingLevel[];
  supported: boolean;
} {
  if (!session.supportsThinking()) {
    return { current: "off", available: [], supported: false };
  }

  return {
    current: session.thinkingLevel,
    available: session.getAvailableThinkingLevels(),
    supported: true,
  };
}

function getEffectiveSession(context: CommandContext): AgentSession | null {
  return context.session ?? context.agentService.getSession();
}

function requireEffectiveSession(
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

async function handleHelpCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== "!help") {
    return null;
  }

  const extraCommands = context.session
    ? "\n!archive - archive this thread and end the session"
    : "";

  return {
    handled: true,
    response: [
      "Commands:",
      "!help - show this message",
      "!status - show current session status",
      "!thinking - show or set thinking/reasoning level",
      "!model - list available models or switch to one",
      "!compact - compact the persistent session",
      "!reset-session - start a fresh persistent session",
      "!reload - reload resources (AGENTS.md, extensions, skills, etc.)",
      extraCommands,
      "Any other text goes to the agent session.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function handleArchiveCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== "!archive") {
    return null;
  }

  if (!context.session) {
    return {
      handled: true,
      response: "!archive is only available in forum threads.",
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
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== "!status") {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const tools = effectiveSession.session.getAllTools();
  const extensionsSummary = context.agentService.getExtensionsSummary();
  const skillsSummary = context.agentService.getSkillsSummary();

  return {
    handled: true,
    response: getSessionStatusText(
      effectiveSession.session,
      context.promptQueue,
      {
        tools,
        extensionsSummary,
        skillsSummary,
      },
    ),
  };
}

async function handleThinkingCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== "!thinking" && !trimmedInput.startsWith("!thinking ")) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const parts = trimmedInput.split(" ");
  if (parts.length === 1) {
    const info = getThinkingInfo(effectiveSession.session);
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
        `Usage: !thinking <level>`,
      ].join("\n"),
    };
  }

  const requestedLevel = parts[1] as ThinkingLevel;
  if (!effectiveSession.session.supportsThinking()) {
    return {
      handled: true,
      response: "Current model does not support reasoning/thinking.",
    };
  }

  const available = effectiveSession.session.getAvailableThinkingLevels();
  if (!available.includes(requestedLevel)) {
    return {
      handled: true,
      response: `Invalid thinking level "${requestedLevel}" for current model. Available: ${available.join(", ")}`,
    };
  }

  effectiveSession.session.setThinkingLevel(requestedLevel);
  return {
    handled: true,
    response: `Thinking level set to "${requestedLevel}".`,
  };
}

async function handleModelCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== "!model" && !trimmedInput.startsWith("!model ")) {
    return null;
  }

  const effectiveSession = requireEffectiveSession(context);
  if ("handled" in effectiveSession) {
    return effectiveSession;
  }

  const parts = trimmedInput.split(" ");
  if (parts.length === 1) {
    const current = context.agentService.getCurrentModelDisplay(
      effectiveSession.session,
    );
    const modelList = await context.agentService.listModels(
      effectiveSession.session,
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
        "Usage: !model <provider/modelId>\n" +
        "Example: !model openrouter/anthropic/claude-sonnet-4\n" +
        "Use !model without args to see available models.",
    };
  }

  const provider = argument.substring(0, slashIndex).trim();
  const modelId = argument.substring(slashIndex + 1).trim();

  return {
    handled: true,
    response: await context.agentService.switchModel(
      provider,
      modelId,
      effectiveSession.session,
    ),
  };
}

async function handleCompactCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== "!compact") {
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
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== "!reload") {
    return null;
  }

  return {
    handled: true,
    response: await context.promptQueue.enqueue(async () => {
      return context.agentService.reloadResources();
    }),
  };
}

async function handleResetSessionCommand(
  trimmedInput: string,
  context: CommandContext,
): Promise<CommandResult | null> {
  if (trimmedInput !== "!reset-session") {
    return null;
  }

  if (context.session) {
    return {
      handled: true,
      response: await context.promptQueue.enqueue(async () => {
        const previousSession = context.session!;
        await previousSession.abort();
        previousSession.dispose();
        return `Session reset. Old session kept at ${previousSession.sessionFile ?? "(unknown path)"}. Use !archive to archive the thread and start fresh.`;
      }),
    };
  }

  return {
    handled: true,
    response: await context.promptQueue.enqueue(async () => {
      return context.agentService.resetSession();
    }),
  };
}

const commandHandlers: CommandHandler[] = [
  handleHelpCommand,
  handleArchiveCommand,
  handleStatusCommand,
  handleThinkingCommand,
  handleModelCommand,
  handleCompactCommand,
  handleReloadCommand,
  handleResetSessionCommand,
];

export async function handleCommand(
  input: string,
  context: CommandContext,
): Promise<CommandResult> {
  const trimmedInput = input.trim();

  if (!trimmedInput.startsWith("!")) {
    return { handled: false };
  }

  for (const handler of commandHandlers) {
    const result = await handler(trimmedInput, context);
    if (result) {
      return result;
    }
  }

  return {
    handled: true,
    response: `Unknown command: ${trimmedInput}. Try !help.`,
  };
}
