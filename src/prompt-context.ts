export type DiscordPromptTimeFormatOptions = {
  timeZone?: string;
  locale?: string;
};

export type DiscordPromptScope = "dm" | "thread";

export type DiscordMessageContextPromptOptions = {
  scope: DiscordPromptScope;
  messageId: string;
  authorId: string;
  sentAt?: string;
  sentAtLocal?: string;
  authorName?: string;
  threadId?: string;
  threadTitle?: string;
  forumChannelId?: string | null;
};

export function buildDiscordMessageContextPrompt(
  userMessage: string,
  options: DiscordMessageContextPromptOptions,
): string {
  const contextEntries = [
    ["scope", options.scope],
    ["sent_at", options.sentAt],
    ["sent_at_local", options.sentAtLocal],
    ["message_id", options.messageId],
    ["author_name", normalizeContextValue(options.authorName)],
    ["author_id", options.authorId],
    ["thread_title", normalizeContextValue(options.threadTitle)],
    ["thread_id", options.threadId],
    ["forum_channel_id", options.forumChannelId ?? undefined],
  ].filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string" && entry[1].trim().length > 0;
  });

  const contextJson = JSON.stringify(
    Object.fromEntries(contextEntries),
    null,
    2,
  );

  return [
    wrapXmlTag("discord_message_context", contextJson),
    "",
    wrapXmlTag("user_message", userMessage.trim()),
  ].join("\n");
}

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
function wrapXmlTag(tag: string, content: string): string {
  return `<${tag}>${content}</${tag}>`;
}

function normalizeContextValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.replace(/\s+/g, " ").trim();
}
