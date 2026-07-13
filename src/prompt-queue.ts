type QueueTask<T> = () => Promise<T>;

type QueueSnapshot = {
  pending: number;
  busy: boolean;
};

type QueueEntry<T> = {
  task: QueueTask<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type IdleResolver = () => void;

export class PromptQueueCancelledError extends Error {
  constructor(message = "Prompt queue entry was cancelled.") {
    super(message);
    this.name = "PromptQueueCancelledError";
  }
}

export class PromptQueue {
  private readonly queue: Array<QueueEntry<unknown>> = [];
  private readonly idleResolvers: IdleResolver[] = [];
  private running = false;
  private cancellationCount = 0;
  private closed = false;

  enqueue<T>(task: QueueTask<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new PromptQueueCancelledError("Prompt queue is closed."),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = {
        task,
        resolve,
        reject,
      };
      this.queue.push(entry as QueueEntry<unknown>);
      this.runNextTask();
    });
  }

  getSnapshot(): QueueSnapshot {
    return {
      pending: this.queue.length,
      busy: this.running,
    };
  }

  getCancellationCount(): number {
    return this.cancellationCount;
  }

  cancelPending(
    message = "Cancelled because the session was aborted.",
  ): number {
    const pendingEntries = this.queue.splice(0);
    if (pendingEntries.length === 0) {
      return 0;
    }

    for (const entry of pendingEntries) {
      entry.reject(new PromptQueueCancelledError(message));
    }

    return pendingEntries.length;
  }

  markAbort(): void {
    this.cancellationCount += 1;
  }

  async close(
    message = "Cancelled because the session is shutting down.",
  ): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.markAbort();
    }

    this.cancelPending(message);
    await this.waitForIdle();
  }

  private runNextTask(): void {
    if (this.running || this.closed) {
      this.resolveIdleIfNeeded();
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      this.resolveIdleIfNeeded();
      return;
    }

    this.running = true;
    void this.runTask(next).finally(() => {
      this.running = false;
      this.runNextTask();
    });
  }

  private waitForIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private resolveIdleIfNeeded(): void {
    if (this.running || this.queue.length > 0) {
      return;
    }

    const resolvers = this.idleResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve();
    }
  }

  private async runTask<T>(entry: QueueEntry<T>): Promise<void> {
    try {
      entry.resolve(await entry.task());
    } catch (error) {
      entry.reject(error);
    }
  }
}
