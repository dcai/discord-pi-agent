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
- can optionally self-review a reply and send one extra proactive follow-up
- can run in Discord-only, scheduler-only, or combined mode

## Attachment handling

This package uses separate mechanisms for different file types:

```text
text attachment      -> read directly as text
image / PDF / doc    -> media resolution path
                       -> pi vision-capable model or configured vision fallback
audio / voice msg    -> audio transcription path
                       -> OpenAI-compatible transcription API
                       -> Pi temporary-session cleanup pass
                       -> cleaned transcript text
```

Important:

- media understanding and audio transcription are **not** the same path
- images and documents go through `discord-media-resolution.ts`
- audio files and Discord voice messages go through `audio-transcription.ts`
- transcript cleanup then goes through `audio-transcript-post-process.ts`
- the final prompt gets the cleaned transcript only
- by default, the cleaned transcript is also echoed back into Discord as a quick reference
- this split is intentional because the current pi SDK flow in this repo supports image input, while audio still needs a separate transcription API before the Pi cleanup pass

## Built-in commands

- `!help`
- `!status`
- `!thinking`
- `!model`
- `!compact`
- `!session reset <scope|here>`
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

Loaded pi prompt templates also work through those same Discord prefixes. If pi has a `/review` prompt template from `.pi/prompts/`, `~/.pi/agent/prompts/`, or another loaded prompt source, you can invoke it in Discord as `!review ...` or `;review ...`. The package expands the template with pi's normal argument rules and sends the expanded prompt into the current DM or thread session.

Slash command handling uses the existing Discord gateway connection (`InteractionCreate`). It does **not** require a separate inbound webhook server or an extra public port on your VPS.

`!abort` cancels the active run for the current DM or thread scope and clears any queued prompts behind it.

`!session reset <scope|here>` clears persisted session data for a scope. The least-impact scope names are the existing internal ones: `dm`, `thread:<id>`, and `job:<id>`. Slash command `/session-reset` supports autocomplete for known scopes.

`/prompt` and `/p` are slash-only prompt entry points. They send text into the same DM/thread session as normal chat, keep Discord's interaction loading UI while the run is starting, and show an **Abort run** button on the ephemeral control reply. Slash job execution commands that start a run (`/job run` and `/job run-here`) reuse the same abort-button flow.

### Reply reflection

When `replyReflection` is enabled, the gateway can send one extra proactive follow-up after a normal prompt reply.

Current behavior:

- runs one hidden second-pass review after the main reply
- gives the model room for a small second thought: a useful eureka moment or sudden spark that did not make it into the first reply
- sends at most one extra follow-up message
- uses a temporary in-memory review session, so the review does not pollute the main DM/thread session history
- tries to use the same model as the main reply
- is available for normal message replies and slash prompt replies
- is intentionally conservative; the extra message is for meaningful corrections, clarifications, next steps, or brief warm/supportive encouragement when it genuinely helps
- keeps the response contract in this package (`<no_follow_up/>` or `<follow_up>...</follow_up>`) while letting the host app add custom review instructions

This feature is still a tuning area. Expect the review prompt and heuristics to evolve.

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
  // Optional one-message second-pass follow-up after each reply
  replyReflection: {
    enabled: true,
    instructions:
      "Be a bit more encouraging when the user is starting a long-term skill or hobby.",
  },
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
        interval: 60,
        timeZone: "Australia/Sydney",
        daysOfWeek: ["mon", "tue", "wed", "thu", "fri"],
        startTime: "09:00",
        endTime: "22:00",
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
        daysOfWeek: ["mon", "tue", "wed", "thu", "fri"],
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

`daily-at` supports:

- `hour`
- `minute`
- `timeZone?`
- `daysOfWeek?` — optional subset of `["sun", "mon", "tue", "wed", "thu", "fri", "sat"]`

`every-minutes` supports:

- `interval`
- `timeZone?`
- `daysOfWeek?` — optional subset of `["sun", "mon", "tue", "wed", "thu", "fri", "sat"]`
- `startTime?`
- `endTime?`

When `startTime` or `endTime` is set, both are required. The run window is inclusive, so `startTime: "09:00"` with `interval: 60` starts at 09:00, then 10:00, 11:00, and so on until the last run at or before `endTime`.

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
- `promptTimeZone` default: `PI_PROMPT_TIME_ZONE` or `UTC` — used for `sent_at_local` in Discord prompt metadata
- `promptLocale` default: `PI_PROMPT_LOCALE` or `en-AU` — used for `sent_at_local` in Discord prompt metadata
- `promptTransform` default: identity
- `startupMessage` default:
  `Bot is online and ready.\n```\nHost: <hostname>\nStarted: <local datetime>\n````
- `shutdownOnSignals` default: `true`
- `discordCommandPrefixes` default: `["!"]`
- `replyReflection` default: `false` — when enabled, the bot runs one hidden second-pass review after each prompt reply and may send one extra proactive follow-up if it adds clear value
  - `true` enables it with defaults
  - `{ enabled: true, maxFollowUpLength: 280 }` enables it with an explicit follow-up length cap
  - `{ enabled: true, instructions: "..." }` adds host-specific review guidance while the follow-up XML contract stays library-owned
- `audioTranscription` default: enabled — audio attachments and Discord voice messages are transcribed to text through a separate OpenAI-compatible audio transcription API, then cleaned through a Pi temporary-session pass before reaching the main agent
  - omit it to use the default enabled config
  - set `false` to disable it entirely
  - `{ provider: "openai", model: "gpt-4o-mini-transcribe", apiKey: process.env.PI_AUDIO_TRANSCRIPTION_API_KEY }` customizes the enabled config
  - optional `endpoint` for custom/self-hosted or non-OpenAI-compatible services
  - optional `prompt` adds host guidance for transcript cleanup while keeping the same language as the source transcript
  - optional `echoToDiscord` controls whether the cleaned transcript is echoed back into Discord as a quick reference (default: `true`)
  - `provider` currently auto-supports `openai`; for anything else, set `endpoint` explicitly
  - this is separate from `visionModelId` and the media resolution path
  - if disabled when an audio file arrives, the bot notes that audio was received but not transcribed
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

`loadDiscordGatewayConfigFromEnv()` only loads basic boot/runtime values.
Feature behavior should be configured in code through the config object.

The config loader reads:

- `DISCORD_BOT_TOKEN`
- `DISCORD_ALLOWED_USER_ID`
- `PI_AGENT_CWD`
- `PI_AGENT_DIR`
- `PI_MODEL_PROVIDER`
- `PI_MODEL_ID`
- `PI_PROMPT_TIME_ZONE`
- `PI_PROMPT_LOCALE`
- `DISCORD_FORUM_CHANNEL_IDS` — comma-separated forum channel IDs
- `DISCORD_ALLOWED_USER_IDS` — comma-separated allowed user IDs
- `DISCORD_COMMAND_PREFIXES` — comma-separated command prefixes (example: `!, ;`)
- `DISCORD_COMMAND_REGISTRATION_SCOPE` — `none`, `global`, or `guild`
- `DISCORD_COMMAND_REGISTRATION_GUILD_IDS` — comma-separated guild IDs for guild-scoped slash-command sync

If `PI_AGENT_CWD` is missing it falls back to `process.cwd()`.

For behavior config like `startupMessage`, `replyReflection`, and most of `audioTranscription`, pass values directly in the host app config object.

For audio transcription secrets specifically, the loader will automatically use:

- `PI_AUDIO_TRANSCRIPTION_API_KEY`
- `OPENAI_API_KEY` fallback

if `audioTranscription.apiKey` is not set in code.

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
