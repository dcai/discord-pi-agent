import { z } from "zod";
import type { ScheduledTaskDefinition, TaskSessionTarget } from "./types";

type ScheduledJobsFactory = () =>
  | ScheduledTaskDefinition[]
  | Promise<ScheduledTaskDefinition[]>;

const trimmedStringSchema = z.string().trim().min(1);

const optionalTrimmedStringSchema = z
  .string()
  .optional()
  .transform((value) => {
    const trimmedValue = value?.trim();
    return trimmedValue ? trimmedValue : undefined;
  });

const sessionScopeSchema = z.custom<ScopedTaskSessionTarget["scope"]>((value) => {
  return (
    typeof value === "string" &&
    (value === "dm" || value.startsWith("thread:") || value.startsWith("job:"))
  );
});

const timeZoneSchema = z.string().trim().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
      hour: "2-digit",
    }).format(new Date());
    return true;
  } catch {
    return false;
  }
});

const taskScheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("every-minutes"),
    interval: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("daily-at"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    timeZone: timeZoneSchema.optional(),
  }),
]);

const taskSessionTargetSchema = z.union([
  z.object({
    strategy: z.literal("dedicated").optional(),
  }),
  z.object({
    strategy: z.literal("scope"),
    scope: sessionScopeSchema,
  }),
]);

const taskResultTargetSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("logs"),
  }),
  z.object({
    target: z.literal("discord-dm"),
    userId: trimmedStringSchema,
  }),
  z.object({
    target: z.literal("discord-channel"),
    channelId: trimmedStringSchema,
  }),
]);

const scheduledJobDefinitionSchema = z.object({
  id: trimmedStringSchema,
  prompt: trimmedStringSchema,
  description: optionalTrimmedStringSchema,
  schedule: taskScheduleSchema,
  session: taskSessionTargetSchema.optional(),
  result: taskResultTargetSchema.optional(),
});

const scheduledJobsSchema = z.array(scheduledJobDefinitionSchema);

export function defineScheduledJobs(
  jobs: ScheduledTaskDefinition[],
): ScheduledTaskDefinition[];
export function defineScheduledJobs(
  factory: ScheduledJobsFactory,
): ScheduledJobsFactory;
export function defineScheduledJobs(
  value: ScheduledTaskDefinition[] | ScheduledJobsFactory,
): ScheduledTaskDefinition[] | ScheduledJobsFactory {
  if (typeof value === "function") {
    return async () => {
      return normalizeScheduledJobs(await value(), "defineScheduledJobs()");
    };
  }

  return normalizeScheduledJobs(value, "defineScheduledJobs()");
}

export function normalizeScheduledJobs(
  value: unknown,
  _sourceLabel: string,
): ScheduledTaskDefinition[] {
  return scheduledJobsSchema.parse(value);
}
type ScopedTaskSessionTarget = Extract<TaskSessionTarget, { strategy: "scope" }>;
