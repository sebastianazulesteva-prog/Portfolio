# A perspective portrait from one photo — Apple SHARP in /vr

**Branch `sharp-portrait`. Not merged, nothing on the live site.** `main` was
left untouched; this is a worktree so the main checkout keeps its own
in-progress work.

The question: can Apple's SHARP be applied to the contact photo so /vr shows a
real perspective view of Sebastian rather than a flat card? Yes. This branch
builds **both** ways of spending that reconstruction so they can be compared.

---

## What SHARP is, and what it actually gave us

[apple/ml-sharp](https://github.com/apple/ml-sharp) — "Sharp Monocular View
Synthesis in Less Than a Second" (Dec 2025). One feed-forward pass turns a
single photograph into a metric 3D gaussian scene.

- **Code licence:** Apple Sample Code Licence (permissive).
- **Model weights licence: research-only, non-commercial.** Sebastian's call,
  taken 2026-09-03: a personal portfolio is not "commercial exploitation,
  product development or use in any commercial product or service", so proceed.
  Revisit if the site ever becomes a commercial product.
- Ran on the M1 Pro via **MPS** in ~19–35 s. Only the `--render` video path
  needs CUDA, and we don't use it.

Input is `images/contact-photo-professional.jpg` (1984×2976), the full-res
original — not the 682×1024 site derivative.

### The focal-length finding

The photo carries no EXIF focal length, so SHARP falls back to a 30 mm
assumption. That looked wrong for an obviously long-lens studio headshot, so we
swept it. Measured over f35 = 30 / 85 / 135:

| f35 | subject X | subject Y | Z relief | z near |
|-----|-----------|-----------|----------|--------|
| 30  | 0.6627 m  | 0.9444 m  | 0.438 m  | 0.395 m |
| 85  | 0.6627 m  | 0.9444 m  | 1.242 m  | 1.120 m |
| 135 | 0.6627 m  | 0.9444 m  | 1.972 m  | 1.779 m |

Pointwise `z(f135)/z(f30) = 4.5000`, **standard deviation 0.00000** — the
predicted depth is exactly proportional to the assumed focal length. Because
`X = (px − cx)·z/f`, the reconstructed **shape is completely invariant** to the
focal you pass. There is no perspective distortion to "fix".

What the focal *does* control is one thing only: **how deep the relief is** at
fixed width and height. Judged against anthropometry, the 30 mm default is the
right one — it lands the head at 0.194 m breadth and 0.227 m crown-to-neck
(real: 0.16–0.19 and 0.23–0.26). **The bake is life-size with no rescaling.**

### Subject/backdrop separation

The z histogram has a 0.44 m empty band between the subject and the seamless
backdrop, so the split is unambiguous. The cut is placed 10% into that band
(z < 0.671). Cutting at 1.0 instead left 8,682 straggler gaussians floating in
the gap, and they were visible as streaks around the silhouette.

SHARP emits **2 layers** of 768×768: layer 0 is the visible surface, layer 1 is
inpainted material behind it. Layer 1 sits a median 0.4 mm behind layer 0 but
pulls back up to 0.97 m at silhouettes — that is the disocclusion data, and it
is why only the 27% of it that actually differs is kept.

---

## The two options

### A. Relief-displaced panel — recommended

`mosaic-reveal.js` gained an **opt-in** `relief:` parameter. With it unset the
shaders, geometry and material flags are byte-identical to before, so the
shipped portrait cannot move because this option exists (verified: the live
scene still builds a 4-vertex quad, `depthWrite:false`, no relief in either
shader).

With it set, the plane subdivides to 128×192 and every vertex is pushed back by
a baked relief map.

- `vr/assets/portrait-relief.png` — 240 KB. R = relief, G = subject mask,
  B = silhouette edge. Tagged `NoColorSpace`: it is data, and letting
  `loadTexture`'s default sRGB tag stand would gamma-decode the bytes and
  corrupt every displacement.
- Normals are re-derived from the relief slope, or the light sheen would light
  a flat plane that is no longer there.
- `depthWrite` flips to true **only** for the displaced mesh — triangles arrive
  in row order, not depth order, so without it the far cheek paints over the
  near nose (trap §3.6 territory).
- **The mosaic gaze-reveal survives.** Measured at the eye: flat panel goes
  (203,202,200) → (233,190,148), relief panel (207,204,202) → (233,192,150).
  Same effect, same magnitude.

Cost: none beyond 240 KB. Limitation: at a silhouette the surface stretches a
skirt down to the backdrop instead of tearing. Against this photo's flat
backdrop it is nearly invisible head-on; `tearFade` trades it for a soft gap.

### B. Real 3D gaussians

`splat-portrait.js`, new. Subject-only, life-size, three.js axes, origin at the
robust bbox centre. 0.60 × 0.74 × 0.28 m — a correct head-and-shoulders bust.

- Full: 385,338 gaussians / 12.3 MB. LOD (2× decimated, scales ×1.45):
  97,266 / 3.1 MB.
- Renderer: `@mkkellogg/gaussian-splats-3d@0.4.7` UMD from CDN, **665 KB**.
- **No gaze-reveal.** It cannot follow onto gaussians. Real feature loss.

Verdict from the comparison: at a realistic seated head-slide (~32 cm, ~11°)
the relief panel reads *better* than the LOD splat and keeps the reveal. The
splat only wins if you can walk a long way around it, which this scene does not
let you do. Option A is the recommendation; B is here so the difference is
arguable from evidence rather than assertion.

---

## Two traps worth keeping

**1. The splat library's re-sort heuristic is dead in A-Frame — silently.**
`Viewer.runSplatSort` decides whether to re-sort by testing
`this.camera.position` and `this.camera.quaternion` — the camera's *local*
transform. In A-Frame the THREE camera is attached to the camera entity via
`setObject3D('camera', …)`, so the entity's object3D carries all rig movement
and the camera itself never leaves (0,0,0) with no rotation. The library sees a
camera that has never moved, returns `Promise.resolve(false)` every frame, and
`instanceCount` stays 0: splats loaded, sorted zero times, nothing drawn. No
error, no warning, a correct splat count, an empty screen. `splat-portrait.js`
does the movement test itself against the camera's **world** transform.

**2. The UMD global has spaces in it.** It is `window["Gaussian Splats 3D"]`,
not `window.GaussianSplats3D`. Guessing the camel-case name produced "library
loaded but exposed no GaussianSplats3D" against a library that had loaded fine.

Also: A-Frame 1.5.0 bundles super-three **0.158**, the library's peer range is
three **>= 0.160**. It works — the APIs it touches are unchanged across that
gap — but it is an unpinned risk, and it is why the component fails soft.

---

## In a headset

`?portrait=relief` and `?portrait=splat` on `vr/index.html` make each option
reachable in a real session; absent the flag the scene is exactly as shipped.
Getting there turned up three headset-specific problems that a desktop test
cannot show.

### 1. The splat library cannot tell it is in a headset

Splat screen-space size comes from `renderDimensions`, which in drop-in mode is
`renderer.getSize()` — the whole canvas. Each eye renders to its own viewport
with its own projection, so that width is wrong and every gaussian is sized
against the wrong horizontal scale.

The library ships the correction (`adjustForWebXRStereo`) but gates it on
`webXRActive`, which is only ever set inside `setupWebXR()` — a path that runs
only when the library is constructed with its own `webXRMode`, and which also
builds its own VRButton into a `rootElement`. `DropInViewer` forces
`rootElement: null`, so `setupWebXR` never runs, the `sessionstart` listener is
never registered, and the flag is false forever. **The correction is dead code
in every drop-in scene.**

`splat-portrait.js` now sets it from `renderer.xr`'s own events. Measured with a
stubbed session: `webXRActive` false → true on `sessionstart`, and the shader's
viewport width goes **1920 → 1287.09**, a ratio of 0.6704 that matches
`flatProj₀₀ / xrProj₀₀` exactly. Without it the gaussians are sized against a
49% too-wide viewport.

### 2. The triangle budget doubles

Everything is drawn once per eye. At the old 256-segment default the relief
panel alone was **196,608 triangles → 393,216 in stereo**, against ~9,600 for
the entire rest of the scene. The segment count is now 128 (measured — see the
error table in `mosaic-reveal.js`), which took a stereo frame from **405,248 to
110,564 triangles** for the same view.

### 3. Sorting is a per-frame tax when your head is never still

Re-sort thresholds relax while presenting (6 cm / ~3.6° against 2 cm / ~1.8°).
Seated at ~1.5 m, 6 cm of head travel is ~2.3° of parallax — below where the
back-to-front order of overlapping gaussians visibly changes.

Nuance worth recording, because it cuts against the desktop bug: three r158
*does* decompose each XR sub-camera's transform into a real
`position`/`quaternion` (`WebXRManager.js:757`), so the library's own heuristic
partially revives in-session. Its thresholds are coarse (1 m, ~8°), so the
tick-driven sort still governs fine motion; the two overlap harmlessly because
`runSplatSort` early-returns while a sort is already running. On a flat page the
library's heuristic remains completely dead — that part is unchanged.

### Verified without a device

Stereo was exercised by rendering through a real `THREE.ArrayCamera` with two
64 mm-separated sub-cameras owning half the framebuffer each — the same shape
WebXR hands three.js.

- Both eyes drawn, whole-half statistics: left 21.0% bright / mean 49.61,
  right 20.2% / mean 48.58. Relief panel stereo RMS difference 72.5 → real
  per-eye parallax, not a duplicated image.
- `onBeforeRender` fires **once per sub-camera**, so the library receives each
  eye's own projection — which is what makes the correction meaningful.
- Splat sorted and visible in both eyes with the session stubbed active
  (97,266 instances drawn).
- `tick()` drives a sort (0 → 1); A-Frame's tick runs on the XR clock (§3.14).
- The library only touches `requestAnimationFrame` in `selfDrivenMode`, which
  `DropInViewer` forces off — trap §3.14 does not bite it.
- `?portrait=splat` on the shipped scene: `mosaic-reveal` removed,
  `splat-portrait` attached, 97,266 splats loaded.

*A screenshot taken after a stereo render showed one eye black; that is a stale
composite from the tool forcing a repaint, not a rendering fault. Pixels read
back inside the same JS task as the render are the reliable measurement.*

### NOT verified — this needs the actual device

I cannot put this on a headset, so the following are open:

1. **Frame rate and thermals.** 97,266 gaussians re-sorted on head motion,
   drawn twice, plus a 49k-triangle relief panel. Untested on Quest or Vision
   Pro. This is the most likely thing to disappoint.
2. **`setTimeout` clamping (§3.15).** The library's load path chains
   `delayedExecute` at 1–50 ms. If visionOS clamps timeouts in-session, building
   a 3 MB splat could crawl. Mitigated by the fact that the component starts
   loading at page load, so it should finish during the arrival gate, before
   anyone enters VR — but that is reasoning, not a measurement. (The GPU-sort
   timeout is dead: `gpuAcceleratedSort` is pinned false. Progressive load is
   off, so there is no per-section timeout chain during a session.)
3. **visionOS Safari's WebXR with this shader.** Unknown.
4. **Whether it actually reads as a person.** The point of the whole exercise,
   and the one thing no measurement settles.

### On-device checklist

Serve the branch and open it on the headset (`.tools/vr-phone.sh` does the
tunnel). Then, in order:

```
/vr/index.html?portrait=relief
/vr/index.html?portrait=splat
/vr/index.html?portrait=splat&xrdiag=1
```

`?xrdiag=1` puts numbers on a card in the scene, which is the only instrument
that works in a Vision Pro (§3.16). `window.VRSplatDiag()` returns
`{ready, splats, drawn, sorts, lastSortMs, webXRActive, presenting}`.

**Read `drawn` and `webXRActive` first.** `drawn: 0` means the splats loaded and
never sorted — nothing is on screen. `webXRActive: false` while `presenting` is
true means the stereo correction is not running and the gaussians are sized
wrong. Those two numbers separate "broken" from "slow" without a console.

Then just move your head. Lean side to side ~30 cm: relief should show the head
shifting against its frame with no tearing. Look for stretched gaussians on the
splat (sizing), and for any judder that tracks head motion rather than being
constant (sorting).

## Reproducing the assets

`vr/tools/sharp/` is an **offline** pipeline. It is not a build step for the
site (hard rule 1 stands — the site is still plain files over CDN); it exists so
the committed assets can be regenerated from the photo.

```bash
python3.13 -m venv sharp-env && ./sharp-env/bin/pip install -r ml-sharp/requirements.txt
curl -L -o sharp.pt https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt
./sharp-env/bin/python vr/tools/sharp/bake.py --image images/contact-photo-professional.jpg \
    --f35 30 --ckpt sharp.pt --out bake --device mps
./sharp-env/bin/python vr/tools/sharp/export_assets.py --bake bake --tag f30 --out vr/assets
```

The `.splat` files are **gitignored** — 15 MB of regenerable binary does not
belong in a portfolio repo before anyone has decided to ship it. The 240 KB
relief PNG is committed, because that is the recommended option's whole payload.

## Looking at it

```bash
cd /Users/sebastian/Desktop/portfolio-sharp && python3 -m http.server 8081
```

- `vr/_dev-preview.html?card=portrait-3` — flat | relief | splat, side by side
- `?card=portrait-relief`, `?card=portrait-splat` — one at a time
- `?splat=assets/portrait.splat&splatScale=1` — full-res, true life size
- `?depth=`, `?tear=`, `?segs=` — relief knobs

In the console: **`viewFrom(deg, dy)`** to orbit, **`strafe(dx, dy)`** to slide
sideways. A still frame cannot show parallax; you have to move.
