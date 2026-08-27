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
    _buildSkillsPanel: function (cardW, accent, labelFontSize) {
      var panelW = 0.92;
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

      var pad = panelW * 0.05;
      var groups = this.skillGroups.map(function (g) {
        var label = document.createElement('a-entity');
        label.setAttribute('troika-text', {
          value: g.label.toUpperCase(), align: 'left', anchor: 'left', baseline: 'top',
          color: accent, fillOpacity: 0.9, font: VRFonts.bodyBold(),
          fontSize: labelFontSize, maxWidth: panelW - pad * 2, letterSpacing: 0.04
        });
        label.setAttribute('position', { x: -panelW / 2 + pad, y: 0, z: 0.014 });
        panel.appendChild(label);
        VRGlass.lightTroikaText(label, accent);

        var value = document.createElement('a-entity');
        value.setAttribute('troika-text', {
          value: g.value, align: 'left', anchor: 'left', baseline: 'top',
          color: '#f5f5f0', fillOpacity: 0.8, font: VRFonts.body(),
          fontSize: labelFontSize, maxWidth: panelW - pad * 2, lineHeight: 1.34
        });
        value.setAttribute('position', { x: -panelW / 2 + pad, y: 0, z: 0.014 });
        panel.appendChild(value);
        VRGlass.lightTroikaText(value, '#f5f5f0');
        return { label: label, value: value };
      });

      panel.__panelW = panelW;
      panel.__groups = groups;
      panel.__pad = pad;
      panel.__accent = accent;
      panel.__labelSize = labelFontSize;
      return panel;
    },

    // Size the panel to its own measured content, place it to the right of the
    // Skills row, and wire the row to toggle it.
    _wireSkillsRow: function (row, panel, rowY, cardW, cardH, fitScale) {
      if (!panel || panel.__wired) return;
      panel.__wired = true;

      var pad = panel.__pad, panelW = panel.__panelW;
      var accent = panel.__accent;
      var groups = panel.__groups;
      var GROUP_GAP = 0.026 * fitScale, LABEL_GAP = 0.008 * fitScale;

      // Match the card's auto-fitted type size, or the panel reads as a
      // different, smaller component sitting next to the card.
      groups.forEach(function (g) {
        g.label.setAttribute('troika-text', 'fontSize', panel.__labelSize * fitScale);
        g.value.setAttribute('troika-text', 'fontSize', panel.__labelSize * fitScale);
      });

      function heightOf(entity) {
        var m = entity.components['troika-text'] && entity.components['troika-text'].troikaTextMesh;
        if (!m || !m.textRenderInfo || !m.textRenderInfo.blockBounds) return null;
        var bb = m.textRenderInfo.blockBounds;
        return bb[3] - bb[1];
      }

      var tries = 0;
      (function layout() {
        var all = [];
        groups.forEach(function (g) { all.push(g.label, g.value); });
        if (!all.every(function (e) { return heightOf(e) != null; })) {
          if (++tries > 120) return;
          setTimeout(layout, 40);
          return;
        }

        var contentH = 0;
        groups.forEach(function (g, i) {
          contentH += heightOf(g.label) + LABEL_GAP + heightOf(g.value);
          if (i < groups.length - 1) contentH += GROUP_GAP;
        });
        var panelH = contentH + pad * 2;

        // Glass background, same material as every other panel -> same
        // lighting response from the key-light rack.
        panel.setObject3D('skills-mesh', new THREE.Mesh(
          new THREE.PlaneGeometry(panelW, panelH),
          VRGlass.makeCardMaterial(panelW, panelH, 0.05, accent, 0, 0.72)
        ));

        // Opens to the RIGHT, with its top aligned to the Skills row so the
        // relationship reads immediately — but clamped to stay within the
        // card's own vertical span. Without the clamp a tall panel anchored to
        // a near-the-bottom Skills row hangs well below the card and reads as
        // detached rather than attached to that row.
        var panelTop = rowY;
        if (panelTop - panelH < -cardH / 2) panelTop = -cardH / 2 + panelH;
        if (panelTop > cardH / 2) panelTop = cardH / 2;
        panel.object3D.position.set(cardW / 2 + 0.06 + panelW / 2, panelTop - panelH / 2, 0.03);

        var yy = panelH / 2 - pad;
        groups.forEach(function (g, i) {
          g.label.object3D.position.y = yy;
          yy -= heightOf(g.label) + LABEL_GAP;
          g.value.object3D.position.y = yy;
          yy -= heightOf(g.value) + GROUP_GAP;
        });
      })();

      // Plain lit text, not a boxed ui-button — per Sebastian, the ghost-pill
      // read as bulky/out of place next to the card's otherwise-bare stat
      // rows. An invisible hit-plane behind the text (same VR-minimum-target
      // footprint ui-button.js enforces) keeps it comfortable to click
      // without rendering as a visible background of its own.
      var self = this;
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

    toggleSkills: function () {
      var p = this._skillsPanel;
      if (!p) return;
      var open = !p.getAttribute('visible');
      p.setAttribute('visible', open);
      // Mirror the flat site's label flip, so the control always states what
      // it will do next rather than what state you're in.
      if (this._skillsBtn) {
        this._skillsBtn.setAttribute('troika-text', 'value',
          open ? '− Hide skills' : '+ View more skills');
      }
    }
  });
})();
