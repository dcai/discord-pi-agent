/**
 * Print a text body to stdout with ASCII fences.
 * Useful for ad-hoc debug output that stands out in logs.
 *
 * @param body  The text content to print.
 * @param title Optional label for the opening fence (defaults to "DEBUG").
 */
export function debugPrint(body: string, title?: string): void {
  const label = title ?? "DEBUG";
  const fence = "=".repeat(label.length + 12);

  console.info(`${fence}\n===== ${label} =====\n${fence}`);
  console.info(body);
  console.info(`${fence}\n===== END =====\n${fence}`);
}
