import type { AgentSession, ModelRegistry as ModelRegistryType } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { createModuleLogger } from "./logger";
import type { ResolvedDiscordGatewayConfig, ThinkingLevel } from "./types";

const logger = createModuleLogger("agent-model-service");

export class AgentModelService {
  private readonly config: ResolvedDiscordGatewayConfig;
  private readonly modelRegistry: ModelRegistryType;

  constructor(
    config: ResolvedDiscordGatewayConfig,
    modelRegistry: ModelRegistryType,
  ) {
    this.config = config;
    this.modelRegistry = modelRegistry;
  }

  findModel(provider: string, modelId: string): Model<any> | undefined {
    return this.modelRegistry.find(provider, modelId);
  }

  async ensureSessionHasConfiguredModel(session: AgentSession): Promise<void> {
    if (session.model) {
      logger.debug(
        {
          model: `${session.model.provider}/${session.model.id}`,
        },
        "retaining existing session model",
      );
      return;
    }

    const desiredModel = this.modelRegistry.find(
      this.config.modelProvider,
      this.config.modelId,
    );
    const availableModels = await this.modelRegistry.getAvailable();

    logger.debug(
      {
        count: availableModels.length,
        matches: availableModels
          .filter((model) => {
            return model.provider === this.config.modelProvider;
          })
          .map((model) => `${model.provider}/${model.id}`),
      },
      "available models",
    );

    if (!desiredModel) {
      throw new Error(
        `Configured model not found: ${this.config.modelProvider}/${this.config.modelId}. Check your pi agent config and installed extensions.`,
      );
    }

    logger.info(
      {
        to: `${desiredModel.provider}/${desiredModel.id}`,
      },
      "setting initial session model",
    );
    await session.setModel(desiredModel);
    await this.applyConfiguredThinkingLevelForSession(session);
  }

  async listModels(session?: AgentSession | null): Promise<string> {
    const availableModels = await this.modelRegistry.getAvailable();
    const currentDisplay = session?.model
      ? `${session.model.provider}/${session.model.id}`
      : null;

    const lines = availableModels.map((model) => {
      const display = `${model.provider}/${model.id}`;
      const marker = currentDisplay === display ? " (current)" : "";
      return `  ${display}${marker}`;
    });

    return [
      `Available models (${availableModels.length}):`,
      ...lines,
      `\nUsage: !model <provider/modelId> to switch.`,
    ].join("\n");
  }

  async switchModel(
    provider: string,
    modelId: string,
    session: AgentSession,
  ): Promise<string> {
    const model = this.modelRegistry.find(provider, modelId);

    if (!model) {
      const availableModels = await this.modelRegistry.getAvailable();
      const matches = availableModels
        .filter((availableModel) => {
          return availableModel.provider === provider;
        })
        .map((availableModel) => {
          return `${availableModel.provider}/${availableModel.id}`;
        });

      const hint =
        matches.length > 0
          ? `\nModels from "${provider}": ${matches.join(", ")}`
          : `\nUse !model to see all available models.`;

      return `Model not found: ${provider}/${modelId}.${hint}`;
    }

    if (isSameModel(session.model, model)) {
      return `Already using ${provider}/${modelId}.`;
    }

    await session.setModel(model);
    await this.applyConfiguredThinkingLevelForSession(session);

    const thinkingInfo = session.supportsThinking()
      ? ` (thinking: ${session.thinkingLevel})`
      : "";

    return `Switched to ${provider}/${modelId}${thinkingInfo}.`;
  }

  getCurrentModelDisplay(session?: AgentSession | null): string {
    if (!session?.model) {
      return "(no model selected)";
    }

    return `${session.model.provider}/${session.model.id}`;
  }

  getThinkingLevel(session: AgentSession): {
    current: ThinkingLevel;
    available: ThinkingLevel[];
    supported: boolean;
  } {
    if (!session.supportsThinking()) {
      return { current: "off", available: [], supported: false };
    }

    return {
      current: session.thinkingLevel,
      available: session.getAvailableThinkingLevels(),
      supported: true,
    };
  }

  setThinkingLevel(session: AgentSession, level: ThinkingLevel): string {
    if (!session.supportsThinking()) {
      return "Current model does not support reasoning/thinking.";
    }

    const available = session.getAvailableThinkingLevels();
    if (!available.includes(level)) {
      return `Invalid thinking level "${level}" for current model. Available: ${available.join(", ")}`;
    }

    session.setThinkingLevel(level);
    return `Thinking level set to "${level}".`;
  }

  private async applyConfiguredThinkingLevelForSession(
    session: AgentSession,
  ): Promise<void> {
    if (session.supportsThinking()) {
      const available = session.getAvailableThinkingLevels();
      if (available.includes(this.config.thinkingLevel)) {
        session.setThinkingLevel(this.config.thinkingLevel);
        logger.debug(
          {
            level: this.config.thinkingLevel,
          },
          "thinking level applied",
        );
      } else {
        logger.debug(
          {
            requested: this.config.thinkingLevel,
            available,
          },
          "thinking level not available for model",
        );
      }
    }
  }
}

function isSameModel(
  currentModel: Model<any> | undefined,
  desiredModel: Model<any>,
): boolean {
  if (!currentModel) {
    return false;
  }

  return (
    currentModel.provider === desiredModel.provider &&
    currentModel.id === desiredModel.id
  );
}
