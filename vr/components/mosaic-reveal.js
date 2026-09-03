/* ═══ mosaic-reveal.js ═══
   The VR version of the flat site's hero photo effect (see index.html's
   "HERO PHOTO MOSAIC REVEAL" — a grayscale photo with a soft circular hole
   that follows the cursor, revealing a full-color mosaic underneath).

   Here the "cursor" is wherever the visitor is looking (gaze) or pointing
   (controller ray) — a soft brushstroke of color reveals through the gray
   wherever their raycaster hits the panel, using the same feather curve as
   the site (solid through ~55% of the reveal radius, feathered out to 100%).

   Usage: <a-entity mosaic-reveal="gray: url; color: url; width: 1; height: 1"></a-entity>
*/

(function () {
  // glass-material.js registers first (see index.html load order) and owns
  // the one shared light rack — reuse its uniform VALUE objects by reference
  // (see VRGlass.sharedLightUniforms' own comment) so moving/retuning the
  // rack updates this panel too, with no separate state to fall out of sync.
  var LIGHT_MAX = VRGlass.LIGHT_MAX;
  var SHARED_LIGHT = VRGlass.sharedLightUniforms();

  var VERT = [
    'varying vec2 vUv;',
    'varying vec3 vWorld;',
    'varying vec3 vNormal;',
    'void main() {',
    '  vUv = uv;',
    '  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
    '  vNormal = normalize(mat3(modelMatrix) * normal);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');


  // ── Relief vertex shader (opt-in, `relief:` set) ──────────────────────────
  // Same varyings as VERT, but the plane is subdivided and every vertex is
  // pushed BACK along local -z by the baked relief map, so the portrait is a
  // displaced surface instead of a flat quad. R = relief (0 nearest, 1 at the
  // subject's back / the backdrop), G = subject mask, B = silhouette edge.
  //
  // The map is a SHARP (Apple, ml-sharp) single-image 3D-gaussian
  // reconstruction of the contact photo, collapsed to its layer-0 depth. It is
  // metric and life-size at bake time: uReliefDepth is that measured span in
  // metres, scaled by the panel's own magnification. See
  // vr/assets/portrait-bake.json.
  var RELIEF_VERT = [
    'uniform sampler2D tRelief;',
    'uniform float uReliefDepth;',
    'uniform vec2 uReliefTexel;',   // one texel in uv, for the slope difference
    'uniform vec2 uSize;',          // panel size in metres (also declared in FRAG)
    'varying vec2 vUv;',
    'varying vec3 vWorld;',
    'varying vec3 vNormal;',
    'void main() {',
    '  vUv = uv;',
    '  vec3 p = position;',
    '  float r = texture2D(tRelief, uv).r;',
    '  p.z -= r * uReliefDepth;',
    // Normals must be re-derived or the light sheen lights a flat plane that
    // is no longer there. Central difference one texel either side, converted
    // from uv-space slope to metres: x_world = (u - 0.5) * uSize.x, so
    // dr/dx = (r(u+du) - r(u-du)) / (2 * du * uSize.x), and the surface height
    // is h = -r * uReliefDepth, giving n = (dh/dx, dh/dy, 1) negated in z.
    '  float rx = texture2D(tRelief, uv + vec2(uReliefTexel.x, 0.0)).r',
    '            - texture2D(tRelief, uv - vec2(uReliefTexel.x, 0.0)).r;',
    '  float ry = texture2D(tRelief, uv + vec2(0.0, uReliefTexel.y)).r',
    '            - texture2D(tRelief, uv - vec2(0.0, uReliefTexel.y)).r;',
    '  vec3 n = normalize(vec3(',
    '    rx * uReliefDepth / max(2.0 * uReliefTexel.x * uSize.x, 1e-5),',
    '    ry * uReliefDepth / max(2.0 * uReliefTexel.y * uSize.y, 1e-5),',
    '    1.0));',
    '  vNormal = normalize(mat3(modelMatrix) * n);',
    '  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D tGray;',
    'uniform sampler2D tColor;',
    'uniform vec2 revealUv;',
    'uniform float revealRadius;',
    'uniform float revealOn;',
    'uniform vec2 uSize;',        // panel size in metres, for the rounded-corner mask
    'uniform float uCornerRadius;',
    'uniform float uLitAmt;',     // 0 = untouched image (default); >0 dials in the shared light rig, for comparison
    'uniform vec3 uLightPos[' + LIGHT_MAX + '];',
    'uniform vec3 uCamPos;',
    'uniform vec3 uLightColor[' + LIGHT_MAX + '];',
    'uniform vec4 uLightTune;',
    'varying vec2 vUv;',
    'varying vec3 vWorld;',
    'varying vec3 vNormal;',
    'float sdRoundRect(vec2 p, vec2 b, float r){',
    '  vec2 q = abs(p) - b + r;',
    '  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;',
    '}',
    'void main() {',
    // Gentle rounded corners (matches the glass cards' SDF, tiny radius) — a
    // super-subtle softening, not a card-style frame.
    '  vec2 p = (vUv - 0.5) * uSize;',
    '  float rd = sdRoundRect(p, uSize * 0.5, uCornerRadius);',
    '  float shape = 1.0 - smoothstep(-0.0016, 0.0016, rd);',
    '  if (shape <= 0.001) discard;',

    // The source photo is full color — the flat site desaturates it with a
    // CSS filter (grayscale + darken), so we do the same luminance-based
    // conversion here rather than needing a separately-exported gray asset.
    // Kept gentler than the flat site's brightness(0.65): the flat page can
    // rely on surrounding page-white for contrast, this panel sits in a dark
    // dome and reads as needlessly murky at the same value.
    '  vec4 grayColor = texture2D(tGray, vUv);',
    '  float lum = dot(grayColor.rgb, vec3(0.299, 0.587, 0.114));',
    '  vec4 gray = vec4(vec3(lum * 0.84), grayColor.a);',
    // The revealed side is the RAW mosaic artwork, unprocessed — no tint, no
    // rolloff, no vignette. This is deliberately unlike a project thumbnail's
    // `imagetone` grading (BUILD_NOTES ISSUE-07 territory): the point of the
    // reveal is the true piece underneath, not a re-lit version of it.
    '  vec4 color = texture2D(tColor, vUv);',
    '  float dist = distance(vUv, revealUv);',
    '  float t = smoothstep(revealRadius * 0.55, revealRadius, dist);', // 0 near center, 1 past the radius
    '  float mixAmount = revealOn * (1.0 - t);', // how much color shows through

    // Pure, unlit blend FIRST: at mixAmount = 1 this is mathematically exactly
    // `color.rgb` with nothing else added anywhere below — the revealed
    // mosaic gets zero shader effect, guaranteed by the math, not by
    // approximation (Sebastian: "no effects/changes at all" once revealed).
    '  vec3 col = mix(gray.rgb, color.rgb, mixAmount);',

    // The lit sheen is a light touch on the surrounding gray ONLY. Fading it
    // by (1.0 - mixAmount) — rather than blending it INTO the gray before the
    // reveal mix, which is what the previous version did — means it can never
    // bleed into the feathered edge of the reveal circle. That bleed is what
    // read as a strange orange cast/halo right where the vividly-colored
    // mosaic art was becoming visible.
    '  float sheenFade = 1.0 - mixAmount;',
    '  if (uLitAmt > 0.001 && sheenFade > 0.001) {',
    '    vec3 N = normalize(vNormal);',
    '    vec3 V = normalize(uCamPos - vWorld);',
    '    vec3 spec = vec3(0.0);',
    '    for (int i = 0; i < ' + LIGHT_MAX + '; i++) {',
    '      vec3 Lv = uLightPos[i] - vWorld;',
    '      float ldist = length(Lv);',
    '      vec3 L = Lv / max(ldist, 0.0001);',
    '      float atten = 1.0 / (1.0 + ldist * ldist * 0.55);',
    '      vec3 Hv = normalize(L + V);',
    // Deliberately NOT uLightTune.z (40 — tuned for a tight glass hotspot).
    // This panel faces the viewer square-on while the rack sits overhead, so
    // N and V both point roughly at the camera while L points roughly up —
    // at shininess 40 that geometry crushes N·H to ~1e-6 and the effect is
    // invisible no matter the strength multiplier. A much softer, fixed
    // exponent gives a broad, visible sheen instead of a pinprick that only
    // appears from a near-impossible viewing angle.
    '      float ndh = pow(max(dot(N, Hv), 0.0), 6.0);',
    '      spec += uLightColor[i] * ndh * atten;',
    '    }',
    '    col += spec * uLightTune.y * 0.6 * uLitAmt * sheenFade;',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    // ── Output colour space — this is load-bearing, do not remove ──
    // Both textures are tagged SRGBColorSpace, so the GPU hands this shader
    // LINEAR values. three.js injects `linearToOutputTexel` into every
    // ShaderMaterial's fragment prefix but only CALLS it where the shader
    // includes this chunk — and without it we were writing linear values
    // straight to an sRGB framebuffer.
    //
    // That is what made the revealed mosaic read dark and orange: measured
    // [63,16,8] on screen against the file's true [141,78,55], which is
    // exactly sRGB->linear applied once and never undone. Linearisation
    // crushes the darker channels hardest, so it oversaturates and drags
    // everything toward the dominant hue.
    //
    // Using three's own chunk rather than hand-rolled sRGB math so this
    // tracks whatever `renderer.outputColorSpace` is actually set to.
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  // With `relief` unset these return the flat shaders unchanged, byte for byte
  // — the shipped portrait must not move because this option exists.
  function buildVert(hasRelief) {
    return hasRelief ? RELIEF_VERT : VERT;
  }

  function buildFrag(hasRelief) {
    if (!hasRelief) return FRAG;
    // Two splices, both anchors unique in FRAG: declare the relief sampler,
    // and let the silhouette-edge channel fade the stretched skirt where the
    // displaced surface has to span a depth jump.
    return FRAG
      .replace('uniform sampler2D tGray;',
               'uniform sampler2D tGray;\nuniform sampler2D tRelief;\nuniform float uTearFade;')
      .replace('gl_FragColor = vec4(col, 1.0);',
               'gl_FragColor = vec4(col, 1.0 - uTearFade * texture2D(tRelief, vUv).b);');
  }

  AFRAME.registerComponent('mosaic-reveal', {
    schema: {
      gray: { type: 'string' },
      color: { type: 'string' },
      width: { type: 'number', default: 1 },
      height: { type: 'number', default: 1 },
      radius: { type: 'number', default: 0.14 }, // reveal radius in UV units (0-1) — sized to one eye
      // Anchor of the reveal, in the plane's UV space (0,0 = bottom-left).
      // Pinned to the subject's viewer-left eye (contact photo is 682×1024,
      // pupil ≈ 0.37 across, 0.61 up) so the mosaic blooms over ONE eye like
      // the flat site (contact-photo-framed-for-mosaic.jpg), rather than
      // smearing a tiled mosaic across the whole face (VR_BUGFIX item 7).
      eyeu: { type: 'number', default: 0.37 },
      eyev: { type: 'number', default: 0.61 },
      // Super gentle — a hint of softening, not a card-style frame. Defaults
      // scale with the panel's own size so it stays proportional if width/
      // height change.
      cornerRadius: { type: 'number', default: -1 },
      // At 1.0 (the comparison strength used to check this out) it washes
      // the whole face amber and fights the point of a grayscale reveal —
      // Sebastian's call after seeing it. Kept, at a fraction of that.
      litAmt: { type: 'number', default: 0.12 },

      // ── Relief (opt-in). Unset = the flat panel this component has always
      // been; the shaders, the geometry and the material flags are all
      // unchanged in that case.
      //
      // `relief` is a baked map from Apple's SHARP single-image 3D-gaussian
      // reconstruction of the contact photo (vr/assets/portrait-bake.json).
      relief: { type: 'string' },
      // Depth of the box in metres — how far back a relief value of 1 pushes.
      //
      // The map spends its whole 8-bit range on the SUBJECT (near face = 0, the
      // back of his shoulders = 1) and clamps the studio backdrop to 1 as well.
      // The backdrop is really ~0.67 m further back again, but encoding that
      // honestly would leave the face-to-shoulder relief — the part that
      // actually sells the effect — living in the bottom third of the range.
      // The visible cost is that the backdrop sits closer behind him than it
      // did in the room; the gain is precision where the eye is looking, and a
      // shorter stretched skirt at the silhouette.
      //
      // So: the bake measured the subject's own relief at 0.2059 m life-size,
      // and the panel draws the photo 1.144x larger than life (1.08 m tall
      // against the 0.944 m the reconstruction spans). 0.2059 * 1.144 = 0.2355.
      reliefDepth: { type: 'number', default: 0.2355 },
      // Plane subdivision. Chosen by measurement, not by matching the map:
      // rendered at an oblique -30 deg (where displacement shows most) and
      // compared against a 384-segment reference, RMS luminance error over the
      // panel was
      //     384: 0.00   256: 2.56   160: 4.16   128: 4.45
      //      96: 5.99    64: 6.22    48: 7.72    32: 8.69
      // on a 0-255 scale. The curve is flat through 128, so 256 buys 1.9 units
      // (<1%) for 4x the triangles. That trade only gets worse in a headset,
      // where the whole panel is drawn once per eye: at 256 this one portrait
      // is 196,608 triangles against ~9,600 for the entire rest of the scene.
      // 128 is 49,152 - still the heaviest single object here, which is why it
      // is a knob and not a constant.
      reliefSegs: { type: 'number', default: 128 },
      // How hard to fade the stretched skirt where the surface spans a depth
      // jump (the silhouette). 0 leaves it: against this photo's flat seamless
      // backdrop the smear is nearly invisible head-on, and the skirt is
      // geometrically RIGHT for an opaque subject — it just carries smeared
      // texture. Raise it to trade the smear for a soft gap.
      tearFade: { type: 'number', default: 0 }
    },
    init: function () {
      // Anisotropy 8 (three.js clamps to the driver's real max at render
      // time) sharpens the portrait at the oblique angles it's actually
      // viewed from once tilted to face the seated command-zone viewer —
      // addresses the "portrait shows heavy artifacting/pixelation" note in
      // VR_BUGFIX_NOTES.md item 4. The source photo (682×1024) is itself
      // modest resolution — this narrows the gap but can't manufacture detail
      // that isn't in the file; a higher-res export would still read crisper.
      //
      // Through VRGlass.loadTexture, not a bare TextureLoader: that is what
      // maps /images to the downscaled vr/assets/tex derivative and holds these
      // two behind the shared load queue. This component ran its own loader and
      // so was the one photo pair still arriving at full weight — and it is on
      // the home panel, i.e. first in view. It sets colorSpace + anisotropy
      // itself, so only the mosaic's own 8 needs re-asserting on arrival.
      var tGray = VRGlass.loadTexture(this.data.gray, function (t) { t.anisotropy = 8; });
      var tColor = VRGlass.loadTexture(this.data.color, function (t) { t.anisotropy = 8; });
      tGray.anisotropy = 8;
      tColor.anisotropy = 8;

      // The relief map is DATA, not colour. loadTexture tags everything
      // SRGBColorSpace, which would gamma-decode these bytes and silently
      // corrupt every displacement — override it on the returned Texture
      // (set before the image lands, so nothing samples it in the meantime).
      // texUrl() only rewrites '/images/<file>' against VR_TEX, so an
      // 'assets/...' path passes through unmapped, which is what we want:
      // there is no downscaled derivative of a depth map and resampling one
      // through the photo pipeline would blur the silhouette.
      var hasRelief = !!this.data.relief;
      var self = this;
      var tRelief = null;
      if (hasRelief) {
        tRelief = VRGlass.loadTexture(this.data.relief, function (t) {
          t.colorSpace = THREE.NoColorSpace;
          t.anisotropy = 1;
          if (t.image && t.image.width) {
            // Real texel size, so the normal's central difference is a true
            // one-texel step whatever resolution the map was baked at.
            self.material.uniforms.uReliefTexel.value.set(1 / t.image.width, 1 / t.image.height);
          }
          t.needsUpdate = true;
        });
        tRelief.colorSpace = THREE.NoColorSpace;
        tRelief.anisotropy = 1;
      }

      this.material = new THREE.ShaderMaterial({
        uniforms: {
          tGray: { value: tGray },
          tColor: { value: tColor },
          // Pinned to the eye — never follows the pointer across the face now.
          revealUv: { value: new THREE.Vector2(this.data.eyeu, this.data.eyev) },
          revealRadius: { value: this.data.radius },
          revealOn: { value: 0 },
          uSize: { value: new THREE.Vector2(this.data.width, this.data.height) },
          uCornerRadius: {
            value: this.data.cornerRadius >= 0
              ? this.data.cornerRadius
              : Math.min(this.data.width, this.data.height) * 0.03
          },
          uLitAmt: { value: this.data.litAmt },
          tRelief: { value: tRelief },
          uReliefDepth: { value: hasRelief ? this.data.reliefDepth : 0 },
          uReliefTexel: { value: new THREE.Vector2(1 / 512, 1 / 768) },
          uTearFade: { value: this.data.tearFade },
          // Shared by reference with every glass panel — see the top-of-file
          // note. Do NOT clone these.
          uLightPos: SHARED_LIGHT.uLightPos,
          uCamPos: SHARED_LIGHT.uCamPos,
          uLightColor: SHARED_LIGHT.uLightColor,
          uLightTune: SHARED_LIGHT.uLightTune
        },
        vertexShader: buildVert(hasRelief),
        fragmentShader: buildFrag(hasRelief),
        transparent: true,
        // Flat: depthWrite stays off, as every other surface here does
        // (trap 3.6 — this scene draws transparents in scene-graph order).
        // With relief on it MUST write depth, or the mesh cannot occlude
        // itself: the triangles arrive in row order, not depth order, so the
        // far cheek would paint over the near nose. Writing depth only
        // changes what this one mesh does against itself and against things
        // drawn after it, and nothing overlaps the portrait head-on.
        depthWrite: hasRelief
      });

      // A flat panel needs one quad. A displaced one needs enough vertices to
      // resolve the relief map — kept proportional so the triangles stay
      // square on a non-square panel.
      var geometry = hasRelief
        ? new THREE.PlaneGeometry(
            this.data.width, this.data.height,
            this.data.reliefSegs,
            Math.max(1, Math.round(this.data.reliefSegs * this.data.height / this.data.width)))
        : new THREE.PlaneGeometry(this.data.width, this.data.height);
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.el.setObject3D('mosaic-mesh', this.mesh);
      this.el.classList.add('clickable'); // so pointer rays report intersections here (and it's selectable → bio card)

      // Raycasting hits the FLAT grid, because displacement happens in the
      // vertex shader and three's raycaster tests the CPU-side position
      // attribute. So the hit UV is the undisplaced one and drifts from the
      // visible surface as you view the panel more obliquely — which a headset
      // does constantly, unlike a desktop.
      //
      // Left uncorrected on purpose: the error is proportional to displacement,
      // and displacement is ~0 exactly where the reveal lives. The relief map
      // puts the near face at R=0 (no displacement at all) and spends its range
      // pushing the BACKDROP away, so the face is raycast-accurate and the
      // drift is confined to the backdrop, where nothing is aimed at. Revisit
      // if reliefDepth is ever anchored the other way round.

      // The reveal FOLLOWS the gaze/pointer across the portrait again
      // (ISSUE-04): pinning it to one eye and only fading its strength read
      // in-headset as a frozen, non-responsive patch — the whole point is that
      // the colour blooms wherever you actually look. revealUv starts on the
      // eye but is driven to the live hit point each tick below; strength still
      // fades in on gaze / out when the gaze leaves.
      this._targetOn = 0;
      this._currentOn = 0;
    },

    // Which pointer ray to follow: whichever raycaster is currently hitting
    // this portrait (gaze cursor / controller ray / desktop mouse — the one
    // shared "active pointer" model, §4). Read fresh each tick from the
    // raycaster components' own live `intersections`, NOT via the target's
    // events: A-Frame fires `raycaster-intersection` on the RAYCASTER entity,
    // not on the intersected target, so the old `this.el.addEventListener(
    // 'raycaster-intersection')` never fired — the reveal was dead. Polling
    // also gives a *continuously* updating hit point so the reveal follows
    // the gaze across the face, which a one-shot enter/exit event can't.
    _findHitUv: function () {
      if (!this._raycasters) {
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
      return null;
    },

    tick: function (time, delta) {
      // Where is the gaze/pointer ray hitting the portrait right now? (null if
      // no ray is on it.) This is read fresh every frame, so the reveal tracks
      // a moving gaze rather than freezing at one spot (ISSUE-04).
      var hitUv = this._findHitUv();
      this._targetOn = hitUv ? 1 : 0;
      var wasHidden = this._currentOn < 0.06; // captured BEFORE the strength ramp below

      // Reveal STRENGTH eases in/out so it never snaps on or off.
      var lerpAmt = Math.min(1, (delta || 16) / 220);
      this._currentOn += (this._targetOn - this._currentOn) * lerpAmt;
      this.material.uniforms.revealOn.value = this._currentOn;

      // Reveal POSITION follows the live hit point. On first contact (strength
      // still ~0, so nothing is visible yet) snap straight to the gaze point so
      // the mosaic blooms right where you're looking; once it's visible, ease
      // toward the moving gaze so it glides across the face instead of jumping.
      if (hitUv) {
        var uv = this.material.uniforms.revealUv.value;
        if (wasHidden) {
          uv.set(hitUv.x, hitUv.y);
        } else {
          var follow = Math.min(1, (delta || 16) / 90);
          uv.x += (hitUv.x - uv.x) * follow;
          uv.y += (hitUv.y - uv.y) * follow;
        }
      }
    },
    remove: function () {
      this.el.removeObject3D('mosaic-mesh');
    }
  });
})();
