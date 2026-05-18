import { ChannelType, type Message } from "discord.js";
import type { GatewayAuthConfig } from "./discord-gateway-client";

export function getAuthorDisplayName(message: Message): string {
  return (
    message.member?.displayName ||
    message.author.globalName ||
    message.author.username
  );
}

/**
 * Determine the session scope from an incoming message.
 * Returns null for unsupported channel types (silently ignored).
 */
export function resolveMessageScope(message: Message): string | null {
  if (message.channel.type === ChannelType.DM) {
    return "dm";
  }

  if (message.channel.isThread()) {
    return `thread:${message.channel.id}`;
  }

  return null;
}

export function isAuthorizedMessage(
  message: Message,
  scope: string,
  authConfig: GatewayAuthConfig,
): boolean {
  if (scope === "dm") {
    return message.author.id === authConfig.discordAllowedUserId;
  }

  if (scope.startsWith("thread:")) {
    const channel = message.channel;
    if (!channel.isThread()) {
      return false;
    }

    const parentId = channel.parentId;
    if (
      !parentId ||
      !authConfig.discordAllowedForumChannelIds.includes(parentId)
    ) {
      return false;
    }

    return authConfig.discordAllowedUserIds.includes(message.author.id);
  }

  return false;
}
