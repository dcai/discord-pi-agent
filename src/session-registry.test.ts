import { beforeEach, describe, it, expect, vi } from "vitest";
import { SessionRegistry } from "./session-registry";
import type { AgentService } from "./agent-service";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

const { rmMock } = vi.hoisted(() => {
  return {
    rmMock: vi.fn(async () => undefined),
  };
});

vi.mock("node:fs/promises", () => {
  return {
    default: {
      rm: rmMock,
    },
    rm: rmMock,
  };
});

function mockAgentService(agentDir = "/tmp/test-agent"): AgentService {
  const sessionId = `session-${Math.random().toString(36).slice(2, 8)}`;
  const mockSession = {
    sessionId,
    sessionFile: `${agentDir}/sessions/${sessionId}.json`,
    abort: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  } as unknown as AgentSession;

  return {
    getAgentDir: () => agentDir,
    createSession: vi.fn().mockResolvedValue(mockSession),
    resetMainSession: vi.fn().mockResolvedValue(mockSession),
  } as unknown as AgentService;
}

describe("SessionRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets non-dm scope data from disk", async () => {
    const agentService = mockAgentService();
    const registry = new SessionRegistry(agentService);
    const { entry } = await registry.getOrCreate("thread:999");

    await registry.reset("thread:999");

    expect(entry.session.abort).toHaveBeenCalledOnce();
    expect(entry.session.dispose).toHaveBeenCalledOnce();
    expect(rmMock).toHaveBeenCalledWith("/tmp/test-agent/sessions/thread-999", {
      recursive: true,
      force: true,
    });
    expect(registry.get("thread:999")).toBeUndefined();
  });

  it("resets dm scope through the primary agent session", async () => {
    const agentService = mockAgentService();
    const registry = new SessionRegistry(agentService);
    const { entry } = await registry.getOrCreate("dm");

    await registry.reset("dm");

    expect(entry.session.abort).toHaveBeenCalledOnce();
    expect(entry.session.dispose).toHaveBeenCalledOnce();
    expect(agentService.resetMainSession).toHaveBeenCalledOnce();
    expect(rmMock).not.toHaveBeenCalled();
    expect(registry.get("dm")).toBeUndefined();
  });

  describe("getOrCreate", () => {
    it("returns created: true on first call for a scope", async () => {
      const registry = new SessionRegistry(mockAgentService());
      const result = await registry.getOrCreate("dm");

      expect(result.created).toBe(true);
      expect(result.entry.session).toBeDefined();
      expect(result.entry.promptQueue).toBeDefined();
      expect(result.entry.createdAt).toBeInstanceOf(Date);
    });

    it("returns created: false on subsequent calls for the same scope", async () => {
      const registry = new SessionRegistry(mockAgentService());
      await registry.getOrCreate("dm");
      const result = await registry.getOrCreate("dm");

      expect(result.created).toBe(false);
      expect(result.entry.session).toBeDefined();
    });

    it("returns created: true for different scopes independently", async () => {
      const registry = new SessionRegistry(mockAgentService());

      const dmResult = await registry.getOrCreate("dm");
      expect(dmResult.created).toBe(true);

      const threadResult = await registry.getOrCreate("thread:123");
      expect(threadResult.created).toBe(true);

      // Both scopes now exist
      const dmAgain = await registry.getOrCreate("dm");
      expect(dmAgain.created).toBe(false);

      const threadAgain = await registry.getOrCreate("thread:123");
      expect(threadAgain.created).toBe(false);
    });

    it("creates only one session per scope", async () => {
      const agentDir = "/tmp/test-agent";
      const agentService = mockAgentService(agentDir);
      const registry = new SessionRegistry(agentService);

      await registry.getOrCreate("dm");
      await registry.getOrCreate("dm");

      expect(agentService.createSession).toHaveBeenCalledTimes(1);
      expect(agentService.createSession).toHaveBeenCalledWith(
        expect.stringContaining("sessions"),
        {
          reuseExisting: true,
        },
      );
    });

    it("passes correct session dir for dm scope", async () => {
      const agentDir = "/tmp/test-agent";
      const agentService = mockAgentService(agentDir);
      const registry = new SessionRegistry(agentService);

      await registry.getOrCreate("dm");

      expect(agentService.createSession).toHaveBeenCalledWith(
        `${agentDir}/sessions`,
        {
          reuseExisting: true,
        },
      );
    });

    it("passes correct session dir for thread scope", async () => {
      const agentDir = "/tmp/test-agent";
      const agentService = mockAgentService(agentDir);
      const registry = new SessionRegistry(agentService);

      await registry.getOrCreate("thread:abc-456");

      expect(agentService.createSession).toHaveBeenCalledWith(
        `${agentDir}/sessions/thread-abc-456`,
        {
          reuseExisting: true,
        },
      );
    });

    it("passes correct session dir for job scope", async () => {
      const agentDir = "/tmp/test-agent";
      const agentService = mockAgentService(agentDir);
      const registry = new SessionRegistry(agentService);

      await registry.getOrCreate("job:daily-standup");

      expect(agentService.createSession).toHaveBeenCalledWith(
        `${agentDir}/sessions/job-daily-standup`,
        {
          reuseExisting: true,
        },
      );
    });

    it("drops an existing scoped session when fresh mode is requested", async () => {
      const agentService = mockAgentService();
      const registry = new SessionRegistry(agentService);

      const first = await registry.getOrCreate("job:daily-standup");
      const second = await registry.getOrCreate("job:daily-standup", {
        reuseExisting: false,
      });

      expect(first.entry.session.abort).toHaveBeenCalledOnce();
      expect(first.entry.session.dispose).toHaveBeenCalledOnce();
      expect(second.created).toBe(true);
      expect(agentService.createSession).toHaveBeenNthCalledWith(
        1,
        "/tmp/test-agent/sessions/job-daily-standup",
        {
          reuseExisting: true,
        },
      );
      expect(agentService.createSession).toHaveBeenNthCalledWith(
        2,
        "/tmp/test-agent/sessions/job-daily-standup",
        {
          reuseExisting: false,
        },
      );
    });
  });

  describe("remove", () => {
    it("cleans up and removes scope", async () => {
      const registry = new SessionRegistry(mockAgentService());
      const { entry } = await registry.getOrCreate("thread:999");

      await registry.remove("thread:999");

      expect(entry.session.abort).toHaveBeenCalledOnce();
      expect(entry.session.dispose).toHaveBeenCalledOnce();
      expect(registry.get("thread:999")).toBeUndefined();
    });

    it("is a no-op for unknown scopes", async () => {
      const registry = new SessionRegistry(mockAgentService());
      await expect(registry.remove("nope")).resolves.toBeUndefined();
    });
  });
});
