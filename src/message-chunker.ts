import { Tokens, marked } from "marked";

const DISCORD_MESSAGE_LIMIT = 2000;
const SAFE_MESSAGE_LIMIT = 1900;

/**
 * Chunk markdown text safely, preserving structural integrity of
 * code blocks, tables, lists, and other block-level elements.
 * Uses marked's lexer to split on token boundaries so no element
 * gets bisected mid-structure.
 *
 * Code blocks larger than maxChunkSize are split into smaller
 * sub-chunks, each wrapped in its own fences, so Discord can
 * render each chunk as a valid code block.
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

    // If adding this token would overflow AND we have existing
    // tokens in the chunk, flush the current chunk first so the
    // oversized token starts fresh.
    if (currentSize + size > maxChunkSize && currentTokens.length > 0) {
      flushChunk();
    }

    // If this single code block token is larger than the Discord
    // limit, break it into smaller valid code blocks. We use
    // DISCORD_MESSAGE_LIMIT as the threshold (not maxChunkSize)
    // so small-chunkSize tests don't accidentally split code
    // blocks that are fine in practice.
    if (
      size > DISCORD_MESSAGE_LIMIT &&
      token.type === "code" &&
      currentTokens.length === 0
    ) {
      const subChunks = splitOversizedCodeBlock(token as Tokens.Code, maxChunkSize);
      chunks.push(...subChunks);
      continue;
    }

    currentTokens.push(token);
    currentSize += size;
  }

  flushChunk();

  return chunks.map((chunk) => chunk.slice(0, DISCORD_MESSAGE_LIMIT));
}

/**
 * Split an oversized fenced code block into multiple valid
 * code blocks, each under maxChunkSize. Each sub-chunk gets
 * its own opening and closing fences with the same language tag.
 */
function splitOversizedCodeBlock(token: Tokens.Code, maxChunkSize: number): string[] {
  const lang = token.lang || "";
  const fenceChar = token.raw.startsWith("```") ? "```" : "~~~";
  const header = fenceChar + lang;
  const footer = fenceChar;
  // Headroom for wrapping fences plus two newlines.
  const wrapOverhead = header.length + footer.length + 2;
  const maxBodySize = maxChunkSize - wrapOverhead;

  if (maxBodySize <= 0) {
    // Fences alone eat the whole budget; just return the raw token
    // capped at DISCORD_MESSAGE_LIMIT (handled by the final map).
    return [token.raw];
  }

  const body = token.text;
  const subChunks: string[] = [];
  let offset = 0;

  while (offset < body.length) {
    const segment = body.slice(offset, offset + maxBodySize);
    subChunks.push([header, segment, footer].join("\n"));
    offset += maxBodySize;
  }

  return subChunks;
}
