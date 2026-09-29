# Build Guide for AI Assistants — the repository

> **The repo-wide companion to [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md).**
>
> That one is `/vr` only, by design, and it is 4,300 lines. This one covers
> everything else: the twelve flat pages, the deploy, the local tooling, and the
> traps that are not specific to the headset. If your task is outside `vr/`,
> this is the file you need and the VR guide is not.
>
> Short operating rules — what to ask, how to commit, how to verify — are in
> [`../CLAUDE.md`](../CLAUDE.md). This file is the detail behind them.

---

## 1. What this is

A static portfolio at [sesteva.com](https://sesteva.com). Hand-written HTML,
one file per page, each carrying its own inline `<style>`. No build system, no
framework, no `package.json`, no shared stylesheet at the root. The only part
with an architecture is `vr/`.

This is a deliberate choice, not technical debt. It means any page can be
opened, read top to bottom, and understood without tooling — and the pages are
extensively commented to that end, including a legend at the top of
`index.html` telling a future editor where to change colours, fonts, and
projects.

**Do not introduce a build step.** Not a bundler, not a CSS preprocessor, not
a static site generator, not a `package.json`. If a task seems to need one,
that is the signal to ask rather than to add it.

## 2. The deploy, which is the thing most likely to surprise you

GitHub Pages, `build_type: legacy`, serving the **root of `main`**. `CNAME`
holds `sesteva.com`; HTTPS is enforced and the certificate covers the apex and
`www`.

Consequences worth holding onto:

1. **A push to `main` is a publish.** There is no staging, no preview
   deployment, no approval gate. Commit freely; ask before pushing.
2. **Everything tracked is served, including the documentation.**
   `https://sesteva.com/docs/VR_AI_BUILD_GUIDE.md` returns `200 text/markdown`.
   This was already true at the repo root before these files moved into
   `docs/`. It is not a leak — the repository is public — but it does mean the
   build notes are reachable from the portfolio domain. Excluding them would
   take a `_config.yml` with an `exclude:` list, which is tracked as an issue
   rather than done silently, since it touches deploy configuration on a live
   site.
3. **The legacy build type means Jekyll is running.** Files and directories
   beginning with `_` or `.` are not copied to the published site. Do not lean
   on that for anything that matters — `vr/_dev-*` is *also* gitignored, and
   the belt-and-braces is intentional.
4. **Propagation is roughly a minute**, and the CDN caches. A change that
   "didn't deploy" has usually deployed; check with a cache-busted URL before
   investigating anything else.

## 3. The traps

The same principle as the VR guide's §3: these are collected here because each
one produced a *convincing wrong answer* rather than an error. They cost real
time. Several were rediscovered more than once.

### 3.1 macOS is case-insensitive. GitHub Pages is not.

`images/Hero.jpg` referenced as `images/hero.jpg` works perfectly on the laptop
and 404s in production. Nothing local will ever catch this. `.tools/audit/case.js`
exists for exactly this check and should be run after any batch of asset
renames.

### 3.2 A local server cannot reproduce a transfer size

GitHub Pages gzips text and many binaries, so the `Content-Length` a visitor
receives is the **compressed** size. `python3 -m http.server` serves
uncompressed and will report a different, larger number — and no amount of
care on localhost will close the gap.

Use the `static-site-gzip` launch config (`.tools/serve_gzip.py`) whenever a
size figure is going into a commit message or a document. Better still, measure
the deployed URL.

### 3.3 Tracked markup can reference a gitignored file

The markup is committed, the asset is not, and it works flawlessly on the
machine where the asset exists. In production it 404s. `.tools/audit/deployed.js`
scans for exactly this shape. It matters here specifically because `.tools/`,
`vr/_dev-*`, the audio clips, and `portfolio-sharp/` are all ignored on
purpose — there are many ways to reference something that will not ship.

### 3.4 HTML comments are not inert, and `<script>`/`<style>` must be stripped in one pass

Any tool that reads this repo's markup has to deal with two overlapping
problems, and both have already produced phantom findings:

- **One pass, not two.** A CSS comment in this repo contains the word
  `<script>`. Strip scripts first and the match runs from there to the next
  `</script>` — sailing past the `</style>` — leaving half a stylesheet in
  scope. That reported markup named inside CSS comments as real elements: a
  phantom duplicate `id`, a phantom `<a>` with no `href`. `sitemap.xml`'s own
  header comment contains a literal `<url>` block and does the same thing.
- **Strip comments too.** The asset scans deliberately run with `<script>` and
  `<style>` *intact*, because that is what lets them see references the markup
  scan cannot — and so they were still reading HTML comments. An authoring note
  containing `<img src="images/FILE.jpg">` got reported as a dead link.

The rule generalises: **every scan wants comments gone; they just disagree
about which blocks to keep.**

### 3.5 Contrast cannot be computed against imagery

`tokens.js` and `literals.js` work on solid grounds only. Text over a
photograph, a gradient, or a `::after` scrim has no single backdrop colour, and
measuring it against the nearest solid ancestor produced **1.01:1 on text that
is plainly legible**. Every `.mini-card` label on this site sits over an
`rgba(0,0,0,0.78)` gradient scrim that is a pseudo-element and therefore
invisible to an ancestor walk.

Those need eyes, not maths. A contrast number over imagery is not evidence.

### 3.6 A hidden browser pane pauses the compositor

When the preview pane is hidden, **CSS transitions never advance** and
`getComputedStyle` returns the start value indefinitely. This faked three
results in a single session: a panel that would not open, a colour that would
not change, a fix that looked inert — all of them actually correct.

Inject `*{transition:none!important;animation:none!important}` before measuring
anything that transitions.

### 3.7 The accessible-mode trap

`a11yMode` in `localStorage`, applied to `document.documentElement` by an inline
script **before paint** so there is no flash, and re-applied on every page so
the setting carries across navigation. Two things have gone wrong with it:

- It once changed no colour at all — a mode called "accessible reading mode"
  that served the same palette. Any change to the default palette needs the
  accessible override checked alongside it.
- The `.nav-beta` pill deliberately sits outside the `body.accessible`
  override so it can keep `--ember`. Do not "fix" that inconsistency.

### 3.8 Empty `alt` is sometimes correct

`contact-photo-mosaic.jpg` carries `alt=""` on purpose: it is the bottom layer
of a two-image composite that the top layer already describes. Filling it in
would make a screen reader announce the same photograph twice. Check for a
composite before treating an empty `alt` as a bug.

## 4. The flat pages

| File | Notes |
|---|---|
| `index.html` | ~96 KB, the largest. Hero with a one-time name-scatter animation gated on `sessionStorage.heroAnimPlayed` and `prefers-reduced-motion`, work grid, contact. Carries the authoritative `:root` token block and the editor legend. |
| `experience.html` | Work history. Separate file by design — the legend in `index.html` says so. |
| Ten project pages | `chess`, `pendant`, `slipdoor`, `baston`, `timecollector`, `3d-printed-glasses-frames`, `algorithmic-modeling-shape-optimization`, `apple-medical-licensure-apple-watch`, `hp-reckoning-corporate-espionage`, `social-engineering-predictive-algorithms` |
| `vr-spatial-portfolio.html` | "The Dome, a portfolio you walk into." The flat page about `/vr`, and where the nav's `Experience in VR` link lands. |
| `touchscreen/index.html` | A standalone one-off. Nothing links to it. |

Every page shares the same head contract: the pre-paint `a11yMode` script,
`<title>`, a `meta description`, `robots`, a `canonical`, the full Open Graph
and Twitter card set with an absolute `og:image`, and the favicon. **When
adding a page, copy that block and fill it in** — and add the page to both
`sitemap.xml` and `llms.txt`.

### `llms.txt`

A hand-written prose description of Sebastian and every page, for language
models. It is not generated, it goes stale silently, and it is the one file
that will confidently describe a page that no longer exists. Update it when
pages change.

### `sitemap.xml`

Every `<lastmod>` in it was stale once already (`SITE_AUDIT.md` §1.7). If you
change a page's content meaningfully, change its date.

## 5. Tooling

Everything lives in `.tools/`, which is **gitignored** — it holds a 38 MB
cloudflared binary and a self-signed cert with its private key. It is therefore
one `rm -rf` away from being gone, and this section is the only durable record
of what is in it.

| | |
|---|---|
| `.tools/audit/*.js` | Standalone node, no dependencies, run from the repo root. `refs2.js` (dead links, anchors, assets, duplicate ids, alt text, headings, meta, sitemap), `case.js` (§3.1), `deployed.js` (§3.3), `http.js` (real status of every reference — needs the dev server up), `tokens.js` (contrast of every `:root` rgba token), `literals.js` (colour literals bypassing a token). Its own README documents the traps each was written around; those are reproduced in §3 above. |
| `.tools/serve_gzip.py` | The gzip dev server. §3.2. |
| `.tools/serve_https.py`, `vr-phone.sh`, `certs/`, `phone-qr.html` | LAN HTTPS plus a QR code for phone and headset testing; can tunnel via cloudflared. WebXR requires a secure context, so plain http does not work on-device. |
| `.tools/vr-image-index.py`, `vr-image-picker.py` | Index every image and choose which ones each VR room uses. The picker is a local GUI, launchable as `vr-image-picker` from `.claude/launch.json`. |
| `.tools/vr-make-pages.py`, `vr-make-textures.py`, `vr-shrink-pdfs.py` | Generators for the VR reading stations, textures, and the PDF page images. |

Launch configs are in `.claude/launch.json`: `static-site` (8080),
`static-site-gzip` (8099), `vr-image-picker` (8765).

Node is available (v26) for the audit scripts and for headless JS work.

## 6. Verifying a change

Match the effort to the risk — a one-line CSS tweak does not need a rig. When
verification *is* warranted:

1. Serve locally, load the page, and read it — `read_page` and
   `get_page_text` over screenshots for anything textual or structural.
2. Check the console and network for errors.
3. For anything that transitions, kill transitions first (§3.6).
4. For sizes, use the gzip server or the deployed URL (§3.2).
5. For assets, run `case.js` and `deployed.js` before pushing (§3.1, §3.3).
6. Send actual image files for anything visual. In-tool screenshot results are
   not visible to Sebastian.

After a push, confirm against the live URL with a cache-buster rather than
assuming.

## 7. Editing conventions

- **Comment the reasoning, not the syntax.** This codebase's comments explain
  why a decision was made and what broke when it was made differently. They are
  frequently the only record. Match that density — it is the house style, and
  it is why a stranger can read `index.html`.
- **Prose on the site avoids the em dash.** The site's own copy was
  deliberately rewritten to carry its sentences without them. Documentation and
  commit messages are not bound by this.
- **Tokens, not literals.** Colours come from the `:root` block.
  `literals.js` finds the ones that escaped.
- **Never hand-duplicate content into `/vr`.** The scene scrapes the flat
  pages. The fix for an empty VR room is to write the sentence *on the page*,
  once, where both surfaces read it — after asking.
- **Provenance for anything written about a project** goes in the `$why`
  fields of `vr/images.json`. Every sentence should trace to the page, to a
  legible annotation in one of its own images, or to something Sebastian said.

## 8. Precedence

The code wins over any document. Among documents: this file and the current
shelf of [`docs/`](README.md) win over [`archive/`](README.md#archive). For
anything inside `vr/`, [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) wins over
this file, and its §9 work log is its own newest layer.

When this file is wrong, fix it in the same commit as the thing that made it
wrong.
