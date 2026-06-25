import { describe, expect, it, vi } from "vitest";
import { AgentResourceService } from "./agent-resource-service";

function createResourceLoader() {
  return {
    getSkills: vi.fn(() => ({ skills: [], errors: [] })),
    getExtensions: vi.fn(() => ({ extensions: [], errors: [] })),
    getPrompts: vi.fn(() => ({ prompts: [], diagnostics: [] })),
    getAgentsFiles: vi.fn(() => ({ agentsFiles: [] })),
    reload: vi.fn(async () => undefined),
  };
}

describe("AgentResourceService", () => {
  it("returns empty summaries when nothing is loaded", () => {
    const loader = createResourceLoader();
    const service = new AgentResourceService(loader as never);

    expect(service.getSkillsSummary()).toBe("Skills: (none loaded)");
    expect(service.getExtensionsSummary()).toBe("Extensions: (none loaded)");
  });

  it("formats skill names and extension details", () => {
    const loader = createResourceLoader();
    loader.getSkills.mockReturnValue({
      skills: [{ name: "ascii-visualizer" }, { name: "github" }] as never,
      errors: [],
    });
    loader.getExtensions.mockReturnValue({
      extensions: [
        {
          path: "/ext/one",
          tools: new Map([["bash", {}]]),
          commands: new Map([
            ["help", {}],
            ["status", {}],
          ]),
        },
        {
          path: "/ext/two",
          tools: new Map(),
          commands: new Map(),
        },
      ] as never,
      errors: [{ path: "/ext/bad", error: "boom" }] as never,
    });

    const service = new AgentResourceService(loader as never);

    expect(service.getSkillsSummary()).toBe(
      "Skills (2): ascii-visualizer, github",
    );
    expect(service.getExtensionsSummary()).toBe(
      [
        "Extensions (2):",
        "  /ext/one (1 tool, 2 commands)",
        "  /ext/two",
        "Errors (1):",
        "  /ext/bad: boom",
      ].join("\n"),
    );
  });

  it("expands prompt template commands using Discord prefixes", () => {
    const loader = createResourceLoader();
    loader.getPrompts.mockReturnValue({
      prompts: [
        {
          name: "journal",
          description: "Journal template",
          content: "Journal: $1 | $ARGUMENTS",
          filePath: "/repo/.pi/prompts/journal.md",
          sourceInfo: {} as never,
        },
      ] as never,
      diagnostics: [],
    });

    const service = new AgentResourceService(loader as never);

    expect(
      service.expandPromptTemplateCommand('!journal "hello world" extra', [
        "!",
      ]),
    ).toEqual({
      matched: true,
      expandedPrompt: "Journal: hello world | hello world extra",
      template: {
        name: "journal",
        description: "Journal template",
        content: "Journal: $1 | $ARGUMENTS",
        filePath: "/repo/.pi/prompts/journal.md",
        sourceInfo: {} as never,
      },
    });
  });

  it("reloads resources and returns a formatted summary", async () => {
    const loader = createResourceLoader();
    loader.getSkills.mockReturnValue({
      skills: [{ name: "glimpse" }] as never,
      errors: [],
    });
    loader.getExtensions.mockReturnValue({
      extensions: [
        { path: "/ext/one", tools: new Map(), commands: new Map() },
      ] as never,
      errors: [],
    });
    loader.getPrompts.mockReturnValue({
      prompts: [
        {
          name: "journal",
          description: "Journal template",
          content: "content",
          filePath: "/repo/.pi/prompts/journal.md",
          sourceInfo: {} as never,
        },
      ] as never,
      diagnostics: [],
    });
    loader.getAgentsFiles.mockReturnValue({
      agentsFiles: [{ path: "/repo/AGENTS.md" }] as never,
    });

    const service = new AgentResourceService(loader as never);

    await expect(service.reloadResources()).resolves.toBe(
      [
        "Resources reloaded.",
        "Extensions (1): /ext/one",
        "Skills (1): glimpse",
        "Prompt templates (1): /journal",
        "AGENTS.md files (1): /repo/AGENTS.md",
      ].join("\n"),
    );
    expect(loader.reload).toHaveBeenCalled();
  });
});
