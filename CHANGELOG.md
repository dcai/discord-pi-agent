## [0.27.16] - 2026-06-18

### 🚀 Features

- *(prompt)* Use env-backed defaults for prompt timezone/locale
## [0.27.15] - 2026-06-18

### 🚀 Features

- *(reminder)* [**breaking**] Parse reminders via AgentService session and remove chrono-node
## [0.27.14] - 2026-06-18

### 🚀 Features

- *(commands)* [**breaking**] Reorganize session/discord command code, add timezone-aware reminders and delivery provider
## [0.27.13] - 2026-06-18

### 🚀 Features

- *(config)* Include package name in startup message and wrap message in code block
## [0.27.12] - 2026-06-18

### 🚀 Features

- *(config)* Enrich default startupMessage with host, start time and version
## [0.27.11] - 2026-06-18

### 🚀 Features

- *(session)* Add session reset command and slash support
## [0.27.10] - 2026-06-17

### 🚀 Features

- *(scheduler)* Add optional daysOfWeek to daily-at schedules
- *(scheduler)* Add constrained every-minutes schedules (timezone, weekdays, time window)

### 📚 Documentation

- Add release notes for versions 0.26.0 through 0.27.6
## [0.27.9] - 2026-06-17

### 🚀 Features

- *(discord)* Add shared abort-button flow for prompt and job runs
## [0.27.8] - 2026-06-17

### 🚀 Features

- *(discord-interactions)* Add slash-only /prompt and /p prompt commands with abort UI
## [0.27.7] - 2026-06-17

### 🚀 Features

- *(session)* [**breaking**] Add `abort` command to cancel active runs and clear queued prompts
## [0.27.6] - 2026-06-17

### 🚀 Features

- *(discord)* Add Discord interactions (slash commands, autocomplete, buttons, modals) and configurable command prefixes/registration

### ⚙️ Miscellaneous Tasks

- *(scripts)* Limit prettier format to ./src
## [0.27.5] - 2026-06-15

### 🚀 Features

- *(task-scheduler)* Support per-job model overrides and ensure sessions use requested model

### 🎨 Styling

- *(format)* Normalize formatting and quoting across files
## [0.27.4] - 2026-06-14

### 📚 Documentation

- *(session-commands)* Add job definition examples to buildJobUpdatePrompt
## [0.27.3] - 2026-06-14

### 🚀 Features

- *(gateway)* Add raw gateway event logging and message partials
## [0.27.2] - 2026-06-14

### 🚀 Features

- *(forum)* Handle forum thread starter edits and enrich metadata with edit event

### 🎨 Styling

- Format code with consistent line breaks and object formatting
## [0.27.1] - 2026-06-12

### 🚀 Features

- *(deps)* Add jiti dependency
- *(loader)* Use Jiti for TypeScript module loading with hot reload
## [0.27.0] - 2026-06-12

### 🚀 Features

- *(scheduler)* [**breaking**] Require jobs file to export loadScheduleJobs(context) with config context
## [0.26.3] - 2026-06-11

### 🚀 Features

- *(commands)* [**breaking**] Change !job <id> to run in current conversation, add !job info for job details
## [0.26.2] - 2026-06-10

### 🚀 Features

- *(scheduler)* Add manual job run commands (`!job run` and `!job run-here`)
## [0.26.1] - 2026-06-10

### 🚀 Features

- *(discord)* Suppress embeds in scheduled job deliveries
## [0.26.0] - 2026-06-10

### 🚀 Features

- *(scheduler)* [**breaking**] Replace reuseSession with session strategies and add ephemeral support

### 📚 Documentation

- Update CHANGELOG.md with detailed release notes for all versions

### ⚙️ Miscellaneous Tasks

- *(publish)* Remove verbose flag from git-cliff action arguments
## [0.25.3] - 2026-06-10

### ⚙️ Miscellaneous Tasks

- *(smoke)* Isolate smoke tests into separate directory and vitest config
- *(publish)* Automate release notes generation and GitHub release creation
## [0.25.2] - 2026-06-10

