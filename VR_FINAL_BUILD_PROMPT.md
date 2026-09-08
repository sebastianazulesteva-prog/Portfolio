> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# VR — Master Build Directive (implement everything)

> **For Claude Code.** This is the authoritative directive for finishing `/vr`. Build out the
> **full experience — all features, all rooms** — not a stub. It consolidates and, where they
> differ, **supersedes** the companion docs. Read all of these first:
> `VR_BUILD_SPEC.md` (architecture), `VR_SPEC_ADDENDUM.md` (portrait/floor/link-lines),
> `VR_DESIGN_RESOURCES.md` (libraries), `VR_POLISH_PROMPT.md` (design critique of the current
> build), `VR_IPHONE_FALLBACK_ADDENDUM.md` (exact phone/iPhone behavior — no WebXR on iOS, gyro
> look + tap-to-select + on-screen turn/recenter buttons), and **`VR_BUGFIX_NOTES.md` — the most
> recent walkthrough, and authoritative over everything else here where they conflict.** It
> explicitly REVERSES item 10 below (connective light-lines) — do not build them; see that file. Keep all base guardrails: **no build step** (CDN/ESM only, pinned versions), don't
> modify other pages except one "View in VR" link (last), respect `prefers-reduced-motion` +
> `a11yMode`, teleport + snap-turn only, generic WebXR `select`, content auto-derived from the
> live site.

---

## Locked decisions (new — these win)

- **Hub layout:** front **180° arc, three zones** — Projects (left), Home (center), Experience
  (right). Photo Cloud reached by turning. Seated/standing comfortable; nothing critical behind.
- **Photo Catalog:** a **floating photo cloud** — the ~39 site images drift as a loose 3D
  constellation; reach one and it floats forward enlarged with its caption.
- **Project rooms:** **full surround worlds** — entering a project envelops you in its themed
  skybox + lighting + ground + ambient color, with the project's images / 3D model / content
  around you. Build a room for **every** project.
- **Extras (build all):** arrival animation · ambient spatial audio = **light birdsong** (+ subtle
  hover/select cues) · onboarding hint · connective light-lines.

---

## A. Fix what the current build got wrong (from the in-headset review)

1. **Panels → real glass cards.** Replace bare floating photos with a consistent card component:
   fixed aspect ratio, rounded-rect glass frame, caption bar (title in Playfair + tags in Syne),
   hairline border, rim light / contact glow, equal padding. **Use `three-mesh-ui`** (or its
   A-Frame port) for cards.
2. **Impose a spatial grid.** Separate the three constellations into their angular zones; equal
   radius (~1.5–2 m), one eye-level baseline, even spacing via the **`aframe-layout`** component;
   panels tilt to face the viewer; Home panel is the larger central anchor. **No overlapping.**
3. **Lock the dusk dome + reset on exit.** Base sky is constant: dark overhead (≈ `#080808`) with
   a low warm ember horizon. Kill the purple/magenta bleed — returning from any room fully resets
   sky/light/fog to the base dome.
4. **Bio card → proper glass panel.** Generous padding, clear type scale (name → tagline →
   paragraphs → stat rows), max width, centered at reading distance, world dimmed/blurred behind.
   Content verbatim from `#about`.
5. **Depth + contrast.** Fog + lighting so near panels are brighter, far ones fade; subtle scrim
   plates behind floating text for legibility.

## B. Build the full feature set

6. **Hub + 3 constellations** from live data: Projects (`#projects .work-card` + extras),
   Experience (`experience.html .exp-item`), Photo Cloud (all `images/*`). One card per item.
