import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

export class AgentResourceService {
  private readonly resourceLoader: DefaultResourceLoader;

  constructor(resourceLoader: DefaultResourceLoader) {
    this.resourceLoader = resourceLoader;
  }

  getSkillsSummary(): string {
    const result = this.resourceLoader.getSkills();
    const { skills } = result;

    if (skills.length === 0) {
      return "Skills: (none loaded)";
    }

    const names = skills.map((skill) => {
      return skill.name;
    });
    return `Skills (${skills.length}): ${names.join(", ") || "(none)"}`;
  }

  getExtensionsSummary(): string {
    const result = this.resourceLoader.getExtensions();
    const { extensions, errors } = result;

    if (extensions.length === 0) {
      return "Extensions: (none loaded)";
    }

    const lines = extensions.map((extension) => {
      const toolCount = extension.tools.size;
      const commandCount = extension.commands.size;
      const parts: string[] = [];
      if (toolCount > 0) {
        parts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
      }
      if (commandCount > 0) {
        parts.push(`${commandCount} command${commandCount !== 1 ? "s" : ""}`);
      }
      const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return `  ${extension.path}${summary}`;
    });

    const header = `Extensions (${extensions.length}):`;
    const errorLines =
      errors.length > 0
        ? [
            `Errors (${errors.length}):`,
            ...errors.map((error) => {
              return `  ${error.path}: ${error.error}`;
            }),
          ]
        : [];

    return [header, ...lines, ...errorLines].join("\n");
  }

  async reloadResources(): Promise<string> {
    await this.resourceLoader.reload();
    const extensions = this.resourceLoader
      .getExtensions()
      .extensions.map((extension) => {
        return extension.path;
      });
    const skills = this.resourceLoader.getSkills();
    const skillNames = skills.skills.map((skill) => {
      return skill.name;
    });
    const agentsFiles = this.resourceLoader
      .getAgentsFiles()
      .agentsFiles.map((file) => {
        return file.path;
      });

    return [
      "Resources reloaded.",
      `Extensions (${extensions.length}): ${extensions.join(", ") || "(none)"}`,
      `Skills (${skills.skills.length}): ${skillNames.join(", ") || "(none)"}`,
      `AGENTS.md files (${agentsFiles.length}): ${agentsFiles.join(", ") || "(none)"}`,
    ].join("\n");
  }
}