### 🚀 Features

- *(remind)* Clarify result target resolution for runtime reminders
## [0.25.1] - 2026-06-10

### 🚀 Features

- *(scheduler)* Show job prompt in !jobs and !job commands
## [0.25.0] - 2026-06-10

### 🚀 Features

- *(reminders)* Add runtime "!remind" command and runtime reminder support
## [0.24.2] - 2026-06-10

### 🚀 Features

- *(scheduler)* [**breaking**] Add reuseSession option to scheduled jobs and session handling
## [0.24.1] - 2026-06-10

### 🚀 Features

- *(session-commands)* Extract formatter and improve !jobs output
## [0.24.0] - 2026-06-10

### 🚀 Features

- *(scheduled-jobs)* Add defineScheduledJobs helper and sandboxed job loader

### 🐛 Bug Fixes

- *(scheduled-job-loader)* Ensure jobs file is reloaded after changes
## [0.23.2] - 2026-06-10

### 🚀 Features

- *(scheduler)* Add `!job update` to build scheduler-aware agent prompts and forward into agent pipeline
## [0.23.1] - 2026-06-10

### 🚀 Features

- *(scheduler)* Expose task scheduler runtime state and add !jobs / !job commands
## [0.23.0] - 2026-06-10

### 🚀 Features

- *(scheduler)* Add task scheduler, scheduled-job loader & delivery; extract discord client
## [0.22.10] - 2026-06-10

### 🐛 Bug Fixes

- *(discord-response-formatter)* Normalize inline opening fences with info strings
## [0.22.9] - 2026-06-09

### 🚀 Features

- *(agent-turn-runner)* Improve error handling to provide contextual messages for streamed vs non-streamed errors
## [0.22.8] - 2026-06-06

### 🚀 Features

- *(agent-turn-runner)* Add logging for auto-retry events and failure
## [0.22.7] - 2026-06-03

### 🚜 Refactor

- Rename markdown-table-transformer to discord-response-formatter
## [0.22.6] - 2026-06-03

### 🚜 Refactor

- Rename transformMarkdownTablesToCodeBlocks to formatResponseForDiscord
## [0.22.5] - 2026-06-03

### 🐛 Bug Fixes

- *(chunker)* Split oversized multi-line code blocks at line boundaries
## [0.22.4] - 2026-06-03

### 🐛 Bug Fixes

- *(message-chunker)* Split oversized code blocks into multiple valid Discord messages
## [0.22.2] - 2026-05-27

### 🐛 Bug Fixes

- *(discord)* Serialize tool reaction operations to ensure proper cleanup
## [0.22.1] - 2026-05-27

### 🐛 Bug Fixes

- *(discord-replies)* Improve unicode emoji matching for reaction removal
## [0.22.0] - 2026-05-27

### 🚀 Features

- *(discord)* Add tool reaction emojis for agent tool events
## [0.21.4] - 2026-05-27

### 🚜 Refactor

- Improve type safety and structure for Discord message handling
## [0.21.3] - 2026-05-27

### 🐛 Bug Fixes

- *(agent-turn-runner)* Update getLatestAssistantText to support flexible message types
## [0.21.2] - 2026-05-27

### ⚙️ Miscellaneous Tasks

- Migrate build and workflow from Bun to Node/npm
## [0.21.1] - 2026-05-26

### 🚜 Refactor

- *(prompt-context)* Simplify promptTransform context and metadata handling
## [0.21.0] - 2026-05-26

### 🚀 Features

- *(prompt-transform)* [**breaking**] Pass context object to promptTransform for flexible Discord metadata wrapping
## [0.20.0] - 2026-05-25

### 🧪 Testing

- *(markdown-table-transformer)* Improve code fence normalization for edge cases
## [0.19.19] - 2026-05-22

### 🧪 Testing

- *(config)* Update PI_VISION_MODEL_ID to gemini-3.1-flash-lite in environment test
## [0.19.18] - 2026-05-20

### 🐛 Bug Fixes

