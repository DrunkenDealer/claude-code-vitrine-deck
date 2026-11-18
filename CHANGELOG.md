# Changelog

## 1.0.1 — 2026-11-18

- `vitrine push` and `vitrine session` default to vitrine.mashlab.app, so the CLI on its own needs no `--server`.
  Set `VITRINE_SERVER` to push somewhere else.
- The skill pre-approves only Read, Glob and Grep; Write, Bash and questions ask as usual. The plugin has an icon,
  and its trigger evals moved to `plugin/evals/`.

## 1.0.0 — 2026-11-18

- First public release, installed as `vitrine-deck@mashlab` from the `mashlab` catalog in
  [claude-plugins](https://github.com/DrunkenDealer/claude-plugins).
- The `vitrine` CLI ships in this repo's `cli/` and installs straight from GitHub
  (`npm install -g github:DrunkenDealer/claude-code-vitrine-deck`), with Chromium installed by the CLI's own Playwright
  through `npm explore`.
- The report ends with the deck link alone under **Open your deck**, so it's the one URL in the message and easy to copy.
