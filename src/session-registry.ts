import path from "node:path";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentService } from "./agent-service";
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

export class SessionRegistry {
  private readonly scopes = new Map<SessionScope, ScopeEntry>();
  private readonly agentService: AgentService;

  constructor(agentService: AgentService) {
    this.agentService = agentService;
  }

  async getOrCreate(scope: SessionScope): Promise<ScopeEntry> {
    const existing = this.scopes.get(scope);
    if (existing) {
      return existing;
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

    console.log("[session-registry] scope registered", {
      scope,
      sessionDir,
      sessionId: session.sessionId,
    });

    return entry;
  }

  async remove(scope: SessionScope): Promise<void> {
    const entry = this.scopes.get(scope);
    if (!entry) {
      return;
    }

    console.log("[session-registry] removing scope", { scope });
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
    console.log(
      "[session-registry] shutting down all scopes",
      this.scopes.size,
    );
    const scopes = Array.from(this.scopes.keys());
    for (const scope of scopes) {
      await this.remove(scope);
    }
  }
}