- *(agent-turn-runner)* Comment out logging of tool input for debug logs
## [0.19.17] - 2026-05-19

### ⚙️ Miscellaneous Tasks

- *(logging)* Reduce debug log verbosity in agent-turn-runner and discord-message-handler
## [0.19.16] - 2026-05-19

### 🚀 Features

- *(commands)* Add !reaction command to set working reaction emoji per session
## [0.19.15] - 2026-05-19

### 🚀 Features

- *(discord-replies)* Add sendCommandReply for code-fenced command responses
## [0.19.14] - 2026-05-19

### 🚜 Refactor

- *(discord-replies)* Add codeFence option to sendReply and update usage
## [0.19.13] - 2026-05-19

### 🧪 Testing

- Update expected reply format in handleDiscordMessage test to use code block
## [0.19.12] - 2026-05-19

### 🚀 Features

- Format command responses in code fences for Discord messages
## [0.19.11] - 2026-05-19

### 🐛 Bug Fixes

- *(agent-turn-runner)* Improve tool output extraction for object content arrays
## [0.19.10] - 2026-05-19

### 🚜 Refactor

- Simplify extractToolOutput by removing JSON parsing and handling arrays directly
## [0.19.9] - 2026-05-19

### 🐛 Bug Fixes

- Improve tool output extraction to handle JSON arrays and text types
## [0.19.8] - 2026-05-19

### 🚜 Refactor

- Simplify extractToolOutput logic and remove related tests
## [0.19.6] - 2026-05-19

### 🧪 Testing

- *(agent-turn-runner)* Add tests for extractToolOutput handling of bash tool event outputs
## [0.19.5] - 2026-05-18

### 🚜 Refactor

- Improve formatting and tool output extraction logic
## [0.19.4] - 2026-05-18

### 🚀 Features

- *(agent-turn-runner)* Improve logging for tool execution events

### ⚙️ Miscellaneous Tasks

- *(scripts)* Set LOG_LEVEL for vitest commands in package scripts
## [0.19.3] - 2026-05-18

### 🚜 Refactor

- Rename reply-buffer to agent-turn-runner
## [0.19.2] - 2026-05-18

### 🚜 Refactor

- *(logging)* Adjust logging levels and comment out debug logs
## [0.19.1] - 2026-05-18

### 🧪 Testing

- Exclude src/types.ts from coverage reports in vitest config
## [0.19.0] - 2026-05-18

### 🧪 Testing

- Add comprehensive unit tests for config, agent model, discord message handler, prompt queue, and session commands
- Add unit tests for agent, resource, gateway client, and index modules
- Add comprehensive tests for discord attachments, media resolution, replies, typing, media description, and reply buffer

### ⚙️ Miscellaneous Tasks

- Comment out coverage report upload in publish workflow
- *(build)* Use tsconfig.build.json for build and exclude test files
## [0.18.2] - 2026-05-18

### ⚙️ Miscellaneous Tasks

- Simplify publish workflow by removing version check and path filter
## [0.18.1] - 2026-05-18

### ⚙️ Miscellaneous Tasks

- Add test coverage reporting to publish workflow
## [0.18.0] - 2026-05-18

### 🚜 Refactor

- Rename command and media modules for clarity
## [0.17.1] - 2026-05-18

### 📚 Documentation

- Add debug logging policy note and refactor config/session-registry naming
## [0.17.0] - 2026-05-18

### 🚜 Refactor

- *(agent-service)* Extract model and resource management to dedicated services
## [0.16.1] - 2026-05-18

### 🚜 Refactor

- *(config)* Remove sessionIdleTimeoutMs option and related code
## [0.16.0] - 2026-05-18

### 🚜 Refactor

- Rename functions and methods for clarity and consistency
## [0.15.0] - 2026-05-18

### 🚀 Features

- [**breaking**] Remove legacy bridge API and standardize on gateway naming

### 🚜 Refactor

- *(discord)* Modularize Discord gateway logic into focused files

### 📚 Documentation

- Update AGENTS.md with detailed file descriptions and message pipeline guidance

