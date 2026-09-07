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

## The portrait lab — all three, side by side, live

`portrait-lab.js` adds one ghost button under the home portrait, **Compare
portrait depth**. Pressing it hides the hub (via the scene's own `.hub-cluster`
convention, the same one `project-room.js` and `pdf-reader.js` use) and shows
the three treatments side by side, matched in size, tone and aperture so the
only variable is depth technique. Matching them was more work than building
them; without it the spatial photo arrives in full colour beside a grey relief
panel and wins on tone alone.

Nothing is built until the button is pressed. An unopened lab costs one button:
no stereo pair, no splat download, no 665 KB renderer.

### The third variant: a real spatial photo

`spatial-photo.js` is a genuine stereo pair, and it is here to be the weakest of
the three on purpose. **A spatial photo has binocular depth and no motion
parallax** — each eye gets its own image, so it has volume, but move your head
and nothing new appears, because there is nothing behind it to appear. That is
the honest baseline the other two are beating.

Eye separation uses three.js layers 1 and 2, which `WebXRManager` reserves for
exactly this (`cameraL.layers.enable(1)`, and both enabled on the ArrayCamera so
tagged objects survive the top-level cull — `WebXRManager.js:50-61`). Left plate
on layer 1 alone, right on layer 2 alone. Verified: masks 2 and 4, camera mask 3
so the flat site shows the left eye rather than an empty frame.

The pair is baked by `vr/tools/sharp/export_spatial.py`. **Disparity is computed
for where the panel hangs, not for the captured depth.** Warping by capture
depth is only correct with your eye 40 cm from his face and produces ~70 px of
relative shift, which is painful to fuse; computed for a 0.72 m panel at 1.5 m
it comes out at 8.5 px. SHARP's layer 1 fills the tears — holes before inpaint
were 1.26%, and layer 1 is real predicted content rather than smeared neighbours.

## Making it a window

The first relief build read as a card with relief on it, not an opening, and
there were two separate reasons.

**The frame was at the back.** The relief map puts the backdrop at 1, so the
panel's outer border was displaced furthest away while his face sat flush with
the front. Fixed by `windowInset` — everything, including the nearest point,
sits behind the aperture.

**Pushing straight back shrinks the picture.** Receding a flat grid along -z
contracts it under perspective: at this inset the border lost ~16% while the
nearer subject lost ~5%, so his shoulders hung outside their own backdrop and
there was no aperture anywhere. Fixed by displacing along rays from a fixed
**reference eye** (`viewDistance`) instead of along -z. Every depth then lands
on the same line of sight, so the interior fills the opening exactly — and it
costs nothing in parallax, because the rays only coincide from that one point.

**Then the opening has to actually clip.** Four planes joining the eye to the
four edges of the aperture, rebuilt every frame, fragments outside discarded.
Built from `onBeforeRender`, not `tick()`, because three calls it **once per
sub-camera** — driving it from tick would hand both eyes one set of planes built
from the head pose, putting the opening ~32 mm off for each. That is the same
order as the feather width, and a stereo mismatch at exactly the edge your eyes
use to locate the window.

The border feathers rather than ending on a rim. A crisp edge reads as a card no
matter how much depth is behind it, because a card is the thing that has one.

## Quest and Vision Pro

There is no second build, and adding one would be a mistake. Both run the same
WebXR path — Chromium on Quest, WebKit on Vision Pro — and nothing here touches
an API that differs. What differs is headroom, so the knob is **quality, not
device**, and the default is already the conservative choice: the decimated
splat (97k gaussians, 3.1 MB) rather than the full 385k / 12.3 MB.
`?quality=high` opts into the full one.

Sniffing the user agent for "Quest" was the alternative and is worse: wrong on
Wolvic, wrong on a tethered PC headset, wrong on every device released after
this was written, and it silently hands someone the degraded asset with no way
to say otherwise.

## Shipped as the hero portrait — and the five things that were wrong

Sebastian picked the relief window in a headset, and reported that the mosaic
reveal "doesn't seem to work". It did work — on a monitor. Chasing that turned
up four more defects, three of which I had introduced and none of which a
desktop check could see.

