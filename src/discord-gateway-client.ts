import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import type { AgentService } from "./agent-service";
import { handleDiscordMessage } from "./discord-message-handler";
import { sendReply } from "./discord-replies";
import { createModuleLogger } from "./logger";
import type { SessionRegistry } from "./session-registry";
import type { ResolvedDiscordGatewayConfig } from "./types";

const logger = createModuleLogger("discord-gateway");

export type GatewayAuthConfig = {
  discordAllowedUserId: string;
  discordAllowedForumChannelIds: string[];
  discordAllowedUserIds: string[];
  startupMessage: string | false;
};

export async function startGatewayClient(
  config: ResolvedDiscordGatewayConfig,
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
      await handleDiscordMessage(
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
