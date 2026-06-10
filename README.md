# @friendlyrobot/discord-pi-agent

Reusable Discord gateway for persistent pi agent sessions — DM and forum channels.

## What it does

- runs persistent pi agent sessions (one per DM, one per forum thread)
- resumes sessions on restart via scoped session directories
- loads project context from the target repo via pi resource loading
- accepts DM messages and forum thread messages from allowed users
- serializes prompts per-scope through FIFO queues
- exposes built-in session commands (per-scope, including `!archive`)
- can run scheduled prompt jobs from a JS/TS jobs file
- can run in Discord-only, scheduler-only, or combined mode

## Built-in commands

- `!help`
- `!status`
- `!thinking`
- `!model`
- `!compact`
- `!reload`
- `!jobs`
- `!job <id>`
- `!job update <freeform request>`
- `!jobs reload`
- `!reset-session`
- `!archive` (forum threads only — archives the thread and shuts down the session)

Any other text is sent to the active session (DM or thread).

When the scheduler is enabled, `!jobs` and `!job <id>` read the loaded runtime state, `!jobs reload` reloads the jobs file without restarting the process, and `!job update <freeform request>` turns your request into a scheduler-aware agent prompt that edits the jobs file in the normal agentic way.

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

Scheduled jobs are defined in a trusted JS/TS module. The file can export either:

- `jobs`
- `defineJobs()`
- a default export with either of those shapes

Example:

```ts
import {
  defineScheduledJobs,
  type ScheduledTaskDefinition,
} from "@friendlyrobot/discord-pi-agent";

export const jobs: ScheduledTaskDefinition[] = defineScheduledJobs([
  {
    id: "repo-heartbeat",
    schedule: {
      type: "every-minutes",
      interval: 30,
    },
    prompt: "Check the repo and summarize anything important.",
    reuseSession: false,
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
      strategy: "dedicated",
    },
    reuseSession: true,
    result: {
      target: "discord-dm",
      userId: "123456789012345678",
    },
  },
]);
```

`defineScheduledJobs(...)` is optional but recommended. It makes the jobs file contract explicit and validates definitions before the loader consumes them.

### Supported schedules

- `every-minutes`
- `daily-at`

### Session strategies

- `dedicated` — default, stored under `sessions/job-<id>/`
- `scope` — reuse an existing scope like `dm`, `thread:<id>`, or `job:<id>`

### Session reuse

- `reuseSession: false` — default, aborts the active scoped job session and starts a fresh one for the run
- `reuseSession: true` — resumes the existing scoped pi session for that job or scope

### Result targets

- `logs`
- `discord-dm`
- `discord-channel` — can also target a thread by using the thread ID

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
- Scheduled job sessions are stored in `sessions/job-<id>/` when using dedicated sessions
- Sessions survive restarts — `SessionManager.continueRecent()` resumes the latest `.jsonl`
- Single Discord client with all intents (DM + Guild + MessageContent)
- No mode flags — forum support activates when `discordAllowedForumChannelIds` is set
- The package does not register Discord slash commands
- pi resources are loaded from the configured `cwd` and `agentDir`
