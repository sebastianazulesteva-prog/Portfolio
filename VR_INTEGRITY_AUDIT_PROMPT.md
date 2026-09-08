# Integrity audit and performance pass: make `/vr` run as well as it can

You are picking up a WebXR portfolio scene that **works**. Three headset
sessions' worth of functional bugs have been found and fixed, and the last of
them (the frame-clock bug, §9.18) was the kind that hides behind every other
symptom. This brief is not about a broken feature. It is about the thing that is
harder to ask for: **is this codebase actually sound, and is it as fast, as light
and as robust as it can be without changing what it is?**

Your job is to audit it end to end, prove what you find with measurements, fix
what is worth fixing, and be explicit about what you chose not to touch and why.

**Read `VR_AI_BUILD_GUIDE.md` first, in full.** It is the standing spec. §2 is the
hard rules, §3 is sixteen traps that fail *silently* (several produce convincing
false measurements — you will not notice you have been fooled unless you know to
check), §4 is the file map, §5 is the dev tooling that already exists, and §9 is
the work-session log with the numbers behind every decision. Most obvious ideas
have already been tried and are recorded there. Do not skip it, and do not
re-litigate decisions §9 documents as deliberate.

---

## 1. The project, in one paragraph

`/vr` is a spatial portfolio at `https://sesteva.com/vr/` — A-Frame 1.5.0 +
three.js 0.158 + troika-text + GSAP 3.12.5, all pinned, all from CDN. **No build
step, no bundler, no modules** — plain ES5-style scripts (`var`, IIFEs) loaded by
`<script>` tags in `vr/index.html`. Content is scraped at runtime from the flat
site, never hand-duplicated. `main` IS the live site (GitHub Pages), so a push
deploys within a minute or two. The target device is an Apple Vision Pro; the
desktop and phone views are an explicitly acknowledged fallback (§9.7).

Current size: **~11,400 lines across 33 component files, ~555 KB of JS**, plus
`vr/index.html` (~1,050 lines, which carries the scene markup *and* the layout
maths), `vr/vr.css`, and two generated asset sets (`assets/tex`, `assets/pages`).

---

## 2. What "runs as well as possible" means here — in priority order

Be ruthless about this ordering. It is a portfolio site viewed for a few minutes
in a headset, not a game engine.

1. **Correctness and robustness.** A visitor must never reach a dead end: no
   state that needs a reload, no control that silently does nothing, no leaked
   input gate, no way to strand yourself. This outranks everything below it.
2. **Arrival.** Time-to-first-look and time-to-interactive. §9.16 measured 50.9 MB
   and ~284 MB of held texture on arrival and cut it to 7.4 MB / 63 MB; that was
   the single biggest experience win in the project's history. Re-measure it.
3. **Memory over a session.** The scene is never torn down. A visitor who opens
   three pieces, four focus stages and a dozen photos must not be worse off than
   one who opens nothing.
4. **Frame time.** Probably already fine — §9.16 measured **1.17 ms of GPU at
   3840×1824 two-eye with 63 draw calls and 8,814 triangles.** Verify before
   optimising anything here. Do not spend effort on a budget that is 7% used.
5. **Maintainability.** Not a virtue in itself, but this codebase is edited
   exclusively by AI assistants reading `VR_AI_BUILD_GUIDE.md`, so the cost of a
   confusing structure is paid as *future bugs*. Weigh it that way.

**What is explicitly NOT in scope:** visual redesign, new features, layout
changes, and the project rooms (sealed behind `window.VR_ROOMS = false` and
awaiting a dedicated rebuild — §9.11). If you find a visual problem, report it;
do not fix it.

---

## 3. Leads already on the table — VERIFY EACH, they are not conclusions

These came from a mechanical sweep of the repo, not from reading the code
carefully. **Several are probably fine.** Crude counts are marked as such;
treating one as a bug count would be the first mistake available to you.

### 3.1 `.DS_Store` is tracked, and ships

```
git ls-files | grep DS_Store   →   .DS_Store,  images/.DS_Store
```

macOS directory metadata, committed, deployed, and dirty in `git status` on every
machine that opens a Finder window. This is why `git status` has shown
`M .DS_Store` for the whole life of the project. Low impact, trivially fixable,
and exactly the sort of thing an integrity audit exists to catch. Check whether
anything else non-source is tracked.

### 3.2 Disposal coverage looks thin — but count honestly

```
allocations of Geometry/Material/Texture   61
.dispose() calls                           15
```