7. **Home panel + portrait reveal (this was broken before — implement carefully).** Full portrait
   panel. Two stacked layers on the same mesh: **top = clean portrait**
   (`images/contact-photo-framed-for-mosaic.jpg`), **underneath = the mosaic version**
   (`images/contact-photo-mosaic.jpg`). A shader blends them via a **soft radial/brush mask**;
   where the mask is active, the **mosaic underneath is revealed**. The mask center follows the
   **active pointer's hit point on the photo**, and the revealed area grows while the photo is
   targeted and eases back to the clean portrait when not.

   **Pointer source per device (critical — Vision Pro has NO continuous eye tracking; gaze is
   exposed only for a single frame on pinch, so a reveal that follows the eyes is impossible
   there — that's why it did nothing):**
   - **Vision Pro / phone / any headset without a controller:** use **head-aim** — raycast the
     camera's forward vector (the center reticle) onto the photo; the reveal follows where the
     head is pointed. On a **pinch**, snap/pin the reveal center to the one-frame gaze ray if
     available.
   - **Quest controllers or hands:** use the controller **laser / finger ray** hit point — point
     at the photo and the mosaic reveals under the ray.
   - **Desktop:** mouse position over the photo.
   Build it against ONE generic "active pointer ray → intersection on the portrait mesh" so all
   devices share the same code path. Under `prefers-reduced-motion`, skip the animated wipe and
   show a static mosaic-over-portrait blend. Selecting the panel opens the bio card (A.4).
8. **Full project rooms — every project.** On select, elegant ~1.2–2 s transition into a full
   surround themed world using that project's real page palette (`VR_BUILD_SPEC.md` §6 table:
   Time Collector brass/marble, Pendant bright silver, Slip Door VW-blue/gold, Bastón magenta/
   cream, Chess stark B/W, essays signature dark). Room holds the project's images, blurb, tags,
   `Read the full project →` link out, `.glb` model if present (≤15k, Draco), and a persistent
   **← Return home** control that reverses the transition and resets the dome.
9. **Photo Cloud** (floating cloud): drifting 3D image constellation; reach → enlarge + caption
   (from `alt` + owning project); calm paging/selection.
10. ~~Connective light-lines~~ **REMOVED per `VR_BUGFIX_NOTES.md` #2 — do not build; if already
    built, delete them.** They read as visual clutter in practice, not as the intended
    "constellation" feel.
11. **Floor + carpet:** solid dark floor + a warm grounding carpet under the viewer.

## C. Polish & presence

12. **Arrival animation:** on entering VR, an elegant fade-in with cards easing/assembling into
    place (echoes the site's one-time name-scatter intro). Reduced-motion → simple fade.
13. **Ambient spatial audio:** soft, **light birdsong** dusk ambience (looping, low volume) +
    subtle hover/select sound cues. Provide a mute toggle; start muted until first user gesture
    (autoplay policy) and respect a quiet default.
14. **Onboarding hint:** a brief one-line prompt on entry — "Look and pinch to open · pinch-drag
    to turn" — that fades after first interaction.
15. **Persistent home/recenter control** available from any room, the cloud, or the hub.

---

## Packages to use (no-build; see VR_DESIGN_RESOURCES.md)

`three-mesh-ui` (+ A-Frame port) for cards/bio · `aframe-layout` for even arc/grid spacing ·
`aframe-environment-component` for dome/fog/ground · `aframe-troika-text` for crisp Playfair/Syne ·
Poly Haven dusk HDRI for glass reflections/lighting · `aframe-super-hands` for reach/grab ·
A-Frame postprocessing **bloom last & subtle** · glTF-Transform/gltf.report to keep models ≤15k.

## Build order (pause at the ★ checkpoints for Sebastian to walk it)

1. Card system (A.1) + spatial grid/layout (A.2) + dome reset (A.3). **★ pause**
2. Home panel + portrait reveal + bio card (7, A.4).
3. Full project rooms for all projects + transitions (8). **★ pause**
4. Photo Cloud (9).
5. Connective light-lines (10) + floor/carpet (11).
6. Arrival animation (12) + birdsong audio + cues (13) + onboarding (14) + recenter (15).
7. Depth/contrast pass (A.5) + performance pass (Quest 72 / Vision Pro 90 fps) + bloom last.
8. Add the single "View in VR" link to the flat site.

Never leave `/vr` broken between steps. Keep everything data-driven so new site content flows in
automatically.

## Definition of done

- Hub (180° arc, 3 zones) with glass cards, no overlap, consistent depth; dome constant & resets.
- Home portrait reveal + clean bio card. Every project opens a full themed surround room and
  returns cleanly. Photo Cloud browsable. Light-lines reflect the real link graph. Floor + carpet.
- Arrival animation, birdsong ambience + UI cues (mute default until gesture), onboarding hint,
  persistent recenter — all present.
- Runs ≥72 fps Quest / ≥90 fps Vision Pro; desktop orbit + phone gyro fallbacks work; no dead ends.
- No build step; other pages untouched except one VR link; reduced-motion + a11y respected.
