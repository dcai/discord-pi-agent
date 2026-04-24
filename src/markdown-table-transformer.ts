/**
 * Transforms markdown tables into Discord-friendly code blocks.
 * Discord doesn't support markdown tables natively, so we:
 * 1. Detect markdown tables in the text
 * 2. Wrap them in triple backticks
 * 3. Use Prettier to format the table with proper column alignment
 */

const TABLE_BLOCK_REGEX =
  /(\|.+?(?:\|.*)+)(\n\|[-:]+(?:\|[-:]+)+\|?)(\n\|.+?(?:\|.*)+\|?)+/g;

const CODE_BLOCK_WRAPPER = "```\n{TABLE}\n```";

/**
 * Transforms markdown tables in the text to Discord-friendly code blocks.
 * Tables are detected by their markdown syntax and wrapped in triple backticks.
 * Table contents are formatted with Prettier for proper column alignment.
 */
export async function transformMarkdownTablesToCodeBlocks(
  text: string,
): Promise<string> {
  // Collect all table matches first (String.replace doesn't support async callbacks)
  const matches = [...text.matchAll(TABLE_BLOCK_REGEX)];

  if (matches.length === 0) {
    return text;
  }

  // Process all tables in parallel
  const formattedTables = await Promise.all(
    matches.map((match) => formatTableWithPrettier(match[0])),
  );

  // Replace all tables with their formatted versions
  let result = text;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const originalTable = match[0];
    const formattedTable = formattedTables[i];
    const wrappedTable = CODE_BLOCK_WRAPPER.replace("{TABLE}", formattedTable);
    result = result.replace(originalTable, wrappedTable);
  }

  return result;
}

/**
 * Parses a markdown table and returns the rows as 2D arrays.
 */
function parseMarkdownTable(table: string): string[][] {
  const lines = table.trim().split("\n");
  return lines.map((line) => {
    return line
      .split("|")
      .filter((cell) => cell.trim() !== "")
      .map((cell) => cell.trim());
  });
}

/**
 * Formats a markdown table using Prettier's parser for markdown tables.
 * Falls back to manual formatting if Prettier doesn't support the table.
 */
async function formatTableWithPrettier(table: string): Promise<string> {
  const prettier = await import("prettier");

  try {
    // Try using Prettier's markdown parser to format the table
    const formatted = await prettier.format(table, {
      parser: "markdown",
      printWidth: 80,
    });

    // Prettier might add trailing newlines, trim them
    return formatted.trim();
  } catch {
    // If Prettier fails, fall back to manual formatting
    return formatTableManually(table);
  }
}

/**
 * Manually formats a markdown table with proper column alignment.
 * Used as fallback when Prettier can't handle the table format.
 */
function formatTableManually(table: string): string {
  const rows = parseMarkdownTable(table);

  if (rows.length === 0) {
    return table;
  }

  // Calculate max width for each column
  const columnCount = Math.max(...rows.map((row) => row.length));
  const columnWidths: number[] = Array(columnCount).fill(0);

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      columnWidths[i] = Math.max(columnWidths[i], row[i].length);
    }
  }

  // Format each row with proper padding
  const formattedRows = rows.map((row, rowIndex) => {
    const paddedCells = row.map((cell, colIndex) => {
      const width = columnWidths[colIndex];
      return padCell(cell, width);
    });

    // Add spacing around cells
    return "| " + paddedCells.join(" | ") + " |";
  });

  // Insert separator row after header (row 0)
  if (formattedRows.length > 1) {
    const separatorCells = columnWidths.map((width) => {
      return "-".repeat(width);
    });
    const separator = "| " + separatorCells.join(" | ") + " |";
    formattedRows.splice(1, 0, separator);
  }

  return formattedRows.join("\n");
}

/**
 * Pads a cell value to a specific width, with proper alignment.
 */
function padCell(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return value + " ".repeat(width - value.length);
}

/**
 * Synchronous version that wraps tables in code blocks but skips Prettier formatting.
 * Useful when you want quick transformation without async overhead.
 */
export function transformMarkdownTablesSync(text: string): string {
  return text.replace(TABLE_BLOCK_REGEX, (tableMatch) => {
    return CODE_BLOCK_WRAPPER.replace("{TABLE}", tableMatch.trim());
  });
}