### 1. The reveal was dead in a headset (the reported bug)

It followed `raycaster.intersections`. Vision Pro Safari has no controllers and
**no hover** — a pinch materialises a `transient-pointer` for one frame and
removes it (§3.13). So `intersections` is empty essentially always, `revealOn`
never left 0, and the effect existed only for mouse users.

Fixed by falling back to the **head pose**, the one continuous "where are you
attending" signal every runtime provides. Solved against the panel's *plane* in
local space, not by raycasting the mesh — see defect 4. Not a gaze-fuse
violation (hard rule 7): it selects nothing, it moves a colour wash.

Verified: gaze centre-hits the panel at yaw **18.4°**, which is `atan2(0.5, 1.5)`
for a panel 0.5 m left and 1.5 m out. `revealOn` climbs 0.07 → 0.85.

### 2. The depth map was misaligned with the photograph

SHARP ran on `contact-photo-professional.jpg`. The panel displays
`contact-photo-framed-for-mosaic.jpg`, which the flat site crops to match the
mosaic artwork. **Different framing.** By NCC scale/offset search the framed
photo is the professional one cropped to 1543.6 × 2317.6 at (195, 72) — 77.8% of
the width — at **NCC 0.99990**.

So the relief was displacing him by a depth field offset ~10% of the width and
scaled to 78%. Overlaying the depth silhouette on the photo shows it cutting
straight through his cheek and chin. It survived review because a face-shaped
depth blob over a face reads as odd lighting, not as a misalignment.

`tools/sharp/export_relief.py` now crops the gaussian grid to that measured
window before unsquashing, and renormalises over the crop: span **0.1951 m**,
not 0.2355 m, because the old range was partly spent on backdrop the panel
never shows.

### 3. The reveal was less than half its approved size, and an ellipse

`distance(vUv, revealUv)` is anisotropic on a 0.72 × 1.08 panel, so a constant
uv radius draws 1.5× wider than tall. And 0.14 uv is 0.10 m across, where the
flat site's approved hero is `circle 130px` over a 408 px-wide photo = 31.9% of
the width = **0.23 m** here. Now measured in metres, so it is a true circle, at
the flat site's own size and its own 55% solid stop.

Also: the spliced `windowShade` line was multiplying the *revealed mosaic* by up
to 30%, breaking FRAG's documented promise that at full reveal the output is
exactly `color.rgb`. It is now faded by `(1 - mixAmount)`, the same guard the
sheen uses.

### 4. Hit-testing the relief blew the entire frame budget

Tessellating took the panel from 2 triangles to 49,152, and A-Frame raycasts
every `.clickable` on tick per raycaster. Measured: **4.52 ms** for the relief
mesh vs **0.0045 ms** for a flat quad — 1005×. Three raycasters live = **15.4 ms
per frame against 11.1 ms at 90 Hz**, from one panel.

That is not a frame-rate problem, it is the frame — and it would have presented
as the §3.13 symptoms (buttons needing several tries, "laggy"), which this
project has already misdiagnosed as frame rate once.

`mesh.raycast` is now an analytic plane intersection. **0.025 ms**, a 178×
improvement, per-frame sweep 15.4 → 6.0 ms, and the returned hit distance is
1.591 m — identical to the tessellated result. The quad is also the correct hit
surface: the reveal wants the flat plane's uv and the click just toggles the bio
card.

### 5. The escape hatch silently did nothing

`?portrait=flat` rewrote the component's attribute string with `relief:`
removed. A-Frame **merges** a partial multi-prop string into existing values, so
the markup's value simply survived — the flag logged `mode: flat` and changed
nothing. Now uses the single-property form, `setAttribute(name, 'relief', '')`.

Verified off: 4 verts, `depthWrite:false`, no relief symbols in the shader.

### Where it stands

Relief is the **default** in the markup. `?portrait=flat` is the one-parameter
rollback if it misbehaves on a device nobody has tested; `?portrait=splat` still
swaps in the gaussians. Per-eye portal planes verified to differ across a 63 mm
baseline on the left/right planes only, top and bottom identical — exactly what
a horizontal offset should do.

Frame rate on real hardware is still unmeasured.

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
