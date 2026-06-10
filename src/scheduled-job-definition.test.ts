import { describe, expect, it } from "vitest";
import {
  defineScheduledJobs,
  normalizeScheduledJobs,
} from "./scheduled-job-definition";

describe("scheduled-job-definition", () => {
  it("normalizes jobs via defineScheduledJobs array input", () => {
    expect(
      defineScheduledJobs([
        {
          id: "hello-dm",
          prompt: "Say hello",
          schedule: {
            type: "daily-at",
            hour: 19,
            minute: 50,
          },
        },
      ]),
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
        },
        session: undefined,
        result: undefined,
      },
    ]);
  });

  it("normalizes jobs via defineScheduledJobs factory input", async () => {
    const factory = defineScheduledJobs(async () => {
      return [
        {
          id: "heartbeat",
          prompt: "Ping",
          schedule: {
            type: "every-minutes",
            interval: 15,
          },
        },
      ];
    });

    await expect(factory()).resolves.toEqual([
      {
        id: "heartbeat",
        prompt: "Ping",
        description: undefined,
        schedule: {
          type: "every-minutes",
          interval: 15,
        },
        session: undefined,
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
        "defineScheduledJobs()",
      );
    }).toThrow();
  });
});
