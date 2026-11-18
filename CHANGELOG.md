# Changelog

## 2.1.1 — 2026-11-18

- The CLI installs straight from GitHub (`npm install -g github:DrunkenDealer/Vitrine`), with Chromium installed by the
  CLI's own Playwright through `npm explore`. A Vitrine checkout is no longer needed.
- Install from the `mashlab` catalog in [claude-plugins](https://github.com/DrunkenDealer/claude-plugins).

## 2.1.0 — 2026-11-18

- First release as a Claude Code plugin, installed as `vitrine-deck@mashlab`. The skill was developed in a private
  config repo up to this version.
- The report ends with the deck link alone under **Open your deck**, so it's the one URL in the message and easy to copy.
