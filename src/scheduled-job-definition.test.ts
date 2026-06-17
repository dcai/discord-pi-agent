import { describe, expect, it } from "vitest";
import { normalizeScheduledJobs } from "./scheduled-job-definition";

describe("scheduled-job-definition", () => {
  it("normalizes scheduled jobs", () => {
    expect(
      normalizeScheduledJobs(
        [
          {
            id: "hello-dm",
            prompt: "Say hello",
            schedule: {
              type: "daily-at",
              hour: 19,
              minute: 50,
              daysOfWeek: ["mon", "wed", "fri", "fri"],
            },
            model: {
              provider: "openrouter",
              id: "anthropic/claude-sonnet-4",
            },
          },
        ],
        "scheduled-jobs.ts",
      ),
    ).toEqual([
      {
        id: "hello-dm",
        prompt: "Say hello",
        description: undefined,
        schedule: {
          type: "daily-at",
          hour: 19,
          minute: 50,
          timeZone: undefined,
          daysOfWeek: ["mon", "wed", "fri"],
        },
        model: {
          provider: "openrouter",
          id: "anthropic/claude-sonnet-4",
        },
        session: undefined,
        result: undefined,
      },
    ]);
  });

  it("normalizes constrained every-minutes schedules", () => {
    expect(
      normalizeScheduledJobs(
        [
          {
            id: "weekday-heartbeat",
            prompt: "Check the queue",
            schedule: {
              type: "every-minutes",
              interval: 60,
              timeZone: "Australia/Sydney",
              daysOfWeek: ["mon", "tue", "wed", "thu", "fri", "fri"],
              startTime: "09:00",
              endTime: "22:00",
            },
          },
        ],
        "scheduled-jobs.ts",
      ),
    ).toEqual([
      {
        id: "weekday-heartbeat",
        prompt: "Check the queue",
        description: undefined,
        schedule: {
          type: "every-minutes",
          interval: 60,
          timeZone: "Australia/Sydney",
          daysOfWeek: ["mon", "tue", "wed", "thu", "fri"],
          startTime: "09:00",
          endTime: "22:00",
        },
        session: undefined,
        result: undefined,
      },
    ]);
  });

  it("accepts explicit session strategies for a job", () => {
    expect(
      normalizeScheduledJobs(
        [
          {
            id: "reuse-session",
            prompt: "Reuse the running session",
            schedule: {
              type: "every-minutes",
              interval: 10,
            },
            session: {
              strategy: "reuse",
              scope: "dm",
            },
          },
          {
            id: "ephemeral-session",
            prompt: "Run once in memory",
            schedule: {
              type: "every-minutes",
              interval: 30,
            },
            session: {
              strategy: "ephemeral",
            },
          },
        ],
        "scheduled-jobs.ts",
      ),
    ).toEqual([
      {
        id: "reuse-session",
        prompt: "Reuse the running session",
        description: undefined,
        schedule: {
          type: "every-minutes",
          interval: 10,
        },
        session: {
          strategy: "reuse",
          scope: "dm",
        },
        result: undefined,
      },
      {
        id: "ephemeral-session",
        prompt: "Run once in memory",
        description: undefined,
        schedule: {
          type: "every-minutes",
          interval: 30,
        },
        session: {
          strategy: "ephemeral",
        },
        result: undefined,
      },
    ]);
  });

  it("throws clear validation errors for bad definitions", () => {
    expect(() => {
      normalizeScheduledJobs(
        [
          {
            id: "broken",
            prompt: "oops",
            schedule: {
              type: "daily-at",
              hour: 30,
              minute: 0,
            },
          },
        ],
        "scheduled-jobs.ts",
      );
    }).toThrow();
  });

  it("rejects unknown daysOfWeek values", () => {
    expect(() => {
      normalizeScheduledJobs(
        [
          {
            id: "weekday-summary",
            prompt: "Summarize the workday",
            schedule: {
              type: "daily-at",
              hour: 9,
              minute: 0,
              daysOfWeek: ["weekday"],
            },
          },
        ],
        "scheduled-jobs.ts",
      );
    }).toThrow();
  });

  it("rejects every-minutes schedules with partial or inverted time windows", () => {
    expect(() => {
      normalizeScheduledJobs(
        [
          {
            id: "windowed-heartbeat",
            prompt: "Check the queue",
            schedule: {
              type: "every-minutes",
              interval: 60,
              startTime: "09:00",
            },
          },
        ],
        "scheduled-jobs.ts",
      );
    }).toThrow(
      "every-minutes schedules must set both startTime and endTime together.",
    );

    expect(() => {
      normalizeScheduledJobs(
        [
          {
            id: "windowed-heartbeat",
            prompt: "Check the queue",
            schedule: {
              type: "every-minutes",
              interval: 60,
              startTime: "22:00",
              endTime: "09:00",
            },
          },
        ],
        "scheduled-jobs.ts",
      );
    }).toThrow(
      "every-minutes schedules require endTime to be greater than or equal to startTime.",
    );
  });
});
