import { describe, expect, it } from "vitest";
import { chunkMessage } from "./message-chunker";

describe("chunkMessage", () => {
  it("returns single chunk for short text", () => {
    const result = chunkMessage("hello world");
    expect(result).toEqual(["hello world"]);
  });

  it("splits long text at natural boundaries", () => {
    // Build a message that's > 1900 chars with clear paragraph breaks
    const para = "A".repeat(500);
    const text = [para, para, para, para, para].join("\n\n");
    const result = chunkMessage(text);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    // Reassembled text should match (trim differences aside)
    const reassembled = result.join("\n\n");
    expect(reassembled).toBe(text);
  });

  it("keeps code blocks intact when boundary falls inside one", () => {
    // 1800 chars of preamble, then a code block, then after
    const preamble = "A".repeat(1800);
    const codeBlock = "```typescript\nconst x = 1;\nconst y = 2;\n```";
    const after = "\n\n" + "B".repeat(500);
    const text = preamble + "\n\n" + codeBlock + after;

    const result = chunkMessage(text);

    // Some chunk must contain the complete code block
    const fullText = result.join("\n");
    expect(fullText).toContain(codeBlock);

    // No chunk should contain an unbalanced ``` count
    for (const chunk of result) {
      const fenceCount = chunk.split("\n").filter((line) => {
        return line.trimStart().startsWith("```");
      }).length;
      expect(fenceCount % 2).toBe(0);
    }
  });

  it("handles oversized code block gracefully", () => {
    // A code block that's 2100 chars (> DISCORD_MESSAGE_LIMIT)
    const preamble = "A".repeat(1900);
    const hugeCode = "```\n" + "x".repeat(2100) + "\n```";
    const text = preamble + "\n\n" + hugeCode;

    const result = chunkMessage(text);

    // Still produces chunks (doesn't crash), all within limit
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });
});
