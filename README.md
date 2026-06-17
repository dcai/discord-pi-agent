# @friendlyrobot/discord-pi-agent

Reusable Discord gateway for persistent pi agent sessions — DM and forum channels.

## What it does

- runs persistent pi agent sessions (one per DM, one per forum thread)
- resumes sessions on restart via scoped session directories
- loads project context from the target repo via pi resource loading
- accepts DM messages and forum thread messages from allowed users
- serializes prompts per-scope through FIFO queues
- exposes built-in session commands (per-scope, including `!archive`)
- can expose slash commands, autocomplete, buttons, and reminder modals through Discord interactions
- can run scheduled prompt jobs from a JS/TS jobs file
- can run in Discord-only, scheduler-only, or combined mode

## Built-in commands

- `!help`
- `!status`
- `!thinking`
- `!model`
- `!compact`
- `!reload`
- `!remind <when>, <task>`
- `!jobs`
- `!job <id>`
- `!job info <id>`
- `!job run <id>`
- `!job run-here <id>`
- `!job update <freeform request>`
- `!jobs reload`
- `!abort`
- `!archive` (forum threads only — archives the thread and shuts down the session)

Any other text is sent to the active session (DM or thread).

## Command UX

The gateway supports two command entry points:

- **prefix commands** in regular Discord messages
- **slash commands** through Discord interactions

Prefix commands default to `!`. You can add others, such as `;`, with `discordCommandPrefixes`.

Slash command handling uses the existing Discord gateway connection (`InteractionCreate`). It does **not** require a separate inbound webhook server or an extra public port on your VPS.

`!abort` cancels the active run for the current DM or thread scope and clears any queued prompts behind it.

`/prompt` and `/p` are slash-only prompt entry points. They send text into the same DM/thread session as normal chat, keep Discord's interaction loading UI while the run is starting, and show an **Abort run** button on the ephemeral control reply.

### Slash command sync

Interaction handling is always wired in, but automatic slash-command registration is opt-in.

- `discordCommandRegistrationScope: "none"` (default) — do not auto-sync commands
- `discordCommandRegistrationScope: "global"` — sync global application commands
- `discordCommandRegistrationScope: "guild"` — sync guild-scoped commands using `discordCommandRegistrationGuildIds`

Guild-scoped sync is usually the best choice during development because Discord applies it faster than global command updates.

When the scheduler is enabled, `!jobs` shows the loaded runtime state with a prompt preview for each job, `!job <id>` runs a loaded job immediately in the current DM or thread, `!job info <id>` shows one job with its full prompt, `!job run <id>` runs a loaded job immediately with its configured result target, `!job run-here <id>` runs a loaded job immediately but overrides delivery to the current DM or thread, `!jobs reload` reloads the jobs file without restarting the process, and `!job update <freeform request>` turns your request into a scheduler-aware agent prompt that edits the jobs file in the normal agentic way.

Job IDs should avoid reserved subcommand words like `run`, `run-here`, `info`, and `update`.

`!remind <when>, <task>` creates a one-off runtime reminder from natural language. It is parsed through a temporary in-memory agent session, shows up in `!jobs`, runs once, and is then forgotten. It is not written back to the scheduled jobs file. Runtime reminders always target the current Discord conversation by saving `message.channel.id` as a `discord-channel` result target. In a DM, that is the DM channel ID. In a forum thread, that is the thread ID.

## Prompt metadata

Every Discord prompt is wrapped with lightweight Discord context before `promptTransform` runs:

```text
<discord_message_context>
{
  "scope": "thread",
  "sent_at": "2026-05-07T04:31:00.000Z",
  "sent_at_local": "Thu, 7 May 26, 14:31 AEST",
  "message_id": "...",
  "author_name": "Alice",
  "author_id": "...",
  "thread_title": "Bug report",
  "thread_id": "...",
  "forum_channel_id": "..."
}
</discord_message_context>

<user_message>
...
</user_message>
```

DM prompts omit thread-only fields. `sent_at_local` uses `promptTimeZone` and `promptLocale`.

When a forum thread's starter post body is edited, the next prompt also includes:

- `event_type: "thread_starter_edit"`
- `edited_at`
- `edited_at_local`

## Install

```bash
npm install @friendlyrobot/discord-pi-agent
```

## Usage

