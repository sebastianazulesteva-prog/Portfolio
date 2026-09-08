# /vr — Test Protocol

> **Status: instruments built, sweep not yet run.** Nothing in `vr/` production
> code has been touched. Two new dev-only files were added (`_dev-xr-input.js`,
> `_dev-testplan.js`); no shipped file was modified.
>
> Findings go in `VR_TEST_REPORT.md`, not here. This file is the *procedure* —
> repeatable, so the same sweep can be re-run after changes and compared.

---

## 0. Configuration for this pass

| Dimension | Setting |
|---|---|
| Scope | Full sweep, section by section |
| Platforms | Desktop-as-headset-proxy (primary), desktop fallback, iPhone fallback, Vision Pro gap audit |
| Camera | Multiple positions **and** angles per section — never the default forward view alone |
| Reduced motion | **Code untouched.** All 13 consuming components audited for "broken" vs "instant final state" |
| a11yMode | Included |
| Fixes | **None.** Report only. |
| Aesthetics | Full art-direction critique; subjective calls marked as such |
| Audio | Muted at the graph level before anything else runs |

### Why reduced motion stays

Checked, since the initial instinct was to remove it: it is **not** an Apple
requirement — it is a W3C standard media query (Media Queries L5) that mirrors
the OS "Reduce Motion" toggle. But **WCAG 2.2.2 "Pause, Stop, Hide" is Level A**
and applies to auto-playing motion running over 5 seconds. This scene has
several such motions (photo-cloud drift, hub-panel idle drift, sunflower
tracking, dome), and the reduced-motion paths are what currently satisfy it.
Removing them would drop the scene below Level A, and in a headset motion is a
physical-comfort issue rather than a preference. It also appears in the flat
site (`index.html:36`, `experience.html:101`, four project pages), which the
standing rules put off-limits.

So: keep it, and audit it instead. For each of the 13 components the only
question is **does it arrive instantly in the final state, or is it broken?**
"Instant" is correct behaviour. "Broken/absent" is the bug.

---

## 1. Instruments

Three dev-only harnesses already existed. Two were added for this pass. **None
are referenced by the shipped scene.**

| File | Role |
|---|---|
| `vr/_dev-preview.html` | *existing* — one section at a time with real scraped data |
| `vr/_dev-camera-path.js` | *existing* — named camera waypoint paths + overlap diagnostics + forced sync render |
| `vr/_dev-interact.js` | *existing* — interaction stepping with live state readout |
| **`vr/_dev-xr-input.js`** | **new** — the real controller input path, and `reach()` |
| **`vr/_dev-testplan.js`** | **new** — 14 more camera paths + analytic checks that need no render loop |

### Loading them

```js
['_dev-camera-path.js','_dev-xr-input.js','_dev-testplan.js'].forEach(function(f){
  var s=document.createElement('script');
  s.src='/vr/'+f+'?v='+Date.now(); document.head.appendChild(s);
});
```

Order matters: `_dev-testplan.js` registers its paths into `VRCamPath.paths`, so
load `_dev-camera-path.js` first. It warns loudly if you don't.

### `_dev-xr-input.js` — why the mouse is not a controller test

The scene has **three independent raycasters**:

| Origin | Where | Used when |
|---|---|---|
| `#head` cursor, `rayOrigin: mouse` | `vr/index.html:192` | desktop only |
| `#leftHand` `laser-controls` | `vr/index.html:200` | immersive session |
| `#rightHand` `laser-controls` | `vr/index.html:201` | immersive session |

A mouse test drives only the first. In a headset that one isn't used at all. Move
the origin down ~0.6m and out ~0.25m to a held controller and hit ordering,
occlusion, and `far: 20` range all change — a card that is trivially clickable
with the mouse can be blocked from a controller at hip height. `reach()` casts
from all three origins at every `.clickable` and reports, per target, whether
that origin hits it or is blocked and by what. The `gazeOnlyReachable` field is
the headset bug list.

Two things it handles that would otherwise poison results:

