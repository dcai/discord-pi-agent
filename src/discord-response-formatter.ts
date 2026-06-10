/**
 * Transforms markdown tables into Discord-friendly code blocks.
 * Discord doesn't support markdown tables natively, so we:
 * 1. Format the entire document with Prettier (tables get formatted)
 * 2. Use marked Lexer to identify tables
 * 3. Wrap tables in triple backticks
 * 4. Run Prettier once more on the entire result (tables stay formatted in code blocks)
 */

import { Lexer } from "marked";
import { createModuleLogger } from "./logger";

const logger = createModuleLogger("discord-response-formatter");

const CODE_BLOCK_WRAPPER = "```\n{TABLE}\n```";

/**
 * Transforms markdown tables in the text to Discord-friendly code blocks.
 * Uses marked's Lexer to properly identify tables.
 */
export async function formatResponseForDiscord(
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
 * Normalizes misplaced code fences so CommonMark parsers handle them correctly.
 * AI output often has ``` in positions that Discord renders fine but break
 * standard markdown parsing:
 *
 *   1. "some text.```"       → fence at end of text line → split to own line
 *   2. "some text.```text"   → inline opening fence → split before the fence
 *   3. "```some text"        → fence at start with text after → split to own line
 *
 * Without this, Prettier may "fix" unbalanced fences by adding spurious ```.
 */
function normalizeCodeFences(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const inlineFenceIndex = findInlineFenceIndex(trimmed);

    // Case 1/2: fence appears mid-line after prose.
    // "hello world.```" → split before bare fence.
    // "hello world.```text" → split before valid opening fence with info string.
    if (inlineFenceIndex !== -1) {
      const beforeFence = trimmed.slice(0, inlineFenceIndex).trimEnd();
      const fenceAndAfter = trimmed.slice(inlineFenceIndex);

      if (beforeFence) {
        result.push(beforeFence);
      }

      if (isValidFenceLine(fenceAndAfter)) {
        result.push(fenceAndAfter);
      } else {
        result.push("```");
        const afterFence = fenceAndAfter.slice(3).trimStart();

        if (afterFence) {
          result.push(afterFence);
        }
      }
      // Case 3: fence at start with trailing text that is NOT a valid info string.
      // "```java" → keep as-is (info string). "```修正了" → split (prose text).
    } else if (trimmed.startsWith("```") && !isValidFenceLine(trimmed)) {
      result.push("```");
      const afterFence = trimmed.slice(3).trimStart();

      if (afterFence) {
        result.push(afterFence);
      }
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

function findInlineFenceIndex(line: string): number {
  const firstFenceIndex = line.indexOf("```");

  if (firstFenceIndex <= 0) {
    return -1;
  }

  const nextFenceIndex = line.indexOf("```", firstFenceIndex + 3);

  if (nextFenceIndex !== -1) {
    return -1;
  }

  return firstFenceIndex;
}

/**
 * Returns true if the line looks like a valid CommonMark code fence.
 *
 * Valid fences:
 *   ```          (bare fence)
 *   ```java      (info string)
 *   ```c++       (unusual but valid info string)
 *   ```diff:ts   (colon-separated directive)
 *
 * We only split when the content after ``` looks like prose —
 * starts with a non-ASCII character (e.g., Chinese text),
 * or the first "word" has multiple space-separated pieces.
 */
function isValidFenceLine(line: string): boolean {
  const trimmed = line.trimEnd();

  // Bare fence: ```
  if (trimmed === "```") {
    return true;
  }

  const afterFence = trimmed.slice(3);

  if (!afterFence) {
    return true;
  }

  // If it starts with a non-ASCII character, it's prose (e.g. ```修正了)
  // ASCII range: 0x00-0x7F
  if (afterFence.codePointAt(0)! > 0x7f) {
    return false;
  }

  // Info strings are a single non-whitespace token per CommonMark spec.
  // If there's more than one token, it's prose (e.g. ```this is prose).
  // Trailing whitespace like "```java  " is fine — trimEnd already handled.
  const tokens = afterFence.trimStart().split(/\s+/);

  if (tokens.length > 1) {
    return false;
  }

  // The token must not contain a backtick (would break the fence)
  if (tokens[0].includes("`")) {
    return false;
  }

  return true;
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
    logger.error(
      {
        error,
      },
      "Prettier formatting failed",
    );
    return text;
  }
}
