import { describe, expect, it, vi } from "vitest";
import { AgentModelService } from "./agent-model-service";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { ResolvedDiscordGatewayConfig } from "./types";

type TestModel = Model<any> & {
  provider: string;
  id: string;
  input?: string[];
};

function createConfig(
  overrides: Partial<ResolvedDiscordGatewayConfig> = {},
): ResolvedDiscordGatewayConfig {
  return {
    discordBotToken: "token",
    discordAllowedUserId: "user-1",
    cwd: "/repo",
    agentDir: "/repo/.pi-agent",
    modelProvider: "openrouter",
    modelId: "model-1",
    thinkingLevel: "medium",
    promptTimeZone: "UTC",
    promptLocale: "en-AU",
    promptTransform: (ctx) => ctx.rawContent,
    startupMessage: false,
    shutdownOnSignals: true,
    visionModelId: null,
    discordAllowedForumChannelIds: [],
    discordAllowedUserIds: ["user-1"],
    ...overrides,
  };
}

function createModel(provider: string, id: string): TestModel {
  return {
    provider,
    id,
    input: ["text"],
  } as TestModel;
}

function createModelRegistry(models: TestModel[]) {
  return {
    find: vi.fn((provider: string, id: string) => {
      return models.find((model) => {
        return model.provider === provider && model.id === id;
      });
    }),
    getAvailable: vi.fn(async () => models),
  };
}

function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    model: undefined,
    thinkingLevel: "low",
    supportsThinking: vi.fn(() => true),
    getAvailableThinkingLevels: vi.fn(() => ["low", "medium", "high"]),
    setThinkingLevel: vi.fn(),
    setModel: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AgentSession;
}

