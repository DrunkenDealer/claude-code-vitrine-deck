#!/usr/bin/env node
// Checks every name the skill hands the agent against the live CLI: commands, flags, device ids,
// kinds, looks, presets, fault codes, polish verdicts, copy rules — and the error strings it quotes
// against the Vitrine source. Exit 1 on drift.
//   VITRINE_HOME=/path/to/Vitrine node evals/drift.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const skill = join(dirname(fileURLToPath(import.meta.url)), "../plugin/skills/vitrine-deck");
const home = process.env.VITRINE_HOME;
if (!home) {
  console.error("set VITRINE_HOME to a Vitrine checkout");
  process.exit(2);
}
const cli = (...args) => execFileSync("node", [join(home, "src/index.js"), ...args], { encoding: "utf8" });

const caps = JSON.parse(cli("capabilities"));
const help = JSON.parse(cli("help", "--json"));
const commands = new Set(help.commands.map((c) => c.name));
const flagsOf = new Map(
  [...commands].map((c) => [c, new Set(cli(c, "--help").match(/--[a-z][\w-]*/g) ?? [])]),
);
const known = {
  device: new Set(caps.devices.map((d) => d.id)),
  kind: new Set(caps.kinds.map((k) => k.id)),
  look: new Set(caps.looks.entries.map((l) => l.id)),
  preset: new Set(caps.layoutPresets.map((p) => p.id)),
  lens: new Set((caps.layers.lensPresets ?? []).map((p) => p.id ?? p)),
  locale: new Set(caps.locales.map((l) => l.id)),
  fault: new Set([
    ...Object.values(caps.faults).flatMap((v) => (Array.isArray(v) ? v.map((f) => f.code) : [])),
    caps.faults.copy.code,
    ...Object.keys(caps.faults.unweighted),
  ]),
  copyRule: new Set(caps.faults.copy.rules.map((r) => r.id)),
  polish: new Set(help.commands.find((c) => c.name === "polish").json.fields.changes.match(/kind: ([\w|-]+)/)[1].split("|")),
};

const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "evals" ? [] : files(p)) : p.endsWith(".md") ? [p] : [];
  });

let corpus;
const problems = [];
const report = (file, line, msg) => problems.push(`${relative(skill, file)}:${line}  ${msg}`);
const mentioned = { look: new Set(), device: new Set() };

for (const file of files(skill)) {
  const lines = readFileSync(file, "utf8").split("\n");
  // Join `\`-continued shell lines so a command's flags stay with it.
  const logical = [];
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i];
    const at = i + 1;
    while (text.trimEnd().endsWith("\\") && i + 1 < lines.length) text = text.trimEnd().slice(0, -1) + " " + lines[++i];
    logical.push([at, text]);
  }
  let section = "";
  let header = "";
  let fence = false;
  for (const [n, text] of logical) {
    if (text.startsWith("```")) fence = !fence;
    if (!fence && text.startsWith("#")) section = text;
    if (!text.startsWith("|")) header = "";
    else if (!header) header = text;

    for (const m of text.matchAll(/\bvitrine\s+([a-z]+)((?:\s+(?!#|vitrine\b)[^\s`|#]+)*)/g)) {
      const [, cmd, rest] = m;
      if (!commands.has(cmd)) {
        // In prose "vitrine" is also the app's name; a command is in a code block or backticks.
        if (fence || text.includes("`vitrine " + cmd)) report(file, n, `unknown command: vitrine ${cmd}`);
        continue;
      }
      for (const flag of rest.match(/--[a-z][\w-]*/g) ?? []) {
        if (!flagsOf.get(cmd).has(flag)) report(file, n, `vitrine ${cmd} has no ${flag}`);
      }
      for (const [flag, set] of [["--device", "device"], ["--look", "look"], ["--layout", "preset"], ["--kind", "kind"], ["--lens", "lens"], ["--locale", "locale"]]) {
        const v = rest.match(new RegExp(`${flag}[ =]([^\\s]+)`))?.[1];
        if (!v || v.startsWith("<")) continue;
        for (const id of v.replace(/\\$/, "").split(",")) if (!known[set].has(id)) report(file, n, `${flag} ${id}: not a ${set} id`);
      }
    }

    for (const [, tok] of text.matchAll(/`([^`\s]+)`/g)) {
      if (/^(iphone|ipad|android|play|app-store)-[\w.-]+$|^tv$/.test(tok)) {
        if (/-landscape$/.test(tok) && tok.startsWith("-")) continue;
        known.device.has(tok) ? mentioned.device.add(tok) : report(file, n, `\`${tok}\`: not a device id`);
      }
      if (/^bloom-[a-z-]+$/.test(tok)) known.look.has(tok) ? mentioned.look.add(tok) : report(file, n, `\`${tok}\`: not a look id`);
    }
    for (const [, tok] of text.matchAll(/\bbloom-[a-z]+(?:-[a-z]+)?\b/g)) if (known.look.has(tok)) mentioned.look.add(tok);

    // Tables whose first column names codes.
    const cell = text.match(/^\|\s*([^|]+?)\s*\|/)?.[1];
    if (cell && !/^-+$/.test(cell)) {
      const codes = [...cell.matchAll(/`([a-z][\w-]*)`/g)].map((m) => m[1]);
      const want = /^#+ The faults/.test(section) ? "fault" : /^#+ When polish/.test(section) ? "polish" : null;
      for (const c of want ? codes : []) if (!known[want].has(c)) report(file, n, `\`${c}\`: not a ${want} code`);
    }
    for (const [, id] of text.matchAll(/`([a-z]+-[a-z-]+)`/g)) {
      if (/claim|offer|to-action|names-a-store|url-or-email|promotional|all-caps|emoji-pile/.test(id) && !known.copyRule.has(id) && !known.fault.has(id))
        report(file, n, `\`${id}\`: not a copy rule`);
    }

    // Quoted CLI output in failure tables must still exist in the source.
    if (cell && /symptom/i.test(header)) {
      for (const [, quoted] of cell.matchAll(/`([^`]{12,})`/g)) {
        // Messages are templates, so only literal word runs are compared, three words at a time.
        for (const run of quoted.replace(/\b[NX]\b/g, "|").match(/[A-Za-z][A-Za-z' ]{2,}[A-Za-z]/g) ?? []) {
          const words = run.split(" ").filter(Boolean);
          if (words.length < 3) continue;
          const windows = words.slice(0, -2).map((_, i) => words.slice(i, i + 3).join(" "));
          if (!windows.some(sourceHas)) report(file, n, `quoted output not found in Vitrine source: "${run}"`);
        }
      }
    }
  }
}

function sourceHas(s) {
  corpus ??= ["src", "server", "web/src"].flatMap((d) => walk(join(home, d))).map((p) => readFileSync(p, "utf8")).join("\n");
  return corpus.includes(s);
}
function walk(dir) {
  try {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(m?js|ts)$/.test(f) ? [p] : [];
    });
  } catch {
    return [];
  }
}

const unmentioned = [...known.look].filter((l) => !mentioned.look.has(l));
if (unmentioned.length) problems.push(`looks the skill never names: ${unmentioned.join(", ")}`);

if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`\n${problems.length} drift ${problems.length === 1 ? "issue" : "issues"} against Vitrine ${help.version}`);
  process.exit(1);
}
console.log(`no drift against Vitrine ${help.version}`);
