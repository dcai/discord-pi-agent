import type { Message } from "discord.js";
import { getAuthorDisplayName } from "./discord-auth";
import type { SessionScope } from "./session-registry";

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

export function buildDiscordMessageMetadata(
  message: Message,
  scope: SessionScope,
): string {
  const isThread = scope.startsWith("thread:") && message.channel.isThread();

  const contextEntries = [
    ["scope", scope === "dm" ? "dm" : "thread"],
    ["sent_at", message.createdAt.toISOString()],
    ["sent_at_local", formatDiscordPromptTime(message.createdAt)],
    ["message_id", message.id],
    [
      "author_name",
      getAuthorDisplayName(message).replace(/\s+/g, " ").trim() || undefined,
    ],
    ["author_id", message.author.id],
    [
      "thread_title",
      isThread
        ? (message.channel.name ?? "").replace(/\s+/g, " ").trim()
        : undefined,
    ],
    ["thread_id", isThread ? message.channel.id : undefined],
    [
      "forum_channel_id",
      isThread ? (message.channel.parentId ?? undefined) : undefined,
    ],
  ].filter((entry): entry is [string, string] => {
    return typeof entry[1] === "string" && entry[1].length > 0;
  });

  return wrapXmlTag(
    "discord_message_context",
    JSON.stringify(Object.fromEntries(contextEntries), null, 2),
  );
}

/** Wrap content in an XML-style tag: `<tag>content</tag>`. */
export function wrapXmlTag(tag: string, content: string): string {
  return `<${tag}>${content}</${tag}>`;
}
