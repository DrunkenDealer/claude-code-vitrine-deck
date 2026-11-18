#!/usr/bin/env node
// Renders each fixture's screenshots from HTML mock-ups, so no PNGs live in the repo.
//   VITRINE_HOME=/path/to/Vitrine node evals/fixtures/shots.mjs [fixture-dir…]
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(process.env.VITRINE_HOME ?? "", "package.json"))("playwright");

const phone = { width: 402, height: 874, scale: 3 }; // iPhone 6.3": 1206×2622
const android = { width: 360, height: 640, scale: 3 }; // 1080×1920

const page = (body, { dark = false, accent = "#1d6b52", status = "ios" } = {}) => `<!doctype html><html><head><style>
  * { box-sizing: border-box; margin: 0 }
  body { font: 15px -apple-system, "Helvetica Neue", Roboto, sans-serif; background: ${dark ? "#111418" : "#f6f7f9"};
         color: ${dark ? "#e8eaed" : "#1f2937"}; height: 100vh; overflow: hidden }
  .status { height: ${status === "ios" ? 54 : 24}px; display: flex; justify-content: space-between; align-items: center;
            padding: 0 ${status === "ios" ? 28 : 12}px; font-weight: 600; font-size: ${status === "ios" ? 16 : 12}px }
  h1 { font-size: 30px; padding: 8px 20px 14px } h2 { font-size: 13px; text-transform: uppercase; opacity: .55; padding: 14px 20px 6px }
  .card { background: ${dark ? "#1c2026" : "#fff"}; margin: 8px 16px; border-radius: 16px; padding: 14px 16px; display: flex;
          align-items: center; gap: 12px; box-shadow: 0 1px 2px #0001 }
  .dot { width: 34px; height: 34px; border-radius: 50%; background: ${accent}22; display: grid; place-items: center; font-size: 18px }
  .grow { flex: 1 } .sub { font-size: 12px; opacity: .6; margin-top: 2px } .accent { color: ${accent}; font-weight: 700 }
  .bars { display: flex; align-items: flex-end; gap: 6px; height: 160px; padding: 0 20px }
  .bars i { flex: 1; background: ${accent}; border-radius: 6px 6px 2px 2px; opacity: .85 }
  .tab { position: absolute; bottom: 0; left: 0; right: 0; height: 84px; background: ${dark ? "#1c2026" : "#fff"};
         display: flex; justify-content: space-around; padding-top: 12px; font-size: 11px; opacity: .9 }
  .center { height: 70vh; display: grid; place-items: center; text-align: center; padding: 40px }
</style></head><body><div class="status"><span>${status === "ios" ? "9:41" : "12:30"}</span><span>${status === "ios" ? "●●● ▮" : "▼ ▮"}</span></div>${body}</body></html>`;

const rows = (items) => items.map(([icon, title, sub, right]) =>
  `<div class="card"><div class="dot">${icon}</div><div class="grow"><b>${title}</b><div class="sub">${sub}</div></div><span class="accent">${right}</span></div>`).join("");
const bars = (hs) => `<div class="bars">${hs.map((h) => `<i style="height:${h}%"></i>`).join("")}</div>`;
const tabs = (labels) => `<div class="tab">${labels.map((l) => `<span>${l}</span>`).join("")}</div>`;

const habits = [["🧘", "Morning meditation", "10 min · daily", "🔥 42"], ["💧", "Drink 2L water", "8 glasses", "🔥 17"],
  ["📚", "Read 20 pages", "Atomic Habits · p. 212", "🔥 63"], ["🏃", "Run 5k", "Mon · Wed · Fri", "🔥 9"], ["🌙", "No screens after 22:00", "daily", "🔥 25"]];

