import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendTypingSafe,
  startTypingForChannel,
  stopTypingForChannel,
} from "./discord-typing";

function createChannel() {
  return {
    id: "channel-1",
    client: { token: "bot-token" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  stopTypingForChannel("channel-1");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("discord-typing", () => {
  it("posts typing updates successfully", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTypingSafe(createChannel() as never, "channel-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/channel-1/typing",
      {
        method: "POST",
        headers: { Authorization: "Bot bot-token" },
      },
    );
  });

  it("retries after rate limiting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ retry_after: 0.01 }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const promise = sendTypingSafe(createChannel() as never, "channel-1");
    await vi.advanceTimersByTimeAsync(600);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("handles unexpected status and fetch failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "err",
        })
        .mockRejectedValueOnce(new Error("network down")),
    );

    await expect(
      sendTypingSafe(createChannel() as never, "channel-1"),
    ).resolves.toBeUndefined();
    await expect(
      sendTypingSafe(createChannel() as never, "channel-1"),
    ).resolves.toBeUndefined();
  });

  it("uses ref counting for typing intervals", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    startTypingForChannel(createChannel() as never, "channel-1");
    await vi.runOnlyPendingTimersAsync();

    startTypingForChannel(createChannel() as never, "channel-1");
    await vi.advanceTimersByTimeAsync(9000);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    stopTypingForChannel("channel-1");
    const callsBeforeStop = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeStop);

    stopTypingForChannel("channel-1");
    const callsBeforeFinalWait = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeFinalWait);
  });
});
