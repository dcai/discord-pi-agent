import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { debugPrint } from "./debug-print";
import { createModuleLogger } from "./logger";
import { transformMarkdownTablesToCodeBlocks } from "./markdown-table-transformer";

const logger = createModuleLogger("agent-turn-runner");

type ToolLifecycleEvent = {
  toolName: string;
  toolCallId: string;
  isError?: boolean;
};

type CollectReplyOptions = {
  images?: ImageContent[];
  onToolStart?: (event: ToolLifecycleEvent) => void | Promise<void>;
  onToolEnd?: (event: ToolLifecycleEvent) => void | Promise<void>;
};

type AgentMessage = AgentSession["messages"][number];

type TextMessageContentItem = {
  type: "text";
  text: string;
};

export async function runAgentTurn(
  session: AgentSession,
  prompt: string,
  options: CollectReplyOptions = {},
): Promise<string> {
  let streamedText = "";
  let eventCount = 0;
  let toolCount = 0;
  const toolInputsByCallId = new Map<string, unknown>();

  const model = session.model
    ? `${session.model.provider}/${session.model.id}`
    : "none";

  debugPrint(prompt, "Full Prompt");

  // logger.debug(
  //   {
  //     promptLength: prompt.length,
  //     model,
  //     prompt,
  //   },
  //   "prompt start",
  // );

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    eventCount += 1;

    if (event.type === "message_update") {
      if (event.assistantMessageEvent.type === "text_delta") {
        streamedText += event.assistantMessageEvent.delta;
      }

      if (event.assistantMessageEvent.type === "thinking_delta") {
        // Intentionally ignored. Thinking deltas are too noisy for routine logs.
      }
    }

    if (event.type === "tool_execution_start") {
      toolCount += 1;

      const input = event.toolName === "bash" ? event.args.command : event.args;
      toolInputsByCallId.set(event.toolCallId, input);
      void options.onToolStart?.({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
      });

      if (event.toolName === "bash") {
        debugPrint(input, "CMD");
        // logger.debug(
        //   {
        //     toolName: event.toolName,
        //   },
        //   `agent tool start: [${event.toolName}]`,
        // );
      } else {
        logger.debug(
          {
            toolName: event.toolName,
            // input,
          },
          `agent tool start: [${event.toolName}]`,
        );
      }
    }

    if (event.type === "tool_execution_end") {
      const input = toolInputsByCallId.get(event.toolCallId);
      toolInputsByCallId.delete(event.toolCallId);
      void options.onToolEnd?.({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
      });

      if (event.toolName === "bash") {
        debugPrint(
          extractToolOutput(event.result),
          event.isError ? "BASH TOOL ERROR OUTPUT" : "BASH TOOL OUTPUT",
        );
        // logger.debug(
        //   {
        //     toolName: event.toolName,
        //     isError: event.isError,
        //   },
        //   `agent tool end: [${event.toolName}] ${truncateForLog(
        //     typeof input === "string" ? input : "",
        //   )}`,
        // );
      } else {
        logger.debug(
          {
            toolName: event.toolName,
            // input: truncateForLog(extractToolOutput(input)),
            isError: event.isError,
            // output: event.result,
            // output: truncateForLog(extractToolOutput(event.result)),
          },
          `agent tool end: [${event.toolName}]`,
        );
      }
    }

    // if (event.type === "agent_end") {
    //   logger.debug(
    //     {
    //       messageCount: event.messages.length,
    //       model,
    //       toolCount,
    //       eventCount,
    //     },
    //     "agent end",
    //   );
    // }
  });

  try {
    await session.prompt(prompt, { images: options.images });
  } finally {
    unsubscribe();
  }

  const errorMessage = session.agent.state.errorMessage?.trim();
  const fallbackText = getLatestAssistantText(session.messages);
  const finalText = streamedText.trim() || fallbackText.trim();

  if (errorMessage) {
    return errorMessage;
  }

  if (finalText) {
    const transformed = await transformMarkdownTablesToCodeBlocks(finalText);
    debugPrint(finalText, "BEFORE TRANSFORM");
    debugPrint(transformed, "TRANSFORMED");
    return transformed;
  }

  return "No response generated.";
}

function truncateForLog(value: string, maxLength = 400): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

type ToolOutputContentItem = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

type ToolOutputObject = {
  content?: ToolOutputContentItem[];
  [key: string]: unknown;
};

function extractToolOutput(output: unknown): string {
  if (typeof output === "object" && output !== null) {
    const obj = output as ToolOutputObject;
    if (Array.isArray(obj.content)) {
      return obj.content
        .map((item) => {
          if (item.type === "text" && typeof item.text === "string") {
            return item.text;
          }

          return JSON.stringify(item);
        })
        .join("\n");
    }
  }

  return String(output);
}

function getLatestAssistantText(messages: AgentMessage[]): string {
  const latestAssistantMessage = [...messages].reverse().find((message) => {
    return message.role === "assistant";
  });

  if (
    !latestAssistantMessage ||
    !Array.isArray(latestAssistantMessage.content)
  ) {
    return "";
  }

  return latestAssistantMessage.content
    .filter((item): item is TextMessageContentItem => {
      return item.type === "text" && typeof item.text === "string";
    })
    .map((item) => {
      return item.text;
    })
    .join("\n")
    .trim();
}
