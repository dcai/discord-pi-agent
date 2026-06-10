import { z } from "zod";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentService } from "./agent-service";
import { createModuleLogger } from "./logger";
import { formatDiscordPromptTime } from "./prompt-context";

const logger = createModuleLogger("reminder-command-parser");

const parsedReminderSchema = z.object({
  runAt: z.string().refine((value) => {
    return !Number.isNaN(Date.parse(value));
  }, "runAt must be a valid ISO datetime string."),
  prompt: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
});

const reminderParserResponseSchema = z.union([
  parsedReminderSchema,
  z.object({
    error: z.string().trim().min(1),
  }),
]);

type ReminderParserResponse = z.infer<typeof reminderParserResponseSchema>;

export type ParsedReminderCommand = z.infer<typeof parsedReminderSchema>;

export async function parseReminderCommand(options: {
  agentService: AgentService;
  input: string;
  now: Date;
  timeZone: string;
  locale: string;
}): Promise<ParsedReminderCommand> {
  const session = await options.agentService.createTemporarySession();

  try {
    await options.agentService.models.ensureSessionHasConfiguredModel(session);
    await session.prompt(
      buildReminderParserPrompt(
        options.input,
        options.now,
        options.timeZone,
        options.locale,
      ),
    );

    const responseText = extractLastAssistantText(session);
    if (!responseText) {
      throw new Error("Reminder parser returned no response.");
    }

    const parsedResponse = reminderParserResponseSchema.parse(
      JSON.parse(extractJsonBlock(responseText)),
    );

    if ("error" in parsedResponse) {
      throw new Error(parsedResponse.error);
    }

    return parsedResponse;
  } catch (error) {
    logger.error({ error, input: options.input }, "reminder parsing failed");
    throw error;
  } finally {
    session.dispose();
  }
}

function buildReminderParserPrompt(
  input: string,
  now: Date,
  timeZone: string,
  locale: string,
): string {
  return [
    "Convert the user's Discord !remind request into one runtime reminder.",
    "",
    "Rules:",
    "- Return JSON only.",
    "- Do not wrap the JSON in markdown unless necessary.",
    "- Create exactly one reminder.",
    "- Resolve relative dates/times using the provided current datetime and timezone.",
    "- The runAt field must be an ISO datetime string with timezone information.",
    "- The prompt field must contain only the task the reminder should run.",
    "- The description field is optional.",
    '- If the time or request is ambiguous, invalid, or missing, return {"error":"..."}.',
    "",
    `Current datetime ISO: ${now.toISOString()}`,
    `Current datetime local: ${formatDiscordPromptTime(now, { timeZone, locale })}`,
    `Default timezone: ${timeZone}`,
    "",
    `User request: ${input}`,
    "",
    "Return exactly one of these shapes:",
    '{"runAt":"<ISO datetime>","prompt":"<task prompt>","description":"<optional short description>"}',
    '{"error":"<what went wrong>"}',
  ].join("\n");
}

function extractJsonBlock(text: string): string {
  const fencedJsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedJsonMatch?.[1]) {
    return fencedJsonMatch[1].trim();
  }

  return text.trim();
}

function extractLastAssistantText(session: AgentSession): string {
  const messages = session.messages;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      !message ||
      message.role !== "assistant" ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    return message.content
      .filter((item): item is { type: "text"; text: string } => {
        return item.type === "text" && typeof item.text === "string";
      })
      .map((item) => {
        return item.text;
      })
      .join("\n")
      .trim();
  }

  return "";
}
