# Site audit — the flat pages (2026-09-12)

The companion to `VR_AI_BUILD_GUIDE.md`, which is `/vr`-only by design. This
one covers the twelve hand-written HTML pages at the repo root.

**Scope note:** the build guide's hard rule 3 says *"Don't touch the rest of the
site."* That rule exists to stop an agent working on `/vr` from wandering into
the flat pages. It was overridden here by an explicit request for a full-site
bug audit and fix. If you are here for `/vr` work, rule 3 still applies to you.

The audit is re-runnable: `.tools/audit/` (untracked, like the rest of
`.tools/`) with a README covering the traps each script was written around.

---

## 1. What was actually wrong, and what was done

### 1.1 Six invisible links in the keyboard tab order

`#extraProjects` on the homepage collapses with `max-height: 0;
overflow: hidden`. That hides it **visually** and does nothing about focus:
measured at 0 px tall and opacity 0, it still held **six focusable links** to
project pages, and `element.focus()` on the first one succeeded. A visitor
tabbing through the homepage passed through six links they could not see.

`visibility: hidden` is the property that removes an element from the tab order
and the accessibility tree. It is transitionable as a discrete step, so the
existing animation is untouched:

```
  .work-grid-extra          visibility: hidden   transition: … , visibility 0s linear 0.5s
  .work-grid-extra.visible  visibility: visible  transition: … , visibility 0s
```

Opening flips it at 0 s; closing delays it by the full 0.5 s of the collapse, so
the cards stay on screen on the way out. `.skills-expand-panel` got the same
treatment — it holds no focusable children, so there was no tab-order bug there,
but a clipped panel is still read aloud by a screen reader.

Verified: collapsed → not tabbable; open → 431 px and fully working; closed →
inert again, with `aria-expanded` tracking throughout.

### 1.2 The accessibility toggle did not say whether it was on

A two-state button with `aria-label="Toggle accessible reading mode"` and no
`aria-pressed`, on all twelve pages. The state was carried by a `.active` class
— visual only. A screen-reader user could not tell whether the mode was already
on.

Wired in the three places that already handled `.active`: the markup default,
the on-load sync for state carried over from the previous page, and the toggle
itself. Verified `false → true → false`, and `true` after a reload with the
mode saved.

### 1.3 `slipdoor.html` had no `h2` level at all

Its three content sections — "Need", "Idea + Building", "Result" — were
`<div class="block-label">`. The page's only headings were the `h1` hero and the
`h3` "More Projects", so the outline jumped `h1 → h3` and none of the actual
content was reachable by heading navigation. Every sibling project page goes
`h1 → h2 → h3`.

Converted the three to `<h2 class="block-label">`, with `margin: 0` added to the
class — the class already carried every other visual property, but a UA
stylesheet gives `h2` a 0.83em margin that a `div` never had.

Verified **pixel-identical**: document height 3045 → 3045 px, all three labels
at the same top, height and left as before.

### 1.4 "Accessible reading mode" changed no colours whatsoever

The largest finding. The mode swapped the typeface to Atkinson Hyperlegible,
loosened spacing and bumped the root font size — and touched **no colour on any
page**. So a mode named for accessible reading still served its secondary text
below the 4.5:1 WCAG AA floor, everywhere:

| | default | worst case |
|---|---|---|
| `index` / `experience` `--muted2` | 1.69:1 | the footer copyright line |
| `index` / `experience` `--muted` | 3.52:1 | stat labels, "Scroll" |
| 5 writing pages `--white-faint` | 3.26:1 | captions, meta labels |
| `chess` `--white-faint` | 3.44:1 | hero sub, journey sub |
| `pendant` / `baston` / `slipdoor` `--ink-faint` | 2.72 / 2.67 / 2.99:1 | hero sub, meta labels |
| `timecollector` `--copper` | 4.04:1 | including the link **inside the accessibility explainer** |

Fixed inside `body.accessible` only, per page, in four different token schemes.
**The default palette is byte-identical** — verified with `git diff`: not one
`:root` token was altered or removed by this part of the work. Only a visitor
who asks for the mode gets the brighter values, and the target is an objective
threshold rather than a taste call.

