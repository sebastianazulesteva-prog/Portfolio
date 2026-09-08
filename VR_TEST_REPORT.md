# /vr — Test Report

> **Written as a hand-off.** Each finding is self-contained: severity, exact
> location, how to reproduce, the evidence, and a fix direction. Another AI
> should be able to act on any entry without this conversation.
>
> **Procedure:** see [`VR_TEST_PROTOCOL.md`](VR_TEST_PROTOCOL.md).
> **No production code was modified.** Two dev-only harnesses were added
> (`vr/_dev-xr-input.js`, `vr/_dev-testplan.js`).

**Test build:** A-Frame 1.5.0 / three r158 · viewport 800×450 (aspect 1.78,
horizontal FOV 112.3°, matching `portrait-layout.js`'s own desktop figure) ·
20 hub panels · 71 clickables · render loop verified live (61 frames/500 ms).

**Status:** sweep in progress. Covered: step 0 baseline, analytic geometry pass,
home/arrival composition, HUD overlay layer, controller `reach()` pass across all
71 clickables from 3 ray origins and 3 hand poses, photo-cloud rendering.
Also covered: seam/position sweep, projects + experience clusters, PDF reader,
project rooms (enter and exit), reduced-motion audit across all 13 components,
a11yMode A/B, dependency audit.
Still outstanding: mobile/iPhone fallback (deferred to last by request), and the
Vision Pro gap, which needs hardware.

---

## Fixed since this report was written

Applied and re-verified live in the preview (viewport 800x450, forced synchronous
render; `document.hidden` was true throughout, so every check below is a geometry,
DOM or pixel-readback measurement, never a timing claim).

| Finding | What changed | Verification |
|---|---|---|
| **G1** | Deleted the `rotateY(Math.PI)` in `photo-cloud.js`; comment now records why `lookAt` alone is right and why `DoubleSide` is not the fix. | 34/34 tiles face the viewer. Mean screen luminance at yaw 180: **0.0495 → 0.1165** (A/B'd by re-applying the flip at runtime and undoing it). All 34 tiles now raycast-hit from the eye point, so captions/reach are live. |
| **G2** | `vr-mode-ui` → `xr-mode-ui="enabled: false; enterAREnabled: false"` on `<a-scene>` (and in `_dev-preview.html`). The scene's own `#enterVrBtn` was already fully wired in `fallback.js`, so nothing else was needed. | `scene.components['xr-mode-ui']` now parses; `.a-enter-vr-button` and `.a-enter-ar-button` are both absent from the DOM, so nothing overlays ♪. |
| **G5** | `carousel-drag=""` with a comment pointing at `onColStep`; the stale `snapDeg: 26.58` literal is gone. | Runtime `snapDeg` still `33.1177`. |
| **G6** | Removed both hardcoded light constants. `glass-material.js`'s `vr-key-light` system now snapshots each `.key-light` fixture's authored colour+intensity on first `syncRack()` and exposes `VRGlass.restoreKeyRack()`, which restores all four per-fixture and clears the mirror's cached colour; `project-room.js` snapshots the ambient the same way. | Enter a themed room → rack reads `#f7f5f0` across all four; exit → `#ffc98a @1.5 / #ffe0bb @1.7 / #ffe0bb @1.7 / #ffc98a @1.5` and ambient `#2a2018 @0.5`, i.e. exactly as authored. |
| **G8** | Root cause was not overshoot-then-lock but a **stable 2-cycle**: 0.862 fits with 40 mm spare → damped grow → 0.882 overflows 31 mm → damped shrink → 0.862, forever. The loop now brackets (`lo` = largest fitting scale, `hi` = smallest overflowing) and bisects once both are known, stops when a step would move <0.5%, and settles on the best *measured* candidate (fitting beats overflowing; larger type breaks ties). | a11y mode: 16 rounds ending on 31 mm of overflow at 0.882 → **5 rounds ending at 0.8685 with no overflow warning at all**. The repeated identical warnings are gone (they were the oscillation, not a re-triggered reflow). |
| **G9** | Dropped the `super-hands` and `aframe-extras` script tags, the `super-hands` attribute on both hands, and the `delete AFRAME.components.grabbable` shim that only existed for super-hands' name collision. Also removed the unread `window.VR_REDUCED_MOTION`. | No console errors; `AFRAME.components['super-hands']` and `['movement-controls']` are gone, A-Frame's own `grabbable` is intact, scene still builds and renders. |
| **`reticle.js:97`** | Dead `reducedMotion ? HOVER_OUTER : HOVER_OUTER` ternary replaced with the constant + a comment naming where reduced motion IS handled. | — |
| **Dev affordance** | `?reducedMotion=1|0` now wraps `matchMedia` before any component loads, so all 13 module-scope reads see it. Non-motion queries are handed the real `MediaQueryList` untouched. | `matchMedia('(prefers-reduced-motion: reduce)').matches === true` under `?reducedMotion=1`, with `addEventListener`/`addListener` still present; `(max-width: 600px)` still returns a native MQL. |

### Second pass — the judgement calls, after Sebastian's decisions

| Finding | Decision & what changed | Verification |
|---|---|---|
| **G3** | **4 columns × 3 rows** (his call). Also split the column gap from the row gap: `layoutCluster` takes a new `colGapM`, and projects pass `gapM: 0.42, colGapM: 0.14`. The 0.42 was only ever needed vertically (caption above + button below); feeding it into the column chord is what made a 4th column cost 33°/column. The zone is offset +4° so the extra width goes outward, not toward home. | Vertical span **0.06–2.98 m → 0.36–2.65 m**; head pitch **73° → 60°**. Yaw span 38.9°–105.1° → 34.8°–113°, and the *inner* edge is unchanged, so the arrival view is as it was. `snapDeg` re-derives to 24.83 (was 33.12) automatically via `onColStep`. |
| **G7** | **Scale the cards with the type** (his call). New `VRType.cardMult()` (= the a11y type multiplier, 1.25) applied to both clusters' `cardWidth`/`cardHeight` and to the bio card's width/height + anchor. Gaps deliberately not scaled. Clusters offset outward by half their a11y widening so inner edges hold. | a11y bio-card fitter: **0.882 (shrinking the bump away, ~+4% net) → 1.088 (adding to it, ~+28% net)**. All 10 experience cards fit in both modes. |
| **G7 (b)** | The one overflowing experience card turned out to be worse than reported: in *normal* mode the subtitle had been shrunk to **0.0034 m** — 3.4 mm tall — by eight consecutive 0.72× steps, because the 4-line company name was allowed to eat the whole card and the subtitle was the only thing that could give. `hub-panel`'s text-only branch now gives the TITLE a height budget, shrinks it first, floors the subtitle at a legible size, waits for measured height to *change* at each step (§3.2), and warns instead of rendering illegible type. | Comparative Medicine: title 0.052 → 0.0447, subtitle **0.0034 → 0.0273**, fits. All 10 cards fit in both modes, every subtitle ≥ 0.0211 m. |
| **G8 (residual)** | Not an accounting mismatch — instrumented both totals and they agree to 0.0001 m. The real fault was `afterResize()` waiting only on the *heading*'s height: the heading re-lays out first, so the next round measured paragraphs troika hadn't re-wrapped, and `contentHeight` moved 0.0089 → 0.0090 m across a 6.5% type change. It now waits on the whole content height. | The bio card converges with **no overflow warning at all** in either mode. The estimated-pass warning (which fired every load) is suppressed — it reported guesses, not measurements. |
| **A4** | Capped the fitter's growth at **1.12** (was 1.6) and centre the block in leftover space. With the loop fixed, the fitter was filling the card at 1.34× — making the bio card's *body* type larger than every other card's *title*, i.e. breaching the 3-size scale. Body copy opacity 0.82 → 0.9 and 0.78 → 0.88. | Body 0.0314 m / title 0.0582 m — back inside the scale. No overflow. |
| **A5** | Hint moved from `bottom: 5.25rem` to `1.4rem`, narrowed 34rem → 26rem, quieter fill, and the copy cut to one short line; the VR clause is now appended by `hud.js` only where WebXR actually exists (it was promised to everyone, including all of iOS). | Overlap with the bio card **20.1% → 3.2%**, one line instead of two. |
| **A3** | Checked as asked — sunflower **does** track the camera, on every panel including the inner column. Moved the viewer right + forward + into a crouch: mis-aim 30.7° max, and within 3 s of frames every one of the 21 panels was back inside the 0.4° deadzone. So the trapezoid look is wide-FOV perspective on a flat 112° frame, not a mis-aim — expect it to read differently in a headset. | mis-aim max/mean 30.70/21.51 → **0.39/0.25** after settling. |
| **♪ / SFX coupling** | Decoupled. `VRSound.enabled` now turns on at the first user gesture (the autoplay unlock) instead of when the birdsong starts, so a visitor who never touches ♪ still gets hover/select cues. An explicit ♪-off still silences them; the ambience is still muted by default. | — |
| **Room contrast** | Room text carries a dark halo (troika `outlineWidth: 8%`), tags and gallery captions go to full opacity, and the Return button becomes a solid plate with a **light** label. Worth recording *why* dark-on-solid failed: ui-button's solid default is near-black text, which measures 9.15:1 in the hub only because the key rack runs at 1.5 there; a room retints that key to 0.22, the plate falls to ~0.08 luminance, and the same button collapses to 2.1:1. | Pendant theme (sky #3a3a38 over a #f7f6f3 floor), sampled at pitch −15/0/+15 and yaw −55: tags **3.45 → 5.9–6.6**, Return **3.55 → 9.4**, gallery captions **3.9 → 10.4–14.9**. |

Not acted on, by choice: **A1** (hero title elevation), **A2** (left-heavy arrival), **A6** (repeated per-tile buttons), **G4** (experience top row at 2.2 m), **M1/M2** (phone-specific taste).

### Superseded: audio is now off at the source

The ♪/SFX decoupling above still stands in code, but **all sound is disabled by
default** as of this pass (`window.VR_AUDIO` in `index.html`, `?audio=1` to
re-enable). While it's off the clip is never fetched, the cues can't fire, and ♪
is removed from the HUD — so G2's "no visitor can enable UI sound" consequence
is moot for now, and any future audio finding should be re-tested under
`?audio=1`.

### Real-device testing is now one command

`./.tools/vr-phone.sh` serves the repo over HTTPS on the LAN with a QR to scan;
`--tunnel` falls back to a public cloudflared URL for networks that isolate
clients. HTTPS is required for iOS's DeviceOrientation permission, i.e. for
tilt-to-look — over plain http that path is silently dead, which would have made
any "gyro doesn't work on iPhone" finding a false positive. This closes the
tooling gap behind this report's **NEEDS-DEVICE** items (real iPhone / iOS
Safari); the Vision Pro gap still needs the hardware.

Docs touched: this file, and `VR_AI_BUILD_GUIDE.md` (pin list, URL flags, ♪ note, a11y card scaling).

**One residual worth knowing:** in normal mode the fitter grows past a layout
that `layout()` already reports as overflowing by 9 mm (1.000 → 1.065, same
9 mm both times). That is `contentHeight()` and `layout()`'s overflow figure
disagreeing by a near-constant ~9 mm, not the loop misbehaving — the two walk
the same blocks and gaps but arrive at different totals. Unfixed; it wants the
two accountings collapsed into one function.

---

## Severity key

| | |
|---|---|
| **High** | Breaks a feature, or blocks a documented interaction |
| **Medium** | Wrong or uncomfortable, but the scene still works |
| **Low** | Cosmetic, or correct-but-misleading code |
| **NEEDS-HEADSET** | Cannot be settled without real stereo/6DoF hardware |

---

---

# ⚑ Beta pre-push pass (crash / dead-end focused)

Re-run against current disk after your in-session fixes. Scope: uncaught errors,
dead ends, re-entrancy, state corruption — not aesthetics.

## Already fixed by you since the first pass — verified

| | Status |
|---|---|
| **G1** Photo Cloud invisible | ✅ **Fixed.** `rotateY(Math.PI)` removed (`photo-cloud.js?v=10`), with a comment recording the cause and the DoubleSide anti-fix. |
| **G2** Enter-VR button burying ♪ | ✅ **Fixed.** `xr-mode-ui="enabled: false; enterAREnabled: false"` now attaches and parses; `.a-enter-vr-button` is absent. The ♪ button was removed entirely, so the SFX-gating chain is moot. |
| **G6** Room visit corrupting hub lights | ✅ **Fixed.** `KEY_BASE` is gone; `resetLights()` now calls `VRGlass.restoreKeyRack()`, restoring colour *and* intensity across all four `.key-light` fixtures from authored values. |
| **G3** Projects grid vertical span | ⬆️ **Much better.** Splitting writing into its own cluster drops projects to 5 cards: y 0.96–2.61 m, **−17.9° to +26.7°** (was −38° to +35°). See B3 — the problem moved rather than vanished. |

## B1 · **BETA BLOCKER** · The writing cluster is never hidden, so it floats inside every room and the reading space

**Where:** `vr/index.html:372` defines a fifth cluster —
`<a-entity id="writingConstellation">` — and neither hub-hiding list knows about it:

```js
// vr/components/project-room.js:28
var hubSelectors = ['#homeCluster', '#bioCard', '#projectsConstellation', '#experienceConstellation', '#photoCloud'];
// vr/components/pdf-reader.js:99
var hubSelectors = ['#homeCluster', '#bioCard', '#projectsConstellation',
                    '#experienceConstellation', '#photoCloud', '#focusStage'];
```

**Verified at runtime.** Entering "Graduation Pendant": all five listed clusters
go `visible: false`, and `#writingConstellation` stays `visible: true` with **all
5 cards**. Screenshot captured: HP's Reckoning, Algorithmic Modeling, 3D-Printed
Glasses Frames, Social Engineering via Predictive Algorithms and Apple's Medical
Licensure all hang inside the white pendant room, overlapping the room's own
image card, each with live "Read the piece" and "⧉ Link" buttons.

**It is worse than cosmetic, because they stay interactive.** The stray cards are
in the cursor raycaster's target list (82 targets) and a real camera ray hits
them. So a visitor standing in a project room can click "Read the piece" and open
the PDF reader **on top of the still-open room** — confirmed: `room: true`,
`reader: true`, scene children 22. That is a genuinely confusing state to land a
beta user in.

Same omission applies to the PDF reader: open a piece and the other four writing
cards remain floating in the reading space.

**Fix direction.** Add `'#writingConstellation'` to both arrays. Better: derive
the list once (e.g. a `.hub-cluster` class on each cluster entity, or a single
shared constant) so a sixth cluster can't silently repeat this — the two arrays
have already drifted from each other (`pdf-reader` has `#focusStage`,
`project-room` doesn't).

Note `focus-stage.js:176` does **not** have this bug — it dims via a global
`querySelectorAll('[hub-panel]')`, so it covers writing cards correctly. Only the
two room/reader lists are hardcoded.

## B2 · Medium · Uncaught `ReferenceError` on the first click of every session

**Where:** `vr/components/hud.js:157`

```js
if (nudge) nudge.classList.add('dismissed');
```

`nudge` is **never declared**. The landscape nudge element was removed from both
`vr/index.html:441` and `vr/vr.css:206` (both now carry only a comment about the
removal), and `hud.js:210` acknowledges it — but this reference survived.
Referencing an undeclared identifier throws, so:

```
Uncaught ReferenceError: nudge is not defined    hud.js?v=10:157
```

**Verified on a clean load:** fires on the *first* user gesture, every session.
(It looked intermittent at first only because `firstGestureDone` had already been
set by an earlier gesture in that page load.)

**Impact is contained but not zero.** Lines 154–156 run first, so audio
unlocking and the hint fade still work. What is skipped is the
`removeEventListener` cleanup immediately after, so four capture-phase window
listeners leak for the session — bounded, since the `firstGestureDone` guard
makes each a no-op. The real cost is an uncaught error in the console on the
first click of a public beta. **One-line fix: delete line 157.**

## B3 · Medium · The vertical-span problem moved to the writing column

Measured at eye 1.6 m, 2 m radius:

| Cluster | Cards | y range | Elevation |
|---|---|---|---|
| Experience | 10 | 0.91 – 2.22 m | −19.1° … +17.1° ✅ comfortable |
| Projects | 5 | 0.96 – 2.61 m | −17.9° … **+26.7°** |
| **Writing** | 5 | **0.35** – 2.48 m | **−31.9° … +23.8°** |

The writing pieces are now a single vertical column of 5 at yaw +43.5°, so they
stack rather than spread. Bottom card's lower edge sits at **0.35 m** — below
knee height — needing a 32° look-down; total scan 56°. This is the same
constraint as the old G3, relocated. Two columns of 2–3 would halve it.

## Checked and clean — no crash or dead-end found

State transitions are genuinely robust. All verified with no errors and no
scene-graph growth:

- **You can always get out.** Rooms expose "Back to the dome"; the reader exposes
  its own back button; the HUD keeps ⌖ recenter. No state was reachable with no exit.
- **Double-exit on a detached button** — no-op, no throw (`project-room.js`'s
  null-safe guard works).
- **Double-enter the same room** — exactly one `#projectRoom` entity.
- **Room A → Room B without exiting** — still one room entity, 21 scene children,
  no leak.
- **Reader open → close → reopen** — scene children 20 → 21 → 20 → 21; clean
  teardown, 7 pages re-resolved.
- **Double-open the reader** — one root, no duplication.
- **No failed network requests** on load; all seven module globals present
  (`VRData`, `VRFocusStage`, `VRProjectRoom`, `VRPdfReader`, `VRHud`, `VRSfx`,
  `VRThemes`).
- **No unhandled promise rejections** across every flow exercised.
- **New `#onboardGate`** (beta modal) behaves: z-index 40, blocks the canvas while
  up, removes itself from the DOM on "Enter the dome", does not trap.

Total uncaught errors across the whole pass: **1** (B2).

---

# Glitches

## G1 · High · The entire Photo Cloud is invisible — one stray line turns all 34 photos away from the viewer

**Where:** `vr/components/photo-cloud.js:69-72`

```js
// Face the viewer at the origin: lookAt then flip, since a plane's
// front (+z) otherwise points away from a lookAt target.
tileEl.object3D.lookAt(0, height, 0);
tileEl.object3D.rotateY(Math.PI);          // <-- this line is the bug
```

**What's wrong.** The comment's premise is false. `THREE.Object3D.lookAt()`
**swaps its arguments for non-camera objects**:

```js
if (this.isCamera || this.isLight) m1.lookAt(_position, _target, this.up);
else                               m1.lookAt(_target, _position, this.up);
```

So for a plain `Object3D` holding a `PlaneGeometry`, `lookAt` already points the
plane's front (+Z) **toward** the target. The corrective `rotateY(Math.PI)` then
turns every photo around to face the dome wall instead of the visitor.

Measured on 5 tiles spread through the cloud, dot product of the plane normal
with the direction to the viewer (+1 = faces viewer, −1 = faces away):

| Tile | `lookAt` only | `lookAt` + `rotateY(π)` | Live scene |
|---|---|---|---|
| 0 | **+1** | −1 | **−1** |
| 1 | **+1** | −1 | **−1** |
| 2 | **+1** | −1 | **−1** |
| 17 | **+1** | −1 | **−1** |
| 33 | **+1** | −1 | **−1** |

All **34/34** tiles face away. Random orientation would give roughly 50/50, and
the live scene matches `lookAt + flip` exactly — so this is the flip, not drift,
and nothing is overwriting it at runtime.

**Why it's invisible.** `VRGlass.makeFeatheredImage` produces a `ShaderMaterial`
with the default `side: THREE.FrontSide`. A front-facing-away plane is
backface-culled, so **nothing draws at all**. Turn to yaw 180 in the shipped
build and the Photo Cloud zone is an empty dome — 25 of 34 tiles are inside the
camera frustum and not one is visible.

**Second symptom, same cause.** three.js raycasting also honours
`material.side`, so backfaces are not hit. All 34 photo-cloud tiles carry
`class="clickable"` and **none of them can be clicked** — `reach()` reports every
one as unreachable from all three ray origins (gaze, left hand, right hand). So
the hover captions and the reach-to-focus interaction on the cloud are dead too.

This means `VR_BUILD_SPEC.md` §9's signature feature — "every site image as a
drifting constellation behind the viewer" — currently renders and does nothing.

**Reproduce.**
```js
// count tiles whose front faces the viewer -> 0
Array.prototype.slice.call(document.querySelector('#photoCloud').children)
  .filter(function (el) {
    var p = el.object3D.position, n = new THREE.Vector3(0,0,1)
      .applyQuaternion(el.object3D.getWorldQuaternion(new THREE.Quaternion()));
    return n.dot(new THREE.Vector3(0,p.y,0).sub(p).normalize()) > 0;
  }).length;
```

**Fix direction.** **Delete line 72** and correct the comment above it —
`lookAt` alone is right here. Do *not* "fix" this by setting
`side: THREE.DoubleSide`: that makes the photos visible but **mirrored**, because
you would be looking at the back of each plane.

**Verified both ways at runtime.** Setting `DoubleSide` made the cloud appear
mirrored; re-running `lookAt` without the flip while restoring `FrontSide` made
all **34/34** tiles face the viewer and the cloud render correctly and
unmirrored. Screenshots of both states were captured during the session.

---

## G2 · High · `vr-mode-ui` is not a real component; its Enter-VR button buries the ♪ control

**Where:** `vr/index.html:118`

```html
<a-scene vr-mode-ui="enabled: false" renderer="colorManagement: true" ...>
```

**What's wrong.** In A-Frame 1.5.0 there is no `vr-mode-ui` component —
`AFRAME.components['vr-mode-ui']` is `false`. The component is named
**`xr-mode-ui`**. Confirmed at runtime: the scene's attached components are
`background, device-orientation-permission-ui, inspector, keyboard-shortcuts,
screenshot, xr-mode-ui` — and `scene.getAttribute('vr-mode-ui')` returns the raw
string `"enabled: false"` instead of parsed data, which only happens when a
component never attached.

So the attribute is a **silent no-op**. `xr-mode-ui` then runs with its schema
defaults (`enabled: true`) and injects `.a-enter-vr` + `.a-enter-vr-button` at
**`z-index: 9999`**, positioned `bottom: 0; right: 0`.

**The consequence, measured.** That button lands directly on top of the ♪
ambient-sound toggle:

| Element | Rect | z-index |
|---|---|---|
| `.a-enter-vr-button` | x 722–780, y 396–430 | **9999** |
| `#muteBtn` | x 736–780, y 386–430 | `auto` |

Grid-sampling `document.elementFromPoint` across `#muteBtn`: **only 13% of it is
hittable.** 80 of 100 sample points return `.a-enter-vr-button`. The button's
centre hits the VR button, not the mute control.

**Why this is High and not cosmetic.** `VR_AI_BUILD_GUIDE.md` §6 already records
that hover/select SFX are gated behind `VRSound.enabled`, which only flips on
when the visitor turns on the birdsong ambience via ♪. Since ♪ is effectively
unclickable, **no visitor can ever enable UI sound.** A suspected design coupling
becomes a hard functional blocker. It is also a minimum-target-size regression on
a control the scene otherwise enforces sizes for.

Secondary: the project's own custom `#enterVrBtn` (`vr/index.html:274`, styled at
`vr/vr.css:73`) is `display: none` and unused, so the *unstyled A-Frame default*
is the VR entry point the visitor actually sees.

**Reproduce.**
```js
document.elementFromPoint(758, 408)   // -> .a-enter-vr-button, not #muteBtn
document.querySelector('a-scene').components['vr-mode-ui']   // -> undefined
```

**Fix direction.** Rename the attribute to `xr-mode-ui`. The schema is
`{enabled, XRMode, enterVRButton, enterVREnabled, enterARButton, enterAREnabled,
cardboardModeEnabled}`. Two options:

- `xr-mode-ui="enabled: false"` and wire up the existing `#enterVrBtn`, or
- `xr-mode-ui="enterVRButton: #enterVrBtn; enterAREnabled: false"` to adopt the
  custom button directly. Set `enterAREnabled: false` either way to honour the
  standing "no AR" rule — it currently defaults to `true`.

**Verified:** setting `xr-mode-ui="enabled: false"` at runtime removed the button
and raised `#muteBtn` hittability from **13% → 88%**. (The residual 12% is the
`.hud-controls` flex container at the button's outer edge — harmless.)

---

## G3 · Medium · Projects grid runs from the floor to well overhead

**Where:** `vr/index.html` projects `layoutCluster` call — `cardHeight: 0.5`,
`gapM: 0.42`, `centerHeight: 1.5`, `columns: 3`, `CONSTELLATION_RADIUS = 2.0`

**What's wrong.** `rowStepM = cardHeight + gapM = 0.92 m`. The scraper returns
**10 projects across 3 columns = 4 rows**, so the rows land at 2.90 / 2.00 /
1.00 / 0.10 m around `centerHeight 1.5`. Measured world bounding boxes from the
default eye point (0, 1.6, 0):

| Card | World Y | Distance | Elevation span |
|---|---|---|---|
| Bastón (top row) | 2.31 – **2.98** | 1.97 m | +19.9° … **+35.0°** |
| The Slip Door | 2.31 – 2.97 | 2.00 m | +19.5° … +34.4° |
| Graduation Pendant | 2.30 – 2.96 | 1.98 m | +19.3° … +34.4° |
| Apple's Medical Licensure (bottom) | **0.06** – 0.36 | 1.97 m | −38.0° … −32.1° |

The cluster spans **y = 0.06 m to 2.98 m** — 2.92 m of vertical extent requiring
**−38° to +35°, i.e. 73° of head pitch**, to read. The top row's upper edge sits
1.38 m above eye height; the bottom row's lower edge is 6 cm off the floor.

`VR_BUILD_SPEC.md` §2 states nothing should live overhead or underfoot, and a
comfortable seated viewing cone is roughly ±20°. Three of four rows breach that.

**The tension worth naming.** `gapM` was deliberately raised 0.2 → 0.42 to clear
the floating caption plus the "Enter the project room" button (~0.31 m of extra
footprint) after captions were colliding with the row above. That fix was correct
and bought this vertical span as its cost. The two constraints are now in direct
conflict at 4 rows: you cannot have a 0.92 m row step, 4 rows, and stay inside a
comfortable cone.

**Fix directions** (each has a real trade-off, so this is a judgement call):
- **More columns, fewer rows.** 4 columns × 3 rows drops the span to 1.84 m.
  Costs angular width — at 33.1°/column, 4 columns spans 99°, pushing the outer
  column to ~121° yaw and further into the photo-cloud's territory.
- **Shrink the caption/button footprint** so `gapM` can come back down, e.g. move
  "Enter the project room" into the focus stage only (it already lives there) and
  keep the grid tile to image + title.
- **Paginate/carousel vertically** — `carousel-drag` already handles horizontal
  rotation; a row offset would keep 3 rows visible at a time.
- **Raise `CONSTELLATION_RADIUS`** — reduces elevation angles for the same
  heights, but the standing note is to keep content close, so this fights the
  command-zone concept.

**Reproduce.**
```js
VRTestPlan.ergonomics()              // 14 flags
VRTestPlan.ergonomics({eyeY:1.05})   // worse for a short visitor
VRTestPlan.inventory().projectsRows  // 4
```

---

## G4 · Low · Experience cluster's top row sits just above standing eye height

**Where:** experience `layoutCluster` — `cardHeight: 0.34`, `gapM: 0.14`,
`centerHeight: 1.55`, `columns: 4`

Top-row cards (Maker Nexus, Stanford Comparative Medicine, VHIL, ExploreTech)
have upper edges at **2.20–2.22 m**. Unlike G3 this is mild: elevation is only
+12.5°, comfortably inside the viewing cone. Flagged for completeness because it
crosses the same 2.0 m threshold, not because it reads badly. **Lower priority
than G3 by a wide margin.**

---

## G5 · Low · Stale `snapDeg` literal in markup is dead but misleading

**Where:** `vr/index.html:258`

```html
<a-entity id="projectsConstellation" carousel-drag="snapDeg: 26.58">
```

The literal `26.58` no longer matches the derived column step of **33.12°**.
`onColStep` does correctly overwrite it at build time — verified live:
`carousel-drag.data.snapDeg === 33.1177`, matching the chord formula to 4
decimals. **So this is not a bug.** But the markup still advertises a wrong
number, which is exactly the drift the surrounding comment warns about. Consider
`carousel-drag=""` with a comment pointing at `onColStep`, so nobody trusts the
literal.

---

## G6 · Medium · Visiting a project room permanently corrupts the hub's light rack

**Where:** `vr/components/project-room.js:33` and `:97-102`

```js
var KEY_BASE = { color: '#e0a878', intensity: 0.15 };   // :33
...
function resetLights() {                                  // :97
  var ambient = document.querySelector('#ambientLight');
  var key = document.querySelector('#keyLight');
  if (ambient) ambient.setAttribute('light', AMBIENT_BASE);
  if (key) key.setAttribute('light', KEY_BASE);
}
```

`KEY_BASE` is meant to mirror the authored hub lighting — the comment above it
says "must match the `<a-light>` defaults". **It doesn't.** `vr/index.html:157`
authors `#keyLight` as `color="#ffc98a" intensity="1.5"`; `KEY_BASE` restores
`#e0a878` at `0.15`. That is **10× too dim** plus a colour shift, applied every
time a visitor leaves a room.

Measured, entering "Graduation Pendant" and clicking its own Return button:

| Light | Authored (`index.html:157-160`) | After room exit |
|---|---|---|
| `keyLight` | `#ffc98a` @ **1.5** | `#e0a878` @ **0.15** |
| `keyLight2` | `#ffe0bb` @ 1.7 | `#e0a878` @ 1.7 |
| `keyLight3` | `#ffe0bb` @ 1.7 | `#e0a878` @ 1.7 |
| `keyLight4` | `#ffc98a` @ 1.5 | `#e0a878` @ 1.5 |

Two separate defects are visible in that table:

1. **Intensity is never restored correctly** — `#keyLight` lands at 0.15 instead
   of 1.5, and stays there for the rest of the session.
2. **`resetLights()` only touches `#keyLight`**, but all four fixtures get
   recoloured to `KEY_BASE`'s colour somewhere in the enter path. So
   `keyLight2/3/4` keep the room's colour permanently — nothing ever restores
   the authored `#ffe0bb` / `#ffc98a`.

**Impact, measured rather than assumed.** The scene's glass shader has its own
uniform rack (`VRGlass.setLights`), so not every surface consumes these
`<a-light>` entities. Comparing mean screen luminance at the same camera, with
only the light rack differing:

| Panel | After room visit | With authored lights | Delta |
|---|---|---|---|
| `#bioCard` | 0.0241 | 0.0281 | **16.6% brighter when restored** |
| `#homePortrait` | 0.4398 | 0.4398 | 0% (mosaic shader ignores the rack) |

So it is a real ~17% dimming of the lit glass panels and text, not a
scene-wide blackout. Subtle per visit, permanent, and never reset.

**Fix direction.** Derive the reset values from the authored markup instead of a
hardcoded copy — read the four `.key-light` entities' attributes once at load
and restore those — and have `resetLights()` iterate all `.key-light` fixtures
rather than only `#keyLight`. That removes the class of bug rather than
re-syncing two numbers that already drifted once.

---

## G7 · Medium · a11y mode pushes text out of its cards, and the bio card's auto-fit cancels most of the accessibility gain

**Where:** `vr/components/fonts.js` (the a11y size bump), `vr/components/bio-card.js:415-421`,
and the experience `layoutCluster` call in `vr/index.html`

a11y mode raises every type size by **25%** but card geometry is fixed, so
content that fits in normal mode overflows. Measured in each card's own frame
(positive = text past the card edge):

| | Normal | a11y |
|---|---|---|
| type scale (body / title / label) | 0.028 / 0.052 / 0.022 | 0.035 / 0.065 / 0.0275 |
| "Stanford University – Comparative Medicine" card | **−42 mm** (fits) | **+18 mm (overflows)** |
| `#bioCard` reported overflow | 9 mm | **31 mm** |
| `#bioCard` auto-fit scale | 1.058 | **0.882** |

Two distinct problems:

**(a) One experience card overflows.** Experience cards are fixed at
0.5 × 0.34 m. The longest company name is the only one that breaks, by 18 mm —
a 60 mm swing versus normal mode. Everything else still has 44–103 mm of slack,
so this is one card, not a systemic failure.

**(b) The auto-fitter claws back the accessibility bump.** a11y raises body type
+25%, then the bio card's fitter shrinks it 11.8% to fit. Net effective gain on
that card is about **4%** — so the accessibility mode is close to a no-op
precisely where there is the most text to read.

**Fix direction.** a11y needs to scale the *cards*, not only the type — or the
bio card needs to allow vertical growth / scrolling so the fitter isn't forced
to undo the bump. For the experience card, either allow two lines for long
company names or shorten via the scraper.

---

## G8 · Medium · The bio card's auto-fit terminates while still overflowing, and re-runs repeatedly

**Where:** `vr/components/bio-card.js:415-421`

The card's own diagnostic fires in **both** modes. Normal mode:

```
[vr] bio-card: content overflows the card by 0.009 m at scale 1.000
[vr] bio-card: content overflows the card by 0.009 m at scale 1.065
```

a11y mode, which exposes the real behaviour:

```
overflows by 0.571 m at scale 1.000
overflows by 0.101 m at scale 0.900
overflows by 0.020 m at scale 0.874   <- best result found
overflows by 0.031 m at scale 0.882   <- corrected the WRONG WAY
overflows by 0.031 m at scale 0.882   (x6 more, identical)
```

It finds 0.874 with 20 mm overflow, corrects *upward* to 0.882, gets worse, and
locks there — then repeats the identical result six more times. This is exactly
the non-linearity `VR_AI_BUILD_GUIDE.md` §3.3 documents: wrapped text height is
not linear in font size, so a ratio-based correction overshoots. The loop's round
cap stops it, but it stops on a worse candidate than one it had already measured.

Two things to fix:
1. **Keep the best candidate seen**, rather than whatever the last round
   produced. A single-line "if this round is worse than the best so far, keep the
   best" would have shipped 20 mm instead of 31 mm.
2. **The repeated identical re-runs** suggest the reflow is triggered several
   times per load with no change of input. Each pass re-measures troika text,
   which is the expensive operation in this scene. Worth finding the trigger.

Note the warning is deliberate and well-judged — it is the reason this was
findable at all. The bug is what the loop settles on, not that it reports.

---

## G9 · Low · Two CDN libraries are loaded and never used

| Library | Status |
|---|---|
| `aframe-extras@7.2.0` (`vr/index.html:82`) | Registers 11 components (`movement-controls`, `checkpoint-controls`, `gamepad-controls`, `keyboard-controls`, `touch-controls`, `nav-mesh`, `animation-mixer`, `sphere-collider`, `grab`, `ocean`, `tube`). **Zero are mounted on any entity.** Every textual match in `vr/` is inside a comment. |
| `super-hands@3.0.6` (`vr/index.html:81`) | Mounted on both hands (`index.html:205-206`), but super-hands only acts on targets carrying its companion components (`hoverable`, `grabbable`, `stretchable`, `draggable`) — **none are mounted anywhere**, so it is inert. `index.html:172` already describes it as "grab-readiness", i.e. speculative. |

Also dead: `window.VR_REDUCED_MOTION` is written at `vr/components/fallback.js:74`
and **read by nothing**.

I could not measure the payload cost — these are cross-origin and their
Resource Timing `transferSize` reads 0 — so no size claim here. They are unused
regardless. Removing them also removes the component-name collision risk that
`index.html:74-78`'s comment is already working around.

---

# Aesthetics

Subjective calls are marked **[taste]** — overrule freely.

## A1 · The hero title sits above the natural sightline

`name-scatter-3d` is at `homeCluster`-local `0 2.42 0` → world centre y = 2.37,
box 1.67 × 0.49 m, top edge 2.61 m. From the default eye point that is an
elevation span of **+19.6° to +34.4°**, centre +27.5°.

With an 80° vertical FOV it *is* in frame — it reads as a header and, honestly,
it looks good in the arrival screenshot. But the visitor's name — the single most
important text in the scene — is entirely above the comfortable cone, so on a
level gaze it lands in the top strip of the view rather than on the sightline.
**[taste]** I'd bring it down toward ~1.95–2.05 m so its lower edge meets the
natural gaze while it still reads as a header above the portrait.
**NEEDS-HEADSET** to judge fairly: a headset's comfortable cone is tighter than a
112° desktop frame, so this likely reads worse in VR than in the screenshot.

## A2 · The arrival composition is left-heavy **[taste]**

At yaw 0 the projects cluster's inner column (yaw 28.7°–49.1°) falls inside the
±56° horizontal half-FOV, so four project cards intrude into the arrival view and
are clipped by the frame edge — while the right side shows only two experience
cards against a large empty field. The result is lopsided: dense, cropped clutter
on the left, air on the right.

Worth noting this is a *side effect of the seams being tight* rather than a
separate problem — the same geometry that makes the seam close (see the pending
seam sweep) is what pulls the projects column into the forward view.

## A3 · Inner-column project cards read as trapezoids **[taste]**

Cards at 28.7°–49.1° of yaw are seen far enough off-axis that perspective
foreshortening dominates: in the arrival screenshot "Time Collector" and the
pendant card are visibly skewed parallelograms rather than rectangles. Titles
stay legible, but the cards look like they're falling away from the viewer rather
than facing them. The `sunflower` component should be aiming these at the
viewer — worth checking whether it is actually running on the inner column, or
whether this is the residual after its rate limit.

## A4 · The bio card demands a 47° vertical scan, and its body copy is dense

`#bioCard` measures exactly its declared 1.05 × 1.46 m (verified) at 1.64 m,
spanning **−30.9° to +16.4°** of elevation — 47° of vertical travel to read one
card, with its top edge at 2.08 m. In the screenshot the body paragraph is a
dense block of small, low-contrast warm-grey on dark brown, with a smaller
two-column list beneath it.

**[taste]** The auto-fit logic is doing its job — the text fits — but "fits" and
"comfortable to read at 1.6 m in a headset" are different targets. Worth
re-checking the resulting point size against the 3-size type scale rather than
against available space.

## A5 · The onboarding hint covers a fifth of the bio card on arrival

`#onboardHint` is a DOM overlay at x 128–672, y 314–366. The bio card projects to
x 417–604, y 140–399. Overlap: **187 × 52 px = 20.1% of the bio card's on-screen
area**, sitting across its lower body text.

**Correctly scoped:** it *does* dismiss on the first `pointerdown` (verified —
removed from the DOM within 1.4 s of a synthetic pointer event), so this is not
the "hint never goes away" bug it first looked like. But the arrival state is
precisely when a visitor reads the bio, and the hint blocks a fifth of it until
they touch something. **[taste]** Either raise it clear of the card, or shorten
it to one line.

Also **[taste]**: as a full-width dark pill it reads as a browser notification
bar rather than part of the world — the only element in the arrival view that
doesn't belong to the dusk scene.

## A6 · "Enter the project room" repeats across simultaneously visible cards **[taste]**

Multiple project cards show their own "Enter the project room" button at once in
the arrival view. Since selecting a tile opens the focus stage (where the button
also lives), the per-tile buttons add repeated text to the periphery without
adding reach. Worth considering hover/focus-only.

---

# Mobile / phone fallback

Tested last, by request. **This is the strongest part of the build** — the
`portrait-layout.js` compensation works exactly as documented, and its own
measured FOV figures reproduce precisely:

| Viewport | Aspect | Horizontal FOV | `portrait-layout.js` claims |
|---|---|---|---|
| 800×450 desktop | 1.78 | **112.3°** | 112° ✓ |
| 375×812 phone portrait | 0.46 | **42.4°** | 42° ✓ |
| 812×375 phone landscape | 2.17 | **122.3°** | 122° ✓ |

**Portrait mode — all three compensations fire correctly:**

| | Portrait (375×812) | Landscape (812×375) |
|---|---|---|
| `#homePortrait` x | **0** (centred) | −0.5 (authored) |
| title scale | **0.6** | 1 |
| `#bioCard` visible | **false** | true |
| rotate nudge | shown | `display: none` |

The `resize` listener reverts everything cleanly on rotation — no stuck state.
The onboarding copy also correctly rewrites itself for touch ("**Tap** a panel to
open it — drag or **tilt** to look around…") and omits the VR clause. The
"Turn your phone sideways for the full view" nudge is a nice touch.

**♪ is reachable on mobile: 86.7% hittable**, versus 13% on desktop. So **G2 is a
desktop-only defect** — worth knowing before someone "fixes" it by moving the HUD
and breaks the mobile layout that currently works.

## M1 · Aesthetics · Phone landscape is the busiest arrival view in the build **[taste]**

At 122° horizontal, *both* constellations intrude into the home view at once —
clipped project cards down the left edge and clipped experience cards down the
right, plus a third partially-visible column entering from the right. It is
noticeably more cluttered than desktop's 112°. The wide-FOV case is the one the
composition was least tuned for.

## M2 · Aesthetics · The dome's horizon band bisects the portrait in phone portrait **[taste]**

At 42° horizontal the dusk gradient's horizon reads as a hard horizontal edge
that lands directly behind the portrait's chin, cutting the composition in two.
On the wider viewports the same band sits low and reads as a horizon; at this
narrow FOV it reads as a seam. Also ~210 px of dead space sits between the
tagline and the portrait's top edge, so the title block feels detached from
the subject.

## Not tested — needs real hardware

The preview's mobile emulation uses an **Android Chrome** user agent, so this
exercises the touch/narrow-FOV path but **not iOS Safari specifically**. The
one behaviour that genuinely differs there is WebXR: no iOS browser supports it
(all are WebKit), which `hud.js`'s hint-tailoring already accounts for. Real
iPhone verification is still **NEEDS-DEVICE**.

---

# Checked and NOT a problem

Recorded so these aren't re-raised by the next pass.

| Claim | Verdict |
|---|---|
| 19 `click` / 7 `mouseenter` / 6 `mouseleave` listeners are "mouse-only" | **Not a bug.** `laser-controls` bundles A-Frame's `cursor`, which translates controller trigger and ray intersection into exactly these events. Controller-native. |
| `snap-turn` listens for `axismove` (`locomotion.js:24`) | **Correct.** Generic `tracked-controls` event, right for Quest. |
| `carousel-drag` snap angle drifted from the column step | **Correct at runtime.** `33.1177` vs derived `33.12`. See G4 for the stale literal. |
| Panels physically intersecting | **Zero collisions.** Full SAT oriented-box test across all panels. |
| `#homePortrait` sunk to the floor at world y = 0 | **Was real, now fixed** (by you, mid-session). Observed: the `position` component's data read `{0,0,0}` while the raw HTML attribute was still an intact `"-0.5 1.42 0"`, putting the portrait's box at y −0.54…+0.54 — centred on the floor and horizontally centred, which also broke item 8's composition. Now reports `-0.5, 1.42, 0` under `portrait-layout.js?v=5`. **I do not have a verified mechanism:** I first blamed the 3-argument `setAttribute('position','x',v)` form, but that form provably works in A-Frame 1.5.0 — `bio-card.js:407` uses `setAttribute('position','y',…)` and lands correctly at `{0,-0.580,0}`. So the cause was something else; treat the old explanation as withdrawn. |
| `#bioCard` colliding with Sensa Consulting / ExploreTech | **Phantom — my harness's fault.** three.js does not propagate `visible` to children, so the bio card's *closed* Skills panel was still in its bounding box, inflating it to 1.92 m wide. Harnesses patched to use effective (inherited) visibility; collisions dropped to zero. Flagged as a caution for anyone reading box-based measurements. |
| `bio-card.js:407` uses the 3-arg `setAttribute('position','y',…)` form | **Not a bug.** I expected this to zero the vector; it doesn't. A-Frame 1.5.0 supports the per-axis form on `position`, and the skills button lands correctly at `{0, −0.580, 0}`. |
| Reduced motion is "broken" somewhere across the 13 consuming components | **No — it is sound.** Static audit of every branch: `hub-panel:463`, `photo-cloud:129/155`, `sunflower:109`, `dome:95`, `focus-stage:364/392`, `carousel-drag:150`, `locomotion:45`, `reticle:118/133`, `hud:39/145`, `name-scatter-3d:181`, `pdf-reader:217/408/418/523`, `project-room:266`. Every one arrives instantly in the final state rather than skipping it. `name-scatter-3d` even handles the subtitle's fade-from-zero explicitly on the skip path. Note: I could not force the media query at runtime through the preview API, so this is a code audit, not a live test — **a `?reducedMotion=1` dev override would make it testable.** |
| PDF reader text too small to read in a headset | **No — the maths works out.** 11 pt on a letter page scaled to a 1.95 m page is ~0.027 m of world height, subtending **0.82°** at the 1.9 m read distance. A real page at 40 cm subtends 0.56°, so the VR page is *larger* than real-world reading, and at 872 px/m the source canvas isn't the bottleneck either. It only looks illegible in an 800×450 screenshot. |
| The project room renders empty — no cards, no return button | **Withdrawn — my artifact, and a textbook §3.1 trap.** In the hidden preview pane the dip-to-dark transition stalled at `progress 0.89` with one live GSAP tween, so nothing had faded in. Forcing tweens to completion made the cards render (frame-centre luminance spread 1.00 → 18.44). Contrast readings taken during that stall (return button "1.00:1") are also void; the settled values are title 18.2, subtitle 10.8, tags 3.45, return button 3.55. **Anyone re-testing rooms must drive `gsap.ticker` to completion first.** |
| 34 clickables unreachable from all three ray origins | **Real, but it is G1's second symptom**, not a controller-geometry problem. All 34 are photo-cloud tiles, unhittable because `FrontSide` backfaces aren't raycast. `gazeOnlyReachable` is empty — nothing is mouse-clickable but controller-dead. |

---

# Remaining / needs hardware

## Settled during this pass

- **Controller `reach()`** — `gazeOnlyReachable` is **empty**. Nothing is
  clickable by mouse but dead from a controller, across all 71 clickables, three
  ray origins and three hand poses (hip / mid / raised). The only unreachable
  targets are the 34 photo-cloud tiles, which is G1's second symptom.
- **Seam sweep** — the two predicted yaw overlaps are real but small (2.6°
  portrait × projects inner column; 0.7° bio × experience inner column) and
  produce no physical collision at any tested eye position. Overlap counts by eye
  point: 7 at default, **9 crouched (1.15 m)**, 5 standing tall, 6 leaning. Worst
  single case is 22–29% of one card's footprint, all *within* the projects
  cluster rather than across the seam. Crouching is the worst case — a short
  visitor sees the most overlap.
- **PDF reader (~1.95 m sizing)** — works. 7 pages, lazy render confirmed (2 of 7
  textured at rest), pages measure exactly 1.507 × 1.95 m, page 1 spanning
  y 0.50–2.45 m. Legibility verified by calculation (see the table below). Its
  one real cost is **54° of vertical scan** for a single page (−30.1° to +24.1°),
  which is the intended "towers overhead" effect — a comfort judgement, not a
  defect. **NEEDS-HEADSET** to rule on.
- **Project rooms** — work: hub hides, theme applies, cards render with feathered
  edges, Return button restores the hub. Two follow-ups: G6 (light corruption)
  and marginal contrast on the tags (3.45) and Return button (3.55) against the
  light room theme.
- **Reduced motion** — audited across all 13 components; sound. See the table
  below.
- **a11yMode** — works (Atkinson swap confirmed); see G7 for its two problems.
- **`super-hands` / `aframe-extras`** — both confirmed unused. See G9.
- **`reticle.js:97`** — `reducedMotion ? HOVER_OUTER : HOVER_OUTER`, both branches
  identical. Confirmed vestigial and **harmless**: the instant-arrival behaviour
  reduced motion needs is already handled by `k = reducedMotion ? 1 : …` at
  `:118` and the pulse at `:133`. Delete the dead ternary or restore whatever it
  was meant to do.

## Genuinely blocked on hardware

- ~~**Vision Pro.** No `hand-tracking-controls` is mounted anywhere; only
  `laser-controls`, which is built on `tracked-controls` and matches *controller*
  profiles. Vision Pro Safari has no controllers — input arrives as WebXR
  `targetRayMode: "transient-pointer"` (gaze + pinch). Expect **no working select
  on Vision Pro**, but this cannot be proven without the device.
  **NEEDS-HEADSET.**~~
  **CONFIRMED ON HARDWARE 2026-08-29, AND FIXED.** Sebastian took /vr into an
  Apple Vision Pro and it failed exactly as predicted: buttons needing several
  tries, a room "taking a few minutes" to open, a photo in the cloud that could
  not be selected at all. It presents as frame rate and is not — the scene draws
  in 1.17 ms at two-eye resolution with 63 draw calls.
  Fixed by `vr/components/xr-select.js`, which bypasses A-Frame's cursor
  entirely: it hooks the session's own select events, takes the ray from
  `frame.getPose(inputSource.targetRaySpace, refSpace)`, raycasts `.clickable`
  itself, and emits `click` on the hit. Scoped strictly to `transient-pointer` so
  Quest controllers are untouched. See VR_AI_BUILD_GUIDE.md §3.13 for the
  reasoning and §9.16 for the rest of that session's findings.
  Still open on this line: the fix has been exercised with a synthetic
  `transient-pointer` event burst, not with a real pinch. **NEEDS-HEADSET** to
  confirm the fix, not the bug.
- **Real iPhone.** The preview emulates an Android UA, so iOS Safari's specific
  behaviour (no WebXR at all, WebKit-only) is untested. **NEEDS-DEVICE.**
- **Stereo / IPD.** Depth conflicts and z-fighting read differently with two
  eyes; A1 (hero title elevation) and G3 (grid vertical span) will both feel
  different in a headset than in a 112° desktop frame. **NEEDS-HEADSET.**
- **Frame timing under load.** The preview pane freezes `rAF` unpredictably, so
  no performance claim in this report is trustworthy and none is made.

## A dev affordance worth adding

I could not force `prefers-reduced-motion` at runtime — each component captures
`matchMedia` into a module-scope `var` at load, and the preview API exposes no
toggle for that media query. A **`?reducedMotion=1` URL override**, read alongside
the existing `?sunflower=0` / `?sunflowerRate=N` flags, would make all 13 paths
live-testable instead of audit-only.

## Testing notes for whoever picks this up

Three traps cost real time in this session and will cost it again:

1. **`three.js` does not propagate `visible` to children.** Any bounding-box
   measurement must walk to the root, or hidden geometry inflates the box. This
   produced two entirely phantom collisions before it was caught.
2. **The dip-to-dark room transition stalls in a hidden pane.** GSAP's ticker
   freezes, so the room renders empty and every contrast reading is void. Drive
   `gsap.globalTimeline.getChildren(...).forEach(t => t.progress(1))` before
   measuring anything in a room.
3. **`setInterval`/`setTimeout` clamp to ~1 s in a background tab, but
   `MessageChannel` tasks do not.** Use a MessageChannel pump to advance async
   work (PDF load, transitions) while the pane is hidden — `setInterval(…, 16)`
   yielded 7 iterations in 4 s; a MessageChannel pump yielded 9371 in 2.5 s.

Also: an AABB of a rotated card is not its size. The bio card measured "1.92 m
wide" and the PDF strip "0.61 m wide" purely from world-axis boxes on rotated
objects. Measure in the object's own frame.
