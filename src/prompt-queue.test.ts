import { describe, expect, it } from "vitest";
import { PromptQueue } from "./prompt-queue";

describe("PromptQueue", () => {
  it("runs the first task immediately and reports busy state", async () => {
    const queue = new PromptQueue();
    let releaseFirstTask: (() => void) | undefined;

    const firstTask = queue.enqueue(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstTask = resolve;
      });
      return "first";
    });

    await Promise.resolve();

    expect(queue.getSnapshot()).toEqual({ pending: 0, busy: true });

    releaseFirstTask?.();

    await expect(firstTask).resolves.toBe("first");
    expect(queue.getSnapshot()).toEqual({ pending: 0, busy: false });
  });

  it("runs tasks in FIFO order", async () => {
    const queue = new PromptQueue();
    const order: string[] = [];
    let releaseFirstTask: (() => void) | undefined;

    const firstTask = queue.enqueue(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirstTask = resolve;
      });
      order.push("first:end");
      return "first";
    });

    const secondTask = queue.enqueue(async () => {
      order.push("second");
      return "second";
    });

    await Promise.resolve();

    expect(queue.getSnapshot()).toEqual({ pending: 1, busy: true });
    expect(order).toEqual(["first:start"]);

    releaseFirstTask?.();

    await expect(firstTask).resolves.toBe("first");
    await expect(secondTask).resolves.toBe("second");
    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(queue.getSnapshot()).toEqual({ pending: 0, busy: false });
  });

  it("continues with later tasks after a rejection", async () => {
    const queue = new PromptQueue();
    const order: string[] = [];

    const firstTask = queue.enqueue(async () => {
      order.push("first");
      throw new Error("boom");
    });

    const secondTask = queue.enqueue(async () => {
      order.push("second");
      return "ok";
    });

    await expect(firstTask).rejects.toThrow("boom");
    await expect(secondTask).resolves.toBe("ok");
    expect(order).toEqual(["first", "second"]);
    expect(queue.getSnapshot()).toEqual({ pending: 0, busy: false });
  });
});