const screens = {
  "habit-ios": {
    size: phone,
    shots: {
      "01-today": page(`<h1>Today</h1><h2>4 of 5 done</h2>${rows(habits)}${tabs(["Today", "Streaks", "Stats", "Settings"])}`),
      "02-streaks": page(`<h1>Streaks</h1><h2>Longest: Read 20 pages</h2><div class="card"><div class="grow"><b class="accent" style="font-size:44px">63 days</b><div class="sub">Personal best — 2 weeks ahead of last year</div></div></div>${bars([30, 45, 40, 60, 72, 68, 85, 90, 78, 95, 88, 100])}${tabs(["Today", "Streaks", "Stats", "Settings"])}`),
      "03-stats": page(`<h1>This month</h1>${bars([55, 70, 62, 80, 91, 76, 88])}<h2>Completion</h2>${rows([["✅", "87% of habits kept", "up from 64% in October", "+23%"], ["⏱", "Best time: 07:10", "you finish earlier on weekdays", ""]])}${tabs(["Today", "Streaks", "Stats", "Settings"])}`, { dark: true }),
      "04-settings": page(`<h1>Settings</h1>${rows([["🔔", "Reminders", "", "On"], ["☁️", "iCloud sync", "", "On"], ["🎨", "Appearance", "", "System"], ["ℹ️", "About", "Version 2.4.1", ""]])}${tabs(["Today", "Streaks", "Stats", "Settings"])}`),
    },
  },
  "budget-android": {
    size: android,
    shots: {
      "01-overview": page(`<h1>November</h1><div class="card"><div class="grow"><div class="sub">Left to spend</div><b class="accent" style="font-size:38px">€1,284</b></div></div>${bars([40, 52, 38, 66, 71, 58, 44])}${rows([["🛒", "Groceries", "€412 of €500", "82%"], ["🚇", "Transport", "€61 of €90", "68%"]])}`, { accent: "#3b5bdb", status: "android" }),
      "02-categories": page(`<h1>Categories</h1>${rows([["🛒", "Groceries", "18 transactions", "€412"], ["🏠", "Rent", "1 transaction", "€950"], ["🍽", "Eating out", "7 transactions", "€146"], ["🎬", "Subscriptions", "5 transactions", "€54"], ["🚇", "Transport", "22 transactions", "€61"]])}`, { accent: "#3b5bdb", status: "android" }),
      "03-goals": page(`<h1>Goals</h1>${rows([["✈️", "Lisbon trip", "€1,140 of €1,500", "76%"], ["🛟", "Emergency fund", "€4,800 of €6,000", "80%"], ["💻", "New laptop", "€620 of €1,800", "34%"]])}`, { accent: "#3b5bdb", status: "android", dark: true }),
      "04-split": page(`<h1>Split a bill</h1>${rows([["👩", "Anna", "owes you", "€23.50"], ["🧔", "Jonas", "owes you", "€23.50"], ["🧑", "You", "paid €70.50", ""]])}<div class="card"><b class="grow">Send reminders</b><span class="accent">2</span></div>`, { accent: "#3b5bdb", status: "android" }),
    },
  },
  "traps-kmp": {
    size: phone,
    shots: {
      "01-splash": page(`<div class="center"><div><div style="font-size:72px">🌿</div><b style="font-size:34px">Plantly</b></div></div>`, { accent: "#2f855a" }),
      "02-garden": page(`<h1>My garden</h1><div class="center" style="height:55vh"><div><div style="font-size:48px">🪴</div><b>No plants yet</b><div class="sub">Tap + to add your first plant</div></div></div>${tabs(["Garden", "Care", "Identify", "Profile"])}`, { accent: "#2f855a" }),
      "03-care": page(`<h1>Care today</h1><h2>3 plants need you</h2>${rows([["💧", "Water Monstera", "every 7 days · last 8 days ago", "Now"], ["🌤", "Move Fiddle leaf", "too little light this week", "Today"], ["🧪", "Feed Calathea", "monthly · due", "Today"], ["✂️", "Prune Pothos", "every 6 weeks", "Fri"]])}${tabs(["Garden", "Care", "Identify", "Profile"])}`, { accent: "#2f855a" }),
      "04-identify": page(`<h1>Identified</h1><div class="card" style="height:260px;background:linear-gradient(135deg,#2f855a55,#9ae6b455)"></div>${rows([["🌿", "Monstera deliciosa", "97% match · Swiss cheese plant", "Add"], ["☀️", "Bright, indirect light", "water when top 3 cm is dry", ""]])}${tabs(["Garden", "Care", "Identify", "Profile"])}`, { accent: "#2f855a" }),
    },
  },
};

const targets = process.argv.slice(2).length ? process.argv.slice(2).map((p) => basename(p)) : Object.keys(screens);
const browser = await chromium.launch();
for (const name of targets) {
  const { size, shots } = screens[name];
  const out = join(here, name, "screenshots");
  mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale });
  const tab = await ctx.newPage();
  for (const [file, html] of Object.entries(shots)) {
    await tab.setContent(html);
    await tab.screenshot({ path: join(out, `${file}.png`) });
  }
  await ctx.close();
  console.log(`${name}: ${Object.keys(shots).length} screenshots → ${out}`);
}
await browser.close();
