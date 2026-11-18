#!/usr/bin/env node
// Copies the vitrine CLI from a Vitrine checkout into cli/ and writes the root package.json,
// so `npm install -g github:DrunkenDealer/claude-code-vitrine-deck` installs it.
// Usage: VITRINE_HOME=/path/to/Vitrine node scripts/sync-cli.mjs
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const home = process.env.VITRINE_HOME;
if (!home) throw new Error("set VITRINE_HOME to a Vitrine checkout");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "cli");

const imports = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const files = new Set();
const packages = new Set();
const walk = (file) => {
  if (files.has(file)) return;
  files.add(file);
  for (const m of readFileSync(file, "utf8").matchAll(imports)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith(".")) walk(resolve(dirname(file), spec));
    else if (!spec.startsWith("node:")) packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
  }
};
walk(join(home, "src/index.js"));

// read at runtime by path, not imported
const tracked = execFileSync("git", ["ls-files", "assets", "examples"], { cwd: home, encoding: "utf8" }).split("\n").filter(Boolean);

rmSync(dest, { recursive: true, force: true });
for (const rel of [...[...files].map((f) => relative(home, f)), ...tracked]) {
  mkdirSync(dirname(join(dest, rel)), { recursive: true });
  cpSync(join(home, rel), join(dest, rel));
}

const vitrine = JSON.parse(readFileSync(join(home, "package.json"), "utf8"));
// optional: only --headline-from-description loads it, and says how to install it
packages.delete("@anthropic-ai/sdk");
const dependencies = Object.fromEntries([...packages].sort().map((p) => [p, vitrine.dependencies[p]]));
const pkg = {
  name: "vitrine",
  version: vitrine.version,
  description: "The Vitrine CLI: design, grade, render and publish App Store and Google Play screenshot decks.",
  type: "module",
  bin: { vitrine: "cli/src/index.js" },
  files: ["cli"],
  engines: vitrine.engines,
  dependencies,
  private: true,
};
writeFileSync(join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`cli/: ${files.size} modules, ${tracked.length} assets, vitrine ${vitrine.version}; deps: ${Object.keys(dependencies).join(", ")}`);
