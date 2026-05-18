import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMediaAttachmentLabel,
  parseProviderModelId,
  resolveMediaAttachmentsForPrompt,
} from "./discord-media-resolution";
import type { ResolvedDiscordGatewayConfig } from "./types";

const { describeMediaAttachmentMock } = vi.hoisted(() => {
  return {
    describeMediaAttachmentMock: vi.fn(),
  };
});

vi.mock("./media-description", () => {
  return {
    describeMediaAttachment: describeMediaAttachmentMock,
  };
});

function createConfig(
  overrides: Partial<ResolvedDiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  return {
    discordBotToken: "token",
    discordAllowedUserId: "user-1",
    cwd: "/repo",
    agentDir: "/repo/.pi-agent",
    modelProvider: "openrouter",
    modelId: "model-1",
    thinkingLevel: "medium",
    promptTimeZone: "UTC",
    promptLocale: "en-AU",
    promptTransform: async (input) => input,
    startupMessage: false,
    shutdownOnSignals: true,
    visionModelId: null,
    discordAllowedForumChannelIds: [],
    discordAllowedUserIds: ["user-1"],
    ...overrides,
  };
}

function createAgentService(findModelResult?: unknown) {
  return {
    models: {
      findModel: vi.fn(() => findModelResult),
    },
  };
}

const mediaAttachments = [
  {
    filename: "photo.png",
    data: "base64-photo",
    mimeType: "image/png",
  },
  {
    filename: "report.pdf",
    data: "base64-pdf",
    mimeType: "application/pdf",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  describeMediaAttachmentMock.mockResolvedValue("described");
});

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

  describe("resolveMediaAttachmentsForPrompt", () => {
    it("passes media natively when the current model supports vision", async () => {
      await expect(
        resolveMediaAttachmentsForPrompt(
          mediaAttachments,
          "hello",
          { input: ["text", "image"], provider: "openrouter", id: "vision" } as never,
          createConfig(),
          createAgentService() as never,
        ),
      ).resolves.toEqual({
        content: "hello",
        images: [
          { type: "image", data: "base64-photo", mimeType: "image/png" },
          {
            type: "image",
            data: "base64-pdf",
            mimeType: "application/pdf",
          },
        ],
      });
    });

    it("adds a note when no vision model is configured", async () => {
      await expect(
        resolveMediaAttachmentsForPrompt(
          [mediaAttachments[0]!],
          "hello",
          { input: ["text"], provider: "openrouter", id: "text-only" } as never,
          createConfig({ visionModelId: null }),
          createAgentService() as never,
        ),
      ).resolves.toEqual({
        content:
          "hello\n\n[User sent media attachment(s): photo.png]\n(Media vision not configured. Set visionModelId to enable image/PDF/document understanding.)",
        images: [],
      });
    });

    it("returns unchanged content when vision model id is invalid", async () => {
      await expect(
        resolveMediaAttachmentsForPrompt(
          [mediaAttachments[0]!],
          "hello",
          undefined,
          createConfig({ visionModelId: "bad-value" }),
          createAgentService() as never,
        ),
      ).resolves.toEqual({ content: "hello", images: [] });
    });

    it("adds a note when the configured vision model is missing", async () => {
      await expect(
        resolveMediaAttachmentsForPrompt(
          [mediaAttachments[0]!],
          "",
          undefined,
          createConfig({ visionModelId: "openrouter/google/gemini-2.5-flash" }),
          createAgentService(undefined) as never,
        ),
      ).resolves.toEqual({
        content:
          "\n\n[User sent media attachment(s): photo.png]\n(Vision model not found: openrouter/google/gemini-2.5-flash)",
        images: [],
      });
    });

    it("describes each attachment and prepends the combined description block", async () => {
      describeMediaAttachmentMock
        .mockResolvedValueOnce("first description")
        .mockResolvedValueOnce("second description");

      await expect(
        resolveMediaAttachmentsForPrompt(
          mediaAttachments,
          "user text",
          undefined,
          createConfig({ visionModelId: "openrouter/google/gemini-2.5-flash" }),
          createAgentService({ provider: "openrouter", id: "google/gemini-2.5-flash" }) as never,
        ),
      ).resolves.toEqual({
        content: [
          "[Image: photo.png]",
          "first description",
          "",
          "[PDF: report.pdf]",
          "second description",
          "",
          "---",
          "user text",
        ].join("\n"),
        images: [],
      });
      expect(describeMediaAttachmentMock).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        "base64-photo",
        "image/png",
        "user text",
        { provider: "openrouter", id: "google/gemini-2.5-flash" },
      );
    });
  });
});
