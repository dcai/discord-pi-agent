import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { AgentService } from "./agent-service";
import { describeMediaAttachment } from "./media-description";
import { createModuleLogger } from "./logger";
import type { MediaAttachmentContent } from "./discord-attachments";
import type { ResolvedDiscordGatewayConfig } from "./types";

const logger = createModuleLogger("discord-media-resolution");

export type ResolvedPromptMedia = {
  content: string;
  images: ImageContent[];
};

/**
 * Parse a "provider/modelId" string, handling model IDs that contain slashes.
 */
export function parseProviderModelId(value: string): {
  provider: string;
  modelId: string;
} | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) {
    return null;
  }

  return {
    provider: trimmed.substring(0, slashIndex),
    modelId: trimmed.substring(slashIndex + 1),
  };
}

export function getMediaAttachmentLabel(
  filename: string,
  mimeType: string,
): string {
  if (mimeType === "application/pdf") {
    return `[PDF: ${filename}]`;
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    return `[Word: ${filename}]`;
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    return `[Excel: ${filename}]`;
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType === "application/vnd.ms-powerpoint"
  ) {
    return `[PowerPoint: ${filename}]`;
  }

  return `[Image: ${filename}]`;
}

export async function resolveMediaAttachmentsForPrompt(
  mediaAttachments: MediaAttachmentContent[],
  content: string,
  currentModel: Model<any> | undefined,
  config: ResolvedDiscordGatewayConfig,
  agentService: AgentService,
): Promise<ResolvedPromptMedia> {
  const modelSupportsVision = currentModel?.input.includes("image") ?? false;

  if (modelSupportsVision) {
    const names = mediaAttachments.map((media) => media.filename).join(", ");
    logger.info(
      {
        count: mediaAttachments.length,
        filenames: names,
        model: currentModel
          ? `${currentModel.provider}/${currentModel.id}`
          : "none",
      },
      "passing media natively to vision-capable model",
    );

    return {
      content,
      images: mediaAttachments.map((media) => ({
        type: "image",
        data: media.data,
        mimeType: media.mimeType,
      })),
    };
  }

  if (!config.visionModelId) {
    const names = mediaAttachments.map((media) => media.filename).join(", ");
    logger.info(
      { filenames: names },
      "media attachments received but vision model not configured",
    );
    const note =
      `\n\n[User sent media attachment(s): ${names}]\n` +
      "(Media vision not configured. Set visionModelId to enable image/PDF/document understanding.)";

    return {
      content: content ? content + note : note,
      images: [],
    };
  }

  const parsedVisionModelId = parseProviderModelId(config.visionModelId);
  if (!parsedVisionModelId) {
    return { content, images: [] };
  }

  const visionModel = agentService.models.findModel(
    parsedVisionModelId.provider,
    parsedVisionModelId.modelId,
  );
  if (!visionModel) {
    logger.warn(
      { visionModelId: config.visionModelId },
      "vision model not found in registry",
    );
    const names = mediaAttachments.map((media) => media.filename).join(", ");
    const note =
      `\n\n[User sent media attachment(s): ${names}]\n` +
      `(Vision model not found: ${config.visionModelId})`;

    return {
      content: content ? content + note : note,
      images: [],
    };
  }

  logger.info(
    {
      count: mediaAttachments.length,
      visionModel: `${visionModel.provider}/${visionModel.id}`,
    },
    "describing media with vision model",
  );

  const descriptions: string[] = [];
  for (const media of mediaAttachments) {
    const description = await describeMediaAttachment(
      agentService,
      media.data,
      media.mimeType,
      content,
      visionModel,
    );
    const label = getMediaAttachmentLabel(media.filename, media.mimeType);
    descriptions.push(`${label}\n${description}`);
  }

  if (descriptions.length === 0) {
    return { content, images: [] };
  }

  const descriptionPrefix = descriptions.join("\n\n");
  return {
    content: content ? `${descriptionPrefix}\n\n---\n${content}` : descriptionPrefix,
    images: [],
  };
}
