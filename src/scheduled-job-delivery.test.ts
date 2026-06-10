import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
import { ScheduledJobDeliveryService } from "./scheduled-job-delivery";

const { chunkMessageMock } = vi.hoisted(() => {
  return {
    chunkMessageMock: vi.fn(),
  };
});

vi.mock("./message-chunker", () => {
  return {
    chunkMessage: chunkMessageMock,
  };
});

describe("ScheduledJobDeliveryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chunkMessageMock.mockReturnValue(["chunk-1", "chunk-2"]);
  });

  it("suppresses embeds for discord DM scheduled job messages", async () => {
    const dmChannel = {
      send: vi.fn(async () => undefined),
    };
    const createDMMock = vi.fn(async () => dmChannel);
    const fetchUserMock = vi.fn(async () => {
      return {
        createDM: createDMMock,
      };
    });
    const client = {
      users: {
        fetch: fetchUserMock,
      },
    };
    const service = new ScheduledJobDeliveryService(client as never);

    await service.deliverResult(
      {
        id: "hn-digest",
        result: {
          target: "discord-dm",
          userId: "user-1",
        },
      },
      "daily summary",
    );

    expect(fetchUserMock).toHaveBeenCalledWith("user-1");
    expect(createDMMock).toHaveBeenCalledOnce();
    expect(dmChannel.send).toHaveBeenNthCalledWith(1, {
      content: "chunk-1",
      flags: MessageFlags.SuppressEmbeds,
    });
    expect(dmChannel.send).toHaveBeenNthCalledWith(2, {
      content: "chunk-2",
      flags: MessageFlags.SuppressEmbeds,
    });
  });

  it("suppresses embeds for discord channel scheduled job messages", async () => {
    const channel = {
      isTextBased: () => true,
      send: vi.fn(async () => undefined),
    };
    const fetchChannelMock = vi.fn(async () => channel);
    const client = {
      channels: {
        fetch: fetchChannelMock,
      },
    };
    const service = new ScheduledJobDeliveryService(client as never);

    await service.deliverResult(
      {
        id: "hn-digest",
        result: {
          target: "discord-channel",
          channelId: "channel-1",
        },
      },
      "daily summary",
    );

    expect(fetchChannelMock).toHaveBeenCalledWith("channel-1");
    expect(channel.send).toHaveBeenNthCalledWith(1, {
      content: "chunk-1",
      flags: MessageFlags.SuppressEmbeds,
    });
    expect(channel.send).toHaveBeenNthCalledWith(2, {
      content: "chunk-2",
      flags: MessageFlags.SuppressEmbeds,
    });
  });
});
