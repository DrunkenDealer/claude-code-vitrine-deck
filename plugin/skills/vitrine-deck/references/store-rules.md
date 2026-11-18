# What the stores decide

Everything here is Apple's or Google's call. It is the part that gets a listing rejected or makes a
deck impossible to upload. Every claim cites its source at the bottom; re-verify against those
pages, never against a marketing blog.

The machine-checkable rules (canvas sizes, slot counts, the required iPhone and iPad rows,
featuring, the Play feature graphic, banned copy) are graded by `vitrine check`, in its `store`
and `copy` sections. Read the live rule set from `capabilities.stores` and `capabilities.faults.store`
rather than from this file. What follows is what those gates rest on, and what they can't see.

## What the shopper actually sees

The surface that decides the install is search, and it shows almost none of the gallery.

| Store | In search results | On the product page |
|---|---|---|
| App Store | the **first 1-3** portrait shots, or **1** landscape, when there is no app preview | all of them |
| Play | the preview video plus the **first** shot, or the **first 3** with no video¹ | all of them |

¹ Apple documents the 1-3 rule. The Play row is what practitioners consistently observe, not
something Google documents; treat it as a working assumption.

Roughly nine in ten shoppers never scroll the gallery. That is a practitioner measurement, not a
store figure. So **slides 1-3 each have to work alone**, at thumbnail size, with no neighbours for
context. Everything after slide 3 is for shoppers who are already interested.

## Slots and required rows

| | App Store | Play |
|---|---|---|
| Per localization | 1-10 per device class | 2-8 per device type |
| Required | iPhone 6.1"/6.3" (1206×2622 or 1179×2556) if it runs on iPhone; iPad 13" (2064×2752 or 2048×2732) if it runs on iPad | phone; 7" and 10" tablet sets if it declares tablet support |
| Smaller sizes | scaled down from the required resolution | not scaled; each device type is its own set |

- **Vitrine rows.** `iphone-6.3` is the required iPhone row and `ipad-13` the iPad one. 6.9" and
  6.5" are optional slots, worth a row only for a *different* set.
- **iPhone Duo.** `iphone-duo` (outer, 1398×2034), `iphone-duo-inner` (inner, 2007×2853, a tablet
  row) and their `-landscape` twins are optional. Supplying them earns the "optimized for iPhone
  Duo" badge. They become required in April 2027 for apps built with the iOS 27.1 SDK or later. None
  of them fills the required iPhone or iPad slot.
- **What `check` does.** It blocks on a slot count outside the range (`slot-count`). Unselected
  slides don't count, and tablet rows count their phone fallback. It warns when an iOS deck lacks
  a required row (`required-slot`).

## The canvas Play will accept

**16:9 or 9:16 only**, every side between **320** and **3840** px. Modern Android phones are 20:9,
so a native-shaped canvas (1080×2400, 1344×2992) is **rejected on upload**.

Google states this two ways. The help page caps the long side at twice the short side, while the
Console's uploader asks for "16:9 or 9:16 aspect ratio" on every screenshot slot. The uploader is
what refuses the file, so 16:9 is the rule.

Vitrine's Android rows are all exactly 16:9:

- `android-phone` 1080×1920
- `android-tablet-7` 1080×1920
- `android-tablet-10` 1440×2560

`check` blocks (`store-fit`) on a hand-authored canvas that isn't 16:9 and names a row that would be
accepted. Apple has no ratio rule; it takes the exact sizes App Store Connect lists, which the
iPhone and iPad rows match.

A 16:9 canvas is **shorter than the phone the screenshot came from**. A layout that fits the iPhone
cell has less height on the Play cell, so budget a smaller device or a tighter caption band, and
re-`check`.

Both stores accept **JPEG or 24-bit PNG, no alpha**. `vitrine render` writes 24-bit RGB PNG (or
JPEG with `--format jpeg`). Keep it that way if you post-process the files.

## Featuring and the Play feature graphic

- **Play featuring eligibility** wants at least **4** screenshots at 1080px or better, 9:16
  portrait or 16:9 landscape. Portrait alone qualifies, so `android-phone` with 4+ selected slides
  clears it. Games need 3 of one orientation. `check` warns `featuring` when the deck falls short.
  Add landscape only when the app has landscape UI.
