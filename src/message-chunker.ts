import { Tokens, marked } from "marked";

const DISCORD_MESSAGE_LIMIT = 2000;
const SAFE_MESSAGE_LIMIT = 1900;

/**
 * Chunk markdown text safely, preserving structural integrity of
 * code blocks, tables, lists, and other block-level elements.
 * Uses marked's lexer to split on token boundaries so no element
 * gets bisected mid-structure.
 */
export function chunkMessage(
  text: string,
  maxChunkSize: number = SAFE_MESSAGE_LIMIT,
): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const tokens = marked.lexer(text);
  const chunks: string[] = [];
  let currentTokens: Tokens.Generic[] = [];
  let currentSize = 0;

  const flushChunk = () => {
    if (currentTokens.length > 0) {
      chunks.push(
        currentTokens
          .map((t) => t.raw)
          .join("")
          .trim(),
      );
      currentTokens = [];
      currentSize = 0;
    }
  };

  for (const token of tokens) {
    const size = token.raw.length;

    if (currentSize + size > maxChunkSize && currentTokens.length > 0) {
      flushChunk();
    }

    currentTokens.push(token);
    currentSize += size;
  }

  flushChunk();

  return chunks.map((chunk) => chunk.slice(0, DISCORD_MESSAGE_LIMIT));
}
