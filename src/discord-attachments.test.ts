import { describe, expect, it } from "vitest";
import {
  isSupportedMediaAttachment,
  isSupportedTextAttachment,
} from "./discord-attachments";

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
});
