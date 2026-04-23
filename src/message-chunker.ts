const DISCORD_MESSAGE_LIMIT = 2000;
const SAFE_MESSAGE_LIMIT = 1900;

export function chunkMessage(text: string): string[] {
  if (text.length <= SAFE_MESSAGE_LIMIT) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > SAFE_MESSAGE_LIMIT) {
    const candidate = remaining.slice(0, SAFE_MESSAGE_LIMIT);
    const splitIndex = Math.max(
      candidate.lastIndexOf("\n\n"),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf(" "),
    );
    const boundary = splitIndex > 0 ? splitIndex : SAFE_MESSAGE_LIMIT;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => chunk.slice(0, DISCORD_MESSAGE_LIMIT));
}
