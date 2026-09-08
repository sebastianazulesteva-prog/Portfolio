# Deep dive: /vr is broken inside an immersive WebXR session on Apple Vision Pro

You are picking up a WebXR portfolio scene that works on desktop and is badly
broken in a headset. Your job is to **find the true root cause, prove it, and
fix it** — not to apply the fixes guessed at below. Treat the hypothesis in §3
as the leading candidate to *test*, not as a conclusion.

**Read `VR_AI_BUILD_GUIDE.md` first, in full.** It is the standing spec: §2 is
the hard rules, §3 is a catalogue of traps that fail silently (§3.13 is about
Vision Pro input specifically), §4 is the file map, §9.16 and §9.17 are the two
most recent work sessions and the measurements behind them. Do not skip it; most
of the obvious ideas have already been tried and are documented there.

---

## 1. The project, in one paragraph

`/vr` is a spatial portfolio at `https://sesteva.com/vr/` — A-Frame 1.5.0 +
three.js 0.158 + troika-text + GSAP 3.12.5 + pdf.js 3.11.174, all pinned, all
from CDN. **No build step, no bundler, no modules** — plain ES5-style scripts
(`var`, IIFEs) loaded by `<script>` tags in `vr/index.html`. Content is scraped
at runtime from the flat site, never hand-duplicated. `main` IS the live site
(GitHub Pages). The owner tests on an Apple Vision Pro; that is the target
device and the only place these bugs appear.

---

## 2. What the owner reports, verbatim where it matters

Two headset sessions. After the first, input was found to be genuinely broken and
was fixed (see §5). After the second round of fixes:

- Opening a writing piece: the new loading card appears, **its text is visibly
  overlapping/"mushed up"**, the progress bar sits at about 30%, and then
  "eventually it just closed".
- **He was never moved.** Asked explicitly: he stayed in the dome with the cards
  around him, and there was **no "Back to the dome" button** anywhere — so the
  room transition never happened.
- **Experience cards will not flip.** His words: *"that feels like a really low
  bar thing that should just work, all it's doing is flipping over."* Important
  caveat: he only tried this **after** attempting the reader, so it is not yet
  known whether the flip fails on a fresh load.
- Earlier session: "entering rooms takes forever", a photo in the cloud that
  could not be pulled forward, reader scroll pads that did nothing.

---

## 3. The leading hypothesis — TEST THIS FIRST

**`window.requestAnimationFrame` is starved inside an immersive WebXR session, and
both GSAP and pdf.js depend on it.**

In an immersive session three.js switches to `session.requestAnimationFrame` via
`renderer.setAnimationLoop`, so **A-Frame's own render loop keeps running** — the
scene draws, components tick, clicks work. But any library that scheduled itself
on the *window's* rAF is no longer being called.

- **GSAP** runs its ticker on `window.requestAnimationFrame` and additionally
  self-suspends on `document.hidden`.
- **pdf.js** rasterises a page in chunks, scheduling each via
  `window.requestAnimationFrame` (`InternalRenderTask._useRequestAnimationFrame`).

If true, this single fact explains every symptom at once:

| symptom | mechanism |
|---|---|
| PDF pages never rasterise (a 6 s timeout in `pdf-reader.js` fires every time) | pdf.js chunk scheduling |
| Reader never enters the room | `runTransition()` is a GSAP tween; its callback fires at the dip's dark peak and never runs |
| Experience cards will not flip | `card-flip.js` `flipTween()` is `gsap.to(...)` |
| Photo cloud tiles won't come forward | `photo-cloud.js` `_moveTile` is GSAP |
| Skills panel fly-in, focus stage | GSAP |
| **Clicks DO work** | `xr-select.js` is pure event handling with no rAF — this is the control that proves the loop, not the input, is the problem |

### How to prove or kill it

Run this **inside an immersive session on the device** (`?xrdebug=1` already logs
input; add whatever you need). The scene is live, so a temporary diagnostic page
or a URL flag is fine.

