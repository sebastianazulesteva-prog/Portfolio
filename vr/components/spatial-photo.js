/* ═══ spatial-photo.js ═══
   The hero portrait as a SPATIAL PHOTO: a real photograph, one image per eye,
   behind a feathered opening, with the mosaic artwork revealed wherever you
   look.

   WHY THIS ONE
   Sebastian chose it over the relief panel and the gaussians after seeing all
   three in a headset, and the reason holds up: it is the only treatment that
   shows an actual photograph. The relief panel displaces real geometry, so it
   responds to head movement — but one continuous surface has to span the depth
   jump at his hair and shoulders, and it melts there. A stereo pair has no
   geometry to distort, so his face is exactly the photograph.

   What it gives up is the entire motion response. Move your head and nothing
   new is revealed, because there is nothing behind it to reveal. On a flat
   screen it is indistinguishable from an ordinary photo, because a flat screen
   has one eye. All of the depth lives in the disparity between the two images,
   which means all of it lives in a headset. That is the trade, it is inherent
   to the format, and it is not a bug to be fixed later.

   HOW THE EYES ARE SEPARATED
   three.js reserves layers 1 and 2 for this: WebXRManager does
   `cameraL.layers.enable(1)`, `cameraR.layers.enable(2)`, and enables both on
   the ArrayCamera so tagged objects survive the top-level cull and reach the
   per-eye pass (super-three 0.158, WebXRManager.js:50-61). Left plate on layer
   1 alone, right on layer 2 alone. No render targets, no second pass.

   FOUR IMAGES, NOT TWO
   The reveal needs the mosaic warped by the SAME disparity field as the photo.
   Warp only the photo and the revealed mosaic sits at zero disparity — at the
   opening, in front of him — and reads as artwork floating on glass instead of
   as his face becoming a mosaic. Baked by tools/sharp/export_spatial.py.

   Usage: <a-entity spatial-photo></a-entity>   (defaults are the hero's)
*/

