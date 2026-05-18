import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSupportedMediaAttachment,
  isSupportedTextAttachment,
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
});
