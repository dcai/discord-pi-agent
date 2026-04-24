import { Lexer } from "marked";

const DISCORD_MESSAGE_LIMIT = 2000;
const SAFE_MESSAGE_LIMIT = 1900;

export function chunkMessage(text: string): string[] {
  if (text.length <= SAFE_MESSAGE_LIMIT) {
    return [text];
  }

  const codeBlockRanges = getCodeBlockRanges(text);
  const chunks: string[] = [];
  let offset = 0;
  let remaining = text;

  while (remaining.length > SAFE_MESSAGE_LIMIT) {
    const candidate = remaining.slice(0, SAFE_MESSAGE_LIMIT);
    const splitIndex = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf(" "),
    );
    const relBoundary = splitIndex > 0 ? splitIndex : SAFE_MESSAGE_LIMIT;
    const absBoundary = adjustBoundaryForCodeBlock(
      offset + relBoundary,
      codeBlockRanges,
    );
    const boundary = absBoundary - offset;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
    offset = absBoundary;
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.slice(0, DISCORD_MESSAGE_LIMIT));
}

type CodeBlockRange = { start: number; end: number };

/**
 * Use marked's Lexer to find the character positions of all code blocks
 * in the full text. This is more robust than manual ``` counting since
 * marked handles edge cases like indented code blocks and inline backticks.
 */
function getCodeBlockRanges(text: string): CodeBlockRange[] {
  const tokens = Lexer.lex(text);
  const ranges: CodeBlockRange[] = [];
  let pos = 0;
  for (const token of tokens) {
    if (token.type === "code") {
      ranges.push({ start: pos, end: pos + token.raw.length });
    }
    pos += token.raw.length;
  }
  return ranges;
}

/**
 * If the boundary falls inside a code block, advance it past the block's end
 * so the block stays intact in one message.
 *
 * Falls back to the original boundary if the code block is too large to fit
 * in a single Discord message (Discord will still reject messages over 2000,
 * so a broken block is better than a dropped message).
 */
function adjustBoundaryForCodeBlock(
  absBoundary: number,
  codeBlockRanges: CodeBlockRange[],
): number {
  for (const range of codeBlockRanges) {
    if (absBoundary > range.start && absBoundary < range.end) {
      if (range.end <= DISCORD_MESSAGE_LIMIT) {
        return range.end;
      }
      return absBoundary;
    }
  }
  return absBoundary;
}
