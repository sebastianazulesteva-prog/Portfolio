/* ═══ reticle.js ═══
   The VR cursor, matched to the flat site's custom cursor (index.html's
   `.cursor` dot + `.cursor-ring`): a small solid dot with a thin ring around
   it that GROWS and BRIGHTENS whenever the pointer is over something
   interactive, and eases back when it isn't. On the flat site the ring goes
   36px → 56px and its border 0.3 → 0.5 opacity on hover over any link/button,
   over a 0.3s transition. This reproduces that feel on the in-scene reticle
   (the "white thing in front of the person"), driven by the same generic
   hover events A-Frame's cursor already fires when its ray enters/leaves a
   `.clickable`.

   Depth: rather than sitting at a fixed 1 m in front of the face regardless
   of what's being pointed at (which reads as floating, detached from near
   or far targets), the reticle reads its own raycaster's nearest
   intersection each tick and eases its depth to match — landing on the
   actual surface. With no intersection it eases back to the BASE_DEPTH
   resting distance. The whole dot+ring group is scaled by depth/BASE_DEPTH
   so its apparent (angular) size stays constant regardless of how far away
   it's currently sitting — otherwise it'd shrink to a speck on distant
   panels and balloon up close.

   Select feedback: a brief outward pulse + opacity flash on `click`, since
   selection everywhere requires an explicit click/tap/trigger/pinch
   (fuse: false — nothing opens from just looking) and hover-grow alone
   didn't give the moment of selection its own feedback.

   Attach to the cursor entity itself (the one with the `cursor` +
   `raycaster` components):
     <a-entity cursor raycaster reticle> ... </a-entity>
   It builds its own dot+ring meshes, so the entity no longer needs its own
   geometry/material.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Rest / hover sizes as ring outer radii (metres, at BASE_DEPTH). Same
  // ~1.55× growth ratio as the flat site's 36→56 px.
  var REST_OUTER = 0.009, HOVER_OUTER = 0.014;
  var RING_THICKNESS = 0.003;
  var REST_OPACITY = 0.5, HOVER_OPACITY = 0.9;

  // Depth the rest/hover sizes above were tuned at, and where the reticle
  // rests when nothing is intersected. MAX_DEPTH matches the raycaster's
  // `far` in index.html: clamping nearer than that would park the reticle
  // in front of a distant panel rather than on it, and the whole point of
  // depth-following is to avoid exactly that vergence mismatch. MIN_DEPTH
  // is a guard against a hit right at the camera's near plane (0.05).
  //
  // NOTE: this assumes the host entity sits AT the eye (no position offset)
  // — see the comment on the cursor entity in index.html.
  var BASE_DEPTH = 1, MIN_DEPTH = 0.35, MAX_DEPTH = 20;

  // Select-pulse: extra outer radius + opacity added on top of the hover
  // state, decaying back to 0 over PULSE_MS.
  var PULSE_OUTER_BOOST = 0.006, PULSE_OPACITY_BOOST = 0.4, PULSE_MS = 180;

  AFRAME.registerComponent('reticle', {
    init: function () {
      var group = new THREE.Group();

      // Solid center dot (the flat site's `.cursor`).
      this.dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.0018, 16),
        new THREE.MeshBasicMaterial({ color: '#f5f5f0', transparent: true, opacity: 0.9, depthTest: false })
      );
      // Ring (the flat site's `.cursor-ring`). RingGeometry is rebuilt on
      // hover-scale rather than scaled, so the ring's stroke stays a constant
      // thickness instead of fattening as it grows (matches the CSS border,
      // which keeps its 1px width while width/height animate).
      this.ringMat = new THREE.MeshBasicMaterial({ color: '#f5f5f0', transparent: true, opacity: REST_OPACITY, depthTest: false, side: THREE.DoubleSide });
      this.ring = new THREE.Mesh(this._ringGeo(REST_OUTER), this.ringMat);

      group.add(this.dot);
      group.add(this.ring);
      group.renderOrder = 999; // draw on top of everything (depthTest is off too)
      this.dot.renderOrder = 1000;
      this.ring.renderOrder = 1000;
      // Start at the resting depth rather than at 0 (the eye), so there's no
      // one-frame flash at the camera before the first tick positions it.
      group.position.z = -BASE_DEPTH;
      this.el.setObject3D('reticle', group);

      this._outer = REST_OUTER;
      this._targetOuter = REST_OUTER;
      this._builtOuter = REST_OUTER; // radius the current RingGeometry was built at
      this._opacity = REST_OPACITY;
      this._targetOpacity = REST_OPACITY;
      this._depth = BASE_DEPTH;
      this._targetDepth = BASE_DEPTH;
      this._pulse = 0;

      // A-Frame's cursor fires mouseenter/mouseleave on THIS entity as its ray
      // enters/leaves a clickable — the same generic hover signal the flat
      // site listens to on `a, button`.
      this._onEnter = function () {
        // Both branches of a `reducedMotion ? HOVER_OUTER : HOVER_OUTER`
        // ternary used to sit here. Reduced motion is already honoured by the
        // instant easing constant (k = reducedMotion ? 1 : ...) and the pulse
        // guard further down, so the hover size is the same either way.
        this._targetOuter = HOVER_OUTER;
        this._targetOpacity = HOVER_OPACITY;
      }.bind(this);
      this._onLeave = function () {
        this._targetOuter = REST_OUTER;
        this._targetOpacity = REST_OPACITY;
      }.bind(this);
      this._onClick = function () {
        this._pulse = 1;
      }.bind(this);
      this.el.addEventListener('mouseenter', this._onEnter);
      this.el.addEventListener('mouseleave', this._onLeave);
      this.el.addEventListener('click', this._onClick);
    },

    _ringGeo: function (outer) {
      return new THREE.RingGeometry(outer - RING_THICKNESS, outer, 32);
    },

    tick: function (time, delta) {
      var dt = delta || 16;
      var k = reducedMotion ? 1 : Math.min(1, dt / 120); // ~matches the site's 0.3s ease

      // Depth: follow this entity's own raycaster to its nearest
      // intersection, resting at BASE_DEPTH when there isn't one.
      var raycaster = this.el.components.raycaster;
      var intersections = raycaster && raycaster.intersections;
      this._targetDepth = (intersections && intersections.length)
        ? Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, intersections[0].distance))
        : BASE_DEPTH;
      this._depth += (this._targetDepth - this._depth) * k;

      this._outer += (this._targetOuter - this._outer) * k;
      this._opacity += (this._targetOpacity - this._opacity) * k;

      // Select-pulse decays independently of the hover ease, over PULSE_MS.
      this._pulse -= (reducedMotion ? 1 : dt / PULSE_MS);
      if (this._pulse < 0) this._pulse = 0;

      // Compare against what the geometry was actually last BUILT at, not
      // against the pre-ease radius — otherwise the pulse's final frames
      // leave the ring permanently a hair oversized (it stops rebuilding
      // while the boost is still non-zero).
      var outer = this._outer + PULSE_OUTER_BOOST * this._pulse;
      if (Math.abs(outer - this._builtOuter) > 0.00005) {
        this.ring.geometry.dispose();
        this.ring.geometry = this._ringGeo(outer);
        this._builtOuter = outer;
      }
      this.ringMat.opacity = Math.min(1, this._opacity + PULSE_OPACITY_BOOST * this._pulse);

      // Reposition at the eased depth and rescale the whole dot+ring group
      // so its apparent size stays constant regardless of depth.
      var group = this.el.getObject3D('reticle');
      if (group) {
        group.position.z = -this._depth;
        group.scale.setScalar(this._depth / BASE_DEPTH);
      }
    },

    remove: function () {
      this.el.removeObject3D('reticle');
      this.el.removeEventListener('mouseenter', this._onEnter);
      this.el.removeEventListener('mouseleave', this._onLeave);
      this.el.removeEventListener('click', this._onClick);
    }
  });
})();
