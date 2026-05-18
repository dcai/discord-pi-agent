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
    const toolNames = extras.tools.map((t) => t.name);
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

export async function handleCommand(
  input: string,
  ctx: CommandContext,
): Promise<CommandResult> {
  const { agentService, promptQueue, session } = ctx;
  const trimmed = input.trim();

  if (!trimmed.startsWith("!")) {
    return { handled: false };
  }

  if (trimmed === "!help") {
    const extraCommands = session
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

  if (trimmed === "!archive") {
    if (!session) {
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

  if (trimmed === "!status") {
    const effectiveSession = session ?? agentService.getSession();
    if (!effectiveSession) {
      return {
        handled: true,
        response: "No active session.",
      };
    }

    const tools = effectiveSession.getAllTools();
    const extensionsSummary = agentService.getExtensionsSummary();
    const skillsSummary = agentService.getSkillsSummary();

    return {
      handled: true,
      response: getSessionStatusText(effectiveSession, promptQueue, {
        tools,
        extensionsSummary,
        skillsSummary,
      }),
    };
  }

  if (trimmed === "!thinking" || trimmed.startsWith("!thinking ")) {
    const effectiveSession = session ?? agentService.getSession();
    if (!effectiveSession) {
      return {
        handled: true,
        response: "No active session.",
      };
    }

    const parts = trimmed.split(" ");
    if (parts.length === 1) {
      const info = getThinkingInfo(effectiveSession);
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
    if (!effectiveSession.supportsThinking()) {
      return {
        handled: true,
        response: "Current model does not support reasoning/thinking.",
      };
    }

    const available = effectiveSession.getAvailableThinkingLevels();
    if (!available.includes(requestedLevel)) {
      return {
        handled: true,
        response: `Invalid thinking level "${requestedLevel}" for current model. Available: ${available.join(", ")}`,
      };
    }

    effectiveSession.setThinkingLevel(requestedLevel);
    return {
      handled: true,
      response: `Thinking level set to "${requestedLevel}".`,
    };
  }

  if (trimmed === "!model" || trimmed.startsWith("!model ")) {
    const effectiveSession = session ?? agentService.getSession();
    if (!effectiveSession) {
      return {
        handled: true,
        response: "No active session.",
      };
    }

    const parts = trimmed.split(" ");
    if (parts.length === 1) {
      // Show current model + available models
      const current = agentService.getCurrentModelDisplay(effectiveSession);
      const modelList = await agentService.listModels(effectiveSession);

      return {
        handled: true,
        response: `Current model: ${current}\n\n${modelList}`,
      };
    }

    // Parse provider/modelId from the argument.
    // Split on first "/" — provider comes first, the rest is the model ID
    // (model IDs can contain slashes, e.g. "anthropic/claude-sonnet-4")
    const arg = parts.slice(1).join(" ");
    const slashIndex = arg.indexOf("/");
    if (slashIndex === -1) {
      return {
        handled: true,
        response: `Usage: !model <provider/modelId>\nExample: !model openrouter/anthropic/claude-sonnet-4\nUse !model without args to see available models.`,
      };
    }

    const provider = arg.substring(0, slashIndex).trim();
    const modelId = arg.substring(slashIndex + 1).trim();

    return {
      handled: true,
      response: await agentService.switchModel(
        provider,
        modelId,
        effectiveSession,
      ),
    };
  }

  if (trimmed === "!compact") {
    const effectiveSession = session ?? agentService.getSession();
    if (!effectiveSession) {
      return {
        handled: true,
        response: "No active session.",
      };
    }

    return {
      handled: true,
      response: await promptQueue.enqueue(async () => {
        await effectiveSession.compact();
        return `Compaction finished for session ${effectiveSession.sessionId}.`;
      }),
    };
  }

  if (trimmed === "!reload") {
    return {
      handled: true,
      response: await promptQueue.enqueue(async () => {
        return agentService.reloadResources();
      }),
    };
  }

  if (trimmed === "!reset-session") {
    if (session) {
      return {
        handled: true,
        response: await promptQueue.enqueue(async () => {
          const previousSession = session;
          await previousSession.abort();
          previousSession.dispose();
          return `Session reset. Old session kept at ${previousSession.sessionFile ?? "(unknown path)"}. Use !archive to archive the thread and start fresh.`;
        }),
      };
    }

    return {
      handled: true,
      response: await promptQueue.enqueue(async () => {
        return agentService.resetSession();
      }),
    };
  }

  return {
    handled: true,
    response: `Unknown command: ${trimmed}. Try !help.`,
  };
}
