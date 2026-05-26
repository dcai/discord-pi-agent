export type DiscordPromptTimeFormatOptions = {
  timeZone?: string;
  locale?: string;
};

export function formatDiscordPromptTime(
  date: Date,
  options: DiscordPromptTimeFormatOptions = {},
): string {
  const timeZone = options.timeZone || "UTC";
  const locale = options.locale || "en-AU";

  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}

/** Wrap content in an XML-style tag: `<tag>content</tag>`. */
export function wrapXmlTag(tag: string, content: string): string {
  return `<${tag}>${content}</${tag}>`;
}

