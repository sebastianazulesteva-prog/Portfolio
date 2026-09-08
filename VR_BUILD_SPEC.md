> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# VR / WebXR Build Spec v2 — sesteva.com/vr

> **For Claude Code.** This REPLACES the earlier spec. The first `/vr` attempt was
> messy — **delete `/vr` and rebuild it from scratch** against this document. Read the
> whole file before writing code. Build in the **phases** in §12, shipping a working
> state after each. Obey the **Guardrails** (§13) and **Definition of Done** (§14).
> When unsure, choose what (a) keeps the site build-free and (b) matches the existing
> aesthetic. This spec is the single source of truth.

---

## 1. The vision in one paragraph

Visitor opens `sesteva.com/vr`. On a laptop/phone it's a smooth orbitable 3D view; in a
headset they tap **Enter VR**. They arrive inside a calm **dusk dome** — a dark, enveloping
just-after-sunset world (near-black overhead, a low warm ember glow at the horizon) that
slowly drifts through subtle dusk hues. Directly in front floats the
**home panel** (Sebastian's intro). Arranged around them in three gentle **constellations**
are the site's content: **Projects**, **Work Experience**, and a VR-only **Photo Catalog**.
Panels drift softly; when the visitor **reaches toward one, it responds** — glides in and
opens. Entering a project **elegantly transforms the whole dome** into that project's own
themed world (Time Collector → warm brass/marble; Chess → stark black; etc.). A calm return
gesture eases them back to the dusk dome. Everything is **fully virtual** (no AR),
consistent across Vision Pro, Quest, desktop, and phone, and its content is **pulled
automatically from the real site**.

---

## 2. Mental model — the spatial architecture (build to THIS)

```
              ( DUSK DOME — dark overhead, low warm ember glow at the horizon )

                                   ✦ Projects constellation ✦
                                  (arc of glass panels, upper-left)

   ✦ Photo Catalog ✦                  ◈ HOME PANEL ◈                 ✦ Experience ✦
   (VR-only gallery,                (intro, dead ahead,               constellation
    to the right)                    eye level, anchor)              (arc, upper-right)

                                   ( floor: soft reflective plane )
```

- **Home panel** — anchor, straight ahead at eye level (~1.6 m). Name, tagline
  ("Bringing wonder through technology"), portrait, and 3 quiet labels that turn to face
  each constellation.
- **Three constellations** — each a loose curved cluster of panels in its own region of
  the dome. The visitor **snap-turns / glances** to face a cluster; panels there wake and
  drift toward attention. Groups are visually distinct but share the panel design system.
- **Project rooms** — selecting a project panel triggers a full, elegant **world transform**
  into that project's theme (§7), where its content + optional 3D model live. Return eases
  back to the dome.
- **Photo Catalog** — a VR-only mode: a grid/wall of all 39 site images, each with a short
  auto-derived caption (§9).

Keep the hub readable and calm. No panel directly overhead or underfoot. Everything within
a comfortable seated cone; deeper content reached by turning, not walking.

---

## 3. Non-negotiable technical decisions

| Decision | Value |
|---|---|
| Reality | **Fully virtual** on all devices. **No AR / passthrough** (Vision Pro's Safari can't do web AR — the module is non-functional). Do not request `immersive-ar`. |
| Framework | **A-Frame**, via pinned CDN `<script>` (a specific current stable 1.x — never `latest`). No npm, no bundler. |
| Session | `immersive-vr`, `local-floor` reference space. |
| Devices | Quest 3 browser · Apple Vision Pro (Safari) · desktop orbit fallback · phone gyro fallback. All required. |
| Input | Generic WebXR **`select`** + reach/proximity. Never hard-code controller buttons. Support Vision Pro `transient-pointer` (look+pinch), Quest hands/controllers, mouse, gaze. |
| Locomotion | Seated/standing. **Teleport + snap-turn only.** No smooth movement. Comfort vignette on transitions. |
| Build step | **None.** Static files, deploy via existing GitHub Pages + `CNAME`. |

---

## 4. Interaction — "reach out and they respond"

The signature feel. Not physics grab-and-throw; a **magnetic, magical response.**

- Panels idle with a slow drift/bob (tiny amplitude). Disabled under reduced-motion.
- As the visitor's **pointer or hand nears** a panel (proximity or ray hit), it **wakes**:
  edge brightens toward `--border-hover`, scales ≤3 %, a soft accent glow appears, and it
  **eases toward the viewer** slightly, as if noticing them.
- **`select`** (pinch on Vision Pro, trigger/pinch on Quest, click on desktop, gaze-fuse on
  phone) commits: the panel glides to a comfortable read distance and opens (project → world
  transform §7; catalog → catalog mode §9).
- Everything reachable by **gaze alone** too (controller-less / one-handed users).
- A persistent, calm **"return / recenter"** affordance is always available.
- No jitter: damp all motion (lerp), clamp velocities, no springy overshoot that could cause
  discomfort.

---

## 5. Data — auto-sync from the real site (core requirement)

Content derives from the live pages so editing the site updates VR with no extra step.
`vr/projects.json` is fallback + VR-only enrichment (models, theme overrides), **not** the
primary source.

**`components/data-loader.js` builds three datasets:**

1. **Projects** — `fetch('/index.html')`, `DOMParser`, read `#projects .work-card` (featured)
   and `.work-grid-extra .work-card` (extra). Per card: `href`, hero `img` src+alt, title,
   `.work-card-tag` text split on `·`. Verify selectors against the live DOM first.
2. **Experience** — `fetch('/experience.html')`, read `.exp-item` → `.exp-company`,
   `.exp-date`, `.exp-role`, `.exp-bullets`. One panel per role.
3. **Photo Catalog** — collect all `images/*` used across pages (walk the parsed DOMs; dedupe).
   Caption each from its `alt` text (+ the project title it belongs to). ~39 images.

Then `fetch('/vr/projects.json')` and **merge by `href`** to add: `model` (.glb path),
`theme` override, `accent`, `blurb`, `panelSize`, `hide`. If live parsing fails, fall back
entirely to `projects.json`; warn in console, never crash.

**`projects.json` shape:**
```json
{
  "$comment": "Fallback + VR enrichment. Live HTML is primary, matched by href.",
  "projects": [
    { "href": "timecollector.html", "model": "models/timecollector.glb",
      "theme": "timecollector", "accent": "#b8863b" }
  ]
}
```

---

## 6. Theming data (reuse existing site tokens)

Base hub (dusk dome) is its own thing (§8). Each **project room** derives its palette from
that project's real page `:root`. `data-loader.js` should try to read each page's CSS custom
properties; ship this **fallback theme table** (real values from the site) in a `themes.js`
map:

| Project | Mood | Key colors |
|---|---|---|
| Time Collector | warm brass / marble / timekeeping | cream `#f6e3bd`, brass `#b8863b`, copper `#a15c3e`, ink `#1a1408` |
| Pendant | bright silver gallery | white `#ffffff`, panel `#f7f6f3`, ink `#161513` |
| Slip Door | clean automotive / accessible | VW-blue `#cdeffa`/`#0091c8`, gold `#e0a83e`, white |
| Bastón | warm personal craft | magenta `#e30887`, deep `#b8066c`, cream `#f4efe9` |
| Chess | stark monochrome | black `#000000`, white `#f7f5f0` |
| Glasses / essays | signature dark | bg `#080808`, panel `#111`, text `#e8e8e8` |
| **Hub / home** | dark dusk dome, warm ember horizon | see §8 |

Global tokens (panels, text): `--text #f5f5f0`, headline `Playfair Display`, UI `Syne`.
If `localStorage.a11yMode` is set, use **Atkinson Hyperlegible** and larger sizes everywhere.

---

## 7. Project rooms + the elegant world transform

Selecting a project transforms the dome into that project's world. **The transition is the
star — make it elegant, never a hard cut.**

- **Transition (~1.2–2.0 s, eased):** dusk dome dims/desaturates → cross-fade skybox and
  ambient/light color to the project theme → the chosen panel expands into the focal
  "stage" → other panels gently recede/fade → optional themed particles settle in. Reverse
  on return. Use a comfort vignette during the move; no snap, no strobe.
- **Inside a room:** themed skybox + lighting from §6; the project's hero image(s), title,
  tags, and short blurb on glass; the **3D model** (if any, §10) floats on a pedestal/vitrine
  to inspect. A clear, calm **"← Return to dome"** control.
- Respect reduced-motion: shorten/replace motion with a simple cross-fade, no particle swirl.

---

## 8. The dusk dome (base world)

**Dark-leaning to match the OG site's near-black background** — not a bright golden hour.
Think the moment just after sunset.

- A large inverted **dome/skybox** with a **dusk gradient**: deep near-black overhead
  (≈ site `#080808`) easing **down** to a low, warm **ember glow** at the horizon (muted
  amber/rose-gold, kept subtle and dim). The warmth is a thin band low on the horizon, not
  the whole sky.
- Very slow, subtle **hue drift** in that horizon band only (deep amber → dusky rose → cool
  ember), on a long loop; disabled under reduced-motion. Overhead stays dark and calm.
- A soft, faintly **reflective dark floor** catching the low ember light; gentle radial fog
  for depth.
- Low warm ambient + one dim key "afterglow" light near the horizon for direction and long,
  soft shadows. Overall luminance is low — panels glow *against* the dark, like the flat site.
- Optional: a few slow **motes/particles** catching the horizon light (capped, off under
  reduced-motion).
- Keep it performant (§11) and calm — a dark, warm place to breathe, and the emotional anchor
  the visitor returns to between projects.

---

## 9. Photo Catalog (VR-only, new)

- Its own constellation/mode: a tidy **curved wall or grid** of all site images (~39).
- Each tile: the image on softly-lit glass with a **short caption below** derived from its
  `alt` text and owning project (keep to ~1 line; clean up alt into a human caption).
- Reach/point a tile → it enlarges to a comfortable view with its caption; select an adjacent
  arrow or gaze to move through. Calm paging, no fast motion.
- Fully data-driven (§5.3) so new images on the site appear automatically.

---

## 10. 3D models (enhancement, a few only)

- Candidates: **Pendant, 3D-Printed Glasses, Time Collector**, maybe Bastón. Map via
  `projects.json` (`model`). If a model doesn't exist, the room simply has no model — **never
  block on modeling.**
- Format `.glb`, **Draco-compressed**, **≤15k polys each** (user's cap), baked lighting, 2–4k
  textures. Place on a pedestal/vitrine; reach to inspect (rotate); desktop drag-to-rotate
  equivalent. Snap back with easing.

---

## 11. Performance budget (test against these)

- **72 fps Quest**, **90 fps Vision Pro**, smooth on a mid laptop.
- Scene poly budget ~500k–800k (Quest). Panels lightweight (<5k). Models ≤15k (§10).
- Glass: real PBR **transmission on ≤1–2 hero panels**; all others a cheap **frosted** variant
  (semi-transparent + rim light). Register both in `glass-material.js`, pick per panel.
- Share geometry/materials across panels; instance where possible. Hero textures ≤1024 px in
  VR; lazy-load offscreen constellations. No per-frame allocations. Particles capped.
- If framerate dips on Quest, downgrade more panels to frosted and cut particles first.

---

## 12. Build phases (rebuild in THIS order — ship working after each)

1. **Reset + skeleton.** Delete old `/vr`. New scene: dusk dome (§8), floor, home panel,
   Enter-VR detection, desktop orbit + phone gyro. No data yet — 3 placeholder panels.
2. **Data loader (§5).** Live-parse projects + experience + images; merge `projects.json`.
3. **Constellations + home panel (§2).** Lay out the three groups around the dome from real
   data; snap-turn to face each.
4. **Panel design system + glass (§4 look, §11 glass).** Frosted baseline everywhere, hero
   transmission, hover/wake states.
5. **Reach-and-respond interaction (§4).** Proximity wake, ease-in, generic `select`.
6. **Project rooms + elegant transform (§7)** using the theme table (§6).
7. **Photo Catalog (§9).**
8. **3D models (§10)** as `.glb`s become available.
9. **Comfort/a11y pass (§4, §13) + performance pass (§11) + cross-device test (§14).**
10. **Site hook:** one tasteful "View in VR" link in the main nav/footer (see §13).

Never leave `/vr` broken between phases.

---

## 13. Guardrails (do NOT)

- ❌ No bundler / framework build / npm step. Static files only.
- ❌ Do not touch existing pages except adding **one** "View in VR" link. No restyling them.
- ❌ Do not request `immersive-ar` or design for passthrough — fully virtual only.
- ❌ No smooth-locomotion movement (nausea). Teleport + snap-turn + vignette only.
- ❌ No controller-specific buttons; generic WebXR `select` + reach.
- ❌ Do not hand-duplicate content; derive from the live site (§5).
- ❌ Do not block v1 on 3D models; panels/catalog must stand alone.
- ❌ Do not pin A-Frame to `latest`.
- ❌ Keep files small, modular, and commented in the friendly voice used across the site.

---

## 14. Definition of Done / test checklist

- [ ] `/vr` loads as a clean **2D orbitable** dusk-dome scene on desktop Chrome/Safari/Firefox.
- [ ] Phone tilt-to-look + tap-select works; layout comfortable.
- [ ] **Quest 3:** Enter VR; reach-and-respond wakes panels; teleport + snap-turn; ~72 fps.
- [ ] **Vision Pro:** Enter VR; look-and-pinch (`transient-pointer`) selects; glass looks right;
      comfortable; ~90 fps.
- [ ] Home panel + 3 constellations (Projects, Experience, Photo Catalog) all present & readable.
- [ ] Entering a project performs the **elegant themed transform**; return eases back to dome.
- [ ] Photo Catalog shows all site images with auto captions.
- [ ] Edit a project card / add an image on the real site → VR reflects it next load (no manifest
      edit). Break a selector → falls back to `projects.json` without crashing.
- [ ] `prefers-reduced-motion` and `a11yMode` both visibly respected (no drift/particles; hyperlegible font).
- [ ] No build step; deploys static on GitHub Pages; `CNAME` untouched; other pages unchanged
      except the one VR link.
- [ ] No dead ends: no-WebXR visitors always get the working 2D dome.

---

## 15. Open questions to surface (don't guess silently)

- Which `.glb` models actually exist / can Sebastian export at ≤15k (pendant, glasses,
  time collector, bastón)? If none yet, confirm panels + catalog v1.
- Exact placement/wording of the single "View in VR" link.
- Should selecting a project's "read full page" exit to the flat page, or show its content
  on an in-room reader panel? (Default: in-room summary + a link out.)
