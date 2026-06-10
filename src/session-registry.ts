import path from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentService } from "./agent-service";
import { createModuleLogger } from "./logger";
import { PromptQueue } from "./prompt-queue";
import { DEFAULT_WORKING_EMOJI } from "./discord-replies";

export type SessionScope = "dm" | `thread:${string}` | `job:${string}`;

export type ScopedSessionEntry = {
  session: AgentSession;
  promptQueue: PromptQueue;
  createdAt: Date;
  workingEmoji: string;
};

type GetOrCreateSessionOptions = {
  reuseExisting?: boolean;
};

/**
 * Derive a deterministic session directory from a scope key.
 *
 *   "dm"              → <agentDir>/sessions
 *   "thread:<id>"     → <agentDir>/sessions/thread-<id>
 */
export function sessionDirForScope(
  agentDir: string,
  scope: SessionScope,
): string {
  if (scope === "dm") {
    return path.join(agentDir, "sessions");
  }

  if (scope.startsWith("thread:")) {
    const threadId = scope.slice(7);
    return path.join(agentDir, "sessions", `thread-${threadId}`);
  }

  if (scope.startsWith("job:")) {
    const jobId = scope.slice(4);
    return path.join(agentDir, "sessions", `job-${jobId}`);
  }

  throw new Error(`Unknown session scope: ${scope}`);
}

const logger = createModuleLogger("session-registry");

export class SessionRegistry {
  private readonly scopes = new Map<SessionScope, ScopedSessionEntry>();
  private readonly agentService: AgentService;

  constructor(agentService: AgentService) {
    this.agentService = agentService;
  }

  async getOrCreate(
    scope: SessionScope,
    options: GetOrCreateSessionOptions = {},
  ): Promise<{ entry: ScopedSessionEntry; created: boolean }> {
    const reuseExisting = options.reuseExisting ?? true;
    const existing = this.scopes.get(scope);
    if (existing && reuseExisting) {
      return { entry: existing, created: false };
    }

    if (existing && !reuseExisting) {
      await this.remove(scope);
    }

    const sessionDir = sessionDirForScope(
      this.agentService.getAgentDir(),
      scope,
    );
    const session = await this.agentService.createSession(sessionDir, {
      reuseExisting,
    });
    const promptQueue = new PromptQueue();

    const entry: ScopedSessionEntry = {
      session,
      promptQueue,
      createdAt: new Date(),
      workingEmoji: DEFAULT_WORKING_EMOJI,
    };
    this.scopes.set(scope, entry);

    logger.debug(
      {
        scope,
        sessionDir,
        reuseExisting,
        sessionId: session.sessionId,
      },
      "scope registered",
    );

    return { entry, created: true };
  }

  async remove(scope: SessionScope): Promise<void> {
    const entry = this.scopes.get(scope);
    if (!entry) {
      return;
    }

    logger.debug({ scope }, "removing scope");
    await entry.session.abort();
    entry.session.dispose();
    this.scopes.delete(scope);
  }

  get(scope: SessionScope): ScopedSessionEntry | undefined {
    return this.scopes.get(scope);
  }

  getScopes(): SessionScope[] {
    return Array.from(this.scopes.keys());
  }

  async shutdownAll(): Promise<void> {
    logger.info({ count: this.scopes.size }, "shutting down all scopes");
    const scopes = Array.from(this.scopes.keys());
    for (const scope of scopes) {
      await this.remove(scope);
    }
  }
}
