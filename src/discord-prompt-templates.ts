import type { PromptTemplate } from "@earendil-works/pi-coding-agent";

export const RESERVED_DISCORD_PREFIX_COMMAND_NAMES = new Set([
  "help",
  "status",
  "thinking",
  "model",
  "compact",
  "session",
  "abort",
  "reload",
  "reaction",
  "archive",
  "jobs",
  "job",
  "remind",
]);

export type DiscordPromptTemplateMatchResult =
  | {
      matched: false;
    }
  | {
      matched: true;
      expandedPrompt: string;
      template: PromptTemplate;
    };

export function expandDiscordPromptTemplateCommand(
  input: string,
  commandPrefixes: string[],
  templates: PromptTemplate[],
): DiscordPromptTemplateMatchResult {
  const prefixedCommand = findPrefixedCommand(input, commandPrefixes);
  if (!prefixedCommand) {
    return { matched: false };
  }

  if (RESERVED_DISCORD_PREFIX_COMMAND_NAMES.has(prefixedCommand.commandName)) {
    return { matched: false };
  }

  const template = templates.find((candidate) => {
    return candidate.name === prefixedCommand.commandName;
  });
  if (!template) {
    return { matched: false };
  }

  return {
    matched: true,
    expandedPrompt: substituteArgs(
      template.content,
      parseCommandArgs(prefixedCommand.argsString),
    ),
    template,
  };
}

type PrefixedCommand = {
  commandName: string;
  argsString: string;
};

function findPrefixedCommand(
  input: string,
  commandPrefixes: string[],
): PrefixedCommand | null {
  for (const prefix of commandPrefixes) {
    if (!prefix) {
      continue;
    }

    if (!input.startsWith(prefix)) {
      continue;
    }

    const remainder = input.slice(prefix.length).trimStart();
    if (!remainder) {
      return null;
    }

    const match = remainder.match(/^([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) {
      return null;
    }

    return {
      commandName: match[1],
      argsString: match[2] ?? "",
    };
  }

  return null;
}

/**
 * Matches pi's prompt-template argument parsing so Discord prefix aliases
 * behave the same as native `/template ...` invocations.
 */
function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let index = 0; index < argsString.length; index += 1) {
    const char = argsString[index];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Matches pi's prompt-template placeholder support:
 * - $1, $2, ...
 * - $@ and $ARGUMENTS
 * - ${N:-default}
 * - ${@:N}
 * - ${@:N:L}
 */
function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");

  return content.replace(
    /\$\{(\d+):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultNum, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultNum) {
        const index = parseInt(defaultNum, 10) - 1;
        const value = args[index];
        return value ? value : defaultValue;
      }

      if (sliceStart) {
        let start = parseInt(sliceStart, 10) - 1;
        if (start < 0) {
          start = 0;
        }

        if (sliceLength) {
          const length = parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }

        return args.slice(start).join(" ");
      }

      if (simple === "ARGUMENTS" || simple === "@") {
        return allArgs;
      }

      const index = parseInt(simple, 10) - 1;
      return args[index] ?? "";
    },
  );
}
