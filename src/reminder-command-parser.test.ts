import { describe, expect, it } from "vitest";
import { parseReminderCommand } from "./reminder-command-parser";

describe("parseReminderCommand", () => {
  it("parses a reminder request with a timezone-aware reference date", async () => {
    await expect(
      parseReminderCommand({
        input: "tomorrow 14:00, check what is aapl's latest share price",
        now: new Date("2026-06-10T10:57:20.984Z"),
        timeZone: "Australia/Sydney",
      }),
    ).resolves.toEqual({
      runAt: "2026-06-11T04:00:00.000Z",
      prompt: "check what is aapl's latest share price",
      description: "check what is aapl's latest share price",
    });
  });

  it("throws when the request does not include both time and task parts", async () => {
    await expect(
      parseReminderCommand({
        input: "remind me sometime tomorrow",
        now: new Date("2026-06-10T10:57:20.984Z"),
        timeZone: "Australia/Sydney",
      }),
    ).rejects.toThrow(
      "Reminder format is `!remind <when>, <what you want to be reminded about>`.",
    );
  });
});
