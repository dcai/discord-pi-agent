import fs from "node:fs/promises";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ModelRegistry as ModelRegistryType,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { createModuleLogger } from "./logger";
import { collectReply } from "./reply-buffer";
import type {
  AgentStatus,
  ResolvedDiscordGatewayConfig,
  ThinkingLevel,
} from "./types";

const logger = createModuleLogger("agent-service");

export class AgentService {
  private readonly config: ResolvedDiscordGatewayConfig;
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistryType;
  private readonly settingsManager: SettingsManager;
  private readonly resourceLoader: DefaultResourceLoader;
  private session: AgentSession | null = null;

  constructor(config: ResolvedDiscordGatewayConfig) {
    this.config = config;
    this.authStorage = AuthStorage.create(
      path.join(config.agentDir, "auth.json"),
    );
    this.modelRegistry = ModelRegistry.create(
      this.authStorage,
      path.join(config.agentDir, "models.json"),
    );
    this.settingsManager = SettingsManager.create(config.cwd, config.agentDir);
    this.resourceLoader = new DefaultResourceLoader({
      cwd: config.cwd,
      agentDir: config.agentDir,
      settingsManager: this.settingsManager,
    });
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.config.agentDir, { recursive: true });
    await fs.mkdir(this.getSessionDir(), { recursive: true });
    logger.info(
      {
        cwd: this.config.cwd,
        agentDir: this.config.agentDir,
        sessionDir: this.getSessionDir(),
        modelProvider: this.config.modelProvider,
        modelId: this.config.modelId,
        thinkingLevel: this.config.thinkingLevel,
      },
      "config",
    );
    await this.resourceLoader.reload();
    logger.info(
      {
        extensions: this.resourceLoader
          .getExtensions()
          .extensions.map((extension) => extension.path),
        agentsFiles: this.resourceLoader
          .getAgentsFiles()
          .agentsFiles.map((file) => file.path),
      },
      "resources loaded",
    );
    await this.createOrResumeSession();
    await this.ensureConfiguredModel();
  }

  getSession(): AgentSession | null {
    return this.session;
  }

  getAgentDir(): string {
    return this.config.agentDir;
  }

  /**
   * Create a temporary in-memory session. For one-shot tasks like image
   * description — no file persistence, no cleanup needed. The caller must
   * setModel() before prompting and dispose() when done.
   */
  async createTemporarySession(): Promise<AgentSession> {
    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: this.resourceLoader,
      settingsManager: this.settingsManager,
      sessionManager: SessionManager.inMemory(),
      thinkingLevel: "off",
    });
    logger.debug({ sessionId: session.sessionId }, "temporary session created");
    return session;
  }

  /** Find a model by provider and ID. Returns undefined if not found. */
  findModel(provider: string, modelId: string): Model<any> | undefined {
    return this.modelRegistry.find(provider, modelId);
  }

  async createSession(sessionDir: string): Promise<AgentSession> {
    await fs.mkdir(sessionDir, { recursive: true });
    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: this.resourceLoader,
      settingsManager: this.settingsManager,
      sessionManager: SessionManager.continueRecent(
        this.config.cwd,
        sessionDir,
      ),
      thinkingLevel: this.config.thinkingLevel,
    });
    logger.debug(
      {
        sessionDir,
        sessionId: session.sessionId,
        sessionFile: session.sessionFile,
      },
      "scoped session created",
    );
    await this.ensureModelForSession(session);
    return session;
  }

  async prompt(text: string): Promise<string> {
    const session = this.requireSession();
    const transformedPrompt = await this.config.promptTransform(text);
    return collectReply(session, transformedPrompt, {
      logPrefix: `[agent:${session.sessionId}]`,
    });
  }

  getSkillsSummary(): string {
    const result = this.resourceLoader.getSkills();
    const { skills } = result;

    if (skills.length === 0) {
      return "Skills: (none loaded)";
    }

    const names = skills.map((s) => s.name);
    return `Skills (${skills.length}): ${names.join(", ") || "(none)"}`;
  }

  async reloadResources(): Promise<string> {
    await this.resourceLoader.reload();
    const extensions = this.resourceLoader
      .getExtensions()
      .extensions.map((ext) => ext.path);
    const skills = this.resourceLoader.getSkills();
    const skillNames = skills.skills.map((s) => s.name);
    const agentsFiles = this.resourceLoader
      .getAgentsFiles()
      .agentsFiles.map((f) => f.path);

    return [
      "Resources reloaded.",
      `Extensions (${extensions.length}): ${extensions.join(", ") || "(none)"}`,
      `Skills (${skills.skills.length}): ${skillNames.join(", ") || "(none)"}`,
      `AGENTS.md files (${agentsFiles.length}): ${agentsFiles.join(", ") || "(none)"}`,
    ].join("\n");
  }

  getExtensionsSummary(): string {
    const result = this.resourceLoader.getExtensions();
    const { extensions, errors } = result;

    if (extensions.length === 0) {
      return "Extensions: (none loaded)";
    }

    const lines = extensions.map((ext) => {
      const toolCount = ext.tools.size;
      const commandCount = ext.commands.size;
      const parts: string[] = [];
      if (toolCount > 0) {
        parts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
      }
      if (commandCount > 0) {
        parts.push(`${commandCount} command${commandCount !== 1 ? "s" : ""}`);
      }
      const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return `  ${ext.path}${summary}`;
    });

    const header = `Extensions (${extensions.length}):`;
    const errorLines =
      errors.length > 0
        ? [
            `Errors (${errors.length}):`,
            ...errors.map((e) => `  ${e.path}: ${e.error}`),
          ]
        : [];

    return [header, ...lines, ...errorLines].join("\n");
  }

  async compact(): Promise<string> {
    const session = this.requireSession();
    await session.compact();
    return `Compaction finished for session ${session.sessionId}.`;
  }

  async resetSession(): Promise<string> {
    const previousSession = this.requireSession();
    await previousSession.abort();
    previousSession.dispose();
    this.session = null;

    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: this.resourceLoader,
      settingsManager: this.settingsManager,
      sessionManager: SessionManager.create(
        this.config.cwd,
        this.getSessionDir(),
      ),
      thinkingLevel: this.config.thinkingLevel,
    });
    this.session = session;
    await this.ensureConfiguredModel();

    return `Started a fresh session. Old session kept at ${previousSession.sessionFile ?? "(unknown path)"}.`;
  }

  getStatus(): AgentStatus {
    const session = this.requireSession();
    const model = session.model
      ? `${session.model.provider}/${session.model.id}`
      : "(no model selected)";
    const contextUsage = session.getContextUsage();

    const thinkingInfo = session.supportsThinking()
      ? `thinking: ${session.thinkingLevel} (available: ${session.getAvailableThinkingLevels().join(", ")})`
      : "thinking: not supported";

    return {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      model,
      streaming: session.isStreaming,
      contextUsage,
      thinkingInfo,
    };
  }

  async shutdown(): Promise<void> {
    const session = this.session;
    if (session) {
      await session.abort();
      session.dispose();
    }
    await this.settingsManager.flush();
  }

  private async createOrResumeSession(): Promise<void> {
    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: this.resourceLoader,
      settingsManager: this.settingsManager,
      sessionManager: SessionManager.continueRecent(
        this.config.cwd,
        this.getSessionDir(),
      ),
      thinkingLevel: this.config.thinkingLevel,
    });
    this.session = session;
    logger.info(
      {
        sessionId: session.sessionId,
        sessionFile: session.sessionFile,
        restoredModel: session.model
          ? `${session.model.provider}/${session.model.id}`
          : null,
      },
      "session ready",
    );
  }

  private async ensureConfiguredModel(): Promise<void> {
    await this.ensureModelForSession(this.requireSession());
  }

  private async ensureModelForSession(session: AgentSession): Promise<void> {
    // If the session already has a model (resumed from disk with a prior
    // model_change or user selection), keep it. Only apply the config
    // default for fresh sessions with no model selected.
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

  private requireSession(): AgentSession {
    if (!this.session) {
      throw new Error("Agent session has not been initialized.");
    }

    return this.session;
  }

  private async applyConfiguredThinkingLevel(): Promise<void> {
    await this.applyConfiguredThinkingLevelForSession(this.requireSession());
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

  async listModels(session?: AgentSession | null): Promise<string> {
    const effectiveSession = session ?? this.session;
    const availableModels = await this.modelRegistry.getAvailable();
    const currentDisplay = effectiveSession?.model
      ? `${effectiveSession.model.provider}/${effectiveSession.model.id}`
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
    session?: AgentSession | null,
  ): Promise<string> {
    const effectiveSession = session ?? this.requireSession();
    const model = this.modelRegistry.find(provider, modelId);

    if (!model) {
      const availableModels = await this.modelRegistry.getAvailable();
      const matches = availableModels
        .filter((m) => {
          return m.provider === provider;
        })
        .map((m) => `${m.provider}/${m.id}`);

      const hint =
        matches.length > 0
          ? `\nModels from "${provider}": ${matches.join(", ")}`
          : `\nUse !model to see all available models.`;

      return `Model not found: ${provider}/${modelId}.${hint}`;
    }

    if (isSameModel(effectiveSession.model, model)) {
      return `Already using ${provider}/${modelId}.`;
    }

    await effectiveSession.setModel(model);
    await this.applyConfiguredThinkingLevelForSession(effectiveSession);

    const thinkingInfo = effectiveSession.supportsThinking()
      ? ` (thinking: ${effectiveSession.thinkingLevel})`
      : "";

    return `Switched to ${provider}/${modelId}${thinkingInfo}.`;
  }

  getCurrentModelDisplay(session?: AgentSession | null): string {
    const effectiveSession = session ?? this.session;
    if (!effectiveSession?.model) {
      return "(no model selected)";
    }

    return `${effectiveSession.model.provider}/${effectiveSession.model.id}`;
  }

  getThinkingLevel(): {
    current: ThinkingLevel;
    available: ThinkingLevel[];
    supported: boolean;
  } {
    const session = this.requireSession();
    if (!session.supportsThinking()) {
      return { current: "off", available: [], supported: false };
    }
    return {
      current: session.thinkingLevel,
      available: session.getAvailableThinkingLevels(),
      supported: true,
    };
  }

  setThinkingLevel(level: ThinkingLevel): string {
    const session = this.requireSession();
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

  private getSessionDir(): string {
    return path.join(this.config.agentDir, "sessions");
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