### 🧪 Testing

- *(commands)* Add unit tests for handleCommand and refactor command handling logic

### ⚙️ Miscellaneous Tasks

- Add mise.toml with bun and node tool versions
## [0.14.1] - 2026-05-18

### 🚀 Features

- *(agent-service)* Add skills summary to session status output
## [0.14.0] - 2026-05-18

### 🚀 Features

- *(media)* Add support for Word, Excel, and PowerPoint attachments
## [0.13.0] - 2026-05-18

### 🚀 Features

- *(media)* Add support for PDF attachments alongside images
## [0.12.0] - 2026-05-18

### 🚀 Features

- *(vision)* Add image attachment handling and vision model integration
- *(vision)* Support native image passthrough for vision-capable models
## [0.11.2] - 2026-05-15

### 🧪 Testing

- Update debug-print test snapshots
## [0.11.1] - 2026-05-15

### 🐛 Bug Fixes

- *(debug-print)* Append label to END fence in debugPrint output
## [0.11.0] - 2026-05-15

### 🚀 Features

- Inline text attachments in messages by fetching and appending their content
## [0.10.6] - 2026-05-14

### 🐛 Bug Fixes

- Improve logging messages for typing status and command handling
## [0.10.5] - 2026-05-09

### ⚙️ Miscellaneous Tasks

- *(reply-buffer)* Update debug print label for clarity
## [0.10.4] - 2026-05-09

### 🧪 Testing

- *(debug-print)* Add tests and snapshots for debugPrint with improved fence formatting
## [0.10.3] - 2026-05-09

### 🚜 Refactor

- *(logging)* Simplify and comment out structured logging details
## [0.10.2] - 2026-05-09

### 🚜 Refactor

- *(reply-buffer)* Update logging to use truncated tool output and comment out prompt debug logs
## [0.10.1] - 2026-05-09

### 🐛 Bug Fixes

- *(reply-buffer)* Improve logging for tool events

### 📚 Documentation

- Remove reference to legacy discord-client.ts in AGENTS.md
## [0.10.0] - 2026-05-09

### 🚜 Refactor

- *(reply-buffer)* Improve logging details and remove unused variables
## [0.9.9] - 2026-05-09

### 🚀 Features

- *(commands)* Show loaded tools and extensions in session status
## [0.9.8] - 2026-05-09

### 🐛 Bug Fixes

- *(discord-gateway-client)* Improve typing 429 warning log with response body and delay
## [0.9.7] - 2026-05-09

### 🚜 Refactor

- *(debug-print)* Simplify debug output formatting and remove unused import
## [0.9.6] - 2026-05-09

### 🚀 Features

- *(debug)* Add debugPrint utility and integrate for improved debug output

### ⚙️ Miscellaneous Tasks

- *(logging)* Comment out debug log in gateway client and add prompt info logs in reply buffer
## [0.9.5] - 2026-05-09

### ⚙️ Miscellaneous Tasks

- *(logging)* Reduce log level for typing events and add console output for debugging
## [0.9.4] - 2026-05-09

### 🐛 Bug Fixes

- *(typing)* Improve typing indicator handling and 429 retry logic
## [0.9.3] - 2026-05-09

### 🐛 Bug Fixes

- *(discord-gateway-client)* Improve sendTypingSafe diagnostics with detailed raw fetch response
## [0.9.2] - 2026-05-09

### 🐛 Bug Fixes

- *(discord-gateway-client)* Add race between sendTyping and raw fetch to diagnose hanging issue
## [0.9.1] - 2026-05-09

### 🚜 Refactor

- Improve logging formatting and typing indicator handling
## [0.9.0] - 2026-05-09

### 🚜 Refactor

- Remove legacy discord-client and enhance typing indicator logging in gateway client
## [0.8.3] - 2026-05-09

### 🚀 Features

- *(ui)* Add working reaction emoji to messages during processing
## [0.8.2] - 2026-05-09

### 🐛 Bug Fixes

- *(discord)* Prevent duplicate typing intervals per channel
## [0.8.1] - 2026-05-09

