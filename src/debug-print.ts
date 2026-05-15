/**
 * Print a text body to stdout with ASCII fences.
 * Useful for ad-hoc debug output that stands out in logs.
 *
 * @param body  The text content to print.
 * @param title Optional label for the opening fence (defaults to "DEBUG").
 */
export function debugPrint(body: string, title?: string): void {
  const WIDTH = 80;
  const label = title ?? "DEBUG";

  function centeredFence(text: string): string {
    const inner = ` ${text} `;
    const padLen = Math.floor((WIDTH - inner.length) / 2);
    const pad = "=".repeat(padLen);
    const result = pad + inner + pad;
    // tack on one extra "=" if the width is odd
    return result.length < WIDTH ? result + "=" : result;
  }

  console.info(centeredFence(label));
  console.info(body);
  console.info(centeredFence(`${label} END`));
}
