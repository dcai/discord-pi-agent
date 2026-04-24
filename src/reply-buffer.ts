import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { transformMarkdownTablesToCodeBlocks } from "./markdown-table-transformer";

type CollectReplyOptions = {
  logPrefix?: string;
};

export async function collectReply(
  session: AgentSession,
  prompt: string,
  options: CollectReplyOptions = {},
): Promise<string> {
  const logPrefix = options.logPrefix ?? "[agent]";
  let streamedText = "";
  let eventCount = 0;
  let toolCount = 0;
  let sawAgentEnd = false;

  console.log(`${logPrefix} prompt start`, { prompt });

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    eventCount += 1;

    if (event.type === "message_update") {
      if (event.assistantMessageEvent.type === "text_delta") {
        streamedText += event.assistantMessageEvent.delta;
      }

      if (event.assistantMessageEvent.type === "thinking_delta") {
        // console.log(`${logPrefix} thinking delta length=${event.assistantMessageEvent.delta.length}`);
      }
    }

    if (event.type === "tool_execution_start") {
      toolCount += 1;
      console.log(`${logPrefix} tool start`, {
        toolName: event.toolName,
        input: truncateForLog(JSON.stringify(event.args)),
      });
    }

    if (event.type === "tool_execution_end") {
      console.log(`${logPrefix} tool end`, {
        toolName: event.toolName,
        isError: event.isError,
        output: truncateForLog(extractToolOutput(event.result)),
      });
    }

    if (event.type === "agent_end") {
      sawAgentEnd = true;
      console.log(`${logPrefix} agent end`, {
        messageCount: event.messages.length,
      });
    }
  });

  try {
    await session.prompt(prompt);
  } finally {
    unsubscribe();
  }

  const errorMessage = session.agent.state.errorMessage?.trim();
  const fallbackText = getLatestAssistantText(session.messages);
  const finalText = streamedText.trim() || fallbackText.trim();

  console.log(`${logPrefix} prompt done`, {
    eventCount,
    toolCount,
    sawAgentEnd,
    streamedTextLength: streamedText.trim().length,
    fallbackTextLength: fallbackText.trim().length,
    errorMessage,
  });

  if (errorMessage) {
    return errorMessage;
  }

  if (finalText) {
    const transformed = await transformMarkdownTablesToCodeBlocks(finalText);
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

function extractToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
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
    .filter((item) => {
      return item.type === "text";
    })
    .map((item) => {
      return item.text;
    })
    .join("\n")
    .trim();
}
