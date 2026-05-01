import { describe, expect, it } from "vitest";
import { transformMarkdownTablesToCodeBlocks } from "./markdown-table-transformer";

describe("markdown-table-transformer", () => {
  describe("transformMarkdownTablesToCodeBlocks", () => {
    it("should wrap and format a basic table", async () => {
      const input = `| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should return text unchanged if no tables", async () => {
      const input = "No tables here, just text.";

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should handle tables with varying column widths", async () => {
      const input = `| Short | Very Long Header |
|-------|------------------|
| A | B |`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should handle tables with text alignment (left, center, right)", async () => {
      const input = `| Left | Center | Right |
|:-----|:------:|------:|
| Alice | 30 | NYC |
| Bob | 25 | LA |`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should handle tables with text formatting in cells", async () => {
      const input = `| Feature | Status | Code |
|---------|--------|------|
| **Bold** | Active | \`true\` |
| *Italic* | Pending | \`false\` |
| [Link](https://example.com) | Done | \`const\` |`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should handle multiple tables in same document", async () => {
      const input = `Here is the first table:

| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |

And the second table:

| City | Country |
|------|---------|
| NYC | USA |
| London | UK |`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should handle table with text before and after", async () => {
      const input = `## Monthly Report

Check out this data:

| Month | Savings |
|-------|---------|
| January | $250 |
| February | $80 |
| March | $420 |

Total savings are looking good!`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should handle table with empty cells", async () => {
      const input = `| Name | Age | City |
|------|-----|------|
| Alice | 30 | |
| | 25 | NYC |
| Bob | | LA |`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should handle table with pipe escaped in cells", async () => {
      const input = `| Command | Description |
|---------|-------------|
| \`&#124;\` | Escaped pipe |
| \`a &#124; b\` | Pipe in expression |`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should handle complex table with all features", async () => {
      const input = `# Product Inventory

Below is our **inventory status**:

| Product | Price | Alignment | Notes |
|---------|-------|:---------:|-------|
| Python Hat | $23.99 | Left | *In stock* |
| SQL Hat | $23.99 | Center | [View](url) |
| Codecademy Hoodie | $42.99 | Right | \`SALE\` |

Contact us for more info.`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      expect(result).toMatchSnapshot();
    });

    it("should normalize misplaced code fences at end of text lines", async () => {
      // Real AI output: first ``` is at end of a paragraph line, not on its own.
      // Discord renders this fine, but CommonMark parsers (marked + Prettier)
      // require fences at line start, which causes spurious closing ```.
      const input = `Wait, let me fix the calories — 220 + 200 + 104 = 524, not 450.\`\`\`
Day         1 May 2026
Breakfast   381 kcal   Lebanese bread + 2 cheddar
Lunch       524 kcal   Glass noodle spinach salad + 2 eggs + tuna 90g
---------------------------------------
Intake      905 kcal
Burn        0 kcal
Net         905 kcal
Deficit     1,095 kcal
\`\`\`

\`\`\`
Protein     ~50g ✅   Eggs + tuna covered the missing eggs from breakfast
Iron        ~5mg      No red meat today but eggs + spinach help
Omega-3     ✅        Tuna
\`\`\`

Smart move — eggs came back at lunch to make up for the missing breakfast protein. 1,095 kcal deficit with plenty of evening left. Any pickleball plans today?`;

      const result = await transformMarkdownTablesToCodeBlocks(input);

      // Must not contain a spurious trailing ```
      expect(result).not.toMatch(/\n```\s*$/);
      expect(result).toMatchSnapshot();
    });
  });
});
