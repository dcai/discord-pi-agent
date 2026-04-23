import type { AgentService } from "./agent-service";
import type { PromptQueue } from "./prompt-queue";
import type { ThinkingLevel } from "./types";

type CommandResult = {
  handled: boolean;
  response?: string;
};

export async function handleCommand(
  input: string,
  agentService: AgentService,
  promptQueue: PromptQueue,
): Promise<CommandResult> {
  const trimmed = input.trim();

  if (!trimmed.startsWith("!")) {
    return { handled: false };
  }

  if (trimmed === "!help") {
    return {
      handled: true,
      response: [
        "Commands:",
        "!help - show this message",
        "!status - show current session status",
        "!thinking - show or set thinking/reasoning level",
        "!compact - compact the persistent session",
        "!reset-session - start a fresh persistent session",
        "Any other DM text goes to the persistent agent session.",
      ].join("\n"),
    };
  }

  if (trimmed === "!status") {
    const agentStatus = agentService.getStatus();
    const queueStatus = promptQueue.getSnapshot();
    const contextUsage = agentStatus.contextUsage;
    const contextLine = contextUsage
      ? contextUsage.tokens === null || contextUsage.percent === null
        ? `context: ?/${contextUsage.contextWindow}`
        : `context: ${contextUsage.tokens}/${contextUsage.contextWindow} (${Math.round(contextUsage.percent)}%)`
      : "context: (unavailable)";
    return {
      handled: true,
      response: [
        `model: ${agentStatus.model}`,
        `session-id: ${agentStatus.sessionId}`,
        `session-file: ${agentStatus.sessionFile ?? "(none)"}`,
        `streaming: ${agentStatus.streaming}`,
        agentStatus.thinkingInfo,
        contextLine,
        `queue-pending: ${queueStatus.pending}`,
        `queue-busy: ${queueStatus.busy}`,
      ].join("\n"),
    };
  }

  if (trimmed === "!thinking" || trimmed.startsWith("!thinking ")) {
    const parts = trimmed.split(" ");
    if (parts.length === 1) {
      const info = agentService.getThinkingLevel();
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
    const result = agentService.setThinkingLevel(requestedLevel);
    return {
      handled: true,
      response: result,
    };
  }

  if (trimmed === "!compact") {
    return {
      handled: true,
      response: await promptQueue.enqueue(async () => {
        return agentService.compact();
      }),
    };
  }

  if (trimmed === "!reset-session") {
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
