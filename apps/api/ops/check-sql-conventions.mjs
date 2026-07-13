import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  }));
  return nested.flat();
}

const violations = [];
for (const file of await sourceFiles(fileURLToPath(new URL("../src", import.meta.url)))) {
  const source = await readFile(file, "utf8");
  if (/\bINSERT\s+OR\s+REPLACE\b/i.test(source) || /\bREPLACE\s+INTO\b/i.test(source))
    violations.push(path.relative(process.cwd(), file));
}

if (violations.length) {
  console.error(`Replace-style SQL is forbidden; use an explicit conflict target and update:\n${violations.join("\n")}`);
  process.exitCode = 1;
}