```js
// In-session, compare the two clocks.
var s = document.querySelector('a-scene');
var sess = s.renderer.xr.getSession();
var winFrames = 0, xrFrames = 0, t0 = performance.now();
(function w(){ winFrames++; window.requestAnimationFrame(w); })();
(function x(){ xrFrames++; sess.requestAnimationFrame(x); })();
setTimeout(function(){
  console.log({
    seconds: (performance.now()-t0)/1000,
    windowRaf: winFrames,          // expect ~0 if the hypothesis holds
    xrRaf: xrFrames,               // expect ~90/s
    gsapTickerFrame: gsap.ticker.frame,   // expect frozen
    sceneTime: s.time,             // expect advancing
    documentHidden: document.hidden
  });
}, 3000);
```

If `windowRaf` is ~0 while `xrRaf` climbs and `gsap.ticker.frame` is frozen, the
hypothesis is confirmed and it is the root cause of nearly everything.

**Do not stop there.** Also check: does `document.hidden` become `true` in an
immersive session? That alone would suspend GSAP's ticker even if window rAF were
alive, and it has a different fix.

---

## 4. Fixes to consider once you have proof

### If the hypothesis is confirmed

**Drive GSAP from A-Frame's tick loop.** A-Frame's loop runs on the XR frame
clock, so a scene-level component whose `tick()` calls `gsap.ticker.tick()` (with
`gsap.ticker.lagSmoothing(0)`, and taking care not to double-advance when the
window loop *is* alive) repairs transitions, card flips, the skills panel and the
photo cloud in one place. Verify there is no double-ticking outside VR.

Consider whether anything else in the codebase assumes window rAF. Grep for
`requestAnimationFrame` and for `setTimeout`-based polling (there is a fair
amount of "poll until troika has measured" code, and `setTimeout` is throttled in
backgrounded contexts).

**For the reader: take pdf.js out of the VR path entirely.** This is the owner's
decision, already made:

> Pre-render each PDF page to an image file at build time, and have the reader
> load those as ordinary textures. **Keep the room transition** — he explicitly
> chose to still be moved to the reading alcove.

Notes for that work:
- PyMuPDF (`fitz`) is available locally and is already used by
  `.tools/vr-shrink-pdfs.py`. `.tools/vr-make-textures.py` is the established
  pattern for generated assets: derivatives plus a `manifest.js` publishing a
  plain `window.VR_*` global, loaded by a `<script>` tag before any component so
  there is no fetch to sequence. Follow it.
- `.tools/` is gitignored (local tooling) while its *output* ships. That is the
  existing convention, not an oversight.
- Pages must load lazily and in reading order — the current reader keeps a window
  of ±1 page around the current one and disposes the rest; preserve that, because
  texture memory is tight (see §9.16 for the numbers).
- Budget: page images at ~150 DPI land around 100–250 KB each. A 19-page document
  is ~3 MB total but only ~3 pages need to exist to start reading. This is
  strictly better than today's 1.41 MB of pdf.js + a 3.5 MB PDF.
- Once pdf.js is gone, delete its prefetch, its worker warming, the render queue
  and its watchdog. Do not leave dead machinery behind.

### If the hypothesis is WRONG

Then the reader's failure is elsewhere and you should trace `open()` in
`vr/components/pdf-reader.js` line by line on the device. Note that the owner
staying in the dome with `state.open` possibly left `true` points at the
`'cancelled'` early-return in that function's `.catch` — see §5.

---

## 5. Bugs already identified, not yet fixed — verify each

These were found by reading the code after the second session. None is confirmed
on-device. Do not assume they are the whole story.

1. **The input gate can leak, and it is severe.** `vr/components/busy.js`
   installs a *capturing* `click` listener on `<a-scene>` that swallows every
   click while any job is active. `pdf-reader.js`'s `close()` clears its own
   `opening` guard but **never calls `VRBusy.end()`**, so a reader that closes
   mid-load leaves the gate on and **every click in the scene is dead until
   reload**. This is a candidate explanation for the cards not flipping.
   `VRBusy.clearAll()` exists as a backstop and nothing calls it.
