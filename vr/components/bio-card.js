/* ═══ bio-card.js ═══
   The bio "card" beside the home portrait (§B of VR_SPEC_ADDENDUM.md) —
   near-identical to the flat site's About section, just on glass. Text is
   pulled verbatim from #about (all three paragraphs + the stat rows);
   nothing here is rewritten.

   Uses the same VRGlass rounded-glass shader as every other card (hub-panel,
   focus-stage) rather than its own one-off MeshStandardMaterial — before this
   it was a different look entirely, and its background plane sat at the same
   world depth as the home portrait next to it with no separation, which is
   what produced the z-fighting/clipping VR_BUGFIX_NOTES.md item 4 flags
   ("the 'Engineer.' text panel clips behind the main portrait"). Every child
   layer here now sits at a clearly incremented z (background 0 → body text
   0.014 → close button background 0.02 → its label 0.032), and index.html
   additionally gives the whole card entity its own z distinct from the
   portrait's as defense in depth.

   Visible by default once content loads (VR_BUGFIX_NOTES.md item 8 — it's a
   permanent companion panel beside the portrait, not a click-to-reveal
   modal); the portrait and the close button both still toggle it, for
   whoever wants to declutter.

   Usage:
     <a-entity bio-card="width: 1.05; height: 1.3"></a-entity>
     el.components['bio-card'].setContent(paragraphs, stats); // arrays of objects, set directly (see index.html)
*/

