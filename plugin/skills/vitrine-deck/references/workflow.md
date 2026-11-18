# The loop, and what to do when it doesn't close

`vitrine` below is the CLI: the linked bin, or `node <checkout>/src/index.js` with the absolute path
written out (SKILL.md step 0). `--server https://vitrine.mashlab.app` goes on every `push`.

## The commands

```bash
vitrine capabilities                                  # the menu — devices, kinds, looks, presets, fonts, faults
vitrine init --screenshots shots --out deck.json \
  --device iphone-6.3,android-phone --look bloom-indigo
vitrine apply  --deck deck.json --layout caption-top --slide today --write
vitrine apply  --deck deck.json --look bloom-emerald --write
vitrine validate --deck deck.json                     # no browser; every name the build can't draw
vitrine check  --deck deck.json [--json] [--strict]   # grade every cell
vitrine polish --deck deck.json --write               # repair geometry
vitrine render --deck deck.json --out shots-out --json
vitrine push   --deck deck.json --server https://vitrine.mashlab.app --json
vitrine session --server https://vitrine.mashlab.app [--clear]
vitrine search fonts|icons|emoji|stickers <query> --json
vitrine font "Inter"
```

Flags per command:

| Flag | On |
|---|---|
| `--device <ids>` | check, polish, render — narrows to a subset |
| `--fast` | check, polish, apply, init — glyph estimator instead of Chromium |
| `--assets <dir>` | validate, check, render, push — where `sourceKey`s resolve (default: the deck's folder) |
| `--write` / `--out <path>` | polish, apply — without either, `apply` is a dry run |
| `--json` | every command — prefer it whenever you parse output |

**Exit codes:** 0 ok · 1 the answer is no (`check` not clean, `validate` invalid) · 2 couldn't run
(usage, bad input, a deck `validate` refuses, two slides writing one file) · 3 network or server.
Exit 2 means the deck can't even be graded — `polish` won't help; read the error.

## The loop

```
init → apply / edit → validate → check → (fails?) polish --write → check → (still fails?) read the fault → act
                                                    ↓ clean
                                   look at the 300px strip → fix → check
                                                    ↓ clean
                                          check --strict → push
```

The skill builds English only; the developer translates in Vitrine's editor after the push.

## Reading `check`

Text output is one block per cell that isn't clean, then a store and copy section:

```
  iPhone 6.3/01_01-today.png — penalty 136
      a layer off the canvas [device] (fraction=0.054)
  store
    ?? ineligible for store featuring [android-phone]: Play wants 4+ screenshots to be eligible for featuring
  copy — the patterns are English — …
    !! ranking-claim [01-today/headline · en-US]: a ranking or superlative claim — … — “The #1 habit app”
8 cells, worst penalty 136, 2 blocking, 1 to review
```

- **Gate on the exit code, or `clean` in `--json`.** `!!` lines block; `??` and "— to review" lines are
  warnings that fail only under `--strict`.
- **Penalty is a penalty, not a score:** 0 is clean, larger is worse. `worst penalty` is omitted at 0,
  so a contrast-only failure reads `8 cells, 3 blocking`.
- **Zero cells fails:** `failed: nothing to check`, exit 1. A slide needs `selected: true` and a `kind`
  some `projectDevices` row draws.
- `--json` gives `{cells[{name, slideId, deviceId, locale, penalty, estimated, faults[{code, severity, hint}]}],
  store{checked, faults[]}, copy{faults[], language, note}, clean, estimated, note}`. Match on
  `faults[].code` — text output prints labels, not codes. `note` says why a run is weaker than usual.
- Cells are named by the export template: `<device label>/<NN>_<slide>.png`.

**`check --strict` is the last gate before `push`:** every warning blocks and every penalty must be 0.
If you ship past a warning, say which and why.

## The faults

`capabilities.faults` is the live table — code, severity, hint for every layout, contrast, store and
copy fault. Read it rather than a copy. What the table can't tell you:

| Fault | What to do |
|---|---|
| `off-canvas` on the device | the rendered frame and shadow run past `hRatio`. If polish declines, take `fraction × hRatio` off `hRatio` and re-check |
| `overlap` after a real repair | too many words — **shorten the headline**. Polish already searched position, device height and both sizes |
| `small-text` | type under the thumbnail floor (17px headline, 12px other, at a 300px-wide thumbnail; 650px-tall for landscape). **Cut the copy**; raising `sizeMul` back re-creates the overlap polish was clearing |
| `low-contrast` | polish never touches colour. Change the ink, move the caption off the bright part of the ground, or add a `highlight` pill **and set `color` on that layer** — the pill's `color` is the fill, so inherited white ink on a white pill is 1:1. The floor is 4.5:1, 3:1 only for text large on the thumbnail, and layer `opacity` counts (subtitles default to 0.78) |
| `contrast-unverified` | an image or CSS ground — nothing was measured. Dim the ground or add a text shadow, then judge the strip by eye |
| `big-gap`, `featuring`, `required-slot`, `no-feature-graphic` | warnings: decide, then say what you decided |
| `no-frame` | a broken device id or install, not a design problem |

Two holes no gate covers:

- **`no-feature-graphic` only checks the row.** A `play-feature-graphic` row with no selected
  `feature-graphic` slide passes silently.
- **A retired device id is remapped silently** — `validate` says valid and `check` grades the
  replacement. Compare `projectDevices` with `capabilities.devices[].id`.

## When polish doesn't close it

`polish --json` lists `changes[]`; only `layout` changes an English deck. The rest are
verdicts, and each means **stop looping**:

| Change kind | Text output | Do |
|---|---|---|
| `no-better` | `penalty N, and nothing polish tried scored better — fix it by hand` | a small amount of a severe fault sits under polish's edit-cost margin. Fix the geometry in the deck |
| `copy-too-long` | the only fix left was type under the store floor | shorten the longest string on that slide |

"nothing to repair" means nothing is faulting.

## Measurement, and why `--fast` is a caveat

`check`, `polish`, `apply` and `init --look` measure the real font faces in Chromium. The estimator is
good to ~5% on a glyph advance, but line breaking is discrete: 5% moves a word to the next line, and a
six-line headline predicted as four is out by a third of its height. Use `--fast` only without
Chromium, and say so — a clean cell there is a weaker claim.

`check` registers only fonts already cached and falls back to the estimator otherwise (the JSON
`note` names the family). Cache a `gf:` font with `vitrine font` before grading; `render` and `push`
fetch fonts and icon/emoji stickers themselves.

## `push`, and what the link is

`push` validates, uploads, saves the deck and prints a link. `--json` gives
`{projectId, reused, replaced, session, url, claimed, expiresAt}` — check `url` names
`vitrine.mashlab.app` and `claimed` is true before you report it.

What leaves the machine: every image the deck references — **selected or not**, including per-device
overrides — all copy, and the project name (the deck file's name, or
`--name`). Drop slides you aren't using before you push.

**One project per session per server.** `push` keeps a cookie and the project id in
`~/.config/vitrine/sessions.json`; every later push overwrites that project (the previous deck goes to
its History) and `--name` renames it. A deck for **a different app** must start with
`vitrine session --server https://vitrine.mashlab.app --clear`, or it replaces the first app's deck.

**The link:**

- Opens a confirm page; nothing happens until they press Add or Replace.
- Signed in → the deck lands in their projects as **temporary**, deleted 24 h after the claim unless
  they press Keep (priced like a new project; the first one is free). Re-pushing updates the same copy
  without moving its deadline.
- Signed out → the deck is copied into that browser's own anonymous projects and is just as temporary;
  signing in carries it over with its deadline, and Keep then saves it.
- One use, ~15 minutes, and a server restart kills it early. Re-push to mint a new one.
- It's a bearer link: whoever confirms it gets the copy.

## Failure modes

| Symptom | Cause |
|---|---|
| `error: the deck names what this build cannot draw (vitrine validate):` + list, exit 2 | a font, sticker, device or source that doesn't exist — fix each line |
| `screenshots[0].sourceKey: screenshot not found under <root>: …` | a `sourceKey` with no file under `--assets` |
| `projectDevices: unknown device "…"` / `Unknown device "…"` | an id not in `capabilities.devices` (deck / `--device` flag) |
| `init` refuses the screenshots folder | it must sit inside the deck's folder |
| `nothing is listening at http://localhost:3001` | `--server` was left off — push to `https://vitrine.mashlab.app` |
| `refusing to send the session cookie over plain http` | a non-localhost `http://` server — use https |
| `the deck is X as JSON and the server saves at most 1.00 MiB` | drop unused slides |
| `saved N slides` then `POST /api/claim → 404: not found` | the server predates the claim route; the deck is saved, only the link failed — report it, don't call it done |
| `→ 404: no such project` | the remembered project is gone — `session --clear`, re-push |
| `POST /api/projects → 402` | the instance charges for a second anonymous project — `session --clear`, or sign in |
| a slide missing in the editor after `push` | its file never uploaded; the editor drops a slide whose source isn't on the server |
| every push makes a new project, with a warning | Node < 24 can't save the session — upgrade Node |
| `check` clean, render obviously wrong | `--fast`, or a font that wasn't cached |

## A worked run

A habit tracker, four screens, iPhone and Android:

```bash
vitrine init --screenshots shots --out deck.json --device iphone-6.3,android-phone \
  --look bloom-emerald
# replace every placeholder headline and subtitle — "Your value prop here" grades clean
vitrine validate --deck deck.json
vitrine check  --deck deck.json
#   8 cells, worst penalty 136, 2 blocking — the device 5% off the bottom on Android
vitrine polish --deck deck.json --write
#   today · android-phone: penalty 56, and nothing polish tried scored better — fix it by hand
#   → take 0.04 off that slide's device hRatio
vitrine check  --deck deck.json --strict
#   8 cells, all clean
vitrine push   --deck deck.json --server https://vitrine.mashlab.app --json
```

That declined cell is the normal case. Expect to finish the last fault yourself.
