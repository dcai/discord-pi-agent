# AGENTS.md

Guide for coding agents working in this repository.

## What this repo is

This repo contains the standalone npm package:

- `@friendlyrobot/discord-pi-agent`

Purpose:

- reusable Discord gateway for persistent pi agent sessions
- supports DM and forum channel (thread-scoped) sessions
- generic package, not tied to any specific consumer app

This repo should stay focused on shared package logic.
Do not drift back into app-specific behavior.

## Core rules

### 1. Keep it generic

This package is shared infrastructure.
Do not hardcode:

- consumer-specific app names
- domain-specific wording from a downstream app
- repo-specific paths
- project-specific commands
- assumptions about a parent repo layout

If a consumer needs custom behavior, prefer config hooks like:

- `cwd`
- `agentDir`
- `promptTransform`
- `startupMessage`

### 2. Runtime `.env` belongs to the consumer app

Important:

- do **not** keep the active runtime `.env` in this package repo
- this repo may keep `.env.example` for documentation only
- real secrets should live in the consuming app repo

Example:

- the consumer app's `.env` is correct
- this package repo's `.env` should not be relied on for normal usage

### 3. KISS

Prefer:

- small config-driven APIs
- boring Node patterns
- minimal abstractions

Avoid:

- plugin systems unless clearly needed
- middleware stacks unless clearly needed
- auto-discovery magic based on directory structure
- consumer-specific convenience code in the shared package

## Repo structure

```text
src/
  agent-model-service.ts
  agent-resource-service.ts
  agent-service.ts
  commands.ts
  config.ts
  discord-gateway-client.ts   # Discord client bootstrapping + event wiring
  discord-message-handler.ts  # main message pipeline orchestration
  discord-auth.ts             # scope resolution + authorization helpers
  discord-attachments.ts      # text/media attachment helpers
  discord-media-resolution.ts # media -> prompt content / vision fallback
  discord-post-reply-review.ts # optional hidden second-pass review for one extra follow-up
  discord-replies.ts          # reply sending + working reaction helpers
  discord-typing.ts           # typing indicator lifecycle
  index.ts
  markdown-table-transformer.ts
  message-chunker.ts
  prompt-context.ts
  prompt-queue.ts
  reply-buffer.ts
  session-registry.ts         # scope-agnostic map (scope -> AgentSession + PromptQueue)
  types.ts

  *.test.ts                   # vitest unit tests
  __snapshots__/              # snapshot outputs for tests

dist/              # build output
README.md
package.json
tsconfig.json
.env.example
```

## Message pipeline note

The Discord gateway code is intentionally split now.
Keep `src/discord-gateway-client.ts` small.
Put message-flow logic in focused helpers like:

- `discord-message-handler.ts`
- `discord-auth.ts`
- `discord-attachments.ts`
- `discord-media-resolution.ts`
- `discord-post-reply-review.ts`
- `discord-replies.ts`
- `discord-typing.ts`

If `discord-gateway-client.ts` starts growing again, move logic out instead of piling more into it.

## Post-reply review note

The package now has an optional `postReplyReview` feature.

What it does:

- after a normal prompt reply, run one hidden second-pass review
- if that review finds a meaningful miss or correction, send one extra follow-up message
- keep it generic, short, and config-driven
- default stays off unless the consumer opts in

Current shape:

- main logic lives in `src/discord-post-reply-review.ts`
- normal message flow uses it in `src/discord-message-handler.ts`
- slash prompt flow uses it in `src/discord-interactions.ts`
- review runs in a temporary in-memory session so it does not pollute the main shared DM/thread session

Important:

- this is a likely tuning area; do not treat current prompt/heuristics as final
- preserve the strict "at most one extra follow-up" behavior unless the change is intentional
- if you change this feature, update `README.md` and tests for both message replies and slash prompt replies

## Debug logging note

The loud debug output in `src/reply-buffer.ts` is intentional for now.
This package is still used mostly by the repo owner, and the extra lifecycle visibility is useful when monitoring Discord message handling.

So for now:

- do not remove that debug output just because it is noisy
- do not "clean it up" as a library polish task by default
- treat it as deliberate local-operability tooling

Revisit this later, when the package is more mature and the shared-library tradeoff matters more.

## Public API expectations

Main exports live in `src/index.ts`.
Current public surface:

- `startDiscordGateway` — unified entry point (DM + forum threads)
- `loadDiscordGatewayConfigFromEnv`
- `resolveConfig`
- `buildDiscordMessageContextPrompt`
- `formatDiscordPromptTime`
- exported TS types from `./types`

When changing exports:

- keep API changes intentional
- avoid breaking consumer imports casually
- update `README.md` if public usage changes

## Build and validation

Use Node and npm for package workflow.

### Commands

```bash
npm install
npm run typecheck
npm run format
npm run build
npx vitest run            # single run
npx vitest                # watch mode
npx vitest run --update   # update snapshots
```

### Dependency updates

To check for newer package versions and update `package.json`, run:

```bash
npx npm-check-updates -u
npm install
```

Use this instead of the old `bun update` workflow.

### Build notes

- build uses `tsgo` for JS emit and declaration emit
- published output is multi-file ESM in `dist/`
- TS declarations are emitted into `dist/`

If packaging changes, always verify:

- `dist/index.js` does not contain broken repo-local path aliases
- consumer import works from another repo

## Local consumer testing

Typical local workflow:

### Register package link

```bash
cd /path/to/discord-pi-agent
npm link
```

### Consume from app repo

```bash
cd /path/to/consumer-app
npm link @friendlyrobot/discord-pi-agent
npm install
```

### Run consumer app

```bash
cd /path/to/consumer-app
npm start
```

## Publishing notes

Package details:

- name: `@friendlyrobot/discord-pi-agent`
- visibility: public

Before publish:

1. run `npm run typecheck`
2. run `npm run format`
3. run `npm run build`
4. inspect `dist/`
5. confirm README examples still match reality
6. optionally smoke test via linked consumer app

### How to publish

Run `npm version patch|minor|major` (choose level based on change significance).
This bumps version, commits, and pushes a tag.

The GitHub Action is trusted as the publisher — on tag push, it triggers and publishes automatically.

## Code style notes

- use TypeScript
- use ESM
- prefer relative imports inside the package source
- avoid repo-local path alias leakage in published output
- always use curly braces for `if/else`
- keep code readable over clever

## What not to do

Do not:

- add consumer-specific prompt text to package defaults
- rename generic config back to app-specific names like `appRepoCwd`
- assume the package is always run from its own repo root
- treat this package as the place to store bot secrets

## Safe change checklist

Before finishing a change, check:

- Is this still generic?
- Does this belong in the package rather than the consumer app?
- Does `npm run typecheck` pass?
- Does `npm run format` pass?
- Does `npm run build` pass?
- Would a linked consumer still import this cleanly?
- Is `README.md` updated if public command surface changed?

If the answer to the first two is shaky, the code probably belongs in the consumer app, not here.
