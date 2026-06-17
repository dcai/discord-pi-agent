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

export class PromptQueueCancelledError extends Error {
  constructor(message = "Prompt queue entry was cancelled.") {
    super(message);
    this.name = "PromptQueueCancelledError";
  }
}

export class PromptQueue {
  private readonly queue: Array<QueueEntry<unknown>> = [];
  private running = false;
  private cancellationCount = 0;

  enqueue<T>(task: QueueTask<T>): Promise<T> {
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

  private runNextTask(): void {
    if (this.running) {
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    this.running = true;
    void this.runTask(next).finally(() => {
      this.running = false;
      this.runNextTask();
    });
  }

  private async runTask<T>(entry: QueueEntry<T>): Promise<void> {
    try {
      entry.resolve(await entry.task());
    } catch (error) {
      entry.reject(error);
    }
  }
}
