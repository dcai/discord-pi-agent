import { describe, expect, it } from "vitest";
import type { PromptTemplate } from "@earendil-works/pi-coding-agent";
import {
  expandDiscordPromptTemplateCommand,
  RESERVED_DISCORD_PREFIX_COMMAND_NAMES,
} from "./discord-prompt-templates";

function createTemplate(
  overrides: Partial<PromptTemplate> = {},
): PromptTemplate {
  return {
    name: "journal",
    description: "Journal template",
    content: "Notes: $1\nAll: $ARGUMENTS",
    filePath: "/repo/.pi/prompts/journal.md",
    sourceInfo: {} as never,
    ...overrides,
  };
}

describe("expandDiscordPromptTemplateCommand", () => {
  it("returns unmatched for normal chat text", () => {
    expect(
      expandDiscordPromptTemplateCommand(
        "hello there",
        ["!"],
        [createTemplate()],
      ),
    ).toEqual({ matched: false });
  });

  it("expands a matching Discord-prefixed template command", () => {
    expect(
      expandDiscordPromptTemplateCommand(
        '!journal "today was good" rollout',
        ["!"],
        [createTemplate()],
      ),
    ).toEqual({
      matched: true,
      expandedPrompt: "Notes: today was good\nAll: today was good rollout",
      template: createTemplate(),
    });
  });

  it("supports multiple configured command prefixes", () => {
    expect(
      expandDiscordPromptTemplateCommand(
        ";journal one two",
        [";", "!"],
        [createTemplate({ content: "Args: ${@:2}" })],
      ),
    ).toEqual({
      matched: true,
      expandedPrompt: "Args: two",
      template: createTemplate({ content: "Args: ${@:2}" }),
    });
  });

  it("does not shadow reserved built-in command names", () => {
    expect(RESERVED_DISCORD_PREFIX_COMMAND_NAMES.has("help")).toBe(true);
    expect(
      expandDiscordPromptTemplateCommand(
        "!help review this",
        ["!"],
        [createTemplate({ name: "help", content: "Should not run" })],
      ),
    ).toEqual({ matched: false });
  });

  it("returns unmatched when no template name exists", () => {
    expect(
      expandDiscordPromptTemplateCommand(
        "!missing test",
        ["!"],
        [createTemplate()],
      ),
    ).toEqual({ matched: false });
  });
});
