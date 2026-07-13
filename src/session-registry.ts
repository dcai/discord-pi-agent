import fs from "node:fs/promises";
import path from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentService } from "./agent-service";
import { createModuleLogger } from "./logger";
import { PromptQueue } from "./prompt-queue";
import { DEFAULT_WORKING_EMOJI } from "./discord-replies";
import type { TaskSessionScope } from "./types";

export type SessionScope = TaskSessionScope;

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
  const sessionsRoot = path.join(agentDir, "sessions");

  if (scope === "dm") {
    return sessionsRoot;
  }

  let directoryName: string;

  if (scope.startsWith("thread:")) {
    const threadId = scope.slice(7);
    directoryName = `thread-${encodeURIComponent(threadId)}`;
  } else if (scope.startsWith("job:")) {
    const jobId = scope.slice(4);
    directoryName = `job-${encodeURIComponent(jobId)}`;
  } else {
    throw new Error(`Unknown session scope: ${scope}`);
  }

  const sessionDir = path.join(sessionsRoot, directoryName);
  const resolvedRoot = path.resolve(sessionsRoot);
  const resolvedSessionDir = path.resolve(sessionDir);
  if (
    resolvedSessionDir !== resolvedRoot &&
    !resolvedSessionDir.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Session scope resolves outside the sessions directory.`);
  }

  return sessionDir;
}

const logger = createModuleLogger("session-registry");

export class SessionRegistry {
  private readonly scopes = new Map<SessionScope, ScopedSessionEntry>();
  private readonly scopeOperations = new Map<SessionScope, Promise<void>>();
  private readonly agentService: AgentService;
  private shuttingDown = false;

  constructor(agentService: AgentService) {
    this.agentService = agentService;
  }

  async getOrCreate(
    scope: SessionScope,
    options: GetOrCreateSessionOptions = {},
  ): Promise<{ entry: ScopedSessionEntry; created: boolean }> {
    return this.withScopeLock(scope, async () => {
      if (this.shuttingDown) {
        throw new Error("Session registry is shutting down.");
      }

      const reuseExisting = options.reuseExisting ?? true;
      const existing = this.scopes.get(scope);
      if (existing && reuseExisting) {
        return { entry: existing, created: false };
      }

      if (existing && !reuseExisting) {
        await this.removeEntry(scope);
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
    });
  }

  async remove(scope: SessionScope): Promise<void> {
    await this.withScopeLock(scope, async () => {
      await this.removeEntry(scope);
    });
  }

  async reset(scope: SessionScope): Promise<void> {
    await this.withScopeLock(scope, async () => {
      logger.info({ scope }, "resetting scope");

      if (scope === "dm") {
        await this.removeEntry(scope);
        await this.agentService.resetMainSession();
        return;
      }

      const sessionDir = sessionDirForScope(
        this.agentService.getAgentDir(),
        scope,
      );
      await this.removeEntry(scope);
      await fs.rm(sessionDir, {
        recursive: true,
        force: true,
      });
    });
  }

  get(scope: SessionScope): ScopedSessionEntry | undefined {
    return this.scopes.get(scope);
  }

  getScopes(): SessionScope[] {
    return Array.from(this.scopes.keys());
  }

  async shutdownAll(): Promise<void> {
    this.shuttingDown = true;
    logger.info({ count: this.scopes.size }, "shutting down all scopes");
    const scopes = Array.from(this.scopes.keys());
    const results = await Promise.allSettled(
      scopes.map(async (scope) => {
        await this.remove(scope);
      }),
    );
    const failure = results.find((result) => {
      return result.status === "rejected";
    });
    if (failure?.status === "rejected") {
      throw failure.reason;
    }
  }

  private async removeEntry(scope: SessionScope): Promise<void> {
    const entry = this.scopes.get(scope);
    if (!entry) {
      return;
    }

    logger.debug({ scope }, "removing scope");
    this.scopes.delete(scope);

    const results = await Promise.allSettled([
      entry.promptQueue.close(),
      entry.session.abort(),
    ]);

    let disposeError: unknown;
    try {
      entry.session.dispose();
    } catch (error) {
      disposeError = error;
    }

    const failure = results.find((result) => {
      return result.status === "rejected";
    });
    if (failure?.status === "rejected") {
      throw failure.reason;
    }

    if (disposeError) {
      throw disposeError;
    }
  }

  private async withScopeLock<T>(
    scope: SessionScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.scopeOperations.get(scope) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.scopeOperations.set(scope, queued);

    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.scopeOperations.get(scope) === queued) {
        this.scopeOperations.delete(scope);
      }
    }
  }
}