### 🐛 Bug Fixes

- *(discord)* Ensure typing indicator is stopped even on prompt errors
## [0.7.8] - 2026-05-08

### 🚀 Features

- *(reply-buffer)* Add debug logging for markdown table transformation
## [0.7.7] - 2026-05-08

### 🐛 Bug Fixes

- *(agent-service)* Retain existing session model when resuming from disk
## [0.7.6] - 2026-05-08

### 🐛 Bug Fixes

- *(commands)* Trim whitespace from provider and modelId when switching models
## [0.7.5] - 2026-05-08

### 🚀 Features

- *(reply-buffer)* Add model info to debug logs for improved traceability
## [0.7.4] - 2026-05-08

### 🚀 Features

- *(agent-service)* Add optional session parameter to model-related methods
## [0.7.3] - 2026-05-07

### 🚀 Features

- *(reply-buffer)* Include prompt in log context for prompt start
## [0.7.2] - 2026-05-07

### 🚜 Refactor

- *(logging)* Move message received logging into onMessage handler
## [0.7.1] - 2026-05-07

### 🚜 Refactor

- *(logger)* Remove logPayload utility and reduce logging verbosity
## [0.7.0] - 2026-05-07

### 🚀 Features

- *(logging)* Replace console logging with pino-based structured logger

### 🚜 Refactor

- *(logging)* Introduce module-aware loggers and structured payload logging
## [0.6.1] - 2026-05-07

### ⚙️ Miscellaneous Tasks

- *(gateway)* Remove thread message debug logging and add prompt content debug log
## [0.6.0] - 2026-05-07

### 🚀 Features

- *(prompt)* Add Discord prompt metadata with time zone and locale support
## [0.5.9] - 2026-05-06

### 🚀 Features

- *(commands)* Add !model command to list and switch available models
## [0.5.7] - 2026-05-04

### 📚 Documentation

- Add instructions for running tests with vitest instead of bun test in AGENTS.md

### 🧪 Testing

- Update snapshots for markdown-table-transformer, message-chunker, and prompt-context
## [0.5.6] - 2026-05-04

### 🧪 Testing

- Update snapshots for markdown-table-transformer, message-chunker, and prompt-context with improved formatting
## [0.5.5] - 2026-05-04

### 🚀 Features

- *(api)* Combine thread title and body for new thread session prompts
## [0.5.4] - 2026-05-04

### 🐛 Bug Fixes

- *(gateway)* Handle errors when sending message replies
## [0.5.3] - 2026-05-03

### 🚀 Features

- *(gateway)* Ignore system messages in onMessage handler
## [0.5.2] - 2026-05-01

### 🐛 Bug Fixes

- *(markdown-table-transformer)* Normalize misplaced code fences at end of lines
## [0.5.1] - 2026-04-28

### 📚 Documentation

- Update documentation for unified Discord gateway and forum thread support
- Update README to consolidate usage examples and clarify config options
- Update README to remove legacy references and clarify config loading
## [0.5.0] - 2026-04-28

### 🚀 Features

- *(gateway)* [**breaking**] Add unified Discord gateway with DM and forum thread session support
- *(config)* Add loadDiscordGatewayConfigFromEnv for gateway-specific env config

### ⚙️ Miscellaneous Tasks

- *(vitest)* Add GitHub Actions reporter for test runs in CI
## [0.4.8] - 2026-04-25

### ⚙️ Miscellaneous Tasks

- Update workflow step name from "Type check" to "Test" in publish.yml
- *(build)* Migrate from typescript to @typescript/native-preview and update build scripts
## [0.4.7] - 2026-04-25

### 🐛 Bug Fixes

- *(discord-client)* Ensure typing indicator is started before command handling and stopped appropriately
## [0.4.5] - 2026-04-24

### 🚜 Refactor

- *(reply-buffer)* Add debug logging for markdown table transformation
## [0.4.4] - 2026-04-24

### 🧪 Testing

- Add comprehensive tests for chunkMessage covering markdown structures and edge cases
## [0.4.3] - 2026-04-24

