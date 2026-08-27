/* ═══ ui-button.js ═══
   A real, bounded button — its own background mesh (rounded-rect glass, via
   glass-material.js) with its own raycaster hit target, independent of
   whatever card it sits on, plus a centered label and an unmistakable
   hover response (scale + brighten). Fixes VR_BUGFIX_NOTES.md items 3 + 6:
   before this, "Enter the room →" / "× close" were plain floating troika
   text with no backing, border, or hover state — unclear they were
   clickable at all, separate from the card behind them.

   Two variants:
     solid — filled with the accent color, dark text. Primary action
             ("Enter the room →").
     ghost — translucent dark background, light text. Secondary/dismiss
             action ("‹ Back", "× Close").

   Usage:
     <a-entity ui-button="label: Enter the room →; width: 0.5; height: 0.13;
                           accent: #b8863b; variant: solid"></a-entity>
     el.addEventListener('click', function () { ... });
*/

(function () {
  // ── Minimum target size, scene-wide ──────────────────────────────────────
  // VR pointing is coarse: controller ray jitter, gaze drift and hand-tracking
  // noise all mean a target that would be fine on a screen is genuinely hard
  // to hit in a headset. Per Sebastian, buttons across the whole build need to
  // be comfortable with clunky controls.
  //
  // Sized in ANGULAR terms rather than a guessed metre value, because that is
  // what actually governs pointing difficulty. Panels here live at
  // CONSTELLATION_RADIUS = 2m, where 1 degree of visual angle spans
  // 2 * 2 * tan(0.5deg) ~= 0.035m. Headset UI guidance puts the floor for a
  // reliable target at ~2deg.
  //
  //   MIN_HEIGHT 0.10m ~= 2.9deg at 2m   (was 0.078 -> 2.2deg, right at the floor)
  //   MIN_WIDTH  0.24m ~= 6.9deg at 2m
  //
  // Comfortably clear of the floor without being bulky — a first pass at 0.115
  // (3.3deg) read as comically oversized against a 0.5m-tall glance card, so
  // the goal here is legibly clickable, not big for its own sake.
  //
  // Clamped here rather than left to each caller so nothing in the scene can
  // reintroduce an under-sized control. The warning is deliberate: it points
  // at the caller that needs its layout updated, instead of silently resizing
  // a button out of its slot.
  var MIN_HEIGHT = 0.10;
  var MIN_WIDTH = 0.24;

  // Matches the flat site's work-card/quick-link arrow badge exactly
  // (index.html .work-card-arrow / .quick-link-arrow): rest state is the ↗
  // glyph tilted to read as a plain "→", CSS rotate(-45deg); hover untilts to
  // 0deg (reads as the diagonal external-link arrow) and the badge inverts
  // from a translucent dark fill to a solid light one. Sebastian asked the
  // "Enter the room" button's arrow to follow "the same connections... as the
  // actual website" — this is that connection, in degrees.
  var ARROW_REST_DEG = -45;
  var ARROW_HOVER_DEG = 0;

  // The ↗ glyph (U+2197) rendered via troika-text/Syne came out as a solid
  // filled box — confirmed by raycasting into the rendered scene and reading
  // back a MeshBasicMaterial hit exactly the size of the glyph's em-box.
  // Syne's Fontsource *latin* subset (fonts.js) doesn't include this Unicode
  // arrow, so troika substitutes the font's "missing glyph" placeholder — a
  // filled rect, which rotated -45deg reads exactly as the white diamond this
  // produced. Drawing it into a canvas with a system sans-serif font (which
  // reliably has Unicode arrow coverage) sidesteps the webfont's subset
  // entirely — one shared, cached texture, tinted per state via
  // material.color rather than baked-in colour.
  var _arrowTex = null;
  function arrowGlyphTexture() {
    if (_arrowTex) return _arrowTex;
    var size = 128;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 ' + Math.round(size * 0.7) + 'px -apple-system, "Helvetica Neue", Arial, sans-serif';
    // 900 is already the heaviest named weight the system font offers, so
    // going thicker still means faking it: stroke the glyph before filling it,
    // which pads every stroke outward uniformly rather than just scaling the
    // glyph up (scaling would grow the whole badge, not just its weight).
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = size * 0.05;
    ctx.strokeText('↗', size / 2, size / 2 + size * 0.03);
    ctx.fillText('↗', size / 2, size / 2 + size * 0.03);
    _arrowTex = new THREE.CanvasTexture(c);
    return _arrowTex;
  }

  AFRAME.registerComponent('ui-button', {
    schema: {
      label: { type: 'string' },
      width: { type: 'number', default: 0.46 },
      height: { type: 'number', default: 0.13 },
      accent: { type: 'color', default: '#b8863b' },
      variant: { type: 'string', default: 'solid' }, // 'solid' | 'ghost'
      // A separate rotating arrow badge, matching the flat site's work-card
      // hover connection, instead of a trailing "→" baked into the label
      // string. Pass the label WITHOUT a trailing arrow when this is on.
      arrow: { type: 'boolean', default: false },
      // Empty string (not a real color) means "use the variant's default" —
      // solid's usual dark-on-accent only reads as a real control when the
      // accent fill is light; callers that want light text on a solid button
      // regardless (e.g. pdf-reader's card, kept consistent all-white) set
      // this instead of switching to 'ghost', which would also drop the
      // fill's opacity and border weight.
      labelColor: { type: 'color', default: '' },
      // Multiplier on the label's type size. The 3-size scale (§5) sets the
      // floor; a button with a lot of empty plate around a short word reads as
      // undersized text rather than as generous padding, and this lets that
      // caller ask for a bump without introducing a fourth size.
      fontScale: { type: 'number', default: 1 }
    },

    init: function () {
      if (this.data.height < MIN_HEIGHT || this.data.width < MIN_WIDTH) {
        console.warn('[vr] ui-button "' + this.data.label + '" requested ' +
          this.data.width.toFixed(3) + 'x' + this.data.height.toFixed(3) +
          'm — below the VR minimum target size, clamping to ' +
          MIN_WIDTH + 'x' + MIN_HEIGHT + 'm. Update the caller\'s layout to suit.');
      }
      var w = Math.max(this.data.width, MIN_WIDTH);
      var h = Math.max(this.data.height, MIN_HEIGHT);
      // Published so callers can position against the ACTUAL size rather than
      // the size they asked for.
      this.effectiveWidth = w;
      this.effectiveHeight = h;
      var solid = this.data.variant === 'solid';
      var a11y = document.body.classList.contains('accessible');

      // A solid button reads as a real control (filled, high-contrast dark
      // text); ghost is for secondary/dismiss actions (translucent, light
      // text) — same rounded-glass shader either way, just tuned opacity.
      this.material = VRGlass.makeCardMaterial(w, h, h * 0.4, this.data.accent, 0, solid ? 0.92 : 0.4);
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.material);
      this.el.setObject3D('button-mesh', this.mesh);

      // LIGHT on both variants. This went dark -> pure black -> light across
      // three passes, so the reasoning is worth recording: the "solid" plate is
      // not the raw accent colour. It is that accent through
      // VRGlass.makeCardMaterial at 0.92 opacity over a dark scene, which
      // renders as a deep warm brown even for a light tan accent like the
      // pendant's #d8c9a0. Dark text on that is the low-contrast pairing, not
      // the high-contrast one — going all the way to #000000 made it worse, not
      // better. Sebastian, looking at it in place: "the black text is super hard
      // to see here, just do the same white for the enter room stuff."
      //
      // This also makes every button in the scene agree: "Read the piece" and
      // "Link" already forced #f5f5f0 through labelColor, and the exit button
      // does too. That override now matches the default instead of fighting it.
      var labelColor = this.data.labelColor || '#f5f5f0';

      var badgeR = h * 0.3;
      var badgeInset = h * 0.16;

      // On a wide CTA ("Enter the project room" at 0.6m+) the badge's zone is
      // a small enough fraction of the width that dead-centering the label
      // and ignoring the arrow reads fine. On a narrower button ("Read the
      // piece" at 0.43m) it doesn't: measured blockBounds showed the label
      // sitting dead center while the badge eats a fixed-size bite out of the
      // right side only, leaving a ~0.076m gap on the left of the text against
      // ~0.024m on the right — over 3x more empty space on one side, which
      // reads as visibly off-center rather than as "an icon near the edge".
      // Reserving the badge's own footprint and centering the label in what's
      // left fixes it at every width instead of only the wide ones that
      // happened to hide it. badgeR*1.5 is the glyph mesh's diameter (see
      // _buildArrowBadge), so this is the badge's actual footprint, not a
      // guess.
      var arrowReserve = this.data.arrow ? (badgeInset + badgeR * 1.5) : 0;
      var labelX = -arrowReserve / 2;

      // Button labels use the shared 'body' size (§5's 3-size scale) as a
      // floor — an arrow CTA gets a deliberate bump on top of that (still a
      // scale of the existing size, same exception class as the bio card's
      // auto-fit, not a new 4th size). Small in-scene HUD buttons (< ~0.055
      // tall) fall back to 'label' so the text still fits their tighter frame.
      var baseFontSize = h < 0.07 ? VRType.label() : VRType.body();
      var label = document.createElement('a-entity');
      label.setAttribute('troika-text', {
        value: this.data.label, align: 'center', anchor: 'center', baseline: 'center',
        color: labelColor, fillOpacity: solid ? 1 : 0.85,
        font: VRFonts.bodyBold(),
        fontSize: (this.data.arrow ? baseFontSize * 1.2 : baseFontSize) * this.data.fontScale,
        maxWidth: w * 0.88 - arrowReserve
      });
      // 0.008, not 0.014. These controls are often seen well off-axis (the exit
      // and close buttons live up and to the right of whatever they belong to),
      // and a label standing proud of its plate shifts against it with viewing
      // angle — measured dead-centre in geometry, it still reads as off-centre
      // on screen. Halving the stand-off halves that parallax while keeping
      // enough separation to stay clear of the plate's own z-fighting range.
      label.setAttribute('position', { x: labelX, y: 0, z: 0.008 });
      this.el.appendChild(label);
      this.labelEl = label;
      // Emissive floor, same reasoning as every other lit-text call site in
      // this scene (hub-panel's CAPTION_LIT, pdf-reader's page label): the key
      // rack is dim and warm, so a plain MeshStandardMaterial white/near-white
      // label sinks toward muddy brown instead of reading as the colour it was
      // given. Harmless for solid's dark #0b0a08 text — emissive at near-black
      // contributes nothing to brighten it either way.
      VRGlass.lightTroikaText(label, labelColor, { emissive: true });

      if (this.data.arrow) {
        this._buildArrowBadge(w, h, badgeR, badgeInset);
        this._centreLabelAndArrow(w, badgeR, badgeInset);
      }

      // The hit target is this same bounded mesh — no separate invisible
      // plane needed, the raycaster already resolves against panel-mesh
      // objects tagged .clickable.
      this.el.classList.add('clickable');
      this._hover = 0;
      this._hoverTarget = 0;
      this._onEnter = this.wake.bind(this, true);
      this._onLeave = this.wake.bind(this, false);
      this.el.addEventListener('mouseenter', this._onEnter);
      this.el.addEventListener('mouseleave', this._onLeave);
    },

    // Just the arrow glyph — no circle/backdrop (Sebastian: "the arrow
    // doesn't need a circle around it, it just needs to move correctly when
    // the button is highlighted"). Rotated to rest at ARROW_REST_DEG, untilts
    // to ARROW_HOVER_DEG on hover (see wake()) — same connection as the
    // site's work-card arrow, just without the circular chip around it.
    // Canvas-drawn (see arrowGlyphTexture's note above), not troika-text.
    _buildArrowBadge: function (w, h, radius, inset) {
      var accent = this.data.accent;
      var solid = this.data.variant === 'solid';

      var badge = document.createElement('a-entity');
      badge.setAttribute('position', { x: w / 2 - inset - radius, y: 0, z: 0.012 });
      badge.setAttribute('rotation', { x: 0, y: 0, z: ARROW_REST_DEG });
      this.el.appendChild(badge);

      // Same override as the label: an explicit labelColor wins over the
      // solid/ghost default so a button forced to light text (pdf-reader's
      // "Read the piece") gets a matching light arrow instead of defaulting
      // back to dark-on-solid.
      var glyphMat = new THREE.MeshBasicMaterial({
        // Follows the label: a light label with a dark arrow reads as two
        // different controls sharing a plate.
        map: arrowGlyphTexture(), transparent: true, color: this.data.labelColor || (solid ? '#f5f5f0' : accent)
      });
      var glyphMesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 1.5, radius * 1.5), glyphMat);
      glyphMesh.position.set(0, 0, 0.008);
      badge.setObject3D('badge-glyph', glyphMesh);

      this._badgeEl = badge;
    },

    // ── Centre the label and the arrow as one unit ──
    // Sebastian: "the arrows and texts should be centered." The old scheme
    // reserved the badge's footprint on the right and centred the label in
    // what was left, with the badge pinned to the right EDGE. On a wide CTA
    // ("Enter the project room", 0.66 m) that leaves a big empty channel
    // between the text and the arrow and reads as two things that missed each
    // other, rather than one centred label-plus-arrow.
    //
    // Centring the pair needs the label's real measured width, and troika lays
    // out asynchronously — so the constructor's placement stands until the
    // measurement lands, then both move once. Watch for blockBounds to EXIST
    // (this text never changes size afterwards, so the stale-value trap in
    // §3.2 doesn't apply here).
    _centreLabelAndArrow: function (w, badgeR, badgeInset) {
      var self = this;
      var tries = 0;
      var arrowD = badgeR * 1.5;
      var gap = badgeInset;
      (function poll() {
        if (!self.labelEl || !self._badgeEl) return;
        var m = self.labelEl.components['troika-text'] &&
                self.labelEl.components['troika-text'].troikaTextMesh;
        var bb = m && m.textRenderInfo && m.textRenderInfo.blockBounds;
        if (!bb) { if (++tries < 60) setTimeout(poll, 40); return; }

        var labelW = bb[2] - bb[0];
        var total = labelW + gap + arrowD;
        // If the pair genuinely doesn't fit, leave the constructor's
        // reserve-and-centre placement alone — better off-centre than
        // overhanging the plate.
        if (total > w * 0.94) return;

        self.labelEl.setAttribute('position', {
          x: -total / 2 + labelW / 2, y: 0, z: 0.008
        });
        self._badgeEl.setAttribute('position', {
          x: total / 2 - arrowD / 2, y: 0, z: 0.012
        });
      })();
    },

    // Without this, changing the `label` after creation updated the component
    // data but left the rendered text untouched — a toggle button would report
    // its new label while still displaying the old one. Only the label is
    // handled here; size/variant changes still need a rebuild, which nothing
    // in the scene does.
    update: function (oldData) {
      if (!this.labelEl || !oldData || oldData.label === undefined) return;
      if (oldData.label !== this.data.label) {
        this.labelEl.setAttribute('troika-text', 'value', this.data.label);
      }
    },

    // Unmistakable, not subtle (VR_BUGFIX_NOTES.md item 3): a firm scale
    // pop plus the shader's own border/glow brighten (uHover), snappy dur.
    wake: function (on) {
      this._hoverTarget = on ? 1 : 0;
      this.el.setAttribute('animation__hover', {
        property: 'scale', dur: 160, easing: 'easeInOutQuad',
        to: on ? '1.08 1.08 1.08' : '1 1 1'
      });

      if (!this._badgeEl) return;
      // Untilt on hover — the same connection as the site's
      // rotate(-45deg) -> rotate(0deg). A-Frame's rotation component reads
      // the CURRENT attribute as the tween start, same pattern as the scale
      // animation above, so this is safe to re-trigger on every enter/leave.
      this._badgeEl.setAttribute('animation__arrow', {
        property: 'rotation', dur: 260, easing: 'easeInOutQuad',
        to: '0 0 ' + (on ? ARROW_HOVER_DEG : ARROW_REST_DEG)
      });
    },

    tick: function (time, delta) {
      if (Math.abs(this._hover - this._hoverTarget) < 0.001) return;
      var k = Math.min(1, (delta || 16) / 120);
      this._hover += (this._hoverTarget - this._hover) * k;
      this.material.uniforms.uHover.value = this._hover;
    },

    remove: function () {
      this.el.removeObject3D('button-mesh');
      if (this._badgeEl) this._badgeEl.removeObject3D('badge-glyph');
      this.el.removeEventListener('mouseenter', this._onEnter);
      this.el.removeEventListener('mouseleave', this._onLeave);
    }
  });

  // The glyph texture + its rest/hover rotation, for callers that want the
  // exact same arrow (not a re-drawn lookalike) without going through a full
  // ui-button — e.g. hub-panel's Experience cards, which want just the badge
  // as a "there's more here" hint, not a separate clickable pad (the whole
  // card is already the click target).
  window.VRArrowGlyph = {
    texture: arrowGlyphTexture,
    restDeg: ARROW_REST_DEG,
    hoverDeg: ARROW_HOVER_DEG
  };
})();
