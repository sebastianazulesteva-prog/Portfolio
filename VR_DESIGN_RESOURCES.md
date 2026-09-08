> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# VR Design Resources — companion to VR_BUILD_SPEC.md

> **For Claude Code.** Vetted, real libraries and asset sources to make `/vr` look good.
> Use these instead of reinventing. **Rules:** everything must stay no-build (load via CDN
> `<script>` / ES modules, no npm bundler); pin exact versions; test every added component on
> **Quest 3 AND Vision Pro** before keeping it (some are older and may need tweaks); keep the
> performance budget in §11 of the spec (postprocessing especially is costly on standalone
> headsets). Prefer CC0 / permissive assets and credit where a license asks.

---

## 1. Core A-Frame components (biggest wins first)

| Component | What it does | Use it for (spec §) |
|---|---|---|
| **aframe-environment-component** (supermedium) | Whole background environments — sky gradient, fog, ground, horizon — in one line, with presets and tunable colors. | The **dusk dome** (§8). Start from a preset (e.g. `dream`/`starry`/`default`), then override to dark-overhead + warm ember horizon. Fastest path to a beautiful sky. `https://github.com/supermedium/aframe-environment-component` |
| **aframe-troika-text** (lojjic) | Crisp SDF 3D text straight from `.ttf/.otf/.woff` — no pre-baked font atlas. | All in-scene text (§6): load **Playfair Display** + **Syne** (and **Atkinson Hyperlegible** for a11y). Sharp at any distance. `https://www.npmjs.com/package/aframe-troika-text` |
| **aframe-super-hands** (c-frame) | All-in-one natural hand / controller / gaze interaction — hover, grab, drag, across input types. | The **reach-and-respond** feel (§4) and grabbable models (§10). Handles Quest hands/controllers + gaze uniformly. `https://github.com/c-frame/aframe-super-hands-component` |
| **A-Frame-Component-Postprocessing** (akbartus) | Post effects incl. **bloom**, plus film/halftone/etc. | Soft **glow/bloom** so glass panels and the ember horizon bloom against the dark (§4, §8). Use bloom *subtly*; disable or lower on Quest if fps drops. `https://github.com/akbartus/A-Frame-Component-Postprocessing` |
| **aframe-glow** (etiennepinchon) | Cheap per-entity glow halo (no full post pass). | Lightweight alternative to bloom for panel edge-glow on standalone headsets. `https://github.com/etiennepinchon/aframe-glow` |
| **c-frame org** (github.com/c-frame) | The actively-maintained home of modern A-Frame components (super-hands, physics, teleport-controls, etc.). | First place to look for teleport, physics, controls that still work in current A-Frame. `https://github.com/c-frame` |

**Where to browse more:** the A-Frame Registry (`https://aframe.io/aframe-registry/`) and the
community **A-Frame Wiki component directory** — but check last-updated dates; prefer c-frame /
recently-maintained forks.

---

## 2. Glass panels & materials (the signature look, spec §4/§11)

The in-VR "liquid glass" is a **three.js `MeshPhysicalMaterial`** with `transmission`,
`roughness`, `thickness`, `ior ≈ 1.4–1.5`, `iridescence`. A-Frame exposes three.js materials,
so set these on the panel's mesh material.

- **three.js MeshPhysicalMaterial docs** — the exact parameters: `https://threejs.org/docs/pages/MeshPhysicalMaterial.html`
- **three.js glass-transmission tutorial** — `https://sbcode.net/threejs/glass-transmission/`
- **Codrops — transparent glass & plastic in three.js** — great visual reference + settings: `https://tympanus.net/codrops/2021/10/27/creating-the-effect-of-transparent-glass-and-plastic-in-three-js/`
- **Codrops — refraction / warping content inside glass** — for the hero panel: `https://tympanus.net/codrops/2025/03/13/warping-3d-text-inside-a-glass-torus/`

Budget: **true transmission on 1–2 hero panels only**; the rest use the cheaper "frosted"
variant (semi-transparent + rim light + edge glow). An **environment map** (§3 HDRI) is what
makes glass read as glass — always give transmissive materials an envMap.