**This is a crude ratio, not 46 leaks.** Most of the scene is built once and
lives forever, and permanent objects correctly have no dispose. What matters is
the objects that are built and destroyed *repeatedly*:

- `photo-cloud.js` — the guide admits it outright (§9.15): the caption chips are
  disposed, but **the 32 tile meshes and their textures are not**, on the
  reasoning that the cloud is never removed. Verify that reasoning still holds.
- `focus-stage.js`, `notice.js`, `card-flip.js`'s lazily-built backs,
  `pdf-reader.js`'s pages and rail, `project-room.js`, `bio-card.js`'s skills
  panel — every one of these builds on demand. Do they all free on teardown?
- The honest test is to open and close each of them ~20 times and watch
  `renderer.info.memory.geometries` / `.textures` and `renderer.info.programs`.
  Those three counters are the ground truth; a code read will miss things.

### 3.3 Listener hygiene

```
addEventListener      97
removeEventListener   23
```

Again crude — most listeners are on the scene or on permanent entities and are
meant to live forever. The real question is narrower: **does every component with
a `remove()` undo what its `init()` did**, and does anything that attaches
listeners to `window` or the canvas per-instance ever detach them?
`carousel-drag.js` is the known example of the pattern (it adds four `window`
listeners in `init` and removes them in `remove`) and it is now attached to
nothing, so use it as the reference shape rather than a bug.

### 3.4 The `renderOrder` stack has no registry, and §3.6 makes that dangerous

Every value in use, gathered from across the files:

```
5, 10, 11, 12, 15/16/17, 20/21/22, 30/31/32, 40/41/42, 999, 1000
```

Trap §3.6 is the load-bearing context: this scene runs with
`sortTransparentObjects: false` and nearly every surface is transparent with
`depthWrite: false`, so **`renderOrder` — not distance — is what decides what is
in front.** These numbers live as private constants in eight different files
(`photo-cloud`, `focus-stage`, `bio-card`'s skills panel, `notice`, `busy`,
`xr-diag`, `reticle`, `locomotion`), and two of them (999/1000, the reticle and
the motion vignette) are "on top of everything" by fiat.

Questions worth answering: can any two of these collide in a state that is
actually reachable (a notice over a focus stage over a selected photo; the
loading card during a room transition; the reticle over the diag card)? Is a
single documented layer table — one file, named constants, one comment explaining
the ordering — worth it? **Do not renumber anything without first proving a
reachable collision**; §3.6's note about how hard this is to measure applies, and
a speculative renumber risks breaking compositing that currently works.

### 3.5 Nine bare `setTimeout` poll loops remain (trap §3.15)

`bio-card` ×3, `hub-panel`, `glass-material`, `name-scatter-3d`, `photo-cloud`,
`ui-button`, plus the fallback paths in `text-flow` and `busy`. All of them wait
for troika to finish measuring text. A timeout is clamped to ~1 s in any context
the browser treats as backgrounded, which would make each one ~25–40× slower.

`VRPoll.every()` (in `xr-frame.js`) is the migration target and is dual-armed —
tick **and** timeout, first to fire wins — so it is strictly more robust than
either. But **this is gated on a measurement that has not been taken**: whether
visionOS actually backgrounds an immersive session. `?xrdiag=1` reports it
(`setTimeout(50)` fired N of ~60, and `document.hidden`). Take that reading first.
If timers are not clamped, migrating nine working loops is churn — say so and
leave them.

### 3.6 `?v=` drift, live in the repo right now

```
project-room.js   index.html v22   _dev-preview.html v23
sfx.js            index.html v5    _dev-preview.html v4
```

Rule §2.8 says bump both. Two have drifted, which means the harness and the scene
are loading **different files** for those two components — precisely the trap the
rule exists to prevent, and it will produce a false result in the harness sooner
or later. Beyond fixing these two: is there a way to make this class of mistake
impossible without adding a build step? (A shared manifest loaded by both pages
is one option. Weigh it against the no-build-step rule, which is absolute.)

### 3.7 27 `window.VR*` globals, and a hand-ordered load

`VRArrowGlyph, VRBusy, VRCardFlip, VRColumnScroll, VRConstellation, VRData,
VRDiag, VRExitButton, VRFocusStage, VRFonts, VRFrame, VRGlass, VRHud, VRNotice,
VRPdfReader, VRPoll, VRPortraitLayout, VRProjectRoom, VRScrollArrows, VRSfx,
VRSound, VRTextFlow, VRThemes, VRType, VRWalk, VRWritingPlaced, VRWritingScroll`

