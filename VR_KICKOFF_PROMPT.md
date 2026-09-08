> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# Paste this into Claude Code

Read `VR_BUILD_SPEC.md` in full before doing anything — it is the single source of truth and it REPLACES whatever guided the current `/vr` folder. Also read `VR_DESIGN_RESOURCES.md` — use those vetted libraries and asset sources (environment component, troika text, super-hands, HDRI skies, glass material settings, model optimization) instead of building the look from scratch.

The existing `/vr` implementation is messy. **Delete it and rebuild from scratch** per the spec. You may keep `vr/projects.json` data only if it's still valid; otherwise regenerate it.

Then build strictly in the **phases in §12**, and after EACH phase stop and show me a working, testable `/vr` (never leave it broken between phases). Start with Phase 1 only — the dusk-dome skeleton with the home panel, Enter-VR detection, and desktop/phone fallback — then pause so I can look at it before you continue.

Hard rules from the spec you must not break (§13):
- Fully virtual, no AR / no `immersive-ar`.
- A-Frame, no build step, no npm/bundler — static files only.
- Do not modify any existing page except adding ONE "View in VR" link (leave that until the last phase).
- Content must be pulled from the live site (§5), not hand-duplicated.
- Teleport + snap-turn only; generic WebXR `select` + reach-to-respond; respect `prefers-reduced-motion` and `a11yMode`.
- Dusk dome = dark overhead (≈ `#080808`) with a low warm ember horizon — not a bright golden hour.

Before you start Phase 1, confirm back to me: (1) your understanding of the spatial model in §2, and (2) the §15 open questions (which 3D models exist, where the VR link goes, in-room reader vs link-out).
