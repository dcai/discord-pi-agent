import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type SendableChannels,
} from "discord.js";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { AgentService } from "./agent-service";
import { handleCommand } from "./commands";
import { describeImage } from "./image-description";
import { createModuleLogger } from "./logger";
import { chunkMessage } from "./message-chunker";
import {
  buildDiscordMessageContextPrompt,
  formatDiscordPromptTime,
} from "./prompt-context";
import { collectReply } from "./reply-buffer";
import type { SessionRegistry } from "./session-registry";
import type { ResolvedDiscordPiBridgeConfig } from "./types";

const logger = createModuleLogger("discord-gateway");

export type GatewayAuthConfig = {
  discordAllowedUserId: string;
  discordAllowedForumChannelIds: string[];
  discordAllowedUserIds: string[];
  startupMessage: string | false;
};

function getAuthorDisplayName(message: Message): string {
  return (
    message.member?.displayName ||
    message.author.globalName ||
    message.author.username
  );
}

function buildDiscordPromptContent(
  message: Message,
  scope: string,
  content: string,
  config: ResolvedDiscordPiBridgeConfig,
): string {
  const isThread = scope.startsWith("thread:") && message.channel.isThread();

  return buildDiscordMessageContextPrompt(content, {
    scope: scope === "dm" ? "dm" : "thread",
    sentAt: message.createdAt.toISOString(),
    sentAtLocal: formatDiscordPromptTime(message.createdAt, {
      timeZone: config.promptTimeZone,
      locale: config.promptLocale,
    }),
    messageId: message.id,
    authorId: message.author.id,
    authorName: getAuthorDisplayName(message),
    threadId: isThread ? message.channel.id : undefined,
    threadTitle: isThread ? message.channel.name : undefined,
    forumChannelId: isThread ? message.channel.parentId : undefined,
  });
}

/**
 * Determine the session scope from an incoming message.
 * Returns null for unsupported channel types (silently ignored).
 */
function resolveScope(message: Message): string | null {
  if (message.channel.type === ChannelType.DM) {
    return "dm";
  }

  if (message.channel.isThread()) {
    return `thread:${message.channel.id}`;
  }

  return null;
}

function isAuthorized(
  message: Message,
  scope: string,
  authConfig: GatewayAuthConfig,
): boolean {
  // DM scope: check against discordAllowedUserId
  if (scope === "dm") {
    return message.author.id === authConfig.discordAllowedUserId;
  }

  // Thread scope: check user is in allowed list and forum channel is allowed
  if (scope.startsWith("thread:")) {
    const channel = message.channel;
    if (!channel.isThread()) {
      return false;
    }

    const parentId = channel.parentId;
    if (
      !parentId ||
      !authConfig.discordAllowedForumChannelIds.includes(parentId)
    ) {
      return false;
    }

    return authConfig.discordAllowedUserIds.includes(message.author.id);
  }

  return false;
}

const WORKING_EMOJI = "\u2699\uFE0F"; // ⚙️ gear emoji

async function addWorkingReaction(message: Message): Promise<void> {
  try {
    await message.react(WORKING_EMOJI);
  } catch (error) {
    logger.debug(
      { messageId: message.id, error },
      "failed to add working reaction",
    );
  }
}

async function removeWorkingReaction(message: Message): Promise<void> {
  try {
    const reaction = message.reactions.cache.get(WORKING_EMOJI);
    if (reaction) {
      await reaction.users.remove(message.client.user!);
    }
  } catch (error) {
    logger.debug(
      { messageId: message.id, error },
      "failed to remove working reaction",
    );
  }
}

// 9 seconds keeps us clear of Discord's 10-second typing rate limit
const TYPING_INTERVAL_MS = 9000;

// Per-channel typing tracker to prevent duplicate intervals from
// concurrent onMessage calls hammering Discord's rate limit.
const typingIntervals = new Map<
  string,
  { interval: NodeJS.Timeout; refs: number }
>();