This is the honest consequence of "no modules" and is not itself a defect. The
audit question is narrower: **the load order in `index.html` is maintained by
hand and by comment.** Which of those globals are read at *load* time (so order
genuinely matters) versus at *call* time (so it does not)? Guard the ones that
matter, and consider whether a component that reaches for a missing dependency
should fail loudly rather than throw a `TypeError` deep in a callback. `xr-diag.js`
has one example of the pattern (it warns by name when `VRPoll` is absent).

### 3.8 `vr/index.html` carries logic, not just markup

~1,050 lines, and it holds `layoutCluster` — the shared cluster layout engine,
including the angular-step maths, the a11y widening rule and the partial-row
fill — plus all the zone-angle constants and the data wiring. It is the largest
piece of *logic* in the project that is not in a component file, it cannot be
unit-tested the way the components can (see §5), and §9.19 removed a hook from it
this week. Is moving `layoutCluster` into a component file worth it? Argue both
sides; the counter-argument is that it is genuinely page-specific and moving it
buys nothing but a file.

### 3.9 Things the guide already flags as unresolved

Do not re-diagnose these; check whether they are still true and whether they now
matter more than they did:

- **`bio-card`: "content overflows the card by 0.009 m at scale 1.065"** — logged
  as a warning on every single page load. 9 mm. Either it is real and should be
  fixed, or the threshold is wrong and the warning is noise. Noise in the console
  on a live site is its own small integrity problem.