---

## 3. Lighting & skybox — HDRI (spec §8)

An HDRI environment map drives realistic reflections/lighting and can *be* the sky.

- **Poly Haven — Skies HDRIs** (free, CC0, no login): `https://polyhaven.com/hdris/skies`
- **Poly Haven — Natural Light** (dusk/sunset options): `https://polyhaven.com/hdris/natural%20light`
- Pick a **dusk / after-sunset** sky, download a smaller res (1k–2k is plenty for web/VR),
  use it as the scene env map so glass + models pick up warm horizon reflections. Keep the
  visible dome darker than the envMap if needed so it matches `#080808` overhead.
- Main site: `https://polyhaven.com/` (also has textures + models, all CC0).

---

## 4. Free 3D models (spec §10 — the pendant/glasses/time-collector pieces)

All good for ≤15k-poly, `.glb`, mostly CC0:

- **Poly Pizza** — thousands of low-poly models, no login, AR/VR-ready (successor to Google
  Poly): `https://poly.pizza/`
- **Quaternius** — large CC0 low-poly library, zero strings: `https://quaternius.com/`
- **Kenney** — CC0 game-ready assets/kits: `https://kenney.nl/assets`
- **Sketchfab (CC0 / downloadable filter)** — huge, mixed licenses (filter to CC0/CC-BY): `https://sketchfab.com/tags/low-poly`
- **awesome-cc0** — index of CC0 asset sources: `https://github.com/madjin/awesome-cc0`

Note: Sebastian's own project models (pendant, glasses, Time Collector) are ideal if he can
export them; the above are for pedestals/props/filler only. **Never block a room on a model.**

---

## 5. Textures & surfaces (floor, pedestals, accents)

- **Poly Haven — Textures** (CC0, PBR maps): `https://polyhaven.com/textures`
- **ambientCG** (CC0 PBR materials): `https://ambientcg.com/`
- Use sparingly and low-res in VR; the reflective dark floor (§8) can be a simple material +
  envMap rather than a heavy texture.

---

## 6. Model optimization (required before shipping any .glb)

- **glTF-Transform** — CLI/JS to Draco-compress, resize textures, weld, simplify to hit the
  ≤15k-poly / small-filesize target: `https://gltf-transform.dev/`
- **gltf.report** — drag-drop a `.glb` to inspect polycount, draw calls, texture sizes and get
  optimization suggestions: `https://gltf.report/`
- Always: Draco compression on, textures ≤2k (1k for small props), baked lighting where possible.

---

## 7. Design inspiration / reference (for taste, not copying)

- **Immersive Web / WebXR Samples** — official interaction + session patterns done right: `https://immersiveweb.dev/` and `https://immersive-web.github.io/webxr-samples/`
- **A-Frame homepage examples / showcase** — `https://aframe.io/` (scroll to examples)
- **Codrops** — the gold standard for beautiful web 3D/WebGL articles and demos: `https://tympanus.net/codrops/`
- **Awwwards — WebGL/3D collection** — for spatial UI + motion polish ideas: `https://www.awwwards.com/websites/webgl/`

---

## 8. Typography & tokens (keep it on-brand — pull from the real site)

- Fonts already used by the site (load the same ones in-scene via troika, §1): **Playfair
  Display** (headlines) + **Syne** (UI/body), from Google Fonts; **Atkinson Hyperlegible**
  (Braille Institute) for accessible mode.
- Colors: reuse the exact `:root` tokens and the per-project palette table in
  VR_BUILD_SPEC.md §6 — do not invent new brand colors.

---

## 9. Quick guardrails when using any of the above

- No npm build — load via CDN/ESM `<script>`; pin versions; check the component works with the
  A-Frame version pinned in the spec.
- Test each addition on **Quest 3 + Vision Pro**; some community components predate current
  WebXR input (esp. Vision Pro `transient-pointer`) and may need a shim or a fallback.
- Postprocessing/bloom and transmissive glass are the two biggest fps costs — add them last,
  measure, and dial back on Quest before Vision Pro.
- Respect `prefers-reduced-motion` and `a11yMode` even inside these components.