2. **`state.open` is not reset on the cancelled path.** In `open()`, the
   `'cancelled'` branch of the `.catch` returns early *after* `state.open = true`
   was set, leaving a phantom-open reader with no root, no rail and a visible hub.
3. **The loading card uses fixed vertical offsets.** `busy.js` places its title,
   stage line and progress bar at hardcoded y values. The title is
   `'Opening "' + project.title + '"'`, which wraps to two or three lines for a
   long title and collides with the stage line — this is the "mushed up" text.
   The repo has `text-flow.js` (`VRTextFlow.stack`, with an `onReflow` callback)
   built specifically to prevent this; use it, and size the plate from the
   measured height.
4. **The progress bar's ~30% is meaningless.** `busy.js` parks the bar at 0.34
   when it has no byte total. So either pdf.js reported no `total`, or the visible
   stage was one of the ones called without one. Make indeterminate look
   indeterminate rather than like a stalled 34%.

---

## 6. Constraints — these are not negotiable

- **No build step.** Plain files, CDN, pinned versions, `var`-style ES5. No npm,
  no bundler, no modules.
- **Bump the `?v=` query on every edited component in BOTH `vr/index.html` and
  `vr/_dev-preview.html`.** Otherwise the browser serves a cached file and you
  debug a version that isn't running. Cache-bust the page URL too when reloading.
- **Don't touch the flat site.** The one sanctioned touchpoint outside `/vr` is
  the nav entry in `index.html`. (The PDFs themselves were an explicitly approved
  exception.)
- **Audio stays off at the source** (`window.VR_AUDIO = false`), and never let
  test audio play.
- **Respect `prefers-reduced-motion` and `a11yMode`.** Reduced motion must mean
  "arrives in final state instantly", not "broken" — note this interacts directly
  with the GSAP problem: the reduced-motion paths in `card-flip.js` and
  `pdf-reader.js` bypass GSAP entirely and may be the only paths that currently
  work in VR. That is a useful clue and possibly a useful fallback.
- Project rooms are sealed behind `window.VR_ROOMS = false`; the reading room is
  *not* affected by that flag.

## 7. Testing reality — read this before trusting any measurement

The Browser preview pane's rAF is **unreliable and varies within a single
session** — measured at 120 fps early in one session and 0.2 fps an hour later,
with `scene.time` frozen at 0. `gsap.ticker.frame === 0` is the cheapest tell.
Consequences:

- A passing screenshot is not evidence the loop is running.
- GSAP tweens stall mid-flight and produce convincing false failures. Force them:
  `gsap.globalTimeline.getChildren(true,true,false).forEach(t => t.progress(1))`.
- `setTimeout` is clamped to ~1 s when backgrounded; `MessageChannel` is not.
  There is a working pump recipe in §9.17's neighbourhood and in the guide.
- pdf.js rasterisation **cannot be exercised in the pane at all** when rAF is
  throttled — which is itself weak corroboration of the hypothesis, since the
  same dependency is implicated.

**Therefore: the device is the only real test.** Anything you cannot verify on
the Vision Pro, say so plainly rather than claiming it works. The previous pass
shipped an input fix verified only with a synthetic event burst; it happened to be
correct, but that was not established at the time.

---

## 8. What good output looks like

1. A confirmed root cause with the measurement that proves it, taken in-session
   on the device.
2. The smallest fix that addresses that cause, rather than a fix per symptom.
3. The four bugs in §5 resolved or explicitly dismissed with reasons.
4. Every claim marked as verified-on-device, verified-in-pane, or unverified.
5. Notes folded into `VR_AI_BUILD_GUIDE.md` as a new §9.18 and, if you find a new
   silent-failure trap, a new §3.x — that document is the reason this codebase is
   tractable, so keep paying into it.

The single most valuable thing you can produce is a definitive answer to: **does
`window.requestAnimationFrame` run inside an immersive WebXR session on visionOS
Safari, and if not, what in this codebase silently depends on it?**
