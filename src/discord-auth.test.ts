import { describe, expect, it } from "vitest";
import { ChannelType } from "discord.js";
import {
  getAuthorDisplayName,
  isAuthorizedMessage,
  resolveMessageScope,
} from "./discord-auth";
import type { GatewayAccessConfig } from "./types";

const accessConfig: GatewayAccessConfig = {
  discordAllowedUserId: "user-1",
  discordAllowedForumChannelIds: ["forum-1"],
  discordAllowedUserIds: ["user-1", "user-2"],
  startupMessage: false,
};

function createDmMessage(authorId = "user-1") {
  return {
    author: {
      id: authorId,
      username: "username",
      globalName: null,
    },
    member: null,
    channel: {
      type: ChannelType.DM,
      id: "dm-1",
      isThread: () => false,
    },
  } as any;
}

function createThreadMessage({
  authorId = "user-2",
  parentId = "forum-1",
}: {
  authorId?: string;
  parentId?: string | null;
} = {}) {
  return {
    author: {
      id: authorId,
      username: "username",
      globalName: "global",
    },
    member: {
      displayName: "display-name",
    },
    channel: {
      type: ChannelType.PublicThread,
      id: "thread-1",
      parentId,
      isThread: () => true,
    },
  } as any;
}

describe("discord-auth", () => {
  describe("getAuthorDisplayName", () => {
    it("prefers member display name over global and username", () => {
      const result = getAuthorDisplayName(createThreadMessage());
      expect(result).toBe("display-name");
    });

    it("falls back to global name then username", () => {
      const result = getAuthorDisplayName(createDmMessage());
      expect(result).toBe("username");
    });
  });

  describe("resolveMessageScope", () => {
    it("returns dm for DM messages", () => {
      expect(resolveMessageScope(createDmMessage())).toBe("dm");
    });

    it("returns thread scope for thread messages", () => {
      expect(resolveMessageScope(createThreadMessage())).toBe("thread:thread-1");
    });

    it("returns null for unsupported channels", () => {
      const message = {
        channel: {
          type: ChannelType.GuildText,
          isThread: () => false,
        },
      } as any;

      expect(resolveMessageScope(message)).toBeNull();
    });
  });

  describe("isAuthorizedMessage", () => {
    it("authorizes allowed DM user", () => {
      expect(isAuthorizedMessage(createDmMessage(), "dm", accessConfig)).toBe(true);
    });

    it("rejects unauthorized DM user", () => {
      expect(isAuthorizedMessage(createDmMessage("user-9"), "dm", accessConfig)).toBe(false);
    });

    it("authorizes allowed thread user in allowed forum", () => {
      expect(
        isAuthorizedMessage(createThreadMessage(), "thread:thread-1", accessConfig),
      ).toBe(true);
    });

    it("rejects thread user in wrong forum", () => {
      expect(
        isAuthorizedMessage(
          createThreadMessage({ parentId: "forum-9" }),
          "thread:thread-1",
          accessConfig,
        ),
      ).toBe(false);
    });
  });
});
