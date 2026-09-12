# /vr — Build Guide for AI Assistants

> **Read this first, before touching anything in `vr/`.**
>
> This is the practical, current-state guide: how the scene is put together, the
> rules that must not be broken, the dev tooling that already exists, and — most
> valuably — the **traps that have already cost real debugging time**. Several of
> them produce *convincing false results* rather than obvious errors, so you will
> not notice you have been fooled unless you know to check.
>
> Where this conflicts with the older planning docs, **this file is current**.
> See "Document precedence" at the bottom.

---

## 1. What this is

`/vr` is a WebXR "spatial portfolio" — a dusk-lit dome you land in, with the
home panel (name, portrait, bio) ahead, a Projects constellation to the left, an
Experience constellation to the right, and a Photo Cloud behind you.

**Stack:** A-Frame 1.5.0 + three.js r158 (bundled), `aframe-troika-text` for all
in-scene text, GSAP for tweens, PDF.js for the paper reader. All from CDN.

**/vr is LIVE, in beta, as of 2026-08-27** (commit `9565c9e`) at
https://sesteva.com/vr/, linked from the flat site's nav as
"Experience in VR — Beta", in the dome's own gold.

What is tracked: `vr/index.html`, `vr/vr.css`, `vr/components/*`,
`vr/projects.json`. What is deliberately NOT, and is gitignored so a stray
`git add vr` can't sweep it in: the audio clips (`vr/assets/*.mp3|ogg`,
`vr-audio/` — see rule 6) and the `vr/_dev-*` harnesses. Still untracked and
unignored: all `VR_*.md` docs and `screenshots/`.

The old standing rule — "nothing is committed, do not deploy without asking" —
is retired now that the beta has shipped, but the spirit holds: **`main` is the
live site.** A push to `main` is a deploy to sesteva.com within a minute or two,
so don't commit /vr changes without Sebastian explicitly asking.

---

## 2. Hard rules

These are standing constraints, repeated across the planning docs and confirmed
in practice. Breaking any of them is a regression.

1. **No build step.** Plain files, everything via CDN. No bundler, no npm, no
   transpile. Scripts are plain ES5-style JS (`var`, no modules) to match.
2. **Pin every CDN version exactly.** Never `latest`. Current pins: A-Frame
   1.5.0, troika-text 0.14.0, GSAP 3.12.5, pdfjs-dist 3.11.174. (super-hands
   3.0.6 and aframe-extras 7.2.0 were removed — both were confirmed inert, see
   VR_TEST_REPORT.md G9. Re-add super-hands, plus the
   `delete AFRAME.components.grabbable` shim it needs, only alongside the first
   real grabbable target.)
3. **Don't touch the rest of the site.** THREE sanctioned touchpoints now, all
   by explicit ask. The third, added 2026-09-11, is the widest and the one most
   likely to be over-read: **body copy on the project pages.** Sebastian asked
   for it in as many words after reading the audit ("yes, write both of those"),
   because the VR room's station text is scraped from the page and two rooms had
   nothing to scrape. What was written, and nothing beyond it: a `<p
   class="process-note">` in each `.process-card` on `baston.html` and
   `timecollector.html`; a `<p class="collage-note">` in each `.collage-item` on
   `chess.html`; the Prototyping paragraph on `chess.html` extended with the
   rack-and-pinion pivot; and one paragraph in chess's `.story` disclosing that
   the hero photo's pieces were AI-generated. Every sentence traces to the page
   itself, to a legible annotation in one of its own images, or to something
   Sebastian said in that session — see the `$why` fields in `vr/images.json`,
   which is where the provenance lives. This is still not licence for anything
   else: the rule is that a room may not invent content, and the fix for an
   empty room is to ask him and then write it down ONCE, on the page, where both
   surfaces read it.
   The second, added 2026-09-09: the **alt text on the contact
   photos and the hero** in `index.html`. Writing the VR captions meant working
   out what is actually in each photograph, and at that point leaving
   `alt="Sebastian Esteva — candid photo 1"` on the live site was knowingly
   leaving a screen reader worse off than the dome. Sebastian asked for it
   directly; do not take it as licence for anything else. Note the hero pair is
   already CORRECT and was only reworded: `contact-photo-mosaic.jpg` carries
   `alt=""` on purpose because it is the bottom layer of a two-image composite
   that the top layer describes once — "fixing" the empty one would make a
   screen reader announce the same picture twice.
   The first, and still the main one, is the nav entry in `index.html` — the old inert `VR Website Version Coming Soon`
   placeholder, now a live `Experience in VR` link with a `.nav-beta` pill
   (`<li class="nav-vr">`). It is the only nav link NOT in the off-white the
   others use: it wears `--ember` (#b8863b, the same gold as vr.css's `--ember`
   and the dome itself, ~6.2:1 on the near-black) because it is the one entry
   that leaves the flat site. Keep the two `--ember` values in sync. The pill
   sits INSIDE the `<a>` so it inherits the nav's entrance animation and the
   `html.no-hero-anim` override; don't lift it out into a sibling without
   giving it its own copies of both. A separate page about building /vr is on
   Sebastian's list — that's his to scope.
4. **Respect `prefers-reduced-motion` and `a11yMode`.** Nearly every component
   checks these. Reduced motion should mean "arrives in final state instantly",
   not "broken". For a11y, type scales ×1.25 (`fonts.js`) **and card geometry
   scales with it** (`VRType.cardMult()`, applied by `layoutCluster` and the bio
   card) — a metre-sized card with 25% bigger type doesn't fit, and the bio
   card's auto-fitter will quietly shrink the bump back out if you let it. Gaps
   are not scaled. Test with `?reducedMotion=1` and with the site's own
   accessibility toggle on.
5. **Content is derived from the live site, never hand-duplicated.**
   `data-loader.js` scrapes `/index.html` and `/experience.html` and each
   project's own page. `vr/projects.json` is *enrichment only* (accent, theme,
   image override, `heroTone`). If you find yourself typing project copy into a
   VR file, stop.
6. **Audio is OFF AT THE SOURCE, and the clips are not deployed.**
   `index.html` sets `window.VR_AUDIO = false` before any component loads —
   hard `false`, no longer `?audio=1`-switchable, because the clips are
   gitignored and an escape hatch on the live site would 404 the ambience while
   `sfx.js` still synthesized its non-file cues. While the flag is false: the
   birdsong clip is never fetched or played, `VRSound.enabled` stays false so
   `sfx.js`'s hover/select cues are silent too, and `hud.js` removes the ♪
   button from the HUD instead of leaving a dead control. Nothing was deleted.
   To audition locally, temporarily set the flag to `true` with the (untracked)
   clips present in `vr/assets`. Behind the flag the old rule still holds:
   ambience starts muted and only unlocks on an explicit user gesture.
   `sfx.js`'s file-based cue pools build on FIRST PLAY, not at load — they used
   to be eager, and since `new Audio(src)` with `preload='auto'` fetches
   straight away, the `SCHEMES` table downloaded all seven UI clips on every
   page load even with the switch off. Keep them lazy.
   **When testing, never let audio play** — mute `#ambientAudio` and set
   `window.VRSound.enabled = false` before doing anything, even with the flag
   off. Sebastian has been startled by test audio from a hidden tab before.
7. **No teleport locomotion** (documented deviation from the base spec — snap
   turn only). **Superseded for translation as of §9.5**: bounded WASD/joystick
   walking is being added by explicit decision. Teleport is still out, snap-turn
   still handles all rotation, and smooth *look* is still not added.
   **No gaze-fuse selection** (`fuse: false` everywhere, always
   requires an explicit click/pinch/trigger). **No AR** — only `immersive-vr`.
   **`dwell.js` is not a fuse and does not bend this** (added 2026-09-06,
   §9.23): it gates the photo cloud's REACH — a reversible preview that floats a
   tile forward and eases back when you look away — behind ~0.9 s of held
   pointer, with a ring that fills to show it. Selecting a photo is still an
   explicit click, and a click skips the ring entirely. If anything ever hangs
   an irreversible action off `VRDwell.start`, that IS a fuse and the answer is
   still no.
8. **Bump the `?v=` query on a component's `<script>` tag after every edit**, in
   BOTH `vr/index.html` and `vr/_dev-preview.html`. Otherwise the browser serves
   the cached old file and you will debug a version that isn't running. Also
   cache-bust the page URL itself when reloading (`?nocache=` + timestamp).

---

## 3. The traps (read this section twice)

Every one of these has already burned real time. Most fail *silently* or produce
plausible-but-wrong results.

### 3.1 The preview pane's visibility is unstable — this invalidates measurements

The Claude browser preview pane goes hidden/shown unpredictably. When hidden:

- `requestAnimationFrame` throttles to **zero**
- A-Frame's render loop stops → **no component `tick()` runs**
- **GSAP's ticker freezes** → tweens never advance, `onComplete` never fires
- But `renderer.render()` called by hand **still produces normal-looking images**

That combination is the dangerous part. It produced a completely convincing
false negative when testing the sunflower effect: every panel measured exactly
its build-time orientation at every waypoint, so the feature looked broken when
it had simply never been given a frame to run in. It also made the PDF reader
appear to hang, because the open transition's `onComplete` (which builds the
reader) never fired.

**Always check `document.hidden` before trusting any time-dependent result.**
Use `VRCamPath.settle(ms)` (below), which detects a stalled loop and pumps
`sceneEl.tick()` by hand. Note it does **not** currently pump GSAP's ticker — if
you need a GSAP transition to complete in a hidden pane, drive
`gsap.ticker.tick()` yourself.

An older memory note claimed rAF *never* runs in this pane; a later measurement
found 61 frames/500ms with `document.hidden === false`. Both were true at
different times. **Measure, don't assume.**

### 3.2 troika text measurement is asynchronous, and goes stale silently

- Text height is only readable via
  `el.components['troika-text'].troikaTextMesh.textRenderInfo.blockBounds`,
  which does not exist until troika has laid the text out. Poll for it.
- **After changing `fontSize`, the OLD `blockBounds` is still readable.** Polling
  "does blockBounds exist" returns immediately with the *previous* size's
  numbers. This silently measures the wrong thing. Watch for the value to
  actually *change* instead.
- **`troikaTextMesh.sync(callback)` did not fire reliably** here — an auto-fit
  loop built on it stalled and never laid out. Don't depend on it.

### 3.3 Wrapped text height is NOT linear in font size

Bigger type wraps to *more* lines at the same `maxWidth`, so scaling by a single
`available / measured` ratio overshoots badly. A first attempt at the bio card's
auto-fit pushed content clean off the card. **Iterate: apply, re-measure,
correct, repeat** with a round cap. Same bug hit the paper-title card.

### 3.4 A-Frame's `position` component clobbers direct `object3D` writes

If you create an entity and set `object3D.position` **in the same pass**, the
`position` component initialises *afterwards* and overwrites your value with the
attribute's older one. The skills button landed 9cm off because of this.

- Entity created earlier (before an async wait)? Direct `object3D` writes are safe.
- Entity created in the same synchronous block? Use
  `setAttribute('position', ...)`.

### 3.5 Custom ShaderMaterials need an explicit output colour-space conversion

Textures are tagged `SRGBColorSpace`, so the GPU hands the shader **linear**
values. three.js injects `linearToOutputTexel` into every ShaderMaterial's
fragment prefix but only *calls* it if the shader includes the chunk. Without

```glsl
#include <colorspace_fragment>
```

you write linear values straight to an sRGB framebuffer: everything renders
**darker and orange/warm-shifted**. Measured on one texture: a built-in
`MeshBasicMaterial` gave `[186,186,185]` where the custom shader gave
`[135,117,78]` — blue crushed by 107.

This was the real cause of `BUILD_NOTES.md` ISSUE-07 ("thumbnails render
dark/tinted as if a colour grade is applied"), which had been closed by removing
the tone grading — treating the symptom. Both `glass-material.js` (image shader)
and `mosaic-reveal.js` now include the chunk. `CARD_FRAG` deliberately does
**not**: it samples no textures, its colours are hand-picked literals authored in
that space, and converting them would visibly brighten every panel.

### 3.6 Moving something forward does NOT bring it to the front

This scene runs with A-Frame's **`sortTransparentObjects: false`** (the default),
which means transparent objects are drawn in **scene-graph order, not depth
order**. Nearly every surface here is transparent, and the glass/image shaders
also set `depthWrite: false`, so nothing depth-rejects a farther object either.
Net effect: an object later in the DOM paints straight over a nearer one.

This is what made "select a photo and it comes forward" only half work. The
selected tile travelled from 2.2 m to 1.15 m — a metre nearer than anything else
in the cloud, verified by raycast — and still had **12–36% of its own face
painted over** by tiles behind it, purely because they came later in
`#photoCloud`'s child list.

**Fix pattern:** set `renderOrder` on the object's whole subtree (mesh, caption,
any buttons — walk `object3D.traverse`), and reset it when the state ends.
`renderOrder` *is* honoured under the stable sort. `photo-cloud.js` uses
`SELECTED_RENDER_ORDER` 10 / `FOCUSED_RENDER_ORDER` 5.

Do **not** "fix" this by flipping `sortTransparentObjects: true` — that changes
how every panel in the scene composites — or by turning `depthWrite` on for a
feathered material, whose soft alpha edge would then stamp depth and cut a
rectangular hole in whatever is behind it.

**Measuring it:** position tests will tell you the object is in front and pass.
The only honest check is pixels — render, hide the suspected occluders, render
again, and diff inside the object's own face (sample in its LOCAL frame; a
rotated quad's screen bbox includes corners that aren't on the object). Expect
the feathered ring — ~42% of a tile's face area at a 12% feather — to legitimately
differ, so measure the opaque inner region separately.

**THE LAYER TABLE (audited 2026-08-30).** Because `renderOrder` and not distance
decides what is in front here, these numbers are a scene-wide contract — and they
live as private constants in nine different files, so this is the only place they
appear together. Read it before choosing a new one.

| order | who | notes |
|---|---|---|
| 0 | everything by default | dome, floor, all constellation cards, page planes |
| 1 | `reading-line` band | the reader's line highlighter. The page under it is OPAQUE, so it would composite correctly at 0 too — stated explicitly rather than relying on that, because the day a page gains a transparent treatment the accident stops holding |
| 5 | `photo-cloud` hovered/reached tile | `FOCUSED_RENDER_ORDER` |
| 10 | `photo-cloud` SELECTED tile | `SELECTED_RENDER_ORDER` |
| 10 / 11 | `focus-stage` panel / its content | `setPanel` writes 10, `liftContentAbovePanel` writes 11 |
| 12 / 13 / 14 | `bio-card` skills panel — plate / glass / text | above the focus stage on purpose: both can be open at once (§9.14) |
| 20 / 21 / 22 | `notice` — plate / glass / text | |
| 30 / 31 / 32 | `busy` loading card — plate / glass / content | outranks a notice: a load outranks a message |
| 40 / 41 / 42 | `xr-diag` card — plate / glass / text | an instrument outranks everything it measures |
| 900 / 901 / 902 | `dwell` ring — scrim / track / fill | `depthTest: false`. Above every content surface (it is anchored ON a photo and has to be seen over it) and below the reticle, because a progress ring that covered the cursor would hide the one thing telling you what you are pointing at |
| 999 | `locomotion` comfort vignette | `depthTest: false` — see §3.10 |
| 999 / 1000 | `reticle` group / dot + ring | `depthTest: false`; the cursor is always last |

**One tie exists: `photo-cloud`'s selected tile and `focus-stage`'s panel are both
10.** It was chased and **no reachable co-visible state could be constructed** —
the cloud is behind the hub, a selected tile is placed in front of where you were
looking when you selected it, and the focus stage is placed in front of where you
are looking when it opens, so getting both on screen at once means facing two
opposite directions. It is left alone deliberately: §3.6 says a speculative
renumber risks breaking compositing that currently works. **If you ever make the
cloud reachable from the hub's side, this tie becomes real** — move the selected
tile to 15, not the focus stage, since the skills panel is already above it at 12.

Do not pick a new number without adding a row here.

### 3.7 The Syne webfont subset lacks Unicode arrows

`↗` (U+2197) rendered as a **solid filled box** — troika substituted the font's
missing-glyph placeholder, and rotated −45° that reads as a white diamond.
Diagnosed by raycasting into the rendered scene and reading back the material.
Fix: draw such glyphs into a canvas with a system sans-serif and use it as a
texture (`arrowGlyphTexture()` in `ui-button.js`). Check glyph coverage before
using any non-ASCII character in troika text.

### 3.8 Nothing consumed the scene lights until recently

Every surface used to be `MeshBasicMaterial` or a self-lit custom shader, so
both `<a-light>` entities — **and `project-room.js`'s per-room light retint** —
were invisible no-ops. The glass shader and troika text now genuinely respond.
If you add a surface, decide deliberately whether it should be lit.

### 3.9 Aiming/orientation must use quaternions and parent space

`sunflower.js` aims panels at the viewer. Two things matter:
- Combined pitch+yaw on separate **euler** axes gimbals and visibly twists roll.
  Use `lookAt` on a helper + `Quaternion.rotateTowards`.
- `constellation.js` nests each panel inside a **rotated outer entity** per zone,
  so a world-space aim must be converted through the parent's inverse
  quaternion — otherwise every panel is off by its zone's angle (72° / −74°).
- Rate-limit by `deg/sec × deltaTime`, not a fixed fraction per frame, or the
  motion runs twice as fast at 120fps as at 60fps.

---

### 3.10 A full-screen overlay at the eye must be depth-free, or it deletes the scene

`#comfortVignette` is a BackSide sphere of radius 0.3 m sitting *at* the camera.
In view space its centre is therefore z = 0 — the largest z on screen — and
three.js sorts the transparent pass back-to-front, so it drew **before every
panel**. With `depthWrite` on it stamped the depth buffer at 0.3 m and every
transparent object beyond that failed the depth test.

For 200 ms that just looks like a flash, which is why it survived. The moment
`walk-controls` started *holding* it on for the duration of a move, it read as
"the entire scene disappears the instant I press W" — the dome, floor and rug
survived only because they are opaque and had already been drawn, so it looked
like the content had been culled rather than occluded. Nothing logs.

Any overlay drawn at the eye needs all three: `depthTest: false`,
`depthWrite: false`, and a high `renderOrder` so it composites last.

### 3.11 GLSL `smoothstep` with `edge0 >= edge1` is UNDEFINED, and fails silently

The radial term in that same vignette was first written
`smoothstep(0.92, 0.30, vigC)` — the natural way to express "fade the other
way". GLSL leaves the result undefined when `edge0 >= edge1`. It compiled with
no warning, threw no error, and returned alpha 0 everywhere, so the vignette
simply never drew and looked "fixed" for the wrong reason. Always write it as
`1.0 - smoothstep(lo, hi, x)`.

Related: also check the shader you patched is the one being rendered.
`onBeforeCompile` set in a component's `init()` can land on a material that
A-Frame's own `material` component then *replaces*, leaving your patch on a
discarded object. Listen for `object3dset` persistently (not once) and keep the
"already patched" flag on the material itself, so a rebuilt material gets
re-patched instead of silently reverting.

### 3.12 The comfort vignette stopped covering the room transitions

`vignette-flash._harden()` injects a radial alpha term
(`1.0 - smoothstep(0.38, 0.90, vigC)`, where `vigC` is 1 dead ahead) so the
walking vignette darkens the EDGES rather than dimming the whole view — §9.5,
and correct for walking.

Dead ahead that term is **exactly 0**. Both room transitions
(`project-room.js`, `pdf-reader.js`) tween `material.opacity` to 0.92/0.95 in
the belief that the sphere dips to black and hides the swap. Since the radial
term landed, the centre of the screen has stayed perfectly clear at every
opacity, so the world was being swapped in plain view — the dome recolouring and
the hub vanishing mid-frame, with only the edges dimming. It reads as a glitch
rather than as a transition, and it silently got worse the moment the reader
gained a real teleport to hide.

Fix: `vignette-flash.setFlat(true)` lifts the radial term to a uniform screen
fill for the duration (`uVigFlat`, a uniform shared by reference so it costs no
recompile), and both transitions now bracket themselves with it. Walking never
sets it, so it keeps its edges-only treatment.

**The lesson:** one entity serves two purposes here — an edge vignette for
motion comfort and a full blackout for transitions — and they want opposite
alpha profiles. Anything new that reaches for `#comfortVignette` has to say
which of the two it means.

---

### 3.13 A Vision Pro pinch is a ONE-FRAME input source, and A-Frame drops it

**Confirmed on hardware 2026-08-29.** `VR_TEST_REPORT.md` predicted this and
could not prove it without the device; the first Vision Pro session proved it.
Symptoms Sebastian reported: buttons that needed several tries, a room that took
"a few minutes" to open, a photo in the cloud that could not be picked at all.
It reads as frame rate. It is not — the scene draws in **1.17 ms at two-eye
resolution (3840×1824)** with 63 draw calls. It is dropped input.

Vision Pro Safari has **no controllers**. A pinch materialises an
`XRInputSource` with `targetRayMode: 'transient-pointer'`, fires
selectstart → select → selectend, and removes it again. So:

- `laser-controls` is built on `tracked-controls`, which matches *controller*
  profiles. Nothing binds reliably, and when
  `generic-tracked-controller-controls` does bind (it matches ANY profile) it
  has one frame to do it in.
- A-Frame's `cursor` emits `click` only when the SAME entity was intersected on
  both the press and the release, and it learns what is intersected from a
  `raycaster` running on tick. With a one-frame input source there is often no
  tick in which the raycaster sees the target.