(function () {
  var VERT = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D tEye;',        // this eye's photo
    'uniform sampler2D tMosaic;',     // this eye's mosaic, same disparity field
    'uniform float uDesaturate;',
    'uniform vec2 uSize;',
    'uniform float uCornerRadius;',
    'uniform float uEdgeFeather;',
    'uniform float uEdgeDim;',
    'uniform vec2 revealUv;',
    'uniform float revealRadius;',    // metres on the panel
    'uniform float uRevealCore;',
    'uniform float revealOn;',
    'varying vec2 vUv;',
    'float sdRoundRect(vec2 p, vec2 b, float r){',
    '  vec2 q = abs(p) - b + r;',
    '  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;',
    '}',
    'void main() {',
    '  vec2 p = (vUv - 0.5) * uSize;',
    '  float rd = sdRoundRect(p, uSize * 0.5, uCornerRadius);',
    // The border feathers to nothing rather than ending on a rim. A crisp edge
    // reads as a card no matter what is behind it, because a card is the thing
    // that has one; dissolving the boundary leaves an opening.
    '  float aperture = 1.0 - smoothstep(-uEdgeFeather, 0.0, rd);',
    '  if (aperture < 0.02) discard;',

    // Grey photo, matching mosaic-reveal's exact treatment so the flat panel
    // and this one are the same picture. Deliberately lighter than the flat
    // site's brightness(0.65): that page has surrounding white to carry the
    // contrast, this panel hangs in a dark dome and reads murky at that value.
    '  vec3 photo = texture2D(tEye, vUv).rgb;',
    '  float lum = dot(photo, vec3(0.299, 0.587, 0.114));',
    '  vec3 grey = mix(photo, vec3(lum * 0.84), uDesaturate);',

    // The wash, in METRES on the panel rather than in uv. uv distance is
    // anisotropic on anything non-square — on 0.72 x 1.08 a constant-uv
    // "circle" draws 1.5x wider than tall, which is why this never looked
    // like a lens. Radius and the 55% solid core are the flat site's own
    // numbers: radial-gradient(circle 130px ...0% ...55%, black 100%) over a
    // 408 px-wide hero.
    '  float dist = length((vUv - revealUv) * uSize);',
    '  float t = smoothstep(revealRadius * uRevealCore, revealRadius, dist);',
    '  float mixAmount = revealOn * (1.0 - t);',

    // At mixAmount = 1 this is mathematically exactly the mosaic and nothing
    // else — no tint, no rolloff, no lighting. Sebastian's call: "no
    // effects/changes at all" once revealed. Keep it provable, not approximate.
    '  vec3 col = mix(grey, texture2D(tMosaic, vUv).rgb, mixAmount);',
    // ── Falling off, rather than stopping ────────────────────────────────
    // Alpha alone does not dissolve an edge here. This photograph is a bright
    // near-white studio backdrop and it hangs in a near-black dome, so a pure
    // alpha ramp from bright grey to nothing still reads as a gradient BAND
    // with a findable outside edge — a print pinned in space. The flat site
    // never has this problem because it sits on a light page.
    //
    // Dimming the colour along the same curve makes the content itself go
    // away, which is what "feathered into the environment" actually looks
    // like. Over the dome the two multiply, so the falloff is quadratic and
    // there is no locatable boundary at all.
    '  col *= mix(1.0, aperture, uEdgeDim);',
    '  gl_FragColor = vec4(col, aperture);',
    // Load-bearing, trap §3.5: both textures are tagged sRGB so the shader is
    // handed LINEAR values, and without this chunk they reach an sRGB
    // framebuffer unconverted — measurably darker and orange-shifted.
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  AFRAME.registerComponent('spatial-photo', {
    schema: {
      left: { type: 'string', default: 'assets/portrait-eye-L.jpg' },
      right: { type: 'string', default: 'assets/portrait-eye-R.jpg' },
      mosaicLeft: { type: 'string', default: 'assets/portrait-mosaic-eye-L.jpg' },
      mosaicRight: { type: 'string', default: 'assets/portrait-mosaic-eye-R.jpg' },
      width: { type: 'number', default: 0.72 },
      height: { type: 'number', default: 1.08 },
      // ── Border, settled by looking at four of them side by side ─────────
      // I first pushed this to a 55 mm dissolve, reasoning that a feathered
      // border is what makes an opening. It made it worse. A wide ramp from a
      // light studio backdrop into a near-black dome is a visible haze with no
      // edge to it, and the panel read as a glowing smudge rather than as a
      // photograph. Measured, the ramp was clean and monotonic — dome 11 to
      // photo 187 with no overshoot. It was correct and it looked bad.
      //
      // The mistake was the premise. A relief panel is pretending to be an
      // opening you look THROUGH, so it wants its boundary dissolved. A
      // spatial photo is a photograph that has depth; it wants a frame. Apple
      // presents them in a defined, softly rounded rectangle for the same
      // reason. 12 mm is enough to keep the edge from aliasing and no more.
      edgeFeather: { type: 'number', default: 0.012 },
      // A little of the falloff carried by dimming rather than alpha alone, so
      // the border does not look scissored out of the dome. Not enough to glow.
      edgeDim: { type: 'number', default: 0.45 },
      // Negative means "derive from the panel size". 6% of the short edge —
      // more generous than the flat panel's 3%, which was chosen only to stop
      // a corner looking jagged. Here the corner is part of the presentation.
      cornerRadius: { type: 'number', default: -1 },
      cornerFraction: { type: 'number', default: 0.06 },
      desaturate: { type: 'number', default: 1 },
      // Reveal radius in METRES, and the solid-core fraction. Both from the
      // flat site's approved hero — see the shader note above.
      radius: { type: 'number', default: 0.23 },
      revealCore: { type: 'number', default: 0.55 },
      // Drive the wash from the head pose when no pointer is on the panel.
      // This is the whole reason the effect exists in a headset: Vision Pro
      // has no controllers and NO HOVER (§3.13) — a pinch is a one-frame
      // transient pointer — so a wash that follows raycaster.intersections
      // never fires there, while testing perfectly on a monitor. That is
      // exactly how the mosaic reveal shipped broken once already.
      //
      // Not a gaze-fuse violation (hard rule 7): that forbids gaze SELECTING
      // things. This selects nothing and arms nothing. It moves a colour wash.
      gaze: { type: 'boolean', default: true },
      gazeMargin: { type: 'number', default: 0.12 },
      fadeMs: { type: 'number', default: 260 }
    },

    init: function () {
      var d = this.data;
      var radius = d.cornerRadius >= 0
        ? d.cornerRadius
        : Math.min(d.width, d.height) * d.cornerFraction;
      var geo = new THREE.PlaneGeometry(d.width, d.height);

      // ONE set of reveal uniforms, shared BY REFERENCE between both plates, so
      // the two eyes can never disagree about where the wash is. The wash is a
      // property of the surface, not of the eye.
      this.shared = {
        revealUv: { value: new THREE.Vector2(0.5, 0.55) },
        revealRadius: { value: d.radius },
        uRevealCore: { value: d.revealCore },
        revealOn: { value: 0 }
      };

      var self = this;
      function plate(photoUrl, mosaicUrl, layer) {
        function tex(url) {
          var t = VRGlass.loadTexture(url, function (tt) { tt.anisotropy = 8; });
          t.anisotropy = 8;
          return t;
        }
        var mat = new THREE.ShaderMaterial({
          uniforms: {
            tEye: { value: tex(photoUrl) },
            tMosaic: { value: tex(mosaicUrl) },
            uSize: { value: new THREE.Vector2(d.width, d.height) },
            uCornerRadius: { value: radius },
            uEdgeFeather: { value: d.edgeFeather },
            uEdgeDim: { value: d.edgeDim },
            uDesaturate: { value: d.desaturate },
            revealUv: self.shared.revealUv,
            revealRadius: self.shared.revealRadius,
            uRevealCore: self.shared.uRevealCore,
            revealOn: self.shared.revealOn
          },
          vertexShader: VERT,
          fragmentShader: FRAG,
          transparent: true,
          depthWrite: false
        });
        var mesh = new THREE.Mesh(geo, mat);
        // set(), NOT enable(): the plate has to leave layer 0, or both eyes see
        // both plates and the stereo collapses into a double image.
        mesh.layers.set(layer);
        return mesh;
      }

      this.left = plate(d.left, d.mosaicLeft, 1);
      this.right = plate(d.right, d.mosaicRight, 2);
      this.el.setObject3D('eye-left', this.left);
      this.el.setObject3D('eye-right', this.right);

      // ── The hit proxy, and why it is not optional ────────────────────────
      // Both plates left layer 0. A-Frame's raycaster uses a THREE.Raycaster
      // with default layers — layer 0 only — and three tests
      // `object.layers.test(raycaster.layers)` BEFORE calling raycast. So
      // neither plate can ever be hit: no click to toggle the bio card, and no
      // pointer-driven wash. (The lab's comparison tile had exactly this
      // problem and nobody noticed, because a comparison tile is not clicked.)
      //
      // So: one invisible quad on layer 0 that exists only to be hit. three's
      // raycaster does not test `visible` (§3.13 relies on the same fact), so
      // an invisible mesh is still a valid target, and being invisible it
      // costs no draw call.
      this.proxy = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
      this.proxy.visible = false;
      this._installFlatRaycast(this.proxy);
      this.el.setObject3D('hit-proxy', this.proxy);

      this.el.classList.add('clickable');

      // Without this the flat site shows an empty frame: the desktop camera
      // sits on layer 0 and both plates have left it. Layer 1 is the correct
      // mono view of a stereo pair.
      var sceneEl = this.el.sceneEl;
      function showMono() { if (sceneEl.camera) sceneEl.camera.layers.enable(1); }
      if (sceneEl.camera) showMono(); else sceneEl.addEventListener('camera-set-active', showMono);

      this._targetOn = 0;
      this._currentOn = 0;
    },

    // Analytic plane intersection reporting the same fields three would.
    // The quad is 2 triangles so this is not about cost here — it is about
    // returning a correct `uv` for the wash from a mesh that exists only as a
    // hit target, and keeping the proxy honest if it is ever tessellated.
    _installFlatRaycast: function (mesh) {
      var d = this.data;
      var inv = new THREE.Matrix4(), o = new THREE.Vector3(),
          dir = new THREE.Vector3(), hit = new THREE.Vector3();
      var hw = d.width / 2, hh = d.height / 2;
      mesh.raycast = function (raycaster, intersects) {
        inv.copy(mesh.matrixWorld).invert();
        o.copy(raycaster.ray.origin).applyMatrix4(inv);
        dir.copy(raycaster.ray.direction).transformDirection(inv);
        if (Math.abs(dir.z) < 1e-8) return;
        var t = -o.z / dir.z;
        if (t <= 0) return;
        var x = o.x + dir.x * t, y = o.y + dir.y * t;
        if (Math.abs(x) > hw || Math.abs(y) > hh) return;
        hit.set(x, y, 0).applyMatrix4(mesh.matrixWorld);
        var dist = raycaster.ray.origin.distanceTo(hit);
        if (dist < raycaster.near || dist > raycaster.far) return;
        intersects.push({
          distance: dist, point: hit.clone(), object: mesh,
          uv: new THREE.Vector2(x / d.width + 0.5, y / d.height + 0.5),
          face: { a: 0, b: 0, c: 0, normal: new THREE.Vector3(0, 0, 1), materialIndex: 0 },
          faceIndex: 0
        });
      };
    },

    // A live pointer on the panel wins; otherwise fall back to the head pose.
    _findHitUv: function () {
      // Re-query while EMPTY, not just while unset: `[]` is truthy, and the
      // hand raycasters appear when a controller connects — after first tick.
      if (!this._raycasters || !this._raycasters.length) {
        this._raycasters = Array.prototype.slice.call(document.querySelectorAll('[raycaster]'));
      }
      for (var r = 0; r < this._raycasters.length; r++) {
        var rc = this._raycasters[r].components && this._raycasters[r].components.raycaster;
        if (!rc || !rc.intersections) continue;
        for (var i = 0; i < rc.intersections.length; i++) {
          var it = rc.intersections[i];
          if (it.object && it.object.el === this.el && it.uv) return it.uv;
        }
      }
      return this.data.gaze ? this._gazeUv() : null;
    },

    // Where the head is looking, as a uv on this panel. Solved against the
    // panel's plane in its own local space — a divide, not a raycast.
    _gazeUv: function () {
      var cam = this.el.sceneEl && this.el.sceneEl.camera;
      if (!cam) return null;
      if (!this._g) {
        this._g = { o: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion(),
                    inv: new THREE.Matrix4(), uv: new THREE.Vector2() };
      }
      var g = this._g;
      cam.getWorldPosition(g.o);
      g.d.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(g.q)).normalize();
      g.inv.copy(this.el.object3D.matrixWorld).invert();
      g.o.applyMatrix4(g.inv);
      g.d.transformDirection(g.inv);
      if (Math.abs(g.d.z) < 1e-6) return null;
      var t = -g.o.z / g.d.z;
      if (t <= 0) return null;
      var u = (g.o.x + g.d.x * t) / this.data.width + 0.5;
      var v = (g.o.y + g.d.y * t) / this.data.height + 0.5;
      var m = this.data.gazeMargin;
      if (u < -m || u > 1 + m || v < -m || v > 1 + m) return null;
      return g.uv.set(u, v);
    },

    tick: function (time, delta) {
      var hitUv = this._findHitUv();
      this._targetOn = hitUv ? 1 : 0;
      if (hitUv) this.shared.revealUv.value.set(hitUv.x, hitUv.y);

      if (this._currentOn !== this._targetOn) {
        // Reduced motion means "arrives in final state instantly", not
        // "broken" (hard rule 4).
        var step = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          ? 1 : Math.min(1, (delta || 16) / Math.max(1, this.data.fadeMs));
        this._currentOn += (this._targetOn - this._currentOn) * step;
        if (Math.abs(this._targetOn - this._currentOn) < 0.004) this._currentOn = this._targetOn;
        this.shared.revealOn.value = this._currentOn;
      }
    },

    remove: function () {
      // §3.17: removeObject3D frees nothing by itself.
      var keys = ['eye-left', 'eye-right', 'hit-proxy'];
      for (var i = 0; i < keys.length; i++) {
        var o = this.el.getObject3D(keys[i]);
        if (!o) continue;
        this.el.removeObject3D(keys[i]);
        if (o.material) {
          var u = o.material.uniforms;
          if (u) {
            if (u.tEye && u.tEye.value) u.tEye.value.dispose();
            if (u.tMosaic && u.tMosaic.value) u.tMosaic.value.dispose();
          }
          o.material.dispose();
        }
      }
      // One geometry, shared by all three meshes, so it is disposed once.
      if (this.left && this.left.geometry) this.left.geometry.dispose();
      this.left = this.right = this.proxy = null;
    }
  });
})();
