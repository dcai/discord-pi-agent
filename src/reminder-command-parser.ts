import * as chrono from "chrono-node";
import { z } from "zod";
import { createModuleLogger } from "./logger";

const logger = createModuleLogger("reminder-command-parser");

const parsedReminderSchema = z.object({
  runAt: z.string().refine((value) => {
    return !Number.isNaN(Date.parse(value));
  }, "runAt must be a valid ISO datetime string."),
  prompt: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
});

export type ParsedReminderCommand = z.infer<typeof parsedReminderSchema>;

export async function parseReminderCommand(options: {
  input: string;
  now: Date;
  timeZone: string;
}): Promise<ParsedReminderCommand> {
  try {
    return parseReminderInput(options.input, options.now, options.timeZone);
  } catch (error) {
    logger.error({ error, input: options.input }, "reminder parsing failed");
    throw error;
  }
}

function parseReminderInput(
  input: string,
  now: Date,
  timeZone: string,
): ParsedReminderCommand {
  const { whenText, prompt } = splitReminderRequest(input);
  const parsedDate = chrono.parseDate(
    whenText,
    createChronoReferenceDate(now, timeZone),
    {
      forwardDate: true,
    },
  );

  if (!parsedDate) {
    throw new Error("Could not determine the reminder time.");
  }

  return parsedReminderSchema.parse({
    runAt: resolveTimeZoneDate(parsedDate, timeZone).toISOString(),
    prompt,
    description: buildReminderDescription(prompt),
  });
}

function splitReminderRequest(input: string): {
  whenText: string;
  prompt: string;
} {
  const commaIndex = input.indexOf(",");
  if (commaIndex === -1) {
    throw new Error(
      "Reminder format is `!remind <when>, <what you want to be reminded about>`.",
    );
  }

  const whenText = input.slice(0, commaIndex).trim();
  const prompt = input.slice(commaIndex + 1).trim();

  if (!whenText || !prompt) {
    throw new Error(
      "Reminder format is `!remind <when>, <what you want to be reminded about>`.",
    );
  }

  return {
    whenText,
    prompt,
  };
}

function buildReminderDescription(prompt: string): string {
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  if (normalizedPrompt.length <= 80) {
    return normalizedPrompt;
  }

  return `${normalizedPrompt.slice(0, 77)}...`;
}

function createChronoReferenceDate(now: Date, timeZone: string): Date {
  const timeParts = getTimeZoneParts(now, timeZone);

  return new Date(
    timeParts.year,
    timeParts.month - 1,
    timeParts.day,
    timeParts.hour,
    timeParts.minute,
    timeParts.second,
  );
}

function resolveTimeZoneDate(parsedDate: Date, timeZone: string): Date {
  const desired = {
    year: parsedDate.getFullYear(),
    month: parsedDate.getMonth() + 1,
    day: parsedDate.getDate(),
    hour: parsedDate.getHours(),
    minute: parsedDate.getMinutes(),
    second: parsedDate.getSeconds(),
  };
  const desiredUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );

  let guess = desiredUtc;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = getTimeZoneParts(new Date(guess), timeZone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const diff = desiredUtc - actualUtc;

    if (diff === 0) {
      return new Date(guess);
    }

    guess += diff;
  }

  return new Date(guess);
}

function getTimeZoneParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);

  return {
    year: Number(getRequiredPart(parts, "year")),
    month: Number(getRequiredPart(parts, "month")),
    day: Number(getRequiredPart(parts, "day")),
    hour: Number(getRequiredPart(parts, "hour")),
    minute: Number(getRequiredPart(parts, "minute")),
    second: Number(getRequiredPart(parts, "second")),
  };
}

function getRequiredPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const part = parts.find((entry) => entry.type === type)?.value;
  if (!part) {
    throw new Error(`Missing datetime part ${type}.`);
  }

  return part;
}
