# Source screenshots

The developer hands you PNGs, or you captured them (`capture.md`). They are usually not ready to design with, and none of the
problems announce themselves — `check` grades the deck you built, not the pixels you fed it. Clear
these five before designing, because each one changes what you build.

## 1. Does the app look used?

If you captured the shots, this list is the bar your staging meets. If the developer handed them to
you, it's the one you cannot fix yourself, so raise it first — it needs them to capture again, and
that has the longest lead time of anything in this skill.

A screenshot of a fresh install sells a fresh install. An empty habit list, a chart with two points,
"No entries yet", a streak of 0, placeholder names like "Test 1" and "asdf", every date sitting in
one week — these say *nobody uses this* louder than any headline says otherwise. The listing is
promising a habit the shopper will keep; the screenshot has to show someone who kept it.

**Ask for captures from a lived-in account**, and be specific about what that means, because
"add some data" comes back as three more rows:

- **History with depth.** Months on the chart, not days. A heatmap with a filled-in past.
- **A streak worth having** — 13, 47 — and the badges or milestones that come with it.
- **Plausible names.** "Morning run", "In bed by 11", "Deep work block" — never "Habit 1".
- **Numbers that read as real.** 81%, 204 completions. Not 100%, not 0%, not round.
- **A believable clock and battery**, and a date that isn't three years stale.
- **Variety.** A perfect grid of all-green is as fake as an empty one. Real use has gaps.

**Seeded, not borrowed.** Apple requires fictional account data in a screenshot (2.3.9), so ask for
a demo account they populated — never a capture of a real user's journal, messages, contacts or
face. "Realistic" and "someone's actual data" are different asks and only one of them ships.

**And ask for the data in English-market shapes.** Currency symbol, date order and units live
*inside* the screenshot: a `€` and `17.04.` in an English listing read as a port, exactly like the
keyboard in §4. Ask for it before the capture; afterwards it is a re-shoot.

**One dark-mode capture if the app has one.** Apple asks for a Dark Mode screenshot by name, and it
is free to capture while they're already in there.

The screenshots are usually the developer's own dev build with test data in it. Say plainly that the
data *is* the marketing here, and that populating an account well is worth more than anything you
can do to the slide around it. Offer to design against what you have, flag the slides that will look
empty, and re-run once real captures land.

## 2. Is a device frame already baked in?

The most common and the most expensive to miss. A pre-framed capture put into Vitrine with
`useFrame: true` renders a phone inside a phone; with `useFrame: false` it ships whatever frame the
developer's tool drew, which is usually the wrong platform.

A framed capture is a transparent-background PNG whose corners are `alpha 0` and whose centre rows
start dark before they reach the UI. Probe it:

```js
const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const px = (x,y) => { const i=(y*info.width+x)*info.channels; return [...data.slice(i,i+4)]; };
px(0,0);                       // [0,0,0,0] = transparent corner -> a frame was drawn
px(20, info.height>>1);        // near-black at the mid-row edge -> that's the bezel
```

**If it is framed, crop the screen back out** and let Vitrine draw the correct frame per device.
Find the inner rect by scanning the centre row/column for the first opaque bright pixel:

```js
const bright=(x,y)=>{const[r,g,b,a]=px(x,y);return a>250&&r>195&&g>195&&b>195;};
```

The answer is almost always an exact stock resolution — 1080×2340, 1170×2532 — which is how you
know the crop is right rather than approximately right. Then extract, and flatten to kill the
rounded-corner alpha:

```js
await sharp(src).extract({left,top,width,height}).flatten({background:'#ffffff'}).toFile(out);
```

## 3. Was it captured on the platform you're shipping to?

An Android capture in an App Store listing is obvious to a shopper and reads as a port nobody
maintains. The crop above fixes it — the bare screen goes into whichever frame the device row asks
for. What it cannot fix is platform-specific chrome inside the UI (an Android back arrow, a
Material overflow menu). Say so rather than shipping it.

## 4. Is the OS language right?

A system keyboard, share sheet or permission dialog renders in the capture device's language, not
the app's. A German keyboard in an English listing reads as an app nobody checked. You can only spot this by reading the screenshot — which is why you open
every screenshot rather than listing filenames.

Flag it, and offer the two honest options: re-capture, or drop the slide. Never quietly ship it.

## 5. Does it deserve a slide at all?

A settings screen, an empty state, a modal over a dimmed parent. Say which one you'd drop and why,
and let the developer decide — see `design-rules.md`.

**A splash screen, a login screen or title art is not a judgement call.** Apple rejects a listing
built on one (2.3.3: the screenshot shows the app *in use*), and Play reads it as not reflecting the
app. If that's all there is for slide 1, the answer is a re-capture, not a better headline.

## Getting at `sharp`

The probes above need Vitrine's own `sharp`. You are not standing in that checkout, so a bare
`import 'sharp'` fails. Anchor the resolution on the checkout's `package.json`, save the script as
`.mjs` (the snippets use top-level `await`), and run it with `node`:

```js
import { createRequire } from 'node:module';
const checkout = '/abs/path/to/Vitrine';
const sharp = createRequire(`${checkout}/package.json`)('sharp');
```

The same import builds the 300px contact strip used to review renders.
