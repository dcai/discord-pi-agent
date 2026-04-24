import { describe, it, expect } from "vitest";
import { chunkMessage } from "./message-chunker";

describe("chunkMessage", () => {
  // ── No chunking needed ──────────────────────────────────────────

  it("returns single-element array when text is under the limit", () => {
    const result = chunkMessage("short message", 100);
    expect(result).toMatchSnapshot();
  });

  it("handles empty string", () => {
    const result = chunkMessage("", 100);
    expect(result).toMatchSnapshot();
  });

  // ── Basic paragraph chunking ────────────────────────────────────

  it("splits long text at paragraph boundaries", () => {
    const text = [
      "First paragraph of text here.",
      "",
      "Second paragraph is also here with more words.",
      "",
      "Third paragraph continues the story further along.",
    ].join("\n");

    // chunkSize=60 means each paragraph (30-50 chars) forces a split
    const result = chunkMessage(text, 60);
    expect(result).toMatchSnapshot();
  });

  it("splits consecutive paragraphs with no blank lines between them", () => {
    const text = [
      "This is alpha content right here.",
      "This is beta content right here too.",
      "This is gamma content as well mate.",
    ].join("\n");

    const result = chunkMessage(text, 70);
    expect(result).toMatchSnapshot();
  });

  // ── Code blocks stay intact ─────────────────────────────────────

  it("never splits inside a fenced code block", () => {
    const text = [
      "Some intro text before the code block.",
      "",
      "```js",
      "function fibonacci(n) {",
      "  if (n <= 1) return n;",
      "  return fibonacci(n - 1) + fibonacci(n - 2);",
      "}",
      "```",
      "",
      "Some outro text after the code block.",
    ].join("\n");

    // chunkSize=80 — the code block is ~120 chars, so it'll be its own chunk
    const result = chunkMessage(text, 80);
    expect(result).toMatchSnapshot();

    // Verify code block is intact in whichever chunk it appears
    const flat = result.join("\n");
    expect(flat).toContain("```js\nfunction fibonacci(n) {");
    expect(flat).toContain("  return fibonacci(n - 1) + fibonacci(n - 2);");
  });

  it("never splits inside a tilde-fenced code block", () => {
    const text = [
      "Before the code.",
      "",
      "~~~python",
      "def greet(name):",
      '    return f"Hello, {name}!"',
      "~~~",
      "",
      "After the code.",
    ].join("\n");

    const result = chunkMessage(text, 60);
    expect(result).toMatchSnapshot();

    const flat = result.join("\n");
    expect(flat).toContain("~~~python\ndef greet(name):");
  });

  // ── Tables stay intact ──────────────────────────────────────────

  it("never splits inside a markdown table", () => {
    const text = [
      "Here is a data table:",
      "",
      "| Name   | Role     | Score |",
      "|--------|----------|-------|",
      "| Bender | Assassin | 9001  |",
      "| Fry    | Delivery | 42    |",
      "| Leela  | Captain  | 1337  |",
      "",
      "End of report.",
    ].join("\n");

    // chunkSize=100 — the table (~180 chars) spans across but stays together
    const result = chunkMessage(text, 100);
    expect(result).toMatchSnapshot();

    const flat = result.join("\n");
    expect(flat).toContain("| Fry    | Delivery | 42    |");
    expect(flat).toContain("| Leela  | Captain  | 1337  |");
  });

  // ── Lists stay intact ───────────────────────────────────────────

  it("never splits inside an ordered list", () => {
    const text = [
      "Steps to follow:",
      "",
      "1. First you take the peanuts and you crush 'em.",
      "2. Then you take the crushed peanuts and you spread 'em.",
      "3. Finally you present the spread peanuts with flair.",
      "",
      "That's the recipe.",
    ].join("\n");

    const result = chunkMessage(text, 80);
    expect(result).toMatchSnapshot();
  });

  it("never splits inside an unordered list", () => {
    const text = [
      "Shopping list:",
      "",
      "- Bender brand motor oil",
      "- Assorted nuts and bolts",
      "- One (1) blackjack deck",
      "- A healthy disregard for authority",
      "",
      "Budget: 0.",
    ].join("\n");

    const result = chunkMessage(text, 90);
    expect(result).toMatchSnapshot();
  });

  // ── Blockquotes stay intact ─────────────────────────────────────

  it("never splits inside a blockquote", () => {
    const text = [
      "Someone once said:",
      "",
      "> Bite my shiny metal",
      "> posterior, you meatbag.",
      ">",
      "> — Bender B. Rodriguez",
      "",
      "Truly inspiring.",
    ].join("\n");

    const result = chunkMessage(text, 70);
    expect(result).toMatchSnapshot();
  });

  // ── Headings stay attached to their content ─────────────────────

  it("keeps heading token intact", () => {
    const text = [
      "# Introduction",
      "",
      "Welcome to the guide. This section covers the basics of bending things.",
      "",
      "## Advanced Topics",
      "",
      "Now we get into the really bending stuff. More details and context here.",
      "",
      "### Edge Cases",
      "",
      "Finally, the weird stuff that nobody documents but everyone hits.",
    ].join("\n");

    const result = chunkMessage(text, 100);
    expect(result).toMatchSnapshot();
  });

  // ── Large single token ──────────────────────────────────────────

  it("does not split a single oversized token (code block bigger than limit)", () => {
    const giantCodeBlock = [
      "```json",
      '{ "name": "Bender", "occupation": "Bending", "quote": "Bite my shiny metal ass", "id": 2716057 }',
      "```",
    ].join("\n");

    const result = chunkMessage(giantCodeBlock, 50);
    expect(result).toMatchSnapshot();

    // The code block should appear intact in one chunk
    expect(result.length).toBe(1);
    expect(result[0]).toContain("```json");
    expect(result[0]).toContain("```");
  });

  // ── Mixed content ───────────────────────────────────────────────

  it("handles mixed markdown with code, tables, and paragraphs", () => {
    const text = [
      "# System Report",
      "",
      "System diagnostics completed successfully.",
      "",
      "## Metrics",
      "",
      "| Metric    | Value  | Status |",
      "|-----------|--------|--------|",
      "| CPU       | 23%    | OK     |",
      "| Memory    | 67%    | WARN   |",
      "| Disk      | 12%    | OK     |",
      "",
      "## Code Sample",
      "",
      "```ts",
      "const status = metrics.every((m) => m.status === 'OK');",
      "console.log(status ? 'All good' : 'Issues detected');",
      "```",
      "",
      "## Recommendations",
      "",
      "> Memory usage is elevated but within acceptable range.",
      "> Monitor over the next 24 hours.",
    ].join("\n");

    const result = chunkMessage(text, 150);
    expect(result).toMatchSnapshot();

    // Spot-check structural integrity
    const flat = result.join("\n");
    expect(flat).toContain("```ts");
    expect(flat).toContain("```");
    expect(flat).toContain("| Disk      | 12%    | OK     |");
    expect(flat).toContain("> Memory usage is elevated");
  });

  // ── Default limit ───────────────────────────────────────────────

  it("uses SAFE_MESSAGE_LIMIT (1900) when no maxChunkSize is provided", () => {
    // Text just under 1900 chars should stay as one chunk
    const text = "x".repeat(1899);
    const result = chunkMessage(text);
    expect(result.length).toBe(1);
    expect(result).toMatchSnapshot();
  });

  // ── DISCORD_MESSAGE_LIMIT cap ───────────────────────────────────

  it("caps each chunk at DISCORD_MESSAGE_LIMIT (2000)", () => {
    // Single paragraph token of 2500 chars, maxChunkSize=2100 triggers
    // token-level path. The paragraph won't split (single token),
    // but the final .slice(0, 2000) caps it.
    const text = "A".repeat(2500);
    const result = chunkMessage(text, 2100);
    expect(result.length).toBe(1);
    expect(result[0].length).toBeLessThanOrEqual(2000);
    expect(result).toMatchSnapshot();
  });
});
