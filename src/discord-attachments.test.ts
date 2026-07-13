import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSupportedAudioAttachment,
  isSupportedMediaAttachment,
  isSupportedTextAttachment,
  readAudioAttachments,
  readMediaAttachments,
  readTextAttachments,
} from "./discord-attachments";

function createMessage(attachments: Array<Record<string, unknown>>) {
  return {
    id: "message-1",
    attachments: new Map(
      attachments.map((attachment, index) => {
        return [String(index), attachment];
      }),
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("discord-attachments", () => {
  describe("isSupportedTextAttachment", () => {
    it("accepts configured text extensions", () => {
      expect(isSupportedTextAttachment({ name: "notes.md" })).toBe(true);
      expect(isSupportedTextAttachment({ name: "data.JSON" })).toBe(true);
    });

    it("rejects unknown or missing text extensions", () => {
      expect(isSupportedTextAttachment({ name: "image.png" })).toBe(false);
      expect(isSupportedTextAttachment({ name: null })).toBe(false);
    });
  });

  describe("isSupportedMediaAttachment", () => {
    it("accepts image attachments", () => {
      expect(
        isSupportedMediaAttachment({
          name: "photo.png",
          contentType: "image/png",
        }),
      ).toBe(true);
    });

    it("accepts supported office attachments", () => {
      expect(
        isSupportedMediaAttachment({
          name: "report.pdf",
          contentType: "application/pdf",
        }),
      ).toBe(true);
    });

    it("rejects unsupported media attachments", () => {
      expect(
        isSupportedMediaAttachment({
          name: "archive.zip",
          contentType: "application/zip",
        }),
      ).toBe(false);
      expect(
        isSupportedMediaAttachment({
          name: "report.pdf",
          contentType: null,
        }),
      ).toBe(false);
    });
  });

  describe("readTextAttachments", () => {
    it("returns empty when the message has no attachments", async () => {
      await expect(
        readTextAttachments(createMessage([]) as never),
      ).resolves.toEqual([]);
    });

    it("fetches only supported text attachments", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        text: async () => "file body",
      }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        readTextAttachments(
          createMessage([
            {
              name: "notes.md",
              size: 10,
              url: "https://example.com/notes.md",
            },
            {
              name: "photo.png",
              size: 10,
              url: "https://example.com/photo.png",
            },
          ]) as never,
        ),
      ).resolves.toEqual([{ filename: "notes.md", content: "file body" }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("skips oversized and failed text attachments", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockRejectedValueOnce(new Error("boom"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        readTextAttachments(
          createMessage([
            {
              name: "ok.md",
              size: 10,
              url: "https://example.com/ok.md",
            },
            {
              name: "huge.md",
              size: 30 * 1024 * 1024,
              url: "https://example.com/huge.md",
            },
            {
              name: "throws.md",
              size: 10,
              url: "https://example.com/throws.md",
            },
          ]) as never,
        ),
      ).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("enforces the declared response size and passes an abort signal", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-length": String(26 * 1024 * 1024) }),
        text: async () => "too large",
      }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        readTextAttachments(
          createMessage([
            {
              name: "large.md",
              size: 10,
              url: "https://example.com/large.md",
            },
          ]) as never,
        ),
      ).resolves.toEqual([]);

      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/large.md",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("aborts attachment fetches that exceed the timeout", async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      const fetchMock = vi.fn(
        (_url: string, options: { signal: AbortSignal }) => {
          signal = options.signal;
          return new Promise<never>((_, reject) => {
            options.signal.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          });
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      const readPromise = readTextAttachments(
        createMessage([
          {
            name: "slow.md",
            size: 10,
            url: "https://example.com/slow.md",
          },
        ]) as never,
      );

      await vi.advanceTimersByTimeAsync(30_000);
      await expect(readPromise).resolves.toEqual([]);
      expect(signal?.aborted).toBe(true);
    });
  });

  describe("readMediaAttachments", () => {
    it("fetches supported media attachments as base64", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("abc").buffer,
      }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        readMediaAttachments(
          createMessage([
            {
              name: "photo.png",
              contentType: "image/png",
              size: 10,
              url: "https://example.com/photo.png",
            },
          ]) as never,
        ),
      ).resolves.toEqual([
        {
          filename: "photo.png",
          data: Buffer.from("abc").toString("base64"),
          mimeType: "image/png",
        },
      ]);
    });

    it("skips unsupported, oversized, failed, and thrown media fetches", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockRejectedValueOnce(new Error("boom"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        readMediaAttachments(
          createMessage([
            {
              name: "archive.zip",
              contentType: "application/zip",
              size: 10,
              url: "https://example.com/archive.zip",
            },
            {
              name: "huge.pdf",
              contentType: "application/pdf",
              size: 30 * 1024 * 1024,
              url: "https://example.com/huge.pdf",
            },
            {
              name: "bad.pdf",
              contentType: "application/pdf",
              size: 10,
              url: "https://example.com/bad.pdf",
            },
            {
              name: "throw.png",
              contentType: "image/png",
              size: 10,
              url: "https://example.com/throw.png",
            },
          ]) as never,
        ),
      ).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("isSupportedAudioAttachment", () => {
    it("accepts audio attachments with matching content type and extension", () => {
      expect(
        isSupportedAudioAttachment({
          name: "voice-message.ogg",
          contentType: "audio/ogg",
        }),
      ).toBe(true);
      expect(
        isSupportedAudioAttachment({
          name: "recording.mp3",
          contentType: "audio/mpeg",
        }),
      ).toBe(true);
    });

    it("rejects non-audio content types", () => {
      expect(
        isSupportedAudioAttachment({
          name: "photo.png",
          contentType: "image/png",
        }),
      ).toBe(false);
    });

    it("rejects audio content type with unsupported extension", () => {
      expect(
        isSupportedAudioAttachment({
          name: "sound.aiff",
          contentType: "audio/aiff",
        }),
      ).toBe(false);
    });

    it("rejects null content type", () => {
      expect(
        isSupportedAudioAttachment({
          name: "voice-message.ogg",
          contentType: null,
        }),
      ).toBe(false);
    });

    it("rejects null name", () => {
      expect(
        isSupportedAudioAttachment({
          name: null,
          contentType: "audio/ogg",
        }),
      ).toBe(false);
    });
  });

  describe("readAudioAttachments", () => {
    it("returns empty when no attachments", async () => {
      await expect(
        readAudioAttachments(createMessage([]) as never),
      ).resolves.toEqual([]);
    });

    it("fetches audio attachments with duration", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("audio-data").buffer,
      }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        readAudioAttachments(
          createMessage([
            {
              name: "voice-message.ogg",
              contentType: "audio/ogg",
              size: 1000,
              url: "https://example.com/voice.ogg",
              duration: 12.5,
            },
          ]) as never,
        ),
      ).resolves.toEqual([
        {
          filename: "voice-message.ogg",
          data: Buffer.from("audio-data"),
          mimeType: "audio/ogg",
          durationSecs: 12.5,
        },
      ]);
    });

    it("skips non-audio and oversized attachments", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("data").buffer,
      }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        readAudioAttachments(
          createMessage([
            {
              name: "photo.png",
              contentType: "image/png",
              size: 10,
              url: "https://example.com/photo.png",
            },
            {
              name: "huge.ogg",
              contentType: "audio/ogg",
              size: 30 * 1024 * 1024,
              url: "https://example.com/huge.ogg",
            },
          ]) as never,
        ),
      ).resolves.toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("handles failed fetches gracefully", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockRejectedValueOnce(new Error("network error"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        readAudioAttachments(
          createMessage([
            {
              name: "bad.ogg",
              contentType: "audio/ogg",
              size: 10,
              url: "https://example.com/bad.ogg",
            },
            {
              name: "throw.ogg",
              contentType: "audio/ogg",
              size: 10,
              url: "https://example.com/throw.ogg",
            },
          ]) as never,
        ),
      ).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
