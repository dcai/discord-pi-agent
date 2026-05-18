import { describe, expect, it } from "vitest";
import {
  getMediaAttachmentLabel,
  parseProviderModelId,
} from "./discord-media-resolution";

describe("discord-media-resolution", () => {
  describe("parseProviderModelId", () => {
    it("parses provider and model id with extra slashes in model id", () => {
      expect(parseProviderModelId("openrouter/google/gemini-2.5-flash")).toEqual({
        provider: "openrouter",
        modelId: "google/gemini-2.5-flash",
      });
    });

    it("returns null for blank input", () => {
      expect(parseProviderModelId("   ")).toBeNull();
    });

    it("returns null when no slash exists", () => {
      expect(parseProviderModelId("openrouter")).toBeNull();
    });
  });

  describe("getMediaAttachmentLabel", () => {
    it("labels known office and image types", () => {
      expect(getMediaAttachmentLabel("report.pdf", "application/pdf")).toBe(
        "[PDF: report.pdf]",
      );
      expect(
        getMediaAttachmentLabel(
          "slides.pptx",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
      ).toBe("[PowerPoint: slides.pptx]");
      expect(getMediaAttachmentLabel("photo.png", "image/png")).toBe(
        "[Image: photo.png]",
      );
    });
  });
});
