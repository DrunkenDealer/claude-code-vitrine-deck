---
name: vitrine-deck
description: Art-directs and builds App Store / Play Store screenshots end to end — reads the app's repo and its real screenshots (or captures them from a headless simulator or emulator with staged demo data), picks the look, layout, copy and accents, grades every cell against a layout, contrast and store-policy scorer, repairs what it can, and publishes the English deck to Vitrine (vitrine.mashlab.app) as a link you can keep editing and translate in the app. Triggers on "make store screenshots", "design my app store screenshots", "vitrine deck", "screenshots for the App Store", "Play Store screenshots", "feature graphic".
user-invocable: true
argument-hint: "[screenshots-dir]"
allowed-tools: Read, Write, Glob, Grep, Bash, AskUserQuestion
metadata:
  version: 2.1.1
---

# Vitrine Deck

For someone who owns an app and is not a designer. They have screenshots and know what the app does; they cannot make those screenshots look like a store listing. This decides the design, proves it holds, and publishes it.

**Nothing here is taken on trust.** Every cell is measured — text off the canvas, a headline over the device, type too small to read on a store thumbnail, words that can't be read off their background, a canvas or a claim the store refuses — and a deck that doesn't pass doesn't ship. You are allowed to have taste. You are not allowed to guess whether it fits.

