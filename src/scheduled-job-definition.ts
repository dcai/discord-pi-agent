import { z } from "zod";
import type { TaskSessionScope, TaskSessionTarget } from "./types";

const trimmedStringSchema = z.string().trim().min(1);

const optionalTrimmedStringSchema = z
  .string()
  .optional()
  .transform((value) => {
    const trimmedValue = value?.trim();
    return trimmedValue ? trimmedValue : undefined;
  });

const sessionScopeSchema = z.custom<TaskSessionScope>((value) => {
  return (
    typeof value === "string" &&
    (value === "dm" || value.startsWith("thread:") || value.startsWith("job:"))
  );
});

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
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
    strategy: z.literal("ephemeral"),
  }),
  z.object({
    strategy: z.enum(["fresh", "reuse"]).optional().default("fresh"),
    scope: sessionScopeSchema.optional(),
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

const taskModelTargetSchema = z.object({
  provider: trimmedStringSchema,
  id: trimmedStringSchema,
});

const scheduledJobDefinitionSchema = z.object({
  id: trimmedStringSchema,
  prompt: trimmedStringSchema,
  description: optionalTrimmedStringSchema,
  schedule: taskScheduleSchema,
  session: taskSessionTargetSchema.optional(),
  model: taskModelTargetSchema.optional(),
  result: taskResultTargetSchema.optional(),
});

const scheduledJobsSchema = z.array(scheduledJobDefinitionSchema);

export function normalizeScheduledJobs(value: unknown, _sourceLabel: string) {
  return scheduledJobsSchema.parse(value).map((job) => {
    return {
      ...job,
      session: normalizeTaskSessionTarget(job.session),
    };
  });
}

function normalizeTaskSessionTarget(
  session: TaskSessionTarget | undefined,
): TaskSessionTarget | undefined {
  if (!session) {
    return undefined;
  }

  if (session.strategy === "ephemeral") {
    return session;
  }

  return {
    strategy: session.strategy ?? "fresh",
    ...(session.scope ? { scope: session.scope } : {}),
  };
}
