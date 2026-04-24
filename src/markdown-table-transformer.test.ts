import { describe, expect, it } from "vitest";
import {
  transformMarkdownTablesToCodeBlocks,
  transformMarkdownTablesSync,
} from "./markdown-table-transformer";

describe("markdown-table-transformer", () => {
  describe("transformMarkdownTablesSync", () => {
    it("should wrap a single table in code blocks", () => {
      const input = `Here is a table:

| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |

And some text after.`;

      const result = transformMarkdownTablesSync(input);

      expect(result).toContain("```\n| Name | Age |");
      expect(result).toContain("| Alice | 30 |");
      expect(result).toContain("```");
    });

    it("should not modify text without tables", () => {
      const input = "This is just plain text without any table.";

      const result = transformMarkdownTablesSync(input);

      expect(result).toBe(input);
    });

    it("should handle multiple tables", () => {
      const input = `| A | B |
|---|---|
| 1 | 2 |

Some text

| C | D |
|---|---|
| 3 | 4 |`;

      const result = transformMarkdownTablesSync(input);

      // Should have 2 code blocks (2 opening + 2 closing = 4 backtick triplets)
      const codeBlockDelimiters = result.match(/```/g);
      expect(codeBlockDelimiters?.length).toBe(4);
    });
  });

  describe("transformMarkdownTablesToCodeBlocks", () => {
    it("should wrap and format a table with Prettier", async () => {
      const input = `| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toContain("```\n");
      expect(result).toContain("```");
      // Prettier formats markdown tables nicely
      expect(result).toContain("|");
    });

    it("should return text unchanged if no tables", async () => {
      const input = "No tables here, just text.";

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toBe(input);
    });

    it("should handle tables with varying column widths", async () => {
      const input = `| Short | Very Long Header |
|-------|------------------|
| A | B |`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toContain("```\n");
      // Should be formatted with proper alignment
      expect(result).toContain("|");
    });
  });
});
