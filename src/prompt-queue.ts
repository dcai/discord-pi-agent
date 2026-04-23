type QueueTask<T> = () => Promise<T>;

type QueueSnapshot = {
  pending: number;
  busy: boolean;
};

export class PromptQueue {
  private readonly queue: Array<() => Promise<void>> = [];
  private running = false;

  enqueue<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      });
      this.kick();
    });
  }

  getSnapshot(): QueueSnapshot {
    return {
      pending: this.queue.length,
      busy: this.running,
    };
  }

  private kick(): void {
    if (this.running) {
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    this.running = true;
    void next().finally(() => {
      this.running = false;
      this.kick();
    });
  }
}
