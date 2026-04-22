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
} from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { collectReply } from "./reply-buffer";
import type { AgentStatus, ResolvedDiscordPiBridgeConfig, ThinkingLevel } from "./types";

export class AgentService {
	private readonly config: ResolvedDiscordPiBridgeConfig;
	private readonly authStorage: AuthStorage;
	private readonly modelRegistry: ModelRegistryType;
	private readonly settingsManager: SettingsManager;
	private readonly resourceLoader: DefaultResourceLoader;
	private session: AgentSession | null = null;

	constructor(config: ResolvedDiscordPiBridgeConfig) {
		this.config = config;
		this.authStorage = AuthStorage.create(path.join(config.agentDir, "auth.json"));
		this.modelRegistry = ModelRegistry.create(this.authStorage, path.join(config.agentDir, "models.json"));
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
		console.log("[agent] config", {
			cwd: this.config.cwd,
			agentDir: this.config.agentDir,
			sessionDir: this.getSessionDir(),
			modelProvider: this.config.modelProvider,
			modelId: this.config.modelId,
			thinkingLevel: this.config.thinkingLevel,
		});
		await this.resourceLoader.reload();
		console.log("[agent] resources loaded", {
			extensions: this.resourceLoader.getExtensions().extensions.map((extension) => extension.path),
			agentsFiles: this.resourceLoader.getAgentsFiles().agentsFiles.map((file) => file.path),
		});
		await this.createOrResumeSession();
		await this.ensureConfiguredModel();
	}

	async prompt(text: string): Promise<string> {
		const session = this.requireSession();
		const transformedPrompt = await this.config.promptTransform(text);
		return collectReply(session, transformedPrompt, { logPrefix: `[agent:${session.sessionId}]` });
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
			sessionManager: SessionManager.create(this.config.cwd, this.getSessionDir()),
			thinkingLevel: this.config.thinkingLevel,
		});
		this.session = session;
		await this.ensureConfiguredModel();

		return `Started a fresh session. Old session kept at ${previousSession.sessionFile ?? "(unknown path)"}.`;
	}

	getStatus(): AgentStatus {
		const session = this.requireSession();
		const model = session.model ? `${session.model.provider}/${session.model.id}` : "(no model selected)";
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
			sessionManager: SessionManager.continueRecent(this.config.cwd, this.getSessionDir()),
			thinkingLevel: this.config.thinkingLevel,
		});
		this.session = session;
		console.log("[agent] session ready", {
			sessionId: session.sessionId,
			sessionFile: session.sessionFile,
			restoredModel: session.model ? `${session.model.provider}/${session.model.id}` : null,
		});
	}

	private async ensureConfiguredModel(): Promise<void> {
		const session = this.requireSession();
		const desiredModel = this.modelRegistry.find(this.config.modelProvider, this.config.modelId);
		const availableModels = await this.modelRegistry.getAvailable();

		console.log("[agent] available models", {
			count: availableModels.length,
			matches: availableModels
				.filter((model) => {
					return model.provider === this.config.modelProvider;
				})
				.map((model) => `${model.provider}/${model.id}`),
		});

		if (!desiredModel) {
			throw new Error(
				`Configured model not found: ${this.config.modelProvider}/${this.config.modelId}. Check your pi agent config and installed extensions.`,
			);
		}

		if (isSameModel(session.model, desiredModel)) {
			console.log("[agent] model already selected", {
				model: `${desiredModel.provider}/${desiredModel.id}`,
			});
			return;
		}

		console.log("[agent] switching model", {
			from: session.model ? `${session.model.provider}/${session.model.id}` : null,
			to: `${desiredModel.provider}/${desiredModel.id}`,
		});
		await session.setModel(desiredModel);
		await this.applyConfiguredThinkingLevel();
	}

	private requireSession(): AgentSession {
		if (!this.session) {
			throw new Error("Agent session has not been initialized.");
		}

		return this.session;
	}

	private async applyConfiguredThinkingLevel(): Promise<void> {
		const session = this.requireSession();
		if (session.supportsThinking()) {
			const available = session.getAvailableThinkingLevels();
			if (available.includes(this.config.thinkingLevel)) {
				session.setThinkingLevel(this.config.thinkingLevel);
				console.log("[agent] thinking level applied", { level: this.config.thinkingLevel });
			} else {
				console.log("[agent] thinking level not available for model", {
					requested: this.config.thinkingLevel,
					available,
				});
			}
		}
	}

	getThinkingLevel(): { current: ThinkingLevel; available: ThinkingLevel[]; supported: boolean } {
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

function isSameModel(currentModel: Model<any> | undefined, desiredModel: Model<any>): boolean {
	if (!currentModel) {
		return false;
	}

	return currentModel.provider === desiredModel.provider && currentModel.id === desiredModel.id;
}
