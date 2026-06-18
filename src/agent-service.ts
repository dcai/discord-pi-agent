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
import { AgentModelService } from "./agent-model-service";
import { AgentResourceService } from "./agent-resource-service";
import { createModuleLogger } from "./logger";
import { runAgentTurn } from "./agent-turn-runner";
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

  readonly models: AgentModelService;
  readonly resources: AgentResourceService;

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
    this.models = new AgentModelService(config, this.modelRegistry);
    this.resources = new AgentResourceService(this.resourceLoader);
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

  async resetMainSession(): Promise<AgentSession> {
    const session = this.session;
    if (session) {
      await session.abort();
      session.dispose();
      this.session = null;
    }

    await fs.rm(this.getSessionDir(), { recursive: true, force: true });
    await fs.mkdir(this.getSessionDir(), { recursive: true });
    await this.createOrResumeSession();
    await this.ensureConfiguredModel();
    return this.requireSession();
  }

  /**
   * Create a temporary in-memory session. For one-shot tasks like image
   * description — no file persistence, no cleanup needed. The caller must
   * setModel() before prompting and dispose() when done.
   */
  async createTemporarySession(
    options: {
      thinkingLevel?: ThinkingLevel;
    } = {},
  ): Promise<AgentSession> {
    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: this.resourceLoader,
      settingsManager: this.settingsManager,
      sessionManager: SessionManager.inMemory(),
      thinkingLevel: options.thinkingLevel ?? "off",
    });
    logger.debug({ sessionId: session.sessionId }, "temporary session created");
    return session;
  }

  async createSession(
    sessionDir: string,
    options: {
      reuseExisting?: boolean;
    } = {},
  ): Promise<AgentSession> {
    const reuseExisting = options.reuseExisting ?? true;
    await fs.mkdir(sessionDir, { recursive: true });
    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: this.resourceLoader,
      settingsManager: this.settingsManager,
      sessionManager: reuseExisting
        ? SessionManager.continueRecent(this.config.cwd, sessionDir)
        : SessionManager.create(this.config.cwd, sessionDir),
      thinkingLevel: this.config.thinkingLevel,
    });
    logger.debug(
      {
        sessionDir,
        reuseExisting,
        sessionId: session.sessionId,
        sessionFile: session.sessionFile,
      },
      "scoped session created",
    );
    await this.models.ensureSessionHasConfiguredModel(session);
    return session;
  }

  async prompt(text: string): Promise<string> {
    const session = this.requireSession();
    const transformedPrompt = await this.config.promptTransform({
      rawContent: text,
      discordMetadata: "",
      now: () => "",
      userMessage: () => text,
    });
    return runAgentTurn(session, transformedPrompt);
  }

  async compact(): Promise<string> {
    const session = this.requireSession();
    await session.compact();
    return `Compaction finished for session ${session.sessionId}.`;
  }

  getStatus(): AgentStatus {
    const session = this.requireSession();
    const model = this.models.getCurrentModelDisplay(session);
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
    await this.models.ensureSessionHasConfiguredModel(this.requireSession());
  }

  private requireSession(): AgentSession {
    if (!this.session) {
      throw new Error("Agent session has not been initialized.");
    }

    return this.session;
  }

  private getSessionDir(): string {
    return path.join(this.config.agentDir, "sessions");
  }
}
