#!/usr/bin/env node
// Grades one scenario run: the deck the agent left, the commands it ran, what it reported.
//   VITRINE_HOME=… node evals/grade.mjs <scenario> <workdir> <transcript.jsonl> <xdg-config-dir>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const [scenario, work, transcriptPath, xdg] = process.argv.slice(2);
const cli = join(process.env.VITRINE_HOME, "src/index.js");
const SERVER = "https://vitrine.mashlab.app";

const events = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean).flatMap((l) => {
  try { return [JSON.parse(l)]; } catch { return []; }
});
const toolUses = events.filter((e) => e.type === "assistant").flatMap((e) => e.message.content.filter((c) => c.type === "tool_use"));
const bash = toolUses.filter((t) => t.name === "Bash").map((t) => t.input.command);
const finalText = events.findLast((e) => e.type === "result")?.result ?? "";
const allText = events.filter((e) => e.type === "assistant").flatMap((e) => e.message.content.filter((c) => c.type === "text").map((c) => c.text)).join("\n") + "\n" + finalText;

const decks = (function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return /^(node_modules|\.git|fastlane|screenshots|shots-out|out)$/.test(f) ? [] : walk(p);
    if (!f.endsWith(".json")) return [];
    try {
      const d = JSON.parse(readFileSync(p, "utf8"));
      return Array.isArray(d.screenshots) && Array.isArray(d.projectDevices) ? [{ p, d }] : [];
    } catch { return []; }
  });
})(work).sort((a, b) => b.d.screenshots.length - a.d.screenshots.length);
const pushed = decks.find(({ p }) => bash.some((c) => /\bpush\b/.test(c) && c.includes(basename(p))));
const { p: deckPath, d: deck } = pushed ?? decks[0] ?? {};

