# @friendlyrobot/discord-pi-agent

Reusable Discord DM bridge for persistent pi agent sessions.

## What it does
- runs one long-lived pi agent session
- resumes the latest session on restart
- loads project context from the target repo via pi resource loading
- accepts DM messages from one allowed Discord user
- serializes prompts through a FIFO queue
- exposes built-in session commands

## Built-in commands
- `!help`
- `!status`
- `!compact`
- `!reset-session`

Any other DM text is sent to the persistent agent session.

## Install

```bash
bun add @friendlyrobot/discord-pi-agent
```

## Minimal usage

```ts
import { startDiscordPiBridge } from "@friendlyrobot/discord-pi-agent";

const bridge = await startDiscordPiBridge({
  discordBotToken: process.env.DISCORD_BOT_TOKEN!,
  discordAllowedUserId: process.env.DISCORD_ALLOWED_USER_ID!,
  cwd: process.cwd(),
  modelProvider: "moonshot-cn",
  modelId: "kimi-k2.5",
});
```

## Usage with dotenv and time context

```ts
import {
  buildTimeContextPrompt,
  loadDiscordPiBridgeConfigFromEnv,
  startDiscordPiBridge,
} from "@friendlyrobot/discord-pi-agent";

const config = loadDiscordPiBridgeConfigFromEnv({
  promptTransform: (input) => {
    return buildTimeContextPrompt(input, {
      timeZone: "Australia/Sydney",
      locale: "en-AU",
      locationLabel: "Sydney",
    });
  },
});

await startDiscordPiBridge(config);
```

## Config

### Required
- `discordBotToken`
- `discordAllowedUserId`
- `cwd`

### Optional
- `agentDir` default: `<cwd>/.pi-agent`
- `modelProvider` default: `moonshot-cn`
- `modelId` default: `kimi-k2.5`
- `promptTransform` default: identity
- `startupMessage` default: `Bot is online and ready.`
- `shutdownOnSignals` default: `true`

## Env helper

`loadDiscordPiBridgeConfigFromEnv()` supports:

- `DISCORD_BOT_TOKEN`
- `DISCORD_ALLOWED_USER_ID`
- `PI_AGENT_CWD`
- `PI_AGENT_DIR`
- `PI_MODEL_PROVIDER`
- `PI_MODEL_ID`
- `DISCORD_STARTUP_MESSAGE`

If `PI_AGENT_CWD` is missing it falls back to `process.cwd()`.

Set `DISCORD_STARTUP_MESSAGE=false` to disable the startup DM.

## Build

```bash
bun run build
bun run typecheck
```

## Notes
- DM-only by design
- single allowed user by design
- the package does not register Discord slash commands
- pi resources are loaded from the configured `cwd` and `agentDir`
