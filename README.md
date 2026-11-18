# Vitrine Deck: App Store and Google Play screenshots, art-directed by Claude Code

**Vitrine Deck is a Claude Code plugin that turns your app's screenshots into a store listing.** It reads your
repo and your real screenshots, or builds the app and captures them itself, then decides the look, layout and
copy, grades every cell against a layout, contrast and store-policy scorer, and publishes the deck to
[Vitrine](https://vitrine.mashlab.app) as a link you keep editing, translate and download in every size.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)

For app owners who aren't designers. Nothing is taken on trust: text off the canvas, a headline over the
device, type too small for a store thumbnail, words that can't be read off their ground, a canvas or claim
the store refuses — each is measured, and a deck that doesn't pass doesn't ship.

## Install

```
/plugin marketplace add DrunkenDealer/claude-plugins
/plugin install vitrine-deck@mashlab
```

[`mashlab`](https://github.com/DrunkenDealer/claude-plugins) is the catalog of all Mash Lab plugins, QA Cycle included.

Then open your app's repo and ask **"Make the store screenshots for this app"** (or `/vitrine-deck:vitrine-deck`,
optionally with a screenshots folder).

## What a run does

1. **Reads the repo** — name, value prop, brand colours, store keywords, shipped languages, which devices and
   stores the project targets. It asks only what the repo can't answer.
2. **Gets screenshots** — from your folder, or by building the app on a headless simulator or emulator with
   staged, lived-in demo data.
3. **Looks at every screenshot** — content, dead space, light or dark chrome — and flags an unused-looking app,
   a baked-in frame, the wrong platform or a splash screen before designing around it.
4. **Proposes one plan** — slides, devices, look, extras on offer — in a single question round.
5. **Builds and grades the deck** with the `vitrine` CLI, repairing what the scorer flags.
6. **Publishes** to vitrine.mashlab.app and ends with the link to open.

The deck is English; Vitrine's editor translates it once it's pushed. More in
[the write-up](https://mashlab.app/blog/claude-code-vitrine-deck/).

## Requirements

- Claude Code, Node.js 24+, and the `vitrine` CLI, which ships in this repo's [`cli/`](cli). The skill offers to
  install it on first run, or install it yourself:

  ```sh
  npm install -g github:DrunkenDealer/claude-code-vitrine-deck
  npm explore -g vitrine -- npx playwright install chromium
  ```
- For capture: Xcode with `xcrun simctl` for iOS rows, an Android SDK emulator for Android rows.
- Publishing makes an anonymous deck that's deleted within 24 h unless you sign in and keep it. Your first
  project is free.

## The CLI on its own

`vitrine` works without Claude Code too: `vitrine init --screenshots <dir>`, `check`, `render`, and
`push --server https://vitrine.mashlab.app` to open the deck in the editor. `vitrine --help` lists every command.

## Development

```sh
VITRINE_HOME=/path/to/Vitrine node evals/drift.mjs   # every command, flag and id the skill names vs the live CLI
VITRINE_HOME=/path/to/Vitrine evals/run.sh            # headless end-to-end runs on the fixture apps, graded
claude plugin eval plugin --no-publish --trust-plugin # trigger evals in plugin/skills/vitrine-deck/evals/
VITRINE_HOME=/path/to/Vitrine node scripts/sync-cli.mjs # refresh cli/ and package.json from Vitrine
```

The plugin itself is `plugin/` (Markdown, JSON and images only); the eval runner, grader and fixture apps live
in `evals/`. `cli/` is generated from the Vitrine app's source by `scripts/sync-cli.mjs`; don't edit it here. See [CHANGELOG.md](CHANGELOG.md).

## License

The plugin, evals and scripts: [MIT](LICENSE) © Max Shwed. The `vitrine` CLI in `cli/` has its own
[license](cli/LICENSE): free to install and use, including commercially, but not to copy, modify, redistribute or
build a competing product from.