const results = [];
const expect = (ok, what, required = true) => results.push({ ok: Boolean(ok), what, required });
const run = (...args) => {
  try { return { code: 0, out: execFileSync("node", [cli, ...args], { encoding: "utf8", stdio: "pipe" }) }; }
  catch (e) { return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") }; }
};

expect(toolUses.some((t) => t.name === "Skill" && /vitrine-deck/.test(JSON.stringify(t.input))), "the vitrine-deck skill fired");
expect(deck, `a deck file was written${deckPath ? ` (${basename(deckPath)})` : ""}`);
if (!deck) report();

const selected = deck.screenshots.filter((s) => s.selected);
const texts = selected.flatMap((s) => s.layers.filter((l) => l.type === "text"));
const headlines = selected.flatMap((s) => s.layers.filter((l) => l.role === "headline"));
const locales = deck.defaults?.locales ?? ["en-US"];
const devices = new Set(deck.projectDevices);
const fgSlide = (kind) => selected.some((s) => s.kind === kind);
const englishOnly = locales.length === 1 && locales[0].startsWith("en") && selected.every((s) => !Object.keys(s.layersByLocale ?? {}).length);

expect(run("validate", "--deck", deckPath).code === 0, "validate: valid");
const loose = run("check", "--deck", deckPath, "--json");
const strict = run("check", "--deck", deckPath, "--strict", "--json");
const codes = (out) => {
  try {
    const d = JSON.parse(out);
    return [...new Set([...(d.cells ?? []).flatMap((c) => c.faults.map((f) => f.code)), ...(d.store?.faults ?? []).map((f) => f.code), ...(d.copy?.faults ?? []).map((f) => f.code)])];
  } catch { return [out.slice(0, 160)]; }
};
expect(loose.code === 0, `check: nothing blocking${loose.code ? ` — ${codes(loose.out).join(", ")}` : ""}`);
// The skill may ship past a warning if it says which and why.
const warned = strict.code ? codes(strict.out) : [];
const explained = { "big-gap": /gap|empty space|space/i, featuring: /featur/i, "required-slot": /required|slot/i, "contrast-unverified": /contrast/i, "store-copy": /promotional|wording|copy/i };
expect(warned.every((c) => (explained[c] ?? new RegExp(c)).test(finalText)), `check --strict clean, or each warning named in the report${warned.length ? ` (${warned.join(", ")})` : ""}`);
expect(!JSON.stringify(deck).includes("Your value prop here"), "no init placeholder copy left");
expect(headlines.length === selected.length, "every selected slide has a headline");
expect(headlines.every((h) => h.text.trim().split(/\s+/).length <= 7), "headlines are 7 words or fewer", false);
const shotHeads = selected.filter((s) => s.kind !== "feature-graphic").map((s) => s.layers.find((l) => l.role === "headline")?.text);
expect(new Set(shotHeads).size === shotHeads.length, "no two screenshot headlines identical");
expect(selected.filter((s) => s.kind !== "feature-graphic").every((s) => !/\b(settings|screen|page)\b/i.test(s.layers.find((l) => l.role === "headline")?.text ?? "")), "headlines say what the user gets, not what the screen is", false);
expect(!Object.values(deck.defaults?.deviceTransform ?? {}).some((v) => typeof v === "number" && v !== 0) && !/tilt/.test(deck.defaults?.deviceTransform ?? ""), "no default device tilt", false);

const pushCmds = bash.flatMap((c) => c.match(/(?:index\.js|\bvitrine)\s+push\b[^\n;&|]*/g) ?? []);
expect(pushCmds.length, "pushed the deck");
expect(pushCmds.length && pushCmds.every((c) => c.includes(`--server ${SERVER}`) || c.includes(`--server=${SERVER}`)), `every push names --server ${SERVER}`);
const sessions = join(xdg, "vitrine", "sessions.json");
expect(existsSync(sessions) && JSON.stringify(JSON.parse(readFileSync(sessions, "utf8")).servers ?? {}).includes("vitrine.mashlab.app"), "a mashlab project was saved (sessions.json)");
expect(/https:\/\/vitrine\.mashlab\.app\/\S+/.test(finalText), "the final report carries the mashlab link");
expect(/24\s?h|24 hours|sign in/i.test(finalText), "the report says the anonymous deck expires unless they sign in");
expect(bash.some((c) => /\bcheck\b.*--strict|--strict.*\bcheck\b/.test(c)), "ran check --strict before shipping");
expect(!/AskUserQuestion/.test(toolUses.map((t) => t.name).join()), "did not stop to ask (the prompt said go ahead)", false);

const scenarios = {
  "habit-ios": () => {
    expect(devices.has("iphone-6.3"), "iphone-6.3 row");
    expect(![...devices].some((d) => /^(android|ipad|play)/.test(d)), "no Android, iPad or Play rows — the repo is iPhone-only");
    expect(englishOnly, "English only");
    expect(!selected.some((s) => /settings/.test(s.sourceKey ?? "")) || /settings/i.test(allText), "the settings screen is dropped, or its weakness named", false);
    expect(/header|search results|6\.9/i.test(allText), "the extras are named as available, not added", false);
  },
  "budget-android": () => {
    for (const d of ["android-phone", "android-tablet-7", "android-tablet-10", "play-feature-graphic"]) expect(devices.has(d), `${d} row`);
    expect(![...devices].some((d) => /^(iphone|ipad|app-store)/.test(d)), "no Apple rows — the repo is Android-only");
    expect(fgSlide("feature-graphic"), "a selected feature-graphic slide (the row alone passes check)");
    expect(englishOnly, "English only — no translations built");
    expect(/(german|de-DE)[^\n]*translat|translat[^\n]*(german|de-DE)/i.test(finalText), "the report points German at Vitrine's translation");
  },
  "traps-kmp": () => {
    for (const d of ["iphone-6.3", "android-phone", "play-feature-graphic"]) expect(devices.has(d), `${d} row`);
    expect(fgSlide("feature-graphic"), "a selected feature-graphic slide");
    expect(selected.find((s) => s.kind === "phone")?.sourceKey && !/splash/.test(selected.find((s) => s.kind === "phone").sourceKey), "the splash screen is not slide 1");
    expect(/splash|launch screen|2\.3\.3/i.test(allText), "the splash screen is called out");
    expect(/empty|no plants|lived-in|re-?capture/i.test(allText), "the empty garden is raised as a re-capture");
    expect(englishOnly, "English only — no translations built");
    expect(/japanese|\bja\b/i.test(finalText), "the report names the other languages the repo ships", false);
  },
};
scenarios[scenario]?.();
report();

function report() {
  for (const r of results) console.log(`${r.ok ? "✓" : r.required ? "✗" : "~"} ${r.what}`);
  const req = results.filter((r) => r.required);
  const passed = req.filter((r) => r.ok).length;
  console.log(`\n${scenario}: ${passed}/${req.length} required · ${results.filter((r) => !r.required && r.ok).length}/${results.filter((r) => !r.required).length} soft`);
  process.exit(passed === req.length ? 0 : 1);
}
