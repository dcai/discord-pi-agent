import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildTimeContextPrompt } from "./prompt-context";

describe("buildTimeContextPrompt", () => {
  it("should format time context with default options (UTC, en-AU)", () => {
    const fixedDate = new Date("2024-06-15T10:30:00Z");
    const result = buildTimeContextPrompt("Hello world", { now: fixedDate });
    expect(result).toMatchSnapshot();
  });

  it("should format time context with custom timezone", () => {
    const fixedDate = new Date("2024-06-15T10:30:00Z");
    const result = buildTimeContextPrompt("Test message", {
      now: fixedDate,
      timeZone: "America/New_York",
    });
    expect(result).toMatchSnapshot();
  });

  it("should format time context with custom locale", () => {
    const fixedDate = new Date("2024-06-15T10:30:00Z");
    const result = buildTimeContextPrompt("Bonjour", {
      now: fixedDate,
      locale: "fr-FR",
    });
    expect(result).toMatchSnapshot();
  });

  it("should format time context with both custom timezone and locale", () => {
    const fixedDate = new Date("2024-12-25T18:45:00Z");
    const result = buildTimeContextPrompt("Greetings", {
      now: fixedDate,
      timeZone: "Asia/Tokyo",
      locale: "ja-JP",
    });
    expect(result).toMatchSnapshot();
  });

  it("should handle empty message string", () => {
    const fixedDate = new Date("2024-06-15T10:30:00Z");
    const result = buildTimeContextPrompt("", { now: fixedDate });
    expect(result).toMatchSnapshot();
  });

  it("should trim whitespace from user message", () => {
    const fixedDate = new Date("2024-06-15T10:30:00Z");
    const result = buildTimeContextPrompt("  Spaces around  ", {
      now: fixedDate,
    });
    expect(result).toMatchSnapshot();
  });

  it("should handle multi-line message", () => {
    const fixedDate = new Date("2024-06-15T10:30:00Z");
    const multilineMessage = "Line one\nLine two\nLine three";
    const result = buildTimeContextPrompt(multilineMessage, { now: fixedDate });
    expect(result).toMatchSnapshot();
  });

  it("should use current time when now is not provided", () => {
    const fixedDate = new Date("2024-06-15T10:30:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);
    const result = buildTimeContextPrompt("Hello");
    expect(result).toMatchSnapshot();
    vi.useRealTimers();
  });
});