### 🧪 Testing

- *(message-chunker)* Add tests for chunkMessage including code block handling
## [0.4.2] - 2026-04-24

### 🧪 Testing

- Update snapshots for markdown-table-transformer to match Vitest format and improve coverage
## [0.4.1] - 2026-04-24

### 🚜 Refactor

- *(markdown-table-transformer)* [**breaking**] Simplify API to only export async transformer and improve table detection

### 🧪 Testing

- Add snapshots for markdown-table-transformer tests
## [0.4.0] - 2026-04-24

### 🚀 Features

- *(markdown-table-transformer)* Add utilities to convert markdown tables to Discord-friendly code blocks
## [0.3.18] - 2026-04-24

### 🚀 Features

- *(commands)* Add !reload command to reload resources
## [0.3.16] - 2026-04-23

### 🧪 Testing

- Add Vitest test setup and snapshot tests for buildTimeContextPrompt
- Update prompt-context snapshots to remove outdated test cases

### ⚙️ Miscellaneous Tasks

- Run tests in publish workflow and update prompt-context snapshots
## [0.3.15] - 2026-04-23

### ⚙️ Miscellaneous Tasks

- *(build)* Set rootDir to src and remove baseUrl from tsconfig
## [0.3.13] - 2026-04-23

### 🐛 Bug Fixes

- *(config)* Update default model provider and model to openrouter/anthropic/claude-3.5-haiku

### ⚙️ Miscellaneous Tasks

- Add MIT license file and update package.json license field
## [0.3.12] - 2026-04-23

### 📚 Documentation

- Update README with thinking command and thinkingLevel configuration

### ⚙️ Miscellaneous Tasks

- Add .agents to .gitignore
## [0.3.11] - 2026-04-23

### 📚 Documentation

- Improve README formatting and add spacing for clarity
- Update AGENTS.md with formatting step and publishing instructions

### ⚙️ Miscellaneous Tasks

- *(build)* Add Prettier for code formatting and update package scripts
- Prettier format
## [0.3.10] - 2026-04-23

### ⚙️ Miscellaneous Tasks

- Move Node setup step after change check in publish workflow
## [0.3.9] - 2026-04-23

### ⚙️ Miscellaneous Tasks

- Remove --provenance and --access public flags from npm publish in publish workflow
## [0.3.8] - 2026-04-23

### ⚙️ Miscellaneous Tasks

- Update publish workflow to trigger on tags and use latest actions
## [0.3.7] - 2026-04-22

### 🐛 Bug Fixes

- Upgrade npm to v11+ for trusted publishing support
## [0.3.5] - 2026-04-22

### 🐛 Bug Fixes

- Use npm trusted publishing (OIDC) instead of token
- Disable setup-node token to allow OIDC trusted publishing
## [0.3.2] - 2026-04-22

### ⚙️ Miscellaneous Tasks

- Add provenance flag to npm publish and update repository URL in package.json
## [0.3.1] - 2026-04-22

### ⚙️ Miscellaneous Tasks

- Update repository URL in package.json to new GitHub location
## [0.3.0] - 2026-04-22

### 🚀 Features

- *(agent)* Add support for configurable thinking/reasoning level
## [0.2.1] - 2026-04-22

### ⚙️ Miscellaneous Tasks

- Add publish workflow on version bump
- Update publish workflow for improved npm publishing and add repository info
## [0.2.0] - 2026-04-22

### 🚀 Features

- *(prompt-context)* Improve time context prompt formatting and output
## [0.1.4] - 2026-04-22

### 🚀 Features

- *(discord-client)* Add periodic typing indicator while processing messages

### 🐛 Bug Fixes

- Ensure process exits after shutdown signal is handled
## [0.1.2] - 2026-04-16

### 🚀 Features

- Initial release of @friendlyrobot/discord-pi-agent package
- *(commands)* Display context usage in status command output

### ⚙️ Miscellaneous Tasks

- Add .gitignore file to exclude node_modules, dist, .env, logs, and tgz files