- **With no XR session, `tracked-controls` gets no pose, so both hands sit
  collapsed at the rig origin** — floor level, dead centre. Hit tests in that
  state are meaningless and *look fine*. `pose()` puts them somewhere real, and
  `reach()` refuses to be trusted without it (it emits a `WARNING` field).
- **Trigger input goes through the real chain.** `laser-controls` bundles
  A-Frame's `cursor`, whose `downEvents` include `triggerdown`, so emitting
  `triggerdown` on a posed hand makes A-Frame's own cursor resolve the `click`
  against whatever the hand ray genuinely intersected. Nothing is faked past the
  hardware boundary.

Also: `silence()` runs automatically on load, muting `<audio>`/`<video>`
elements, `VRSound`, any WebAudio context and the `THREE.AudioListener` master —
at the graph level, never by clicking the ♪ button (which could toggle sound
*on*).

### `_dev-testplan.js` — analytic checks, immune to the frozen-pane trap

Build guide §3.1: the preview pane freezes `rAF` unpredictably, which has
already produced one fully convincing false negative. These four read the scene
**graph** rather than pixels, so they return the same answer whether or not a
frame was drawn. **When a screenshot and one of these disagree, believe these.**

| Call | What it answers |
|---|---|
| `geometry()` | Per-panel angular extent from the eye, and every pair overlapping in *both* yaw and pitch — predicted visual occlusion, nearer panel named as occluder |
| `collisions()` | 3D bounding-box interpenetration. Strictly worse than an overlap |
| `ergonomics()` | Elevation angle of every panel; flags overhead, underfoot, craning. Takes `{eyeY}` |
| `inventory()` | What actually got built, with measured sizes and derived vs live snap angle |

All layout angles are computed from the **same chord formula `layoutCluster`
uses**, not hand-copied, so they can't drift out of sync when the layout is
retuned.

---

## 2. Camera paths

Five existed (`hub-sweep`, `heights`, `command-zone`, `look-updown`,
`orbit-home`). Fourteen added:

| Path | Waypoints | Targets |
|---|---|---|
| `full-turn-12` | 12 | Turn in place, 30° steps, eye height |
| `full-turn-low` | 12 | Same, crouched 1.05m |
| `full-turn-high` | 12 | Same, standing tall 1.9m |
| `stress-lean` | 24 | Position **and** angle varying together in the command zone |
| `projects-columns` | 5 | Each column angle + the between-column angles |
| `projects-rows` | 5 | Pitch sweep ±30° across the grid's vertical span |
| `projects-grazing` | 5 | Cards seen nearly edge-on, where caption/button footprints collide |
| `experience-columns` | 7 | Same for the 4-column cluster |
| `experience-grazing` | 4 | — |
| `seam-portrait-projects` | 11 | ← highest risk, see §3 |
| `seam-bio-experience` | 9 | ← highest risk, see §3 |
| `home-composition` | 8 | Bugfix item 8: portrait left + bio right, both in one view, every height and lean |
| `reader-look-up` | 7 | The unverified ~1.95m PDF reader sizing |
| `floor-and-seam` | 13 | Bugfix items 9 + 10: dome seam, floor banding, the "spherical thing" |
| `photo-cloud` | 6 | Behind the viewer |

Plus `VRTestPlan.ring(name, {y, pitch, step})` to build an arbitrary
turn-in-place ring on the spot.

`VRTestPlan.sweep(name)` drives a path and, at each waypoint, collects both
`VRCamPath`'s render diagnostics **and** the analytic occlusion check from that
exact eye point — so the two cross-check each other. It reports
`documentHiddenDuring` so a whole sweep can be discarded if the pane went hidden.

---

## 3. Pre-flight predictions

Computed from the real layout numbers, **before rendering anything**. These are
hypotheses with numbers attached, not findings — the sweep confirms or kills
each one, and only survivors go in `VR_TEST_REPORT.md`.

