import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type SendableChannels,
} from "discord.js";
import type { AgentService } from "./agent-service";
import { handleCommand } from "./commands";
import { chunkMessage } from "./message-chunker";
import type { PromptQueue } from "./prompt-queue";
import type { ResolvedDiscordPiBridgeConfig } from "./types";

export async function startDiscordClient(
  config: ResolvedDiscordPiBridgeConfig,
  agentService: AgentService,
  promptQueue: PromptQueue,
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[discord] logged in as ${readyClient.user.tag}`);
    if (!config.startupMessage) {
      return;
    }

    try {
      const user = await readyClient.users.fetch(config.discordAllowedUserId);
      const dmChannel = await user.createDM();
      await dmChannel.send(config.startupMessage);
      console.log("[discord] sent startup dm", {
        userId: config.discordAllowedUserId,
      });
    } catch (error) {
      console.error("[discord] failed to send startup dm", error);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    console.log("[discord] message received", {
      messageId: message.id,
      authorId: message.author.id,
      channelType: message.channel.type,
      content: message.content,
    });
    try {
      await onMessage(message, config, agentService, promptQueue);
    } catch (error) {
      console.error("[discord] message handling failed", error);
      await sendReply(
        message,
        "The bot hit an error while handling that message.",
      );
    }
  });

  await client.login(config.discordBotToken);
  return client;
}

async function onMessage(
  message: Message,
  config: ResolvedDiscordPiBridgeConfig,
  agentService: AgentService,
  promptQueue: PromptQueue,
): Promise<void> {
  if (message.author.bot) {
    console.log("[discord] ignored bot message", { messageId: message.id });
    return;
  }

  if (message.author.id !== config.discordAllowedUserId) {
    console.log("[discord] ignored unauthorized user", {
      messageId: message.id,
      authorId: message.author.id,
    });
    return;
  }

  if (message.channel.type !== ChannelType.DM) {
    console.log("[discord] ignored non-dm message", {
      messageId: message.id,
      channelType: message.channel.type,
    });
    return;
  }

  const content = message.content.trim();
  if (!content) {
    console.log("[discord] ignored empty message", { messageId: message.id });
    return;
  }

  // Start typing before command handling so slow commands (!compact, etc.) show typing
  const typingInterval = await startTypingInterval(message.channel);

  const commandResult = await handleCommand(content, {
    agentService,
    promptQueue,
  });
  if (commandResult.handled) {
    stopTypingInterval(typingInterval);
    console.log("[discord] command handled", {
      messageId: message.id,
      command: content,
      hasResponse: Boolean(commandResult.response),
    });
    if (commandResult.response) {
      await sendReply(message, commandResult.response);
    }
    return;
  }

  // Not a command — typing already started, keep it going

  if (!message.channel.isSendable()) {
    stopTypingInterval(typingInterval);
    console.log("[discord] channel is not sendable", { messageId: message.id });
    return;
  }

  const queuePosition = promptQueue.getSnapshot().pending;
  console.log("[queue] enqueue request", {
    messageId: message.id,
    queuePosition,
  });
  if (queuePosition > 0) {
    await sendReply(
      message,
      `Queued. ${queuePosition} request(s) ahead of this one.`,
    );
  }

  const response = await promptQueue.enqueue(async () => {
    console.log(`[queue] processing message ${message.id}`);
    return agentService.prompt(content);
  });

  stopTypingInterval(typingInterval);
  console.log("[discord] response ready", {
    messageId: message.id,
    responseLength: response.length,
    preview: response.slice(0, 200),
  });
  await sendReply(message, response);
}

async function sendReply(message: Message, text: string): Promise<void> {
  if (!message.channel.isSendable()) {
    console.log("[discord] reply skipped, channel not sendable", {
      messageId: message.id,
    });
    return;
  }

  const chunks = chunkMessage(text);
  console.log("[discord] sending reply", {
    messageId: message.id,
    chunkCount: chunks.length,
    textLength: text.length,
  });

  const [firstChunk, ...remainingChunks] = chunks;
  if (!firstChunk) {
    return;
  }

  await message.reply(firstChunk);
  for (const chunk of remainingChunks) {
    await message.channel.send(chunk);
  }
}

const TYPING_INTERVAL_MS = 8000;

function startTypingInterval(channel: SendableChannels): NodeJS.Timeout {
  void channel.sendTyping();
  return setInterval(() => {
    void channel.sendTyping();
  }, TYPING_INTERVAL_MS);
}

function stopTypingInterval(interval: NodeJS.Timeout): void {
  clearInterval(interval);
}