`slipdoor` needed a second override: `--magenta` (`#0091c8`, a blue despite the
name) carries running text on three different grounds, so accessible mode uses
`#006d96` — the same hue, clearing 4.5:1 on white (5.79), `--vwblue-soft` (5.20)
and `--vwblue` (4.77) alike.

Borders and rules were deliberately **not** raised: they are decorative
boundaries, not text, and 1.4.3 does not apply to them.

Verified: **all twelve pages now measure zero AA failures in accessible mode**
on every solid background.

### 1.5 The sub-3:1 outliers in the *default* palette

Decided separately from 1.4: the faint palette is a deliberate design and stays,
but a few values sat well below the site's own 3.4–3.9:1 norm and read as
mistakes rather than choices. Those were lifted to the norm, and nothing else
was touched.

```
  index/experience --muted2     0.20 -> 0.36   1.69:1 -> 3.05:1   (stays dimmer than --muted)
  baston           --ink-faint  0.42 -> 0.51   2.67:1 -> 3.46:1
  pendant          --ink-faint  0.42 -> 0.50   2.72:1 -> 3.45:1
  slipdoor         --ink-faint  0.45 -> 0.50   2.99:1 -> 3.48:1
  slipdoor         --magenta    #0091c8 -> #0086b9   2.94:1 -> 3.39:1 on --vwblue
```

`--muted2` was held at 0.36 rather than the 0.39 that reaches 3.4:1, because
0.39 is indistinguishable from `--muted`'s 0.40 and the token's whole purpose is
to be the dimmer of the two. Checked before changing: `--muted2` is used for
`color` in three places and nothing else; `--ink-faint`'s only non-text use is a
6 px state dot in the accessibility toggle, which a slightly darker value
improves.

The 3.4–3.9:1 tier is untouched and still fails AA in default mode. That is a
standing design decision, not an oversight — accessible mode is the answer to it.

### 1.6 No keyboard focus indicator anywhere

No page defined one, so Tab-navigation fell back to whatever the browser draws.
That matters more here than on most sites: `cursor: none` hides the system
pointer in favour of a custom dot and ring, so pointing got real design
attention and the keyboard got none.

One rule per page, plus a retunable token:

```css
  :root { --focus-ring: <the page's own primary text colour>; }
  :focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
  .work-card:focus-visible, .quick-link:focus-visible,
  .mini-card:focus-visible, .quick-link-mini:focus-visible { outline-offset: -3px; }
```

`:focus-visible` and not `:focus`, so a mouse click never draws a ring — that is
what makes it free for mouse users. `outline` and not a border or box-shadow,
because it paints outside the box (never shifts layout) and follows the
element's own border-radius, which the nav's pill controls rely on. The negative
offset on cards is because `.work-grid-extra` clips to `overflow: hidden` and an
outset ring would be cut off at the panel edge.

Ring contrast against each page's ground: 15.9–19.3:1, and 11.5:1 at the darkest
stop of `timecollector`'s gradient — well past the 3:1 a focus indicator needs.

**Chrome will not match `:focus-visible` for a programmatic `.focus()`**, by
design, so this cannot be screenshotted headlessly. What was verified: the
declaration resolves and renders (`2px solid rgb(245,245,240)` at 3 px offset
via an equivalent forced rule), and plain `.focus()` correctly yields
`outline-style: none`. Press Tab on the real page to see it.

### 1.7 Every `sitemap.xml` date was stale

All twelve `<lastmod>` values were behind reality by up to two months
(`2026-07-06` on pages last changed in September). Crawlers use `lastmod` to
prioritise recrawls. Refreshed from each file's real last-commit date; the XML
re-parses and still holds twelve `<url>` entries.

**This goes stale again on every content change.** Worth folding into whatever
the deploy step becomes.

### 1.8 Content clipped off the screen on a 320px phone

