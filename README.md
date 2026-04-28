# @friendlyrobot/discord-pi-agent

Reusable Discord gateway bridge for persistent pi agent sessions — DM and forum channels.

## What it does

- runs persistent pi agent sessions (one per DM, one per forum thread)
- resumes sessions on restart via scoped session directories
- loads project context from the target repo via pi resource loading
- accepts DM messages and forum thread messages from allowed users
- serializes prompts per-scope through FIFO queues
- exposes built-in session commands (per-scope, including `!archive`)

## Built-in commands

- `!help`
- `!status`
- `!thinking`
- `!compact`
- `!reload`
- `!reset-session`
- `!archive` (forum threads only — archives the thread and shuts down the session)

Any other text is sent to the active session (DM or thread).

## Install

```bash
bun add @friendlyrobot/discord-pi-agent
```

## Minimal usage

```ts
// Legacy DM-only entry point (backward compatible)
import { startDiscordPiBridge } from "@friendlyrobot/discord-pi-agent";

const bridge = await startDiscordPiBridge({
  discordBotToken: process.env.DISCORD_BOT_TOKEN!,
  discordAllowedUserId: process.env.DISCORD_ALLOWED_USER_ID!,
  cwd: process.cwd(),
  modelProvider: "openrouter",
  modelId: "anthropic/claude-3.5-haiku",
});
```

## Forum channel usage

```ts
import {
  loadDiscordGatewayConfigFromEnv,
  startDiscordGateway,
} from "@friendlyrobot/discord-pi-agent";

const config = loadDiscordGatewayConfigFromEnv({
  cwd: process.cwd(),
  discordAllowedForumChannelIds: ["1498563501780897832"],
});

await startDiscordGateway(config);
```

Each forum post (thread) creates a scoped pi session. The initial post body becomes the first
prompt. Sessions persist across restarts and are scoped to `sessions/thread-<id>/`.

## Usage with dotenv and time context

```ts
import {
  buildTimeContextPrompt,
  loadDiscordGatewayConfigFromEnv,
  startDiscordGateway,
} from "@friendlyrobot/discord-pi-agent";

const config = loadDiscordGatewayConfigFromEnv({
  promptTransform: (input) => {
    return buildTimeContextPrompt(input, {
      timeZone: "Australia/Sydney",
      locale: "en-AU",
    });
  },
});

await startDiscordGateway(config);
```

## Config

### Required (all modes)

- `discordBotToken`
- `discordAllowedUserId`
- `cwd`

### Optional (all modes)

- `agentDir` default: `<cwd>/.pi-agent`
- `modelProvider` default: `openrouter`
- `modelId` default: `anthropic/claude-3.5-haiku`
- `thinkingLevel` default: `medium` (values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`)
- `promptTransform` default: identity
- `startupMessage` default: `Bot is online and ready.`
- `shutdownOnSignals` default: `true`

### Forum channel options (`startDiscordGateway`)

- `discordAllowedForumChannelIds` — string array of forum channel IDs to respond in
- `discordAllowedUserIds` — string array of allowed user IDs (defaults to `[discordAllowedUserId]`)
- `sessionIdleTimeoutMs` — auto-shutdown idle thread sessions (null = never)

## Env helpers

`loadDiscordPiBridgeConfigFromEnv()` — legacy DM-only config:

- `DISCORD_BOT_TOKEN`
- `DISCORD_ALLOWED_USER_ID`
- `PI_AGENT_CWD`
- `PI_AGENT_DIR`
- `PI_MODEL_PROVIDER`
- `PI_MODEL_ID`
- `DISCORD_STARTUP_MESSAGE`

`loadDiscordGatewayConfigFromEnv()` — same as above, plus:

- `DISCORD_FORUM_CHANNEL_IDS` — comma-separated forum channel IDs
- `DISCORD_ALLOWED_USER_IDS` — comma-separated allowed user IDs
- `DISCORD_SESSION_IDLE_TIMEOUT_MS` — idle timeout in ms

If `PI_AGENT_CWD` is missing it falls back to `process.cwd()`.

Set `DISCORD_STARTUP_MESSAGE=false` to disable the startup DM.

## Thinking Levels

Use `!thinking` to view the current thinking/reasoning level and available options. Use `!thinking <level>` to set it (e.g., `!thinking high`).

Not all models support thinking/reasoning. The configured `thinkingLevel` is applied automatically when the model supports it.

## Build

```bash
bun run build
bun run typecheck
```

## Notes

- DM and forum threads supported via the unified `startDiscordGateway` entry point
- `startDiscordPiBridge` is a backward-compatible wrapper around `startDiscordGateway`
- Forum thread sessions are stored in `sessions/thread-<id>/` (one directory per thread)
- Sessions survive restarts — `SessionManager.continueRecent()` resumes the latest `.jsonl`
- Single Discord client with all intents (DM + Guild + MessageContent)
- No mode flags — forum support activates when `discordAllowedForumChannelIds` is set
- The package does not register Discord slash commands
- pi resources are loaded from the configured `cwd` and `agentDir`
