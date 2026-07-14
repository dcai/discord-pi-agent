import type { CommandContext } from "./session-commands/shared";

export type CommandCategory = "core" | "scheduler" | "prompt";

export type CommandDescriptor = {
  id: string;
  category: CommandCategory;
  usage: string;
  description: string;
  aliases?: string[];
  slashUsage?: string;
  slashDescription?: string;
  aliasDescription?: string;
  surfaces: Array<"prefix" | "slash">;
  availability: "always" | "scheduler" | "thread" | "slash";
};

export const COMMAND_DESCRIPTORS: CommandDescriptor[] = [
  {
    id: "help",
    category: "core",
    usage: "help",
    description: "show this message",
    surfaces: ["prefix", "slash"],
    availability: "always",
  },
  {
    id: "status",
    category: "core",
    usage: "status",
    description: "show current session status",
    surfaces: ["prefix", "slash"],
    availability: "always",
  },
  {
    id: "thinking",
    category: "core",
    usage: "thinking [level]",
    description: "show or set thinking/reasoning level",
    surfaces: ["prefix", "slash"],
    availability: "always",
  },
  {
    id: "model",
    category: "core",
    usage: "model [provider/modelId]",
    description: "list available models or switch to one",
    surfaces: ["prefix", "slash"],
    availability: "always",
  },
  {
    id: "compact",
    category: "core",
    usage: "compact",
    description: "compact the persistent session",
    surfaces: ["prefix", "slash"],
    availability: "always",
  },
  {
    id: "session.reset",
    category: "core",
    usage: "session reset <scope|here>",
    slashUsage: "session-reset <scope>",
    description: "reset persisted session data for a scope",
    surfaces: ["prefix", "slash"],
    availability: "always",
  },
  {
    id: "reload",
    category: "core",
    usage: "reload",
    description: "reload resources",
    surfaces: ["prefix", "slash"],
    availability: "always",
  },
  {
    id: "abort",
    category: "core",
    usage: "abort",
    description: "abort the active run and clear queued prompts",
    surfaces: ["prefix", "slash"],
    availability: "always",
  },
  {
    id: "reaction",
    category: "core",
    usage: "reaction [emoji]",
    description: "show or set the working reaction emoji",
    surfaces: ["prefix", "slash"],
    availability: "always",
  },
  {
    id: "archive",
    category: "core",
    usage: "archive",
    description: "archive this thread and end the session",
    surfaces: ["prefix", "slash"],
    availability: "thread",
  },
  {
    id: "remind",
    category: "scheduler",
    usage: "remind <when>, <task>",
    description: "create a one-off runtime reminder",
    surfaces: ["prefix", "slash"],
    availability: "scheduler",
  },
  {
    id: "jobs",
    category: "scheduler",
    usage: "jobs",
    description: "list loaded scheduled jobs",
    surfaces: ["prefix", "slash"],
    availability: "scheduler",
  },
  {
    id: "jobs.reload",
    category: "scheduler",
    usage: "jobs reload",
    slashUsage: "jobs-reload",
    description: "reload scheduled jobs from the jobs file",
    surfaces: ["prefix", "slash"],
    availability: "scheduler",
  },
  {
    id: "job.run_here",
    category: "scheduler",
    usage: "job <id>",
    slashUsage: "job run-here <id>",
    description: "run one scheduled job in this conversation",
    slashDescription: "run one scheduled job now in this conversation",
    aliasDescription: "run one scheduled job now in this conversation",
    aliases: ["job run-here <id>"],
    surfaces: ["prefix", "slash"],
    availability: "scheduler",
  },
  {
    id: "job.info",
    category: "scheduler",
    usage: "job info <id>",
    description: "show one scheduled job",
    surfaces: ["prefix", "slash"],
    availability: "scheduler",
  },
  {
    id: "job.run",
    category: "scheduler",
    usage: "job run <id>",
    description: "run one scheduled job now (configured target)",
    surfaces: ["prefix", "slash"],
    availability: "scheduler",
  },
  {
    id: "job.update",
    category: "scheduler",
    usage: "job update <what you want changed>",
    description: "edit the jobs file via the agent",
    surfaces: ["prefix"],
    availability: "scheduler",
  },
  {
    id: "prompt",
    category: "prompt",
    usage: "prompt <text>",
    description: "send a prompt through the current session",
    aliases: ["p <text>"],
    surfaces: ["slash"],
    availability: "slash",
  },
];

