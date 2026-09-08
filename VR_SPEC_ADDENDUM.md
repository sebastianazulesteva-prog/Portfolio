> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# VR Spec — Addendum 1 (refinements after first constellation build)

> **For Claude Code.** These are additions/refinements to `VR_BUILD_SPEC.md` from Sebastian.
> They do not override the core architecture (dusk dome, fully virtual, reach-and-respond,
> auto-sync from the live site) — they refine it. Where this conflicts with the base spec,
> **this addendum wins.** Keep all base guardrails (no build step, don't touch other pages
> except the one VR link, respect `prefers-reduced-motion` + `a11yMode`).

---

## A. Priority right now: build the two constellations, then a rough full site

1. **Experience constellation** — from `experience.html` (`.exp-item` → company / date / role /
   bullets), one panel per role, in a curved cluster.
2. **Projects constellation** — from `index.html` `#projects .work-card` (+ `.work-grid-extra`),
   one panel per project.
3. Then flesh out the **whole rough scene** (home panel, floor, catalog stub, link-lines) so
   Sebastian can walk it end-to-end and give notes. **Rough is fine** — get it all standing,
   polish later.

---

## B. Home / center panel (spec §2 "home panel") — portrait + gaze reveal + bio card

- The center image is a **full square/rectangle portrait** (fills the panel, not a small inset).
- **Gaze-driven reveal effect** (reuse Sebastian's existing motif): when the viewer looks
  **straight on**, the image is revealed via a **brushstroke / mosaic wipe** — an overlay layer
  dissolves along the gaze point to uncover the portrait (or a second image) behind it.
  - Reuse the existing assets: `images/contact-photo-mosaic.jpg` and
    `images/contact-photo-framed-for-mosaic.jpg` (this "digital mosaic" is already his motif).
  - Implement as a shader/alpha-mask on the panel material driven by gaze proximity to center
    (a soft radial or brush-shaped mask that grows as the viewer faces it, recedes as they look
    away). Smooth, no flicker.
  - **Reduced-motion:** skip the animated wipe — show the final portrait statically.
- **Selecting the home panel opens the bio "card"** — near-identical to the About section you
  scroll through on the real site, just visualized on glass. Pull the actual text from
  `index.html` `#about` (the three-strengths paragraph, the grandfather + fantasy story, and the
  stat rows: Education / Degrees / Location / Languages). Keep wording as-is; don't rewrite.

---

## C. Floor — solid color + a grounding "carpet" (spec §8)

- Floor is a **solid color** (dark, tied to the dusk dome), not a busy texture.
- Add a **carpet / rug** area directly under the viewer where they stand/reach — a defined mat
  (circular or soft-rect) in a warm tone that echoes the ember horizon. Purpose: **grounding** —
  it gives the body a stable anchor, which also reduces VR unease.
- Keep it subtle and low-poly; a simple material or small texture is enough.

---

## D. Connective "constellation lines" — visualize the site's link graph (NEW, signature)

This is the "how everything is connected in space" feel Sebastian wants.

- Wherever a piece of content **links to another page/section**, draw a **faint glowing line /
  tether** in 3D physically connecting the source panel to the target constellation or panel.
- Example he gave: the **bio links to Experience** ("communication skills developed through
  *hands-on experience*" → `experience.html`) — so a faint line runs from the home/bio panel
  over to the **Experience constellation**. Project links run from the bio/projects area to each
  project panel.
- **Derive the graph from real `<a href>`s** (stay truthful, auto-updating). The current internal
  link graph in `index.html`:
  - `experience.html` ×2 (nav + inline in bio) → **Experience constellation**
  - each project page (`pendant`, `slipdoor`, `baston`, `timecollector`, `chess`,
    `3d-printed-glasses-frames`, `algorithmic-modeling-shape-optimization`,
    `hp-reckoning-corporate-espionage`, `social-engineering-predictive-algorithms`) →
    its **project panel**
- **Style:** very thin, low-opacity, softly glowing lines (a curved/catenary arc reads more
  "constellation" than a straight line). Optional slow shimmer or a faint particle drifting
  along the line toward the target. They should feel like background connective tissue, not
  foreground clutter.
- **Interaction:** when a panel is gazed/hovered (§4 wake state), **its outgoing lines brighten**
  to highlight what it connects to; idle lines stay faint. Following a link (select) still
  triggers the normal transition/navigation.
- **Reduced-motion:** static faint lines, no shimmer/particle travel.
- Performance: lines are cheap, but cap total count and share a single line material; fade
  distant lines.

---

## E. Confirmed-good (keep as built)

- Text is **readable** — keep the current legibility/sizing.
- Home content sits at **eye level** — keep.
- Constellations should be visually distinct groups but share the panel design system.

---

## F. Still open (don't block the rough build — note and proceed)

- Which project `.glb` models exist at ≤15k polys (pendant / glasses / time collector). If none,
  rooms are panel-only for now.
- Exact placement of the single "View in VR" link on the flat site (leave for last).
- In-room "read full page" = link out to the flat page vs. in-room reader (default: in-room
  summary + link out).