**The deliverable is a link to the deck on [vitrine.mashlab.app](https://vitrine.mashlab.app)**, where the developer can drag a headline, swap a ground and download every size. Render PNGs locally too when they ask.

## Inputs

| Input | Where it comes from |
|---|---|
| Source screenshots | `$ARGUMENTS`, else the repo (step 1), else captured from the running app (step 2), else ask for a path |
| What the app does, who it's for, which stores and devices | the repo (step 1); ask only what it can't answer (step 4) |
| Slide order and copy | yours to decide. If the developer hands you some, start from it and say what you changed |

## 0. Set up the CLI

The `vitrine` CLI ships in this plugin's repo, [claude-code-vitrine-deck](https://github.com/DrunkenDealer/claude-code-vitrine-deck), and needs Node ≥ 24 and Playwright's Chromium.

```bash
command -v vitrine || echo "not installed"; node -v
```

If it isn't installed, offer the one-time install straight from GitHub:

```bash
npm install -g github:DrunkenDealer/claude-code-vitrine-deck
npm explore -g vitrine -- npx playwright install chromium
```

Run Playwright through `npm explore`, never a bare `npx playwright`: that fetches the latest Playwright, whose Chromium the CLI's pinned version can't launch.

A developer with a checkout (`$VITRINE_HOME`, `~/WebstormProjects/Vitrine`, `~/Projects/Vitrine`, `~/vitrine`) and no global install can use it instead: `npm install && npx playwright install chromium && npm link` in it, or every command as `node /absolute/path/to/Vitrine/src/index.js …` — shell variables and functions don't survive between Bash calls, so spell the path out each time. Below, `vitrine` means whichever you have.

Node < 24 is not a soft warning: the session file can't be saved and every push starts a new project. If Chromium won't launch, grade with `--fast` and say so in the report.

## 1. Read the repo

Re-asking for something the repo already answers is the most irritating thing this skill can do.

| Need | Read from |
|---|---|
| App name, description, category, value prop | `README.md`, `fastlane/metadata/`, `build.gradle(.kts)`, `Info.plist`, `package.json` |
| Store keywords to echo | `fastlane/metadata/**/keywords.txt`, `fastlane/metadata/android/*/short_description.txt` |
| Brand colours | `Theme.kt`, `Color.kt`, `colors.xml`, `Colors.swift`, `Assets.xcassets`, `tailwind.config.*`, `theme.ts` |
| Other languages it ships (named in the report, not built) | `fastlane/metadata/*/` folders, `values-*/strings.xml`, `*.lproj`, `Localizable.xcstrings` |
| Source screenshots | `$ARGUMENTS`, then `screenshots/`, `fastlane/screenshots/`, `docs/screenshots/` |
| The flow worth showing — entry → key action → result | routes, nav graph, screen and step components, state holders, the README's usage section |
| Sample data | Compose `@Preview`, SwiftUI `#Preview`, test fixtures, fake repositories, seed or demo scripts |

**Targets — infer, then map to device rows.** Read the live ids from `vitrine capabilities` (`devices[]`, `kinds[]`, `stores`) — never from this file; an id that isn't there renders nothing.

| Evidence | Rows |
|---|---|
| an Xcode project | `iphone-6.3` — the iPhone slot App Store Connect won't submit without |
| `TARGETED_DEVICE_FAMILY` contains `2`, or `UIDeviceFamily` has iPad | `ipad-13` |
| an Android app module | `android-phone`. `play-feature-graphic` is a plan question, not a default: Play requires one, but a live listing already has it |
| `sw600dp`/`sw720dp` resources, or tablet layouts | `android-tablet-7` **and** `android-tablet-10` — the Console wants both |
| landscape in `UISupportedInterfaceOrientations` / `screenOrientation` | the `-landscape` rows, as an option |
| `android.software.leanback` | `tv` |

Everything else in `capabilities.devices` that the evidence didn't pick is an **extra**: iPhone 6.9"/6.5", iPhone Duo, iPad 11", landscape rows, and the App Store **product page header** (`app-store-header`) and **search results asset** (`app-store-search`). Extras are offered in step 4, never silently added — each row multiplies render time and gives you more to get wrong.

## 2. No screenshots? Capture them

Asking a developer to go and take screenshots is where most of them stop. If step 1 found none, build the app, run it on a headless simulator or emulator, stage every screen with lived-in demo data, and capture it yourself — `references/capture.md` has the shot list, the per-stack builds, the staging and the cleanup. iOS rows need a working `xcrun simctl`; without one, fill the Android rows and name the iOS rows as skipped. Ask for PNGs only when nothing can be built or reached, and say which thing was missing.

## 3. Look at the screenshots

**Read every source screenshot with the Read tool and actually look at it.** This decides most of what follows.

Per shot, note:

- **What it shows** — list, chart, map, onboarding, settings, empty state. Names the slide's role.
- **Light or dark chrome**, its dominant and accent colours.
- **Where the dead space is.** An empty top third can carry a headline over it; a dense list can't.
- **Whether it's a Dark Mode capture.** Apple asks for one dark slide; if the app has a dark theme and the set has none, ask for one.
- **Whether it's worth a slide at all.** A settings screen usually isn't. Say so.

Then the order. **Search shows the first three and nothing else**, so each of slides 1-3 is a complete pitch on its own: the strongest outcome, then the most convincing screen, then what competitors can't say. `references/design-rules.md` has the arc.

**Then vet the pixels** — `check` grades the deck you build, not the material you fed it:

1. **The app looks unused.** An empty list, a two-point chart, habits called "Test 1". No headline survives a fresh install. If you captured it, re-stage it. If the developer handed it to you, **raise this first** — it needs a re-capture from a lived-in account, the longest lead time here.
2. **A device frame already baked in.** Crop the screen back out and let Vitrine frame it.
3. **Captured on the other platform.** Android hardware in an App Store listing reads as a neglected port.
4. **The wrong OS language or market data** — a non-English keyboard, dialog, currency or date format is baked into pixels the English listing can't hide.
5. **A splash, login or title screen** — Apple rejects it outright (2.3.3).

`references/sources.md` has the detection probes, the crop recipe and what to ask for. Never silently ship 1, 3 or 4.

## 4. Propose the plan — one stop

Show the plan with every default filled in and the reason for each, list what's available but not included, and ask any question the repo couldn't answer — **one `AskUserQuestion` round, at most three questions**, each with a recommended default. Ask the feature graphic as its own option — "build one" recommended only for an app not yet on Play — never folded into a "required rows" bundle:

```
Plan: 6 slides · iPhone 6.3" + iPad 13" (Info.plist: iPad) + Android phone (app/build.gradle.kts)
      + Play feature graphic? (not on Play yet — build one) · look bloom-emerald (your accent #1d6b52) · English
Also available, not included: App Store product page header · App Store search results asset ·
      iPhone 6.9" · landscape · stickers/emoji accents · German (in your repo — translate it in Vitrine)
Re-capture first: slide 2 shows an empty list
Publishes to vitrine.mashlab.app as a link you can keep editing.
```

**Updating an earlier deck?** Run `vitrine session --server https://vitrine.mashlab.app --json` before offering it. Offer "update" only when `held` is true and `project` names that app's deck; otherwise say the earlier project can't be reached from this machine and the push will make a new one. Push with `--name` set to that project's name.

Build the "also available" line from `capabilities` at run time, so a row Vitrine adds shows up here the same day. Publishing is the deliverable, so state it — don't ask for it. If the developer has already said "just do it", or named the devices, skip the stop and print the plan anyway.

**English only.** The deck is `en-US`. If the repo ships other languages, name them in the report: Vitrine's editor translates the deck once it's pushed.

## 5. Decide

Read the menu — never from memory:

```bash
vitrine capabilities > /tmp/vitrine-caps.json
```

A good deck is three dials — **ground**, **frame**, **accent** — one family each, varied per slide so no two neighbours match and the set still reads as one deck. `references/decoration.md` has the per-slide budget.

1. **A look** from `capabilities.looks` — ground, graded ink, font, type style, frame tint and layout in one, chosen against the screenshots' colours. Then drift one ground parameter slide to slide; a look nobody adjusted reads like every other deck that took it.
2. **A layout preset per slide** from `capabilities.layoutPresets`, chosen by where the dead space in that screenshot is. Never two neighbours identical in both ground and layout.
3. **Copy.** Headline 3-6 words, benefit-led — what the user *gets*, not what the screen *is*. Subtitle 6-12 words, optional. Echo store keywords where they read naturally. One idea per slide, two lines at most, and never a price, offer, call to action or the other store's name. A real award, press quote or rating only on App Store rows — Play rejects them.
4. **Accents only where one points at something** — one keyword coloured in the headline (`{word}` + `accent`, the lighter and more common emphasis), a `highlight` pill on the one claim the listing rests on, a `lens` pulling out a detail the device can't show; at most one per slide, and none is fine. **Stickers, emoji, icons and objects are opt-in:** offer them in the plan, add them only when the developer asks. Nothing ever covers the device's content — **the scorer doesn't catch that.**

`references/design-rules.md` owns type sizes, contrast and what makes slide 1 fail.

## 6. Build the deck

Start from `init`, not a hand-written file — it writes a valid deck with one selected slide per screenshot and the editor's own layers:

```bash
vitrine init --screenshots shots --out deck.json --device iphone-6.3,ipad-13,android-phone,play-feature-graphic \
  --look bloom-emerald
vitrine apply --deck deck.json --layout caption-top --slide 02-streaks --write
vitrine validate --deck deck.json
```

- The screenshots folder must sit inside the deck's folder; `sourceKey`s resolve there.
- **`init`'s placeholder copy ("Your value prop here") grades clean.** Replace every headline and subtitle — **before** `apply --layout`: a layout solves the text column for the copy that's there, so placeholder-sized columns faulted 14 cells once the real copy went in. Changed copy later? Re-run `apply --layout` on that slide.
- **Edit `deck.json` in place.** A script that rebuilds it from `init`'s output each run silently throws away `apply` and `polish` and any hand placement.
- Banner rows (feature graphic, page header, search result) need their own slide of that `kind` — `init` writes only the screenshot kind. Generate it separately and append its slide to `deck.json`'s `screenshots`, then `validate`:
  `vitrine init --kind feature-graphic --icon icon.png [--art art.png] --out fg.json --look bloom-emerald` (`page-header`, `search-result` likewise, without `--icon`/`--art`). Always apply a look — the bare ground fails contrast under `fg-art-right`.
- **The feature graphic is a brand lockup, not copy on a ground:** the app icon (the largest PNG in `mipmap-xxxhdpi/ic_launcher*` or `Assets.xcassets/AppIcon.appiconset`; copy it beside the deck — paths must be inside its folder), the app name as headline, a tagline of at most 5 words, no device. Layouts: `fg-icon-left` (default), `fg-centered` (mark over name — use it when the listing has a promo video, since Play's play button covers the centre), `fg-art-right` (with `--art` key art, when the repo has illustration). Switch with `vitrine apply --deck fg.json --layout fg-centered --write`. `check` warns `fg-device`, `fg-no-text`, `fg-dull-ground` (near-white/black/grey — Google asks for vibrant colour).
- A role-carrying layer leaves inherited fields `null` so the look reaches it.
- Run `validate` after every hand edit — it's instant and catches a typo before Chromium launches.

`references/deck-schema.md` has the v4 shape, overrides and inheritance — follow it exactly; a field in the wrong place is silently ignored.

## 7. Grade — not optional

```bash
vitrine check  --deck deck.json            # exit 1 = something is measurably wrong
vitrine polish --deck deck.json --write    # repair what can be repaired
vitrine check  --deck deck.json
```

`check` measures real font faces in Chromium and grades layout, contrast, type size at store-thumbnail scale, the store's canvas and slot rules, and the copy policy. Gate on the exit code. `references/workflow.md` has the output format, the fault table and the failure modes; the decisions that matter:

- **Polish declined** (`no-better`, `copy-too-long`, `base-hurts`) — stop looping. Fix the geometry yourself, or cut the copy.
- **`small-text` or `overlap` that survives a repair** — the copy is too long. Shorten it; never raise the size back.
- **`low-contrast`** — polish never touches colour. Change the ink, move the text, or add a pill with its own `color`.

- **`orphan`** (a warning) — a caption wrapped onto one last word. Reword or cut a few characters; never shrink the type to pull it up.

Two things no gate covers: a `play-feature-graphic` row with no selected `feature-graphic` slide, and a retired device id that was silently remapped — compare `projectDevices` with `capabilities.devices[].id`.

**Then render and look at it** — `check` can't see a duplicated element, an accent that missed, or a card that reads as a bug. Tile the slides into a strip at **300px wide per slide — the width a shopper meets the listing at** — and judge it against the questions at the end of `references/design-rules.md`:

```bash
vitrine render --deck deck.json --out shots-out --json   # files[] feeds the tiler; sharp recipe in sources.md
```

Re-render after every fix, and re-run `check`.

## 8. Publish

```bash
vitrine push --deck deck.json --server https://vitrine.mashlab.app --json
```

**Always `https://vitrine.mashlab.app`.** The CLI's built-in default is localhost; a localhost link opens on no other machine. Check `url` names the public host and `claimed` is true before you report it.

- **Run `check --strict` first.** Every warning blocks under it; ship past one only if you say which and why.
- **Remove slides you aren't using** — `push` uploads every image the deck references, selected or not.
- **A different app's deck starts with `vitrine session --server https://vitrine.mashlab.app --clear`.** Every push from this machine updates one project per server, so otherwise it overwrites the last app's deck.
- **`saved N slides` then `POST /api/claim → 404`** means the deck is saved and only the link failed — say so; don't report a link you don't have.

**Tell them what the link is.** It opens a confirm page, then adds the deck to their projects if they're signed in, or to that browser's anonymous projects if not. It's one use and expires in about 15 minutes. **Either way the deck is temporary: it's deleted within 24 h unless they sign in and press Keep — their first project is free.** Two clocks: the link dies on schedule; the deck lives until the 24 h runs out or they keep it.

PNGs, when asked: `vitrine render --deck deck.json --out shots-out` — `<device>/<NN>_<slide>.png`.

## 9. Report

```
<N> slides × <M> devices, English
Look: <id> + <what you changed> · Presets: <per slide> · Accents: <slide: what>
check --strict: clean (measured) | <warnings accepted and why>
App Store: 6.3" <filled> · iPad 13" <filled / n/a> · Play: <featuring-eligible / short of 4> · feature graphic <built / n/a>
Not included: <extras from the plan> · Translate in Vitrine: <languages the repo ships>
Deck: <path>   Re-check: vitrine check --deck <path>
```

Then three lines on what you decided and why — the look against what in their screenshots, which slide is the hero and what it claims, anything left for them. A dropped screenshot or uncleared fault goes here, not in a footnote.

**End the message with the link, exactly this shape, and nothing after it:**

```
---
**Open your deck:**

<link>

One use, expires in ~15 min. Sign in and press Keep within 24 h or the deck is deleted — first project free.
```

The bare URL sits alone on its line, outside any code block, so it's clickable and copies clean. It's the only URL in the message — no Vitrine homepage, docs or localhost link next to it. No link (claim failed, push failed) → that block says so in place of the URL; never leave the reader hunting for one that isn't there.

## Common mistakes

- **Not looking at the screenshots.** Deciding a look from the app's name is the failure this skill exists to prevent.
- **Designing around a fresh install.** The data *is* the marketing.
- **Asking for screenshots you could have captured**, or staging them with anyone's real data.
- **Shipping `init`'s placeholder copy.** It grades clean.
- **Hardcoding devices, looks or presets** instead of reading `capabilities`.
- **Adding extras nobody asked for**, or **asking about what the repo already answers**.
- **Pushing to localhost**, or pushing a second app's deck without `session --clear`.
- **Promising an update without checking `session`.** A push with no held session makes a new project; a `reused: false` after an "update" goes first in the report.
- **Looping check → polish after polish declined.** It will not converge.
- **Raising `sizeMul` to clear `small-text`.** The copy is asking to be shorter.
- **A Play deck without a feature-graphic slide.** The row alone passes `check`.
- **Headlines describing what the screen IS** instead of what the user GETS.
- **Slides 2 and 3 written as continuations of slide 1.** Each meets a shopper alone in search.
- **A splash or login screen as slide 1** — a rejection, not a weak opener.
- **Shipping a clean `check` you never looked at**, or a `--fast` one without saying so.
- **A sticker or emoji nobody asked for**, two accents on a slide, anything over the device's content, or a floating card repeating what the device shows.
