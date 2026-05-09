import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { createModuleLogger } from "./logger";
import { transformMarkdownTablesToCodeBlocks } from "./markdown-table-transformer";

const logger = createModuleLogger("reply-buffer");

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

  const model = session.model
    ? `${session.model.provider}/${session.model.id}`
    : "none";

  console.info(`=== Full Prompt ===`);
  console.info(prompt);
  console.info(`=== END ===`);

  logger.debug(
    {
      logPrefix,
      promptLength: prompt.length,
      model,
      prompt,
    },
    "prompt start",
  );

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
      logger.debug(
        {
          toolName: event.toolName,
          input: truncateForLog(JSON.stringify(event.args)),
          logPrefix,
        },
        "tool start",
      );
    }

    if (event.type === "tool_execution_end") {
      logger.debug(
        {
          toolName: event.toolName,
          isError: event.isError,
          output: truncateForLog(extractToolOutput(event.result)),
          logPrefix,
        },
        "tool end",
      );
    }

    if (event.type === "agent_end") {
      sawAgentEnd = true;
      logger.debug(
        {
          messageCount: event.messages.length,
          model,
          logPrefix,
        },
        "agent end",
      );
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

  if (errorMessage) {
    return errorMessage;
  }

  if (finalText) {
    const transformed = await transformMarkdownTablesToCodeBlocks(finalText);
    console.info(`========== BEFORE ==========`);
    console.info(finalText);
    console.info(`========== TRANSFORMED ==========`);
    console.info(transformed);
    console.info(`========== END ==========`);
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