- There is **no hover at all** before the pinch. Any control whose hit test or
  visual state assumes a prior `mouseenter` is dead in a headset. (Audited
  2026-08-29: nothing in the scene gates its *click* on hover — the only gate is
  `scroll-arrows`' `enabled`, which is deliberate.)

**The fix is `xr-select.js`**, and the shape of it matters: it does not patch
A-Frame's cursor, it bypasses it. On `enter-vr` it takes the session's own
select events, gets the ray from
`frame.getPose(inputSource.targetRaySpace, referenceSpace)`, raycasts
`.clickable` itself, and emits `click` on what it hit. One frame, one pose, one
hit. All ~70 clickables work with no change of their own, and the ray is
Apple's eye-based one, so you select what you are LOOKING at.

Three things about it that are load-bearing:

- **Scoped strictly to `transient-pointer`.** `tracked-pointer` (Quest
  controllers) is left to A-Frame. A second click emitter on those would fire
  everything twice — open-then-close, enter-then-exit.
- **It mutes the HAND raycasters** on first sight of a transient pointer, and
  only then, because `generic-tracked-controller-controls` can bind to one for
  the frame it exists and emit a competing click.
- **It walks the parent chain for visibility.** three.js's raycaster tests
  `layers`, NOT `visible`, so a hidden parent does not protect its children —
  and inside the reader and the project rooms every `.hub-cluster` is hidden
  *at the parent*. Without the walk, all six clusters stay clickable through
  the wall of the room you are standing in.

`?xrdebug=1` logs every input source (handedness, targetRayMode, profiles) and
every hit/miss with distance. Use it before theorising about the next session.

**A knock-on that bit once already:** because a pinch arrives as
mouseenter → click → mouseleave within a few frames, any component that
animates a TRANSFORM on hover is now mid-flight at the moment of the click.
`hub-panel.wake()` animates **scale**, and card-flip.js drives scale too — so
the mouseleave landing right after the click animated the card back to its
glance size and undid the flip mid-air. `wake()` now no-ops while
`__flipped || __flipTween`. Anything else that hovers a transform needs the same
guard.

---

### 3.17 `removeObject3D` and `removeChild` do not free anything

three.js never auto-disposes, and **neither of A-Frame's removal calls does
either.** They unlink the object from the graph and leave the GPU buffers,
textures and compiled programs allocated. Dropping the last JS reference does not
save you: three.js holds its WebGL resources in WeakMaps keyed by the object, so
the JS side gets collected and the driver-side allocation is orphaned with
nothing left to call `dispose()` on. Nothing logs. `renderer.info.memory`
counters only ever go **down** inside three.js's own dispose handlers, which
makes them an exact leak measure.

Found this way (§9.21): `focus-stage` leaked **2.00 geometries per open**, steady
state. The cause was instructive — the file *had* the correct helper (`setPanel`,
whose own comment says "three.js never auto-disposes, and this runs on every
open") and the experience path used it, while the project path built its panel
inline and bypassed it. One of two build paths, in one file.

Found the same way again (§9.24): `exit-button` leaked **5.00 geometries and 5
materials per open** of the reader. Same shape of cause, one level out — the
file had no teardown path at all, and the reason nobody noticed is that one of
its **two call sites is safe by accident**. `project-room` frees its whole room
with a blanket `disposeSubtree`, which sweeps the console up with everything
else; `pdf-reader` frees from an explicit `state.disposables` list, which is
correct for everything the reader builds and cannot know about five meshes
another file attached. **A control that is mounted into someone else's subtree
must free itself** — see §9.24 for why that is a component `remove()` here and
an `opts.disposables` array in `scroll-arrows.js`.

**Use `VRGlass.disposeSubtree(object3D)`.** One helper, called from every teardown
path, rather than the same six lines in six places.

**The exclusion in it is load-bearing.** It frees a texture only if
`loadTexture` tagged it `__vrOwned`, because `ui-button.js`'s
`arrowGlyphTexture()` is **memoised** — one canvas texture shared by every arrow
badge in the scene. A blanket "dispose `material.map`" would free that shared
texture the first time anything closed, and every other arrow would silently go
blank. It would not throw, it would not log, and it would only show up on the
**second** thing you looked at. Anything untagged is treated as shared-or-unknown
and left alone.

**How to measure a leak honestly**, because a single delta cannot tell a one-off
warmup cost from a per-cycle leak: run **two equal blocks** of N open/close
cycles and compare them. If block B is ~0 it was warmup. If A ≈ B it is real.
Three of the four suspects in §9.21 looked like leaks in a single-block test and
were warmup. Also **render, don't just tick** — `renderer.info.memory` counts
what has been uploaded, so an un-rendered allocation is invisible.


### 3.14 `window.requestAnimationFrame` DOES NOT RUN inside an immersive session

**This is the most expensive trap in the file, because it makes the whole scene
work perfectly on a desktop and break in a headset — with no error, anywhere.**

In an immersive session three.js hands the frame loop to the session's clock:

- `aframe 1.5.0` a-scene: `renderer.setAnimationLoop(this.render)`, and
  `render()` calls `this.tick(time, delta)`, which ticks every component
  behaviour **and every system**.
- `three.js r158` `WebXRManager` **replaces** `setAnimationLoop`, so that
  callback is driven by `session.requestAnimationFrame`.
- `gsap 3.12.5` ticker: `m = requestAnimationFrame; … p = _(yl)` — it rides the
  **window's** rAF and nothing else.

So the scene keeps drawing, components keep ticking, clicks keep working — and
**every GSAP tween in the scene stops dead.** That is: `card-flip`'s flip,
`pdf-reader`'s room transition and scroll, `photo-cloud`'s bring-forward,
`bio-card`'s skills fly-in, `focus-stage`, `notice`'s fade, `column-scroll`,
`name-scatter`. Ten files, one clock.

Two consequences that make it hard to recognise:

- **It reads as slowness, not as breakage.** GSAP's `lagSmoothing` clamps a gap
  over 500 ms to 33 ms of tween time, so a starved ticker advances a tween by
  33 ms per tick *whenever it does tick* rather than skipping ahead. A 0.7 s dip
  needs 21 ticks; at one tick a second that is 21 seconds, which is exactly
  *"entering rooms takes forever"*.
- **Anything gated behind an `onComplete` never happens at all.** Both room
  transitions build their world in the tween's callback, so the reader never
  entered and the project room never themed.

**The fix is `xr-frame.js`** — a *system* (nothing to forget in markup) whose
`tick()` calls `gsap.ticker.tick()` while `renderer.xr.isPresenting`.

The load-bearing detail, and the reason this is safe: gsap derives its time from
the **wall clock**, not from an accumulated per-call delta —

```js
function yl(t){ var a = Date.now() - z, s = (t===true);
                ... i = (z += a) - A; b = i - 1000*g.time; g.time = i/1000
                ... s || (p = _(yl)) ... }
```

so a second call in the same frame sees `a ≈ 0` and advances tween time by ≈ 0,
and `s === true` skips the rAF re-arm so it cannot spawn a competing loop.
**Verified against the real 3.12.5 build**, headless with no rAF at all: frozen
with no tick; +0.2440 of a 500 ms tween after one manual tick 120 ms later;
**no change at all across three further ticks 0 ms apart**; run to completion
with `onComplete` when ticked at 11 ms; and a *chained* `onComplete` (the room
transition's exact shape) completing too.

**Corrections to two things that were believed here:**

- GSAP 3.12.5 does **not** listen for `visibilitychange` and does **not** read
  `document.hidden`. Grep the dist: the only `hidden` hits are the CSS plugin's
  `autoAlpha`/`visibility` handling. It freezes purely because window rAF stops,
  so no visibility workaround is needed.
- `gsap.ticker.tick()` *can* be driven usefully — §9.10.10's "40 calls advance a
  tween by ~1 ms" is right but the conclusion drawn from it was too strong. The
  ~1 ms is because those 40 calls happened in one synchronous burst with no wall
  clock between them. Called once per frame with real time passing, each tick
  advances by the real delta. **Manual ticking works; manual ticking in a tight
  loop does not.**

Do not pump outside a session. A-Frame's loop and GSAP's ticker are then the
same window rAF, so if one is starved the other is too — including in the
preview pane, where the fix is still §9.10.10's two recipes, not this.

### 3.15 `setTimeout` is the other clock that may not be running

Nine self-scheduling `setTimeout` polls in this codebase exist to wait for
troika to measure something (`text-flow`, `hub-panel`, `bio-card` ×3,
`ui-button`, `photo-cloud`, `glass-material`, `name-scatter`). A timeout is
clamped to **~1 s** in any context the browser considers backgrounded, which
turns a 40 ms poll into a 40× slower one — and whether visionOS calls an
immersive session backgrounded is not documented anywhere reliable.

`?xrdiag=1` measures it (`setTimeout(50)` fired N of ~60). Until that number
comes back from the device, treat it as unknown.

`VRPoll.every(ms, fn, {attempts, onGiveUp})` in `xr-frame.js` is the answer and
is **dual-armed**: each attempt is armed by both the scene tick and a timeout,
and the first to fire runs it and re-arms both. That survives a session (where
ticks run and timeouts may crawl) *and* a stalled preview pane (where ticks stop
and timeouts run) — strictly better than either alone. `text-flow.js` uses it;
the other eight are still bare timeouts, deliberately left until there is a
measurement to justify touching them.

### 3.16 There is no console in a Vision Pro

No devtools, no remote inspector while a session is running, no way to paste a
snippet. So "measure, don't assume" (§3.1) had **no instrument at all** on the
one device where the bugs are — which is why every in-headset claim before this
pass was either a desktop measurement or a guess.

`?xrdiag=1` (`xr-diag.js`) is the instrument: it samples the clocks in-session
and renders the numbers **on a card in the scene**, with a plain-language
verdict. Screenshot it and the measurement leaves the headset. It is inert
without the flag — nothing built, no sampler armed.

Anything you want to know about in-headset behaviour has to end up on a surface
inside the scene. Plan for that when you build the diagnostic, not after.

---

## 4. File map

### Scene entry
- **`vr/index.html`** — the scene. Component `<script>` tags (with `?v=`),
  `<a-scene>` markup, the light rack, and the data-wiring script that builds the
  constellations via `layoutCluster()`.
- **`vr/vr.css`** — 2D DOM overlay only (back link, HUD, arrival veil).
- **`vr/projects.json`** — VR-only enrichment per project. **Not** content.

### Core systems
| File | Role |
|---|---|
| `glass-material.js` | **The most central file.** Shared rounded-glass card shader, feathered/rounded image shader, the 4-fixture key-light rack (`setLights`/`setTune`/`sharedLightUniforms`), `lightTroikaText()`, the light-rack housings component. |
| `fonts.js` | Font URLs + the strict 3-size type scale (`VRType.title/body/label` + `display`). a11y swaps to Atkinson. |
| `data-loader.js` | Scrapes bio, stats, skill groups, projects, experience, images, per-project blurb/room images, and each writing project's `pdf`. |
| `constellation.js` | `place()` / `layout()` — positions panels at (angle, radius, height) using an outer-rotates / inner-translates pattern. |
| `themes.js` | Per-project palettes pulled from each project page's real CSS tokens. |
| `dome.js` | `dusk-sky` (canvas-gradient skybox; ember band at the equator, y=0), `dusk-floor`, `dusk-rug`. Dome and floor **must** share radius. |
| `xr-frame.js` | **Loaded first, and load-bearing.** TIME in a headset. Drives `gsap.ticker` from A-Frame's own loop while presenting, because the window's rAF is not serviced in an immersive session and every tween in the scene rides it (trap §3.14). Also publishes `VRPoll` (trap §3.15). `?pump=0` disables it. |

### Cards & content
| File | Role |
|---|---|
| `hub-panel.js` | The glass card used by every constellation. Three layouts: full-bleed image card, text-only card, and the `paperTitle` writing card. Captions float **above** the card. |
| `bio-card.js` | About panel. Fully measured layout + auto-fit type; Skills row opens a panel to the right. |
| `mosaic-reveal.js` | Home portrait with the gaze-driven mosaic reveal. |
| `name-scatter-3d.js` | The home title's per-letter "Tenet" scatter. No backing panel. |
| `ui-button.js` | Bounded button + hover. **Enforces the scene-wide minimum target size.** Optional rotating arrow badge. |
| `focus-stage.js` | The reusable "pull it closer" detail view. |
| `project-room.js` | Themed per-project room (photo projects). Dip-to-dark transition. |
| `pdf-reader.js` | Reading space for writing pieces — replaces the room for those. Continuous scroll over **pre-rendered page images** (`window.VR_PAGES`, from `.tools/vr-make-pages.py`), lazily loaded ±1 page through `VRGlass.loadTexture`. **No pdf.js** — §9.18. |
| `sunflower.js` | **New.** Panels slowly drift to face the actual viewer. |
| `photo-cloud.js` | Drifting constellation of every site image, behind the viewer. |
| `card-flip.js` | **New.** An Experience card turns over in place (and grows to reading size) to show its bullet list on the back. Replaces the focus stage for `type: 'experience'`. |
| `busy.js` | **New.** The one loading card and the one input gate (§9.17). `VRBusy.begin/update/end`. Anything that loads for longer than a frame should go through it. |
| `dwell.js` | **New (§9.23).** `VRDwell.start(el, {onComplete})` — a ring that fills on the thing you are pointing at, and only then does the cheap reversible thing happen. One ring, reused, parked at the scene root. Used by the photo cloud to hold back the reach. Read its header before assuming it is a gaze fuse; it is not (hard rule 7). |
| `reading-line.js` | **New (§9.23).** The reader's line highlighter — the flat site's Accessible-Mode reading ruler, in VR. FINDS the text lines in each pre-rendered page IMAGE (there is no text layer) by a row-projection profile, then multiply-tints the one you are looking at. Click the page to step down a line. |

### Interaction / support
`locomotion.js` (snap-turn, comfort vignette), `reticle.js`, `sfx.js`,
`hud.js`, `fallback.js` (desktop/phone), `text-flow.js`.

**`carousel-drag.js` — attached to nothing, and not loaded, since 2026-08-30.**
It made the projects zone spinnable, which was right for the single 10-item grid
it was built for and became a way to break the scene once §9.1 split that grid.
See §9.19 and the box at the top of the file; do not re-attach it without giving
it a bound.

**`xr-select.js`** — selection for headsets with no controllers (Vision Pro).
Read trap §3.13 before touching anything about input; this file is the reason
pinch-to-select works at all there.

**`xr-diag.js`** — `?xrdiag=1` only, inert otherwise. The in-headset instrument:
samples window rAF vs the XR clock vs the scene tick vs `gsap.ticker`, runs a
real tween end to end, and puts the numbers **on a card in the scene**, because
there is no console in a Vision Pro (trap §3.16).

**`vr/assets/pages/`** — pre-rendered page images for every writing piece, plus
`manifest.js` (`window.VR_PAGES`). Generated by `.tools/vr-make-pages.py`;
regenerate whenever a PDF changes. 80 pages, 10.6 MB, WebP q86 at 150 DPI with
the long edge capped at 1700 px. Same arrangement as `assets/tex`: the script is
untracked, the derivatives ship.

**`vr/assets/tex/`** — the VR-only downscaled copy of every site image, plus
`manifest.js` (`window.VR_TEX`). Generated by `.tools/vr-make-textures.py`;
regenerate BOTH together whenever `/images` changes. `glass-material.js`'s
`texUrl()` reads the manifest and falls back to the original for anything not in
it. The script lives under `.tools/` (untracked, like `vr-phone.sh`) while the
derivatives themselves ship.

---

## 5. Dev tooling — use it, don't hand-roll

Three dev-only files. **None are referenced by the shipped scene.**

### `vr/_dev-preview.html` — single-section harness
Renders ONE section at a time with real scraped data. Far faster than loading
the whole scene.

```
?card=list                      # index of every valid id
?card=title | portrait | bio | button
?card=project&id=<href-stem>    # e.g. id=chess
?card=paper[&id=<stem>]         # writing cards (all five side by side)
?card=experience&index=<n>
?card=all                       # every section, one light
?card=orbit                     # single card + viewFrom(deg, dy)
?card=methods | compare         # lighting comparisons
```
Auto-mounts the interaction stepper (Prev/Next/Reset + live state readout) when
the shown section has an interaction. Keep its light rack in sync with
`index.html`.

### URL flags on the scene itself
(?audio=1 is gone — the audio switch is hard `false` now, see rule 6.)
```
?sunflower=0        # disable viewer-tracking drift
?sunflowerRate=N    # drift speed, deg/sec
?reducedMotion=1|0  # force prefers-reduced-motion on/off (wraps matchMedia
                    # BEFORE the components load, so all 13 consumers see it)
?nocache=<ts>       # bust the page cache — always do this when reloading
?xrdebug=1          # log every XR input source and every hit/miss (xr-select)
?xrdiag=1           # sample the clocks and show the numbers ON A CARD in the
                    # scene — the only way to measure anything in a headset
                    # (trap §3.16). Works on desktop too, as the baseline.
?pump=0             # turn OFF the GSAP pump (xr-frame.js). This is the CONTROL
                    # half of the on-device A/B: with it, transitions and card
                    # flips are frozen in a headset exactly as they were before
                    # §9.18. Run it first, while the bug still reproduces.
?forcexr=1|0        # pin the headset or the flat arrival gate (onboarding.js)
```

### `.tools/vr-phone.sh` — open /vr on a real iPhone
```
./.tools/vr-phone.sh            # HTTPS on your Wi-Fi + a QR code to scan
./.tools/vr-phone.sh --tunnel   # public trycloudflare.com URL (see below)
```
Serves the repo over **HTTPS** (self-signed, `.tools/certs/`, regenerated when
your LAN IP changes) and opens `.tools/phone-qr.html` with a QR of
`https://<lan-ip>:8443/vr/`. Safari warns once about the certificate — Show
Details → visit this website.

HTTPS is the point: iOS only allows the `DeviceOrientationEvent.requestPermission()`
prompt in a secure context, and that prompt is what tilt-to-look
(`magicWindowTrackingEnabled`) depends on. Over plain http the scene loads and
drag-to-look works, but the gyro is silently dead — an easy false negative when
testing `portrait-layout.js`. The server also sends `Cache-Control: no-store`,
because a phone caching a component is the `?v=` trap all over again.

`--tunnel` uses the `cloudflared` binary already in `.tools/` and gives a real
trusted cert, which is the fallback when the two devices can't reach each other
— campus and guest Wi-Fi usually isolate clients. **It publishes this folder at
a public URL for as long as it runs**, which is why it isn't the default.

### `vr/_dev-reader.html` / `vr/_dev-gate.html` — when the pane wedges
Added 2026-08-29 (§9.18), because in that session the full `/vr/index.html` made
the preview tab stop answering CDP entirely — `preview_eval`, `preview_snapshot`
and `preview_screenshot` all timed out, repeatedly, across server restarts, while
the flat site was fine. **`preview_console_logs` and `preview_network` are the
only channels that survive that**, so both of these are *self-reporting*: they
load only the components under test, run their own assertions on load, and
`console.log` every result with PASS/FAIL. Read the outcome from the console.

- **`_dev-reader.html`** — the reader end to end on real page images: manifest,
  page geometry for both aspects, page 1's texture actually arriving, the ±1
  window loading and disposing, teardown, and the 16:9 width cap. Needs
  `?reducedMotion=1` (it has index.html's shim) plus hand-pumped `sceneEl.tick()`,
  so it exercises the SYNCHRONOUS transition path, not the GSAP one.
- **`_dev-memory.html`** / **`_dev-memory-reader.html`** — the leak harnesses.
  Same self-reporting shape; described in full under their own heading below
  rather than twice.
- **`_dev-gate.html`** — the input gate, the indeterminate bar, and the GSAP pump.
  Small and fast on purpose: **all its waiting goes through `MessageChannel`,
  which is not throttled in a backgrounded tab, where `setTimeout` is clamped to
  ~1 s.** `_dev-reader.html` does not, which is why it takes minutes.
  It is also the only place the pump is tested end to end: put `gsap.ticker` to
  sleep (exactly the immersive-session condition), confirm the tween is frozen,
  set `renderer.xr.isPresenting = true`, and confirm the same tween completes.

`emit('click', null, true)` is synchronous, so gate tests need no waiting at all
— that is how `_dev-gate.html` gets through in seconds.

### `vr/_dev-memory.html` / `vr/_dev-memory-reader.html` — leak measurement

Both implement §3.17's two-equal-blocks method with a manual pump that
**renders** rather than only ticking, and both force `reducedMotion` so nothing
is gated behind a GSAP `onComplete` the pane may never run (§9.10.10).

- **`_dev-memory.html`** sweeps six overlays in one page load (focus stage ×2,
  notice, busy, card flip, reader). Use it for a broad "did anything regress"
  pass. It also spies on `VRGlass.loadTexture` vs `Texture#dispose`, because
  `renderer.info` cannot see a texture that was created and dropped before its
  first render.
- **`_dev-memory-reader.html`** does the reader only, **one case per page load**
  (`?case=shipped|noexit|norail|noground|notext|look`), because nine reader
  cycles with pumping is enough to wedge the pane (§9.23).

  Its point is the **geometry census**: `renderer.info` says how many leaked,
  never which, so this wraps `PlaneGeometry`/`CircleGeometry`/`ShapeGeometry`,
  tags each instance with the source line that built it off `new Error().stack`,
  spies on `BufferGeometry#dispose`, and prints made/freed per line. §9.24 was
  found in one page load with it. **Prefer this to suppressing builders one at a
  time** — the suppression cases are the cross-check.

  `?case=look` is the other half, and the reason both exist: a counter cannot
  distinguish "freed correctly" from "never built", so `look` walks the meshes
  through open → close → re-open and asserts presence, then **detachment *and*
  disposal**, then a fresh rebuild.

Both are gitignored (`vr/_dev-*`) and load every component on a
`Date.now()`-stamped src — cache-busting the page URL does **not** refetch a
component whose own src has no query, which is how §9.21's first "after" run
measured a file that was no longer on disk.

### `vr/_dev-camera-path.js` — motion testing
```js
var s=document.createElement('script');
s.src='/vr/_dev-camera-path.js?v='+Date.now(); document.head.appendChild(s);

VRCamPath.list()                 // hub-sweep, heights, command-zone, look-updown, orbit-home
VRCamPath.use('command-zone')
VRCamPath.goto(0)                // jump + diagnostics
await VRCamPath.settle(1800)     // let time pass (pumps ticks if loop stalled)
await VRCamPath.gotoSettled(2)   // both at once — use this for anything animated
VRCamPath.restore()
```
It disables `look-controls` while driving (otherwise it rewrites your rotation
next tick), forces a synchronous render, and reports panels in view with
distance + off-axis angle plus screen-space overlap pairs. Overlaps are only
reported within 32° of view centre — an edge-of-frame panel is seen nearly
edge-on and always "overlaps".

**Sebastian's standing instruction: test `/vr` changes from multiple positions
and angles, never just the default forward view.**

### `vr/_dev-interact.js` — interaction stepping
```js
VRInteract.list()                // portrait-gaze, card-hover, focus-pull, skills-expand
VRInteract.use('portrait-gaze')
await VRInteract.next()          // step, then report measured state
VRInteract.hover(el) / .click(el) / .gaze(el,u,v) / .wait(ms)
VRInteract.clockCheck()          // is rAF actually running?
```
`gaze()` **holds** the hit point — `mosaic-reveal` re-reads raycaster
intersections every tick and eases back to zero, so a one-shot synthetic input
decays within a frame or two.

---

## 6. Current state

### Done and verified
- Full-bleed hero images filling each card; captions float above in white
- Colour-space fix across all photos (verified within 1/255 of ground truth)
- Real lighting: 4-fixture rack above the home title; glass panels, card text,
  and title letters all respond
- Portrait: reduced darkening, true unmodified mosaic reveal, gentle corners
- Bio card: measured layout, auto-fit type (~1.12×), Skills panel opens right,
  close button removed
- Buttons: scene-wide minimum target size enforced, centered labels, rotating
  arrow matching the flat site's hover
- Sunflower: 20 panels track the viewer; mis-aim up to 21.7° corrected to <0.4°
  at a constant ~17.4°/sec
- PDF reader: **pre-rendered page images, no pdf.js** (§9.18), lazily loaded
  (never >3 pages in memory), continuous scroll, page counter, clean teardown
  restoring the hub. Page width is capped so the two 16:9 slide decks read at
  the same size as a portrait page instead of 3.46 m wide.
- Projects grid row/column gap raised to 0.42 to clear caption + button
  footprint; carousel snap angle now derived instead of hand-copied

### In progress / needs review
- **The photo cloud's zone is stated as a GAP, not as raw angles.** `EDGE_MIN_DEG`
  / `EDGE_MAX_DEG` in `photo-cloud.js` bound the tiles' visual EDGES, and the gap
  they leave (7.8° each side) is deliberately the same as the hub's own tightest
  section boundary — the writing column to the projects grid — so the cloud reads
  as another section rather than a distant clump. Two things make the arc
  actually reach those bounds: each tile insets its OWN angular half-width (a
  near 0.61 m tile is ~7.9° wide, a far small one ~3.9°), and the angle fractions
  are normalised to span [0,1] because golden-ratio hashing's extremes fall short
  for any finite image count. If you retune a cluster's angles, re-measure the
  cluster edges and move these two numbers with them.
- **Text over a room's own background needs a halo.** A project room paints the
  sky from `theme.sky` and the FLOOR from `theme.panel`, and at least one theme
  pairs a dark sky with a near-white floor — no single fill colour clears 4.5:1
  against both. `project-room.js`'s `ROOM_HALO` (troika `outlineWidth: 8%`) is
  the fix; reuse it for anything new that floats in a room. Related: a room
  dims the key rack to 0.22, so `ui-button`'s solid variant (near-black label,
  right in the hub at 9.15:1) collapses to 2.1:1 there — pass a light
  `labelColor` for buttons inside rooms.
- **PDF reader sizing just changed** to ~1.95m tall (a bit bigger than the bio
  card), page 1's bottom at knee height so it towers overhead and you look up
  for the opening lines. **Not yet visually verified** — the last verification
  attempt was blocked by the pane going hidden.
- **Writing cards are wired into the real scene** but the mixed grid (half-height
  writing cards among full-height photo cards) has not been reviewed for layout.
- The `?card=paper&id=<stem>` single-card harness view frames too tightly.

### Known open items
- 4 writing projects still have no hero art anywhere in the repo (correct
  fallback for now). Adding art = drop a file in `/images/` + an `image`
  override in `projects.json`; no code change.
- No `.glb` models anywhere; `projects.json` has `model: null` throughout.
- Hover/select SFX are gated behind `VRSound.enabled`, which only flips on when
  the birdsong ambience is turned on — so a visitor who never taps ♪ gets no UI
  sound at all. Probably unintended coupling. (The ♪ button itself was 87%
  covered by A-Frame's default Enter-VR button until the `xr-mode-ui` fix, so
  this was unreachable in practice on desktop — see VR_TEST_REPORT.md G2.)
- "View in VR" link on the flat site is still an inert placeholder.

---

## 7. Working style Sebastian has asked for

- **Review section by section**, one card/element at a time, using the harness.
- **Stop and ask** when stuck or when a detail is eating time, rather than
  grinding. He said this explicitly.
- **Don't over-verify small tweaks**; batch reads; keep narration short.
- **Show, don't just describe** — screenshots of the actual thing.
- Ask before anything outward-facing. Never commit or publish unprompted.

---

## 9. Agreed work order — 2026-08-27 walkthrough

Source: the `BUILD_NOTES.md` walkthrough notes dated 2026-08-27, plus the
ambiguities Sebastian resolved directly afterwards. **This section is the
current spec for the items it covers** — where it conflicts with §4/§6 above,
it wins (those describe the state before this pass).

### 9.1 Zone plan — the left side splits into two sections

The left zone currently holds ONE 4-column grid with all 10 items in it (5
photo projects + 5 half-height writing cards). That mixed grid is being split:

| Zone | Contents |
|---|---|
| Left, **inner** (nearer home) | **Writing column** — the 5 written pieces, its own section |
| Left, **outer** | **Projects grid** — the 5 photo projects only |
| Right | Experience, 4×3, geometry unchanged (but see 9.3) |
| Behind | Photo cloud, narrowed (below) |

- The projects grid is **top-aligned with the top of the writing column** — the
  two sections start at the same height.
- Neither may overlap the other, and neither may overlap the photo cloud.
- **Photo cloud** keeps its current look and feel — drifting tiles, radius
  scatter, deterministic golden-ratio placement — but narrows to an arc with a
  **visible clear gap on both sides**: no angular overlap with the projects
  grid or the experience grid. Today the cloud spans 105°–255° while the
  projects grid's outer column reaches ~113°, so they overlap in yaw and are
  separated by depth alone (r 2.0 vs 2.2–3.6). That is what has to end.
- The no-overlap contract must hold **from the seat and from off-centre
  viewpoints**, checked with `_dev-camera-path.js`'s overlap diagnostics — not
  just from the default forward view.

### 9.2 Writing column

- Cards stay the compact `paperTitle` card at its current half-height size; the
  change is the arrangement (a column), not the card.
- **Today: show all 5 at once, no scroll UI.** There are only 5 pieces, so a
  4-at-a-time window would hide exactly one card behind an affordance.
- **When a 6th piece is added, the column shows 4 at a time and scrolls.**
  Build it so this is the only switch that has to flip. Required behaviour:
  - a **long flat arrow button at the top and another at the bottom** of the
    column — same visual language as the reader's scroll arrows
  - click/select to scroll (not drag-only)
  - **smooth**, eased scrolling
  - **always settles on a card boundary** so every visible card is fully
    visible — never a half-clipped card at either end.

### 9.3 Partial-row alignment — fill from the inner edge

`layoutCluster` fills left-to-right from `startAngle`, which is the zone's
*smallest* angle. In the right-hand (negative-angle) Experience zone that means
a last, incomplete row lands against the zone's **outer** edge, far from where a
seated viewer's eye starts. It should fill from the **inner, home-facing** edge
instead, in every cluster.

(The walkthrough note says "bottom two cards"; there are 11 experience items in
`experience.html`, so it is actually the bottom **three**.)

### 9.4 Bio card on arrival — and no special mobile version

The bio card has to be built and laid out on entry with no click. The markup
already intends this (`#bioCard` has no `visible="false"`, and the comment says
"visible by default once content loads") and `bio-card.js` only builds on
`setContent`, so the failure is real and lives in the load path — diagnose it,
don't just force `visible`. The "picture renders centered instead of the correct
layout" half of the note is the *symptom*: with no bio card beside it, the
deliberately-off-centre portrait is all that's there to see.

**Root cause, found and fixed (2026-08-27).** Two separate bugs, both real:

1. **`portrait-layout.js` hid it on purpose.** On any viewport with aspect
   < 0.70 (every portrait phone) it centred `#homePortrait` at x=0 and set
   `#bioCard` invisible on arrival — which is Sebastian's report *exactly*,
   measured at 375×812: `bioVisible: false`, `portraitPos.x: 0`. Its reasoning
   was sound (a portrait phone has ~42° of horizontal fov; the card at x=0.62
   is fully offscreen) but the decision is reversed: **"just have it load in
   just like the regular VR experience, no special mobile version."** The
   script tag is now commented out in `index.html`, the file kept for reference.
   The cropped phone view is accepted, and answered by the §9.7 disclaimer
   instead. **Do not re-enable it without asking.**
2. **The bio card's paragraphs genuinely overlapped, everywhere.** `afterResize`
   waited on the *aggregate* content height changing, and the one-line heading
   re-wraps first — so a fit round measured paragraphs troika had not re-wrapped
   yet, and `layout()` advanced the stack by those too-small heights. Measured
   on the shipped card: paragraph 3 sat **33 mm inside** paragraph 2, paragraph
   4 **28 mm inside** paragraph 3, and the paragraph gap came out 0.0104 m
   against the 0.0336 m the scale asked for. Fixed by requiring **both** signals
   — the aggregate has *moved* (troika started) **and** no individual block's
   measured height moved between two consecutive polls (troika finished) — plus
   a bounded `verify()` pass that re-lays-out if anything shifts after the final
   layout. After: zero overlaps, gaps uniform at 0.0317–0.0318 m, fit scale
   1.057 (it was reporting 1.12 while measuring dishonestly). This is trap §3.2
   and §3.3 biting again through a path that looked already-guarded.

### 9.5 Locomotion — bounded walking, added deliberately

- **Add movement controls**: desktop **WASD + arrow keys**, mobile **touch
  joystick**.
- **Bounded, and the bound is an ELLIPSE, not a circle** (`walk-controls.js`).
  The scene is not radially symmetric: the home cluster is only 1.5 m forward,
  while the constellation cards sit at 2.0–2.3 m and the photo cloud at 2.21 m.
  A circle wide enough to feel like real movement sideways walks you straight
  *through* the home panel and leaves you facing an empty dome — measured, at
  radius 1.7 the rig lands at z = −1.68, behind it. So: `forward` 1.15 m caps
  travel toward −Z (~0.35 m clearance to the home panel), `radius` 1.6 m opens
  up the sides and the space behind you. Stepping 1.6 m back to see the whole
  composition at once is one of the better things walking bought.
  Free roam of the whole dome was considered and declined.
- **The edge is soft.** A hard clamp — even with a slide-along term — still ends
  in an abrupt halt that reads as a bug. The outward component of the *wanted*
  velocity is bled off across the outer 30% of the bound, before the ramp sees
  it, so you decelerate into the boundary. Inward and along-the-edge motion are
  untouched. The hard clamp stays underneath as a backstop.
- **The motion vignette is a real radial vignette now**, injected into the stock
  material by `vignette-flash._harden()`. It used to be a flat black sphere, so
  "vignette at 0.30" meant the whole view dimmed 30% while you walked. Measured
  at walking strength: centre luminance unchanged, corner 9 → 6, edge 37 → 27.
  See traps 3.9 and 3.10 — both bugs lived in this one 10-line entity.
- **Keep snap-turn** for rotation, and keep the comfort vignette active during
  motion.
- This is a deliberate, confirmed override of §2 rule 7 **for translation
  only**. Still no teleport. Still no smooth *look*. Still no gaze-fuse.
- **Desktop look-around is by MOUSE, drag-style, and INVERTED from A-Frame's
  default.** Movement is WASD/arrows; aiming is the mouse. The model Sebastian
  asked for is *grab the scene and push it*: "if I clicked and moved the mouse
  to the left, I get to see to the right" — i.e. drag left, the world slides
  left, revealing what was on your right, like dragging a Street View panorama.
  A-Frame's default is the opposite (first-person head turn: drag left, look
  left). **Done** — `look-controls="reverseMouseDrag: true; reverseTouchDrag:
  true"` on `#head` flips both axes, so dragging down reveals what is above too.
  Pointer-lock was considered and declined: capturing the mouse makes the 2D HUD
  and the "Back to site" link unclickable until Esc.
- **The mouse cursor in-scene is the flat site's cursor**: the dot + ring that
  floats centre-screen and **grows when it is over something selectable**, so a
  visitor knows to click. `reticle.js` already implements exactly this (dot +
  ring, 1.55× hover growth and 0.5→0.9 opacity, matched to the flat site's
  36→56 px `.cursor`/`.cursor-ring`) — so this is a *verify and surface* task,
  not a build-from-scratch one. Two things to settle: it currently rides the
  mouse position (`cursor="rayOrigin: mouse"`) rather than sitting centred,
  which mouse-look/pointer-lock fixes for free, and it may simply be too subtle
  to notice today. Check before rebuilding.
- **Recenter is kept, restyled** — folded into the new movement controls rather
  than left as a lone ⌖ button in the middle of the HUD row. (The walkthrough
  note asked to cut it; with walking added, return-to-seat became genuinely
  useful, and Sebastian confirmed keeping it.)

### 9.6 HUD and buttons

- **Mobile look-around buttons are too small and too transparent.** `.hud-btn`
  is 2.75rem at `rgba(15,15,15,0.55)` with a 1.05rem glyph — the bare iOS
  minimum, and the `‹ › ⌖` glyphs read faint against a bright dusk sky. Enlarge
  and raise contrast on coarse pointers.
- **Back-to-dome buttons**: bigger, moved to the **upper right**, and made
  **identical in look, position and behaviour everywhere** they appear
  (reader, room, focus stage). Today they are not consistent.
- **Reader scroll controls** are also up for redesign — no fixed direction yet.
- Both of those, plus the photo bring-forward treatment, are to be **presented
  as screenshot options for Sebastian to pick from before being built.**

### 9.7 Onboarding — the two things a visitor must be told

Both of these are copy/UX work on the 2D overlay, not scene work, and both were
asked for explicitly.

1. **The iOS motion-permission prompt must be explained BEFORE it appears.**
   Tilt-to-look depends on `DeviceOrientationEvent.requestPermission()`, which
   iOS only offers in a secure context (hence `.tools/vr-phone.sh` serving
   HTTPS — see §5). Today the prompt arrives with no context. It needs a short
   panel first that says **why** the site wants motion data (so you can look
   around by moving the phone), that **a system prompt is about to appear**, and
   that they should **say yes**. Silently firing a permissions dialog is the
   thing that gets it declined.
2. **A prominent "this is built for VR" disclaimer.** The scene is composed for
   a headset; the flat desktop/phone port genuinely compromises the experience
   (the portrait-phone case in §9.4 is the sharpest example — a 42° horizontal
   field against a hub composed across ±1.6 m). Sebastian wants this stated
   plainly and unmissably, not buried — a visitor on a laptop should know they
   are seeing a fallback, not the work.

### 9.8 Photo cloud — selection behaviour

- A selected photo **comes forward and stacks in front of the others**.
  Neighbouring tiles must not overlap or interrupt it while it is forward.
- If the photo belongs to a project, it offers **"View full project", which
  enters that project's themed VR room** — the same destination as the grid's
  "Enter the project room" button. Most cloud photos are sourced from project
  pages, so most will have this; the ones that don't simply omit it.

### 9.9 Status — what is built and verified (2026-08-27)

**Done, measured:**
- Bio card overlap fix + `portrait-layout.js` retired (§9.4).
- Street-View drag inversion (§9.5): drag right → yaw +13.75°, drag down →
  pitch +13.75°.
- Zone re-plan (§9.1). Measured after: writing column 5 paper cards in one
  column at 43.5° (inner edge 33.13°, outer 49.12°); projects grid 5 photo cards
  in 3 columns at 71.67°/96.50°/121.33°, 2 rows, inner edge 61.3°, outer 131.7°;
  7° of clear dome between the two sections; both top-aligned to 2.475 m (within
  14 mm — the residual is per-card jitter within a row, not a systematic offset).
  Photo cloud: 32 tiles spanning 133.6°–204.4°, inside the 131°–206° bounds.
  Camera sweep over `hub-sweep`, `command-zone` and `orbit-home`: **zero
  cloud-vs-card overlaps at any waypoint** (the 57 at yaw 180 are cloud tiles
  against each other, which is the intended organic look).
- Partial-row inner-edge fill (§9.3): Experience's bottom two cards moved from
  101.6°/83.2° (outermost) to 64.8°/46.4° (innermost).
- Photo-cloud dedupe (§9.1): 34 → 32 tiles.
- Mobile HUD buttons (§9.6): 44px → 54px, fill 0.55 → 0.82 alpha, glyph
  1.05rem → 1.5rem, plus a drop shadow. Desktop unchanged.
- Bounded locomotion (§9.5): `walk-controls.js`. Verified by hand-pumped ticks —
  W→−Z, S→+Z, D→+X, A→−X, arrows match WASD, joystick matches keys, and 10 s of
  W+D lands exactly on r=1.100 at (0.778, −0.778). Clamp radius 1.1 m, chosen so
  the nearest card face (r=2.0) is never closer than ~0.9 m.
- Movement HUD (§9.6): joystick bottom-left (touch only), recenter moved out of
  the turn row to sit with it, turn buttons bottom-right. All five overlap pairs
  measured at 0 px².

**Open finding, needs Sebastian's call.** The camera sweep measured the BIO CARD
overlapping the Experience cluster's inner column by up to **100% in screen
space** at yaw −37° to −51° (depth gap only 0.21–0.51 m). This is pre-existing
— Experience's angle is untouched — and is the mirror image of the portrait /
writing-column collision that was fixed by moving the writing column out to
43.5°. The same fix works here: shift `EXPERIENCE_ANGLE` from −74° to about
−82°, which takes the inner edge from 39.2° to 47.2° and clears the bio card's
right edge (37.0°) by 10°. **It was not applied** because it costs photo-cloud
room: ZONE_MIN would have to move 131° → 139°, narrowing the cloud from 75° to
67° of tile centres.

**Also done, second pass:**
- **§9.2 writing-column scroll** — `column-scroll.js` + `scroll-arrows.js`.
  Dormant today (5 pieces, `activateAbove: 5`) so all five show, exactly as
  asked; wakes at 6 into a 4-card window with a long flat arrow bar above and
  below. Verified by waking it on the real cards with a 3-card window: the
  window holds exactly N cards at rest at every offset, each step is exactly one
  pitch (0.450 m), and it clamps at both ends. Whole-slot stepping is why "each
  article fully visible" holds without a clipping plane.
- **§9.6 reader scroll redesign** — the left-hand column of pads is gone. Two
  long flat bars, above and below the reading band, from the same builder as the
  writing column. Bars disable at the travel limits (verified: at scroll 0 the
  up bar is inert, at maxScroll 13.15 the down bar is). Track + thumb demoted to
  a position *indicator* on the page's right edge.
- **§9.7 onboarding gate** — `onboarding.js` + the `.onboard-gate` panel. Carries
  the "built for VR" disclaimer and, on iOS only, the motion-permission
  explanation; `requestPermission()` is called directly inside the button's click
  handler (iOS honours it nowhere else). A-Frame's own
  `device-orientation-permission-ui` is disabled so its generic modal can't fire
  first. Shown once per session. Verified: gate removes itself from the DOM on
  acknowledge (not just hidden — a scrim at opacity 0 keeps eating clicks) and
  the canvas takes pointer events again afterwards.
- **§9.8 photo-cloud selection** — select brings a tile to 1.15 m at 1.9×, which
  is nearer than every other tile's home radius (2.21 m min), so depth alone
  stacks it in front; the rest of the cloud pushes out 1.18× and dims to 0.55.
  Verified: 3.45 m → 4.07 m push, selected tile nearer than every other, no other
  captions shown, second selection releases the first, deselect restores every
  tile and dim exactly. "View full project" appears only where the photo maps to
  a project and enters that project's themed room; the tile's counter-scale keeps
  the button at its authored size inside a 1.9× parent.
- **§9.6 exit button** — `exit-button.js`, one control replacing three. Was
  `'← Back to the dome'` 0.50×0.13 ghost low-left, `'← Return to dome'`
  0.44×0.12 solid centred, and `'‹ Back'` 0.30×0.11 ghost inside a panel. Now
  0.68×0.18, solid, light label, arrow badge, same phrase, upper right, in all
  four contexts (reader, room, focus-project, focus-experience) — measured at
  screen NDC x 0.65–0.69 in every one, and exactly one is visible at a time.

### 9.10 Nine more traps, all found the hard way in this pass

Add these to §3's list.

1. **A media query adds NO specificity.** A `@media` block overriding an earlier
   selector only wins by coming later in the file. A touch-pointer block placed
   next to `.hud-btn` — above `.onboard-hint`'s own `bottom` — silently lost, and
   the hint never moved. Touch overrides now live at the END of `vr.css` with a
   comment saying why.
2. **`getAttribute` on a multi-property component returns a STRING until that
   component initialises**, not the parsed data object. So `mr.gray` reads
   undefined and any filter built on it silently passes everything through. The
   photo-cloud dedupe looked correct and measured 32/34 when run by hand
   afterwards, while the page it was supposed to fix had already built all 34
   tiles. Read `el.attributes['name'].value` and parse it with
   `AFRAME.utils.styleParser.parse` when timing is not guaranteed.
3. **The right-vector sign.** `right = forward × up` = `(-fz, 0, fx)` for
   forward `(fx, 0, fz)`. The negation is plausible-looking and fails silently:
   W+D walked forward-LEFT. Sanity check any such formula against a known case
   (looking down −Z, forward is `(0,0,-1)` and right must be `(1,0,0)`).
4. **§3.1 again, and it lies convincingly about physics.** The pane was hidden
   (`document.hidden: true`, 0 rAF frames, 0 component ticks) while walking
   "worked but 25× too slow" — because the few ticks that did land each got the
   dt cap. The fix for testing anything integrated over time is to **drive the
   component's `tick(time, delta)` by hand with a fixed delta**: deterministic,
   independent of the pane, and it makes the expected distance analytically
   checkable (0.5 s at 1.0 m/s with a 0.18 s ramp ⇒ 0.331 m; measured 0.335 m).

6. **A translucent warm pad is invisible on white paper.** The scroll bars first
   used `VRGlass.makeCardMaterial` to match the panels. Against the dome that
   reads fine; floated over a white PDF page it vanished. The bar measured
   correct on every axis — right position, `visible: true`, unoccluded, first hit
   in the raycast — and still could not be found in the rendered frame. Fix: a
   dark ground with a near-white arrow, which reads on both paper and dome (the
   trick the 2D HUD buttons already use against a bright sky). **When a control
   can float over content of unknown brightness, give it its own ground.**
7. **"Upper right" is an ANGLE, not a corner.** Right-aligning a button to its
   panel's edge puts it at screen NDC x 0.38 on a 1.2 m panel at 1.05 m, where
   the same button in the reader sits at 0.67. Consistent placement across
   contexts of different sizes and distances means computing from a fixed
   angular offset off view centre, then taking whichever is further out.
8. **Passing a control's old position as an "eye height" silently relocates it.**
   `VRExitButton.mount` measures up from the viewer's eye, and the project room
   was handed `eye: 1.25` — the y the old button happened to sit at. The button
   landed at NDC y 0.02, level with the horizon, in the one context where it was
   supposed to be unmissable. Parameters named for a viewer property want the
   viewer's value.
9. **Window size and activation threshold are two different numbers.** With 5
   writing pieces and a 4-card window, one number means scrolling starts today
   and hides a card behind an affordance — the opposite of the instruction. Keep
   `visible` (window) and `activateAbove` (show-all limit) separate.
10. **`gsap.ticker.tick()` cannot be advanced synchronously.** §3.1 says to drive
   the ticker by hand in a hidden pane; in practice it reads real elapsed time,
   so 40 calls in one turn advance a tween by ~1 ms. Two things that actually
   work: load with `?reducedMotion=1`, which makes most transitions take their
   synchronous path (this is how the reader's build, the column's stepping and
   the cloud's selection were all verified), or call a component's
   `tick(time, delta)` directly with a fixed delta. **Anything gated behind a
   GSAP `onComplete` simply will not run in a hidden pane** — that is why the
   reader appeared to open with no scroll control at all.

### 9.12 The reading room is a real place now (2026-08-27, later)

Sebastian, from the phone: *"when in the reading room, I don't think they
actually enter / are moved to another room right now? … it looks like the
carousel / list of articles comes with them, which is wrong."* Both halves were
right, and they had different causes.

**The list coming along** was VR_TEST_REPORT B1 — still live, because the
`.hub-cluster` fix (both `pdf-reader.js` and `project-room.js` reading the class
instead of their own drifted id lists, which had missed
`#writingConstellation`) was sitting **uncommitted** in the working tree while
`main` — the live site — still carried the old five-id list. Nothing new to fix;
it ships when /vr next ships.

**Not actually going anywhere** was real. The reader built itself around the
seat and hid the hub, so the room changed around a viewer who never moved. Now:

- **`walk-controls.js` has SITES.** A site is a bounded standing area somewhere
  other than the seat: `VRWalk.enterSite({x, z, radius})` teleports the rig and
  re-centres the movement bound on it, `VRWalk.leaveSite()` puts the viewer back
  on the exact spot they walked from (not the origin), and `VRWalk.site` is the
  read path for anything that used to assume "the rig lives at 0,0,0". The site
  bound is a **circle**, not the seat's -Z-squashed ellipse — that asymmetry
  exists because the home panel is 1.5 m along world -Z, which means nothing
  anywhere else. First entry wins for the remembered seat, so a re-entry mid
  close-transition can't record the alcove as home.
  Verified numerically against the shipped file (stubbed THREE/AFRAME, real
  tick): hub caps unchanged at z −1.15 / x ±1.6; at the site the rig holds
  (0, 12) instead of snapping back and walks a clean 1.2 m circle (10.8 / 13.2 /
  ±1.2); leaveSite restores (1.6, 0.223) exactly.
- **`pdf-reader.js` moves you** to `READING_SITE` (0, 12) at the transition's
  dark peak, and brings two things along: its **own ground** (a 1.75 m rug —
  the dome's `dusk-rug` stays behind at the seat, and without this you arrive
  standing on the bare void floor) and the **key-light rack**. The rack matters:
  the four fixtures are `distance: 9` point lights above the home title, so 12 m
  away every lit surface in the reader — scroll bars, the exit button's ember
  ring and back mark, the lit troika text — collapses to its emissive floor and
  reads as flat unlit chips. The fixture *entities* move (plus
  `[light-rack-housings]`), then `systems['vr-key-light'].syncRack()` re-reads
  the world positions, which keeps the real three.js lights and the glass
  shader's own light array in agreement.
- **The HUD's recentre ⌖ follows the site.** It reset position to 0,0,0
  unconditionally, which mid-read would have teleported the viewer out of the
  room and into a hub they can't see. At a site it recentres to the site and
  leaves orientation alone (the content faces wherever you were looking when
  you entered — there is no "correct" yaw to snap to).
- **`sunflower.js` now skips panels that aren't visible.** It kept aiming the
  hidden hub at the camera, so with the viewer 12 m away the whole
  constellation would spend the read slowly turning toward the alcove and be
  caught mid-swing back on the way home. Effective visibility (walk the parent
  chain), because the clusters are hidden at the parent.
- The hub stays hidden even though it is now 12 m behind you: two
  constellations plus 32 drifting photo tiles glowing at that distance read as
  distraction, not scenery.

**Also fixed in passing:** a paper card's *body* tap called
`VRProjectRoom.enter()` along with the rest of the projects, so the biggest
target on the card took you into an empty themed room while the card's own
"Read the piece" button went to the reader — same card, two destinations.
`hub-panel.js` now routes `paperTitle` cards to the reader either way.

**Exit button, interim.** Sebastian: *"the go back to the main dome is far too
annoying and big, push it off to the side a bit for now. I'll design it better
later."* `exit-button.js` is 0.82 × 0.20 → **0.60 × 0.16**, and 23°/16° →
**26°/20°**. At the reader's 1.9 m that takes the sliver of page it covers from
~9° of width to ~2.2°, and leaves 0.21 m between it and the up-arrow bar. It was
deliberately not pushed further: a portrait phone has only ~±21° of horizontal
field (§9.4), and past that the one way out is off the side of the screen on
exactly the devices that most need it. **Interim — don't build on these numbers.**

**Found on the way, and fixed:** the room transitions had stopped covering
anything — see the new trap §3.12. Both `project-room.js` and `pdf-reader.js`
now bracket their dip with `vignette-flash.setFlat(true)`.

**The `.hub-cluster` markers were MISSING FROM THE MARKUP, and that was the
actual live bug.** Commit `077f264` ("Back out everything but the photo cloud
from main") removed `class="hub-cluster"` from `vr/index.html` while the two
components that READ it stayed on disk — so `setHubVisible()` matched zero
elements and every cluster stayed fully visible inside the reader and inside
every project room. Measured in the browser before the fix:
`document.querySelectorAll('.hub-cluster').length === 0`, all six clusters
`visible=true` with the reader open. Restored, with a warning in the markup: if
this ever gets backed out again, back the components out with it. Note the
markup also lost the `#comfortVignette` `depthTest:false; depthWrite:false`
attributes in the same window (trap §3.10) — restored too, though
`vignette-flash._harden()` sets them in code as well.

**Verified in-browser** (hidden pane, so hand-pumped `sceneEl.tick()` +
`renderer.render()`, GSAP tweens driven with `.progress(1)`, and pdf.js's render
tasks re-triggered after shimming rAF — §3.1 again, three separate ways):

| Check | Result |
|---|---|
| Rig on entry | `(0, 0, 12)`; camera `(0, 1.6, 12)` |
| Page 1 from the eye | exactly 1.90 m, dead ahead |
| Reader root | `(0, 0, 12)` — but only after entity load; reading it in the same synchronous block as `appendChild` gives `(0,0,0)` and looks like a bug |
| Alcove ground | radius 1.75 at `(0, 0.004, 12)`, visible underfoot |
| Key rack | `#keyLight` z −1.30 → 10.70, housings 0 → 12; restored exactly on exit |
| Hub clusters | all 6 `visible=false` in the reader, all 6 `true` after exit |
| Turn 180° in the alcove | empty dark room — no cards, no cloud (this is the view Sebastian's screenshot showed the writing column in) |
| Live walking at the alcove | strafe caps at x 1.2, back caps at z 13.2 — a clean 1.2 m circle |
| HUD ⌖ while reading | returns to `(0, 12)`, not the origin |
| Vignette flat flag | 1 through both swaps, back to 0 after |
| Exit | rig `(0,0,0)`, site null, rack restored, sky theme cleared, root removed, `pages`/`disposables` both empty |
| Second round trip | identical — no drift, no stacked rack offset |
| Paper card BODY tap | opens the reader ("Algorithmic Modeling"), no project room |
| Project room | 6/6 clusters hidden at the dark peak (was 0/6), sky themed, all restored on exit |

### 9.13 Project rooms sealed off, with a notice at each door (2026-08-27)

Sebastian: *"the project rooms are just ugly right now, so I don't want there to
be a way into them just yet"* — then, immediately after: *"let's have a little
'project rooms will be coming soon' pop up when people hit that."*

- **`window.VR_ROOMS = false`** in `index.html`, next to the audio kill switch
  and following the same convention: one flag, nothing deleted, no half-wired
  feature left lying around. `project-room.js` is untouched and still works —
  flip the flag and all three doors reopen.
- **The doors stay visible and stay clickable.** A control that silently does
  nothing reads as broken; one that vanishes reads as a feature you can't ask
  about. Three of them now call `VRNotice.comingSoonRooms()`:
  the photo card's "Enter the project room" (`hub-panel.js`), the focus stage's
  same CTA (`focus-stage.js`, and the stage stays OPEN behind the notice — closing
  it would read as the click throwing you out), and a selected photo's "View
  full project" (`photo-cloud.js`, tile stays forward).
- **A photo card's BODY tap now opens the focus stage** instead of entering.
  That reverses ISSUE-08 for as long as the flag is false, deliberately: the
  detail view is the useful half of what the room offered, and a body tap that
  only popped a notice would make the biggest target on the card do nothing but
  nag. Writing cards are unaffected — they go to the reader (§9.12).
- **`notice.js`** is the new shared transient message card: glass card, 0.95 m
  in front at eye height, yaw-only placement, 3.2 s hold (4.6 s under reduced
  motion, no fade), tap to dismiss early. Two things it had to get right:
  - **An opaque backing plate.** The glass card alone was not enough. Measured
    at its maximum `uOpacity` 0.96, the bio card's paragraphs and the portrait's
    face were still plainly legible through the notice: the shader's fill is
    translucent by design and 0.96 is the clamp on that, not coverage. And
    `depthWrite` does not rescue an overlay — with `sortTransparentObjects:false`
    everything else has renderOrder 0 and has already painted by the time a
    renderOrder-20 card draws, so the depth write is too late to occlude
    anything (§3.6). Fix: a solid unlit rounded plate (`#0e0c09`) at the card's
    exact size and radius, one layer behind it. Layers are explicit: plate 20,
    glass 21, text 22.
  - **The mid-fade handle.** `hide()` clears `state.el` when it STARTS the fade,
    so a second `show()` a beat later found nothing to clean up and stacked the
    new card on the outgoing one — and if the fade never completed, the outgoing
    entity was orphaned in the scene graph for good. Found in testing, where a
    frozen GSAP ticker left exactly that (two notices, one at alpha 0.93).
    `state.fading` + `dropFading()` now yank it.

**Verified in-browser**, all four paths, with a spy on `VRProjectRoom.enter`:
photo card CTA → notice, 0 room calls; body tap → focus stage opens, no notice,
0 room calls; focus stage CTA → notice, stage still open, 0 room calls; photo
cloud "View full project" → notice, tile still selected, 0 room calls. Total
`VRProjectRoom.enter` calls across the whole pass: **0**. Pixel-checked that the
plate occludes: centre sample over the portrait went `[52,32,22]` → `[18,14,10]`
with the plate alone at full opacity.

`vr/_dev-preview.html` mirrors the flag so the harness behaves like the scene,
and now loads `scroll-arrows.js` + `notice.js` (the plate geometry comes from
`VRScrollArrows.roundedRectGeometry`, and without `VRNotice` any door click in
the harness would throw).

### 9.14 Skills panel: pull it to the reader (2026-08-27)

Sebastian: *"the skills panel that opens up is basically impossible to read,
let's have it open up and pull towards the reader sorta like the floating
images/cloud."*

It was unreadable for **four** separate reasons, and distance was only one:

| | before | after |
|---|---|---|
| Where it opened | docked off the bio card's right edge, x≈1.6, z −1.52 — ~46° off axis, seen almost edge-on | flies to 1.02 m in front of you, square to your gaze |
| Value type | `VRType.label()`, 0.022 m | `VRType.body()`, 0.028 m |
| Background | 0.72-opacity glass with nothing behind it — portrait, constellation and dome all read through the text | opaque plate under the glass, card at 0.96 |
| Panel width | 0.92 | 1.05 (fewer wrapped lines; it's invisible until opened, so this costs the composition nothing) |

- **The motion matches `focus-stage.js`** — eye 1.55 / 420 ms in, 280 ms out,
  `power2.inOut` — so the two "pull it closer" gestures in the scene read as the
  same gesture. **Correction (2026-08-30):** "exactly" was wrong. This panel and
  `card-flip.js` both fly to **1.02 m**; `focus-stage.js`'s `FOCUS_DISTANCE` is
  **1.05 m**. Three separate implementations of the same yaw-only "point D metres
  ahead of the head at height H, facing the viewer" construction exist and the
  distances have drifted. 3 cm is imperceptible so nothing looks wrong, but see
  §9.21 — this is the §9.12/§9.19 pattern again, and the comments asserted a
  match that never held. It grows out of the "+ View more skills" control you
  clicked (dock scale 0.34), not from the old docked slot.
- **The panel stays a CHILD of the bio card**, and the destination is converted
  into the parent's space (`worldToLocal` + the parent's inverse quaternion,
  with parent scale divided out). Reparenting to the scene was the alternative
  and is worse: `sunflower.js` resolves its aim through the parent's inverse
  quaternion (§3.9) and the card's layout writes into the panel's local
  transform, so both would need a special case.
- **`sunflower` goes quiet for the flight** and takes over on arrival. It aims
  the panel at the viewer, which is the same thing the fly-in's rotation is
  doing, and the two fight over the quaternion mid-tween.
- **Its own Close control, INSIDE the plate.** First pass put it at the panel's
  top-right *outside* the edge, following the focus stage's corner convention —
  which landed it straight over the bio card's heading, two off-white texts on
  top of each other. Now a band is *reserved* across the panel's top
  (`closeBand`) and the button sits in it, so no skill line can ever run under
  it and the contrast is known. The card's own "− Hide skills" toggle stays
  reachable too — measured, it sits at world y 0.83, well below the panel's
  1.34–1.76 band.
- Layers: plate `SKILLS_RENDER_ORDER` 12, glass 13, text 14 — above the focus
  stage's 10/11 (both can be open at once) and below `notice.js`'s 20/21/22.

**Verified in-browser:** lands at 1.02 m, world scale 1.0, facing the viewer
within **0.4°**, 2.8° off view centre; same numbers after turning the head 35°,
so it tracks the gaze rather than a fixed slot. Occlusion pixel-checked inside
the panel: background behind it `[43,34,27]`, plate alone `[14,12,9]` — exactly
`#0e0c09`, i.e. **zero bleed**. Close via the panel button and re-open via the
card's toggle both work, returning to dock scale 0.34 and hidden. Under
`?reducedMotion=1` it arrives at 1.02 m at full scale with no tween and closes
instantly.

### 9.15 Photo-cloud captions: a chip behind them, and a sane width (2026-08-27)

Sebastian: *"add a little background to the text for the cloud photos once they
are pulled in (the descriptions) because it gets hard to read."* Two causes, both
fixed in `photo-cloud.js`:

**1. Nothing behind the text.** The caption floats free below the tile, so
whatever it happens to be over sets its contrast — and in a cloud of 32 photos
that is often a near-white one. Measured on the worst case, the background
behind one caption ranged **11 to 216 luma**: off-white text at ~230 over 216 is
about **1.1:1**, i.e. invisible. A rounded chip (`#0e0c09`, alpha **0.92**,
`depthWrite: false`) flattens that ground to **12–28**, which puts the text at
roughly **11.8:1**. 0.86 was tried first and left another tile's caption
ghosting under this one at ~30 luma; 0.92 is where that stops without becoming
a hard slab.

- Sized from the caption's **real measured `blockBounds`**, not an estimate off
  fontSize × characters — these wrap to one, two or three lines depending on the
  alt text, and a fixed chip would either clip a line or float a slab under a
  short one. Which means polling for the measurement (§3.2) and building the
  chip **lazily**, on first reveal: 32 tiles × (poll + mesh) at load would pay
  for 32 backings when a visit reveals a handful.
- **It must sort one rung BEHIND its own text.** The chip is added to the
  subtree *after* troika's mesh (it had to wait for the measurement), and with
  equal renderOrder the transparent pass falls back to scene-graph order — which
  paints the chip over the words it exists to support. It carries a `__capBg`
  marker and `_setRenderOrder` gives it `order - 1`, so it stays behind through
  hover (5), select (10) and rest (0).
- Appears for **both** reveal states (hover/reach and select), via one
  `_setCaptionVisible` helper that replaced three scattered
  `cap.object3D.visible = …` writes.

**2. The caption was more than twice as wide as its own photo.** `maxWidth` was
`size * 2.2`, so a long alt string stayed on one line: measured 1.12 m in the
tile's units, ×1.9 when selected = a **2.2 m line at 1.15 m from the eye**, about
88° of yaw to read one sentence, with both ends off a phone's frame. Now
`size * 1.05` — it wraps to two or three lines *under* the photo, inside its
footprint, which is both easier to read and what a caption should look like.
Verified the "View full project" button still clears the taller caption block.

`remove()` disposes the chips — they are the one thing in the cloud built lazily
at runtime. (The tile meshes and their textures predate that method and are
still not freed; the cloud is never actually removed in the shipped scene.)

### 9.16 First Vision Pro session, and what it changed (2026-08-29)

Sebastian took /vr into an Apple Vision Pro for the first time. Six notes came
back; two of them had the same root cause, and it was not the one it looked
like.

**What it looked like:** everything was slow. Buttons "kind of laggy", "enter
room" taking "a few minutes", a photo in the cloud that "took forever" and never
selected, reader scroll buttons that "didn't even work at all".

**What it actually was:** two unrelated problems, neither of them frame rate.
Measured on the shipped scene before touching anything —

| | |
|---|---|
| Draw calls / triangles | 63 / 8,814 |
| GPU frame time at 3840×1824 (two eyes, M1 Pro) | **1.17 ms** |
| Downloaded on arrival | **50.9 MB** — 50.0 MB of it 34 images |
| Texture image data held | **~284 MB**, incl. full-res 24-megapixel photos |

The scene is cheap to draw and enormously expensive to arrive at. And input was
being dropped outright — see trap §3.13.

**1. Dropped input (trap §3.13).** New `xr-select.js`. This is the fix for
"laggy buttons", the unselectable photo, and most of the reader's dead scroll
controls. Read the trap; the scoping rules there are what keep Quest working.

**2. Arrival weight.** Three changes, and they compound:

- `.tools/vr-make-textures.py` writes a downscaled copy of every site image
  (≤1600 px long edge) to `vr/assets/tex` plus a `manifest.js`
  (`window.VR_TEX`), loaded as a plain script before any component — the same
  idiom as `window.VR_AUDIO`, so there is no fetch to sequence.
  **49.8 MB → 6.4 MB, 87% smaller.** An explicit map, not extension-guessing:
  two images legitimately have no derivative (their originals were already
  smaller) and one keeps `.png` for a real cut-out.
- `hub-panel.js` and `focus-stage.js` passed **no size cap** to
  `makeFeatheredImage`, so every glance card and every focus panel uploaded its
  hero at native resolution — `chess-hero` at 5712×4284 is ~130 MB on its own.
  Now 1024 and 1536. (`photo-cloud` was already 512, `project-room` 1024.)
- Texture loads are **queued, four in flight**, and `mosaic-reveal.js` — which
  ran its own `TextureLoader` and so was the one photo pair still arriving at
  full weight, on the home panel, first in view — goes through the shared path.

Measured after: **50.9 MB → 7.4 MB downloaded, 284 MB → 63 MB held**, no
fallback 404s.

**3. Land straight in VR.** *"When you clicked view in VR it still brought you
over to the page that said it's an ask for permissions and all of this stuff."*
Right, and doubly wrong in a headset: the disclaimer argues that the flat view is
a compromise, to someone who is not in one, and the motion-permission paragraph
describes an iOS dialog that will never appear. `onboarding.js` now branches on
`isSessionSupported('immersive-vr')`: headsets get one full-bleed tap target that
calls `enterVR()` inside the gesture, with a quiet "browse in this window
instead" escape. Flat desktop/phone keeps the existing gate untouched.

**It cannot be zero taps.** `requestSession` needs transient user activation and
an activation does not survive the navigation from the flat site's nav link. One
tap on arrival is the floor; the `sessiongranted` listener makes it zero on any
browser that can launch straight into immersive.

`?forcexr=1` / `?forcexr=0` pins either gate, so both can be checked on a
desktop that only ever answers one way.

**4. Skills panel — and the measurement that redirected the fix.** *"The skill
section was way too hard to read. When you hit more skills that card should be
bigger. Generally a good font size is the bio font size."*

The values were **already** at `VRType.body()` (0.028 m), and because the panel
flies to 1.02 m their cap height was **1.1°** — *larger* than the bio card's own
body text at 0.68°. Em size was not what was failing.

What was failing: each group was one **197-character** interpunct-separated run
wrapping to three lines across a panel **54° wide**. Reading it means sweeping
your head most of a right angle per line, then finding the start of the next with
no anchor. No font size fixes that. So: **one skill per line, in two columns**,
each column ~28.6°, type up to 0.034 (cap 1.34°), plate 1.05 × 0.564 →
**1.22 × 0.828 m**. All of it scales with `VRType.cardMult()` for a11y mode.

**5. Experience cards turn over.** *"It should just flip over, the same card, and
then talk about what I did, the bullet points breakdown."* New `card-flip.js`;
`type: 'experience'` no longer reaches the focus stage.

"The same size" could not be taken literally — a glance card is 0.50 × 0.34 m,
about nine lines at readable type, against bullet lists of fifteen to
twenty-five. Sebastian chose flip-and-grow: `GROW = 2`, ending at 1.00 m wide at
1.02 m, the same reading spot the Skills panel and the focus stage use. The back
is built at the front's size and scales with the card, so it is one continuous
turn rather than a pop to a new size. Content-fitted: measured 0.523 / 0.614 /
0.634 m tall for 2 / 3 / 4 bullets, uniform 0.055 m margins. Bullets at 0.030 m
(cap 1.18°) with a real hanging indent. Backs are built **lazily, on first
flip** — ten cards eagerly would be ~90 troika instances against 127 in the
whole scene, undoing part of the arrival work above.

Two things it took two attempts to get right, both worth knowing:

- **`animation__drift` clobbers position.** hub-panel gives every card a looping
  alternate animation on `position`; A-Frame rewrites position from anime.js's
  state every tick, so the first build scaled the card to 2× and turned it to
  face the viewer and it **sat exactly where it started** — scale and quaternion
  were free, position was not. card-flip pauses transform animations by
  PROPERTY, not by the `animation__drift` name.
- **`resumeAnimation`, not `playAnimation`.** A-Frame 1.5.0 has no
  `playAnimation`; guessing that name no-ops silently and the drift never comes
  back. And resume only the **looping** ones — see §3.13's knock-on note for why
  restarting an interrupted hover tween leaves the card 7% large at rest.

**6. Reader scroll: back to a rail, on the right.** *"The old buttons — the ones
on the side that had the tracker on it."* Version 1 was pads in a column on the
LEFT with the track beside them; version 2 was bars above and below the reading
band; this is version 3, one vertical rail — up pad, track+thumb, down pad — off
the page's right edge. Right, not left, on Sebastian's own reasoning that a
scrollbar lives there.

Both shapes now come out of `scroll-arrows.js` (`make()` and `makeRail()`),
sharing geometry, materials, hover feel and disabled state — the bars are still
what the writing column uses, which is Sebastian's own spec for it. One builder,
two shapes.

Measured in the reader: rail x 0.736…0.970 (page half-width 0.753, so flush with
the edge), y 0.873…2.127, clearing the exit button's 2.196 lower edge by 0.069 m.
Pads subtend **6.99° × 8.26°** — a generous target, which was the point.

**Accepted, and documented at the call site:** the rail sits ~25.4° off the view
centre, which is comfortable in a headset and **off-screen on a portrait phone**
(~±21° of field) — the same trade the exit button already makes at 26°. Per §9.4
the scene is not recomposed for phones. Do not "fix" it by pulling the rail onto
the page: a warm pad on white paper is very nearly invisible (see
`scroll-arrows.js` make()'s note, which is a measured finding, not a guess).

**Also in the reader: pages rasterise ONE AT A TIME, nearest first.** pdf.js
rasterises on the main thread and a page canvas is ~1314 × 1700 (2.2
megapixels); `updateRenderWindow` handed it all three pages in the window at
once, so a scroll tap that crossed a page boundary interleaved two or three
multi-megapixel rasterisations. That is the part of "the up and down buttons were
super laggy" that xr-select does not explain. `RENDER_PX` is deliberately NOT
reduced — the visible band works out at ~30 pixels per degree against a Vision
Pro's ~34, so lowering it would show as soft type.

Serialising introduced one new failure mode and it has a guard: a single render
that never settles would block every page behind it. There is a 4 s watchdog that
releases the queue. It was not a hypothetical — it fired during testing.

**What could NOT be verified here, and needs the device:**

- Headset input end-to-end. `xr-select.js` was exercised with a synthetic
  `transient-pointer` event burst (correct ray, correct entity, correct
  mouseenter → click → mouseleave order, correct hit at 1.59 m and 2.03 m, hidden
  clusters correctly unhittable, `tracked-pointer` correctly ignored) — but not
  with a real pinch.
- Actual PDF page pixels. The pane's rAF fell to **0.2 fps mid-session** (see the
  memory note; it was 120 fps an hour earlier), and pdf.js's rasteriser needs
  real rAF. Shimming rAF onto a MessageChannel did not free it. The rail
  geometry, the serialisation (`concurrent: 1`) and the watchdog
  (`concurrent: 2` after the timeout) are all verified numerically; the page
  bitmaps are not.
- Frame rate in a headset. Nothing here should have made it worse — the changes
  reduce work — but no claim is made.

---

### 9.17 "It still takes forever" — and it wasn't slowness (2026-08-29, later)

Second Vision Pro session. *"It still takes forever to load stuff, like going
into rooms. And when one thing loads and I click on it, it lets me load and
clicks on something else. If there's a load happening, that should be shown to
the user."* Then, crucially: *"I couldn't even flip the cards to read them after
I tried opening the reading room."*

That last sentence is what cracked it. It was not slowness. **Three defects were
stacked, and together they read as "the reading room is broken".**

**1. Every download happened before the only feedback there is.** `open()` ran
`loadPdfJs()` → `getDocument()` → `getPage(1)` and only THEN called
`runTransition()`. So the tap bought pdf.min.js (320 KB) plus
pdf.worker.min.js (1,087 KB) — 1.41 MB of JS, two round-trips to a CDN origin the
page had never spoken to — plus the document, with nothing changing on screen.
Meanwhile the hub stayed fully visible and fully clickable, so of course you tap
again, and the second tap lands on whatever your ray is on.

**2. It committed to the room with nothing to show.** Measured on the shipped
build at the instant the transition completed:

| | |
|---|---|
| Hub clusters hidden | 6 of 6 |
| Rig teleported to | (0, 0, 12) |
| Page planes with a texture | **0 of 7** |
| Placeholder tone / room sky | `#15120e` on `#040404` |

A black room containing near-black rectangles, with the entire hub gone. **That
is the "I couldn't flip the cards"** — the Experience cards are `.hub-cluster`
children, so the reader had correctly hidden them. He was standing *in* the
reader without it looking like one, with nothing to read and no obvious way back.

**3. No re-entrancy guard.** `if (state.open) close()` only catches a reader that
has already finished opening; through the whole async window `state.open` is
false, so every impatient tap started another full load. One accident was masking
it — a second `runTransition` kills the first one's tween so the first build
callback never fires — but that is luck, not design.

**The fixes.**

- **`busy.js`** — one loading card and one input gate. The card appears in the
  SAME FRAME as the tap, names the stage, and shows real byte progress from
  pdf.js's `onProgress`. The gate is a single **capturing** `click` listener on
  the scene: A-Frame's `emit` bubbles, so a capturing listener on an ancestor
  runs before the target's own handler and `stopPropagation()` there stops it
  reaching hub-panel, photo-cloud, ui-button — every input path at once,
  including xr-select's synthesised clicks, with no per-component change.
  Verified: four impatient taps during a load, **zero** reached any handler.
  Clicks on the card itself pass through so Cancel works; a stray tap does
  nothing rather than cancelling, because "taps doing something unintended" was
  the complaint. The DOM overlay is outside `<a-scene>` and deliberately not
  gated — there is always a way out.
- **Page 1 is rasterised BEFORE the dip.** You arrive with something to read.
  Bounded at 6 s: waiting puts a pdf.js rasterisation on the critical path, and
  if it never settles the reader would hang on the spinner forever, which is
  worse than the bug. After the timeout it enters anyway and the render queue
  finishes behind the transition. Verified both ways.
- **A real re-entrancy guard** (`opening`). A repeat tap on the same piece is a
  no-op; a tap on a different one cancels and retargets. Cleared in `close()`.
- **Failure restores.** A throw past the transition used to leave the hub hidden
  and the viewer stranded in an empty alcove. Now `close()` runs, or a notice
  appears if it failed before entry.
- **pdf.js is prefetched on idle** (`VRPdfReader.prefetch()`, called last in
  index.html's data-wiring under `requestIdleCallback`). The worker needs its own
  warm — pdf.js only fetches it on the first `getDocument()` — so there is a bare
  `fetch(..., {cache:'force-cache'})` for it. Verified: both files land at
  **766 ms and 798 ms after arrival**, before any tap.
- **Placeholder tone `#15120e` → `#2a241c`**, so an unrendered strip reads as
  pages waiting rather than a hole in the room.
- **The photo cloud re-prioritises on select.** Sebastian: *"it's the rooms and
  pulling an image from the cloud to read."* 32 tiles behind a 4-at-a-time queue
  means the tile you pick can be twentieth in line — and until it lands,
  selecting it pulls an EMPTY frame to your face and holds it there. Nothing was
  broken; the queue just had no idea you were looking at it.
  `VRGlass.prioritiseTexture(url)` moves it to the front.
- **The PDFs are ~41% smaller.** `.tools/vr-shrink-pdfs.py` recompresses embedded
  images (170 DPI threshold → 150 target, quality 72) with Sebastian's approval
  to do it in place, so the flat site benefits too. **11.27 MB → 6.62 MB**; the
  glasses-frames piece **7.1 MB → 3.5 MB**. Every file is verified before it is
  replaced: same page count, and every page re-rendered at 110 DPI and compared
  pixel-for-pixel — worst mean channel difference **0.85 / 255**. Two files saved
  under 10% and were left alone. Pushing to 96 DPI / q65 bought only 2.5% more
  and doubled the visual difference, so 150/72 is the floor worth taking; the
  remaining 3.5 MB is 28 separate photos with no dominant one. All six PDFs
  re-verified through **pdf.js**, not just MuPDF — correct page counts and page
  geometry.

**The shape of the lesson:** every symptom here was reported as "slow", and none
of the fixes made anything faster except the prefetch and the PDF shrink. What
was actually wrong was ORDER — feedback after the work, commitment before the
content, and no gate on input in between.

---

---

### 9.18 The clock, not the code (2026-08-29, third session)

Third Vision Pro session. *"The new loading card appears, its text is visibly
overlapping / mushed up, the progress bar sits at about 30%, and then eventually
it just closed."* He was **never moved** — no reading room, no "Back to the
dome" button anywhere. And afterwards, **the Experience cards would not flip**:
*"that feels like a really low bar thing that should just work, all it's doing
is flipping over."*

**One fact explains all of it. `window.requestAnimationFrame` is not serviced
inside an immersive WebXR session, and both GSAP and pdf.js are built on it.**
Read trap §3.14 — it has the mechanism and the measurements. The short version:
A-Frame's loop moves to the session's clock and keeps running, so the scene
draws and components tick and `xr-select.js`'s clicks keep working, while GSAP's
ticker — which rides the window's rAF and nothing else — stops.

Replay the report against that, line by line:

| what he saw | what was happening |
|---|---|
| the loading card appears immediately | `busy.js` sets it visible directly, and `busy-follow` is a tick component. Not on the broken clock. |
| its text is mushed up | a real, separate layout bug — hardcoded y offsets, §5.3 below |
| the bar sits at ~30% | `busy.js` parked an indeterminate bar at a hard **0.34**, and `'rendering the first page'` was exactly that stage |
| *"eventually it just closed"* | not the reader closing — the **loading card** going away when `rasterisePageOne`'s 6 s timeout fired and `done()` ran |
| he was never moved, no way back | `runTransition()` is a GSAP tween and the room is built in its `onComplete`. Frozen clock, no callback, no room. |
| the cards will not flip | `card-flip.js`'s `flipTween()` is `gsap.to(...)`. Same clock. |
| clicks worked throughout | the control that proves it: `xr-select.js` has no clock in it |

The pieces fit so exactly — including *"eventually it just closed"*, which is a
6-second timeout and nothing else — that the diagnosis is not really in doubt.
But it has not been measured **on the device**, and that distinction is the whole
point of §3.16, so it is marked accordingly below.

**Why it survived this long.** Every GSAP-driven behaviour in this scene has only
ever been exercised outside a session — on a desktop, or in the preview pane with
`?reducedMotion=1` forcing the synchronous paths (which is how §9.12, §9.13 and
§9.14 were all verified). The reduced-motion paths bypass GSAP entirely, so they
were the **only** paths that worked in a headset. That is a warning about the
harness, not about those passes.

#### What was changed

**1. `xr-frame.js` — the one fix for the one cause.** A system whose `tick()`
drives `gsap.ticker.tick()` while `renderer.xr.isPresenting`. One file repairs
the flip, both room transitions, the reader's scroll, the skills fly-in, the
photo cloud, the focus stage, the notice fade and the column scroll, because all
of them were waiting on the same clock. A *system* rather than a component so
there is no markup to forget (§9.12's `.hub-cluster` bug is why). It also
publishes `VRPoll` — see trap §3.15.

`?pump=0` disables it. **That is the control half of the on-device A/B**, and it
is the thing worth running first, while the bug still reproduces.

**2. `xr-diag.js` + `?xrdiag=1` — an instrument that works in a headset.**
Trap §3.16. Samples window rAF vs XR rAF vs scene tick vs `gsap.ticker`, runs a
real tween end to end, counts `setTimeout` fires against expectation, reads
`document.hidden` / `visibilityState` / `session.visibilityState`, and puts the
numbers **on a card in the scene** with a plain-language verdict.

**3. pdf.js is gone from the reader.** Sebastian's call, and it is the right one
regardless of the clock: pre-render every page at build time and load the
results as ordinary textures, because an `<img>` decode is not on the rAF clock.

- `.tools/vr-make-pages.py` → `vr/assets/pages/<stem>/pNNN.webp` + a
  `manifest.js` publishing `window.VR_PAGES`. Same idiom as `window.VR_TEX`: a
  plain script tag, no fetch to sequence, an explicit filename map rather than
  guessing. Discovers its inputs the way `data-loader.js` does — any PDF linked
  from a project page — so a new piece needs no edit here, just a re-run.
- **150 DPI, long edge capped at 1700 px, WebP q86.** WebP measured both smaller
  *and* more faithful than JPEG on this content: on the worst text-heavy page,
  175 KB at mean channel error **0.33/255** against JPEG q85's 255 KB at
  **0.68**. Format is a build-time decision — the manifest carries filenames —
  so changing it later touches no code.
- **80 pages, 10.56 MB shipped, 135 KB/page average.** Opening a piece now costs
  **one ~146 KB image** against the old 1.41 MB of pdf.js plus up to 3.5 MB of
  PDF. The 28-page text piece is the expensive one (5.58 MB from a 603 KB
  vector-text PDF — rasterising vector type is where the expansion lives).
- Page loads go through **`VRGlass.loadTexture`**, the scene's one four-at-a-time
  queue, with `prioritiseTexture()` moving the page you are on to the front. That
  deleted the bespoke render queue, its render token and its 4 s watchdog — all
  three existed only because pdf.js rasterised on the main thread and could hang.
  `loadTexture` gained an optional third `onError` argument; without it the
  failure path was silent, which is the shape of bug this codebase keeps finding.
- The ±1 page window and disposal are unchanged: **3 pages held = 24.1 MB** of
  texture, in line with §9.16's budget.
- `prefetch()`, `warmWorker()` and index.html's idle warm-up are **deleted**.
  There is nothing left to warm.
- A piece with no pre-rendered pages shows a notice and names the fix in the
  console. There is no runtime fallback on purpose — the rasteriser was the bug.

**4. PAGE WIDTH IS NOW CAPPED, and this one is a visible design change.** Two of
the five pieces are **16:9 slide decks**, not letter portrait, and the reader
sized pages by height alone. Arithmetic straight off the shipped constants:
those decks were **1.95 × 3.46 m at 1.9 m from the eye — 84.7° of yaw to read
one line**, with the scroll rail 44.0° off view centre against the portrait
case's 24.2°. `PAGE_MAX_W = 1.55` caps displayed width at the portrait page's own
width, so every document reads at the same size and the rail and exit button land
in the same place in all five (§9.10.7 is the same lesson: consistent placement
is an angle, not a corner). Page 1's framing generalises with it: instead of
"bottom at knee height", `LEAD_FRACTION` keeps **0.436 of the page above eye
level** whatever the page is. **Letter portrait is untouched to the millimetre** —
1.95 × 1.5068, `topY1` 2.4500, step 2.0500, page 1's bottom at 0.5000, and
`maxScroll` identical to the old formula. Verified against the shipped source.

The cap is also what makes the texture budget work: 1700 px over 1.55 m is
**38.3 px/deg** against a Vision Pro's ~34, where 1700 px over the uncapped
3.46 m would have been **20.1** — visibly soft. One number to reverse it if
Sebastian wants cinema-sized slides, but then the generator needs ~3000 px pages.

#### The four §5 bugs

1. **The input gate could leak — confirmed, fixed.** `pdf-reader.close()` cleared
   its own `opening` guard and never called `VRBusy.end()`. `busy.js`'s gate is a
   *capturing* click listener on `<a-scene>`, so a job that is begun and never
   ended leaves **every click in the scene dead until reload**. Worse than it
   looks: the release was inside `runTransition`'s callback, i.e. behind the very
   GSAP tween that had stopped. `close()` now calls `endBusy()` and clears
   `opening` **synchronously**, before the transition. This is the best candidate
   explanation for the cards not flipping *on a second attempt* — and note it is
   a **separate** cause from the clock, which is why the two had to be chased
   apart. `clearAll()` is now a real backstop instead of a function nothing
   called: a job with no `update()` for 30 s is force-ended from the tick (from
   the tick, not a timer — the timer is the other clock that may not be running).
2. **`state.open` on the cancelled path — confirmed, fixed.** It was set before
   the last await, so a cancel left a phantom-open reader: `state.open === true`
   with no root, no rail and a visible hub, and the next tap's
   `if (state.open) close()` ran a teardown against nothing. It is now set inside
   the transition callback, which removes the window entirely rather than adding
   a reset to it.
3. **The loading card's fixed offsets — confirmed, measured, fixed.** Title at
   `topY`, stage line at `topY − 0.056`, bar at `topY − 0.104`, on a plate of
   fixed height 0.276. With `Opening “Social Engineering via Predictive
   Algorithms”` wrapping to three lines at 0.038 m in a 0.67 m column, the
   measured overlaps are **title/stage 30.0 mm, title/bar 22.0 mm, bar/cancel
   22.0 mm**. That last one exists at *every* title length — the progress bar ran
   straight through the Cancel button. Now `text-flow`-style measured stacking:
   the title is measured, the plate is sized from it, and the gaps come out
   uniform at **16.0 / 18.0 / 24.0 mm** at one, two and three lines, with
   everything inside the plate. The stage line's height is *reserved* at two
   lines rather than measured, because it changes on every update and a plate
   that resizes while you watch it reads as a glitch.
4. **The 30% bar — confirmed, fixed.** `setFraction(0.34)` when there was no byte
   total, which is indistinguishable from a download stalled at a third, and it
   is what Sebastian was looking at for the whole of the stage that was actually
   failing. Indeterminate now *looks* indeterminate: a 0.24-wide segment shuttles
   the track on an eased ping-pong, **driven from the tick** so it keeps moving
   inside a session. Reduced motion gets a static, obviously-partial segment
   rather than a number it does not have.

#### What is verified, and how

**Verified on the device: nothing.** No Vision Pro here. Every in-headset claim
below is marked, and `?xrdiag=1` exists precisely so the next session can settle
them in one tap.

**Verified against the pinned library sources** (read, not remembered):
`setAnimationLoop(this.render)` and `render()` → `tick()` → components **and
systems** in aframe 1.5.0; `WebXRManager` replacing `setAnimationLoop` in
three r158; gsap 3.12.5's ticker on `requestAnimationFrame`; A-Frame's own
`animation` component driven from `tick(t, dt)` — which is why `animation__drift`
keeps working in a headset while every GSAP tween stops, a useful differential
tell.

**Verified headless in JavaScriptCore against the real gsap.min.js 3.12.5**, with
no rAF in the sandbox at all (`osascript -l JavaScript` — there is no node here):
tween frozen with no tick; +0.2440 of a 500 ms tween from one manual tick 120 ms
later; **no advance across three further ticks 0 ms apart** (the no-double-drive
property the pump depends on); run to completion with `onComplete` when ticked at
11 ms; chained `onComplete` completing; and no `visibilitychange` listener
anywhere in the dist.

**Verified numerically against the shipped source** (constants and functions
extracted from the file so the test cannot drift from the code): all reader
geometry, both aspects, letter portrait bit-identical to the old constants;
`xr-frame`'s pump gating (0 ticks not presenting, every tick presenting, stops on
exit, `?pump=0` off, `is('vr-mode')` fallback); `VRPoll` in all three regimes
(tick-only, timeout-only, both — exactly `attempts` calls, no doubling), plus
`onGiveUp`, `cancel`, and a throwing poll being dropped; `busy.js`'s stacking at
one/two/three lines with the overlap numbers above.

**Verified in-browser** (new `vr/_dev-reader.html`, a lean harness — the full
scene wedges this session's preview pane outright, and the pane reported
`hidden: true`, **1 rAF frame per 400 ms** and `scene.time 0`, so this ran on
`?reducedMotion=1` plus hand-pumped `sceneEl.tick()`, per §9.10.10):

| Check | Result |
|---|---|
| `VR_PAGES` loaded | 6 documents |
| pdf.js requested at any point | **no** — `window.pdfjsLib` undefined, nothing in the network log |
| `VRPdfReader.prefetch` | gone |
| Loading card up in the same frame as the tap | yes, gate on |
| Bar state with no byte total | indeterminate, 0.24 segment — not 0.34 |
| Plate height once troika measured a wrapping title | **0.3837 → 0.4274 m** |
| Reader opened | yes |
| Page plane, portrait | **1.9500 × 1.5068**, `topY1` 2.4500, `maxScroll` 15.2000 |
| **Page 1 carrying a real image** | **yes — 1275×1650** |
| Rig / hub / exit button | rig at z 12, hub hidden, exit button present |
| Textures held | 2, then 3 — never more |
| Window after scrolling 3 pages | pages `[2,3,4]` around index 3; page 1 disposed |
| Close | root removed, hub back, rig at 0, gate off |
| 16:9 deck | 19 pages, width **1.5500** (was 3.4639), height 0.8726 |

**Unverified, and it needs the headset:**

- That window rAF is actually dead (or merely starved) in visionOS Safari. The
  library reading says it must be; the *rate* matters for how the symptoms read
  and only the device can say. `?xrdiag=1` answers it.
- Whether `document.hidden` becomes true in a session, and whether `setTimeout`
  is clamped there. Same card answers both.
- That the pump repairs the flip and the transitions **in a headset**. The
  mechanism is verified; the integration is not.
- Page image sharpness as actually seen through the lenses, and whether the
  capped 16:9 slides read well at 1.55 × 0.873 m.

#### How to run the A/B on the device

Two taps, and run the first one **first**, while the bug still reproduces:

```
https://sesteva.com/vr/?xrdiag=1&pump=0     control — expect: window rAF ~0,
                                            GSAP frozen, test tween 0%
https://sesteva.com/vr/?xrdiag=1            fixed  — expect: same window rAF,
                                            pump ticking, test tween 100%
```

Then, with `?pump=0`, try to flip an Experience card (it should not flip) and
with the flag off try again (it should). Screenshot the card both times.

#### The shape of the lesson

§9.17 ended on "every symptom was reported as slow, and what was actually wrong
was ORDER." This one is narrower and sharper: **the scene had two clocks and only
one of them survives a headset.** Everything built on A-Frame's tick worked;
everything built on the window's rAF stopped. Nothing logged, nothing threw, and
a desktop cannot tell the difference — which is why it took three sessions and
why the instrument (§3.16) matters more than any single fix here.

---

### 9.19 The projects zone was spinnable, and that was the bug (2026-08-30)

Sebastian, testing the §9.18 deploy on desktop: *"never seen this happen before
— but when viewing this in desktop I was suddenly able to move the entire set of
project cards around. So that's a glitch worth fixing."* His screenshot shows the
projects grid swung round to face him with the writing column skewed off to the
right.

**Not new, and not a regression from §9.18** — nothing in that pass goes near it.
`#projectsConstellation` carried `carousel-drag` (ISSUE-03), last touched at the
beta ship. It is reachable only by pressing *on a card* and dragging past a 6 px
threshold, so a session spent clicking cards never finds it; a session spent
using the reader eventually does.

**Why it stopped being a feature.** It was built for the layout in §4/§6: ONE
4-column grid holding all ten items, where spinning the cylinder was how you
reached the far cards. §9.1 split that grid in two, and after the split the
projects zone is 5 cards in 3 columns spanning ~70° — and its *position is its
contract*: 7° of clear dome to the writing column inboard, ~9° to the photo cloud
outboard, and §9.9 measured **zero overlaps at every camera waypoint**. You
cannot verify a no-overlap guarantee on a zone the visitor can rotate. An
unbounded yaw walks that 70° block across the writing column, the bio card and
the cloud, snaps onto a detent up to 33° from home, and **stays there** — there is
no way back short of a reload. And spinning reveals nothing, since all five cards
are visible at once; the same reasoning §9.2 already uses to leave the writing
column unscrolled at five pieces.

It was also eating clicks: 7 px of trackpad slide spun the grid instead of
opening the card.

**Fixed by detaching it**, which is the decision already documented one line
below it in the markup for the writing column (*"Deliberately NOT carousel-drag:
a single column has nothing to spin"*). The attribute is gone, the `onColStep`
hook in `layoutCluster` went with it (that snap-angle wiring was its only
consumer), and the script tag is commented out the way `portrait-layout.js`'s
already is — registered-and-unused is dead arrival weight (§9.16). **The file is
kept** with a box at the top explaining what to fix before re-attaching it.

**Reachability, for the record:** mouse and touch (so desktop *and* the phone
fallback), plus a Quest trigger via `_grabStart`. **Not** reachable on Vision
Pro — no controllers, and `xr-select.js` mutes the hand raycasters (§3.13). So
this never affected the device the last three sessions were about, which is why
it surfaced only now.

**If the physicality is wanted back**, `snapDeg: 0` springs the zone home instead
of settling where it lands — but it still sweeps the neighbours mid-drag, so the
honest version needs a travel bound with a soft edge, the way `walk-controls.js`
bounds the rig (§9.5).

**The general lesson, and it is worth carrying:** §9.1 changed the *meaning* of a
zone from "a carousel you spin" to "a section that sits somewhere specific", and
an interaction attached to the old meaning survived the change. When a layout
re-plan lands, audit the interactions attached to what moved — not just the
geometry. Grep for components on the containers a re-plan touches.

---

### 9.20 The card flipped back one half-turn too far (2026-08-30)

Sebastian, on desktop: *"the process of opening a card to be read (for my
experiences) is good in desktop. But when you exit from reading my experience
and the card goes back, it goes back with the back facing you and VERY very
slowly turns back around. Let's make it flip up for you to read, and then flip
back into its base state."*

**Two symptoms, one cause, and the slow part was the symptom.**

`card-flip.js` composes the turn out of two things — a slerp of the BASE aim
(home aim → facing you) times a yaw about the card's own Y that carries the
turn-over — because a straight slerp across ~180° picks an ambiguous shortest arc
and comes out as a tumble. Correct. But the yaw was written `extraYaw * t`, i.e.
ramped from 0 to its full value across the tween, and `turnHome` passed
`extraYaw = -PI`. So the way home ended at:

```
home.quat * yaw(-PI)
```

**180° from the card's own home aim** — front pointing away. The *motion* looked
right (180° of turn either way), which is exactly why it read as "it flipped, and
then something else is wrong". What happened next is that `turnHome` hands the
card back to `sunflower.js`, which re-aims panels at the viewer at a rate limit
of **~17.4°/sec** (§6). 180° at 17.4°/sec is **10.3 seconds** of the card slowly
swivelling itself round. That is the "VERY very slowly turns back around", and
it was sunflower doing its job on a card that had been left backwards.

**The fix** is to interpolate the yaw between two explicit endpoints rather than
ramping it to a fixed one: out runs `0 → PI`, home runs `PI → 0`. Both then land
with no extra yaw applied, on the base pose they started from.

Two details that make it exact rather than approximately right:

- **`cardEl.__flipYaw` records how much yaw is applied right now.** With that,
  `basePose()` can recover the base aim as `current * yaw(-__flipYaw)` — which is
  exact even if a turn is interrupted half way, so a card closed mid-open resumes
  from where it actually is instead of jumping.
- **`__flipHome` is stored as a BASE pose**, not the composed one. At rest
  `__flipYaw` is 0 so this is identical in the normal case; it matters only for
  the interrupted one.

**Verified with real quaternion arithmetic against the shipped `apply()` and
`basePose()` text** (extracted from the file by regex so the test cannot drift
from the code), at four home aims spanning the Experience zone's range
(−74°, −46°, 0°, +37°): reading pose 180.00° from the face-you aim in every case
(back toward the viewer, as intended), and home **0.00000° / 0.00 mm / scale
1.0000** in every case. The same harness reproduces the old path landing
**180.00°** out.

**Verified in-browser** (`vr/_dev-gate.html` step 8, on a REAL GSAP tween driven
by the §9.18 pump, so it exercises both fixes at once): reading at scale 2.000
with `__flipYaw` 3.142 rad; home at **0.0000°, 0.00 mm, scale 1.0000,
`__flipYaw` 0.0000**, `__flipped` false.

**The lesson:** a rate-limited corrector downstream of a broken transform turns a
wrong *endpoint* into a slow *animation*, and slowness is what gets reported.
§9.16 and §9.17 both went the same way. When something in this scene is described
as slow, find out what is quietly correcting it — `sunflower.js` here,
`lagSmoothing` in §3.14 — before believing the frame rate.

---

### 9.21 Integrity audit (2026-08-30)

Run against `VR_INTEGRITY_AUDIT_PROMPT.md`, which set the priority order:
correctness and robustness, then arrival, then session memory, then frame time,
then maintainability. **The most useful outcome was how much got dismissed.** A
mechanical sweep produced seven leads; three were real, three were explained
away with measurements, and one was left alone deliberately.

#### Confirmed and fixed

**1. `focus-stage` leaked on every open — 2.00 geometries and one hero texture.**
Measured with `renderer.info.memory` over two matching blocks of ten opens
(+20 / +20). The cause is worth the retelling: the file **already had** the
correct helper. `setPanel()` disposes the previous panel and its comment says
"three.js never auto-disposes, and this runs on every open" — and
`buildExperience` uses it, which is why experience cards measured perfectly
clean. `buildProject` built its panel inline and bypassed it, and nothing ever
freed `stage-image` either. `close()` does not clear the stage at all; the *next*
`open()` does, via `clearStage`, which unlinked without disposing.

Routing `buildProject` through `setPanel` fixed two more things in the same edit,
both of which had been silently missing from the project path only:

- **`mat.depthWrite = true`** — `setPanel`'s own note records that leaving this
  false was "the real reason this panel still read as see-through", because with
  no depth written every constellation card behind the panel blends through it
  however high `uOpacity` goes. Experience cards had the fix. **Project cards did
  not — and since §9.13 a photo card's body tap goes to the focus stage, so that
  is the path a visitor is most likely to take.**
- **`mesh.renderOrder = 10`**, which is the number `liftContentAbovePanel`'s 11 is
  measured against. The inline panel sat at the default 0.

After: **0.00 geometries per open**, and `Texture#dispose` called 22 times across
23 opens — which is also the confirmation that the texture half was real
(`makeFeatheredImage` calls an uncached `loadTexture`, so each open made a new
one) and is now freed.

**2. The same bug in three more teardown paths**, all fixed through one new
helper rather than four copies of the same six lines — see trap §3.17 for
`VRGlass.disposeSubtree` and the memoised-shared-texture exclusion that makes it
safe:

- `ui-button.remove()` — buttons are built and thrown away constantly (every
  focus stage, notice, loading card, card-flip back and reader rail carries some).
- `xr-diag.destroyCard()` — "Run again" is a real teardown path. Written badly in
  §9.18 by the same author as this audit.
- `project-room.js` exit — sealed behind `window.VR_ROOMS` so it leaked nothing
  in practice, but each `enter()` builds a plate plus a 1024 px feathered image
  per room photo and would have leaked the moment the flag flipped.

**3. `.DS_Store` was TRACKED and deployed** — two of them, repo root and
`images/`. This is why `git status` showed a modified `.DS_Store` on every
machine that had ever opened the folder in Finder. Untracked and now ignored.

**4. `?v=` had drifted, live** — `project-room.js` was v22 in `index.html` and
v23 in `_dev-preview.html`; `sfx.js` was v5 against v4. The harness was loading
**different files than the scene** for those two, which is precisely the false
result rule §2.8 exists to prevent, and it is invisible until it bites.

Healed, and the harness now **checks itself**: it fetches `index.html` on load,
compares every `?v=`, and logs loudly on a mismatch. It runs only in the harness
(the shipped scene never loads that file), costs one cached fetch, and needs no
build step.

**5. `bio-card`'s overflow warning fired on every single page load and was
mislabelled.** It said "content overflows the card by 0.009 m". What it actually
measured was encroachment into the bottom *margin*: `padY` is `h * 0.04`, so on
the 1.46 m card that margin is **58 mm**, and 9 mm into it means the last block
still ended **49 mm above the card's edge**. Nothing was clipped and nothing was
off the card. It now warns only when content genuinely runs past the card edge —
which is the signal its own comment always described ("this is the signal that
the card needs to be taller"). The irony is that a guard was added one pass
earlier for exactly this reason, against the estimate pass, with the note that
the noise "made the real signal easy to dismiss".

**6. Three copies of one reading transform, already drifted.** `bio-card`'s
skills panel and `card-flip` fly to **1.02 m**; `focus-stage`'s `FOCUS_DISTANCE`
is **1.05 m**. `card-flip` carried the comment `// matches bio-card's Skills panel
and focus-stage`, and §9.14 claimed the motion "matches `focus-stage.js` exactly
— 1.02 m". Both were false. 3 cm is imperceptible so nothing ever looked wrong,
and the *comments* are what was fixed here — see "not done" below for why the
code was not.

#### Dismissed, with the measurement

- **"61 allocations against 15 `dispose()` calls."** A crude ratio, and treating
  it as 46 leaks would have been the first available mistake. Most of the scene
  is built once and lives forever, where no dispose is correct. Audited by
  build/teardown pair: **four real leaks**, all above.
- **`notice`, `busy`, `card-flip`, `pdf-reader`: all clean at 0.00 per cycle.**
  Three of them looked like leaks in a single-block test (+8, +11, +3) and the
  two-block design proved all three were warmup. That methodology is the finding
  — see §3.17.
- **`photo-cloud`'s undisposed tiles** (§9.15's own admission): the component is
  never removed in the shipped scene, so the non-disposal is inert. Correct as
  documented.
- **"97 `addEventListener` against 23 `removeEventListener`."** Explained: every
  listener on a shared target (`window`, `document`, the canvas, the scene)
  belongs to a page-lifetime singleton — `fallback`, `hud`, `onboarding`, `sfx`,
  `glass-material`'s light system — where permanence is the intent. The two
  components that are genuinely per-instance with teardown (`walk-controls`,
  `name-scatter-3d`) both clean up fully, and so does `carousel-drag`.
- **The `renderOrder` tie.** `photo-cloud`'s selected tile and `focus-stage`'s
  panel are both 10. **No reachable co-visible state could be constructed** — the
  cloud is behind the hub, a selected tile sits in front of where you were
  looking when you selected it, and the focus stage opens in front of where you
  are looking now, so seeing both means facing two opposite directions. Left
  alone, per §3.6's warning that a speculative renumber breaks compositing that
  works. **Documented instead**: §3.6 now carries the full layer table, the tie is
  named, and the resolution is pre-decided if the cloud ever becomes reachable
  from the hub's side.

#### Not done, and why

- **The three reading transforms were not unified.** It is the §9.12/§9.19
  pattern and it will bite eventually, but the fix touches `bio-card` (1,048
  lines, and §9.4 is a record of two real bugs in its layout path) and
  `focus-stage` for a 3 cm difference nobody can see. Not worth carrying that
  regression risk in the same pass as a real leak fix. The comments are corrected
  so the next editor is not misled, and a shared
  `readingPoint(distance, height)` helper is the obvious follow-up.
- **The nine bare `setTimeout` poll loops** (trap §3.15) are still bare. Migrating
  them is gated on a measurement nobody has taken: whether visionOS backgrounds
  an immersive session and clamps timers. `?xrdiag=1` reports it. Nine working
  loops is churn until that number exists.
- **Arrival weight was not re-measured.** §9.16's 7.4 MB / 63 MB predates the
  page-image change, so the number is stale, and `performance.getEntriesByType`
  needs an eval the pane would not give (see below). Re-measure on the device.
- **Frame time was not touched.** §9.16 measured **1.17 ms of GPU at 3840×1824
  with 63 draw calls** — about 7% of a 90 Hz budget. The brief said not to
  optimise a budget that is 7% used, and nothing here changed it.
- **`index.html`'s `layoutCluster`** stays where it is. It is genuinely
  page-specific and moving it buys a file, not a test.

#### Verification

Everything above is **verified-in-browser** (a new `vr/_dev-memory.html`, the
self-reporting pattern from §5, with components loaded on a timestamped src) or
**verified-by-reading-the-source**. **Nothing was verified on the device.**

One methodology note worth keeping, because it cost a full cycle: the first
"after" run still reported the leak, because the harness loaded its components as
plain `<script src="components/x.js">` with no query. Cache-busting the *page*
URL does not refetch a component whose own src has no query — **rule §2.8, from
the inside.** The harness now stamps every component src with `Date.now()`.

#### The shape of the lesson

Every real finding here was a **second copy of something that was already right
somewhere else**: `setPanel` disposed and `buildProject` didn't; the estimate-pass
guard existed and the real pass needed the same reasoning; `pdf-reader` had a
`disposables` array and three other teardown paths didn't; the `?v=` rule was
written down and two files had drifted from it. None of it was a missing idea.
All of it was an idea that had not been applied in the second place it belonged.
That is what an audit is for, and it is why the fixes here are one helper and
five call sites rather than five independent patches.

---

### 9.22 The phone's motion copy showed up on a desktop (2026-08-30)

Sebastian, on the live site: *"brought up the phone info when I was on chrome on
my mac."* The screenshot shows the flat arrival gate with the full phone
treatment — the *"Your phone is about to ask for motion & orientation access —
please tap Allow"* paragraph, and the button reading **"Grant permission to enter
the dome"** instead of "Enter the dome".

**Both of those are driven by one flag, so the diagnosis was forced.** The motion
paragraph is authored in the markup and *removed* when the flag is false; the
button label is the markup's "Enter the dome" and is *overwritten* when the flag
is true. Seeing both phone variants at once means `IOS_MOTION` was **true** on a
Mac.

It was tested as a pure capability check:

```js
var IOS_MOTION = typeof DeviceOrientationEvent !== 'undefined' &&
  typeof DeviceOrientationEvent.requestPermission === 'function';
```

on the assumption that **only iOS Safari implements `requestPermission`.** That
assumption has expired — some desktop Chrome builds now expose it. The check was
never wrong about what it tested; it tests "does this browser implement the
permission API", and the question being asked is "will a motion prompt appear on
a device where tilting means something". Those used to be the same question.

**Why it matters more than a wording slip.** The copy promises a laptop user they
can "look around by physically moving your phone", and the button then fires a
permission request for a sensor the machine does not have. §9.7 exists because
silently firing a permissions dialog is what gets it declined; asking for one
that cannot possibly help is the same mistake pointing the other way.

**Fixed** by requiring the capability **and** a touch device:

```js
var TOUCH_DEVICE = (navigator.maxTouchPoints || 0) > 0 ||
  !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
```

`maxTouchPoints` is what separates an iPad from a Mac — iPadOS reports
`platform: 'MacIntel'` and is otherwise indistinguishable — and `pointer: coarse`
catches anything reporting touch another way. It also **fails safe**: if this is
ever wrong on a real phone the visitor sees "Enter the dome" with no motion
paragraph and simply does not get tilt, and drag-to-look still works. The old
failure mode asked a desktop user to grant phone permissions.

**Verified against the shipped source** (declarations regexed out and evaluated,
so the test cannot drift from the code) across eight environments — Chrome on a
Mac with and without the API, Safari on a Mac, iPhone, iPad, Android Chrome, a
browser with no `DeviceOrientationEvent`, and a Windows touch laptop. All eight
correct, iPhone and iPad still true. **Verified in-browser** on this Mac: gate
present, motion block removed, label "Enter the dome"; and under mobile emulation
`TOUCH_DEVICE` flips to true (`maxTouchPoints` 5, coarse true).

**The lesson, and it is a general one:** a capability check is a claim about a
browser, not about a device. `typeof X === 'function'` answers "is this API
implemented here", and every time that gets used as a proxy for "is this the kind
of machine I think it is", it has a shelf life — it breaks silently when a second
engine ships the API, and it breaks in the direction of showing the wrong thing
rather than throwing. Anywhere this codebase branches on a capability to infer a
*device*, pair it with something about the device.

### 9.23 An intention gate, and the reading ruler (2026-09-06)

Two asks, one session.

**1. "It's pulling images towards me like crazy."** Sebastian, on the photo
cloud: *"whenever you look at an image it should just fly towards you … there
should be maybe a tiny count, like one second, roughly that, just so when
someone's looking through it's not pulling images towards them like crazy. So
there's a little more intention … maybe we can have a little animation of the
circle filling up. That's probably good for all things."*

`_focus()` used to run on the frame the ray arrived, so sweeping a gaze (or a
mouse) across the cloud fired every tile it crossed — up to a dozen 0.5 s
flights in the air at once, all of them reversing behind you. **`dwell.js`** is
the general mechanism: `VRDwell.start(el, {onComplete})`, one ring at a time,
and the photo cloud now arms it on `mouseenter` instead of reaching immediately.
Measured after: sweeping six tiles at 120 ms each moves nothing at all —
**0.0000 m of drift on all six**, no tweens, no hovered tiles.

Four decisions in that file worth not re-litigating:

- **It is NOT on the reticle**, which is the obvious place and is wrong here for
  a hard reason: `fallback.js` sets `reticleObj.visible = inVR`, so an arc drawn
  there is invisible to every desktop and phone visitor. The ring is anchored in
  the WORLD at the target, which is one implementation that shows up everywhere
  and also says something better — the circle fills up *on the photo it is about
  to pull*.
- **The clock is `performance.now()`, read on demand**, not an accumulated delta
  and not a `setTimeout` (§3.15 — a timeout could stretch a 900 ms gate to 1.5 s
  in a headset). Only the completion CHECK needs a heartbeat, and that rides a
  system's `tick` (§3.14).
- **900 ms, not 1000.** He said "roughly one second"; a ring that visibly fills
  reads as longer than it measures, and the last third of a full second feels
  like the scene has stopped answering.
- **A soft dark scrim behind the ring.** Off-white on an unknown background is a
  contrast gamble and here the background is always a photograph. Rendered and
  looked at: on a pale subject the ring nearly disappeared while reading fine
  over the dome's near-black — the classic "correct on most tiles" trap. Same
  tone as photo-cloud's caption chip (`#0e0c09`), which exists for exactly this
  reason, feathered rather than a hard disc.

**2. The reading ruler, in the reader.** *"I'm curious if we can use the same
feature that we have in the website for the line reader … so when you're looking
at a line, it'll highlight that line you're looking at to make it easier to read
it. And then the person with the cursor can basically push down, it'll highlight
the line below."* Then, mid-build: *"make sure it feels smooth and doesn't just
jump around. And add a button to turn it off by the controls, but have it be
turned on by default."*

**`reading-line.js`**, plus `.clickable` on the page planes and a begin/end pair
in `pdf-reader.js`. The hard part is that **there is no text to ask.** The flat
site's `initA11yLineHighlight()` reads `getComputedStyle(el).lineHeight`; the VR
reader shows pre-rendered page IMAGES (§9.18). So the lines are FOUND from the
pixels by a row-projection profile — and that turned out better than a computed
line-height, because each band lands on the ink actually there, so a heading, a
block quote and a caption each get their own correct height.

Verified against the real shipped pages, not synthetic ones: **31 lines on page
2 of HP's Reckoning at a 37.5 px pitch**, every band on a real line, the running
header's horizontal rules correctly rejected, short paragraph-final lines
getting correctly narrow bands. Rendered the bands back over the page image to
look at it rather than trusting the count.

- **It is polarity-agnostic on purpose.** Two of the five pieces are 16:9 slide
  decks. The profile counts deviation from the page's OWN dominant tone (a
  64-bin histogram; the fullest bin is the paper), so white-paper/black-type and
  dark-slide/light-type give the same answer. A fixed "luma < 158" would find
  every line in the essays and nothing at all on a dark deck.
- **It is a highlighter, not a backing bar, and that is forced.** The flat site
  lays a translucent off-white BEHIND its text. A rendered page is opaque —
  there is no behind — and the same off-white in FRONT would wash the black type
  toward grey and take contrast away from the one line you are trying to read.
  So the band uses `MultiplyBlending`: it tints the PAPER of that line and
  leaves the ink alone. Measured on the shipped page: paper `#ffffff` becomes
  exactly `#f2dcae`, and **black ink on the tinted band still reads 12.9:1**.
- **`MultiplyBlending` ignores `material.opacity`** (`dst = src.rgb * dst.rgb`,
  no alpha term), so strength is a mix toward white inside the shader. Setting
  opacity does nothing at all, silently.
- **§3.5 caught me from the other side, and only pixels found it.** The header
  comment said the tint was "a hand-picked literal authored in output space" —
  and then passed it through `THREE.Color`, which (with
  `ColorManagement.enabled`) converts sRGB into the LINEAR working space. A
  shader that omits `#include <colorspace_fragment>` then writes those linear
  numbers into an already-encoded framebuffer. Measured: `uTint` arrived as
  `(0.888, 0.716, 0.423)` against the authored `(0.949, 0.863, 0.682)` — blue
  **38% too dark** — which turned a soft cream highlighter into a saturated tan.
  It looked like a design choice. Both new files now decode the hex by hand
  (`srgbVec()`); `dwell.js`'s `MeshBasicMaterial` track deliberately does NOT,
  because three.js owns that one's colour space end to end.
  **The general lesson: §3.5 is not only about textures. Any custom shader that
  writes a literal colour has to bypass `THREE.Color` too.**

**Smoothness is three mechanisms, not one**, because there are three sources of
jumpiness and easing only fixes the first:

1. Easing (130 ms, in the system's own tick — not GSAP, since the band
   re-targets several times a second and killing tweens at that rate is churn).
2. **Hysteresis** — while the pointer sits in the LEADING between two lines the
   lit line does not change. Without it the ruler flickers between neighbours
   while the visitor holds still: half a degree of head drift at 1.9 m is
   0.017 m and a body line's pitch is 0.036 m, so ordinary stillness crosses a
   boundary and comes back.
3. **A 110 ms settle** — a new line must hold the pointer before it takes.
   Hysteresis alone is not enough, because jitter big enough to land *inside* the
   next line still switches instantly. First placement is exempt.

**FOLLOW / DRIVE.** Follow tracks the pointer. Clicking the page enters drive and
steps down one line per click — Sebastian's "push down". Drive **ignores** the
pointer, and that is the whole reason the mode exists: on a desktop the mouse is
still parked on the line you just stepped off, so a band that kept following
would undo every click. Drive releases when the pointer leaves the page or moves
two or more lines from where it sat at the last click (two, not one, so head
jitter does not keep dropping you out).

**A drag is not a click.** On desktop, dragging across the page turns the view
(`reverseMouseDrag`), and A-Frame's cursor calls that a click whenever the same
entity was under the ray at both ends. The guard compares the pointer's line at
`mousedown` against `click`.

**Stepping scrolls the page, ONE WAY ONLY.** The reader's premise is that the
line you are reading is at eye level, so clicking down twenty times would walk
the band to your knees; an advance past `eye − 0.55` scrolls the strip through
the reader's own eased `scrollBy` to park the line at `eye − 0.20`. Measured
walking page 1: the first auto-scroll fires at `lineY 1.057` and parks at 1.40,
exactly as designed. **The symmetric version was written and caught in test:**
also scrolling UP when the line sits above the band means the visitor's own click
pulls them BACKWARDS, and it quietly undoes the deliberate "you look up to start
the piece" framing (`LEAD_FRACTION`). It looked harmless in the reader only
because scroll is clamped at 0, so page 1 could not move — it would have shown
up on page two.

**The toggle is on the rail's own axis, above the up pad.** That column is
already the control strip (up pad, thumb, down pad, page counter, all at
`railX`), so a fifth thing on it reads as part of the same object. Above rather
than below because below is the page counter's, and because the up pad is the
less-used of the two. It **cannot** be carried by colour: `ui-button`'s `accent`
does not recolour a solid plate. Measured: clears the rail top by 0.06 m,
overhangs the page's right edge by 0.03 m into its own ~0.23 m margin, outer
edge **27.4° off axis — identical to the rail's own right edge**, so it adds no
new encroachment on the phone crop §9.4 already accepts. ON by default per
Sebastian, and deliberately NOT remembered between pieces.

**The LABEL described here is superseded by §9.25 — read that instead.** This
version said "Hide guide", the ACTION, reasoning from the flat site's More
Projects button ("Show Fewer") and arguing that state is legible anyway because
the thing it controls is right there on the page. Sebastian reversed it a day
later: it is the NAME plus ON/OFF plus a state lamp now, and the plate and type
sizes quoted in §9.25 are the live ones.

**Cost, measured and then fixed.** The first version ran **10.4 ms per page** —
a dropped frame at 90 Hz the moment you look at a new page. Broken down it was
`getImageData` 6.4 ms and the two pixel passes 4.0 ms. Sampling at 120 columns
instead of 160, subsampling the histogram to every 4th row, and dropping the
`willReadFrequently` context hint (the wrong hint for a single read — it moved
time out of `drawImage` into `getImageData` for a worse total) brought it to
**3.8 ms median, same 31 lines, same pitch**. That fits inside one frame. Bands
are cached on the page record and survive the texture being disposed, so
scrolling back never re-analyses.

**Leak-checked** by §3.17's two-block method: with the ruler in use, **0
geometries leaked** across two blocks of two open/close cycles, and the band's
geometry and material were each disposed exactly once per cycle (4/4). Noted in
passing and not chased in that session: a block in which the ruler was never
touched showed +10 geometries over 2 cycles, so there was something else in the
reader's open/close path worth an audit — not the ruler and not the toggle (the
zero-leak blocks built that button too). **Chased and fixed in §9.24 — it was
the exit console.**

**Both features were verified with the loop LIVE and with it FROZEN**, and §3.1
bit again mid-session exactly as [[vr-preview-pane-limitation]] warns: a
photo-cloud select measured as "the tile never moved" for a while, which was
`gsap.ticker.frame` advancing 0 in 600 ms — the pane had backgrounded since the
previous measurement. Re-measure the clock before believing any timing result.

---

### 9.24 The exit console was leaking, and one caller hid it (2026-09-06)

§9.23 left an IOU: with the reading ruler never touched, two open/close cycles of
the reader still showed **+10 geometries**. This is that audit.

**It was `exit-button.js`, and it was all five of the meshes it builds** — the
solid plate, the ember rule, the back mark, the console deck and the deck's rim.
Every one attached with `setObject3D` and never freed, so **5.00 geometries and
5 materials per reader open**, steady state.

Measured by §3.17's method (two equal blocks of two cycles, rendering rather
than just ticking): **block A +10, block B +10** — A ≈ B, so not warmup. After
the fix: **+0 and +0**.

**The instrument is the finding.** `renderer.info.memory` tells you *how many*
leaked, never *which*, and the reader's open path builds page planes, a ground
circle, eight rail shapes, two troika labels, two ui-buttons and the exit
console — "+5 somewhere in there" is not a lead. So the harness
(`vr/_dev-memory-reader.html`) wraps `PlaneGeometry`, `CircleGeometry` and
`ShapeGeometry`, tags every instance with the **source line that constructed
it** off `new Error().stack`, spies on `BufferGeometry#dispose`, and prints a
made/freed census per line. That turned a day of suppressing builders one at a
time into one page load:

```
LEAK   4   made   4  freed   0   components/exit-button.js:405  (ShapeGeometry)
LEAK   4   made   4  freed   0   components/exit-button.js:410  (ShapeGeometry)
LEAK   4   made   4  freed   0   components/exit-button.js:283  (ShapeGeometry)
LEAK   4   made   4  freed   0   components/exit-button.js:299  (ShapeGeometry)
LEAK   4   made   4  freed   0   components/exit-button.js:312  (ShapeGeometry)
       0   made  32  freed  32   components/pdf-reader.js:638   (PlaneGeometry)
       0   made   4  freed   4   components/pdf-reader.js:360   (CircleGeometry)
       0   made  32  freed  32   components/pdf-reader.js:743   (ShapeGeometry)
       0   made   8  freed   8   components/ui-button.js:139    (PlaneGeometry)
```

**Build a census, not a bisect.** Suppressing one builder per reload needs a
page load per suspect and only ever confirms or clears the one you thought of;
the census names every allocation in the scene at once, including the ones you
would not have suspected. Keep the suppression cases (`?case=noexit` etc.) as a
cross-check, not as the primary instrument.

**The four other suspects were all clean, and the census is the proof** — the
reader's page planes 32/32, its ground circle 4/4, `makeRail`'s eight shapes
(two pads × pad/rim/triangle, plus track and thumb) 32/32, and `ui-button`'s own
plates 8/8. That last one is also the confirmation that A-Frame calls `remove()`
on components in a **detached subtree**: nothing calls `ui-button.remove()` by
hand, and its plates balance anyway. Verified in the 1.5.0 build too — a-entity's
`disconnectedCallback` does `for (name in this.components) this.removeComponent(name, false)`.
troika's per-instance geometry balanced as well, via
`aframe-troika-text`'s own `remove(){ this.troikaTextMesh.dispose() }`.

**Why it survived the §9.21 audit, which declared `pdf-reader` clean at 0.00.**
That measurement was honest and is still right for the code it ran against. The
exit button then had no plate and no console — the ring and the back mark were
added later, and the console deck and rim came with the 2026-09-04/05
redesign. So the leak grew in two steps, **0 → 2 → 5 geometries per open**,
which is also why §9.23 saw +6 over 3 cycles in one earlier block and +10 over 2
in a later one. Both numbers were real; they were measuring different files.
**A component's clean bill of health expires when anything it mounts changes.**

**The fix: a component `remove()` in the file that builds the meshes.** Every
`setObject3D` in `exit-button.js` now goes through a local `own()` that records
the name and attaches an `exit-owned` component, whose `remove()` frees exactly
those objects through `VRGlass.disposeSubtree`.

Three decisions in there worth not re-litigating:

- **A component, not an `opts.disposables` array.** The array is
  `scroll-arrows.js`'s contract and it is *why the rail has always been clean* —
  but it only works because its one caller remembers to drain it. `mount()` has
  three call sites and nothing forces a fourth to pass an array. A component
  needs no cooperation and cannot be forgotten, which is the right trade for a
  control whose whole premise is being mountable anywhere.
- **By NAME, not `disposeSubtree(el.object3D)`.** The button entity also carries
  `ui-button`, which owns its glass card and its **memoised** arrow-glyph
  texture and frees them in its own `remove()`. A blanket sweep of the button's
  subtree would reach across that ownership line — the exact boundary
  `disposeSubtree`'s `__vrOwned` exclusion exists to protect.
- **The doubled dispose in project rooms is inert, and that was measured, not
  assumed.** A room now frees the console twice: once in its blanket
  `disposeSubtree(roomEl)`, once in `exit-owned.remove()`. three.js drops its
  own dispose listener on the first call, so a geometry disposed three times
  decrements `renderer.info.memory.geometries` exactly once and never again
  (29 → 28 → 28 → 28).

**Verified three ways, because a leak counter cannot tell "freed correctly" from
"never built":**

1. Two blocks of two cycles, +0 / +0, every census row balanced.
2. A lifecycle assertion (`?case=look`): all five meshes present, visible and in
   the scene graph after `open()`; after `close()` all five **detached AND with
   geometry and material disposed** — detached alone is the old behaviour and is
   exactly what §3.17 warns reads as success; then a **re-open rebuilds all five
   as new meshes**, so the teardown does not poison the next build.
3. Rendered and looked at, in the real scene at `?v=6`: the console, its rim,
   the plate, the mint ring and the back arrow all draw, and the ring and arrow
   are at full strength — so `exit-attention`, which reaches for `exit-ring` and
   `exit-arrow` **by the same names `own()` now records**, still finds them.

**Left alone deliberately:** `VRGlass.lightTroikaText` replaces
`mesh.material` on a troika text and orphans troika's original, which is a
material rather than a geometry and so is invisible to the geometry counter.
Programs were flat across both blocks (+1 in A as warmup, +0 in B) and textures
were +0, so there is nothing measurable here today. Named so the next person
does not have to re-derive it.

**One piece of pre-existing drift found and NOT fixed**, because it is in
gitignored dev files and is the §9.21-finding-4 shape: `_dev-exit-button.html`
loads `exit-button.js?v=9` against the scene's v6, and `_dev-reader.html` loads
it with **no query at all** — which is precisely the trap §9.21's own
verification note records, since a component whose src has no query is not
refetched when you cache-bust the page. Both harnesses can silently measure a
stale file.

---

### 9.25 Naming the guide, and two controls that were too quiet (2026-09-06)

Sebastian, after looking at §9.23 and §9.24 live: *"the thing should be called a
'VR reading guide' and give it a clear on/off state, like the accessibility
button on the main website. also the text in the back to the dome should be
clearer/bigger."*

**1. The toggle now states the NAME and the STATE, which reverses §9.23.**
That version said "Hide guide" — the ACTION — reasoning from the flat site's
More Projects button ("Show Fewer") and arguing that state is legible anyway
because the thing it controls is right there on the page. **That reasoning fails
in the one case that matters.** With the guide OFF there is nothing on the page
to look at, so "Show guide" was the only evidence the feature existed, and it
read as something you had not yet switched on rather than something you had
switched off. Two lines now: `VR reading guide` / `ON` | `OFF`.

**2. The state lamp, which is the flat site's `.a11y-dot` in geometry.**
Sebastian named `index.html`'s `.a11y-toggle` as the model, and the thing worth
copying from it is that it carries the bit **twice** — the words say
"Turn on/off Accessibility" *and* a dot goes from a hollow ring to a filled
disc. So: a ring always drawn, a core visible only when on, and the ring dims
(opacity 1 → 0.45, emissive 0.55 → 0.14) when off. Ring-always is the CSS's own
behaviour (a permanent 1px border, a background that fills), and it matters —
it means the off state still shows you *where* the state is displayed instead of
leaving a blank patch of plate.

- **It has to be geometry, not a glyph.** '●'/'○' would be §3.7 again: the Syne
  latin subset carries no Geometric Shapes block and troika substitutes or drops
  the glyph silently. That is the same failure that made '▲' render as an empty
  rounded rect, which is why `scroll-arrows.js` draws its triangles as shapes.
- **It could not be a colour change on the plate.** `ui-button`'s `accent` does
  not recolour a solid plate — the glass shader hardcodes
  `mix(#1d1c1a, #2f2d29, y)` with the accent at 5% — so "green when on" is not
  available here however it is asked for.
- **It sits on line TWO, beside the ON/OFF word, not in the plate's left
  margin.** The margin is where the flat site puts it, on a single-line pill.
  Here line one is the long one: at a11y scale the name reaches x ±0.129 and
  would run straight into a dot parked there. Line two is short in both states,
  so the space beside it is free at every type size and the collision cannot
  come back.
- Its y is **derived, not measured** — `-0.575 × fontSize`, half of ui-button's
  1.15 line height — because troika's metrics are asynchronous and go stale
  silently (§3.2), and a static offset should not have to wait on a measurement
  to be correct.

**3. The plate grew UP, not OUT, and that is the whole trick.** Width is what
sets how far off-axis the outer edge lands, and §9.4's phone crop is the one
budget here already overdrawn; the space above is empty dome up to the title.
At 0.30 × 0.135 centred on railX: outer edge **27.8°** (was 27.4° at 0.26 — the
rail's own edge), top edge y 2.328 clear of the page top at 2.45, and it covers
0.051 m of blank right margin where the page's own type stops at x 0.515.
0.165 was tried first and was wrong: the two-line block measures 0.0605, which
left 52 mm of empty plate above and below and read as an undersized label on an
oversized card.

**4. Type size, bounded from BOTH directions — and the lower bound is the page.**
The label rides `ui-button`'s existing `fontScale` rather than introducing a
fourth type size (§5's 3-size scale, hard rule 4). Both controls were measured
with troika's own `blockBounds`, and in both cases **accessible mode is the
binding case, which is easy to miss because normal mode has room to spare.**

The guide toggle, where the constraint is wrapping — the name has to stay one
line, and `9.32 × fontSize` is what troika measures it at:

```
  fontScale   slack normal   slack a11y      subtends
  0.90         29.2 mm        36.5 mm         0.76°
  0.95         16.2 mm        20.2 mm         0.80°   shipped
  1.00          3.1 mm         3.9 mm         0.84°   too tight to trust
```

3 mm is inside the range a font-metric or subset difference moves a string, and
a wrap here means three lines in a two-line box. **The lower bound is not taste
either:** at 0.95 the name subtends **0.80°**, which is exactly the angular size
of the page's own ~11 pt body text at 150 DPI on a 1.95 m page at 1.9 m, and
larger than the page counter's 0.66°. This control's type is the same size as
the text the visitor came to read. *It looks tiny in a wide-FOV screenshot for
exactly the same reason the page's body text does — do not resize it off a
screenshot.*

The exit label, where the constraint is the back mark: ui-button centres the
label while `exit-button.js` insets the mark by `height × 0.42` from the left
edge, so the two close on each other as the type grows.

```
  labelScale   gap mark→label at a11y   label size
  1.32          10.9 mm                  0.0370    reads as crowding
  1.30          13.8 mm                  0.0364
  1.28          16.7 mm                  0.0358
  1.27          18.2 mm                  0.0356    shipped
  1.25          21.1 mm                  0.0350
```

0.0356 against the old 0.028 is **+27%**, one line in both modes (0.356 m inside
a 0.528 m maxWidth). **The plate was deliberately not widened to buy more
room**: 0.60 is a number Sebastian tuned by eye after calling the 0.82 version
"far too annoying and big", and widening it also grows the console's 30.5°
subtend.

**Not the same size, and that is correct.** The exit label subtends 1.85° to the
toggle's 0.80°. The console sits at 1.10 m and the toggle at the page's 1.90 m,
so the same metres buy 1.7× the angle — and the exit is the control you hunt for
when you feel stuck, while the toggle is furniture you use once.

**Verified:** both lines inside maxWidth at ×1 and at a11y's ×1.25; the OFF
state confirmed to change the label, hide the core, dim the ring **and** actually
disable the ruler (`vr-reading-line`'s `enabled` false); rendered at 3× as a
contact sheet and looked at, in both states; and §9.24's leak measurement re-run
because this adds four disposables — still **+0 / +0**, with the lamp's core
showing 4 made / 4 freed in the census.

---

### 9.26 The second walkthrough list (2026-09-08)

Twenty-odd items from a headset pass, worked through in one session. The four
that changed how something in here *works* rather than how it looks are 9.26.1,
9.26.2, 9.26.5 and 9.26.6 — read those even if you skip the rest.

#### 9.26.1 `visible: false` DOES NOT STOP SOMETHING BEING CLICKED

The most important finding in this pass, and it had been true since the first
project room.

`setAttribute('visible', false)` sets `object3D.visible = false`. three.js r158
honours that when RENDERING and **ignores it when RAYCASTING** — `intersect()`
tests `object.layers`, never `visible` — and A-Frame's raycaster does not filter
the results either. So every `.hub-cluster` a room, the reader or the lab hid
stayed a live, invisible hit target: 33 photo tiles, five project cards, five
writing cards, the bio card's Skills toggle, the portrait.

Two symptoms, both reported:

* **A control in the place you ARE in silently refuses to work**, because
  something you cannot see is nearer the eye. This is what "the PDF reader for
  the FEA analysis is broken, I can't page through" partly was: aimed at the
  document station's arrows, the first thing the head cursor hit was
  `#homePortrait`, invisible, at 1.68 m.
* **A click on empty room floor opens another project's content on top of the
  room you are standing in.** Best candidate for the "engineering communication
  builder content appearing in the Time Collector room" note — unreproduced, see
  the open item at the end.

Fixed in `place.js`, which now owns `VRPlace.setHubVisible()` /
`setBranchVisible()`: hiding a branch also takes `.clickable` off every
descendant (recording it in `data-vr-was-clickable` so showing restores exactly
what was there) and refreshes the three rays. `project-room.js`, `pdf-reader.js`
and `portrait-lab.js` all route through it.

Measured: entering a room takes the scene from 72 clickables to 4 (three station
controls + the exit console) and the head cursor's object list from 88 to 9;
leaving restores 72 with zero leftover flags.

Two more of the same shape, found by counting clickables across a full
round-trip rather than by reading code:

* **The portrait lab builds its room once and hides it**, so between visits
  three depth panels and a Back button sat invisible in the hub and still took
  clicks (73 → 78 after one visit).
* **`busy.js`'s card is built once and parked**, leaving its Cancel button as a
  live invisible target floating mid-hub for the rest of the session (+1 per
  reader visit).

Both now go through `VRPlace.setBranchVisible`. The regression test is one line:
**the hub's `.clickable` count must come back to exactly what it was** after any
room, reader or lab visit. Measured after: 73 across two rooms, two reader
visits and a lab visit.

**Use `VRPlace.setBranchVisible(el, on)` for anything that hides a branch.** A
bare `setAttribute('visible', false)` is a rendering change, not a hiding.

#### 9.26.2 The two hand raycasters are phantoms when no controller is connected

`#leftHand` and `#rightHand` are in the markup from page load. `raycaster` does
not care whether a controller ever arrives: it ticks and casts from wherever the
entity is, and with nothing attached that entity has never moved off the RIG
ORIGIN. Both hands therefore fire a permanent ray along −Z at world y 0.

Measured in the reading room, no controllers anywhere:

```
  #head [cursor]   1 hit,  y 2.45,  distance 2.08    <- the actual gaze
  #leftHand        2 hits, y 0.00,  distance 1.90    <- phantom, and NEARER
  #rightHand       2 hits, y 0.00,  distance 1.90    <- the same phantom
```

Anything resolving "the pointer" as *nearest hit across all three* — the
obviously correct rule — gets the phantom, permanently, on every device with no
controllers. **That includes a Vision Pro, where controllers never connect and
the gaze is the only pointer there is.**

`reading-line.js` did exactly that. So the reading ruler has been tracking a
floor-level ray rather than the reader: it still lit a line, so it looked alive,
but always a low one and never the one being read. On a desktop the mouse ray
usually lands nearer and hides it, which is why it survived testing.

New `pointer.js`: `hand-ray-gate` disables a hand's raycaster until
`controllerconnected` fires (starting disabled — on a Vision Pro that event never
comes), and `VRPointer.nearest([accept])` is the shared answer for everyone else.
`reading-line.js` and the reader's auto-scroll both use it.

**Never hand-roll "nearest across the three rays" again. Call `VRPointer`.**

#### 9.26.3 `.clickable` is not what makes something clickable

The document station's paging arrows could not be clicked by any pointer, on any
device, and never could. The class was right, the handler was right, the
explicit `refreshClickableRaycasters()` was right. The meshes were attached with
`el.object3D.add(mesh)`.

A-Frame's raycaster resolves its `objects` selector and then calls
`flattenObject3DMaps`, which walks each matched entity's **object3DMap** — the
registry `setObject3D(name, obj)` writes to. A mesh added with `object3D.add()`
is in the scene graph, renders perfectly, and is in no entity's object3DMap, so
the entity contributes **zero objects** to the ray.

Proof it was never the handler: `emit('click')` paged perfectly the whole time.

Every other clickable in the scene already used `setObject3D` (photo-cloud tiles,
scroll-arrows' pads, notice, bio-card's toggle). This was the only raw `add()`,
and it was the only control that did not work. The page plane is now its own
clickable entity too — tap the lower half to go on, the upper half to go back.

#### 9.26.4 The project rooms walked ANTICLOCKWISE

*"It loads with the hero photo centre and '5 of 5' to the right; the first photo
should be to the right on entry and the last one after a full rotation."*

`project-room.js` has always DESCRIBED a clockwise walk. The code did the
opposite: A-Frame yaw is right-handed about +Y, so `rotation.y = +θ` sends a
child at `(0, y, −r)` to negative x — the viewer's LEFT. Every station carried
its correct number the whole time, so the room read as counting down rather than
as being mirrored, which is why it survived. One `var CW = -1`.

#### 9.26.5 The 25% went into the ROOMS, after a wrong turn through the hub

Sebastian's note said *"images overall: increase size by ~25%"*, under a heading
about the Experience and gallery sections. That was read as the hub
constellations, and the whole hub was grown and re-cut for it. **Reverted on
2026-09-09** — *"25% bigger in the project rooms, not in other places"* — and the
growth moved to `project-room.js`: `ST_W/ST_H` 0.86 × 0.62 → **1.075 × 0.775**,
`PDF_COVER_H` and both placeholder cards with them, so a room has one scale.

Cheap, because a room owns the whole 360° and spends it on at most six
stations. Checked against this file's own no-overlap rule: 0.86 subtends 26.17°
at the 1.85 m gallery radius, 1.075 subtends 32.40°, and the tightest real
layout (Time Collector, six stations, 51.43° step) goes from a 25.26° gap
between neighbours to 19.03°. Still clear — which matters more in a room than
anywhere else, because everything in one is renderOrder 0 and overlapping quads
paint in scene-graph order (§3.6).

**The hub is back to exactly what it was**, verified by re-measuring the placed
card edges: writing 33.02–53.98, projects 61.08–131.96, experience −116.89 to
−47.11, cloud arc 124.5–220.7, `TILE` 0.5. `card-flip.js`'s `GROW` is the one
thing kept from the reverted pass: it was `2.0`, which was only ever
`BACK_W / 0.50` written down as the ratio instead of as the two things it is a
ratio of. It is `growFor(cardEl)` now — same value at the authored size, and it
no longer silently breaks if the card ever does change.

##### Keep this: where the 25% could have come from

Worth not re-deriving if the hub is ever grown for real. At radius 2.0 the dome
is FULL — every section sits inside a ~7° gap of its neighbour, all the way
round. Measured (index.html's convention, 0 ahead, + to the LEFT):

```
  portrait  5.33 .. 29.83     writing 33.04 ..  53.96    projects 61.07 .. 131.96
  bio     -38.16 ..  -3.57    experience -116.89 .. -47.11
  cloud (its own convention, + right) 124.5 .. 220.7, arc 96.2
```

The only thing that made +25% fit was **taking Experience from 4 columns to 3**.
Ten cards at 4 columns cost three column steps; 25% bigger that widens the
section 69.8° → 83.9°, on top of the ~15° the projects grid needs on the other
side, and the cloud does not have 29° to give (67° is on record here as "one
tight clump"). At 3 columns the same ten cards, 25% bigger, span 61.9° —
*narrower than the row they replace* — and that 8° pays for most of the rest.

The writing column must **not** grow with the others: a paperTitle card has no
photograph on it, the column is five cards tall inside a fixed 0.20 m row gap,
and at ×1.25 its bottom card lands at y 0.11, ankle height.

Angles come from holding each section's INNER edge and sending the growth
outward — the same rule `layoutCluster`'s a11y widening compensation follows.
The set that worked: `WRITING_ANGLE` 43.5 (unchanged), `PROJECTS_GRID_ANGLE`
96.5 → 104.5, `EXPERIENCE_ANGLE` −82 → −76, photo-cloud `EDGE_MIN/MAX`
124.5/220.7 → 115.1/204.3 (arc 96.2° → 89.2°), `TILE` 0.5 → 0.625. Verified with
`_dev-camera-path.js` across 20 waypoints — hub-sweep, command-zone (lean
left/right/forward/back) and four eye heights: **zero screen overlaps**.

##### The company marks were re-tuned for the small card

The logo was sized against the grown 0.625 × 0.425 card; back at 0.5 × 0.34 it
had to shrink (`LOGO_FRAC` 0.19 → 0.17, with its own tighter inset). What a mark
costs is the TITLE's height budget, and the auto-fitter spends that as font
size. Built each card twice, with and without:

```
  Maker Nexus                       0.0520 -> 0.0520     0%
  Stanford Univ - Comparative Med   0.0447 -> 0.0400   -11%
  Virtual Human Interaction Lab     0.0510 -> 0.0400   -22%
```

Only the two longest names pay anything, and 0.0400 is above `hub-panel`'s own
`TITLE_FLOOR` (0.0364) and subtends 1.15° at 2 m — larger than the reading-guide
toggle's 0.80°, the smallest type in the scene Sebastian has signed off. The
mark is affordable on this card and would not be on a smaller one.

#### 9.26.6 A completed reach is LOCKED

*"Once an image is fully circled it should always come forward — it deselects
mid-load if the gaze drifts."* The ring costs ~0.9 s of deliberate holding and
then half a degree of head drift sent the photo home again, often while it was
still fetching. `mouseleave` no longer unwinds a completed reach; only another
tile's ring completing, a click, or `select(null)` does. `_focus` owns the
handover, on COMPLETION rather than on arming, so an abandoned ring leaves the
tile you already pulled in exactly where it is.

Dismiss speed: out is 0.95 s against in at 0.5 s (*"slow down the deselection,
but not too slow"*). Asymmetric on purpose — arriving is an answer to something
you did, leaving is not.

#### 9.26.7 The rest of the list

* **Photo captions.** New `vr/images.json`, keyed by bare file name, same
  enrichment-not-content contract as `projects.json`: a `caption` that replaces
  the alt in the cloud, an `exclude` flag, and a `project` href override for the
  one file whose name does not start with its project's stem
  (`slide-1-sketch.png`). An alt is written for a screen reader working down a
  page that supplies the context; a cloud tile floats alone in a dome with
  nothing around it. `contact-photo-framed-for-mosaic.jpg` is excluded — it is
  the same photograph as `contact-photo-professional.jpg`, cropped to register
  with the mosaic, and its alt describes a compositing effect the cloud does not
  run.
* **Per-station room copy.** `data-loader.js` scrapes `.step-body p` /
  `.block-body p` (or a `<p>` in the image's own box) alongside the phase name.
  Chess, Pendant and Slip Door have it; Bastón and Time Collector have no prose
  on their process cards at all, and the honest answer there is a heading and a
  photograph — add a `<p>` to a process card on the flat page and it appears in
  the room next load. The alt text is deliberately NOT a fallback: in a room the
  visitor is looking straight at the picture.
* **The ceiling.** `dome.js`'s zenith #050505 → **#242f44**, 18× the relative
  luminance and still firmly dark, and held FLAT above 40° of elevation
  (`ZENITH_PLATEAU`) — as one stop at the pole the lift was invisible from a
  normal forward look. Every room sky scaled to the same 0.028 luminance target
  keeping its own hue, except Chess, which has no colour to scale and whose
  character is a gallery wall. The ember band is untouched: it is bounded by
  FEATHER at ±14.4° and never meets the zenith.
* **The exit console, 25% smaller and 5° left.** Every dimension scaled together
  — plate, label, deck, both rules — because they are ratios tuned against each
  other; shrinking the plate alone walks the back mark into the "B" of "Back".
  The shrink is what does most of the work on occlusion (the deck's top edge
  subtends 6.8° from its centre now against 9.0°, so the reader page coverage
  falls ~15% → ~10.6%); the shift uncovers the right-hand end of the lines still
  behind it. 5° and not more: at 0.66 wide the deck's outer edge lands at 21.6°,
  no further into the phone crop than the old 0.88 deck did centred.
* **Auto-scroll in the reader.** The strip drifts whenever the pointer sits away
  from eye level on a page, on a squared ramp out of a 22% dead zone, up to
  0.42 m/s, after a 320 ms settle. Both directions — §9.23's one-way argument was
  about a CLICK undoing itself and does not carry here. Not a gaze fuse: it
  commits to nothing and reverses immediately. Measured: 0.027 / 0.129 / 0.365 /
  0.504 m per 1.2 s at 0.25 / 0.40 / 0.55 / 0.65 m below the eye, and 0.0003 m of
  drift in the dead zone.
* **The end of a piece.** Reach the bottom and "Look up" appears under the last
  page; tip past 38° and every page of the piece fans across the ceiling with
  the count. Re-uses the trail textures the reader already keeps, so it costs no
  memory and no network, and the conceit is literally true — a page can only be
  in the fan if you scrolled through it. Two things that only rendering caught:
  the leaves must face DOWN (`+90°` about X, not the floor convention's `−90°`,
  which points them away and mirrors the caption), and the strip behind has to
  dim or a fan of 256 px thumbnails loses to a 4 m column of white pages.
* **Sunflower on the hero portrait**, and it is not cosmetic. A stereo pair is
  only valid seen square on: the disparity is baked along the image's horizontal
  axis for a head at 1.5 m dead ahead, so an oblique view shears the depth —
  which is exactly *"the background moves too much when looking sideways"*. With
  bounded walking that is not an edge case. Rate 12 (slower than the
  constellation's 18: this panel is 1.5 m away and directly in front of you),
  maxTurnDeg 34. `sunflower.js` now honours `?sunflower=0` itself rather than
  only through `layoutCluster`, or the A/B would compare a scene with one panel
  still drifting.
* **Convergence, the other half of that.** `spatial-photo` samples both textures
  at a per-eye horizontal offset, which slides the ZERO-disparity plane through
  the scene without touching relative disparity — the depth structure is
  bit-for-bit what was baked. Default `converge: 0.75` puts the backdrop most of
  the way onto the panel (residual 1.22 px against 4.88), because the deepest
  thing in a stereo pair is always the least stable thing in it. Not 1.0: the
  subject would stand further in front of the frame, and a window violation is
  worse than a slightly soft backdrop. `?converge=N` for the in-headset call.
* **Company logos.** Upper-left of each Experience card, from
  `/images/logos/<hostname>.png` — the hostname of the job's OWN link on
  experience.html, so nothing anywhere maps a company to a picture. Four Stanford
  orgs carry four copies of the Stanford mark rather than sharing one through an
  alias table; 4 × 9 KB against a hand-written map, in a codebase whose rule 5 is
  that content is derived. Each is composited onto a common light rounded plate,
  because ten brand marks with ten different backgrounds (a navy square, a black
  square, a white field) do not read as a set against dark glass. The title is
  top-anchored below the mark: it is centred and wraps to four lines, so there is
  no reliable corner for a badge beside it.
* **Card return, 380 → 620 ms.** This card is not dismissed to reveal something
  else, it is putting itself back — 0.9 m of travel, 1.6× of shrink and 180° of
  turn — and at 380 ms that reads as a yank. Still under the 520 ms flip in.
* **The portrait lab is a walk site**, radius 1.35 (a circle, per
  walk-controls' own reasoning), so you can reach 0.50 m from a panel and stand
  square on to the outer ones. It used to inherit the HUB's ellipse, which is
  squashed to 1.15 m toward −Z *because the home panel is that way* — in here the
  thing ahead is the exhibit. **What this cannot fix:** visionOS fades an
  immersive space to passthrough when you physically walk out of its area, and no
  WebXR page can move that. On a Vision Pro all locomotion is physical, so
  Apple's limit is the real one.
* **A fourth lab panel: `parallax-photo.js`.** Parallax occlusion mapping over
  the relief panel's own depth map — two triangles, no new asset, the relief
  panel's motion response with none of its stretching. Runs at 0.085 m of depth
  against the relief panel's 0.1951 m, and that difference IS the finding: at the
  full depth a 30° view marches 15.6% of the panel's width across ground the
  photograph has no data for, which rendered as a fringe of streaks along the
  hairline. Plus an edge guard that stops parallaxing where the march lands on a
  depth step. GAP 0.95 → 0.86 so four panels span ±34.9°.
* **The splat.** It renders — verified on the monitor, drawing correctly in the
  lab. For the in-headset report there is now a **watchdog**: ready with
  `instanceCount === 0` forces a sort up to five times a second apart, then says
  so on the busy card, because every remaining failure mode is silent and there
  is no console (§3.16). Also a forced re-sort on every `sessionstart`/`end` —
  `webXRActive` switches the library's stereo correction, so the sorted order is
  for a different projection, and putting a headset on does not move the head
  past `tick()`'s gate.
* **`leave-vr.js`.** A pad on the floor 0.70 m ahead, revealed by looking down
  past 45° and hidden again at 32°, that ends the session and navigates to `/`.
  Deliberately NOT `.hub-cluster`: "I want out" is most likely felt somewhere
  that already replaced the hub. Not a gaze fuse — looking down reveals it,
  pressing it takes a click. It draws UNLIT: `exit-button.js` uses the same
  #141816 through `litMaterial` and reads as dark furniture because that deck
  stands up edge-on to the rack, while this one lies flat pointing straight at
  four warm lights and came back tan.
  **On the question asked:** visionOS's Digital Crown and Quest's system menu
  already end a session and cannot be overridden — but they leave you in the
  browser looking at /vr's flat page, which is a WebXR scene with an "Enter VR"
  button on it. There is no native affordance for "and take me back to the
  website"; that last step is the only part a page can do, and it is the part
  that was asked for.

#### 9.26.9 The Experience card, settled (2026-09-09)

Three passes with Sebastian looking at renders, so these are decisions rather
than defaults. Do not re-litigate them.

**The ROLE is the headline, the employer is the small line.** *"My titles should
be the big, and where I work should be the small — swap those."* It was the
other way round, which reads as a list of employers rather than a list of what
he did. The role also has to be SPLIT to do it: experience.html's own convention
for `.exp-role` is `Title · Place` ("Maker on Duty · Stanford, CA"), and a
headline is the job, not the postcode — so `expLines()` in index.html takes the
first segment for the big line and drops the tail into the small line with the
company and the dates. Nine of ten roles use that separator; "Teaching
Assistant, Neurobiology of Pain" has no tail and is unaffected. Both faces of
the card use the same split, or it would change what it leads with mid-flip.

**The place STAYS in the small line**, even though it costs a third line on a
few cards and repeats "Stanford" on two. Put to him against the tighter
"company · date"; he kept it, because San Francisco / Remote / Hybrid say
something about three of the roles that nothing else on the card does.

**The marks stay small** (`LOGO_FRAC` 0.17). Shown in the scene next to the
measured cost of going bigger — every millimetre comes out of the title's
height budget and the two longest names are already being shrunk — and he chose
the modest mark.

**Three marks are not that host's own icon**, and `images/logos/SOURCES.txt`
records why for all ten. VHIL ships a wide lockup, so only its head-and-visor
ICON is used (the wordmark is unreadable at 58 mm). The Neurobiology of Pain
card carries the **Stanford Medicine shield** rather than the generic tree its
host serves, because that is what the job is. Open to Debate publish only a
white-on-transparent wordmark, so it is **recoloured to #111** — letterforms
untouched, fill inverted — because white is invisible on the plate. The naming
convention is unchanged and is still the whole mechanism: `<hostname>.png`, no
table anywhere.

#### 9.26.8 "Engineering communication builder content in the Time Collector room" — FOUND

**Root cause: `#focusStage` was never hidden when you entered a room.** The
phrase is `index.html:1401` read aloud — `<h2 class="section-title">Engineer.<br>
<em>Communicator.</em><br>Builder.</h2>` — and it is hardcoded a second time at
`bio-card.js:184` as the bio card's heading. So it is hub content, appearing
inside a room, exactly as reported.

How it got there. `#focusStage` is deliberately NOT a `.hub-cluster` (see the
markup note at `vr/index.html:474`) because it is the transient detail view, not
part of the hub. `VRPlace.setHubVisible()` only walks `.hub-cluster`. So the
stage and whatever card was on it survived every room entry — and the focused
card is *how you enter a room*: focus the Time Collector card, press its button,
and the panel you just pressed is still hanging there in the room you walked
into. `pdf-reader.js` had already noticed and hid `#focusStage` in its own
wrapper (`pdf-reader.js:217`); `project-room.js:122` and `portrait-lab.js:96`
both `return VRPlace.setHubVisible(visible)` early, so neither ever did. The
reader was the only covered path, and rooms are the ones you actually enter this
way.

The fix is in `place.js`'s `setHubVisible`, which all three already route
through, and it DISMISSES rather than hides: `VRFocusStage.close(true)`. Hiding
would only defer the problem, because the matching `setHubVisible(true)` on the
way out would bring a stale detail view back with the hub. `close(true)` is the
instant path — synchronous, no tween — and it restores the origin card's own
visibility, so it must run BEFORE the clusters are hidden, which is why the call
sits above the forEach rather than below it.

Measured in-browser, 2026-09-11: `close` called once with `instant === true`
while all 6 clusters were still visible (the ordering claim); after the hide, 0
clusters visible and the stage invisible; after `setHubVisible(true)`, 6 clusters
back, stage STILL invisible, `close` not called a second time — no ghost detail
view on the way out. The one link not driven in-browser is an actually-open
stage, because `open()` waits on a troika measure that never completes with
`document.hidden: true` (§3.1, §3.2) — it is sound by inspection instead:
`close`'s instant path sets `visible:false` unconditionally and early-returns
only when the stage is already invisible.

Note this was NOT 9.26.1's invisible-clickable bug, which was the standing
theory. Worth remembering as a method point: the reported phrase was a garbled
quotation of on-screen copy, and grepping the copy (`grep -i builder`) is what
cracked it after grepping the paraphrase found nothing.

#### 9.26.10 Two rooms had no station text, and chess's four shared one paragraph

**Audited by porting `bodyFor()` into the page and running it over all five room
pages, 2026-09-11.** Measured, not eyeballed: for every non-cross-link `<img>`,
what the room would actually show.

The first finding corrects something I had said out loud and got wrong.
`timecollector.html` does NOT lack prose — it has a good two-paragraph `.story`
block. I reported it as having none because my grep was
`<p[^>]*>[^<]{30,320}</p>`, and both paragraphs contain `<strong>`, so the
character class never matched. **Don't audit HTML with a regex that assumes
paragraphs have no inline tags.** What those pages actually lack is per-card
prose: `baston.html` and `timecollector.html` label with `.process-card` +
`.process-tag` and hold no `<p>` at all, and `BODY_SEL` is
`.step-body p,.block-body p`, so `bodyFor` returned `''` for every one of their
stations. Four each. `chess`/`pendant` (`.step-body`) and `slipdoor`
(`.block-body`) were always fine.

The second finding was self-inflicted and is the more useful lesson. After
extending chess's Prototyping paragraph with the rack-and-pinion pivot, all four
of that section's stations still shared ONE text, trimmed to 206 characters —
which cut the pivot and every FEA number out of the room while leaving them
perfectly visible on the page. The cause: `closest(GROUP_SEL)` resolved to
`.collage-grid`, because `.collage-item` was not in the list. It is now, for
exactly the reason `.process-card` already was — the item carries its own
`.collage-caption`, so the item is the labelled unit. **Writing page copy for a
room is not done until you have re-measured what the room takes**, because the
room reads only the HEAD of the text.

After: baston 4/6, timecollector 4/6, chess 5/8, pendant 3/4, slipdoor 3/3
stations with text (the zeros are hero frames, not process cards), **nothing
ellipsised on any page**, and chess's four are now 158/134/122/143 characters of
their own rather than four identical 206s. One text is still shared —
slipdoor-process-1 and -2 sit in one `.block-body` with no per-image container.
Left alone: they are two photos of the same build session.

Which also closes the standing "the 260-char cap truncates Slip Door" worry.
`trimTo` prefers the last sentence end and only ellipsises when there isn't one
past 50% of max, so that cut was the function working. Zero ellipses across all
five pages now.

Both new classes are `rem`-sized so `html.accessible` (root x 1.15) scales them.
`.collage-note` uses `--white-soft` (0.72 alpha) and NOT the `--white-faint`
(0.4) of the caption above it: that value is pitched for three uppercase words,
and this is a sentence. `.a11y-note p` is the page's own precedent for faint
prose.

#### 9.26.11 The rooms now wear each project's own title face

Sebastian, 2026-09-11: *"different pages use different text styles for
projects, can we have that reflected in project rooms?"*

Read off each page's own `.hero-title` rule, NOT its `:root` block — that
distinction is the whole reason this is faithful rather than decorative. The
`:root` of every project page defines two values for each token (the real one,
then an `html.accessible` override to Atkinson Hyperlegible), and the display
faces sitting in those tokens are not all used by the titles. What the titles
actually use:

    baston / pendant / chess   font-family:var(--serif)    Playfair Display 700
    timecollector              font-family:var(--script)    Fredericka the Great
    slipdoor                   (no font-family at all)      Poppins 900, -0.02em

So only TWO rooms change. Note `timecollector.html` also defines `--display`
(Cinzel) and it would have been the obvious guess — it is used elsewhere on the
page, but its title is the script face. And slipdoor's title declares no family,
inheriting Poppins at weight 900: that ABSENCE is its style. It is the one
project page with no display face, and the room reads that way rather than
borrowing a serif it never had.

Mechanism: `titleFont` on each theme (themes.js, which already owns the
per-project look), resolved to a file by `VRFonts.titleFor(key)`. An unknown or
absent key falls back to Playfair, so `signatureDark` and `_default` are
unchanged and a new theme needs nothing. `isA11y()` wins over the project face —
which matters MORE here than elsewhere, because Fredericka the Great is a rough
decorative display face and that is precisely the kind of type accessible mode
exists to replace.

ONLY the title varies. The blurb and tags stay on the shared body face because
on the flat site they are Poppins on all five pages — varying them would be
inventing a difference rather than reflecting one. §5's three-size scale is
untouched: this changes the FACE at a given size, never the number of sizes.

Verified in-browser: all seven themes resolve correctly, accessible mode returns
Atkinson for all seven, unknown and missing keys fall back to Playfair, and all
three faces fetch 200 with `access-control-allow-origin: *` and a real `wOFF`
magic. Not verified: how they LOOK, which needs a headset. Two things to judge
there — Fredericka's legibility at title size, and its weight: 248 KB against
Playfair's 28 KB, fetched on first entry to that room.

---

### 9.11 Deferred

**Project rooms need a dedicated rebuild.** They don't look good yet and are
explicitly *not* in this pass — Sebastian wants a separate walkthrough for them.
Worth knowing when wiring §9.8: "View full project" currently lands somewhere
that still needs work.

---

## 8. Document precedence

Oldest → newest. **Later wins.**

1. `VR_KICKOFF_PROMPT.md`, `VR_BUILD_SPEC.md` — original spec
2. `VR_SPEC_ADDENDUM.md`, `VR_DESIGN_RESOURCES.md`
3. `VR_POLISH_PROMPT.md` — first polish critique
4. `VR_IPHONE_FALLBACK_ADDENDUM.md`
5. `BUILD_NOTES.md` — visionOS-flavoured issue tracker (all 11 items ☑; the
   stack later became A-Frame/WebXR, so treat its framework talk as historical)
6. `VR_BUGFIX_NOTES.md` — in-headset walkthrough fixes. **Explicitly reverses**
   the "connective link-lines" feature: they were built, then removed as visual
   clutter. **Do not rebuild them.**
7. `VR_FINAL_BUILD_PROMPT.md`
8. `VR_POLISH_STANDARDS.md` — single key light, one easing curve
   (`power2.inOut`), strict 3-size type scale, moderate focus dimming
9. **This file** — current implementation reality. Within it, **§9 (the
   2026-08-27 work order) is the newest layer** and supersedes §4/§6 for the
   items it names.

Where an older doc describes something that no longer matches the code, the code
plus this file is the truth. Several older claims are now stale (e.g. captions
were on the image and are now above it; the placeholder-letter treatment for
writing projects is being replaced by the paper-title card).
