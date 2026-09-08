> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# VR — Polish Standards Addendum (refinement pass)

> **For Claude Code.** These are cross-cutting quality standards Sebastian confirmed after
> reviewing refinement options. **Apply this as a dedicated polish pass on what's already built
> BEFORE continuing with remaining features** (photo cloud, remaining project rooms, etc.) —
> confirmed priority: get the existing hub/cards/home/bio right first, so everything built after
> inherits these standards automatically instead of needing retrofitting later.
>
> Where this conflicts with earlier docs, **this is more recent and wins**, except
> `VR_BUGFIX_NOTES.md` remains authoritative on the specific bugs it lists (z-fighting, line
> removal, etc.) — treat the two as complementary: bugfix notes = fix what's broken, this file =
> the quality bar everything (old and new) must meet.

---

## 1. Materials — per-room variation is OK, base hub stays consistent

- The **hub** (home panel, Projects constellation, Experience constellation) shares **one**
  material system: same corner radius, border treatment, hover/wake response, and glass
  tint baseline. Keep this centralized in `glass-material.js` / shared tokens, per
  `VR_BUILD_SPEC.md` §6.
- **Project rooms MAY each express their own material character** matching their theme — e.g.
  Chess room can read harder/sharper-edged glass, Bastón room can read warmer/softer glass. This
  is an intentional exception to a fully-universal system.
- **Interaction behavior stays identical everywhere** regardless of material styling: the same
  hover scale-up, the same brighten response, the same select/pull mechanic (per
  `VR_BUGFIX_NOTES.md` #3/#5) — only the *visual character* of the glass may vary per room, never
  the *interaction pattern*.

## 2. Lighting — one key light, everywhere, no exceptions

- **Single directional key light** (the dusk dome's ember-horizon "sun") drives every shadow in
  the entire scene — hub, every project room, every model. Same direction, same softness always.
- **Themed project rooms may recolor the light** (tint/color temperature to match their theme
  accent — e.g. warmer for Time Collector, cooler for Chess) but must **not** change its
  direction, softness, or behavior. Consistency of light direction is what makes the whole scene
  feel like one coherent place rather than assembled fragments.
- Pair with a soft, low ambient fill (no other lights) to keep shadows readable without flattening
  them.

## 3. Motion — one easing curve for everything

- Standardize on **one easing curve family** for all animation in the scene: hover scale, the
  pull-to-camera select animation, focus dimming, room transitions, the arrival animation, the
  portrait reveal blend. Recommended: **GSAP `power2.inOut`** (smooth acceleration and
  deceleration, no snapping, no linear motion anywhere).
- Never use linear tweening or an instant/snap state change — this is one of the strongest
  "unpolished" tells in 3D work. Vary **duration** by context (hover ~150–200ms, pull/select
  ~400–600ms, room transitions ~1.2–2s per `VR_BUILD_SPEC.md` §7) but keep the **curve shape**
  constant throughout.

## 4. Sound cues — ready-made assets, add to hover + select

- Add subtle **one-shot** audio cues on top of the birdsong ambience:
  - **Hover:** `vr-audio/ui-hover.ogg` (+ `.mp3` fallback) — a very soft, short, glassy tick.
  - **Select:** `vr-audio/ui-select.ogg` (+ `.mp3` fallback) — a slightly fuller, warmer two-note
    chime.
  - Both are procedurally generated to match the calm dusk aesthetic (same palette as
    `birdsong-ambience`) — royalty-free, no attribution needed. Copy into `vr/assets/` alongside
    the ambience track.
- Play **hover** on the same event that triggers the hover scale/brighten response (§1), and
  **select** on the same event that triggers the pull-to-camera animation. Keep both quiet —
  they should reinforce the visual feedback, never compete with the birdsong bed or feel like a
  game UI beep.
- Same autoplay-policy handling as the ambience: audio context unlocks on first user gesture.

## 5. Typography — strict 3-size scale, no exceptions

- Exactly **three** text sizes used anywhere in the VR scene: **title** (Playfair Display),
  **body** (Syne), **label/tag** (Syne, smaller). No in-between or one-off sizes — including
  inside the bio card's stat rows (Education/Degrees/Location/etc.) and inside project rooms.
  If something needs more hierarchy, use weight/color/spacing, not a fourth size.
- If `a11yMode` is active, scale all three sizes up together (proportionally), keeping the same
  3-tier relationship — per the base spec's accessibility rules.

## 6. Focus / depth staging — fixed distance, moderate dimming

- **Do NOT** push idle/unfocused constellations further back or scale them down when something
  is focused — they **stay at their normal fixed distance and size** always. Simpler, more
  predictable spatial map; the visitor's mental map of "where things are" never shifts.
- When something is focused/selected, unfocused content dims **moderately** — reduce opacity
  (the ~0.2–0.3 range already set in `VR_BUGFIX_NOTES.md` #7 is right) but it must **remain
  clearly, visibly present** — never fade to near-invisible or fully hide. The visitor should
  always be able to see, faintly, that the rest of the gallery is still there around them.
- Combine with §3: animate the opacity change with the standard easing curve, not an instant cut.

---

## Build order for this pass

1. Consolidate/verify the shared hub material tokens (§1) — confirm project rooms are allowed to
   deviate, hub is not.
2. Set the single key light (§2) across every existing room/model; recolor per theme, don't
   redirect.
3. Replace any ad-hoc animation timing with the standardized easing curve (§3) across every
   existing animated interaction.
4. Wire in the two sound cue files (§4) to the existing hover/select events.
5. Audit all existing text and collapse to the 3-size scale (§5).
6. Confirm depth staging matches §6 (fixed distance, moderate/visible dimming, eased).

**Only after this pass is solid**, continue with the remaining features already queued in
`VR_FINAL_BUILD_PROMPT.md` (photo cloud, remaining full project rooms, etc.) — building them
directly to these standards from the start.
