import fs from "node:fs/promises";
import path from "node:path";

const DIST_DIR = new URL("../dist/", import.meta.url);

await rewriteRelativeImports(path.resolve(DIST_DIR.pathname));

async function rewriteRelativeImports(directory) {
  const entries = await fs.readdir(directory, {
    withFileTypes: true,
  });

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await rewriteRelativeImports(entryPath);
        return;
      }

      if (!entry.isFile() || !entry.name.endsWith(".js")) {
        return;
      }

      const contents = await fs.readFile(entryPath, "utf8");
      const rewrittenContents = rewriteImportSpecifiers(contents);

      if (rewrittenContents !== contents) {
        await fs.writeFile(entryPath, rewrittenContents);
      }
    }),
  );
}

function rewriteImportSpecifiers(contents) {
  return contents
    .replace(
      /(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
      (_match, prefix, specifier, suffix) => {
        return `${prefix}${appendJsExtension(specifier)}${suffix}`;
      },
    )
    .replace(
      /(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
      (_match, prefix, specifier, suffix) => {
        return `${prefix}${appendJsExtension(specifier)}${suffix}`;
      },
    );
}

function appendJsExtension(specifier) {
  if (path.extname(specifier)) {
    return specifier;
  }

  return `${specifier}.js`;
}
