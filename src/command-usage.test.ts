import { describe, expect, it, vi } from "vitest";
import { classifySessionCommand } from "./command-registry";
import { recordCommandUsage } from "./command-usage";

describe("command usage", () => {
  it("normalizes equivalent command inputs to one canonical id", () => {
    expect(classifySessionCommand("!job run report")).toBe("job.run");
    expect(classifySessionCommand("job run report")).toBe("job.run");
    expect(classifySessionCommand("session reset here")).toBe("session.reset");
  });

  it("emits privacy-safe usage events", async () => {
    const record = vi.fn();

    await recordCommandUsage(
      { record },
      {
        commandId: "prompt_template:review",
        surface: "prefix",
        alias: "!",
        resourceName: "review",
        outcome: "success",
        durationMs: 12.4,
        scope: "dm",
      },
    );

    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][0]).toMatchObject({
      commandId: "prompt_template:review",
      surface: "prefix",
      resourceName: "review",
      scopeType: "dm",
      outcome: "success",
      durationMs: 12,
    });
    expect(record.mock.calls[0][0]).not.toHaveProperty("content");
    expect(record.mock.calls[0][0]).not.toHaveProperty("messageId");
  });

  it("does not break command execution when recording fails", async () => {
    const record = vi.fn().mockRejectedValue(new Error("database unavailable"));

    await expect(
      recordCommandUsage(
        { record },
        {
          commandId: "help",
          surface: "prefix",
          outcome: "success",
          durationMs: 1,
          scope: "thread:123",
        },
      ),
    ).resolves.toBeUndefined();
  });
});
