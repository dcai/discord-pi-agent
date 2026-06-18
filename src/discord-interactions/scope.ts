import {
  ChannelType,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { AgentService } from "../agent-service";
import type { SessionRegistry, SessionScope } from "../session-registry";
import type { TaskSchedulerService } from "../task-scheduler-service";
import type { GatewayAccessConfig, ThinkingLevel } from "../types";

export function resolveInteractionScope(
  interaction:
    | Interaction
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction
    | AutocompleteInteraction,
): SessionScope | null {
  if (!interaction.channel) {
    return null;
  }

  if (interaction.channel.type === ChannelType.DM) {
    return "dm";
  }

  if (interaction.channel.isThread()) {
    return `thread:${interaction.channel.id}`;
  }

  return null;
}

export function isAuthorizedInteraction(
  interaction:
    | Interaction
    | ChatInputCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction
    | AutocompleteInteraction,
  scope: SessionScope,
  accessConfig: GatewayAccessConfig,
): boolean {
  if (scope === "dm") {
    return interaction.user.id === accessConfig.discordAllowedUserId;
  }

  if (!scope.startsWith("thread:") || !interaction.channel?.isThread()) {
    return false;
  }

  const parentId = interaction.channel.parentId;
  if (
    !parentId ||
    !accessConfig.discordAllowedForumChannelIds.includes(parentId)
  ) {
    return false;
  }

  return accessConfig.discordAllowedUserIds.includes(interaction.user.id);
}

export function resolveSessionForAutocomplete(
  scope: SessionScope,
  agentService: AgentService,
  sessionRegistry: SessionRegistry,
) {
  if (scope === "dm") {
    return sessionRegistry.get("dm")?.session ?? agentService.getSession();
  }

  return sessionRegistry.get(scope)?.session ?? null;
}

export function buildThinkingChoices(
  session: ReturnType<AgentService["getSession"]>,
) {
  const levels: ThinkingLevel[] = session?.supportsThinking()
    ? session.getAvailableThinkingLevels()
    : ["off", "minimal", "low", "medium", "high", "xhigh"];

  return levels.map((level) => {
    return {
      name: level,
      value: level,
    };
  });
}

export function buildSessionScopeChoices(
  currentScope: SessionScope,
  sessionRegistry: SessionRegistry,
  taskScheduler?: TaskSchedulerService | null,
) {
  const scopes = new Set<SessionScope>();
  scopes.add("dm");
  scopes.add(currentScope);

  for (const scope of sessionRegistry.getScopes()) {
    scopes.add(scope);
  }

  for (const job of taskScheduler?.listJobs() ?? []) {
    scopes.add(`job:${job.id}` as SessionScope);
  }

  return Array.from(scopes)
    .sort((left, right) => left.localeCompare(right))
    .map((scope) => {
      return {
        name: scope,
        value: scope,
      };
    });
}

export function filterChoices(
  choices: Array<{ name: string; value: string }>,
  focusedValue: string,
): Array<{ name: string; value: string }> {
  const normalizedFocus = focusedValue.trim().toLowerCase();
  const rankedChoices = choices
    .filter((choice) => {
      if (!normalizedFocus) {
        return true;
      }

      return choice.name.toLowerCase().includes(normalizedFocus);
    })
    .sort((left, right) => {
      const leftStartsWith = left.name
        .toLowerCase()
        .startsWith(normalizedFocus);
      const rightStartsWith = right.name
        .toLowerCase()
        .startsWith(normalizedFocus);

      if (leftStartsWith === rightStartsWith) {
        return left.name.localeCompare(right.name);
      }

      return leftStartsWith ? -1 : 1;
    });

  return rankedChoices.slice(0, 25);
}
