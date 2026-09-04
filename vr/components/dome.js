/* ═══ dome.js ═══
   The dusk dome — the base world visitors land in (§8 of VR_BUILD_SPEC.md).

   Tried aframe-environment-component for the sky first (per
   VR_DESIGN_RESOURCES.md §1) — its gradient shader renders as flat black
   overhead-to-horizon in testing here (traced it to the shader's own
   `pow(h,0.8)` falloff combined with how this A-Frame/three.js build handles
   color management for bundled ShaderMaterials; couldn't resolve it from
   outside the minified bundle without disproportionate time cost). Reverted
   to this hand-rolled canvas-gradient sky, which is verified working:
   deep near-black overhead easing down to a low, thin, warm ember band at
   the horizon, with a slow horizon-only hue drift.

   Registers:
     dusk-sky   — the gradient skybox with a slow horizon hue drift
     dusk-floor — a plain, solid-color matte floor
     dusk-rug   — a subtly lighter "carpet" circle under the visitor, for groundedness
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The sky sphere and the floor disc MUST share this radius. The floor's edge
  // then sits exactly on the sky's horizon (the ember band painted at the
  // sphere's equator, y=0). Both are fixed circles in world space at (r=R,
  // y=0), so they coincide from ANY eye height — the ground always meets the
  // glowing horizon whether the visitor is seated or standing, with no dark
  // wedge of lower-hemisphere sky peeking between the horizon and the ground
  // (ISSUE-09). Previously the floor was radius 20 against a radius-40 dome, so
  // downward gaze overshot the small floor and struck the dark dome wall — a
  // seam that widened as the head rose. Keep them equal here forever.
  var DOME_RADIUS = 40;

  // Warm-only drift — deep amber → copper → rose-gold ember and back. The
  // earlier palette dipped into cool blue/violet, which read as the exact
  // "purple/magenta bleed" the polish pass calls out (§A.3); kept warm here so
  // the horizon always feels like just-after-sunset, never a cold cast.
  var HORIZON_HUES = ['#3a2418', '#432619', '#3d1e18', '#3a2418'];
  var DRIFT_DURATION_MS = 90000;

  function lerpColor(a, b, t) {
    var ca = new THREE.Color(a), cb = new THREE.Color(b);
    return '#' + ca.lerp(cb, t).getHexString();
  }

  function paintDomeTexture(canvas, topColor, horizonColor) {
    var ctx = canvas.getContext('2d');
    var h = canvas.height;
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, topColor);
    grad.addColorStop(0.42, '#0a0908');
    grad.addColorStop(0.5, horizonColor);
    grad.addColorStop(0.58, '#0a0908');
    grad.addColorStop(1, topColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, h);
  }

  AFRAME.registerComponent('dusk-sky', {
    init: function () {
      var canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 512;
      this.canvas = canvas;
      this.texture = new THREE.CanvasTexture(canvas);
      // Canvas is painted with plain sRGB hex colors (like CSS) — tag it so
      // the color-managed renderer doesn't treat the raw bytes as linear
      // light and wash near-black values out into grey.
      this.texture.colorSpace = THREE.SRGBColorSpace;

      var geometry = new THREE.SphereGeometry(DOME_RADIUS, 64, 48);
      var material = new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.BackSide, fog: false });
      this.mesh = new THREE.Mesh(geometry, material);
      this.el.setObject3D('dusk-sky', this.mesh);

      this._themeOverride = null; // set via setTheme() when a project room is open
      this._startTime = performance.now();
      paintDomeTexture(canvas, '#050505', HORIZON_HUES[0]);
      this.texture.needsUpdate = true;
    },
    // Project-room world-transform (§7): retint the whole dome to that
    // project's palette. No drift while a theme is active — a themed room
    // should read as calm and settled, not still cycling the dusk hue.
    setTheme: function (topColor, horizonColor) {
      this._themeOverride = { top: topColor, horizon: horizonColor };
      paintDomeTexture(this.canvas, topColor, horizonColor);
      this.texture.needsUpdate = true;
    },
    clearTheme: function () {
      this._themeOverride = null;
      paintDomeTexture(this.canvas, '#050505', HORIZON_HUES[0]);
      this.texture.needsUpdate = true;
    },
    tick: function () {
      if (reducedMotion || this._themeOverride) return;
      var now = performance.now();
      if (this._lastPaint && now - this._lastPaint < 200) return;
      this._lastPaint = now;

      var elapsed = (now - this._startTime) % (DRIFT_DURATION_MS * (HORIZON_HUES.length - 1));
      var segment = elapsed / DRIFT_DURATION_MS;
      var i = Math.floor(segment);
      var t = segment - i;
      var color = lerpColor(HORIZON_HUES[i], HORIZON_HUES[i + 1], t);
      paintDomeTexture(this.canvas, '#050505', color);
      this.texture.needsUpdate = true;
    },
    remove: function () {
      this.el.removeObject3D('dusk-sky');
    }
  });

  AFRAME.registerComponent('dusk-floor', {
    init: function () {
      // MeshBasicMaterial (unlit), not MeshStandardMaterial — this is a
      // stylized dark-void floor, not a surface meant to catch realistic
      // light; the PBR version showed uneven per-light shading/banding
      // across such a large flat circle (VR_BUGFIX_NOTES.md item 10). A flat
      // unlit color reads cleaner and is cheaper. Fog stays on for depth.
      // Radius matches the dome so the floor edge lands on the horizon/ember
      // circle (see DOME_RADIUS note) — no dark seam between ground and dome at
      // any posture (ISSUE-09). Dropped a hair below y=0 so its rim tucks just
      // under the dome's equator: the ember horizon reads cleanly just above
      // the ground line, with no coincident-plane z-fighting along that circle.
      var geometry = new THREE.CircleGeometry(DOME_RADIUS, 64);
      var material = new THREE.MeshBasicMaterial({ color: '#0c0b0a' });
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.position.y = -0.02;
      this.el.setObject3D('dusk-floor', this.mesh);
      this._baseColor = '#0c0b0a';
    },
    setColor: function (hex) { this.mesh.material.color.set(hex); },
    resetColor: function () { this.mesh.material.color.set(this._baseColor); },
    remove: function () {
      this.el.removeObject3D('dusk-floor');
    }
  });

  // A softly-lit "rug" under the visitor's feet — a subtly warmer, lighter
  // circle than the surrounding floor, so the space you're standing in reads
  // as a grounded, specific place rather than an infinite plane.
  AFRAME.registerComponent('dusk-rug', {
    schema: { radius: { type: 'number', default: 1.3 } },
    init: function () {
      // Same MeshBasicMaterial swap as dusk-floor, for the same reason —
      // a consistent, clean flat-void look (item 10).
      var geometry = new THREE.CircleGeometry(this.data.radius, 48);
      var material = new THREE.MeshBasicMaterial({ color: '#1a140f' });
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.position.y = 0.002; // avoid z-fighting with the floor beneath
      this.el.setObject3D('dusk-rug', this.mesh);
      this._baseColor = '#1a140f';
      this._baseRadius = this._radius = this.data.radius;
    },
    // Themed per project room (project-room.js). The rug used to be the one
    // ground surface a room DIDN'T retint, which left the hub's dark brown
    // disc sitting on a room's own floor colour — invisible on the dark
    // themes and a stain on the near-white one.
    setColor: function (hex) { this.mesh.material.color.set(hex); },
    resetColor: function () { this.mesh.material.color.set(this._baseColor); },
    // Rooms vary the rug's size to vary how large the space you're standing in
    // FEELS (a jewellery case vs a vehicle bay). Circles only, on purpose —
    // this entity does not rotate with the room, so a non-round footprint
    // would sit at an arbitrary angle to it; see the note in themes.js.
    // Radius means new geometry, and three.js never auto-disposes (guide
    // §3.17): drop the old one here or every room visit orphans a buffer.
    setRadius: function (r) {
      if (!r || r === this._radius) return;
      this._radius = r;
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.CircleGeometry(r, 48);
    },
    resetRadius: function () { this.setRadius(this._baseRadius); },
    remove: function () {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.el.removeObject3D('dusk-rug');
    }
  });
})();