- **Every Play listing needs a 1024×500 feature graphic.**
  - **How to build it in Vitrine.** Add a selected slide of kind `feature-graphic` on the
    `play-feature-graphic` row: `vitrine init --kind feature-graphic --device play-feature-graphic
    --out fg.json`, then copy that slide into the deck. It takes exactly one slide, needs no
    screenshot, and is exempt from 16:9.
  - **What Google asks of it** ([preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)):
    the brand and a few words, focal content central, no device imagery, not just the icon, vibrant
    colour rather than white, black or dark grey, and readable an inch wide. 6 of 7 live graphics
    sampled (Bumble, Finch, Headspace, Revolut, Strava, Todoist, WhatsApp) carry a wordmark and key
    art; none is a bare icon tile. Hence the icon + name + tagline lockups (`fg-*` layouts).
  - **What `check` misses.** `no-feature-graphic` only checks that the **row** exists. A row with no
    selected feature-graphic slide passes silently, so confirm the slide is there yourself.

## App Store banners (optional)

The product-page header (3840×1646) and the search-results asset (3:2, 1920×1280 to 3840×2560) are
optional creative assets. Vitrine draws them on the `app-store-header` (`page-header`) and
`app-store-search` (`search-result`) rows. Both are banner kinds: the device layer and screenshot
are optional, and `check` always enforces the store's art safe area on them (`safe-area`).

## What the stores refuse in the picture

Both stores read the screenshot as metadata and reject on it.

**Apple, App Review Guidelines:**
- **2.3.3**: screenshots show the app **in use**. Title art, a splash or a login screen is a
  rejection. Text and image overlays are fine.
- **2.3.2**: if what the slide shows needs a purchase, the slide says so.
- **2.3.7**: no prices, and no metadata that isn't about this app.
- **2.3.14**: no unverifiable claims. A real award, press quote or rating is fine; an unsupported
  "#1" or "best" is not.
- **2.3.8**: imagery appropriate to a 4+ rating, even when the app is rated higher.
- **2.3.9**: you own the rights to everything in the frame, and account data is **fictional**.
  Never use a real person's name, face, message or number.

**Google Play, Store listing and promotion policy:**
- No rankings, awards or store programmes: *#1*, *Best*, *Top*, *App of the Year*, *Editor's
  Choice*, award badges, star ratings, download counts, "as seen in". Apple allows these, and 10 of
  16 award-winning App Store sets show laurels or press on slide 1 or 2 — so they belong on App
  Store rows only. A deck whose slides ship to Play rows needs a separate Play deck without them
  (Strava and Calm swap the award slide on Play); `check` blocks them only on Play rows.
- No prices, discounts or offers: *free for a limited time*, *50% off*.
- No fake UI, such as unread dots with no messages or buttons that do nothing.
- The assets must **reflect the app's actual current experience**.
- Avoid ALL CAPS, excessive special characters and emoji pile-ups.

**Both:** never name the other store, and never put a URL, email address or QR code in a slide.

`check`'s copy gate (`capabilities.faults.copy`) runs these patterns over the copy. Banned claims block; promotional words, ALL CAPS and emoji only warn, unless you pass
`--strict`. Its limits:
- They miss phrasing such as "better than ever" and "download it today".
- They can't see claims inside the screenshot pixels.

Read the copy yourself.

## Sources

Apple's screenshot specifications verified 2026-10-20; the rest verified 2026-09-09.

- Apple · [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/): sizes, 1-10, formats, scaling
- Apple · [Creative assets specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/): product-page header, search-results asset
- Apple · [Product page](https://developer.apple.com/app-store/product-page/): first 1-3 in search, show real UI, include a Dark Mode shot
- Apple · [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/): 2.3.x
- Google · [Add preview assets](https://support.google.com/googleplay/android-developer/answer/9866151): counts, 320-3840, the 2× rule, feature graphic, featuring eligibility
- Google · [Store listing and promotion policy](https://support.google.com/googleplay/android-developer/answer/9898842): prohibited claims and misleading imagery
