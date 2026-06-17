import { z } from "zod";
import type { TaskSessionScope, TaskSessionTarget } from "./types";

const trimmedStringSchema = z.string().trim().min(1);
const dayOfWeekSchema = z.enum([
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
]);
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);

const optionalDaysOfWeekSchema = z
  .array(dayOfWeekSchema)
  .min(1)
  .optional()
  .transform((value) => {
    return value ? Array.from(new Set(value)) : undefined;
  });

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
  z
    .object({
      type: z.literal("every-minutes"),
      interval: z.number().int().positive(),
      timeZone: timeZoneSchema.optional(),
      daysOfWeek: optionalDaysOfWeekSchema,
      startTime: timeOfDaySchema.optional(),
      endTime: timeOfDaySchema.optional(),
    })
    .superRefine((value, ctx) => {
      const hasStartTime = value.startTime !== undefined;
      const hasEndTime = value.endTime !== undefined;

      if (hasStartTime !== hasEndTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "every-minutes schedules must set both startTime and endTime together.",
          path: hasStartTime ? ["endTime"] : ["startTime"],
        });
      }

      if (!hasStartTime || !hasEndTime) {
        return;
      }

      const { startTime, endTime } = value;
      if (!startTime || !endTime) {
        return;
      }

      if (toMinutes(endTime) < toMinutes(startTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "every-minutes schedules require endTime to be greater than or equal to startTime.",
          path: ["endTime"],
        });
      }
    }),
  z.object({
    type: z.literal("daily-at"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    timeZone: timeZoneSchema.optional(),
    daysOfWeek: optionalDaysOfWeekSchema,
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

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
