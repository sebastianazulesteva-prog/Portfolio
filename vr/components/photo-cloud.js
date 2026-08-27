/* ═══ photo-cloud.js ═══
   The VR-only Photo Catalog (§9 / build directive item 9): every image on the
   site drifts as a loose 3D constellation in its own zone BEHIND the viewer —
   turn around from the hub to find it. Reach/gaze one and it floats forward,
   enlarges, and shows its caption (the image's alt text + the project it
   belongs to); look away and it eases back into the cloud.

   Data-driven (data-loader.js's `images` catalog), so new photos on the real
   site appear here automatically. Textures are downscaled to 512px on load
   (glass-material.js) — 34 full-res photos would otherwise be a lot of GPU
   memory. Placement is deterministic (a golden-ratio hash), so the cloud
   looks scattered but is stable across loads, and the slow idle drift is
   disabled under reduced-motion.

   Usage:
     <a-entity photo-cloud></a-entity>
     el.components['photo-cloud'].setImages(data.images);
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── The cloud's own zone, bounded to leave a CLEAR GAP on both sides ──
  // (VR_AI_BUILD_GUIDE.md §9.1.) This used to be BACK_CENTER 180 ± ZONE_WIDTH
  // 150/2, i.e. tile centres anywhere from 105° to 255°. That genuinely
  // overlapped the card zones: measured, the projects grid's outer column
  // reached 113° on the left while cloud tiles started at 105°, so the two were
  // separated by depth alone (radius 2.0 against the cloud's 2.21–3.56) and
  // read as tangled the moment you looked from off to one side.
  //
  // Now stated as explicit bounds cut to clear the real cluster edges, which is
  // also why they are NOT symmetric about 180 — the two sides have different
  // amounts of card in them:
  //   right, Experience outer edge  = 116.8°  (109.62° column + 7.18° half-card)
  //   left,  Projects outer edge    = 131.7°  (96.5° centre + 35.2° half-grid)
  //                                 = 228.3° in this component's angle sense
  // A tile's own angular half-width is up to ~8° (a 0.61 m tile at radius
  // 2.21), so bounds on tile CENTRES have to sit that far inside the visual
  // gap. These leave ~14° of clear dome on each side.
  var ZONE_MIN_DEG = 139;  // toward Experience (viewer's right)
  var ZONE_MAX_DEG = 206;  // toward the projects grid (viewer's left)
  var MIN_R = 2.2, MAX_R = 3.6;
  var MIN_H = 0.7, MAX_H = 2.6;
  var TILE = 0.5;          // base tile size (long edge, metres)
  var FOCUS_R = 1.6;       // how close a reached tile floats in
  var FOCUS_SCALE = 1.45;  // enlarge on reach — kept modest so a focused tile can't loom over neighbouring panels (VR_BUGFIX item 8)
  var FOCUS_TOP = 1.9;     // a focused tile's TOP edge is clamped below this height, so it can never rise into the title banner above the hub

  // ── Selection (§9.8) ── distinct from the hover/reach above.
  // Sebastian: "when a user selects a photo to view/read it, that photo should
  // come forward and stack in front of the others. Other photos behind it
  // should not interrupt/overlap the selected one."
  //
  // Both halves are geometric rather than a render-order trick. The selected
  // tile travels to 1.15 m — nearer than EVERY other tile's home radius (2.21 m
  // minimum), so after the move nothing in the cloud can physically be in front
  // of it and normal depth testing does the stacking. Meanwhile the rest of the
  // cloud pushes 18% further out and dims, so the neighbours stop competing for
  // the frame instead of merely being behind.
  var SELECT_R = 1.15;
  var SELECT_SCALE = 1.9;
  var OTHERS_PUSH = 1.18;  // multiplier on every other tile's home radius
  var OTHERS_DIM = 0.55;   // uDim for the rest of the cloud while one is selected
  var SELECT_TOP = 2.05;   // as FOCUS_TOP, but the selected tile is bigger

  function frac(x) { return x - Math.floor(x); }

  // Turn a messy alt string + owning project into a short one-line caption.
  function caption(im) {
    var alt = (im.alt || '').replace(/\s+/g, ' ').trim();
    if (alt.length > 90) alt = alt.slice(0, 88).replace(/[\s,.;:]+\S*$/, '') + '…';
    if (im.project) return (alt ? alt + '  ·  ' : '') + im.project;
    return alt || 'Untitled';
  }

  AFRAME.registerComponent('photo-cloud', {
    init: function () {
      this._tiles = [];
      this._selected = null;
      // title -> project object, supplied by index.html (the scene's data owner).
      // The catalog only knows a photo's project by TITLE, and entering a room
      // needs the whole project record.
      this._resolveProject = null;
    },

    // index.html calls this with a lookup built from the scraped project list.
    setProjectResolver: function (fn) { this._resolveProject = fn; },

    setImages: function (images) {
      var self = this;
      var a11y = document.body.classList.contains('accessible');
      (images || []).forEach(function (im, i) {
        // Deterministic pseudo-random placement (golden-ratio hashing).
        var s1 = frac((i + 1) * 0.61803398875);
        var s2 = frac((i + 1) * 0.38196601125 + 0.13);
        var s3 = frac((i + 1) * 0.27201964951 + 0.71);
        var s4 = frac((i + 1) * 0.13 + 0.37);

        var angle = ZONE_MIN_DEG + s1 * (ZONE_MAX_DEG - ZONE_MIN_DEG);
        var radius = MIN_R + s2 * (MAX_R - MIN_R);
        var height = MIN_H + s3 * (MAX_H - MIN_H);
        var rad = THREE.MathUtils.degToRad(angle);
        var home = new THREE.Vector3(Math.sin(rad) * radius, height, -Math.cos(rad) * radius);

        // Slightly varied tile size so the cloud reads organically, not gridded.
        var size = TILE * (0.82 + s4 * 0.4);

        var tileEl = document.createElement('a-entity');
        tileEl.classList.add('clickable');
        tileEl.object3D.position.copy(home);
        // Face the viewer at the origin. lookAt() alone is correct here and
        // must NOT be followed by a rotateY(PI) "correction": Object3D.lookAt
        // SWAPS its arguments for non-camera/non-light objects
        // (m1.lookAt(_target, _position, up)), so a plane's front (+Z) already
        // ends up pointing AT the target. The extra flip turned all 34 tiles
        // toward the dome wall — and since makeFeatheredImage's ShaderMaterial
        // is FrontSide, backface culling made the whole cloud invisible AND
        // un-raycastable (so every tile's hover caption/reach was dead too).
        // Don't "fix" a facing problem here with side: DoubleSide either — that
        // shows the tiles mirrored.
        tileEl.object3D.lookAt(0, height, 0);

        var mesh = VRGlass.makeFeatheredImage(im.src, size, size, size * 0.12, 512);
        // Depth cue: farther tiles sit a little dimmer, so the cloud reads as
        // having real front-to-back depth rather than a flat wall of photos
        // (the depth/contrast pass). Static — zero per-frame cost; a reached
        // tile brightens back to full as it floats in (see _focus).
        var depthDim = ((radius - MIN_R) / (MAX_R - MIN_R)) * 0.32;
        mesh.material.uniforms.uDim.value = depthDim;
        tileEl.setObject3D('tile', mesh);

        // Caption — hidden until reached. Placed below the tile; sized so that
        // at FOCUS_SCALE it's comfortably readable.
        var cap = document.createElement('a-entity');
        cap.setAttribute('troika-text', {
          value: caption(im), align: 'center', anchor: 'center', baseline: 'top',
          color: '#f5f5f0', fillOpacity: 0.9, font: VRFonts.body(),
          fontSize: VRType.body(), maxWidth: size * 2.2, lineHeight: 1.25
        });
        cap.object3D.position.set(0, -size * 0.62, 0.02);
        cap.object3D.visible = false;
        tileEl.appendChild(cap);

        self.el.appendChild(tileEl);

        var tile = {
          el: tileEl, cap: cap, home: home.clone(), size: size, depthDim: depthDim, mat: mesh.material,
          im: im,
          driftPhase: s1 * Math.PI * 2, driftAmp: 0.02 + s2 * 0.03, hovered: false, tween: null,
          selected: false, actionEl: null
        };
        self._tiles.push(tile);

        // Hover is suppressed while something is selected: the rest of the cloud
        // has receded and dimmed on purpose, and letting a tile back there float
        // forward on hover would put it right back in front of the thing the
        // visitor is actually looking at.
        tileEl.addEventListener('mouseenter', function () {
          if (self._selected && self._selected !== tile) return;
          if (tile.selected) return;
          self._focus(tile, true);
        });
        tileEl.addEventListener('mouseleave', function () {
          if (self._selected && self._selected !== tile) return;
          if (tile.selected) return;
          self._focus(tile, false);
        });
        tileEl.addEventListener('click', function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
          self.select(tile.selected ? null : tile);
        });
      });
    },

    // Float a tile forward + enlarge (reach), or ease it back into the cloud.
    _focus: function (tile, on) {
      tile.hovered = on;
      if (tile.cap) tile.cap.object3D.visible = on;

      var target;
      if (on) {
        // Float in along the tile's OWN direction (stays in the back zone,
        // never swings around to the front), and clamp the height so the
        // enlarged tile's top edge stays below the title banner — so a reached
        // tile can't intersect the hub's other panels (VR_BUGFIX item 8).
        var dir = tile.home.clone(); dir.y = 0; dir.normalize();
        var halfH = tile.size * FOCUS_SCALE / 2;
        var focusY = Math.min(1.5, FOCUS_TOP - halfH);
        target = { pos: dir.multiplyScalar(FOCUS_R).setY(focusY), scale: FOCUS_SCALE };
      } else {
        target = { pos: tile.home.clone(), scale: 1 };
      }

      var targetDim = on ? 0 : tile.depthDim; // reached tile brightens to full

      if (reducedMotion || typeof gsap === 'undefined') {
        tile.el.object3D.position.copy(target.pos);
        tile.el.object3D.scale.setScalar(target.scale);
        tile.mat.uniforms.uDim.value = targetDim;
        return;
      }
      if (tile.tween) tile.tween.kill();
      var o = tile.el.object3D;
      var from = { x: o.position.x, y: o.position.y, z: o.position.z, s: o.scale.x, d: tile.mat.uniforms.uDim.value };
      var proxy = { t: 0 };
      tile.tween = gsap.to(proxy, {
        t: 1, duration: on ? 0.5 : 0.6, ease: 'power2.inOut',
        onUpdate: function () {
          o.position.set(
            from.x + (target.pos.x - from.x) * proxy.t,
            from.y + (target.pos.y - from.y) * proxy.t,
            from.z + (target.pos.z - from.z) * proxy.t
          );
          o.scale.setScalar(from.s + (target.scale - from.s) * proxy.t);
          tile.mat.uniforms.uDim.value = from.d + (targetDim - from.d) * proxy.t;
        },
        onComplete: function () { tile.tween = null; }
      });
    },

    // ── Select / deselect ──
    // Pass null to clear. Selecting a second tile releases the first, so there
    // is only ever one thing forward.
    select: function (tile) {
      var prev = this._selected;
      if (prev === tile) return;

      if (prev) {
        prev.selected = false;
        this._teardownAction(prev);
        if (prev.cap) prev.cap.object3D.visible = false;
        this._moveTile(prev, prev.home.clone(), 1, prev.depthDim, 0.6);
      }

      this._selected = tile || null;

      if (!tile) {
        this._recedeOthers(false);
        return;
      }

      tile.selected = true;
      tile.hovered = false;
      if (tile.cap) tile.cap.object3D.visible = true;

      // Forward along the tile's OWN direction, so it stays in the cloud's zone
      // behind the hub rather than swinging around into the arrival view — same
      // reasoning as _focus, just nearer. Height is clamped so the enlarged
      // tile's top edge can't climb into the panels above.
      var dir = tile.home.clone(); dir.y = 0; dir.normalize();
      var halfH = tile.size * SELECT_SCALE / 2;
      var y = Math.min(1.55, SELECT_TOP - halfH);
      this._moveTile(tile, dir.multiplyScalar(SELECT_R).setY(y), SELECT_SCALE, 0, 0.5);

      this._recedeOthers(true);
      this._buildAction(tile);
    },

    // Push the rest of the cloud back and dim it, or restore it.
    _recedeOthers: function (on) {
      var self = this;
      this._tiles.forEach(function (t) {
        if (t === self._selected) return;
        if (t.cap) t.cap.object3D.visible = false;
        var target = t.home.clone();
        if (on) {
          // Scale the horizontal radius only — pushing y as well would drag the
          // whole cloud toward the floor as it recedes.
          var r = Math.sqrt(target.x * target.x + target.z * target.z);
          var k = (r * OTHERS_PUSH) / (r || 1);
          target.x *= k; target.z *= k;
        }
        self._moveTile(t, target, 1, on ? OTHERS_DIM : t.depthDim, on ? 0.55 : 0.6);
      });
    },

    // One tween path for hover, select and recede, so they can't fight: every
    // caller goes through here and the previous tween is always killed first.
    _moveTile: function (tile, pos, scale, dim, dur) {
      if (tile.tween) { tile.tween.kill(); tile.tween = null; }
      var o = tile.el.object3D;
      if (reducedMotion || typeof gsap === 'undefined') {
        o.position.copy(pos);
        o.scale.setScalar(scale);
        tile.mat.uniforms.uDim.value = dim;
        return;
      }
      var from = { x: o.position.x, y: o.position.y, z: o.position.z, s: o.scale.x, d: tile.mat.uniforms.uDim.value };
      var proxy = { t: 0 };
      tile.tween = gsap.to(proxy, {
        t: 1, duration: dur, ease: 'power2.inOut',
        onUpdate: function () {
          o.position.set(
            from.x + (pos.x - from.x) * proxy.t,
            from.y + (pos.y - from.y) * proxy.t,
            from.z + (pos.z - from.z) * proxy.t
          );
          o.scale.setScalar(from.s + (scale - from.s) * proxy.t);
          tile.mat.uniforms.uDim.value = from.d + (dim - from.d) * proxy.t;
        },
        onComplete: function () { tile.tween = null; }
      });
    },

    // ── "View full project" ──
    // Only where the photo actually belongs to one: the catalog tags a photo's
    // project by matching its filename stem against a project href
    // (data-loader.js), so contact photos and anything unmatched simply don't
    // get the action. Destination is the themed VR room — the same place the
    // grid's "Enter the project room" goes, per §9.8.
    _buildAction: function (tile) {
      this._teardownAction(tile);
      var title = tile.im && tile.im.project;
      if (!title || !this._resolveProject) return;
      var project = this._resolveProject(title);
      if (!project) return;

      var btn = document.createElement('a-entity');
      btn.setAttribute('ui-button', {
        label: 'View full project', width: 0.44, height: 0.11,
        accent: project.accent || '#b8863b', variant: 'solid', arrow: true,
        labelColor: '#f5f5f0'
      });
      // Counter-scaled by SELECT_SCALE: the button is a child of the tile, and
      // without this it would be blown up with it and read as a slab rather
      // than a control. Authored size is the size you get.
      btn.object3D.scale.setScalar(1 / SELECT_SCALE);
      // Below the caption, which is anchored top at -size*0.62 and can run to
      // two lines at this size.
      btn.object3D.position.set(0, -tile.size * 0.62 - 0.20, 0.03);
      btn.addEventListener('click', function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        window.VRProjectRoom.enter(project);
      });
      tile.el.appendChild(btn);
      tile.actionEl = btn;
    },

    _teardownAction: function (tile) {
      if (tile.actionEl && tile.actionEl.parentNode) tile.actionEl.parentNode.removeChild(tile.actionEl);
      tile.actionEl = null;
    },

    tick: function (time) {
      if (reducedMotion) return;
      // Very slow idle bob, only on tiles that aren't reached (so it doesn't
      // fight the focus tween). Cheap — a sine per tile, no allocations.
      // Skipped entirely while anything is selected: the bob writes y from
      // `home`, so it would drag the selected tile back out of its forward
      // position (and the receded tiles back toward their old radius) one frame
      // after the tween finished. This is the same class of bug as the
      // position-component clobber in §3.4 — a second writer to the same
      // transform.
      if (this._selected) return;
      for (var i = 0; i < this._tiles.length; i++) {
        var t = this._tiles[i];
        if (t.hovered || t.tween) continue;
        t.el.object3D.position.y = t.home.y + Math.sin(time * 0.0004 + t.driftPhase) * t.driftAmp;
      }
    },

    remove: function () {
      this._tiles.forEach(function (t) { if (t.tween) t.tween.kill(); });
      this._tiles = [];
      this._selected = null;
    }
  });
})();