Found only after widening the sweep from 375 px to 320 px — the narrowest
viewport still in real use (iPhone SE 1st/2nd gen, small Androids). These pages
set `body { overflow-x: hidden }`, so nothing overflowing is *scrollable*: it is
simply cut off, silently.

Three separate causes, all pre-existing. Confirmed by diffing against
`git show HEAD:` of the same file before touching anything — the nav one
reproduced identically on the committed version, so none of this was self-
inflicted.

**The nav ran out of room.** Logo + back-link + accessibility toggle sit on one
`space-between` row whose content is a fixed ~344 px and does not shrink below
the existing 768 px breakpoint. Under ~361 px of usable width the toggle runs
off the right edge: measured **56 px cut off at 320 px** and 20 px at 360 px,
which eats most of the word "Accessibility" — on that control in particular.
Fixed by letting the row wrap below 380 px, which is safe because `nav` is
`position: sticky` and still in normal flow, so it grows and pushes the page
down rather than overlapping it. `index.html` already does exactly this.

**`.quick-link-mini` could not shrink at all** — `white-space: nowrap` on a
centred pill, so it hung off *both* edges (21 px over on `timecollector`). Now
wraps below 380 px; the row is already `flex-wrap: wrap`, so a two-line pill
costs nothing.

**`chess`'s process text overflowed by 36 px.** A `1fr` grid track is
`minmax(auto, 1fr)`, and that `auto` floor is the content's **min-content**
width — so the step's body column refused to shrink past the collage grid
inside it. `minmax(0, 1fr)` removes the floor; the collage also drops to one
image per row below 380 px, since two columns inside ~180 px is a smudge, not a
photograph.

Verified: all five project pages now report **zero** overflowing elements and no
page-level overflow at 320 px, with nav wrap, quick-link wrapping and step
columns all unchanged at 390 / 768 / 1280 px.

---

## 2. Checked, and NOT a problem

Recorded so the next pass does not re-raise them.

| Claim | Verdict |
|---|---|
| Dead links, anchors, images, PDFs | **None.** 195 distinct local URLs HTTP-checked across 42 pages; every one 200. Cross-page `#fragment` targets all resolve. |
| Case-sensitivity deploy bugs | **None.** macOS is case-insensitive and GitHub Pages is not, so a wrong-case reference works here and 404s live. Every reference matches its file's real case. |
| Broken or never-loading images | **None**, desktop or mobile, after forcing every lazy image to load and scrolling each page end to end. |
| Horizontal overflow at 375 px | **None** on any of the twelve pages. But 375 px was too generous a floor — see §1.8 for what 320 px turned up. |
| JS errors | **None** on any page. The only console output site-wide is A-Frame 1.5.0's own `useLegacyLights` deprecation warning from `/vr`, which rule 2's version pin makes unfixable. |
| `aria-expanded` on the two disclosure toggles | **Already correct** — both set it on every toggle. |
| The accessible-mode restore scripts | **Consistent across all twelve pages** — each sets the class on both `<html>` (for the root font-size, avoiding a flash) and `<body>` (for the font swap). |
| `vr/index.html` references two undeployed audio clips | **Safe, and already documented in the markup.** The clips are gitignored, so they do not exist in production — but the element is `preload="none"`, so nothing is ever fetched. Confirmed at runtime: `networkState` never leaves idle. |
| `vr/index.html` structure | **Clean.** 37 ids, no duplicates; all 45 component scripts exist and carry a `?v=`; every `querySelector('#…')` target exists in the markup. |
| `images/.DS_Store` | Gitignored and untracked. Not deployed. |
| `index.html`'s hero photo is 15 px wider than the viewport at 320 px | **Benign and deliberate.** `.hero-photo-wrap` is `width: 100vw` in the mobile media query, with a comment explaining the full-bleed intent. `100vw` includes a classic scrollbar that phones do not have, so on a real device it equals the viewport exactly; on a narrowed desktop window `overflow-x: hidden` absorbs it and crops 15 px off a full-bleed decorative photo. Confirmed no page-level scroll results. |

---

