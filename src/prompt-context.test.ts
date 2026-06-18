import { afterEach, describe, expect, it } from "vitest";
import { formatDiscordPromptTime } from "./prompt-context";

function withEnv(
  env: Record<string, string | undefined>,
  callback: () => void,
): void {
  const previous = {
    PI_PROMPT_TIME_ZONE: process.env.PI_PROMPT_TIME_ZONE,
    PI_PROMPT_LOCALE: process.env.PI_PROMPT_LOCALE,
  };

  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });

  try {
    callback();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  }
}

afterEach(() => {
  delete process.env.PI_PROMPT_TIME_ZONE;
  delete process.env.PI_PROMPT_LOCALE;
});

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

  it("uses env-backed defaults when options are omitted", () => {
    withEnv(
      {
        PI_PROMPT_TIME_ZONE: "Asia/Bangkok",
        PI_PROMPT_LOCALE: "th-TH",
      },
      () => {
        const fixedDate = new Date("2024-06-15T10:30:00Z");
        const result = formatDiscordPromptTime(fixedDate);
        expect(result).toMatchSnapshot();
      },
    );
  });
});