const commandDescriptorsById = new Map(
  COMMAND_DESCRIPTORS.map((descriptor) => {
    return [descriptor.id, descriptor];
  }),
);

export function getCommandDescriptor(
  commandId: string,
): CommandDescriptor | undefined {
  return commandDescriptorsById.get(commandId);
}

export function classifySessionCommand(input: string): string | null {
  const normalizedInput = input.trim();
  const commandInput = normalizedInput.replace(/^[^\w\s]+/, "").trim();
  const parts = commandInput.split(/\s+/);
  const root = parts[0];
  if (!root) {
    return "unknown";
  }

  if (parts.length === 1) {
    switch (root) {
      case "help":
      case "status":
      case "compact":
      case "reload":
      case "abort":
      case "reaction":
      case "archive":
      case "jobs":
      case "thinking":
      case "model":
      case "remind":
        return root;
      default:
        break;
    }
  }

  if (root === "session" && parts[1] === "reset") {
    return "session.reset";
  }

  if (root === "jobs" && parts[1] === "reload" && parts.length === 2) {
    return "jobs.reload";
  }

  if (root === "job") {
    const subcommand = parts[1];
    if (
      subcommand === "run" ||
      subcommand === "run-here" ||
      subcommand === "info" ||
      subcommand === "update"
    ) {
      return `job.${subcommand.replace("-", "_")}`;
    }

    if (parts.length === 2 && subcommand) {
      return "job.run_here";
    }
  }

  if (
    (root === "thinking" ||
      root === "model" ||
      root === "reaction" ||
      root === "remind") &&
    parts.length > 1
  ) {
    return root;
  }

  return "unknown";
}

export function formatCommandInventoryHelp(context: CommandContext): string {
  const prefix = context.commandPrefixes?.[0] ?? "!";
  const descriptors = COMMAND_DESCRIPTORS.filter((descriptor) => {
    return isCommandAvailable(descriptor, context);
  });
  const sections = new Map<CommandCategory, string[]>();

  for (const descriptor of descriptors) {
    const lines = sections.get(descriptor.category) ?? [];
    for (const surface of descriptor.surfaces) {
      const usage =
        surface === "slash"
          ? (descriptor.slashUsage ?? descriptor.usage)
          : descriptor.usage;
      const formatUsage =
        surface === "slash" ? `/${usage}` : `${prefix}${usage}`;
      const description =
        surface === "slash"
          ? (descriptor.slashDescription ?? descriptor.description)
          : descriptor.description;
      lines.push(`${formatUsage} - ${description}`);
      for (const alias of descriptor.aliases ?? []) {
        const formattedAlias =
          surface === "slash" ? `/${alias}` : `${prefix}${alias}`;
        if (formattedAlias === formatUsage) {
          continue;
        }
        lines.push(
          `${formattedAlias} - ${descriptor.aliasDescription ?? description}`,
        );
      }
    }
    sections.set(descriptor.category, lines);
  }

  const categoryLabels: Record<CommandCategory, string> = {
    core: "Core commands",
    scheduler: "Scheduler commands",
    prompt: "Slash prompt commands",
  };
  const categoryOrder: CommandCategory[] = ["core", "scheduler", "prompt"];
  const output: string[] = ["Commands:"];

  for (const category of categoryOrder) {
    const lines = sections.get(category);
    if (!lines || lines.length === 0) {
      continue;
    }

    output.push("", `${categoryLabels[category]}:`, ...lines);
  }

  const resources = context.agentService.resources;
  const promptTemplates =
    typeof resources.getPromptTemplates === "function"
      ? resources.getPromptTemplates()
      : [];
  const promptTemplateLines = promptTemplates.map((template) => {
    return `${prefix}${template.name} <args> - loaded Pi prompt template`;
  });

  if (promptTemplateLines.length > 0) {
    output.push("", "Loaded prompt templates:", ...promptTemplateLines);
  }

  output.push("", "Any other text goes to the agent session.");
  return output.join("\n");
}

function isCommandAvailable(
  descriptor: CommandDescriptor,
  context: CommandContext,
): boolean {
  if (descriptor.availability === "scheduler") {
    return Boolean(context.taskScheduler);
  }

  if (descriptor.availability === "thread") {
    return context.scope.startsWith("thread:");
  }

  return true;
}
