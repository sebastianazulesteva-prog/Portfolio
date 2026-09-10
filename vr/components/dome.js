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

  // ── The horizon band: a crisp LINE inside a dim BLOOM ────────────────────
  // This used to be a single stop pair — dark at 0.42, full horizon colour at
  // 0.50, dark at 0.58 — which made one band that was 29° tall AND full
  // brightness. That fused two jobs which want opposite shapes:
  //
  //   • DEFINING the horizon, so ground and sky are distinguishable and the
  //     floor's edge lands on something (the whole reason dome and floor share
  //     a radius — ISSUE-09). Wants sharpness. Does not want width.
  //   • ATMOSPHERE — the just-after-sunset ember, each project's palette, the
  //     slow hue drift. Wants width and softness. Does not want brightness.
  //
  // Fusing them cost the content: a 29°-tall bright band sits exactly where
  // room text and image captions live, and in the warm themes it washed them
  // out (Bastón's blurb and tags on magenta, screenshotted).
  //
  // So: a ~2.5° core at full colour does the defining, and a wide dim glow out
  // to ±14.4° does the atmosphere. Same silhouette from a distance, but only
  // 2.5° of it is bright enough to compete with text.
  // ── The zenith, and why it is no longer near-black ──────────────────────
  // Sebastian, after a headset pass: *"the dome feels too dark — brighten the
  // upper ceiling colour so it feels more open and outdoor-like."*
  //
  // This was '#050505' — a value chosen when the dome's only job was to be a
  // dark void that stayed out of the content's way, and which does that job
  // very well and reads as a room with the lights off. The thing that makes a
  // real just-after-sunset sky feel like OUTSIDE rather than a ceiling is that
  // the zenith is not black: it is a deep blue holding the last of the light,
  // over a warm horizon. That contrast between a cool top and a warm band is
  // the whole cue, and having neither meant the ember band read as a glowing
  // line in the dark instead of as a sunset.
  //
  // #242f44 is 18x the relative luminance of #050505 (0.0283 vs 0.0015) and
  // still firmly dark — a card's own glass is lighter than the sky behind it,
  // which is the relationship that has to hold. Cool, deliberately, and NOT a
  // contradiction of the warm-only rule above: that rule governs the HORIZON
  // drift, which used to swing to blue/violet and made the sunset itself read
  // cold. A cool zenith over a warm horizon is the opposite arrangement.
  //
  // The gradient runs zenith -> FEATHER just above the band, so this lifts the
  // whole upper hemisphere on a ramp and leaves the darkness immediately around
  // the ember band untouched. FEATHER is deliberately NOT lifted with it: it is
  // what gives the band its edge, and raising it would dissolve the horizon
  // this dome is built around.
  //
  // Matched to themes.js's own 0.028 luminance target so the hub and the five
  // rooms have the same ceiling brightness — the first version of this lifted
  // the hub to 0.0103 and the rooms to 0.028, which would have made every room
  // read as OPENING OUT relative to the dome it is reached from, for no reason
  // anyone could have named.
  var ZENITH = '#242f44';

  var FEATHER = '#0a0908';
  var CORE_HALF = 0.007;   // of texture height; x180° = 2.5° of elevation
  var RAMP_HALF = 0.013;   // core -> bloom shoulder
  var BLOOM_HALF = 0.03;   // bloom plateau
  var EDGE_HALF = 0.08;    // bloom -> feather; x180° = 14.4°, as before
  var ZENITH_PLATEAU = 0.222;  // x180° = 40° of elevation; above this the sky is flat ZENITH
  var BLOOM_NEAR = 0.55;   // shoulder brightness, toward the horizon colour
  var BLOOM_FAR = 0.22;    // plateau brightness

  function paintDomeTexture(canvas, topColor, horizonColor) {
    var ctx = canvas.getContext('2d');
    var h = canvas.height;
    var near = lerpColor(FEATHER, horizonColor, BLOOM_NEAR);
    var far = lerpColor(FEATHER, horizonColor, BLOOM_FAR);
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, topColor);
    // ── The ceiling is a PLATEAU, not a point ────────────────────────────
    // The zenith colour used to be one stop at the pole, ramping all the way
    // down to FEATHER by 14.4° — so it was at full strength only where you
    // have to tip your head right back, and a normal forward look saw almost
    // none of it. Lifting the number alone therefore did very little to the
    // thing being complained about. Holding it flat from 40° up puts the whole
    // upper half of the dome at the lifted colour and leaves the ramp to do its
    // job over the last 25°, which is where a real sky's gradient lives anyway.
    // Below ZENITH_PLATEAU nothing changes, so the ember band's surround is
    // untouched and the band measures exactly as before.
    grad.addColorStop(0.5 - ZENITH_PLATEAU, topColor);
    grad.addColorStop(0.5 - EDGE_HALF, FEATHER);
    grad.addColorStop(0.5 - BLOOM_HALF, far);
    grad.addColorStop(0.5 - RAMP_HALF, near);
    grad.addColorStop(0.5 - CORE_HALF, horizonColor);
    grad.addColorStop(0.5 + CORE_HALF, horizonColor);
    grad.addColorStop(0.5 + RAMP_HALF, near);
    grad.addColorStop(0.5 + BLOOM_HALF, far);
    grad.addColorStop(0.5 + EDGE_HALF, FEATHER);
    grad.addColorStop(0.5 + ZENITH_PLATEAU, topColor);
    grad.addColorStop(1, topColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, h);
  }

  // Published so nothing has to hand-copy these. project-room.js keeps its
  // text off the band and used to carry its own `BAND_DEG = 14.4` — a second
  // copy of a number that lives here, exactly the kind of duplication that let
  // this file's light values drift out of sync with index.html's before.
  // CORE is what text actually has to avoid now; BLOOM is dim enough to read
  // over with the standard halo.
  window.VRDome = {
    BAND_CORE_DEG: CORE_HALF * 180,
    BAND_RAMP_DEG: RAMP_HALF * 180,
    BAND_BLOOM_DEG: EDGE_HALF * 180
  };

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
      paintDomeTexture(canvas, ZENITH, HORIZON_HUES[0]);
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
      paintDomeTexture(this.canvas, ZENITH, HORIZON_HUES[0]);
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
      paintDomeTexture(this.canvas, ZENITH, color);
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
