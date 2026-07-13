import type { ImageContent } from "@earendil-works/pi-ai";
import { runAgentTurn } from "./agent-turn-runner";
import type { ScopedSessionEntry } from "./session-registry";

type AgentToolLifecycleEvent = {
  toolName: string;
  toolCallId: string;
  isError?: boolean;
};

type PreparedAgentPrompt = {
  prompt: string;
  images?: ImageContent[];
};

export async function executeQueuedAgentPrompt<
  T extends PreparedAgentPrompt,
>(options: {
  entry: ScopedSessionEntry;
  prepare: () => Promise<T>;
  beforeRun?: (input: T) => void | Promise<void>;
  onToolStart?: (event: AgentToolLifecycleEvent) => void | Promise<void>;
  onToolEnd?: (event: AgentToolLifecycleEvent) => void | Promise<void>;
}): Promise<{ response: string; input: T }> {
  return options.entry.promptQueue.enqueue(async () => {
    const input = await options.prepare();
    await options.beforeRun?.(input);

    const response =
      input.images !== undefined ||
      options.onToolStart !== undefined ||
      options.onToolEnd !== undefined
        ? await runAgentTurn(options.entry.session, input.prompt, {
            images: input.images,
            onToolStart: options.onToolStart,
            onToolEnd: options.onToolEnd,
          })
        : await runAgentTurn(options.entry.session, input.prompt);

    return { response, input };
  });
}