```ts
import {
  loadDiscordGatewayConfigFromEnv,
  startDiscordGateway,
} from "@friendlyrobot/discord-pi-agent";

const config = loadDiscordGatewayConfigFromEnv({
  cwd: process.cwd(),
  promptTimeZone: "Australia/Sydney",
  promptLocale: "en-AU",
  // Enable forum channel support (omit for DM-only)
  discordAllowedForumChannelIds: ["1498563501780897832"],
  // Optional extra prefix support
  discordCommandPrefixes: ["!", ";"],
  // Optional slash-command sync during startup
  discordCommandRegistrationScope: "guild",
  discordCommandRegistrationGuildIds: ["123456789012345678"],
});

await startDiscordGateway(config);
```

Each forum post creates a scoped pi session in `sessions/thread-<id>/`.
The initial post body becomes the first prompt. Sessions survive restarts.

### Discord + scheduler

```ts
import {
  loadDiscordGatewayConfigFromEnv,
  startDiscordGateway,
} from "@friendlyrobot/discord-pi-agent";

const config = loadDiscordGatewayConfigFromEnv({
  cwd: process.cwd(),
});

await startDiscordGateway(config, {
  scheduler: {
    jobsFile: "./scheduled-jobs.ts",
  },
});
```

### Scheduler-only mode

```ts
import {
  loadDiscordGatewayConfigFromEnv,
  startTaskScheduler,
} from "@friendlyrobot/discord-pi-agent";

const config = loadDiscordGatewayConfigFromEnv({
  cwd: process.cwd(),
});

await startTaskScheduler(config, {
  jobsFile: "./scheduled-jobs.ts",
});
```

Scheduler-only mode does not handle inbound Discord user messages. It only runs scheduled jobs and sends results to the configured targets.

## Scheduled jobs

Scheduled jobs are defined in a trusted JS/TS module.

The file must export:

- `loadScheduleJobs(context)`

The function receives:

- `context.config` — resolved Discord gateway config
- `context.schedulerConfig` — resolved scheduler config

Example:

```ts
import type { ScheduledJobsContext } from "@friendlyrobot/discord-pi-agent";

export function loadScheduleJobs(context: ScheduledJobsContext) {
  return [
    {
      id: "repo-heartbeat",
      schedule: {
        type: "every-minutes",
        interval: 30,
      },
      prompt: `Check ${context.config.cwd} and summarize anything important.`,
      result: {
        target: "logs",
      },
    },
    {
      id: "daily-standup",
      schedule: {
        type: "daily-at",
        hour: 9,
        minute: 0,
        timeZone: "Australia/Sydney",
      },
      prompt: "Review recent work and draft a standup update.",
      session: {
        strategy: "reuse",
        scope: "dm",
      },
      model: {
        provider: "openrouter",
        id: "anthropic/claude-sonnet-4",
      },
      result: {
        target: "discord-dm",
        userId: context.config.discordAllowedUserId,
      },
    },
    {
      id: "one-shot-report",
      schedule: {
        type: "every-minutes",
        interval: 60,
      },
      prompt: "Build a quick status report and post it.",
      session: {
        strategy: "ephemeral",
      },
      result: {
        target: "logs",
      },
    },
  ];
}
```

### Supported schedules

- `every-minutes`
- `daily-at`

### Session strategy

When `session` is omitted, the default is a fresh dedicated persistent session stored under `sessions/job-<id>/`.

- `strategy: "fresh"` — create a fresh persistent session for the run
- `strategy: "reuse"` — reuse the existing persistent session for the job or scope
- `strategy: "ephemeral"` — use a temporary in-memory session for the run
- `scope: "dm" | "thread:<id>" | "job:<id>"` — optional persistent scope to target with `fresh` or `reuse`

Examples:

- `{ strategy: "fresh" }` — fresh dedicated persistent job session
- `{ strategy: "reuse" }` — reuse the dedicated job session at `sessions/job-<id>/`
- `{ strategy: "reuse", scope: "dm" }` — reuse the DM session
- `{ strategy: "fresh", scope: "thread:123" }` — replace the thread session with a fresh persistent one
- `{ strategy: "ephemeral" }` — one-shot in-memory session, never saved

### Model override

Jobs can optionally set `model: { provider, id }`.

- omit `model` to use the gateway default model from `config.modelProvider` and `config.modelId`
- use `model` when one job should run on a different LLM provider/model
- avoid model overrides on shared `dm` or `thread:<id>` scopes; use a dedicated `job:<id>` scope instead

### Result targets

- `logs`
- `discord-dm`
- `discord-channel` — can also target a thread by using the thread ID

Discord scheduled job deliveries intentionally send each message chunk with embeds suppressed. This keeps digest-style jobs clean when the model includes links. If you still want clickable links without previews, format them as `<https://example.com>` in the prompt or model output.

## Config

### Required

- `discordBotToken`
- `discordAllowedUserId`
- `cwd`

### Optional

