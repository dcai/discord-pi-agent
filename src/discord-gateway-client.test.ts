import { describe, it, expect } from "vitest";
import { buildThreadOpeningPrompt } from "./discord-gateway-client";

describe("buildThreadOpeningPrompt", () => {
  it("combines thread title and body content", () => {
    const result = buildThreadOpeningPrompt(
      "Fix the login bug",
      "Users cannot log in after the deploy.",
    );

    expect(result).toBe(
      "<thread_title>Fix the login bug</thread_title>\n\nUsers cannot log in after the deploy.",
    );
  });

  it("handles empty body content", () => {
    const result = buildThreadOpeningPrompt("Title only", "");

    expect(result).toBe("<thread_title>Title only</thread_title>\n\n");
  });

  it("handles title with special characters", () => {
    const result = buildThreadOpeningPrompt(
      "Bug: 500 error on /api/v1",
      "Stack trace here",
    );

    expect(result).toBe(
      "<thread_title>Bug: 500 error on /api/v1</thread_title>\n\nStack trace here",
    );
  });

  it("preserves newlines in body content", () => {
    const result = buildThreadOpeningPrompt(
      "Multi-line report",
      "Line 1\nLine 2\nLine 3",
    );

    expect(result).toBe(
      "<thread_title>Multi-line report</thread_title>\n\nLine 1\nLine 2\nLine 3",
    );
  });

  it("handles long titles", () => {
    const longTitle = "A".repeat(100);
    const result = buildThreadOpeningPrompt(longTitle, "Body");

    expect(result).toBe(`<thread_title>${longTitle}</thread_title>\n\nBody`);
  });
});
