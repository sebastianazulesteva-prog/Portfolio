/* ═══ name-scatter-3d.js ═══
   The flat site's hero "Tenet effect" (index.html's NAME LETTER ANIMATION —
   every letter of the name scatters on load, then eases back into place,
   slow start/fast finish), rebuilt in 3D for the VR hub's home title only —
   project rooms keep a plain static title, per Sebastian's instruction.

   Same two-line layout as the flat site's `.hero-name` (first name, then the
   surname on its own line in italic/muted — `.word.second`), same per-letter
   staggered delay, same easing curve (a hand-rolled cubic-bezier evaluator
   matching the flat CSS's `cubic-bezier(0.08, 0, 0.08, 1.0)` exactly, since
   GSAP's core has no raw cubic-bezier string support without the paid
   CustomEase plugin). In 3D each letter additionally tumbles on random axes
   and scatters to a random 3D point rather than a random screen position.

   Kerning: rather than guessing even per-letter spacing, this measures each
   word once with a hidden troika-text instance and reads its real advance
   widths (`textRenderInfo.caretPositions`, four floats per glyph —
   [left, right, bottom, top] — from troika-three-text, the library
   aframe-troika-text wraps) before building the real, individually-animated
   per-letter entities at those exact positions. That hidden measurement
   instance is discarded once read; only the per-letter entities remain.

   Plays once per browser session (own sessionStorage key, independent of
   the flat site's) and respects prefers-reduced-motion — letters simply
   appear in place, no scatter, matching the flat site's `no-hero-anim` path.

   Usage: <a-entity name-scatter-3d="width: 1.0; height: 0.6; accent: #b8863b"></a-entity>
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SESSION_KEY = 'vrNameAnimPlayed';

  // Easing standardized to GSAP 'power2.inOut' scene-wide
  // (VR_POLISH_STANDARDS.md §3 — one curve for everything, including the
  // arrival animation). This replaces the flat site's slow-start
  // `cubic-bezier(0.08, 0, 0.08, 1.0)` "Tenet" curve that this intro used to
  // echo; the per-letter stagger + 3D tumble still give it its character.
  var SCENE_EASE = 'power2.inOut';

  // Deterministic "random" — identical formula to the flat site's, so the
  // scatter pattern feels like the same signature, just extended to 3D.
  function seed(i) { return ((i * 1731 + 37) % 1000) / 1000; }

  AFRAME.registerComponent('name-scatter-3d', {
    schema: {
      width: { type: 'number', default: 1.0 },
      height: { type: 'number', default: 0.6 },
      accent: { type: 'color', default: '#b8863b' },
      subtitle: { type: 'string', default: '' }
    },

    init: function () {
      var el = this.el;
      var w = this.data.width, h = this.data.height;
      var a11y = document.body.classList.contains('accessible');

      // No backing panel — the letters float free in space (Sebastian: "the
      // letters can just float in the air alone"), unlike every other glass
      // card in the scene.

      // One big line spanning the top — "Sebastian Esteva" as a single
      // measured word (correct kerning across the space), with the tagline
      // beneath it. Bigger than the old two-line stack, per Sebastian's note
      // to let the name expand across the whole top on load.
      var fontSize = VRType.display(); // hero name — the one documented size exception (§5)
      // Name near the top, tagline near the bottom, so the pair FILLS the card
      // vertically instead of floating in its middle (Sebastian's "fill out the
      // entire top card"). Card width/height are set generously in index.html
      // so the big name spans nearly the full width.
      var nameY = h * 0.16;

      this._letters = [];
      this._buildWord('Sebastian Esteva', VRFonts.title(), fontSize, '#f5f5f0', 1, nameY, function (letters) {
        this._letters = this._letters.concat(letters);
        this._addSubtitle(nameY, fontSize);
        this._startOrSkip();
        this._lightLetters();
      }.bind(this));
    },

    // The name floats free with no glass panel behind it, so it can't use the
    // card shader's lighting (glass-material.js). Instead the letters take
    // REAL three.js lighting from the key-light rack via the shared
    // VRGlass.lightTroikaText helper (glass-material.js) — every troika-text
    // entity in the scene uses the same one now, this was the first place it
    // was built before being pulled out into glass-material.js for reuse.
    _lightLetters: function () {
      var letters = this._letters.concat(this._subtitleEl ? [this._subtitleEl] : []);
      letters.forEach(function (el) { VRGlass.lightTroikaText(el, '#f5f5f0'); });
    },

    // Measures `word` with a hidden troika instance, reads its real
    // per-glyph advance widths, then builds one individually-positioned,
    // individually-animatable troika-text entity per letter — centered as a
    // block on x=0 at height `y`. Calls back with the array of built letter
    // entities once ready (troika's sync is what makes this reliable rather
    // than racing the font's own async load).
    _buildWord: function (word, font, fontSize, color, fillOpacity, y, callback) {
      var el = this.el;
      var measure = document.createElement('a-entity');
      measure.setAttribute('troika-text', {
        value: word, font: font, fontSize: fontSize, anchor: 'left', baseline: 'center', letterSpacing: -0.01
      });
      measure.setAttribute('visible', false);
      el.appendChild(measure);

      var afterMeasure = function () {
        var mesh = measure.components['troika-text'].troikaTextMesh;
        var caret = mesh.textRenderInfo.caretPositions;
        var totalWidth = mesh.textRenderInfo.blockBounds[2];
        el.removeChild(measure);

        var letters = [];
        for (var i = 0; i < word.length; i++) {
          var left = caret[i * 4], right = caret[i * 4 + 1];
          var centerX = (left + right) / 2 - totalWidth / 2; // re-center the whole word on x=0

          var letterEl = document.createElement('a-entity');
          letterEl.setAttribute('troika-text', {
            value: word[i], font: font, fontSize: fontSize, letterSpacing: -0.01,
            align: 'center', anchor: 'center', baseline: 'center',
            color: color, fillOpacity: fillOpacity
          });
          letterEl.object3D.position.set(centerX, y, 0.016);
          // Stash the intended opacity NOW, at creation, from the known
          // param — _playScatter runs synchronously right after the second
          // word's letters are appended, before A-Frame has initialized
          // their troika-text component, so reading it back via
          // getAttribute('troika-text').fillOpacity there throws (the
          // component data doesn't exist yet). This sidesteps that entirely.
          letterEl.__baseOpacity = fillOpacity;
          // Definitive home transform, stashed at build time — the settle
          // guarantee below always snaps back to exactly this, so an
          // interrupted tween can never leave a letter stranded mid-flight
          // (the "Sebastian Este v a" stray-gap bug, item 3).
          letterEl.__home = letterEl.object3D.position.clone();
          el.appendChild(letterEl);
          letters.push(letterEl);
        }
        callback(letters);
      };

      // textRenderInfo.caretPositions (per-glyph advance widths) populates
      // on its own once the font finishes loading and the component lays
      // the text out — no need to explicitly call troika's own `sync()`
      // here (that path proved unreliable: its callback never fired in
      // testing, seemingly gated behind troika's internal update scheduler
      // rather than the font-load promise itself). Polling for the data to
      // simply exist sidesteps that entirely and is robust either way.
      var attempts = 0;
      (function poll() {
        var mesh = measure.components['troika-text'] && measure.components['troika-text'].troikaTextMesh;
        if (mesh && mesh.textRenderInfo && mesh.textRenderInfo.caretPositions) { afterMeasure(); return; }
        if (++attempts > 100) { console.warn('[vr] name-scatter-3d: text measurement timed out for', word); return; }
        setTimeout(poll, 50);
      })();
    },

    // fontSize here is the name's own display size — the tagline is sized
    // relative to it (roughly half the letter height, per Sebastian), not
    // the shared VRType.body() size every other card uses. baseline:'top'
    // anchors the Y coordinate to the top of the (possibly 2-line) subtitle
    // block, so it always grows downward away from the name above it rather
    // than needing a fixed gap tuned for its old, much smaller size.
    _addSubtitle: function (nameY, nameFontSize) {
      if (!this.data.subtitle) return;
      var a11y = document.body.classList.contains('accessible');
      var sub = document.createElement('a-entity');
      sub.setAttribute('troika-text', {
        value: this.data.subtitle, align: 'center', anchor: 'center', baseline: 'top',
        color: '#f5f5f0', fillOpacity: 0, font: VRFonts.body(),
        fontSize: nameFontSize * 0.5, maxWidth: this.data.width * 0.92, lineHeight: 1.3
      });
      sub.object3D.position.set(0, nameY - nameFontSize, 0.016);
      this.el.appendChild(sub);
      this._subtitleEl = sub;
    },

    _startOrSkip: function () {
      if (reducedMotion || sessionStorage.getItem(SESSION_KEY) === '1') {
        // Letters/subtitle already default to their rest transform/opacity —
        // nothing to animate, just make sure fillOpacity is at its final
        // value (subtitle starts at 0 specifically to fade in on the first
        // play, so it needs an explicit bump here on the skip path).
        this._settleAll();
        return;
      }
      sessionStorage.setItem(SESSION_KEY, '1');
      this._playScatter();
    },

    // Force every letter to its exact final kerned home transform + full
    // opacity, and reveal the subtitle. Idempotent and cheap — the backstop
    // that makes the title ALWAYS resolve fully, no matter how the tweens were
    // interrupted (a background-tab RAF pause, a camera move mid-arrival, a
    // dropped frame). Called on tween completion, on a safety timer after the
    // animation's nominal end, and whenever the tab returns to the foreground.
    _settleAll: function () {
      if (!this._letters) return;
      this._letters.forEach(function (letterEl) {
        if (!letterEl.__home || !letterEl.object3D) return;
        var obj = letterEl.object3D;
        obj.position.copy(letterEl.__home);
        obj.rotation.set(0, 0, 0);
        obj.scale.setScalar(1);
        if (letterEl.components && letterEl.components['troika-text']) {
          letterEl.setAttribute('troika-text', 'fillOpacity', letterEl.__baseOpacity);
        }
      });
      if (this._subtitleEl && this._subtitleEl.components && this._subtitleEl.components['troika-text']) {
        this._subtitleEl.setAttribute('troika-text', 'fillOpacity', 0.6);
      }
    },

    // The actual "Tenet effect": every letter starts scattered (random 3D
    // offset/rotation/scale) and eases back to its measured home transform,
    // slow-start/fast-finish, staggered per letter — same shape as the flat
    // site's CSS transition, just tumbling in three dimensions instead of
    // sliding across a 2D screen.
    _playScatter: function () {
      var letters = this._letters;
      letters.forEach(function (letterEl, i) {
        var home = letterEl.object3D.position.clone();
        var s1 = seed(i * 3), s2 = seed(i * 7 + 1), s3 = seed(i * 5 + 2), s4 = seed(i * 11 + 3);
        var s5 = seed(i * 13 + 5), s6 = seed(i * 17 + 7);

        // Random point on a sphere around home, small radius — this is a
        // compact card close to the viewer, not a full screen, so the
        // scatter stays contained rather than flying off into the dome.
        var theta = s1 * Math.PI * 2, phi = Math.acos(2 * s2 - 1);
        var dist = 0.16 + s4 * 0.34;
        var offset = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * dist,
          Math.sin(phi) * Math.sin(theta) * dist,
          Math.cos(phi) * dist
        );
        var scatterPos = home.clone().add(offset);
        var scatterRot = new THREE.Euler((s3 - 0.5) * Math.PI * 2.6, (s5 - 0.5) * Math.PI * 2.6, (s6 - 0.5) * Math.PI * 2.6);
        var scatterScale = 0.3 + s4 * 1.4;
        var homeScale = 1;

        var obj = letterEl.object3D;
        var baseFillOpacity = letterEl.__baseOpacity;
        obj.position.copy(scatterPos);
        obj.rotation.copy(scatterRot);
        obj.scale.setScalar(scatterScale);
        letterEl.setAttribute('troika-text', 'fillOpacity', 0);

        var proxy = { t: 0 };
        gsap.to(proxy, {
          t: 1,
          duration: 1.4,
          delay: (80 + i * 18) / 1000,
          ease: SCENE_EASE,
          onUpdate: function () {
            obj.position.lerpVectors(scatterPos, home, proxy.t);
            obj.rotation.set(
              THREE.MathUtils.lerp(scatterRot.x, 0, proxy.t),
              THREE.MathUtils.lerp(scatterRot.y, 0, proxy.t),
              THREE.MathUtils.lerp(scatterRot.z, 0, proxy.t)
            );
            obj.scale.setScalar(THREE.MathUtils.lerp(scatterScale, homeScale, proxy.t));
            letterEl.setAttribute('troika-text', 'fillOpacity', THREE.MathUtils.lerp(0, baseFillOpacity, Math.min(1, proxy.t / 0.3)));
          },
          // Snap to the exact home transform on finish — floating-point drift
          // from the lerp, or a tween killed just short of t=1, must never
          // leave a letter a hair off its kerned position.
          onComplete: function () {
            obj.position.copy(home);
            obj.rotation.set(0, 0, 0);
            obj.scale.setScalar(homeScale);
            letterEl.setAttribute('troika-text', 'fillOpacity', baseFillOpacity);
          }
        });
      });

      // Safety net: after the animation's nominal end, force a full settle
      // regardless of how the individual tweens fared. Covers the case the bug
      // report describes — letters left with stray gaps ("Este v a") after the
      // arrival tweens were interrupted (a background-tab RAF pause freezes
      // GSAP mid-flight; a recenter/turn landing during the arrival).
      var settleMs = 80 + letters.length * 18 + 1400 + 120;
      if (this._settleTimer) clearTimeout(this._settleTimer);
      this._settleTimer = setTimeout(this._settleAll.bind(this), settleMs);

      // If the tab was backgrounded mid-arrival (RAF/GSAP paused → letters
      // frozen scattered), snap them home the moment we're visible again.
      if (!this._onVisible) {
        this._onVisible = function () { if (!document.hidden) this._settleAll(); }.bind(this);
        document.addEventListener('visibilitychange', this._onVisible);
      }

      // Subtitle fades in once the letters have mostly landed — same
      // "reveal the supporting text after the name settles" beat as the
      // flat site's own fade-in sequencing.
      if (this._subtitleEl) {
        var settleMs = 80 + letters.length * 18 + 1400;
        var subEl = this._subtitleEl;
        setTimeout(function () {
          subEl.setAttribute('animation__fadein', {
            property: 'troika-text.fillOpacity', from: 0, to: 0.6, dur: 500, easing: 'easeInOutQuad'
          });
        }, settleMs * 0.55); // starts partway through the landing, not strictly after — reads as one continuous beat rather than two separate steps
      }
    },

    remove: function () {
      if (this._settleTimer) clearTimeout(this._settleTimer);
      if (this._onVisible) document.removeEventListener('visibilitychange', this._onVisible);
    }
  });
})();
