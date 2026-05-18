import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { AgentService } from "./agent-service";
import { createModuleLogger } from "./logger";

const logger = createModuleLogger("media-description");

/**
 * Use a vision-capable model to describe a media attachment (image or PDF),
 * returning a text description that can be inlined into a prompt for a
 * non-vision model.
 *
 * Creates a temporary in-memory session, sends the media, extracts the
 * assistant's text reply, then disposes the session.
 */
export async function describeMediaAttachment(
  agentService: AgentService,
  imageData: string,
  mimeType: string,
  userText: string,
  visionModel: Model<any>,
): Promise<string> {
  const session = await agentService.createTemporarySession();
  await session.setModel(visionModel);

  const mediaType = getMediaType(mimeType);

  const imageContent: ImageContent = {
    type: "image",
    data: imageData,
    mimeType,
  };

  let promptText: string;
  if (mediaType === "document") {
    promptText =
      userText.trim().length > 0
        ? `The user sent a document with the following message: "${userText}". Please extract and summarize the text content of this document. Be thorough — include all important details, sections, and data from the document.`
        : "Please extract and summarize the text content of this document. Be thorough — include all important details, sections, data, and key points.";
  } else {
    promptText =
      userText.trim().length > 0
        ? `The user sent this image with the following message: "${userText}". Please describe the image in detail and address any questions from the user's message.`
        : "Please describe this image in detail. What do you see?";
  }

  let text = "";

  try {
    await session.prompt(promptText, { images: [imageContent] });
    text = extractLastAssistantText(session);
  } catch (error) {
    logger.error({ error, mimeType }, "vision model prompt failed");
    text = "(Vision model failed to process the file.)";
  } finally {
    session.dispose();
  }

  if (!text) {
    return "(Vision model returned no description.)";
  }

  logger.debug({ textLength: text.length, mimeType }, "media described");

  return text;
}

function extractLastAssistantText(session: AgentSession): string {
  const messages = session.messages;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || !isAssistantMessage(msg)) {
      continue;
    }

    const content = msg.content;
    if (!Array.isArray(content)) {
      continue;
    }

    const textBlocks: string[] = [];
    for (const item of content) {
      if (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        (item as { type: string }).type === "text"
      ) {
        textBlocks.push((item as { text: string }).text);
      }
    }
    return textBlocks.join("\n").trim();
  }

  return "";
}

function getMediaType(mimeType: string): "image" | "document" {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  // PDF, Word, PowerPoint — all treated as documents for prompting.
  return "document";
}

function isAssistantMessage(
  msg: unknown,
): msg is { role: "assistant"; content: unknown } {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "role" in msg &&
    (msg as { role: unknown }).role === "assistant"
  );
}