describe("AgentModelService", () => {
  it("finds a model through the registry", () => {
    const model = createModel("openrouter", "model-1");
    const registry = createModelRegistry([model]);
    const service = new AgentModelService(createConfig(), registry as never);

    expect(service.findModel("openrouter", "model-1")).toBe(model);
    expect(service.findModel("openrouter", "missing")).toBeUndefined();
  });

  it("keeps the existing session model when one is already set", async () => {
    const registry = createModelRegistry([
      createModel("openrouter", "model-1"),
    ]);
    const service = new AgentModelService(createConfig(), registry as never);
    const session = createSession({
      model: createModel("openrouter", "already-selected"),
    });

    await service.ensureSessionHasConfiguredModel(session);

    expect(session.setModel).not.toHaveBeenCalled();
    expect(registry.getAvailable).not.toHaveBeenCalled();
  });

  it("sets the configured model and applies thinking level", async () => {
    const model = createModel("openrouter", "model-1");
    const registry = createModelRegistry([model]);
    const service = new AgentModelService(
      createConfig({ thinkingLevel: "high" }),
      registry as never,
    );
    const session = createSession();

    await service.ensureSessionHasConfiguredModel(session);

    expect(session.setModel).toHaveBeenCalledWith(model);
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
  });

  it("throws when the configured model is missing", async () => {
    const registry = createModelRegistry([createModel("openrouter", "other")]);
    const service = new AgentModelService(
      createConfig({ modelId: "missing" }),
      registry as never,
    );
    const session = createSession();

    await expect(
      service.ensureSessionHasConfiguredModel(session),
    ).rejects.toThrow("Configured model not found: openrouter/missing");
  });

  it("skips configured thinking level when unsupported by the model", async () => {
    const model = createModel("openrouter", "model-1");
    const registry = createModelRegistry([model]);
    const service = new AgentModelService(
      createConfig({ thinkingLevel: "xhigh" }),
      registry as never,
    );
    const session = createSession({
      getAvailableThinkingLevels: vi.fn(() => {
        return ["low", "medium", "high"];
      }) as AgentSession["getAvailableThinkingLevels"],
    });

    await service.ensureSessionHasConfiguredModel(session);

    expect(session.setThinkingLevel).not.toHaveBeenCalled();
  });

  it("lists models and marks the current one", async () => {
    const currentModel = createModel("openrouter", "model-1");
    const registry = createModelRegistry([
      currentModel,
      createModel("openai", "gpt-5"),
    ]);
    const service = new AgentModelService(createConfig(), registry as never);
    const session = createSession({ model: currentModel });

    await expect(service.listModels(session)).resolves.toBe(
      [
        "Available models (2):",
        "  openrouter/model-1 (current)",
        "  openai/gpt-5",
        "\nUsage: !model <provider/modelId> to switch.",
      ].join("\n"),
    );
  });

  it("shows provider hints when switching to a missing model", async () => {
    const registry = createModelRegistry([
      createModel("openrouter", "model-1"),
      createModel("openrouter", "model-2"),
      createModel("openai", "gpt-5"),
    ]);
    const service = new AgentModelService(createConfig(), registry as never);
    const session = createSession();

    await expect(
      service.switchModel("openrouter", "missing", session),
    ).resolves.toBe(
      'Model not found: openrouter/missing.\nModels from "openrouter": openrouter/model-1, openrouter/model-2',
    );
  });

  it("returns early when switching to the same model", async () => {
    const currentModel = createModel("openrouter", "model-1");
    const registry = createModelRegistry([currentModel]);
    const service = new AgentModelService(createConfig(), registry as never);
    const session = createSession({ model: currentModel });

    await expect(
      service.switchModel("openrouter", "model-1", session),
    ).resolves.toBe("Already using openrouter/model-1.");
    expect(session.setModel).not.toHaveBeenCalled();
  });

  it("switches model and includes thinking info when supported", async () => {
    const newModel = createModel("openrouter", "model-2");
    const registry = createModelRegistry([newModel]);
    const service = new AgentModelService(
      createConfig({ modelId: "model-2", thinkingLevel: "high" }),
      registry as never,
    );
    const session = createSession({
      model: createModel("openrouter", "model-1"),
      thinkingLevel: "high",
    });

    await expect(
      service.switchModel("openrouter", "model-2", session),
    ).resolves.toBe("Switched to openrouter/model-2 (thinking: high).");
    expect(session.setModel).toHaveBeenCalledWith(newModel);
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
  });

  it("forces a session onto a requested model", async () => {
    const newModel = createModel("openai", "gpt-5");
    const registry = createModelRegistry([newModel]);
    const service = new AgentModelService(
      createConfig({ thinkingLevel: "high" }),
      registry as never,
    );
    const session = createSession({
      model: createModel("openrouter", "model-1"),
    });

    await service.ensureSessionUsesModel(session, {
      provider: "openai",
      id: "gpt-5",
    });

    expect(session.setModel).toHaveBeenCalledWith(newModel);
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
  });

  it("throws when a requested session model is missing", async () => {
    const registry = createModelRegistry([createModel("openrouter", "model-1")]);
    const service = new AgentModelService(createConfig(), registry as never);
    const session = createSession();

    await expect(
      service.ensureSessionUsesModel(session, {
        provider: "openai",
        id: "gpt-5",
      }),
    ).rejects.toThrow("Scheduled job model not found: openai/gpt-5");
  });

  it("reports current model and thinking support", () => {
    const service = new AgentModelService(
      createConfig(),
      createModelRegistry([]) as never,
    );

    expect(service.getCurrentModelDisplay()).toBe("(no model selected)");
    expect(
      service.getCurrentModelDisplay(
        createSession({ model: createModel("openrouter", "model-1") }),
      ),
    ).toBe("openrouter/model-1");

    expect(
      service.getThinkingLevel(
        createSession({
          supportsThinking: vi.fn(() => false),
        }),
      ),
    ).toEqual({ current: "off", available: [], supported: false });
  });

  it("sets and validates thinking levels", () => {
    const service = new AgentModelService(
      createConfig(),
      createModelRegistry([]) as never,
    );

    const unsupportedSession = createSession({
      supportsThinking: vi.fn(() => false),
    });
    expect(service.setThinkingLevel(unsupportedSession, "high")).toBe(
      "Current model does not support reasoning/thinking.",
    );

    const invalidSession = createSession({
      getAvailableThinkingLevels: vi.fn(() => {
        return ["low", "medium"];
      }) as AgentSession["getAvailableThinkingLevels"],
    });
    expect(service.setThinkingLevel(invalidSession, "high")).toBe(
      'Invalid thinking level "high" for current model. Available: low, medium',
    );

    const validSession = createSession();
    expect(service.setThinkingLevel(validSession, "high")).toBe(
      'Thinking level set to "high".',
    );
    expect(validSession.setThinkingLevel).toHaveBeenCalledWith("high");
  });
});