async function sendTypingSafe(
  channel: SendableChannels,
  channelKey: string,
): Promise<void> {
  try {
    const token = channel.client.token;
    const url = `https://discord.com/api/v10/channels/${channel.id}/typing`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.ok) {
      logger.debug(`[TYPING] STATUS UPDATED OK`);
      return;
    }
    if (res.status === 429) {
      const body = await res.text();
      let retryMs = 3_000;
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.retry_after === "number") {
          retryMs = parsed.retry_after * 1_000 + 500;
        }
      } catch {
        // ignore parse errors
      }
      logger.warn(
        { channelKey, retryMs, response: body },
        `[TYPING] 429, retrying after ${retryMs}ms delay`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bot ${token}` },
      });
      logger.info({ channelKey }, "[TYPING] retry done");
      return;
    }
    logger.warn(
      { channelKey, status: res.status },
      "[TYPING] unexpected status",
    );
  } catch (error: unknown) {
    logger.warn({ channelKey, error }, "[TYPING] FAILED");
  }
}

function startTypingForChannel(
  channel: SendableChannels,
  channelKey: string,
): void {
  const existing = typingIntervals.get(channelKey);
  if (existing) {
    existing.refs += 1;
    logger.debug(
      { channelKey, refs: existing.refs },
      "[TYPING] ref++ (reusing existing interval)",
    );
    return;
  }
  logger.debug(
    // { channelKey },
    "[TYPING] started new interval",
  );
  void sendTypingSafe(channel, channelKey);
  const interval = setInterval(() => {
    void sendTypingSafe(channel, channelKey);
  }, TYPING_INTERVAL_MS);
  typingIntervals.set(channelKey, { interval, refs: 1 });
}

function stopTypingForChannel(channelKey: string): void {
  const entry = typingIntervals.get(channelKey);
  if (!entry) {
    logger.debug({ channelKey }, "[TYPING] stop called but no entry found");
    return;
  }
  entry.refs -= 1;
  if (entry.refs <= 0) {
    clearInterval(entry.interval);
    typingIntervals.delete(channelKey);
    logger.debug(
      // { channelKey },
      "[TYPING] interval cleared (refs hit 0)",
    );
  } else {
    logger.debug(
      // { channelKey, refs: entry.refs },
      "[TYPING] ref-- (interval still active)",
    );
  }
}

async function sendReply(message: Message, text: string): Promise<void> {
  const channel = message.channel;
  if (!channel.isSendable()) {
    logger.debug(
      {
        messageId: message.id,
      },
      "reply skipped, channel not sendable",
    );
    return;
  }

  const chunks = chunkMessage(text);

  const [firstChunk, ...remainingChunks] = chunks;
  if (!firstChunk) {
    return;
  }

  try {
    await message.reply(firstChunk);
    for (const chunk of remainingChunks) {
      await channel.send(chunk);
    }
  } catch (error) {
    logger.error(
      {
        messageId: message.id,
        error,
      },
      "send reply failed",
    );
  }
}

const TEXT_ATTACHMENT_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".log",
  ".yml",
  ".yaml",
  ".xml",
  ".toml",
  ".ini",
  ".cfg",
];
const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // Discord's attachment limit

type AttachmentContent = {
  filename: string;
  content: string;
};

async function readTextAttachments(
  message: Message,
): Promise<AttachmentContent[]> {
  const attachments = message.attachments;
  if (attachments.size === 0) {
    return [];
  }

  const results: AttachmentContent[] = [];

  for (const [, attachment] of attachments) {
    const ext = attachment.name
      ?.slice(attachment.name.lastIndexOf("."))
      .toLowerCase();

    if (!ext || !TEXT_ATTACHMENT_EXTENSIONS.includes(ext)) {
      logger.debug(
        { messageId: message.id, filename: attachment.name, ext },
        "skipping non-text attachment",
      );
      continue;
    }

    if (attachment.size > MAX_ATTACHMENT_SIZE_BYTES) {
      logger.warn(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
        },
        "attachment too large, skipping",
      );
      continue;
    }

    try {
      logger.info(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
        },
        "fetching attachment",
      );
      const response = await fetch(attachment.url);
      if (!response.ok) {
        logger.warn(
          {
            messageId: message.id,
            filename: attachment.name,
            status: response.status,
          },
          "failed to fetch attachment",
        );
        continue;
      }
      const content = await response.text();
      results.push({ filename: attachment.name, content });
    } catch (error) {
      logger.error(
        { messageId: message.id, filename: attachment.name, error },
        "error fetching attachment",
      );
    }
  }

  return results;
}

const MEDIA_ATTACHMENT_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
];
const MAX_MEDIA_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB (Discord's free-tier file limit)

type MediaAttachmentContent = {
  filename: string;
  data: string;
  mimeType: string;
};

function isMediaAttachment(attachment: {
  name: string | null;
  contentType: string | null;
}): boolean {
  const ext = attachment.name
    ?.slice(attachment.name.lastIndexOf("."))
    .toLowerCase();
  if (!ext || !MEDIA_ATTACHMENT_EXTENSIONS.includes(ext)) {
    return false;
  }

  const ct = attachment.contentType;
  if (!ct) {
    return false;
  }

  return ct.startsWith("image/") || ct === "application/pdf";
}

async function readMediaAttachments(
  message: Message,
): Promise<MediaAttachmentContent[]> {
  const attachments = message.attachments;
  if (attachments.size === 0) {
    return [];
  }

  const results: MediaAttachmentContent[] = [];

  for (const [, attachment] of attachments) {
    if (!isMediaAttachment(attachment)) {
      continue;
    }

    if (attachment.size > MAX_MEDIA_ATTACHMENT_SIZE) {
      logger.warn(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
        },
        "media attachment too large, skipping",
      );
      continue;
    }

    try {
      logger.info(
        {
          messageId: message.id,
          filename: attachment.name,
          size: attachment.size,
        },
        "fetching media attachment",
      );
      const response = await fetch(attachment.url);
      if (!response.ok) {
        logger.warn(
          {
            messageId: message.id,
            filename: attachment.name,
            status: response.status,
          },
          "failed to fetch media attachment",
        );
        continue;
      }
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      results.push({
        filename: attachment.name,
        data: base64,
        mimeType: attachment.contentType ?? "application/octet-stream",
      });
    } catch (error) {
      logger.error(
        { messageId: message.id, filename: attachment.name, error },
        "error fetching media attachment",
      );
    }
  }

  return results;
}

/**
 * Parse a "provider/modelId" string, handling model IDs that contain slashes
 * (e.g. "openrouter/google/gemini-2.5-flash" splits into
 *  provider="openrouter", modelId="google/gemini-2.5-flash").
 */
function parseVisionModelId(visionModelId: string): {
  provider: string;
  modelId: string;
} | null {
  const trimmed = visionModelId.trim();
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

/**
 * Result of resolving image attachments for a prompt.
 * When images are passed natively, the text is the user's message content
 * and images are sent alongside it. When using a vision model fallback,
 * the text includes the vision model's description and images is empty.
 */
type ResolvedImages = {
  content: string;
  images: ImageContent[];
};

/**
 * Resolve media attachments (images, PDFs) into prompt text and/or native
 * content blocks. Strategy depends on whether the current model supports
 * vision natively.
 */
async function resolveMediaAttachments(
  media: MediaAttachmentContent[],
  content: string,
  currentModel: Model<any> | undefined,
  config: ResolvedDiscordPiBridgeConfig,
  agentService: AgentService,
): Promise<ResolvedImages> {
  const modelSupportsVision = currentModel?.input.includes("image") ?? false;

  if (modelSupportsVision) {
    // Native media passthrough — pass images/PDFs directly to the model.
    const names = media.map((m) => m.filename).join(", ");
    logger.info(
      {
        count: media.length,
        filenames: names,
        model: currentModel
          ? `${currentModel.provider}/${currentModel.id}`
          : "none",
      },
      "passing media natively to vision-capable model",
    );
    const images: ImageContent[] = media.map((m) => ({
      type: "image",
      data: m.data,
      mimeType: m.mimeType,
    }));
    return { content, images };
  }

  if (!config.visionModelId) {
    // No vision model configured — graceful degradation.
    const names = media.map((m) => m.filename).join(", ");
    logger.info(
      { filenames: names },
      "media attachments received but vision model not configured",
    );
    const note =
      `\n\n[User sent media attachment(s): ${names}]\n` +
      "(Media vision not configured. Set visionModelId to enable image/PDF understanding.)";
    return { content: content ? content + note : note, images: [] };
  }

  const parsed = parseVisionModelId(config.visionModelId);
  if (!parsed) {
    return { content, images: [] };
  }

  const visionModel = agentService.findModel(parsed.provider, parsed.modelId);
  if (!visionModel) {
    logger.warn(
      { visionModelId: config.visionModelId },
      "vision model not found in registry",
    );
    const names = media.map((m) => m.filename).join(", ");
    const note = `\n\n[User sent media attachment(s): ${names}]\n(Vision model not found: ${config.visionModelId})`;
    return { content: content ? content + note : note, images: [] };
  }

  logger.info(
    {
      count: media.length,
      visionModel: `${visionModel.provider}/${visionModel.id}`,
    },
    "describing media with vision model",
  );

  const descriptions: string[] = [];
  for (const m of media) {
    const isPdf = m.mimeType === "application/pdf";
    const description = await describeImage(
      agentService,
      m.data,
      m.mimeType,
      content,
      visionModel,
    );
    const label = isPdf ? `[PDF: ${m.filename}]` : `[Image: ${m.filename}]`;
    descriptions.push(`${label}\n${description}`);
  }

  if (descriptions.length > 0) {
    const prefix = descriptions.join("\n\n");
    return {
      content: content ? `${prefix}\n\n---\n${content}` : prefix,
      images: [],
    };
  }

  return { content, images: [] };
}

export async function startGatewayClient(
  config: ResolvedDiscordPiBridgeConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  authConfig: GatewayAuthConfig,
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ userTag: readyClient.user.tag }, "logged in");

    if (!authConfig.startupMessage) {
      return;
    }

    try {
      const user = await readyClient.users.fetch(
        authConfig.discordAllowedUserId,
      );
      const dmChannel = await user.createDM();
      await dmChannel.send(authConfig.startupMessage);
      logger.info(
        {
          userId: authConfig.discordAllowedUserId,
        },
        "sent startup dm",
      );
    } catch (error) {
      logger.error({ error }, "failed to send startup dm");
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await onMessage(
        message,
        config,
        agentService,
        sessionRegistry,
        authConfig,
      );
    } catch (error) {
      logger.error({ error, direction: "IN" }, "message handling failed");
      await sendReply(
        message,
        "The bot hit an error while handling that message.",
      );
    }
  });

  client.on(Events.ThreadDelete, async (thread) => {
    const scope = `thread:${thread.id}`;
    logger.info({ threadId: thread.id, scope }, "thread deleted");
    await sessionRegistry.remove(scope);
  });

  await client.login(config.discordBotToken);
  return client;
}

async function onMessage(
  message: Message,
  config: ResolvedDiscordPiBridgeConfig,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
  authConfig: GatewayAuthConfig,
): Promise<void> {
  if (message.author.bot) {
    // logger.debug({ messageId: message.id }, "ignored bot message");
    logger.debug("ignored bot message");
    return;
  }

  if (message.system) {
    logger.debug({ messageId: message.id }, "ignored system message");
    return;
  }

  const scope = resolveScope(message);
  if (scope === null) {
    logger.debug(
      {
        messageId: message.id,
        channelType: message.channel.type,
      },
      "unsupported channel type, ignoring",
    );
    return;
  }

  if (!isAuthorized(message, scope, authConfig)) {
    logger.debug(
      {
        messageId: message.id,
        authorId: message.author.id,
        scope,
      },
      "unauthorized",
    );
    return;
  }

  let content = message.content.trim();

  // If message has .txt / .md attachments, fetch and inline their content.
  // This lets users bypass Discord's 2000-char free-tier message limit by
  // attaching long prompts or data files directly instead of pasting them.
  const attachmentContents = await readTextAttachments(message);
  if (attachmentContents.length > 0) {
    const suffix = attachmentContents
      .map((a) => `\n\n--- Attachment: ${a.filename} ---\n${a.content}`)
      .join("");
    content = content ? content + suffix : attachmentContents[0]!.content;
  }

  // Fetch media attachments (images, PDFs) upfront (lightweight — just downloads).
  // The actual vision processing is deferred to the prompt queue callback
  // where we have access to the session's current model.
  const mediaAttachments = await readMediaAttachments(message);

  if (!content && mediaAttachments.length === 0) {
    logger.debug(
      { messageId: message.id },
      "ignored empty message (no text or images)",
    );
    return;
  }

  logger.info(
    {
      direction: "IN",
      scope,
      messageId: message.id,
      authorId: message.author.id,
      channelType: message.channel.type,
      content,
    },
    "message received",
  );

  // Start typing BEFORE session creation to give 429 retry a head start
  const channelKey = message.channel.id;
  const canSend = message.channel.isSendable();
  if (canSend) {
    startTypingForChannel(message.channel, channelKey);
  }

  const { entry, created } = await sessionRegistry.getOrCreate(scope);
  const { session, promptQueue } = entry;

  if (created && scope.startsWith("thread:") && message.channel.isThread()) {
    logger.info(
      {
        scope,
        threadName: message.channel.name,
      },
      "new thread session",
    );
  }

  // Try commands first
  const commandResult = await handleCommand(content, {
    agentService,
    promptQueue,
    session,
  });

  if (commandResult.handled) {
    stopTypingForChannel(channelKey);

    if (commandResult.archive && scope.startsWith("thread:")) {
      logger.info({ scope }, "archiving thread");
      const archiveChannel = message.channel;
      if (archiveChannel.isSendable()) {
        await archiveChannel.send(commandResult.response ?? "Archiving...");
      }
      try {
        if (archiveChannel.isThread()) {
          await archiveChannel.setArchived(true);
        }
      } catch (error) {
        logger.error({ error }, "failed to archive thread");
      }
      await sessionRegistry.remove(scope);
      return;
    }

    logger.info(
      {
        messageId: message.id,
        command: content,
        hasResponse: Boolean(commandResult.response),
      },
      `command handled: ${content}`,
    );

    if (commandResult.response) {
      await sendReply(message, commandResult.response);
    }

    return;
  }

  // Not a command — enqueue as prompt
  if (!message.channel.isSendable()) {
    stopTypingForChannel(channelKey);
    logger.debug({ messageId: message.id }, "channel not sendable");
    return;
  }

  await addWorkingReaction(message);

  const queuePosition = promptQueue.getSnapshot().pending;
  // logger.debug(
  //   {
  //     scope,
  //     messageId: message.id,
  //     queuePosition,
  //   },
  //   "enqueue request",
  // );

  if (queuePosition > 0) {
    await sendReply(
      message,
      `Queued. ${queuePosition} request(s) ahead of this one.`,
    );
  }

  let response: string;
  try {
    response = await promptQueue.enqueue(async () => {
      // logger.debug(
      //   {
      //     messageId: message.id,
      //     scope,
      //   },
      //   "processing message",
      // );

      // Process media attachments inside the queue callback so we have
      // access to the session's current model for vision capability check.
      let promptContent = content;
      let promptImages: ImageContent[] | undefined;
      if (mediaAttachments.length > 0) {
        const resolved = await resolveMediaAttachments(
          mediaAttachments,
          promptContent,
          session.model,
          config,
          agentService,
        );
        promptContent = resolved.content;
        if (resolved.images.length > 0) {
          promptImages = resolved.images;
        }
      }

      const wrappedContent = buildDiscordPromptContent(
        message,
        scope,
        promptContent,
        config,
      );
      const transformedPrompt = await config.promptTransform(wrappedContent);
      return collectReply(session, transformedPrompt, {
        logPrefix: `[agent:${session.sessionId}]`,
        images: promptImages,
      });
    });
  } finally {
    stopTypingForChannel(channelKey);
    await removeWorkingReaction(message);
  }
  await sendReply(message, response);
}
