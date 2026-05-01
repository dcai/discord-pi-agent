/**
 * Transforms markdown tables into Discord-friendly code blocks.
 * Discord doesn't support markdown tables natively, so we:
 * 1. Format the entire document with Prettier (tables get formatted)
 * 2. Use marked Lexer to identify tables
 * 3. Wrap tables in triple backticks
 * 4. Run Prettier once more on the entire result (tables stay formatted in code blocks)
 */

import { Lexer } from "marked";

const CODE_BLOCK_WRAPPER = "```\n{TABLE}\n```";

/**
 * Transforms markdown tables in the text to Discord-friendly code blocks.
 * Uses marked's Lexer to properly identify tables.
 */
export async function transformMarkdownTablesToCodeBlocks(
  text: string,
): Promise<string> {
  // Ensure code fences are on their own lines.
  // AI responses sometimes place ``` at the end of a text line
  // (e.g. "some text.```"). This breaks CommonMark parsing — marked
  // doesn't see it as a fence, and Prettier later "fixes" the resulting
  // unbalanced blocks by adding spurious closing ```.
  const normalized = normalizeCodeFences(text);

  // Format the whole document first (tables are still markdown, so they get formatted)
  const formatted = await formatWithPrettier(normalized);

  // Use marked Lexer to identify tables
  const tokens = Lexer.lex(formatted);
  const result: string[] = [];

  for (const token of tokens) {
    if (token.type === "table") {
      result.push(CODE_BLOCK_WRAPPER.replace("{TABLE}", token.raw.trimEnd()));
    } else {
      result.push(token.raw);
    }
  }

  // Run Prettier once more (tables are now in code blocks, won't be reformatted)
  return formatWithPrettier(result.join(""));
}

/**
 * Moves any ``` that appears at the end of a non-fence line onto its own line.
 * CommonMark requires code fences at line start; Discord's renderer is
 * more lenient, so AI output often has them misplaced.
 */
function normalizeCodeFences(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (trimmed.endsWith("```") && !trimmed.startsWith("```")) {
      const beforeFence = trimmed.slice(0, -3).trimEnd();

      if (beforeFence) {
        result.push(beforeFence);
      }

      result.push("```");
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Formats markdown text using Prettier.
 * Logs on failure.
 */
async function formatWithPrettier(text: string): Promise<string> {
  const prettier = await import("prettier");

  try {
    const formatted = await prettier.format(text, {
      parser: "markdown",
      printWidth: 80,
    });

    return formatted.trim();
  } catch (error) {
    console.error(
      "[markdown-table-transformer] Prettier formatting failed:",
      error,
    );
    return text;
  }
}
