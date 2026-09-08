> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# VR — Bugfix & Refactor Notes (latest walkthrough)

> **For Claude Code.** These are concrete fixes from Sebastian's latest in-headset walkthrough.
> This is the **most recent, most authoritative** input — where it conflicts with anything in
> `VR_BUILD_SPEC.md`, `VR_SPEC_ADDENDUM.md`, `VR_POLISH_PROMPT.md`, or `VR_FINAL_BUILD_PROMPT.md`,
> **this file wins.** One explicit reversal below (item 2) — read it carefully, it removes a
> feature those docs asked for. Keep all base guardrails: no build step (CDN/ESM only), don't
> touch other pages except the one VR link, respect `prefers-reduced-motion` + `a11yMode`.

Fix in the order listed — several are prerequisites for the ones after (spacing before pull
animation; z-offset fix before focus-state dimming).

---

## 1. UI density & layout — give everything room to breathe

**Problem:** the portrait heavily overlaps the surrounding project/experience cards; the whole
curved array feels cramped.
**Fix:** increase the **radius** of the curved layout and the **angular step** between cards so
none overlap at any viewing angle. This is the same fix already called for in
`VR_POLISH_PROMPT.md` #2 (spatial grid) — treat that and this as the same task. Verify no overlap
by rotating fully through the array, not just from the default forward view.

## 2. Remove the connecting lines (REVERSES earlier spec — do this)

**Problem:** faint white/gray connective lines between cards read as visual clutter, not as the
intended "constellation" feel.
**Fix:** **Remove them entirely.** Set line meshes' `visible = false` or remove from the scene
graph — don't just fade opacity to near-zero, take them out.
**⚠️ Note:** `VR_SPEC_ADDENDUM.md` §D and `VR_FINAL_BUILD_PROMPT.md` item 10 previously asked for
these "connective light-lines" as a signature feature. **That instruction is superseded — do not
build them; if already built, remove them.** The idea didn't work visually in practice.

## 3. Selection interaction needs real affordance

**Problem:** pinch-select shows only a small passive reticle; the card barely reacts. Feels weak,
not "grabbable."
**Fix:** on hover/pointer-enter, give a **distinct, immediate visual response**: scale the card up
slightly (~1.05×) and brighten/tint its material. This should already be close to the "reach and
respond wake state" in the base spec (§4) — the gap is that it's not currently *visible enough*.
Make the scale + brightness change unmistakable, not subtle.

## 4. Portrait pixelation + content stuck behind it (z-fighting)

**Problem:** the "Engineer." text panel clips behind the main portrait; the portrait itself
shows heavy artifacting/pixelation; the close control is tiny with no clear bounding box.
**Fix:** this is classic **z-fighting** — two planes sitting at (or too near) the same depth,
so the renderer can't decide which draws in front. Give every stacked UI layer (portrait, text
panel, close control) a clearly **incremental Z-offset**, not a fractional/near-zero gap. Also
rebuild the close control as its own properly-sized, clearly bounded button (see item 6's button
pattern) — not small floating text.

## 5. Cards should animate toward the viewer on select ("pull" interaction)

**Problem:** reaching/grabbing at a card does nothing — cards stay static on the fixed curve.
**Fix:** on select, animate the card's position along the vector from its current position to the
camera, so it visibly moves toward the viewer to a comfortable read distance, and orient it
(`lookAt`/quaternion) to face the camera as it arrives. Use an animation/tween library for this
— **GSAP** is a good fit and loads via CDN with no build step; it can tween an A-Frame entity's
underlying `object3D.position` / `object3D.quaternion` directly. This is the same mechanic as
"reach-and-respond" in the base spec §4 — implement it as the actual position/rotation animation,
not just a hover state.

## 6. "Enter the room →" needs to look and act like a real button

**Problem:** it's plain floating text with no backing, border, or hover state — unclear it's
clickable separately from the rest of the card.
**Fix:** give it its **own mesh** (a plane behind the text, contrasting color/tint, rounded if
matching the glass-card style) with its **own raycaster hit target**, independent of the card
behind it. Add a clear hover/scale response specific to this button, same affordance language as
item 3.

## 7. Dim the background when a card is focused

**Problem:** looking at an active card (e.g. Poser Chess Set), everything else stays fully lit
and opaque, competing for attention.
**Fix:** when an item enters focus, keep its opacity at 1.0 and animate all **other** cards'
material opacity down to ~0.2–0.3 (ensure `transparent: true` is set on those materials so
opacity actually takes effect). Animate the change smoothly, don't snap it.

## 8. Initial load layout — reposition photo + bio

**Problem:** on load, the photo sits dead center burying the bio text, forcing the visitor to
look around just to get oriented.
**Fix:** new initial layout — **photo shifted slightly left**, **bio immediately visible to its
right**, both directly in front of the viewer on load (no turning required to see either). This
refines (does not remove) the home-panel concept in the base spec — same content, better initial
composition.

## 9. Fix the stray "spherical thing" in the environment

**Problem:** looking down/around, a faint dark spherical outline or gradient anomaly is visible,
inconsistent with the rest of the background.
**Fix:** check for (a) a visible seam in the skydome/skybox geometry, (b) an inverted sphere mesh
that isn't fully hidden by lighting/culling, or (c) an HDRI/environment-map artifact. Identify
which and remove/correct it — this should not be visible anywhere in the dome.

## 10. Floor material — make it clean and consistent

**Problem:** the dark floor shows strange banding / uneven shading / light bleed instead of a
solid, clean surface.
**Fix:** if using a standard/physical material, check for shadow-related artifacts (disable
shadow-receiving if that's the cause, or fix the lightmap). For the stylized dark-void floor this
scene wants, a simpler **`MeshBasicMaterial`** with a solid color/gradient likely reads cleaner
than a lit PBR material — prefer simple and consistent over "realistic but glitchy." Pair with the
grounding carpet already spec'd in `VR_SPEC_ADDENDUM.md` §C.

## 11. Z-depth clipping when opening a project panel

**Problem:** opening "Graduation Pendant" causes it to intersect/be partially obscured by the
inactive cards around it — visual hierarchy breaks.
**Fix:** when a card enters its focused/open state, its Z-position must move **forward enough to
fully clear the bounding boxes** of the surrounding curved array — not just a small nudge. Same
underlying fix as item 5 (the pull-to-camera animation) — make sure the forward travel distance is
always greater than the array's depth variance, for every card, not just tuned to one example.

---

## Build order for this pass

1. Fix spacing/radius (1) — do this before anything else; it changes where every other number is
   measured from.
2. Remove the connecting lines (2) — quick, isolated, do it now.
3. Fix z-fighting + z-offset system (4) — establishes the layer-depth convention item 5, 7, 11
   depend on.
4. Selection hover affordance (3) + Enter-room button (6) — same interaction pattern, do together.
5. Pull-to-camera select animation (5) + focus-state background dimming (7) + focus z-clipping
   fix (11) — these three are one cohesive "opening a card" interaction; build and test together.
6. Reposition initial load layout (8).
7. Fix environment artifact (9) + floor material (10).

Test each fix in-headset (or at minimum the desktop 3D fallback) before moving to the next —
several of these (z-fighting, clipping) are easy to think fixed from a static screenshot but only
show up in motion / from multiple angles.