- `agentDir` default: `<cwd>/.pi-agent`
- `modelProvider` default: `openrouter`
- `modelId` default: `anthropic/claude-3.5-haiku`
- `thinkingLevel` default: `medium` (values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`)
- `promptTimeZone` default: `UTC` — used for `sent_at_local` in Discord prompt metadata
- `promptLocale` default: `en-AU` — used for `sent_at_local` in Discord prompt metadata
- `promptTransform` default: identity
- `startupMessage` default: `Bot is online and ready.`
- `shutdownOnSignals` default: `true`
- `discordCommandPrefixes` default: `["!"]`
- `discordCommandRegistrationScope` default: `"none"`
- `discordCommandRegistrationGuildIds` default: `[]`
- scheduler via `startDiscordGateway(config, { scheduler: { jobsFile } })`

### Scheduler config

- `jobsFile` — required JS/TS jobs module path, resolved from `cwd` when relative

### Logging

The package uses `pino` for structured logs.

Behavior:

- when stdout is a TTY, logs use `pino-pretty` for readable local console output
- when stdout is not a TTY, logs stay as JSON

Log level env vars:

- `DISCORD_PI_AGENT_LOG_LEVEL`
- `LOG_LEVEL` fallback

Optional observability env vars:

- `DISCORD_PI_AGENT_LOG_RAW_EVENTS=true` — log short summaries of raw Discord gateway packets (`t`, `op`, `s`, ids, short preview)

Default level is `info`.

For detailed prompt and tool monitoring during local runs, use:

```bash
DISCORD_PI_AGENT_LOG_LEVEL=debug
```

Pretty console logs use:

- colors
- local timestamp (`SYS:standard`)
- level first
- hidden `pid` and `hostname`
- module-aware labels like `[discord-gateway]`
- direction markers like `IN` and `OUT`
- multi-line payload blocks for easier input/output inspection

### Forum channel options

- `discordAllowedForumChannelIds` — string array of forum channel IDs to respond in
- `discordAllowedUserIds` — string array of allowed user IDs (defaults to `[discordAllowedUserId]`)

## Env helpers

`loadDiscordGatewayConfigFromEnv()` — the config loader:

- `DISCORD_BOT_TOKEN`
- `DISCORD_ALLOWED_USER_ID`
- `PI_AGENT_CWD`
- `PI_AGENT_DIR`
- `PI_MODEL_PROVIDER`
- `PI_MODEL_ID`
- `PI_PROMPT_TIME_ZONE`
- `PI_PROMPT_LOCALE`
- `DISCORD_STARTUP_MESSAGE`
- `DISCORD_FORUM_CHANNEL_IDS` — comma-separated forum channel IDs
- `DISCORD_ALLOWED_USER_IDS` — comma-separated allowed user IDs
- `DISCORD_COMMAND_PREFIXES` — comma-separated command prefixes (example: `!, ;`)
- `DISCORD_COMMAND_REGISTRATION_SCOPE` — `none`, `global`, or `guild`
- `DISCORD_COMMAND_REGISTRATION_GUILD_IDS` — comma-separated guild IDs for guild-scoped slash-command sync

If `PI_AGENT_CWD` is missing it falls back to `process.cwd()`.
Set `DISCORD_STARTUP_MESSAGE=false` to disable the startup DM.

## Thinking Levels

Use `!thinking` to view the current thinking/reasoning level and available options. Use `!thinking <level>` to set it (e.g., `!thinking high`).

Not all models support thinking/reasoning. The configured `thinkingLevel` is applied automatically when the model supports it.

## Build

```bash
npm run build
npm run typecheck
```

## Dependency updates

To check for newer package versions and update `package.json`, run:

```bash
npx npm-check-updates -u
npm install
```

This is the npm-side replacement for the old `bun update` workflow.

## Notes

- DM and forum threads supported via `startDiscordGateway`
- scheduled jobs are opt-in through `startDiscordGateway(config, { scheduler })`
- `startTaskScheduler()` runs the scheduler without inbound Discord message handling
- Forum thread sessions are stored in `sessions/thread-<id>/` (one directory per thread)
- Scheduled job sessions are stored in `sessions/job-<id>/` when using dedicated persistent sessions
- Ephemeral scheduled jobs use in-memory sessions and do not write session files
- Sessions survive restarts — `SessionManager.continueRecent()` resumes the latest `.jsonl`
- Single Discord client with all intents (DM + Guild + MessageContent)
- No mode flags — forum support activates when `discordAllowedForumChannelIds` is set
- The package does not register Discord slash commands
- pi resources are loaded from the configured `cwd` and `agentDir`
