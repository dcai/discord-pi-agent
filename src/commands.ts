import type { AgentService } from "./agent-service";
import type { PromptQueue } from "./prompt-queue";

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
				contextLine,
				`queue-pending: ${queueStatus.pending}`,
				`queue-busy: ${queueStatus.busy}`,
			].join("\n"),
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
