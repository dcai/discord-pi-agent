import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { createModuleLogger } from "./logger";
import type {
  GatewayAccessConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const logger = createModuleLogger("discord-client");

export function createDiscordClient(
  config: ResolvedDiscordGatewayConfig,
  accessConfig: GatewayAccessConfig,
): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ userTag: readyClient.user.tag }, "logged in");

    if (!accessConfig.startupMessage) {
      return;
    }

    try {
      const user = await readyClient.users.fetch(
        accessConfig.discordAllowedUserId,
      );
      const dmChannel = await user.createDM();
      await dmChannel.send(accessConfig.startupMessage);
      logger.info(
        {
          userId: accessConfig.discordAllowedUserId,
        },
        "sent startup dm",
      );
    } catch (error) {
      logger.error({ error }, "failed to send startup dm");
    }
  });

  return client;
}

export async function loginDiscordClient(
  client: Client,
  config: ResolvedDiscordGatewayConfig,
): Promise<void> {
  await client.login(config.discordBotToken);
}
