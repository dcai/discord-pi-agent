import path from "node:path";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentService } from "./agent-service";
import { createModuleLogger } from "./logger";
import { PromptQueue } from "./prompt-queue";

export type SessionScope = string;

export type ScopeEntry = {
  session: AgentSession;
  promptQueue: PromptQueue;
  createdAt: Date;
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

  throw new Error(`Unknown session scope: ${scope}`);
}

const logger = createModuleLogger("session-registry");

export class SessionRegistry {
  private readonly scopes = new Map<SessionScope, ScopeEntry>();
  private readonly agentService: AgentService;

  constructor(agentService: AgentService) {
    this.agentService = agentService;
  }

  async getOrCreate(
    scope: SessionScope,
  ): Promise<{ entry: ScopeEntry; created: boolean }> {
    const existing = this.scopes.get(scope);
    if (existing) {
      return { entry: existing, created: false };
    }

    const sessionDir = sessionDirForScope(
      this.agentService.getAgentDir(),
      scope,
    );
    const session = await this.agentService.createSession(sessionDir);
    const promptQueue = new PromptQueue();

    const entry: ScopeEntry = {
      session,
      promptQueue,
      createdAt: new Date(),
    };
    this.scopes.set(scope, entry);

    logger.info(
      {
        scope,
        sessionDir,
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

    logger.info({ scope }, "removing scope");
    await entry.session.abort();
    entry.session.dispose();
    this.scopes.delete(scope);
  }

  get(scope: SessionScope): ScopeEntry | undefined {
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