Sign convention, worth stating because it is easy to invert: **positive yaw is
LEFT.** The portrait (`x = -0.5`) is therefore on the *projects* side and the bio
card (`x = +0.62`) on the *experience* side.

### P1 — Both home/cluster seams overlap in yaw

Viewer at `(0, 1.6, 0)`:

| Pair | Nearer object | Farther object | Overlap |
|---|---|---|---|
| portrait × projects inner column | portrait, +5.6°..+31.3° @1.60m | column, +28.7°..+49.1° @2.00m | **2.6°** (+28.7..+31.3) |
| bio card × experience inner column | bio, −39.9°..−4.5° @1.64m | column, −53.5°..−39.3° @2.00m | **0.7°** |

Different radii, so no physical collision — but the nearer object clips the
farther one's outer edge. Small dead-centre; **leaning widens it**, which is what
`stress-lean` and the two seam paths exist to measure. The bio card is the widest
object in the scene and the nearer one, so it's the pair most sensitive to a lean.

### P2 — The projects grid may run overhead and underfoot

`rowStepM = cardHeight + gapM = 0.5 + 0.42 = 0.92m`, `centerHeight = 1.5`. From
eye 1.6m at 2.0m distance:

| Rows | Row centre heights | Elevation span |
|---|---|---|
| 3 | 2.42 / 1.50 / 0.58 m | **+28.1° to −32.4°** |
| 4 | 2.90 / 2.00 / 1.00 / 0.10 m | **+37.4° to −40.9°** |

At 3 rows the top row's centre sits **above standing eye height** and the bottom
row's **below knee height** — spec §2 says nothing should live overhead or
underfoot, and a comfortable viewing cone is roughly ±20°. At 4 rows the bottom
row is essentially on the floor.

Note the tension this exposes: `gapM` was raised 0.2 → 0.42 specifically to clear
the caption-plus-button footprint and stop rows colliding. That fixed the overlap
and bought the vertical span. **Row count depends on how many projects the
scraper returns**, so `inventory()` settles which case is real before this gets
reported.

### P3 — `super-hands` may be a dead dependency

Mounted on both hands (`vr/index.html:200-201`), but no component in `vr/` appears
to listen for any grab event. If so it is a CDN payload doing nothing.

### P4 — `reticle.js:87` looks vestigial

```js
this._targetOuter = reducedMotion ? HOVER_OUTER : HOVER_OUTER;
```

Both branches are identical. Harmless, but it means the reduced-motion intent
there was never actually implemented — or was, and got flattened.

### P5 — Vision Pro likely has no working select

Only `laser-controls` is mounted; there is no `hand-tracking-controls` anywhere.
Vision Pro Safari has no controllers — input arrives as WebXR
`targetRayMode: "transient-pointer"` (gaze + pinch). `laser-controls` is built on
`tracked-controls`, which matches *controller* profiles. `VRXRInput.visionpro()`
reports what the loaded A-Frame build actually knows about (it string-probes the
registered components for `transient-pointer` and `pinchstarted`). Confirmation
on device is **NEEDS-HEADSET**.

### Not a finding — recorded so it isn't re-flagged

- `snap-turn` listens for `axismove` (`vr/components/locomotion.js:24`), the
  generic `tracked-controls` event. Correct for Quest.
- The scene's 19 `click` / 7 `mouseenter` / 6 `mouseleave` listeners are the
  idiomatic A-Frame pattern and **are** controller-native, because
  `laser-controls` bundles the `cursor` component that translates trigger and ray
  intersection into exactly those events. Not a mouse-only bug.

---

## 4. The sweep, step by step

### Step 0 — make the session trustworthy

```js
VRXRInput.silence()          // audio off at the graph level
VRInteract.clockCheck()      // is rAF actually running?
VRTestPlan.inventory()       // did the scene finish building?
```

Confirm `liveSnapDeg` matches `derivedColStep.projects`. If they differ, the
carousel settles off-column. *(Note: `index.html:258` still carries the literal
`snapDeg: 26.58` in markup while the derived value is 33.13; `onColStep` is
supposed to overwrite it at build time — verify it does.)*

