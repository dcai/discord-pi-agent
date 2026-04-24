# AGENTS.md

Guide for coding agents working in this repository.

## What this repo is

This repo contains the standalone npm package:

- `@friendlyrobot/discord-pi-agent`

Purpose:

- reusable Discord DM bridge for persistent pi agent sessions
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
- boring Node/Bun patterns
- minimal abstractions

Avoid:

- plugin systems unless clearly needed
- middleware stacks unless clearly needed
- auto-discovery magic based on directory structure
- consumer-specific convenience code in the shared package

## Repo structure

```text
src/
  agent-service.ts
  commands.ts
  config.ts
  discord-client.ts
  index.ts
  message-chunker.ts
  prompt-context.ts
  prompt-queue.ts
  reply-buffer.ts
  types.ts

dist/              # build output
README.md
package.json
tsconfig.json
.env.example
```

## Public API expectations

Main exports live in `src/index.ts`.
Current public surface:

- `startDiscordPiBridge`
- `resolveConfig`
- `loadDiscordPiBridgeConfigFromEnv`
- `buildTimeContextPrompt`
- exported TS types from `./types`

When changing exports:

- keep API changes intentional
- avoid breaking consumer imports casually
- update `README.md` if public usage changes

## Build and validation

Use Bun for package workflow.

### Commands

```bash
bun install
bun run typecheck
bun run format
bun run build
```

### Build notes

- build uses `bun build`
- dependencies should stay external in the published bundle
- TS declarations are emitted into `dist/`

If packaging changes, always verify:

- `dist/index.js` does not contain broken repo-local path aliases
- consumer import works from another repo

## Local consumer testing

Typical local workflow:

### Register package link

```bash
cd /path/to/discord-pi-agent
bun link
```

### Consume from app repo

```bash
cd /path/to/consumer-app
bun link @friendlyrobot/discord-pi-agent
bun install
```

### Run consumer app

```bash
cd /path/to/consumer-app
bun start
```

## Publishing notes

Package details:

- name: `@friendlyrobot/discord-pi-agent`
- visibility: public

Before publish:

1. run `bun run typecheck`
2. run `bun run format`
3. run `bun run build`
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
- Does `bun run typecheck` pass?
- Does `bun run format` pass?
- Does `bun run build` pass?
- Would a linked consumer still import this cleanly?
- Is `README.md` updated if public command surface changed?

If the answer to the first two is shaky, the code probably belongs in the consumer app, not here.