- **The bio card vs the Experience cluster** (§9.9, "Open finding, needs
  Sebastian's call"): measured overlapping by up to **100% in screen space** at
  yaw −37° to −51°. The fix costs the photo cloud 8° of width. Still open, still
  Sebastian's call — flag it, do not decide it.
- **Hover/select SFX are coupled to the ambience toggle** (§6), so a visitor who
  never enables audio gets no UI sound. Probably unintended. Audio is hard-off at
  the source, so this is latent, not live.
- **`vr/_dev-preview.html` is missing components** the scene has (`card-flip`,
  `xr-select`, `hud`, `walk-controls`, `column-scroll`, `onboarding`). Some
  absences are deliberate. Are they all?

### 3.10 Where you should look that this sweep could not

The sweep was mechanical. It cannot see:

- **Duplicated logic that has drifted.** §9.12 and §9.19 are both stories about
  two copies of the same idea going out of sync (hardcoded id lists vs
  `.hub-cluster`; a hand-copied snap angle vs the derived one). Look for more:
  rounded-rect geometry, cover-fit maths, "face the viewer" quaternion code,
  reading-transform code (`bio-card`'s skills panel, `focus-stage` and
  `card-flip` all fly something to ~1.02 m and all say so in comments — are they
  three copies of one function?), hex colour literals that are really design
  tokens.
- **State machines with unreachable or sticky states.** `pdf-reader`,
  `project-room`, `focus-stage`, `card-flip` and `photo-cloud` all have open/close
  pairs with guards. Enumerate the transitions, including the interesting ones:
  open A then open B; close during open; two overlays at once; the exit button in
  each context; a room transition interrupted by a reload.
- **Error paths.** Every `.catch`, every `onerror`, every `if (!el) return`. Which
  of them leave the scene in a usable state, and which just stop? §9.18 found one
  where a `close()` left the input gate on and killed every click in the scene.
- **Anything that assumes it is at the origin.** §9.12 introduced walk sites
  (`VRWalk.site`); code written before that may still assume the rig is at
  (0,0,0).

---

## 4. How to measure honestly here — read this before trusting any number

This environment will lie to you convincingly. The guide's §3.1 and §7 are the
long version; the short version:

- **The Claude preview pane's rAF is unreliable and varies within a session** —
  measured at 120 fps early in one session and 0.2 fps an hour later, with
  `scene.time` frozen at 0. In the most recent session, loading the full
  `/vr/index.html` **wedged the tab entirely**: `preview_eval`,
  `preview_snapshot` and `preview_screenshot` all timed out, repeatedly, while
  the flat site was fine. `preview_console_logs` and `preview_network` are the
  only channels that survive that.
- **So the pattern that works is a self-reporting harness**: a lean page that
  loads only what is under test, runs its own assertions on load, and
  `console.log`s PASS/FAIL. `vr/_dev-reader.html` and `vr/_dev-gate.html` are
  worked examples (§5). Use `MessageChannel` for any waiting — it is not
  throttled in a backgrounded tab, where `setTimeout` is clamped to ~1 s and
  turns a 20-step test into a 20-second one.
- **There is no node, deno or bun on this machine.** Use JavaScriptCore via
  `osascript -l JavaScript` for syntax checks *and* real unit tests — the
  components are plain IIFEs, so you can load one with stubs and drive it. The
  pinned CDN libraries load in it too; §3.14's diagnosis was proved by loading
  the real `gsap.min.js` with no rAF at all. **Extract the real functions and
  constants out of the shipped file (regex them out and eval them) rather than
  re-deriving the formulas in the test** — otherwise the test drifts from the
  code and passes for the wrong reason.
- **A passing screenshot is not evidence the loop is running.** `renderer.render()`
  called by hand produces normal-looking images with every tick frozen.
- **`?reducedMotion=1`** makes most transitions take their synchronous path, which
  is how most of §9 was verified. Note it therefore does **not** exercise GSAP.
- **The device is the only real test for anything in-headset.** `?xrdiag=1`
  (§3.16) is the instrument — there is no console in a Vision Pro, so it prints
  its numbers on a card in the scene. Anything you cannot verify on hardware, say
  so plainly rather than claiming it works. **Ask Sebastian to run specific
  checks**; do not assume you will get a headset.

For performance specifically, prefer counters over impressions:
`renderer.info.render.calls` / `.triangles`, `renderer.info.memory.geometries` /
`.textures`, `renderer.info.programs.length`, `performance.getEntriesByType('resource')`
for arrival weight, and `performance.measure` around suspect blocks. The §9.16
baselines are in the guide to compare against.

---

## 5. Constraints — not negotiable

- **No build step.** Plain files, CDN, pinned versions, `var`-style ES5. No npm,
  no bundler, no modules, no transpile. This is absolute and it is the reason
  several otherwise-obvious refactors are off the table.
- **Bump the `?v=` query on every edited component in BOTH `vr/index.html` and
  `vr/_dev-preview.html`.** Cache-bust the page URL too when reloading.
- **Don't touch the flat site.** The one sanctioned touchpoint outside `/vr` is
  the nav entry in `index.html`.
- **Audio stays off at the source** (`window.VR_AUDIO = false`) and never let test
  audio play — mute at the graph level before doing anything.
- **Respect `prefers-reduced-motion` and `a11yMode`.** Reduced motion must mean
  "arrives in final state instantly", not "broken".
- **`main` is the live site.** Do not commit or push without Sebastian asking.
- **Generated assets ship, their generators don't.** `.tools/` is gitignored;
  `vr/assets/tex` and `vr/assets/pages` are tracked. That is the convention, not
  an oversight.

---

## 6. Scope discipline — the failure mode for a brief like this

The obvious way to do this badly is to produce a 60-item list of small,
unverified, mostly-cosmetic changes, touch thirty files, and ship a regression.
Guard against it:

- **Prove it before you fix it.** A finding without a measurement or a reachable
  failure case is a hypothesis, and it goes in the report as one.
- **Fix causes, not instances.** §9.18 replaced ten symptom-fixes with one clock
  fix. If you find yourself making the same edit in six files, the edit is wrong.
- **Leave working code alone.** "This would be cleaner as X" is not a reason.
  Structural changes need a bug they prevent or a measured win.
- **Batch by risk, not by topic.** Do the provable, contained, high-value things
  first and verify each; propose the invasive ones and stop.
- **Ask rather than guess** on anything that changes what a visitor sees, and on
  the §3.9 items marked as Sebastian's call. He has said explicitly: stop and ask
  when stuck or when a detail is eating time, rather than grinding.

---

## 7. What good output looks like

1. **A findings table**, ordered by (impact × confidence), each row marked
   **verified-on-device / verified-in-browser / verified-numerically /
   unverified**, with the measurement next to it. Dismissals are findings too —
   "counted 61 allocations against 15 disposes, audited all of them, 3 are real"
   is a better result than a refactor.
2. **The fixes, smallest-cause-first**, each with a before/after number where a
   number is possible.
3. **The before/after on §2's axes**: arrival bytes, held texture, draw calls,
   frame time, and the memory counters after 20 open/close cycles of each overlay.
4. **An explicit "not done, and why" list** — including anything you judged not
   worth the risk. This is as valuable as the fixes.
5. **Notes folded into `VR_AI_BUILD_GUIDE.md`** as a new §9.x, plus a new §3.x for
   any new silent-failure trap. That document is the reason this codebase is
   tractable; keep paying into it.
6. **The questions you need Sebastian to answer**, collected in one place at the
   end rather than scattered.

The single most valuable thing you can produce is a defensible answer to:
**where does this scene actually spend its bytes, its memory and its
milliseconds — and which of the things that look wrong in it are genuinely
wrong?**
