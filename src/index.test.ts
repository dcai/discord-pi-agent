import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DiscordGatewayConfig,
  ResolvedDiscordGatewayConfig,
} from "./types";

const {
  resolveConfigMock,
  startGatewayClientMock,
  agentServiceState,
  sessionRegistryState,
  processOnMock,
} = vi.hoisted(() => {
  return {
    resolveConfigMock: vi.fn(),
    startGatewayClientMock: vi.fn(),
    agentServiceState: {
      instances: [] as Array<Record<string, unknown>>,
    },
    sessionRegistryState: {
      instances: [] as Array<Record<string, unknown>>,
    },
    processOnMock: vi.fn(),
  };
});

vi.mock("./config", () => {
  return {
    resolveConfig: resolveConfigMock,
    loadDiscordGatewayConfigFromEnv: vi.fn(),
  };
});

vi.mock("./discord-gateway-client", () => {
  return {
    startGatewayClient: startGatewayClientMock,
  };
});

vi.mock("./agent-service", () => {
  class AgentServiceMock {
    initialize = vi.fn(async () => undefined);
    getStatus = vi.fn(() => ({
      sessionId: "session-1",
      model: "openrouter/model-1",
    }));
    shutdown = vi.fn(async () => undefined);

    constructor(config: unknown) {
      agentServiceState.instances.push(
        this as unknown as Record<string, unknown>,
      );
      (this as unknown as { config: unknown }).config = config;
    }
  }

  return {
    AgentService: AgentServiceMock,
  };
});

vi.mock("./session-registry", () => {
  class SessionRegistryMock {
    shutdownAll = vi.fn(async () => undefined);

    constructor(agentService: unknown) {
      sessionRegistryState.instances.push(
        this as unknown as Record<string, unknown>,
      );
      (this as unknown as { agentService: unknown }).agentService =
        agentService;
    }
  }

  return {
    SessionRegistry: SessionRegistryMock,
  };
});

const originalProcessOn = process.on;
const originalProcessExit = process.exit;

beforeEach(() => {
  vi.clearAllMocks();
  agentServiceState.instances.length = 0;
  sessionRegistryState.instances.length = 0;
  process.on = processOnMock as typeof process.on;
  process.exit = vi.fn() as unknown as typeof process.exit;
});

function createResolvedConfig(
  overrides: Partial<ResolvedDiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  return {
    discordBotToken: "bot-token",
    discordAllowedUserId: "user-1",
    cwd: "/repo",
    agentDir: "/repo/.pi-agent",
    modelProvider: "openrouter",
    modelId: "model-1",
    thinkingLevel: "medium",
    promptTimeZone: "UTC",
    promptLocale: "en-AU",
    promptTransform: async (ctx) => ctx.rawContent,
    startupMessage: false,
    shutdownOnSignals: true,
    visionModelId: null,
    discordAllowedForumChannelIds: ["forum-1"],
    discordAllowedUserIds: ["user-1", "user-2"],
    ...overrides,
  };
}

describe("startDiscordGateway", () => {
  it("starts the gateway and returns status + idempotent stop", async () => {
    const { startDiscordGateway } = await import("./index");
    const resolvedConfig = createResolvedConfig({ shutdownOnSignals: false });
    const client = {
      destroy: vi.fn(),
    };

    resolveConfigMock.mockReturnValue(resolvedConfig);
    startGatewayClientMock.mockResolvedValue(client);

    const gateway = await startDiscordGateway({
      discordBotToken: "token",
      discordAllowedUserId: "user-1",
      cwd: "/repo",
    } as DiscordGatewayConfig);

    const agentService = agentServiceState.instances[0] as {
      initialize: ReturnType<typeof vi.fn>;
      getStatus: ReturnType<typeof vi.fn>;
      shutdown: ReturnType<typeof vi.fn>;
    };
    const sessionRegistry = sessionRegistryState.instances[0] as {
      shutdownAll: ReturnType<typeof vi.fn>;
    };

    expect(resolveConfigMock).toHaveBeenCalled();
    expect(agentService.initialize).toHaveBeenCalled();
    expect(startGatewayClientMock).toHaveBeenCalledWith(
      resolvedConfig,
      agentService,
      sessionRegistry,
      {
        discordAllowedUserId: "user-1",
        discordAllowedForumChannelIds: ["forum-1"],
        discordAllowedUserIds: ["user-1", "user-2"],
        startupMessage: false,
      },
    );
    expect(gateway.client).toBe(client);
    expect(gateway.getStatus()).toEqual({
      sessionId: "session-1",
      model: "openrouter/model-1",
    });

    await gateway.stop();
    await gateway.stop();

    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(sessionRegistry.shutdownAll).toHaveBeenCalledTimes(1);
    expect(agentService.shutdown).toHaveBeenCalledTimes(1);
    expect(processOnMock).not.toHaveBeenCalledWith(
      "SIGINT",
      expect.any(Function),
    );
    expect(processOnMock).not.toHaveBeenCalledWith(
      "SIGTERM",
      expect.any(Function),
    );
  });

  it("registers signal handlers when shutdownOnSignals is enabled", async () => {
    const { startDiscordGateway } = await import("./index");
    const resolvedConfig = createResolvedConfig({ shutdownOnSignals: true });

    resolveConfigMock.mockReturnValue(resolvedConfig);
    startGatewayClientMock.mockResolvedValue({ destroy: vi.fn() });

    await startDiscordGateway({
      discordBotToken: "token",
      discordAllowedUserId: "user-1",
      cwd: "/repo",
    } as DiscordGatewayConfig);

    expect(processOnMock).toHaveBeenCalledTimes(2);
    expect(processOnMock).toHaveBeenNthCalledWith(
      1,
      "SIGINT",
      expect.any(Function),
    );
    expect(processOnMock).toHaveBeenNthCalledWith(
      2,
      "SIGTERM",
      expect.any(Function),
    );
  });
});

afterEach(() => {
  process.on = originalProcessOn;
  process.exit = originalProcessExit;
});
