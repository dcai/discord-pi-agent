import { describe, expect, it } from "vitest";
import {
  buildDiscordMessageContextPrompt,
  formatDiscordPromptTime,
} from "./prompt-context";

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

describe("buildDiscordMessageContextPrompt", () => {
  it("builds a DM prompt with stable Discord metadata", () => {
    const result = buildDiscordMessageContextPrompt("  Hello there  ", {
      scope: "dm",
      sentAt: "2026-05-07T04:30:00.000Z",
      sentAtLocal: "Thu, 7 May 26, 14:30 AEST",
      messageId: "message-123",
      authorId: "user-456",
      authorName: "Alice",
    });

    expect(result).toMatchSnapshot();
  });

  it("builds a thread prompt with thread metadata", () => {
    const result = buildDiscordMessageContextPrompt("Can you check this?", {
      scope: "thread",
      sentAt: "2026-05-07T04:31:00.000Z",
      sentAtLocal: "Thu, 7 May 26, 14:31 AEST",
      messageId: "message-789",
      authorId: "user-456",
      authorName: "Alice",
      threadId: "thread-123",
      threadTitle: "Fix deploy bug",
      forumChannelId: "forum-999",
    });

    expect(result).toMatchSnapshot();
  });

  it("normalizes user-controlled metadata whitespace", () => {
    const result = buildDiscordMessageContextPrompt("Body", {
      scope: "thread",
      messageId: "message-789",
      authorId: "user-456",
      authorName: "Alice\nAdmin",
      threadTitle: "Fix\nDeploy\tBug",
    });

    expect(result).toMatchSnapshot();
  });
});
