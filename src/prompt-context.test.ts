import { describe, expect, it } from "vitest";
import { formatDiscordPromptTime } from "./prompt-context";

describe("formatDiscordPromptTime", () => {
  it("formats time with default options (UTC, en-AU)", () => {
    const fixedDate = new Date("2024-06-15T10:30:00Z");
    const result = formatDiscordPromptTime(fixedDate);
    expect(result).toMatchSnapshot();
  });

  it("formats time with custom timezone and locale", () => {
    const fixedDate = new Date("2024-12-25T18:45:00Z");
    const result = formatDiscordPromptTime(fixedDate, {
      timeZone: "Asia/Tokyo",
      locale: "ja-JP",
    });
    expect(result).toMatchSnapshot();
  });
});