## 2b. A structural change made in the same pass (not a bug fix)

`vr-spatial-portfolio.html` is new: a project page about building `/vr`, written
as a process narrative. Two consequences a future auditor should know about.

**The nav's "Experience in VR" no longer points at `/vr`.** It points at this
page, which carries two prominent "Enter the dome" buttons. Deliberate: the
`/vr` arrival gate exists to apologise for dropping someone into a headset
experience with no context, and a page in front of it does that job better.
Direct links to `/vr` still work and are unchanged.

**It is deliberately NOT in the homepage work grid**, at Sebastian's request,
while being a full project page in every other respect — same template, same
nav, same More Projects list at the end. It is in `sitemap.xml`.

That has one knock-on: **`/vr` will not list this project.**
`data-loader.js` discovers projects by scraping `a.work-card` out of
`index.html`'s two grids (`:scope > a.work-card` in the main grid, plus the
extra grid), so a page outside the grid is invisible to the dome. Giving this
project a room inside the dome — which is the obvious next step, and pleasingly
recursive — needs a deliberate decision about how it gets in, since the normal
route is the grid it is being kept out of.

---

## 3. False positives chased and discarded

Most of these looked like real bugs. Reading them will save the next pass the
same hours.

* **Two "duplicate ids" in `index.html`** — both inside a *JavaScript* comment
  explaining how to change the name. The audit stripped HTML comments but not
  script bodies. See the `.tools/audit/README.md` note: strip
  `<script>`/`<style>` in **one** pass, because a CSS comment here contains the
  word `<script>` and a two-pass strip eats the `</style>`.
* **A `<a>` with no `href`** — same cause, inside a CSS comment.
* **A `<url>` block with no `<loc>`** in `sitemap.xml` — the file's own header
  comment says *"copy one `<url>...</url>` block"*.
* **Seven "broken images" on the homepage** — an off-screen iframe never
  triggers `loading="lazy"`, so `complete` was false. The correct broken test is
  `complete === true && naturalWidth === 0`.
* **Contrast of 1.01–1.18:1 on every `.mini-card` label**, across four pages —
  that text sits on a `.mini-card::after` gradient scrim
  (`rgba(0,0,0,0.78)` at the bottom) over a photo. A pseudo-element background
  is not in the ancestor chain, so an ancestor walk finds the light page
  background instead. Legible in reality.
* **Contrast of 1.11:1 on `timecollector`'s 115 px hero title** — background
  image. If a giant title reports as invisible, the tool is wrong, not the page.
* **`.back-link` "not picking up" the accessible-mode colour** — it has a
  `color` transition, and with the Browser pane hidden the compositor is paused,
  so `getComputedStyle` returned the pre-change value indefinitely. The same
  cause made the extra-projects panel look like it would not open and made a
  working fix look inert. **Three separate false results in one session from
  this one mechanism.** Inject
  `*{transition:none!important;animation:none!important}` before measuring.
* **`index.html → vr/`** flagged as a reference to an undeployed path — it is a
  directory, and `vr/index.html` is tracked.

---

## 4. Open, deliberately not changed

* **The 3.4–3.9:1 tier in default mode** still fails AA for normal-size text.
  Standing design decision (§1.5); accessible mode is the answer.
* **Eleven external links use `target="_blank"` without `rel="noopener"`.**
  Every current browser implies `noopener` for `target=_blank`, so this is a
  no-op except on long-dead versions.
* **`images/chess-final-AI-Pieces.jpg` has no `loading="lazy"`.** The other two
  flagged images are the homepage hero and should stay eager — one already
  carries `fetchpriority="high"`.
* **`/vr`'s hand raycasters use `far: 1000`** against the head cursor's
  `far: 20`, which `xr-select.js` hardcodes to match. Inert — nothing
  `.clickable` exists past 12 m in the dome — but inconsistent.
* **`<h3 class="more-projects-title">` on `slipdoor`** is now correct because the
  page has an `h2` level (§1.3), so it was left as `h3` to match its four
  sibling pages rather than renumbered.