**Discard any timing-based result taken while `document.hidden` was true.**

### Step 1 — analytic pass, before looking at anything

```js
VRTestPlan.geometry({verbose:true})
VRTestPlan.collisions()
VRTestPlan.ergonomics()
VRTestPlan.ergonomics({eyeY:1.05})   // short visitor
VRTestPlan.ergonomics({eyeY:1.9})    // tall visitor
```

Everything flagged here is a candidate with a number attached. Screenshots then
either confirm it or explain why it doesn't *read* as bad.

### Step 2 — the wide sweep

```js
await VRTestPlan.sweep("full-turn-12")
await VRTestPlan.sweep("full-turn-low")
await VRTestPlan.sweep("full-turn-high")
await VRTestPlan.sweep("stress-lean")
```

### Step 3 — section by section

| # | Section | Instrument | Looking for |
|---|---|---|---|
| 3.1 | Home composition | `home-composition` | Portrait left + bio right, both in one view, at every height and lean |
| 3.2 | Title | `orbit-home` | Per-letter scatter, light response, no backing panel artefacts |
| 3.3 | Portrait | `VRInteract.use("portrait-gaze")` | Mosaic reveal. Gaze must be **held** — it decays within a frame or two |
| 3.4 | Bio / skills | `VRInteract.use("skills-expand")` | Auto-fit type, panel opens right, nothing off-card |
| 3.5 | Projects | `projects-columns`, `projects-rows`, `projects-grazing` | Mixed grid: writing cards at half height among full-height photo cards. Confirm `declaredH` is really 0.25 and the row rhythm survives it |
| 3.6 | Experience | `experience-columns`, `experience-grazing` | Silvery treatment stays distinct from the warm projects side |
| 3.7 | **Seams** | `seam-portrait-projects`, `seam-bio-experience` | P1 |
| 3.8 | Photo cloud | `photo-cloud` | Drift, density, whether it reads as a cloud or as clutter |
| 3.9 | Project rooms | enter a photo project | Dip-to-dark transition, per-room light retint |
| 3.10 | PDF reader | `reader-look-up` | The unverified ~1.95m sizing — does it tower as intended or just feel oversized? |
| 3.11 | Environment | `floor-and-seam` | Dome seam, floor banding, the "spherical thing" |

### Step 4 — input, the real path

```js
VRXRInput.pose("point-mid")    // MUST precede reach()
VRXRInput.reach()              // ★ read gazeOnlyReachable
VRXRInput.pose("point-low")    // again from hip height — occlusion changes
VRXRInput.pose("point-high")
VRXRInput.aim("right", el); VRXRInput.trigger("right")
VRXRInput.thumbstick("right", 1, 0)
VRXRInput.visionpro()
```

### Step 5 — reduced motion, audited not removed

Thirteen components. For each: instant final state (correct) or broken (bug)?

`hub-panel` · `photo-cloud` · `sunflower` · `dome` · `focus-stage` ·
`pdf-reader` · `project-room` · `carousel-drag` · `locomotion` · `reticle` ·
`hud` · `name-scatter-3d` · `fallback`

### Step 6 — a11yMode

Atkinson swap, contrast, minimum target sizes still enforced.

### Step 7 — fallbacks

Desktop pointer mode, then iPhone (gyro / magic window). **Vision Pro is a third
target, not the iPhone one.**

---

## 5. Standing rules during testing

- Bump `?v=` after any edit, and cache-bust the **page URL** too — not just the
  query on the script tag.
- Check `document.hidden` before trusting any time-dependent result.
- For troika text, watch `blockBounds` **change**; its mere existence returns the
  *previous* font size's numbers.
- Never let audio play. `silence()` first, always.
- Anything needing real stereo/IPD, 6DoF or comfort judgement → mark
  **`NEEDS-HEADSET`** rather than guessing.
- Report only. No fixes, no commits, no deploys.