(function () {
  // Drop a trailing editorial aside (" — Stanford's Biomechanical Engineering
  // program is essentially its Biomedical Engineering degree.") from an
  // over-long stat value so it fits the compact card in a line or two. The
  // primary content before the em-dash is kept verbatim; the full text still
  // lives on the flat site's About section. Only trims genuinely long values,
  // so short em-dash values (a date range, say) are left intact.
  function compactStat(value) {
    value = value || '';
    var i = value.indexOf(' — ');
    return (i > 0 && value.length > 80) ? value.slice(0, i) : value;
  }

  // ── The Skills panel's pull-toward-you geometry ──
  // Sebastian: "the skills panel that opens up is basically impossible to read,
  // let's have it open up and pull towards the reader sorta like the floating
  // images/cloud." It used to open DOCKED to the bio card's right edge — at
  // x≈1.6, z=-1.52 from the seat, i.e. ~46 deg off axis and seen almost
  // edge-on, in VRType.label() type (0.022 m) on 0.72-opacity glass with the
  // whole constellation showing through the text. Four separate reasons it was
  // unreadable, and distance was only one of them; all four are addressed:
  // it now flies to reading distance in front of you, square to your gaze, at
  // body type, over an opaque plate.
  //
  // Numbers deliberately match focus-stage.js, so the two "pull it closer"
  // motions in the scene read as the same gesture rather than two similar ones.
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SKILLS_READ_DISTANCE = 1.02;
  var SKILLS_READ_HEIGHT = 1.55;
  var SKILLS_FLY_IN_MS = 420, SKILLS_FLY_OUT_MS = 280;
  var SKILLS_DOCK_SCALE = 0.34;   // what it grows FROM: roughly the size of the control you clicked
  // Above the focus stage's 10/11 (they can both be open — one opens from a
  // constellation card, this one from the bio card) and below notice.js's
  // 20/21/22, so a "coming soon" notice still lands on top of everything.
  var SKILLS_RENDER_ORDER = 12;
  // Same small ghost pill as the focus stage's Close, in the same top-right
  // corner — same job, same gesture — but inside the panel's own plate here.
  var SKILLS_CLOSE_W = 0.30, SKILLS_CLOSE_H = 0.12;

  // ── Why the panel is wide, and why the skills are a LIST ──
  // Second pass, after the first Vision Pro session: "the skill section was way
  // too hard to read, when you hit more skills that card should be bigger. Font
  // size — generally a good font size is the bio font size."
  //
  // Measured on the shipped panel before touching it: the values were ALREADY
  // at VRType.body() (0.028 m), and because the panel flies to 1.02 m their cap
  // height is 1.1 deg — larger than the bio card's own body text, which reads
  // at 0.68 deg from 1.66 m. So em size was not what was failing.
  //
  // What was failing is line length. Each group was ONE 197-character
  // interpunct-separated run, wrapping to three lines across a panel 54 deg
  // wide. Reading it means sweeping your head most of a right angle per line
  // and then finding the start of the next one with no anchor to come back to —
  // the exact thing typographic measure limits exist to prevent, and no font
  // size fixes it. (The flat site gets away with the same string because a
  // browser line is ~10 deg wide at desk distance.)
  //
  // So: one skill per LINE, in TWO COLUMNS. The eye travels down a short list
  // instead of across a long line, each column is ~28 deg, and the panel grew
  // to hold it — which is also the "make the card bigger" that was asked for.
  // Type goes up to 0.034 as well; it is a reading surface, so it gets more
  // than the shared body step.
  //
  // All four scale with a11yMode via VRType.cardMult(), the same way the bio
  // card's own geometry does (hard rule 4): a 25% type bump inside a fixed
  // column just wraps every second item, which is the opposite of help.
  var SKILLS_COL_W_BASE = 0.52;         // text measure per column
  var SKILLS_COL_GAP_BASE = 0.07;
  var SKILLS_PAD_BASE = 0.055;          // reading margin, fixed rather than a % of width
  var SKILLS_VALUE_SIZE_BASE = 0.034;   // vs VRType.body()'s 0.028
  var SKILLS_LINE_HEIGHT = 1.42;        // a list wants more air than a paragraph

  function skillsMult() { return VRType.cardMult ? VRType.cardMult() : 1; }
  function skillsColW() { return SKILLS_COL_W_BASE * skillsMult(); }
  function skillsColGap() { return SKILLS_COL_GAP_BASE * skillsMult(); }
  function skillsPad() { return SKILLS_PAD_BASE * skillsMult(); }
  function skillsValueSize() { return SKILLS_VALUE_SIZE_BASE * skillsMult(); }
  function skillsPanelW() { return skillsColW() * 2 + skillsColGap() + skillsPad() * 2; }

  AFRAME.registerComponent('bio-card', {
    schema: {
      width: { type: 'number', default: 1.05 },
      height: { type: 'number', default: 1.3 },
      accent: { type: 'color', default: '#b8863b' }
    },
    init: function () {
      this.paragraphs = [];
      this.stats = [];
      this.skillGroups = [];
    },

    setContent: function (paragraphs, stats, skillGroups) {
      this.paragraphs = paragraphs || [];
      this.stats = stats || [];
      this.skillGroups = skillGroups || [];
      this.build();
    },

    build: function () {
      var el = this.el;
      var w = this.data.width, h = this.data.height;
      var accent = this.data.accent;
      var a11y = document.body.classList.contains('accessible');

      while (el.firstChild) el.removeChild(el.firstChild);
      if (this._built) el.removeObject3D('card-mesh');
      this._built = true;

      el.setObject3D('card-mesh', new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        VRGlass.makeCardMaterial(w, h, 0.05, accent, 0, 0.62)
      ));

      // ── Layout metrics ──
      // Everything below is laid out from a SINGLE measured pass (see reflow()).
      // Nothing uses an estimated text height: an earlier version advanced the
      // paragraph stack by a character-count guess, which overshot by roughly a
      // line each time, so the heading→paragraph gap measured 0.0295 while
      // paragraph→paragraph measured 0.0707 — visibly uneven, and only safe
      // from collisions by luck of erring large.
      var padX = w * 0.04;
      var padY = h * 0.04;
      var leftX = -w / 2 + padX;
      var valueX = -w * 0.02;
      // Base gaps and type sizes. Both get multiplied by the auto-fit scale
      // computed in reflow(), so the card fills its own height rather than
      // leaving a dead band at the bottom.
      var GAP_HEADING = 0.030;  // heading -> first paragraph
      var GAP_PARA = 0.030;     // paragraph -> paragraph
      var GAP_STATS = 0.050;    // last paragraph -> first stat row
      var ROW_GAP = 0.020;      // stat row -> stat row
      var bodyFontSize = VRType.body();
      var labelFontSize = VRType.label();
      var titleFontSize = VRType.title();

      function mkText(attrs, x, litOpts) {
        var e = document.createElement('a-entity');
        // Stash the type metrics we ASKED for. estimatedHeightOf() cannot read
        // them back off the entity: getAttribute('troika-text') does not
        // return usable component data until the component has initialised,
        // which has not happened during the first synchronous layout pass, so
        // it silently fell back to defaults and estimated every paragraph as
        // one short line.
        e.__vrText = { fontSize: attrs.fontSize, lineHeight: attrs.lineHeight || 1.3,
                       maxWidth: attrs.maxWidth, value: attrs.value };
        e.__vrPos = { x: x, z: 0.014 };
        e.setAttribute('troika-text', attrs);
        e.setAttribute('position', { x: x, y: 0, z: 0.014 }); // y set by reflow()
        el.appendChild(e);
        // Real lit material from the shared key-light rack, same as every
        // other card's text (glass-material.js's lightTroikaText).
        VRGlass.lightTroikaText(e, attrs.color, litOpts);
        return e;
      }

      var heading = mkText({
        value: 'Engineer. Communicator. Builder.',
        align: 'left', anchor: 'left', baseline: 'top',
        color: '#f5f5f0', font: VRFonts.title(),
        fontSize: titleFontSize, maxWidth: w * 0.88
      }, leftX);

      var paras = this.paragraphs.map(function (p) {
        return mkText({
          value: p.text, align: 'left', anchor: 'left', baseline: 'top',
          color: '#f5f5f0', fillOpacity: 0.9, font: VRFonts.body(),
          fontSize: bodyFontSize, maxWidth: w * 0.88, lineHeight: 1.38
        }, leftX);
      });

      // Stat rows (Education / Degrees / Location / Languages / …).
      // Each row is a label (left column) + value (right column). A value can
      // wrap to several lines (the DEGREES string is a full sentence), so a
      // FIXED per-row step made a tall value overrun the rows below it —
      // LOCATION ended up fully hidden behind DEGREES (VR_BUGFIX item 2).
      var rows = this.stats.map(function (s) {
        return {
          label: mkText({
            value: s.label.toUpperCase(), align: 'left', anchor: 'left', baseline: 'top',
            color: accent, fillOpacity: 0.85, font: VRFonts.bodyBold(),
            fontSize: labelFontSize, maxWidth: w * 0.42, letterSpacing: 0.04
          }, leftX),
          value: mkText({
            value: compactStat(s.value), align: 'left', anchor: 'left', baseline: 'top',
            color: '#f5f5f0', fillOpacity: 0.88, font: VRFonts.body(),
            fontSize: labelFontSize, maxWidth: w * 0.52, lineHeight: 1.28
          }, valueX)
        };
      });

      // No close button. The card is a permanent companion to the portrait
      // (VR_BUGFIX_NOTES.md item 8), not a modal, so a dismiss control was
      // both redundant and — at a fixed bottom-right position that ignored
      // where the stat rows actually ended — overlapping the HOBBIES row.
      // The portrait still toggles the card if someone wants to declutter.

      // ── Skills panel, opening to the RIGHT of the Skills row ──
      // Mirrors the flat site's "+ View more skills" disclosure
      // (.skills-expand-panel), whose Technical/Professional groups are
      // scraped by data-loader.js. Built here but positioned/sized in reflow()
      // once the Skills row's real y is known.
      var skillsPanel = null;
      var skillsRowIndex = -1;
      this.stats.forEach(function (s, i) {
        if (/^skills$/i.test((s.label || '').trim())) skillsRowIndex = i;
      });
      if (skillsRowIndex >= 0 && this.skillGroups.length) {
        skillsPanel = this._buildSkillsPanel(w, accent, labelFontSize);
      }
      this._skillsPanel = skillsPanel;

      function heightOf(entity) {
        var m = entity.components['troika-text'] && entity.components['troika-text'].troikaTextMesh;
        if (!m || !m.textRenderInfo || !m.textRenderInfo.blockBounds) return null;
        var bb = m.textRenderInfo.blockBounds;
        return bb[3] - bb[1];
      }

      // Fallback height for a block troika never got around to measuring.
      // EVERY y on this card is assigned in layout(), so without this the
      // timeout path left all of them at their creation value of 0 and the
      // whole card rendered as one collapsed pile of overlapping text. An
      // estimate that is merely close keeps the card readable; the measured
      // path still runs and corrects it whenever troika does report.
      //
      // Estimated from the wrapped line count: troika's default glyph advance
      // for these faces sits near 0.52em, so chars-per-line ~= maxWidth /
      // (fontSize * 0.52).
      function estimatedHeightOf(entity) {
        var d = entity.__vrText || entity.getAttribute('troika-text') || {};
        var fs = d.fontSize || labelFontSize;
        var lh = d.lineHeight || 1.3;
        var text = String(d.value || '');
        var maxW = d.maxWidth || w;
        var perLine = Math.max(1, Math.floor(maxW / (fs * 0.52)));
        var lines = 0;
        text.split('\n').forEach(function (para) {
          lines += Math.max(1, Math.ceil(para.length / perLine));
        });
        return lines * fs * lh;
      }

      // Measured when available, estimated when not — so layout() can always
      // produce a sane card instead of refusing to run.
      //
      // forceEstimate exists for the very first synchronous pass. troika will
      // happily report blockBounds for a block it has laid out but not yet
      // WRAPPED to maxWidth (the stale-measurement trap): every paragraph
      // comes back one line tall, the stack packs them ~1 line apart, and the
      // card renders with its paragraphs overlapping. An estimate that
      // accounts for wrapping is strictly better than a measurement that
      // predates it, so the first pass ignores measurements entirely.
      var forceEstimate = false;
      function heightFor(entity) {
        if (forceEstimate) return estimatedHeightOf(entity);
        var m = heightOf(entity);
        return m != null ? m : estimatedHeightOf(entity);
      }

      function setFontSize(entity, size) {
        if (entity.__vrText) entity.__vrText.fontSize = size; // keep estimates in step with the fit scale
        entity.setAttribute('troika-text', 'fontSize', size);
      }

      // ── Auto-fit the type to the card ──
      // Scales the whole text block up to use the card's full height, so there
      // is no dead band at the bottom. The heading/body/label RATIOS are
      // untouched — a deliberate, contained exception to
      // VR_POLISH_STANDARDS.md §5's 3-size scale, since the block is simply
      // scaled to its panel rather than introducing a fourth size.
      //
      // This MUST iterate. Wrapped height is not linear in font size: larger
      // type wraps to more lines at the same maxWidth, so a single
      // available/measured ratio overshoots badly (first attempt at this
      // pushed HOBBIES clean off the bottom edge). Each round re-measures and
      // corrects, converging on the largest size that genuinely fits.
      var self = this;
      var all = [heading].concat(paras);
      rows.forEach(function (r) { all.push(r.label, r.value); });

      var available = h - padY * 2;
      // The fitter may SHRINK as far as it needs to (0.6) — text that doesn't
      // fit its card is broken — but growth is capped tight on purpose. This is
      // the one place in the scene that can breach the strict 3-size type scale
      // (VR_POLISH_STANDARDS §5): a cap of 1.6 let the bio card's own body copy
      // grow past every other card's TITLE size once the fit loop converged
      // properly (measured 1.34x, i.e. 0.0374 m body against a 0.052 m title
      // elsewhere). "Fits" and "reads at the scene's type scale" are different
      // targets (VR_TEST_REPORT A4); leftover height is spent as margin instead,
      // split evenly top and bottom by layout() below.
      var SCALE_CAP = 1.12;
      // Enough rounds to actually converge. At 10 it ran out mid-climb and
      // left a 10cm bottom margin against a 5.8cm top one — visibly lopsided.
      var MAX_ROUNDS = 16;
      var scale = 1;
      var round = 0;
      var best = null;   // { scale, over, fits } — best round measured so far
      var lo = 0;        // largest scale measured that FITS
      var hi = Infinity; // smallest scale measured that OVERFLOWS

      // The "+ View more skills" control sits between the Skills and Hobbies
      // rows, so its block MUST be part of the fit maths — otherwise the
      // auto-fit sizes the type to fill the card and the control then overlaps
      // the row beneath it. Plain text now (see _wireSkillsRow), not a boxed
      // button, so this reserves a single text line's height, not a button's.
      var SKILLS_BTN_H = 0.045, SKILLS_BTN_GAP = 0.018;
      var skillsBlock = (skillsPanel ? SKILLS_BTN_H + SKILLS_BTN_GAP * 2 : 0);

      // Every block's measured height as a snapshot, so "has troika finished?"
      // can be asked PER BLOCK rather than on the aggregate. The aggregate is
      // not a usable done-signal: the heading is one short line and re-wraps
      // first, so the sum moves while every paragraph is still stale.
      function heightVector() {
        return all.map(function (e) { return heightOf(e); });
      }
      function sameVector(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      }
      // The height vector layout() last actually laid out against — see verify().
      var lastLayoutVec = null;

      function contentHeight(s) {
        var total = heightFor(heading) + GAP_HEADING * s;
        paras.forEach(function (p, i) {
          total += heightFor(p) + (i === paras.length - 1 ? GAP_STATS : GAP_PARA) * s;
        });
        rows.forEach(function (r, i) {
          total += Math.max(heightFor(r.label), heightFor(r.value)) + (i === rows.length - 1 ? 0 : ROW_GAP * s);
        });
        return total + skillsBlock;
      }

      function applyScale(s) {
        setFontSize(heading, titleFontSize * s);
        paras.forEach(function (p) { setFontSize(p, bodyFontSize * s); });
        rows.forEach(function (r) {
          setFontSize(r.label, labelFontSize * s);
          setFontSize(r.value, labelFontSize * s);
        });
      }

      // troika lays text out asynchronously, so after changing fontSize the
      // old blockBounds are still readable — polling for "blockBounds exists"
      // returns immediately with STALE values and silently measures the
      // previous size. troika's own sync(cb) looked like the right signal but
      // its callback did not fire reliably here (the fit loop stalled and
      // layout never ran), so instead watch for the measured size to actually
      // CHANGE. Always terminates: the timeout falls through to laying out with
      // whatever we have.
      //
      // Watches the WHOLE content height, not just the heading's. The heading is
      // one short line and re-lays out first; waiting only on it let the next
      // round measure paragraphs that troika had not re-wrapped yet, so
      // contentHeight came back essentially unchanged across a 6.5% type change
      // (measured: 0.0089 -> 0.0090 m of overflow from scale 1.000 to 1.065).
      // The fit loop was then stepping on a number that wasn't responding to it.
      // Watching the aggregate alone was NOT enough, and this is the bug it
      // caused: the sum moved the instant the one-line heading re-wrapped, the
      // round then measured paragraphs troika had not re-wrapped yet, and
      // layout() advanced the stack by those too-small heights. Shipped result,
      // measured on the real card at scale 1.12: paragraph 3 sat 33 mm INSIDE
      // paragraph 2, paragraph 4 sat 28 mm inside paragraph 3, and the
      // paragraph->paragraph gap came out 0.0104 m against the 0.0336 m the
      // scale asked for.
      //
      // So require BOTH signals. `changed` says troika has STARTED responding
      // to the new fontSize (guarding the stale-blockBounds trap, §3.2 of the
      // build guide). `settled` says it has FINISHED — no block's own measured
      // height moved between two consecutive polls.
      function afterResize(prevContentH, cb) {
        var tries = 0;
        var last = null;
        (function poll() {
          var vec = heightVector();
          var now = contentHeight(scale);
          var changed = now != null && Math.abs(now - prevContentH) > 1e-6;
          if (changed && sameVector(vec, last)) return cb();
          last = vec;
          if (++tries > 60) return cb();
          setTimeout(poll, 25);
        })();
      }

      // Belt-and-braces after the final layout. afterResize can only wait on
      // signals it gets to see; if troika re-wraps anything AFTER the last
      // layout() — a late font load, a poll pair that happened to land in a
      // pause — the gaps were computed from heights that no longer hold and
      // the paragraphs overlap again. So keep watching, and re-lay out if any
      // block's measured height has moved away from what layout() used.
      // Bounded, and a no-op in the normal case where nothing changes.
      function verify(roundsLeft) {
        if (roundsLeft <= 0) return;
        var tries = 0;
        var last = null;
        (function poll() {
          var vec = heightVector();
          if (sameVector(vec, last)) {
            if (!sameVector(vec, lastLayoutVec)) { layout(); verify(roundsLeft - 1); }
            return;
          }
          last = vec;
          if (++tries > 40) return;
          setTimeout(poll, 30);
        })();
      }

      function waitForMeshes(cb) {
        var tries = 0;
        (function poll() {
          if (all.every(function (e) { return heightOf(e) != null; })) return cb(true);
          if (++tries > 120) {
            // Lay out anyway, using estimated heights (see heightFor). Bailing
            // here used to leave every block at y=0 — a collapsed pile of
            // overlapping text — which is far worse than approximate spacing.
            console.warn('[vr] bio-card: text measurement timed out — laying out with estimated heights');
            return cb(false);
          }
          setTimeout(poll, 40);
        })();
      }

      // Lay out IMMEDIATELY on estimated heights, before waiting on troika.
      // mkText() parks every block at y=0 and layout() is what assigns the
      // real y — so until the measured pass lands, the card renders as one
      // collapsed pile of overlapping text. That is exactly what a visitor
      // sees on first load, and on a slow font fetch it is what they keep
      // seeing. The measured pass below still runs and replaces these
      // positions with exact ones; this only guarantees the card is never
      // displayed collapsed in the meantime.
      forceEstimate = true;
      layout();
      forceEstimate = false;

      waitForMeshes(function (measured) {
        // With no real measurements there is nothing for the fit loop to
        // converge on: afterResize() waits for the measured content height to
        // CHANGE, which never happens while the blocks read null, so each round
        // would burn its full 1.5s timeout. The estimated layout above is
        // already on screen, so just leave it.
        if (!measured) return;
        (function fitRound() {
          var ch = contentHeight(scale);
          round++;
          var over = ch - available;
          var fits = over <= 0;

          // Keep the best candidate actually MEASURED, rather than settling on
          // whatever the last round happened to leave applied. A fitting scale
          // always beats an overflowing one; between two fitting scales the
          // larger type wins; between two overflowing ones the smaller
          // overflow wins.
          if (!best || (fits && !best.fits) ||
              (fits && best.fits && scale > best.scale) ||
              (!fits && !best.fits && over < best.over - 1e-6)) {
            best = { scale: scale, over: over, fits: fits };
          }

          // Bracket the answer as rounds go by: `lo` is the largest scale known
          // to fit, `hi` the smallest known to overflow. Once both are known the
          // step below bisects instead of applying the ratio correction again —
          // wrapped text height is not linear in font size (§3.3 of
          // VR_AI_BUILD_GUIDE), so the ratio step overshoots, and with a damped
          // shrink on one side and a damped grow on the other it settled into a
          // stable 2-cycle: 0.862 (fits, 40 mm spare) -> grow -> 0.882
          // (overflows 31 mm) -> shrink -> 0.862, burning every remaining round
          // on the same two re-measurements and then stopping on whichever of
          // the pair the cap landed on.
          if (fits) { if (scale > lo) lo = scale; }
          else if (scale < hi) hi = scale;

          var next = null;
          if (round < MAX_ROUNDS) {
            if (lo > 0 && hi < Infinity && hi - lo > 0.004) {
              next = (lo + hi) / 2;
            } else if (!fits) {
              // Overflowing with no fitting scale found yet — damped shrink.
              next = Math.max(0.6, scale * Math.max(0.9, available / ch));
            } else if (ch < available * 0.985 && scale < SCALE_CAP && hi === Infinity) {
              // Slack left and nothing has overflowed yet — grow, but only part
              // way toward the naive ratio, because growth costs more height
              // than the ratio predicts.
              next = Math.min(SCALE_CAP, scale * (1 + (available / ch - 1) * 0.75));
            }
            // A step that barely moves is not worth another troika reflow (the
            // expensive operation in this scene).
            if (next != null && Math.abs(next - scale) < scale * 0.005) next = null;
          }

          if (next != null) {
            var prevH = ch; // the content height this round measured
            scale = next;
            applyScale(scale);
            // Re-lay out on every round. Previously only the FINAL round
            // repositioned, so each intermediate round rendered the new
            // font size at the previous round's positions — which reads as
            // text randomly growing and shrinking while the gaps stay put.
            afterResize(prevH, function () { layout(); fitRound(); });
            return;
          }

          // Done stepping: land on the best measured candidate, not the last one.
          if (best && Math.abs(best.scale - scale) > 1e-6 &&
              (best.fits !== fits ? best.fits : (best.fits ? best.scale > scale : best.over < over))) {
            var prevBestH = ch;
            scale = best.scale;
            applyScale(scale);
            afterResize(prevBestH, function () { layout(); verify(3); });
            return;
          }
          layout();
          verify(3);
        })();
      });

      // Writes y through setAttribute, NOT object3D directly. layout() is
      // called once synchronously (see the estimated pass above) while these
      // entities' `position` components have not initialised yet — a direct
      // object3D write there is silently clobbered when the component comes
      // up and applies the attribute's older y of 0, which is precisely how
      // the card ended up rendering as a collapsed pile. Same trap the skills
      // button below was already guarded against.
      function setY(entity, y) {
        // Writes the COMPLETE position, never setAttribute('position','y',..).
        // On a component that has not initialised yet, the single-property
        // form stores a partial {y} and the missing x/z then resolve to the
        // schema defaults of 0 — which silently dragged every stat label on
        // top of its value at x=0 and flattened the text to the card's own
        // z-plane. x/z come from __vrPos (set in mkText), not read back off
        // the entity, for the same pre-init reason.
        var p = entity.__vrPos || { x: 0, z: 0.014 };
        entity.setAttribute('position', { x: p.x, y: y, z: p.z });
      }

      function layout() {
        // Recorded up front so verify() can tell "troika moved since we laid
        // out" from "troika has simply not finished yet".
        lastLayoutVec = heightVector();
        // Capped growth (see SCALE_CAP) means the content usually ends short of
        // the bottom pad. Split that slack evenly instead of top-anchoring the
        // block, which used to leave a 10 cm bottom margin against a 5.8 cm top
        // one and read as visibly lopsided.
        var slack = Math.max(0, available - contentHeight(scale));
        var y = h / 2 - padY - slack / 2;
        setY(heading, y);
        y -= heightFor(heading) + GAP_HEADING * scale;

        paras.forEach(function (p, i) {
          setY(p, y);
          y -= heightFor(p) + (i === paras.length - 1 ? GAP_STATS : GAP_PARA) * scale;
        });

        rows.forEach(function (r, i) {
          setY(r.label, y);
          setY(r.value, y);
          if (i === skillsRowIndex) self._wireSkillsRow(r, skillsPanel, y, w, h, scale);
          y -= Math.max(heightFor(r.label), heightFor(r.value));

          // Reserve the button's own band directly under the Skills row.
          if (i === skillsRowIndex && skillsPanel && self._skillsBtn) {
            y -= SKILLS_BTN_GAP;
            // Via setAttribute, NOT a direct object3D write. This button is
            // created inside this same layout pass, so its `position`
            // component initialises AFTER we get here and would clobber a
            // direct object3D.position assignment with the attribute's older
            // value. (The text blocks above are safe from this only because
            // they were created before the measurement wait.)
            self._skillsBtn.setAttribute('position', 'y', y - SKILLS_BTN_H / 2);
            y -= SKILLS_BTN_H + SKILLS_BTN_GAP;
          }
          if (i !== rows.length - 1) y -= ROW_GAP * scale;
        });

        self._fitScale = scale;

        // Content is scraped from the live #about section, so it can grow
        // without anyone touching this file. Say so rather than silently
        // clipping — this is the signal that the card needs to be taller.
        var overflow = (-h / 2 + padY) - y;
        // Not during the estimated pass: those heights are character-count
        // guesses laid out only so the card is never displayed as a collapsed
        // pile, and they reported a 9 mm overflow on every single load — noise
        // that made the real signal easy to dismiss.
        if (overflow > 0.001 && !forceEstimate) {
          console.warn('[vr] bio-card: content overflows the card by',
            overflow.toFixed(3), 'm at scale', scale.toFixed(3));
        }
      }
    },

    // The expandable panel itself: its own glass card (so it picks up the
    // scene's key-light rig exactly like every other panel) holding the
    // Technical / Professional groups.
    // Split one interpunct-separated run into two column strings of roughly
    // equal RENDERED height. Balancing by item count would put the two longest
    // items ("Rapid Prototyping & Additive Manufacturing", "VR/AR Hardware
    // (Apple Vision Pro, Meta Quest, HTC Vive, Snap Spectacles)") in the same
    // column and leave the other half empty, so this estimates wrapped lines
    // per item from the measure instead. An estimate is enough — the real
    // heights are measured later, in the layout pass, and drive the plate.
    _splitSkillColumns: function (value, fontSize, colW) {
      var items = String(value || '').split('·')
        .map(function (t) { return t.trim(); }).filter(Boolean);
      if (items.length < 4) return [items.join('\n'), ''];

      // ~0.52 em average advance for Syne at this size — close enough to rank
      // a one-line item against a two-line one, which is all this needs.
      var perLine = Math.max(8, Math.floor(colW / (fontSize * 0.52)));
      var lines = items.map(function (t) { return Math.max(1, Math.ceil(t.length / perLine)); });
      var total = lines.reduce(function (a, b) { return a + b; }, 0);

      var a = [], b = [], used = 0;
      for (var i = 0; i < items.length; i++) {
        // Column-major reading order: fill A down, then B. The `used + half of
        // this item` test stops a tall item from tipping A well past halfway
        // just because it started under the line.
        if (used + lines[i] / 2 <= total / 2 || !a.length) { a.push(items[i]); used += lines[i]; }
        else b.push(items[i]);
      }
      return [a.join('\n'), b.join('\n')];
    },

    _buildSkillsPanel: function (cardW, accent, labelFontSize) {
      // Two columns of skillsColW() plus the gap and the padding — see the
      // constants block for why this is a list in columns and not a run of
      // text. Its footprint in the composition costs nothing: it is invisible
      // until opened, and when opened it is in front of you.
      var panelW = skillsPanelW();
      var panel = document.createElement('a-entity');
      panel.setAttribute('visible', false);
      // Sunflower, per Sebastian — same treatment as every constellation
      // panel (sunflower.js, applied there by VRConstellation.place). This
      // one needs it MORE than most: it hangs off the bio card's right edge,
      // so it starts life parallel to that card rather than aimed anywhere in
      // particular, and is seen at a genuinely oblique angle from the command
      // zone. sunflower.js converts through the parent's inverse quaternion,
      // so being a child of the bio card here is handled.
      //
      // maxTurnDeg is left at the default 0 (unlimited): the command zone is
      // small enough that the reachable mis-aim is modest — measured at 29deg
      // from a crouched, offset pose on an Experience card — so a clamp would
      // only ever fight the aim without preventing anything.
      panel.setAttribute('sunflower', '');
      this.el.appendChild(panel);

      var pad = skillsPad();
      var colW = skillsColW();
      // The section labels ("TECHNICAL", "PROFESSIONAL") stay at label size —
      // they are metadata. The VALUES are the thing you came to read.
      var valueFontSize = skillsValueSize();
      var self = this;
      var colX = [-panelW / 2 + pad, -panelW / 2 + pad + colW + skillsColGap()];

      var groups = this.skillGroups.map(function (g) {
        var label = document.createElement('a-entity');
        label.setAttribute('troika-text', {
          value: g.label.toUpperCase(), align: 'left', anchor: 'left', baseline: 'top',
          color: accent, fillOpacity: 0.9, font: VRFonts.bodyBold(),
          fontSize: labelFontSize, maxWidth: panelW - pad * 2, letterSpacing: 0.04
        });
        label.setAttribute('position', { x: colX[0], y: 0, z: 0.014 });
        panel.appendChild(label);
        VRGlass.lightTroikaText(label, accent);

        // fillOpacity 1, not 0.9: on a translucent aside 0.9 kept the text from
        // reading as a hard overlay, but this is now an opaque reading surface
        // and the only thing 0.9 costs here is contrast.
        // Empty strings are dropped, not laid out: an empty troika-text never
        // reports a block height, and the layout pass below waits for EVERY
        // child to measure before it builds the plate — so one empty column
        // would stall it for 120 retries and then leave the panel with no
        // backing plate at all. (Only reachable if the site's skills list
        // shrinks below four items per group, which is exactly the kind of
        // content change this file is supposed to survive.)
        var cols = self._splitSkillColumns(g.value, valueFontSize, colW)
          .filter(function (text) { return !!text; })
          .map(function (text, i) {
          var col = document.createElement('a-entity');
          col.setAttribute('troika-text', {
            value: text, align: 'left', anchor: 'left', baseline: 'top',
            color: '#f5f5f0', fillOpacity: 1, font: VRFonts.body(),
            fontSize: valueFontSize, maxWidth: colW, lineHeight: SKILLS_LINE_HEIGHT
          });
          col.setAttribute('position', { x: colX[i], y: 0, z: 0.014 });
          panel.appendChild(col);
          VRGlass.lightTroikaText(col, '#f5f5f0');
          return col;
        });

        return { label: label, cols: cols };
      });

      panel.__panelW = panelW;
      panel.__groups = groups;
      panel.__pad = pad;
      panel.__accent = accent;
      panel.__labelSize = labelFontSize;
      panel.__valueSize = valueFontSize;
      panel.__colX = colX;
      return panel;
    },

    // Size the panel to its own measured content, place it to the right of the
    // Skills row, and wire the row to toggle it.
    _wireSkillsRow: function (row, panel, rowY, cardW, cardH, fitScale) {
      if (!panel || panel.__wired) return;
      panel.__wired = true;

      // Declared up here, not further down beside the toggle: the layout pass
      // below builds the panel's own Close control and needs it too.
      var self = this;

      var pad = panel.__pad, panelW = panel.__panelW;
      var accent = panel.__accent;
      var groups = panel.__groups;
      var GROUP_GAP = 0.026 * fitScale, LABEL_GAP = 0.008 * fitScale;

      // Match the card's auto-fitted type size, or the panel reads as a
      // different, smaller component sitting next to the card.
      groups.forEach(function (g) {
        g.label.setAttribute('troika-text', 'fontSize', panel.__labelSize * fitScale);
        g.cols.forEach(function (c) {
          c.setAttribute('troika-text', 'fontSize', panel.__valueSize * fitScale);
        });
      });

      function heightOf(entity) {
        var m = entity.components['troika-text'] && entity.components['troika-text'].troikaTextMesh;
        if (!m || !m.textRenderInfo || !m.textRenderInfo.blockBounds) return null;
        var bb = m.textRenderInfo.blockBounds;
        return bb[3] - bb[1];
      }

      // A group is as tall as its TALLEST column, not the sum of the two — the
      // columns sit side by side. Getting this wrong is invisible until a group
      // with a lopsided split appears, and then the plate is twice the height it
      // needs or the second group overlaps the first.
      function groupBodyH(g) {
        var tallest = 0;
        g.cols.forEach(function (c) { tallest = Math.max(tallest, heightOf(c) || 0); });
        return tallest;
      }

      var tries = 0;
      (function layout() {
        var all = [];
        groups.forEach(function (g) { all.push(g.label); g.cols.forEach(function (c) { all.push(c); }); });
        if (!all.every(function (e) { return heightOf(e) != null; })) {
          if (++tries > 120) return;
          setTimeout(layout, 40);
          return;
        }

        var contentH = 0;
        groups.forEach(function (g, i) {
          contentH += heightOf(g.label) + LABEL_GAP + groupBodyH(g);
          if (i < groups.length - 1) contentH += GROUP_GAP;
        });
        // A reserved band across the top for the panel's own Close control, so
        // the control sits INSIDE the plate (where its contrast is known)
        // rather than floating above the panel's top edge over whatever the
        // panel happens to be covering — in the shipped composition that was
        // straight over the bio card's heading, two off-white texts on top of
        // each other. Reserving the band rather than just placing the button
        // means no skill line can ever run under it.
        var closeBand = SKILLS_CLOSE_H + 0.02;
        var panelH = contentH + pad * 2 + closeBand;

        // ── An OPAQUE plate under the glass ──
        // This was 0.72-opacity glass with nothing behind it, so the portrait,
        // the constellation and the dome all showed straight through the skill
        // text — the single biggest reason it couldn't be read. The card shader
        // clamps at 0.96 and even that measurably bleeds (notice.js records the
        // pixel numbers), and depthWrite cannot save an overlay that draws
        // after everything else under sortTransparentObjects:false (§3.6). So:
        // a solid unlit plate at the panel's exact size, one layer behind it.
        var plateGeo = VRScrollArrows.roundedRectGeometry(panelW, panelH, 0.05);
        var plateMat = new THREE.MeshBasicMaterial({ color: '#0e0c09' });
        var plate = new THREE.Mesh(plateGeo, plateMat);
        plate.position.z = -0.004;
        panel.setObject3D('skills-plate', plate);

        // Glass on top of the plate, same material as every other panel -> same
        // lighting response from the key-light rack. Opacity up from 0.72: it
        // is a reading surface now, not a translucent aside.
        panel.setObject3D('skills-mesh', new THREE.Mesh(
          new THREE.PlaneGeometry(panelW, panelH),
          VRGlass.makeCardMaterial(panelW, panelH, 0.05, accent, 0, 0.96)
        ));

        // Layers, back to front: plate, glass, everything else (the text and
        // the Close control). Re-applied on a timer because troika and
        // ui-button build their meshes asynchronously — one pass here misses
        // them, and then the near-opaque glass paints over its own content.
        panel.__lift = function () {
          var pl = panel.getObject3D('skills-plate');
          var gl = panel.getObject3D('skills-mesh');
          panel.object3D.traverse(function (o) {
            if (!o.isMesh) return;
            o.renderOrder = (o === pl) ? SKILLS_RENDER_ORDER
                          : (o === gl) ? SKILLS_RENDER_ORDER + 1
                          : SKILLS_RENDER_ORDER + 2;
          });
        };
        panel.__lift();
        [60, 200, 500].forEach(function (ms) { setTimeout(panel.__lift, ms); });

        // ── Where it grows FROM ──
        // Not the old docked slot off the card's right edge — it grows out of
        // the "+ View more skills" control you just clicked, which is what
        // makes the motion read as that control expanding rather than a panel
        // arriving from somewhere else. Stored so toggleSkills() can fly it
        // both ways; the panel keeps its identity transform in card space here,
        // so a reduced-motion open still has a sane place to sit.
        panel.__dock = {
          pos: new THREE.Vector3(-0.02 + panelW * SKILLS_DOCK_SCALE / 2, rowY, 0.05),
          quat: new THREE.Quaternion(),
          scale: new THREE.Vector3(SKILLS_DOCK_SCALE, SKILLS_DOCK_SCALE, SKILLS_DOCK_SCALE)
        };
        panel.object3D.position.copy(panel.__dock.pos);
        panel.object3D.scale.copy(panel.__dock.scale);
        panel.__panelH = panelH;

        // ── Its own Close control ──
        // Pulled in, the panel covers the bio card, and the "− Hide skills"
        // toggle it was opened from is BEHIND it — so without this there is no
        // way to shut it. Same small ghost pill, same top-right corner and same
        // fontScale as the focus stage's Close, because it does the same job.
        var closeBtn = document.createElement('a-entity');
        closeBtn.setAttribute('ui-button', {
          label: 'Close', width: SKILLS_CLOSE_W, height: SKILLS_CLOSE_H,
          accent: accent, variant: 'ghost', fontScale: 1.3
        });
        closeBtn.setAttribute('position', {
          x: panelW / 2 - pad - SKILLS_CLOSE_W / 2,
          y: panelH / 2 - pad - SKILLS_CLOSE_H / 2 + 0.01,
          z: 0.03
        });
        closeBtn.addEventListener('click', function (evt) {
          if (evt && evt.stopPropagation) evt.stopPropagation();
          self.toggleSkills();
        });
        panel.appendChild(closeBtn);

        var yy = panelH / 2 - pad - closeBand;
        groups.forEach(function (g, i) {
          g.label.object3D.position.y = yy;
          yy -= heightOf(g.label) + LABEL_GAP;
          // Both columns start on the SAME baseline — they are two halves of
          // one list, and staggering their tops would read as two unrelated
          // blocks. Their x was set at build time from panel.__colX.
          g.cols.forEach(function (c) { c.object3D.position.y = yy; });
          yy -= groupBodyH(g) + GROUP_GAP;
        });
      })();

      // Plain lit text, not a boxed ui-button — per Sebastian, the ghost-pill
      // read as bulky/out of place next to the card's otherwise-bare stat
      // rows. An invisible hit-plane behind the text (same VR-minimum-target
      // footprint ui-button.js enforces) keeps it comfortable to click
      // without rendering as a visible background of its own.
      var skillsFontSize = panel.__labelSize * fitScale * 1.15;
      var toggle = document.createElement('a-entity');
      toggle.setAttribute('troika-text', {
        value: '+ View more skills', align: 'left', anchor: 'left', baseline: 'center',
        color: '#f5f5f0', fillOpacity: 0.78, font: VRFonts.body(), fontSize: skillsFontSize
      });
      VRGlass.lightTroikaText(toggle, '#f5f5f0', { emissive: true });
      var hitW = Math.max(0.24, skillsFontSize * 9), hitH = Math.max(0.10, skillsFontSize * 2.2);
      var hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
      var hitMesh = new THREE.Mesh(new THREE.PlaneGeometry(hitW, hitH), hitMat);
      hitMesh.position.set(hitW / 2 - 0.02, 0, -0.002); // text anchors left at x=0; hit-plane centred over it
      toggle.setObject3D('hit-area', hitMesh);
      toggle.classList.add('clickable');
      // Left-aligned with the value column so it reads as belonging to the
      // Skills row. Its y is set by layout(), which reserves a band for it
      // between the Skills and Hobbies rows.
      toggle.setAttribute('position', { x: -0.02, y: rowY, z: 0.02 });
      toggle.addEventListener('click', function (evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        self.toggleSkills();
      });
      // Small brighten + scale pop in place of ui-button's card-shader glow —
      // there's no backing mesh to brighten here.
      toggle.addEventListener('mouseenter', function () {
        toggle.setAttribute('troika-text', 'fillOpacity', 1);
        toggle.setAttribute('animation__hover', { property: 'scale', dur: 140, easing: 'easeInOutQuad', to: '1.05 1.05 1.05' });
      });
      toggle.addEventListener('mouseleave', function () {
        toggle.setAttribute('troika-text', 'fillOpacity', 0.78);
        toggle.setAttribute('animation__hover', { property: 'scale', dur: 140, easing: 'easeInOutQuad', to: '1 1 1' });
      });
      this.el.appendChild(toggle);
      this._skillsBtn = toggle;
    },

    // Where the panel should sit while it is being READ: yaw-only, in front of
    // wherever the viewer is looking, at a fixed eye height — the same
    // destination rule as focus-stage.js, so looking up or down can't plant it
    // on the floor and a head tilt can't cant it.
    //
    // Returned in the panel's PARENT space, because the panel stays a child of
    // the bio card. Reparenting it to the scene would be the other way to do
    // this and is worse: sunflower.js resolves its aim through the parent's
    // inverse quaternion (§3.9) and the card's layout writes into the panel's
    // local transform, so both would need to learn about the move. Converting
    // one transform is cheaper than teaching two components a special case.
    _skillsReadingTransform: function () {
      var panel = this._skillsPanel;
      var headEl = document.querySelector('#head');
      if (!panel || !headEl) return null;

      var worldPos = new THREE.Vector3(), worldQuat = new THREE.Quaternion();
      headEl.object3D.getWorldPosition(worldPos);
      headEl.object3D.getWorldQuaternion(worldQuat);
      var fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);   // looking straight up/down
      fwd.normalize();

      var target = worldPos.clone().addScaledVector(fwd, SKILLS_READ_DISTANCE);
      target.y = SKILLS_READ_HEIGHT;

      var dummy = new THREE.Object3D();
      dummy.position.copy(target);
      var look = worldPos.clone();
      look.y = target.y;                               // pure yaw
      dummy.lookAt(look);

      var parent = panel.object3D.parent;
      parent.updateWorldMatrix(true, false);
      var parentQuat = new THREE.Quaternion();
      parent.getWorldQuaternion(parentQuat);

      // Parent scale would shrink the panel back down inside the card's frame,
      // so divide it out and land at true unit scale in world terms.
      var parentScale = new THREE.Vector3();
      parent.getWorldScale(parentScale);

      return {
        pos: parent.worldToLocal(target.clone()),
        quat: dummy.quaternion.clone().premultiply(parentQuat.invert()),
        scale: new THREE.Vector3(1 / (parentScale.x || 1), 1 / (parentScale.y || 1), 1 / (parentScale.z || 1))
      };
    },

    // GSAP doesn't slerp quaternions, so tween a progress proxy and apply
    // lerp/slerp per frame — the same helper shape focus-stage.js uses.
    _tweenSkills: function (from, to, ms, onDone) {
      var obj = this._skillsPanel.object3D;
      if (this._skillsTween) this._skillsTween.kill();
      if (reducedMotion || typeof gsap === 'undefined') {
        obj.position.copy(to.pos); obj.quaternion.copy(to.quat); obj.scale.copy(to.scale);
        if (onDone) onDone();
        return;
      }
      var proxy = { t: 0 };
      var self = this;
      this._skillsTween = gsap.to(proxy, {
        t: 1, duration: ms / 1000, ease: 'power2.inOut',
        onUpdate: function () {
          obj.position.lerpVectors(from.pos, to.pos, proxy.t);
          obj.quaternion.slerpQuaternions(from.quat, to.quat, proxy.t);
          obj.scale.lerpVectors(from.scale, to.scale, proxy.t);
        },
        onComplete: function () { self._skillsTween = null; if (onDone) onDone(); }
      });
    },

    _skillsPose: function () {
      var o = this._skillsPanel.object3D;
      return { pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone() };
    },

    toggleSkills: function () {
      var p = this._skillsPanel;
      if (!p) return;
      // __dock is written by the layout pass once the content has been
      // measured; until then there is nothing sized to fly.
      if (!p.__dock) return;

      var open = !p.getAttribute('visible');
      var self = this;

      // sunflower.js is doing exactly the same job as the fly-in's rotation —
      // aiming this panel at the viewer — and the two fight for the quaternion
      // mid-tween. It goes quiet for the flight and takes over on arrival, so
      // the panel keeps facing you if you then walk or turn.
      function sunflower(on) { p.setAttribute('sunflower', 'enabled', on); }

      if (open) {
        var to = this._skillsReadingTransform();
        if (!to) return;
        sunflower(false);
        p.setAttribute('visible', true);
        p.object3D.position.copy(p.__dock.pos);
        p.object3D.quaternion.copy(p.__dock.quat);
        p.object3D.scale.copy(p.__dock.scale);
        if (p.__lift) p.__lift();
        this._tweenSkills(this._skillsPose(), to, SKILLS_FLY_IN_MS, function () {
          sunflower(true);
          if (p.__lift) p.__lift();
        });
      } else {
        sunflower(false);
        this._tweenSkills(this._skillsPose(), p.__dock, SKILLS_FLY_OUT_MS, function () {
          p.setAttribute('visible', false);
          sunflower(true);   // harmless while hidden: sunflower skips invisible panels
        });
      }

      // Mirror the flat site's label flip, so the control always states what
      // it will do next rather than what state you're in.
      if (this._skillsBtn) {
        this._skillsBtn.setAttribute('troika-text', 'value',
          open ? '− Hide skills' : '+ View more skills');
      }
    }
  });
})();
