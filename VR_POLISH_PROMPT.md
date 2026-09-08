> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# VR Polish Pass — make /vr look professional

> **For Claude Code.** Refinements after reviewing the first walkable build in-headset.
> Refines `VR_BUILD_SPEC.md` + `VR_SPEC_ADDENDUM.md`; where they conflict, newest wins.
> Keep all base guardrails (no build step, don't touch other pages except the one VR link,
> respect `prefers-reduced-motion` + `a11yMode`).

---

## PART 1 — Sebastian's own suggestions (fill in / top priority)

> _(Paste Sebastian's spoken notes from the video here — these lead. The design critique in
> Part 2 supports them.)_

- …
- …

---

## PART 2 — Design critique from the current build (what to fix, and how)

The content, data-sync, readable text, eye-level placement, and dusk-dome horizon are working.
The scene currently reads **unpolished** for these specific reasons — fix in this order:

### 1. Panels are bare floating photos → build a real glass "card" system
Right now project images hang in space with no frame, no caption, inconsistent size/height, no
depth cues. Make every panel a **consistent component**: fixed aspect ratio, rounded-rect glass
frame, a **caption bar** (project **title** in Playfair + **tags** in Syne), a hairline border
(`--border`), a soft rim light / contact glow, and equal padding. A curated gallery, not loose
snapshots. **Use `three-mesh-ui`** (or its A-Frame port) for the frames/cards — it gives real
padding, backgrounds, borders, and text layout, which is the single biggest professionalism win.

### 2. Layout is cluttered and overlapping → impose a spatial grid
Home title, portrait, project titles and experience items currently overlap at varied depths and
heights. Fix with **strict spatial structure**:
- Put each of the 3 constellations in its **own angular zone** (e.g. Projects ~−45°, Home 0°,
  Experience ~+45°), clearly separated, none overlapping.
- **Equal radius** (all panels the same comfortable distance, ~1.5–2 m) and a **consistent
  eye-level baseline**; arrange each cluster on a tidy **arc/grid** — use the
  **`aframe-layout` component** (circle/line/grid presets) so spacing is automatic and even.
- Panels **billboard/tilt** to face the viewer. Nothing overhead or underfoot.
- Clear hierarchy: **Home panel is the visual anchor** (larger, centered); constellations sit
  slightly back and dimmer until faced.

### 3. Base environment color is inconsistent → lock the dusk dome, reset on exit
The background flips between the intended **warm ember** horizon and a **purple/magenta** cast
(theme color bleeding from a project room into the hub). Make the **base dusk dome a single
constant** (dark overhead ≈ `#080808`, low warm ember horizon), and ensure returning from a
themed room **fully resets** sky/light/fog back to it — no leftover tint.

### 4. Bio card is cramped → make it a proper glass panel
On open it's tiny text bunched in a corner over a background image. Rebuild as a clean
**`three-mesh-ui` card**: generous padding, clear type scale (name → tagline → paragraphs →
stat rows), a max width, centered at reading distance, and **dim/blur the world behind it**
(backdrop scrim) so it's focused and legible. Content stays verbatim from `#about`.

### 5. Portrait is flat → give it its own framed panel + the gaze reveal
The center portrait currently overlaps other text and has no effect. Give it a dedicated framed
panel and implement the **gaze-driven brushstroke/mosaic reveal** (reuse
`images/contact-photo-mosaic.jpg` + `contact-photo-framed-for-mosaic.jpg`), per the addendum.

### 6. Weak depth + low text contrast → add lighting depth and scrims
Everything is similar brightness, so the space reads flat. Use **fog + lighting** so nearer
panels are brighter and distant ones fade; add a subtle **scrim/plate behind floating text** so
labels stay legible over dark or busy backgrounds.

### 7. Missing grounding → floor + carpet (addendum §C)
The ground reads as void. Add the solid floor + warm grounding carpet under the viewer — it also
measurably improves comfort/presence.

### 8. Missing connective lines (addendum §D)
The constellation link-lines aren't in yet. Add the faint glowing tethers derived from the real
`<a href>` graph once layout is stable.

---

## PART 3 — Packages to adopt for a professional look (no-build, CDN/ESM)

| Package | Fixes | Link |
|---|---|---|
| **three-mesh-ui** (+ A-Frame port `aframe-mesh-ui-components`) | Bare panels & cramped card → real UI cards with padding/borders/text layout (#1, #4) | `https://github.com/felixmariotto/three-mesh-ui` · `https://github.com/Retchut/aframe-mesh-ui-components` |
| **aframe-layout** component | Cluttered layout → auto even spacing on arc/circle/grid (#2) | `https://github.com/ngokevin/aframe-layout-component` |
| **aframe-environment-component** | Consistent dome, fog, ground, depth (#3, #6, #7) | `https://github.com/supermedium/aframe-environment-component` |
| **aframe-troika-text** | Crisp Playfair/Syne captions + hierarchy | `https://github.com/lojjic/aframe-troika-text` |
| **Poly Haven dusk HDRI** (env map) | Glass reflections + grounded lighting (#1, #6) | `https://polyhaven.com/hdris/skies` |
| **A-Frame postprocessing (bloom)** — subtle, added LAST | Soft glow on glass/horizon; dial back on Quest | `https://github.com/akbartus/A-Frame-Component-Postprocessing` |
| **glTF-Transform / gltf.report** | Keep any models ≤15k, Draco-compressed | `https://gltf-transform.dev/` · `https://gltf.report/` |

Full list + usage notes: `VR_DESIGN_RESOURCES.md`.

**Order:** card system (#1) → layout grid (#2) → dome reset (#3) → bio card (#4) → depth/scrims
(#6) → portrait reveal (#5) → floor/carpet (#7) → link-lines (#8) → bloom last. Pause after the
card system + layout so Sebastian can confirm the new look before the rest.
