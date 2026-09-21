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
     dusk-sky   — the gradient skybox with a slow horizon hue drift, and the
                  skylight aperture cut into it (skylight.js drives it)
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

  // ── The skylight aperture (skylight.js) ──────────────────────────────────
  // Sebastian asked for a button that "cuts the top 3rd of the dome" and
  // reveals a sunny sky behind it, then — having seen it — for the roof to
  // open LOWER, "like half the way".
  //
  // Read literally, half the dome's HEIGHT is the cap above y = R/2, i.e.
  // latitude 30°, i.e. (90−30)/180 = 0.3333 of this texture's height down from
  // the zenith. The room does not allow it, and the measurement is here so
  // nobody re-derives it:
  //
  //   Latitude is not what a visitor sees. From the seated eye at y=1.6 on a
  //   radius-40 sphere, latitude θ APPEARS at atan((40·sinθ − 1.6)/(40·cosθ)).
  //   So latitude 41.81° (the original "top third") appears at 40.1°, and
  //   latitude 30° appears at just 28.0°.
  //
  //   Measured against that, the highest things in the hub are the hero title
  //   at 34.4° of apparent elevation (bounding box top y=2.61, 1.5 m ahead),
  //   the photo cloud at 31.4°, and the projects and writing constellations at
  //   29.8°. Screenshotted at `?cut=30`, the cut does run through the title:
  //   the top halves of the letters stand against bright sky while the rest
  //   stay on the dark dome, a split background through the middle of the hero
  //   type, and the sky-side halves are barely legible.
  //
  //   DO NOT pick this angle from that bounding box. It overestimates the
  //   title by 2–3°, because `name-scatter-3d`'s box covers the whole entity
  //   rather than the visible glyphs. Going by the box alone would have parked
  //   the cut at latitude 38 for a title that is actually clear at 34 — a
  //   4° tax on the thing Sebastian asked to make bigger.
  //
  //   34 is therefore VERIFIED rather than derived: rendered at 30 (cuts the
  //   title), 33 and 36 (both clear), and then at 34 with `a11yMode` on, which
  //   is the worst case because accessible type scales ×1.25 and the title
  //   grows upward with it. Clear there too, with room. If the title ever
  //   moves, re-shoot it — don't re-derive it. `?cut=<latitude>` is the knob.
  //
  // Two consequences of coming down from 41.81°, both real:
  //
  //   * The cut used to land INSIDE ZENITH_PLATEAU (0.222 → latitude 40°),
  //     where the sky is flat ZENITH, so it removed only uniform colour and
  //     the rim of the hole was one clean tone. It now lands in the
  //     topColor→FEATHER ramp, so the rim is a slightly darker slice of that
  //     ramp. That reads fine — a darker lip against bright sky — but the old
  //     invariant is gone, so do not rely on it.
  //   * The ember band is still untouched. The cut reaches 0.311 of the
  //     texture and FEATHER does not begin until 0.42, so the band, its bloom
  //     and the whole gradient below still measure exactly as recorded.
  //   * The light rack's housings (41.1° and 50.3° apparent) are now INSIDE
  //     the hole rather than on its rim, which is part of why skylight.js
  //     fades them to nothing while the roof is open.
  //
  // It is painted into the ALPHA of a canvas that is already repainted for the
  // horizon drift, so the cut costs one extra gradient fill on a 2×512 canvas
  // and no new geometry at all. Feathering is free, which a geometric cut
  // (thetaStart on the sphere) would not have been.
  //
  // The material below is transparent and depth-free for this: it is now the
  // MASK over skylight.js's daylight layer, not an opaque backdrop. See the
  // paint-order note in skylight.js's build() for the full chain.
  var CUT_LATITUDE_DEG = 34;
  var CUT_FRAC = (90 - CUT_LATITUDE_DEG) / 180;
  var CUT_FEATHER = 0.013;   // ×180° = 2.4° of softness on the cut edge

  // ?cut=<latitude in degrees> — try another aperture without editing this
  // file. 30 is the literal "half the dome" that the hero title rules out; 90
  // is no hole at all. Clamped, because a value outside (0,90) makes the
  // gradient stops non-monotonic and Canvas throws on addColorStop.
  (function () {
    var q = new URLSearchParams(location.search).get('cut');
    if (q == null) return;
    var v = parseFloat(q);
    if (!isFinite(v)) return;
    CUT_LATITUDE_DEG = Math.max(1, Math.min(89, v));
    CUT_FRAC = (90 - CUT_LATITUDE_DEG) / 180;
    console.info('[vr] dome: cut latitude forced to ' + CUT_LATITUDE_DEG +
                 '° by ?cut (appears at ' +
                 (Math.atan2(40 * Math.sin(CUT_LATITUDE_DEG * Math.PI / 180) - 1.6,
                             40 * Math.cos(CUT_LATITUDE_DEG * Math.PI / 180)) * 180 / Math.PI).toFixed(1) +
                 '° from a seated eye)');
  })();

  function paintDomeTexture(canvas, topColor, horizonColor, aperture) {
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

    // ── Punch the aperture ──────────────────────────────────────────────────
    // The fill above is fully opaque and source-over, so it restores any hole
    // a previous frame punched — every repaint starts from a whole dome and
    // re-cuts it. That is what keeps this idempotent while the horizon drift,
    // a room's retint and the iris tween all repaint the same canvas.
    //
    // `destination-out` with an alpha ramp erases rather than draws, which is
    // the only way to get a feathered edge; a hard clip would alias along a
    // 60-metre circle.
    if (aperture > 0) {
      var cut = aperture * CUT_FRAC;
      var solid = cut - CUT_FEATHER;
      ctx.globalCompositeOperation = 'destination-out';
      var punch = ctx.createLinearGradient(0, 0, 0, h);
      punch.addColorStop(0, 'rgba(0,0,0,1)');
      // Early in the iris the hole is narrower than the feather itself, so the
      // feather has to collapse into it rather than push the stops out of
      // order — addColorStop offsets must be non-decreasing.
      if (solid > 0) punch.addColorStop(solid, 'rgba(0,0,0,1)');
      punch.addColorStop(cut, 'rgba(0,0,0,0)');
      punch.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = punch;
      ctx.fillRect(0, 0, canvas.width, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ── The dome brightens while the roof is open ─────────────────────────────
  // Daylight pouring through a 60-metre hole lands on the inside of the dome,
  // so leaving the walls at their dusk value would read as a lit sky pasted
  // into an unlit room. Only a partial lift, and the number is not a taste
  // call: the relationship that has to hold is that a card's own glass stays
  // LIGHTER than the sky behind it (see the ZENITH note above, which matches
  // themes.js's 0.028 luminance target). #242f44 is Y = 0.0283; mixing 30% of
  // the way to #4a5f7e gives #2f3b53 at Y = 0.042 — half again as bright,
  // plainly lit, and still well under the glass. 55% was tried first and
  // measured 0.065, which is 2.3× and starts eating the cards' contrast.
  var SUNLIT_TOP = '#4a5f7e';
  var SUNLIT_MIX = 0.30;

  function litTop(topColor, aperture) {
    if (!aperture) return topColor;
    return lerpColor(topColor, SUNLIT_TOP, SUNLIT_MIX * aperture);
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
    BAND_BLOOM_DEG: EDGE_HALF * 180,
    // Elevation above which the skylight cuts away. Published so skylight.js
    // can size its cloud decks against the real number instead of keeping a
    // second copy of it — the visible ground radius of a deck at altitude H is
    // H / tan(CUT_ELEV_DEG), and that is what decides where the drift may wrap.
    CUT_ELEV_DEG: 90 - CUT_FRAC * 180
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
      // Transparent, depth-free, and first in the transparent pass — see the
      // CUT_FRAC block above. This used to be an opaque backdrop; it is now the
      // mask that hides skylight.js's daylight layer everywhere except the
      // hole, which is what lets a cloud deck hang at 30 m INSIDE this 40 m
      // sphere without showing through the walls. Where the alpha is 1 the
      // blend is src·1 + dst·0, i.e. identical to the opaque version, so the
      // closed dome renders exactly as before.
      //
      // depthWrite off because nothing in the scene is farther than this and
      // nothing should depth-test against it; renderOrder −1 because with
      // A-Frame's sortTransparentObjects:false (guide §3.6) renderOrder is the
      // only lever that reliably orders transparent draws.
      var material = new THREE.MeshBasicMaterial({
        map: this.texture, side: THREE.BackSide, fog: false,
        transparent: true, depthWrite: false
      });
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.renderOrder = -1;
      this.el.setObject3D('dusk-sky', this.mesh);

      this._themeOverride = null; // set via setTheme() when a project room is open
      this._aperture = 0;         // set via setAperture() by skylight.js
      this._startTime = performance.now();
      this.repaint();
    },

    // Every repaint goes through here so the three things that own a piece of
    // this canvas — the horizon drift, a room's theme, and the skylight cut —
    // can never clobber each other's contribution. Each one sets its own field
    // and calls this.
    repaint: function () {
      var top = this._themeOverride ? this._themeOverride.top : ZENITH;
      var horizon = this._themeOverride ? this._themeOverride.horizon : this._driftHue;
      paintDomeTexture(this.canvas, litTop(top, this._aperture),
                       horizon || HORIZON_HUES[0], this._aperture);
      this.texture.needsUpdate = true;
    },

    // Driven by skylight.js's iris tween: 0 = whole dome, 1 = top third cut
    // away. Cheap enough to call every frame (one 2×512 canvas fill and a
    // 1 KB texture upload — the horizon drift already does the same thing five
    // times a second).
    setAperture: function (a) {
      a = Math.max(0, Math.min(1, a || 0));
      if (a === this._aperture) return;
      this._aperture = a;
      this.repaint();
    },
    // Project-room world-transform (§7): retint the whole dome to that
    // project's palette. No drift while a theme is active — a themed room
    // should read as calm and settled, not still cycling the dusk hue.
    setTheme: function (topColor, horizonColor) {
      this._themeOverride = { top: topColor, horizon: horizonColor };
      this.repaint();
    },
    clearTheme: function () {
      this._themeOverride = null;
      this.repaint();
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
      this._driftHue = lerpColor(HORIZON_HUES[i], HORIZON_HUES[i + 1], t);
      this.repaint();
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

    // ── A pool of light on the ground ───────────────────────────────────────
    // Sebastian, looking at a finished room: *"it's not very wow."* The frames
    // were good, the pictures were big, the type was fixed, and it still read
    // as a gallery wall floating in black — because below the horizon there
    // was nothing. `panel` painted all 40 m of floor ONE flat unlit colour, so
    // there was no ground under you and nothing behind the ring.
    //
    // This paints the same mesh with a radial gradient instead: warm where you
    // stand, falling away into the room's own dark. No new geometry, nothing
    // transparent, and the floor is opaque and drawn before everything else —
    // so none of the scene-graph sort hazards (§3.6) are in play.
    //
    // THE OUTER STOP IS EXACTLY `base`, which is not a detail. The floor's rim
    // has to keep landing on the dome's horizon band or a dark seam opens
    // between ground and sky at the one place the whole shared-radius contract
    // exists to close (ISSUE-09). Ending the gradient on the same colour the
    // flat floor used means the rim is unchanged by construction rather than
    // by measurement.
    //
    // CircleGeometry's UVs put the centre at (0.5, 0.5) and the rim at UV
    // radius 0.5, so one metre is 0.5/DOME_RADIUS in UV — which is why the
    // pool occupies such a small fraction of the texture and why it is drawn
    // at 1024 with a smooth multi-stop ramp. A tight two-stop gradient over
    // ~150 px bands visibly on a surface this large.
    setPool: function (base, lift, worldRadius, strength) {
      var S = 1024;
      if (!this._poolCanvas) {
        this._poolCanvas = document.createElement('canvas');
        this._poolCanvas.width = this._poolCanvas.height = S;
        this._poolTex = new THREE.CanvasTexture(this._poolCanvas);
        this._poolTex.colorSpace = THREE.SRGBColorSpace;
      }
      var ctx = this._poolCanvas.getContext('2d');
      var c = S / 2;
      var px = (worldRadius / DOME_RADIUS) * c;   // world metres -> texture px
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, S, S);
      var g = ctx.createRadialGradient(c, c, 0, c, c, Math.max(8, px));
      var k = Math.max(0, Math.min(1, strength == null ? 1 : strength));
      // Eased rather than linear: a linear ramp reads as a visible disc edge,
      // and the point is a pool that has no edge at all.
      [[0, 1], [0.25, 0.72], [0.5, 0.40], [0.75, 0.16], [1, 0]].forEach(function (st) {
        g.addColorStop(st[0], lerpColor(base, lift, st[1] * k));
      });
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      this._poolTex.needsUpdate = true;
      this.mesh.material.color.set('#ffffff');   // the map carries the colour now
      this.mesh.material.map = this._poolTex;
      this.mesh.material.needsUpdate = true;
    },

    resetColor: function () {
      // Back to the hub's flat floor: drop the map as well as the colour, or
      // the dome keeps a room's pool under it after you leave.
      if (this.mesh.material.map) {
        this.mesh.material.map = null;
        this.mesh.material.needsUpdate = true;
      }
      this.mesh.material.color.set(this._baseColor);
    },

    remove: function () {
      if (this._poolTex) this._poolTex.dispose();
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
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
