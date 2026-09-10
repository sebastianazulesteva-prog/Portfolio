/* ═══ reading-line.js ═══
   The reading ruler, brought into the VR reader.

   Sebastian: *"I'm curious if we can use the same feature that we have in the
   website for the line reader where it highlights the line you're currently
   reading … so when you're looking at a line, it'll highlight that line you're
   looking at to make it easier to read it. And then the person with the cursor
   can basically push down, it'll highlight the line below."*

   The flat site's version is `initA11yLineHighlight()` in /index.html: one
   translucent bar per text block, clipped by `clip-path` to a single
   line-height band and moved to whichever line the cursor is over. It is gated
   behind Accessible Mode, and the reason it is there at all is in that mode's
   own explainer card — reading rulers measurably improve reading speed and
   comprehension, for readers with and without dyslexia.

   ── The hard part: there is no text here ────────────────────────────────────
   The flat site knows where a line is because the browser laid it out —
   `getComputedStyle(el).lineHeight` and a rect. The VR reader shows
   PRE-RENDERED PAGE IMAGES (pdf-reader.js's header explains why: pdf.js
   rasterises on window rAF, and that clock does not run inside an immersive
   session). There is no text layer, no glyph boxes, no line height. Nothing to
   ask.

   So the lines are FOUND, from the pixels, by a row-projection profile:
   count the ink in every row of the page and the text lines fall out as bands
   separated by the leading. That turns out to be better than a computed
   line-height would have been, not worse — the band lands on the ink actually
   there, so a heading, a block quote and a figure caption each get their own
   correct height instead of one document-wide guess. See detectLines().

   Two properties of that worth stating up front:
   • It costs ONE canvas read per page, on the page you are pointing at, and the
     result is cached on the page record. It survives the texture being disposed
     (bands are numbers, the trail/dispose cycle frees GPU memory only), so
     scrolling back through a document never re-analyses it.
   • It is polarity-agnostic. Two of the five pieces are 16:9 slide decks, and a
     dark slide with light type has to work the same as white paper with black
     type. The profile counts DEVIATION FROM THE PAGE'S OWN DOMINANT TONE, not
     darkness, so both give the same answer. A fixed "luma < 158" threshold
     would find every line on the essays and nothing at all on a dark deck.

   ── The highlight is a highlighter, not a backing bar ───────────────────────
   The flat site lays `rgba(245,245,240,0.32)` BEHIND the text, which works
   because that page is dark type on… no — dark background with light type, so
   lightening the band raises the line out of the page. A rendered PDF page is
   the other way round, and it is an opaque image: there is no behind. Putting
   the same translucent off-white in FRONT would wash the black type toward grey
   and take contrast away from the one line you are trying to read — the exact
   opposite of the point.

   So the band MULTIPLIES instead: `blending: MultiplyBlending`, tinting the
   paper of that line warm while leaving the ink at full black. That is what a
   real highlighter does, it is the same "the background of this line is
   different" signal the flat site sends, and on a dark slide it reads as a
   shadowed band rather than a glow. The tint is the dome's own ember family, so
   the reader's one new colour is not a new colour.

   Note MultiplyBlending IGNORES material.opacity — the blend is
   `dst = src.rgb * dst.rgb` with no alpha term — so strength is controlled by
   mixing the tint TOWARD WHITE (1.0 = no change) inside the shader, not by
   fading opacity. Setting opacity here does nothing at all, silently.

   And the tint must reach the shader UNCONVERTED — see srgbVec() below, which
   exists because passing it through THREE.Color silently turned the cream into
   a tan. That was caught by sampling rendered pixels, not by reading code.

   ── Two ways to drive it ────────────────────────────────────────────────────
   FOLLOW (the default) — the band tracks the line under the pointer: the mouse
   on desktop, head-gaze in VR (fallback.js swaps the cursor to
   `rayOrigin: entity` on enter-vr), a controller ray on a Quest.

   DRIVE — click the page and the band steps down one line, and every further
   click steps it down again. This is Sebastian's "push down". Clicking is what
   enters DRIVE, and in DRIVE the pointer is ignored, which is the whole reason
   the mode exists: on a desktop the mouse is still sitting on the line you just
   stepped off, so a band that kept following would undo every click.

   Returning to FOLLOW: leave the page with the pointer, or move it two or more
   lines away from where it was when you last clicked. Two lines, not one, so
   the jitter of holding a head still does not keep dropping you out of DRIVE.

   The band PERSISTS when the pointer leaves the page — it is your place in the
   text, and losing it because you glanced at the scroll rail would make it
   worse than no ruler at all. (The flat site collapses its bar on mouseleave;
   there, the pointer never leaves the document except to leave the page.)

   ── Stepping down scrolls the page when it has to ───────────────────────────
   The reader's whole premise is that the line you are reading sits at eye level
   (pdf-reader.js's PAGE SIZE / READING ERGONOMICS note). Clicking down twenty
   times would otherwise walk the band to your knees. So an advance that pushes
   the band below the comfortable band scrolls the strip to bring it back, using
   the reader's own eased scrollBy — the same motion the rail produces, not a
   second kind of scrolling. Gaze-following never scrolls: the page moving
   because you looked at it is how you lose your place.

   ── Usage (pdf-reader.js owns the lifecycle) ────────────────────────────────
     var rl = sceneEl.systems['vr-reading-line'];
     rl.begin({ strip: stripEl, pages: state.pages, pageW: …, pageH: …,
                step: …, topY1: …, readDistance: …, eyeHeight: …,
                scrollOf: fn, scrollBy: fn });
     rl.end();
   Inert until begin(): no geometry, no listeners, one early return per tick.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Detection tuning ──────────────────────────────────────────────────────
  // Width the page is sampled at. Only wide enough to answer "is there ink in
  // this row, and between which columns" — the horizontal extent is used to
  // make the band hug the type instead of running the full page width, and at
  // 120 columns that extent is quantised to ~0.8% of the page, well under the
  // padding added around it. Vertical resolution is NOT reduced (see below).
  //
  // 120 rather than the 160 first written, because the cost of this turned out
  // to matter. Measured in the browser on a real shipped page (1275 x 1650),
  // per page, warm: at 160 the whole analysis ran 10.4 ms, which at 90 Hz is a
  // dropped frame the moment you look at a page for the first time. Broken
  // down, it was getImageData 6.4 ms and the two pixel passes 4.0 ms — so the
  // fix was to sample narrower, subsample the histogram (below), and drop the
  // `willReadFrequently` context hint, which is the wrong hint for a single
  // read and measurably made drawImage cheaper at getImageData's expense.
  var SAMPLE_W = 120;
  // The histogram only has to find the page's DOMINANT tone, which is present
  // in essentially every row, so it reads every 4th row rather than every
  // pixel. Still hundreds of thousands of samples on a real page — the mode
  // does not move — for a quarter of the work.
  var HIST_ROW_STRIDE = 4;
  // Height is left alone up to this, because vertical resolution IS the
  // measurement. Body lines in these documents sit ~30 px apart at the shipped
  // 150 DPI / 1700 px long edge; halving that to 850 leaves 15 px per line, and
  // the leading between two lines becomes 3-4 rows, which is inside the noise
  // that WebP leaves around justified type. Bands then merge in pairs, silently
  // — you get a ruler that highlights two lines at a time and looks like a
  // design choice.
  var SAMPLE_MAX_H = 2048;
  // A pixel counts as ink if its luma differs from the page's dominant tone by
  // more than this (0-255). Generous: antialiased serif stems on white paper
  // come through around 90-140, and JPEG/WebP ringing around type sits under 25.
  var INK_DELTA = 55;
  // A row counts as part of a line if at least this fraction of the sampled
  // columns hold ink. One stray column is dust or a compression artefact; a
  // real line of justified body text lights up 60-90% of them, and even a short
  // last line of a paragraph clears 8%.
  var ROW_INK_FRAC = 0.02;
  // Rows this close together belong to the same band — bridges the gap between
  // a line's x-height body and the row of dots on an ellipsis or the tail of a
  // comma, which can otherwise split one line into two bands.
  var BRIDGE_ROWS = 2;
  // Bands shorter than this fraction of the MEDIAN band height are dropped.
  // Self-calibrating on purpose, because it has to remove two different things
  // at once and neither has an absolute size: the horizontal rules under a
  // running header (1-2 rows, full width) and specks of compression noise.
  var MIN_BAND_FRAC = 0.45;
  // …and a band narrower than this fraction of the page is a speck wherever it
  // lands, however tall it is.
  var MIN_BAND_WIDTH = 0.02;
  // The rendered band's height, as a fraction of the LINE PITCH (the median
  // distance between consecutive line centres) rather than of the ink it
  // covers. Matching the pitch is what makes it read as a reading ruler: an ink
  // hugging band is 20 px tall on a line with no descenders and 30 px on the
  // next one, and a ruler that changes height as it steps looks like a bug.
  // 0.84 leaves a visible sliver of paper between consecutive lines, so you can
  // still see WHICH line is lit when you step.
  var BAND_PITCH_FRAC = 0.84;
  // Fallback for a page with a single band (a slide with one title) where there
  // is no pitch to measure.
  var BAND_INK_FRAC = 1.62;
  // Horizontal padding either side of the band's ink extent, in page widths.
  var BAND_PAD_X = 0.012;

  // ── Appearance ────────────────────────────────────────────────────────────
  // Multiplied over the page, so read this as "what white paper becomes": a
  // soft warm cream, the dome's ember diluted rather than a yellow marker. Ink
  // stays ink (0 × anything is 0).
  var TINT = '#f2dcae';
  // How far toward that tint the band goes. Measured against the shipped page
  // images: at 1.0 the paper lands at ~#f2dcae, which against #ffffff either
  // side is a clear band without dropping the paper's own luma far enough to
  // eat into the type's contrast (242 → 92% of white, so black-on-band is still
  // 18:1). Past ~1.0 with a stronger tint the band starts to read as a coloured
  // overlay ON the text rather than as the paper under it.
  var TINT_STRENGTH = 1.0;
  var LIFT_Z = 0.004;      // in front of the page plane; the page is opaque and writes depth
  // §3.6's layer table. The pages are opaque (MeshBasicMaterial, no transparent
  // flag) so they are drawn in the opaque pass before anything transparent, and
  // a bare 0 would already composite correctly. Stated anyway, because "it
  // happens to work because the thing under it is opaque" is exactly the kind
  // of accident that breaks the day a page gains a transparent treatment.
  var RENDER_ORDER = 1;
  // ── Smoothness ────────────────────────────────────────────────────────────
  // Sebastian: *"make sure it feels smooth and doesn't just jump around."*
  // Three separate mechanisms, because there are three separate sources of
  // jumpiness and easing only fixes one of them:
  //
  //   1. EASING — the band glides between lines instead of teleporting.
  //   2. HYSTERESIS — while the pointer sits in the LEADING between two lines,
  //      the lit line does not change. See _lineAt(). Without this the ruler
  //      flickers between neighbours whenever the pointer rests near a boundary,
  //      which is most of the time: head drift of half a degree at the reader's
  //      1.9 m is 0.017 m, and a body line's pitch is 0.036 m — so ordinary
  //      stillness carries the pointer across a boundary and back.
  //   3. A SETTLE TIME — a new line has to be held before it takes. Hysteresis
  //      alone is not enough, because jitter big enough to land *inside* the
  //      next line's ink still switches instantly.
  //
  // Frame-rate-independent, and not a GSAP tween: the band re-targets whenever
  // the gaze crosses a line, several times a second, and killing/rebuilding a
  // tween at that rate is both churn and a source of half-finished transforms.
  // Same reason reticle.js eases in its own tick.
  var EASE_MS = 130;
  var FADE_MS = 160;
  // How long a new line must hold the pointer before the band moves to it.
  // Long enough to absorb jitter, short enough that a deliberate look does not
  // feel like it is waiting for permission — this is a reading aid, not a gate,
  // and it is nothing like the photo cloud's 900 ms dwell (dwell.js), which is
  // gating something that MOVES.
  var SETTLE_MS = 110;
  // A move longer than this snaps instead of easing. Stepping between adjacent
  // lines should glide; jumping to a different part of the page (or onto
  // another page) should just be there, because easing across half a page reads
  // as the highlight flying about.
  var SNAP_OVER = 0.35;

  // ── Driving ───────────────────────────────────────────────────────────────
  // Lines of pointer movement away from where it sat at the last click before
  // DRIVE hands back to FOLLOW. See the header.
  var RELEASE_LINES = 2;
  // How far below the eye the active line may sink before an advance scrolls
  // the strip to bring it back, and where it parks it when it does. Both in
  // metres below eye level.
  //
  // ONE-SIDED, deliberately. The obvious symmetric version — also scroll UP
  // when the line sits above the band — is wrong twice over, and it was written
  // and caught in test before it shipped. First, advance() only ever moves
  // DOWN, so an upward correction can only fire on a line that was already
  // high, which means the visitor's own click would pull them BACKWARDS through
  // the piece. Second, page 1's opening lines sit above eye level ON PURPOSE
  // (pdf-reader.js's LEAD_FRACTION: "you look up to start the piece", which is
  // Sebastian's choice), and an upward correction quietly undoes that framing
  // for anyone who steps the ruler through the first paragraph. It looked
  // harmless in the reader only because scroll is clamped at 0 there, so the
  // very first page could not move — the bug would have appeared on page two.
  var BAND_BELOW = 0.55;
  var PARK_BELOW = 0.20;
  // Sanity cap on a single auto-scroll, in page steps. The interaction cannot
  // produce a large correction — placing never scrolls, and advancing moves one
  // line — so this only catches a desynced state (a harness setting page/line
  // by hand, a document swapped under the ruler). Yanking the strip several
  // metres is worse than not moving it.
  var MAX_AUTO_SCROLL_STEPS = 1;
  // A click whose hit point moved more than this many lines between mousedown
  // and mouseup is a DRAG, not a click, and must not step the band. On desktop
  // look-controls is `reverseMouseDrag` grab-and-push (index.html), so dragging
  // across the page to turn is a completely ordinary thing to do — and A-Frame's
  // cursor emits `click` on mouseup whenever the same entity was under the ray
  // at both ends, however far it travelled in between.
  var DRAG_LINES = 2;

  // ── Colours for a shader that writes straight to the framebuffer ─────────
  // NOT THREE.Color. This is trap §3.5 from the other side, and it was caught
  // by measuring the rendered pixels rather than by reading the code:
  // `THREE.ColorManagement.enabled` is true here, so `new THREE.Color('#f2dcae')`
  // converts the hex from sRGB into the LINEAR working space, and a shader that
  // does not `#include <colorspace_fragment>` then writes those linear numbers
  // into an already-sRGB-encoded framebuffer. Measured: uTint arrived as
  // (0.888, 0.716, 0.423) instead of the authored (0.949, 0.863, 0.682) — blue
  // 38% too dark — which turned a soft cream highlighter into a saturated tan.
  //
  // The shaders here deliberately omit that include (they sample no textures and
  // their colours are hand-picked literals, exactly CARD_FRAG's case), so the
  // literal has to reach the shader UNCONVERTED. Decoding the hex by hand is the
  // only way to say that and have it stay true if three.js's colour-management
  // defaults ever move.
  function srgbVec(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  function median(list) {
    if (!list.length) return 0;
    var s = list.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ── detectLines(image) ──────────────────────────────────────────────────
     Returns an array of bands, top to bottom, in NORMALISED page coordinates
     measured from the page's TOP edge:

       [{ top, bottom, centre, left, right, height }, …]   all 0..1

     plus a `pitch` property on the array (the median centre-to-centre spacing,
     also normalised) — the caller needs it both to size the rendered band and
     to decide how far "two lines away" is.

     Returns null if the image cannot be read. That happens for real: a tainted
     canvas throws on getImageData, and while these page images are same-origin
     today, `trailTextureFrom()` in pdf-reader.js already guards the same call
     for the same reason. A null here means "no ruler on this page", which is a
     missing nicety rather than a broken reader. */
  function detectLines(image) {
    if (!image || !image.width || !image.height) return null;

    var h = Math.min(SAMPLE_MAX_H, image.height);
    var w = Math.min(SAMPLE_W, image.width);
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var data;
    try {
      // No `willReadFrequently`: this reads each page exactly once, and that
      // hint asks for a CPU-backed canvas tuned for repeated reads. Measured,
      // it moved time out of drawImage and into getImageData for a worse total.
      var ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, w, h);
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return null;
    }

    // ── The page's dominant tone ──
    // A 64-bin luma histogram; the fullest bin is the background, because paper
    // (or a slide's fill) is most of every page by area. Deriving it rather than
    // assuming white is what makes a dark slide deck work — and it also absorbs
    // the off-white these scans actually are (the shipped pages sit around 252,
    // not 255, and one deck's fill is a very pale grey).
    var bins = new Uint32Array(64);
    var i, luma, hx, hy, hp, rowBytes = w * 4;
    for (hy = 0; hy < h; hy += HIST_ROW_STRIDE) {
      hp = hy * rowBytes;
      for (hx = 0; hx < w; hx++, hp += 4) {
        luma = (data[hp] * 299 + data[hp + 1] * 587 + data[hp + 2] * 114) / 1000;
        bins[luma >> 2]++;
      }
    }
    var bg = 0, best = -1;
    for (i = 0; i < 64; i++) { if (bins[i] > best) { best = bins[i]; bg = i * 4 + 2; } }

    // ── Row profile ──
    var minCols = Math.max(1, Math.round(w * ROW_INK_FRAC));
    var rowInk = new Uint16Array(h);
    var rowMin = new Int16Array(h);
    var rowMax = new Int16Array(h);
    var y, x, p, count, lo, hi;
    for (y = 0; y < h; y++) {
      count = 0; lo = -1; hi = -1;
      p = y * w * 4;
      for (x = 0; x < w; x++, p += 4) {
        luma = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
        if (Math.abs(luma - bg) > INK_DELTA) {
          count++;
          if (lo < 0) lo = x;
          hi = x;
        }
      }
      rowInk[y] = count;
      rowMin[y] = lo;
      rowMax[y] = hi;
    }

    // ── Group rows into bands ──
    var raw = [];
    var open = null, gap = 0;
    for (y = 0; y < h; y++) {
      if (rowInk[y] >= minCols) {
        if (!open) open = { y0: y, y1: y, left: rowMin[y], right: rowMax[y] };
        else {
          open.y1 = y;
          if (rowMin[y] >= 0 && rowMin[y] < open.left) open.left = rowMin[y];
          if (rowMax[y] > open.right) open.right = rowMax[y];
        }
        gap = 0;
      } else if (open) {
        gap++;
        if (gap > BRIDGE_ROWS) { raw.push(open); open = null; }
      }
    }
    if (open) raw.push(open);
    if (!raw.length) return null;

    // ── Drop rules and specks ──
    var med = median(raw.map(function (b) { return b.y1 - b.y0 + 1; }));
    var kept = raw.filter(function (b) {
      var bh = b.y1 - b.y0 + 1;
      if (bh < med * MIN_BAND_FRAC) return false;
      if ((b.right - b.left + 1) / w < MIN_BAND_WIDTH) return false;
      return true;
    });
    if (!kept.length) return null;

    var bands = kept.map(function (b) {
      // +1 on the row span: a band from row 10 to row 10 covers ONE row of
      // pixels, and its bottom edge is at 11/h, not 10/h. Off by one row is
      // invisible; off by one row consistently makes every band sit a pixel
      // high, which shows up as the ruler clipping the tops of ascenders.
      var top = b.y0 / h, bottom = (b.y1 + 1) / h;
      return {
        top: top, bottom: bottom, centre: (top + bottom) / 2,
        height: bottom - top,
        left: Math.max(0, b.left / w), right: Math.min(1, (b.right + 1) / w)
      };
    });

    var gaps = [];
    for (i = 1; i < bands.length; i++) gaps.push(bands[i].centre - bands[i - 1].centre);
    // Only near-neighbour gaps feed the pitch: the jump across a paragraph
    // break or from the running header into the body is 2-4x a line and would
    // drag a mean upward. A median over ALL gaps is already robust to a few of
    // those, but these pages have enough headings that the outliers stop being
    // few — so they are cut first, against a provisional median.
    var provisional = median(gaps);
    var tight = gaps.filter(function (g) { return g <= provisional * 1.6; });
    bands.pitch = tight.length ? median(tight) : (provisional || median(bands.map(function (b) { return b.height; })) * BAND_INK_FRAC);

    return bands;
  }

  // ── The band's shader ─────────────────────────────────────────────────────
  // Feathered top and bottom, rounded ends. A hard-edged rectangle is what
  // makes a highlight look bolted on; the softness is most of the difference
  // between this and a coloured box.
  //
  // No `#include <colorspace_fragment>` (trap §3.5): nothing is sampled and the
  // tint is a literal authored in output space, exactly the case CARD_FRAG
  // documents. And with MultiplyBlending the shader's job is to output a
  // MULTIPLIER — 1.0 means "leave this pixel alone" — so the feather mixes
  // toward white, not toward transparent. Alpha is unused by the blend.
  var BAND_VERT = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var BAND_FRAG = [
    'uniform vec3 uTint;',
    'uniform float uStrength;',
    'uniform float uFeather;',   // vertical softness, in uv
    'uniform float uRound;',     // end softness, in uv
    'varying vec2 vUv;',
    'void main() {',
    // Both terms are written 1.0 - smoothstep(lo, hi, x) with lo strictly below
    // hi. smoothstep with edge0 >= edge1 is UNDEFINED in GLSL, compiles clean
    // and returns 0 everywhere (trap §3.11) — which here would be a band that
    // is simply never there, and looks like the detector found no lines.
    '  float dy = abs(vUv.y - 0.5) * 2.0;',
    '  float fy = 1.0 - smoothstep(1.0 - uFeather, 1.0, dy);',
    '  float dx = abs(vUv.x - 0.5) * 2.0;',
    '  float fx = 1.0 - smoothstep(1.0 - uRound, 1.0, dx);',
    '  float a = fy * fx * uStrength;',
    '  gl_FragColor = vec4(mix(vec3(1.0), uTint, a), 1.0);',
    '}'
  ].join('\n');

  // Feather/round as fractions of the band's own half-extent. The vertical
  // feather is the visible one; horizontally it only has to take the corner off.
  var FEATHER_Y = 0.42;
  var ROUND_X = 0.06;

  AFRAME.registerSystem('vr-reading-line', {
    init: function () {
      this.cfg = null;
      this.bandEl = null;
      this.mesh = null;
      this.mat = null;
      this.geo = null;
      this.enabled = true;

      this.page = -1;        // active page index
      this.line = -1;        // active band index within that page
      this.mode = 'follow';  // 'follow' | 'drive'
      this.latch = null;     // { page, line } the POINTER sat on at the last click
      this.downAt = null;    // { page, line } at mousedown, for the drag guard
      this.pointer = null;   // { page, line } under the continuous pointer, or null
      this._cand = null;     // a line waiting out SETTLE_MS before it takes

      this._shown = 0;
      // Where the band is being eased to, and where it currently is, in the
      // strip's own space. Kept as plain numbers rather than read back off the
      // object3D so a mid-ease re-target starts from the visual position.
      this._at = null;
      this._to = null;
      this._rays = null;
    },

    /* Open the ruler for a document. `cfg` is read once and held by reference:
         strip         a-entity the page planes hang off (scrolls)
         pages         pdf-reader's page records, each { el, mesh, index, texture }
         pageW/pageH   metres
         step          page pitch down the strip, metres
         topY1         y of page 1's top edge, in strip space
         readDistance  strip's distance from the eye
         eyeHeight     metres
         scrollOf()    current scroll, metres
         scrollBy(m)   the reader's own eased scroll */
    begin: function (cfg) {
      this.end();
      if (!cfg || !cfg.strip || !cfg.pages || !cfg.pages.length) return false;
      this.cfg = cfg;
      this.page = this.line = -1;
      this.mode = 'follow';
      this.latch = this.downAt = this.pointer = null;
      this._cand = null;
      this._shown = 0;
      this._at = this._to = null;

      var self = this;
      // Listeners go on each PAGE entity rather than one delegate on the strip:
      // A-Frame's cursor emits mouse events on the intersected entity itself and
      // they do not bubble through a-entity the way DOM events do on elements
      // with real layout. pdf-reader marks the page entities .clickable, which
      // is what puts them in the raycasters' object lists at all.
      this._onDown = function (e) { self._noteDown(e); };
      this._onClick = function (e) { self._noteClick(e); };
      this._onLeave = function () {
        // Leaving the page hands control back to the gaze. The band itself
        // STAYS — see the header; it is a bookmark, not a hover effect.
        self.mode = 'follow';
        self.latch = null;
        self.pointer = null;
        self._cand = null;
      };
      cfg.pages.forEach(function (rec) {
        rec.el.addEventListener('mousedown', self._onDown);
        rec.el.addEventListener('click', self._onClick);
        rec.el.addEventListener('mouseleave', self._onLeave);
      });
      return true;
    },

    end: function () {
      var cfg = this.cfg;
      if (!cfg) return;
      var self = this;
      cfg.pages.forEach(function (rec) {
        if (!rec.el) return;
        rec.el.removeEventListener('mousedown', self._onDown);
        rec.el.removeEventListener('click', self._onClick);
        rec.el.removeEventListener('mouseleave', self._onLeave);
      });
      // three.js never auto-disposes and neither of A-Frame's removal calls
      // does either (trap §3.17) — and this runs on every close, so a band left
      // behind is a per-open leak of one geometry and one compiled program.
      if (this.bandEl && this.bandEl.parentNode) this.bandEl.parentNode.removeChild(this.bandEl);
      if (this.geo) this.geo.dispose();
      if (this.mat) this.mat.dispose();
      this.bandEl = this.mesh = this.mat = this.geo = null;
      this.cfg = null;
      this.pointer = this.latch = this.downAt = this._cand = null;
      this.page = this.line = -1;
      this._at = this._to = null;
      this._shown = 0;
    },

    /* Off hides the band and stops the analysis; the mode and the active line
       are kept, so turning it back on resumes where it was. Nothing in the
       scene calls this yet — it exists so a toggle (the rail, the HUD, or
       a11yMode, whichever Sebastian wants) is a one-liner rather than a
       refactor. */
    setEnabled: function (on) {
      this.enabled = !!on;
      if (!on) { this.mode = 'follow'; this.pointer = null; this._cand = null; }
    },

    isOpen: function () { return !!this.cfg; },

    // ── Bands for a page, analysed once, cached on the record ───────────────
    // `bands === null` is a REMEMBERED failure, not "not tried yet": a page
    // whose canvas read threw, or which holds no detectable type at all (a
    // full-bleed photo plate), must not be re-analysed on every tick the
    // pointer rests on it. `undefined` is the untried state.
    _bands: function (rec) {
      if (!rec) return null;
      if (rec.bands !== undefined) return rec.bands;
      var img = rec.texture && rec.texture.image;
      // No texture yet (below the render window, or still in the queue): leave
      // it UNTRIED so it is analysed when the image lands.
      if (!img || !img.width) return undefined;
      rec.bands = detectLines(img) || null;
      return rec.bands;
    },

    // ── Which line is a point on a page? ───────────────────────────────────
    // `v` is measured from the page's TOP edge, 0..1. `current` is the line
    // already lit on this page, or -1 / omitted.
    //
    // Inside a line's own ink: that line, no argument. Otherwise the point is
    // in the LEADING between two lines, or in a margin — and "the gap between
    // lines" is not a useful answer to "what am I reading", so it resolves to a
    // real line either way. Two rules for that:
    //
    //   • HYSTERESIS. If `current` is one of the two lines bracketing the gap,
    //     it stays lit. This is what stops the ruler flickering: the boundary
    //     between two lines is somewhere the pointer sits constantly (see the
    //     jitter arithmetic at SETTLE_MS), and without a hold the lit line
    //     alternates several times a second while the visitor is holding still.
    //     The switch then happens when the pointer reaches the next line's own
    //     ink — which is also the point at which a reader would say they had
    //     moved on to it.
    //   • Otherwise, nearest by centre. That covers a first placement, a jump
    //     into a margin, and a gap the currently lit line has nothing to do with.
    _lineAt: function (bands, v, current) {
      if (!bands || !bands.length) return -1;
      var i;
      for (i = 0; i < bands.length; i++) {
        if (v >= bands[i].top && v <= bands[i].bottom) return i;
      }
      // The last band lying entirely above the point, and so (with prev + 1)
      // the pair bracketing the gap it is in. The bands are sorted and
      // non-overlapping — both asserted in test — so the first band that is not
      // above the point ends the scan.
      var prev = -1;
      for (i = 0; i < bands.length; i++) {
        if (bands[i].bottom < v) prev = i; else break;
      }
      if (current != null && current >= 0 &&
          (current === prev || current === prev + 1)) return current;

      var bestI = 0, bestD = Infinity, d;
      for (i = 0; i < bands.length; i++) {
        d = Math.abs(v - bands[i].centre);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      return bestI;
    },

    // Resolve an intersection against a page mesh into { page, line }.
    _hitToLine: function (hit) {
      var cfg = this.cfg;
      if (!cfg || !hit || !hit.uv) return null;
      var recs = cfg.pages, i, rec = null;
      for (i = 0; i < recs.length; i++) {
        if (recs[i].mesh === hit.object) { rec = recs[i]; break; }
      }
      if (!rec) return null;
      var bands = this._bands(rec);
      if (!bands || !bands.length) return null;
      // PlaneGeometry's uv origin is BOTTOM-left, and the page texture is
      // uploaded with three.js's default flipY, so image row 0 shows at uv.y 1.
      // Both flips together mean v-from-the-top is 1 - uv.y. Getting this
      // backwards does not look like a bug — it looks like the ruler tracking
      // your gaze mirrored about the page's middle, which is easy to read as
      // "the detector is off".
      var v = clamp01(1 - hit.uv.y);
      // Hysteresis is only meaningful against the line lit ON THIS PAGE — on
      // any other page there is no "current" to hold, and passing one would
      // make a gap on page 3 resolve to a line index borrowed from page 2.
      var line = this._lineAt(bands, v, rec.index === this.page ? this.line : -1);
      if (line < 0) return null;
      return { page: rec.index, line: line };
    },

    // The continuous pointer: the head cursor, plus either hand. Nearest hit
    // wins, so the scroll rail and the exit button — both pulled toward the
    // viewer in front of the page — keep their own hover rather than having the
    // ruler read through them.
    // Through VRPointer as of 2026-09-08, and the fix matters most here.
    //
    // This used to walk the three raycasters itself and take the nearest hit.
    // With no controller connected — which is EVERY Vision Pro session, since
    // there are no controllers to connect (§3.13) — the two hand entities have
    // never moved off the rig origin and cast a permanent ray along -Z at floor
    // level. Measured in the reading room: the hands report a hit 1.90 m away
    // at y 0.00 while the gaze reports one 2.08 m away at y 2.45, so the
    // phantom wins "nearest" on every frame.
    //
    // The ruler was therefore tracking the floor, not the reader: it still lit
    // a line, so it looked alive, but always a low one and never the one being
    // read. On a desktop the mouse ray usually lands nearer than the phantom
    // and hides it, which is why it survived testing.
    _readPointer: function () {
      var hit = window.VRPointer ? VRPointer.nearest() : null;
      return this._hitToLine(hit);
    },

    // ── Input ──────────────────────────────────────────────────────────────
    _noteDown: function (e) {
      // Prefer the pointer the tick already resolved; fall back to the event's
      // own intersection, which is the only thing available on a Vision Pro —
      // xr-select.js bypasses A-Frame's cursor entirely and synthesises
      // mouseenter/mousedown/click/mouseup/mouseleave from ONE pose (trap
      // §3.13), so there is no tick in which a raycaster saw the target.
      this.downAt = this.pointer ||
        (e && e.detail && e.detail.intersection ? this._hitToLine(e.detail.intersection) : null);
    },

    _noteClick: function (e) {
      if (!this.cfg || !this.enabled) return;
      var at = this.pointer ||
        (e && e.detail && e.detail.intersection ? this._hitToLine(e.detail.intersection) : null);

      // Drag guard. On desktop, dragging across the page turns the view
      // (reverseMouseDrag), and A-Frame's cursor still calls that a click.
      if (this.downAt && at && this.downAt.page === at.page &&
          Math.abs(this.downAt.line - at.line) >= DRAG_LINES) { this.downAt = null; return; }
      if (this.downAt && at && this.downAt.page !== at.page) { this.downAt = null; return; }
      this.downAt = null;

      if (this.mode === 'drive') {
        // In DRIVE the click's own position is deliberately ignored: on desktop
        // the pointer is still parked on the line you stepped off, so honouring
        // it would step forward and jump back, forever.
        this.advance();
      } else if (at && (at.page !== this.page || at.line !== this.line)) {
        // FOLLOW, and the click landed somewhere other than the active line:
        // place it there. This is the Vision Pro path — no continuous pointer
        // ever agreed with the eye ray, so the first pinch has to PLACE.
        this._setLine(at.page, at.line, true);
        this.mode = 'drive';
        this.latch = this.pointer;
      } else if (at || this.page >= 0) {
        this.mode = 'drive';
        this.latch = this.pointer;
        this.advance();
      }
    },

    /* Step down one line, crossing onto the next page at the foot of this one,
       and scroll if that pushed the line out of the comfortable band.
       Public: the reader could hang this off a control, and the harnesses drive
       it directly. */
    advance: function () {
      var cfg = this.cfg;
      if (!cfg) return false;
      if (this.page < 0) return false;
      var rec = cfg.pages[this.page];
      var bands = this._bands(rec);
      if (!bands) return false;

      if (this.line + 1 < bands.length) {
        this._setLine(this.page, this.line + 1, false);
        return true;
      }
      // Foot of the page. The next page may not be analysed yet — or not even
      // loaded, since only ±1 page around the reading band holds a texture. In
      // that case scroll toward it and leave the band where it is: the next
      // click (or the gaze) picks it up once the image has landed, which is
      // better than swallowing the input and better than guessing at a line
      // count for a page nobody has seen.
      var nextRec = cfg.pages[this.page + 1];
      if (!nextRec) return false;
      var nextBands = this._bands(nextRec);
      if (!nextBands || !nextBands.length) {
        cfg.scrollBy(cfg.step * 0.35);
        return false;
      }
      this._setLine(this.page + 1, 0, false);
      return true;
    },

    // The third of the three smoothness mechanisms (see SETTLE_MS): a new line
    // has to hold the pointer for SETTLE_MS before the band moves to it, so a
    // jitter excursion that lands inside the next line and comes straight back
    // never shows. The FIRST placement is exempt — the ruler should be there the
    // instant you look at the page, and there is nothing to flicker against yet.
    _settle: function (p, time) {
      if (p.page === this.page && p.line === this.line) { this._cand = null; return; }
      if (this.page < 0) { this.page = p.page; this.line = p.line; this._cand = null; return; }
      if (!this._cand || this._cand.page !== p.page || this._cand.line !== p.line) {
        this._cand = { page: p.page, line: p.line, since: time };
        return;
      }
      if (time - this._cand.since < SETTLE_MS) return;
      this.page = p.page;
      this.line = p.line;
      this._cand = null;
    },

    _setLine: function (page, line, placed) {
      this.page = page;
      this.line = line;
      // A deliberate step or placement outranks anything mid-settle: without
      // this, a candidate armed just before the click would land SETTLE_MS
      // later and drag the band back off the line the click had just set.
      this._cand = null;
      if (!placed) this._scrollIntoBand();
    },

    // Bring the active line back into the comfortable window, through the
    // reader's OWN eased scroll — so a stepped line and a tapped rail move the
    // page the same way. Only ever called from a deliberate step, never from
    // gaze-following.
    _scrollIntoBand: function () {
      var cfg = this.cfg;
      var geom = this._bandGeom();
      if (!cfg || !geom || !cfg.scrollBy || !cfg.scrollOf) return;
      // The band lives in the strip, and the strip's y IS the scroll — so the
      // line's height above the floor is scroll + its y within the strip.
      var lineY = cfg.scrollOf() + geom.y;
      var eye = cfg.eyeHeight;
      if (lineY >= eye - BAND_BELOW) return;
      var by = (eye - PARK_BELOW) - lineY;
      var cap = cfg.step * MAX_AUTO_SCROLL_STEPS;
      if (by > cap) return;
      cfg.scrollBy(by);
    },

    // The active band's rectangle, in the strip's space.
    _bandGeom: function () {
      var cfg = this.cfg;
      if (!cfg || this.page < 0) return null;
      var rec = cfg.pages[this.page];
      var bands = this._bands(rec);
      if (!bands || !bands[this.line]) return null;
      var b = bands[this.line];
      var pitch = bands.pitch || b.height * BAND_INK_FRAC;
      var hFrac = Math.max(b.height, pitch * BAND_PITCH_FRAC);
      var topY = cfg.topY1 - this.page * cfg.step;
      return {
        y: topY - b.centre * cfg.pageH,
        x: ((b.left + b.right) / 2 - 0.5) * cfg.pageW,
        w: (b.right - b.left + BAND_PAD_X * 2) * cfg.pageW,
        h: hFrac * cfg.pageH
      };
    },

    _ensureBand: function () {
      if (this.mesh) return true;
      var cfg = this.cfg;
      if (!cfg) return false;
      this.geo = new THREE.PlaneGeometry(1, 1);
      this.mat = new THREE.ShaderMaterial({
        uniforms: {
          uTint: { value: srgbVec(TINT) },
          uStrength: { value: 0 },
          uFeather: { value: FEATHER_Y },
          uRound: { value: ROUND_X }
        },
        vertexShader: BAND_VERT,
        fragmentShader: BAND_FRAG,
        transparent: true,
        // dst = src.rgb * dst.rgb. See the header: material.opacity is not part
        // of that product and setting it does nothing.
        blending: THREE.MultiplyBlending,
        // The page under it is opaque and 4 mm behind, so the depth test passes
        // and is worth keeping — it is what stops the band showing through the
        // scroll rail and the exit button, both of which sit in front of the
        // page. depthWrite off because it is a transparent overlay.
        depthWrite: false
      });
      this.mesh = new THREE.Mesh(this.geo, this.mat);
      this.mesh.renderOrder = RENDER_ORDER;
      // A unit plane scaled per line, not a geometry rebuilt per line: the band
      // re-targets whenever the gaze crosses a line, and rebuilding a
      // PlaneGeometry several times a second would allocate and orphan buffers
      // at exactly the rate that makes it hard to notice.
      var el = document.createElement('a-entity');
      el.setObject3D('reading-line', this.mesh);
      cfg.strip.appendChild(el);
      this.bandEl = el;
      return true;
    },

    tick: function (time, delta) {
      var cfg = this.cfg;
      if (!cfg) return;
      var dt = delta || 16;

      if (this.enabled) {
        this.pointer = this._readPointer();

        if (this.pointer) {
          if (this.mode === 'drive' && this.latch &&
              (this.pointer.page !== this.latch.page ||
               Math.abs(this.pointer.line - this.latch.line) >= RELEASE_LINES)) {
            // Moved deliberately away from where the last click left it —
            // that is a request to look somewhere else, not a step.
            this.mode = 'follow';
            this.latch = null;
            this._cand = null;
          }
          if (this.mode === 'drive' && !this.latch) this.latch = this.pointer;
          if (this.mode === 'follow') this._settle(this.pointer, time);
        }
      }

      var geom = this.enabled ? this._bandGeom() : null;
      var want = geom ? 1 : 0;
      if (!want && this._shown <= 0.001) {
        this._shown = 0;
        if (this.mesh) this.mesh.visible = false;
        return;
      }
      if (!this._ensureBand()) return;

      this._shown += (want - this._shown) * (reducedMotion ? 1 : Math.min(1, dt / FADE_MS));
      if (want && this._shown > 0.999) this._shown = 1;
      if (!want && this._shown < 0.004) this._shown = 0;
      this.mesh.visible = this._shown > 0.001;
      this.mat.uniforms.uStrength.value = TINT_STRENGTH * this._shown;
      if (!this.mesh.visible || !geom) return;

      this._to = geom;
      if (!this._at) {
        this._at = { x: geom.x, y: geom.y, w: geom.w, h: geom.h };
      } else {
        var k = reducedMotion ? 1 : Math.min(1, dt / EASE_MS);
        if (Math.abs(geom.y - this._at.y) > SNAP_OVER) k = 1;
        this._at.x += (geom.x - this._at.x) * k;
        this._at.y += (geom.y - this._at.y) * k;
        this._at.w += (geom.w - this._at.w) * k;
        this._at.h += (geom.h - this._at.h) * k;
      }

      var o = this.bandEl.object3D;
      o.position.set(this._at.x, this._at.y, -cfg.readDistance + LIFT_Z);
      o.scale.set(this._at.w, this._at.h, 1);
    },

    // For the harnesses and the camera-path rig: everything measurable about
    // the ruler in one read, so a test never has to reach into privates that
    // may be renamed.
    _report: function () {
      var cfg = this.cfg;
      var geom = this._bandGeom();
      var rec = cfg && this.page >= 0 ? cfg.pages[this.page] : null;
      var bands = rec ? this._bands(rec) : null;
      return {
        open: !!cfg, enabled: this.enabled, mode: this.mode,
        page: this.page, line: this.line,
        lines: bands ? bands.length : 0,
        pitch: bands ? bands.pitch : 0,
        pointer: this.pointer, latch: this.latch,
        shown: this._shown,
        geom: geom,
        at: this._at ? { x: this._at.x, y: this._at.y, w: this._at.w, h: this._at.h } : null
      };
    }
  });

  // Exported for the harnesses, and so the detector can be measured against a
  // page image without a scene: it is pure (image → numbers) and that is worth
  // keeping testable on its own.
  window.VRReadingLine = { detectLines: detectLines };
})();
