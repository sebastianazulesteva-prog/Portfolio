/* ═══ parallax-photo.js ═══
   A fourth way to give a flat photograph depth: leave the geometry alone and
   move the PIXELS. Added 2026-09-08 for the portrait lab, on Sebastian's
   *"explore other ways to spatialize 2D photos (3D relief, depth, etc.)"*.

   ── What it is, against the other three ──
     spatial photo   two images, one per eye. Binocular depth only; nothing
                     responds to where your head is.
     relief panel    the plane is TESSELLATED and its vertices displaced by the
                     depth map. Real geometry, so it re-projects as you move —
                     and one continuous surface has to span the jump from his
                     hair to the backdrop, so it stretches there.
     3D gaussians    a real reconstruction. Knows what is behind an edge, and
                     costs a 665 KB renderer plus megabytes of splats.
     THIS            two triangles. The depth lives entirely in the SAMPLING:
                     for each fragment, march along the view ray through the
                     depth map and shade with the texel the ray would actually
                     have hit if the surface had that relief. Parallax occlusion
                     mapping, which is how games have faked brick and cobbles
                     since about 2005.

   ── Why it is worth a panel in the comparison ──
   It is the exact midpoint of the argument the lab exists to settle. It has
   the relief panel's motion response — move and the near parts slide over the
   far ones — with none of its stretching, because there is no mesh to stretch;
   a depth discontinuity just means the march terminates a step earlier. And it
   needs nothing the relief panel does not already ship: the same
   `portrait-relief.png`, 239 KB, already in `vr/assets`.

   What it cannot do is the thing gaussians can: there is no information behind
   an edge, so at a steep angle the march runs off the end of the depth it
   knows about and smears the last texel. That failure is the interesting part
   of the comparison, not a bug to hide — it is the honest cost of faking depth
   in texture space, and seeing it next to the splat is the point.

   ── The depth map's polarity ──
   `portrait-relief.png` is the SAME map mosaic-reveal displaces with: 0 is
   nearest (his face), 1 is furthest (the backdrop), and the metric span is in
   vr/assets/portrait-relief.json (`relief_m` 0.1951). So the surface here is a
   BOX pushed back INTO the panel, never out of it — which is also what keeps
   it honest at the frame, since nothing ever needs to be drawn outside the
   quad.

   Usage: <a-entity parallax-photo="photo: ../images/x.jpg; depth: assets/x-depth.png"></a-entity>
*/

(function () {
  var VERT = [
    'varying vec2 vUv;',
    'varying vec3 vViewTan;',      // view vector in the plane's own tangent frame
    'void main() {',
    '  vUv = uv;',
    // The plane is authored in the xy plane facing +z, so its tangent frame IS
    // its local frame — no TBN to build, and no normal map to get wrong. The
    // eye in local space is the inverse model matrix applied to the camera
    // position; `cameraPosition` is a three.js built-in in world space.
    '  vec3 eyeLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;',
    '  vViewTan = eyeLocal - position;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D tPhoto;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uSize;',
    'uniform float uDepthM;',        // how deep the box is, in metres
    'uniform float uCornerRadius;',
    'uniform float uEdgeFeather;',
    'uniform float uDesaturate;',
    'uniform float uSteps;',
    'varying vec2 vUv;',
    'varying vec3 vViewTan;',
    'float sdRoundRect(vec2 p, vec2 b, float r){',
    '  vec2 q = abs(p) - b + r;',
    '  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;',
    '}',
    'void main() {',
    '  vec2 p = (vUv - 0.5) * uSize;',
    '  float rd = sdRoundRect(p, uSize * 0.5, uCornerRadius);',
    '  float aperture = 1.0 - smoothstep(-uEdgeFeather, 0.0, rd);',
    '  if (aperture < 0.02) discard;',

    // ── The march ─────────────────────────────────────────────────────────
    // Walk from the surface (depth 0) toward the back of the box (depth 1) in
    // equal steps, offsetting the uv by the view ray's horizontal component as
    // we go, and stop at the first step where the ray has gone BEHIND the
    // stored height. Then refine once by intersecting the two straddling
    // samples, which is what removes the stair-stepping a fixed step count
    // otherwise shows on a slow gradient like a cheek.
    '  vec3 v = normalize(vViewTan);',
    // Guard: at a grazing angle v.z -> 0 and the per-step offset -> infinity.
    // Clamping the ratio rather than the angle keeps the near-normal case exact
    // and only bites where the march is meaningless anyway.
    '  float vz = max(abs(v.z), 0.18);',
    // Metres of lateral travel per unit of depth, converted into uv.
    '  vec2 perDepth = (v.xy / vz) * uDepthM / uSize;',
    '  float steps = uSteps;',
    '  float dStep = 1.0 / steps;',
    '  float rayD = 0.0;',
    '  vec2 uv = vUv;',
    '  float mapD = texture2D(tDepth, uv).r;',
    '  float prevRay = 0.0, prevMap = mapD;',
    '  for (int i = 0; i < 24; i++) {',
    '    if (float(i) >= steps || rayD >= mapD) break;',
    '    prevRay = rayD; prevMap = mapD;',
    '    rayD += dStep;',
    '    uv = vUv - perDepth * rayD;',
    '    mapD = texture2D(tDepth, uv).r;',
    '  }',
    // One linear refinement between the last two samples.
    '  float after = mapD - rayD;',
    '  float before = prevMap - prevRay;',
    '  float w = after / max(after - before, 1e-4);',
    '  vec2 hitUv = mix(uv, vUv - perDepth * prevRay, clamp(w, 0.0, 1.0));',
    // Outside the texture there is nothing to know. Clamp rather than let the
    // sampler wrap: a wrapped sample puts the other side of his head at the
    // edge of the frame, which is the one artefact that reads as broken
    // rather than as a limitation.
    '  hitUv = clamp(hitUv, vec2(0.001), vec2(0.999));',
    // ── The edge guard ────────────────────────────────────────────────────
    // Where the march ends on a big depth STEP — his hair against the
    // backdrop — the texel it lands on is not "what is behind the edge",
    // because nothing in a single photograph is. Rendered at 30° off axis and
    // looked at, that showed as a fringe of stringy streaks along the whole
    // hairline: the same artefact, and for the same reason, that made
    // export_spatial.py abandon a forward warp (see its header).
    //
    // So where the depth the march LANDED on disagrees sharply with the depth
    // directly under the fragment, the offset is faded out and the fragment
    // falls back to sampling straight through. An edge we have no data for
    // simply stops being parallaxed, which is the honest answer and reads as a
    // slightly flat silhouette rather than as smearing.
    '  float here = texture2D(tDepth, vUv).r;',
    '  float jump = abs(texture2D(tDepth, hitUv).r - here);',
    '  hitUv = mix(hitUv, vUv, smoothstep(0.10, 0.30, jump));',

    '  vec3 photo = texture2D(tPhoto, hitUv).rgb;',
    '  float lum = dot(photo, vec3(0.299, 0.587, 0.114));',
    '  vec3 col = mix(photo, vec3(lum * 0.84), uDesaturate);',
    // Same "fall off rather than stop" treatment the spatial photo uses, so
    // the four panels in the lab share one edge language.
    '  col *= mix(1.0, aperture, 0.45);',
    '  gl_FragColor = vec4(col, aperture);',
    // Trap §3.5: the photo is tagged sRGB, so the shader is handed linear
    // values and has to encode on the way out or it lands dark and orange.
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  AFRAME.registerComponent('parallax-photo', {
    schema: {
      photo: { type: 'string', default: '../images/contact-photo-framed-for-mosaic.jpg' },
      depth: { type: 'string', default: 'assets/portrait-relief.png' },
      width: { type: 'number', default: 0.72 },
      height: { type: 'number', default: 1.08 },
      // vr/assets/portrait-relief.json's `relief_m`, the same number
      // mosaic-reveal displaces by — so the two panels in the lab are showing
      // the same depth, done two ways, which is the only way the comparison
      // means anything.
      // ── NOT the relief panel's 0.1951, and that difference is the finding ──
      // The relief panel displaces real geometry, so it can carry the bake's
      // full 0.1951 m: every vertex goes where the depth map says and nothing
      // has to be invented. Texture-space parallax has to invent, and how much
      // it invents is exactly this number times the tangent of your view angle
      // — at 0.1951 and 30° off axis the march travels 0.113 m across a 0.72 m
      // panel, 15.6% of its width, all of it behind his head where there is no
      // photograph. Measured by rendering it: a fringe of streaks along the
      // hairline that the edge guard in the shader softens but cannot fill.
      //
      // 0.085 is 44% of it: 0.049 m of travel at the same angle, under 7% of
      // the width, which the guard handles cleanly. The motion cue survives at
      // full strength — parallax is felt as relative movement, not as absolute
      // depth — and the panel stays a photograph.
      depthM: { type: 'number', default: 0.085 },
      // 16 of a possible 24 (the loop bound is a constant, as GLSL ES 1.0
      // requires). Measured against the same panel at 8 and at 24: 8 shows
      // visible terracing across the cheek at a 30° view, 24 is
      // indistinguishable from 16 on a 512x768 map. The cost is a texture
      // fetch per step over one 0.72 x 1.08 quad, so this is not a budget
      // anyone needs to defend — it is chosen for where the quality stops
      // improving.
      steps: { type: 'number', default: 20 },
      cornerFraction: { type: 'number', default: 0.06 },
      edgeFeather: { type: 'number', default: 0.012 },
      desaturate: { type: 'number', default: 1 }
    },

    init: function () {
      var d = this.data;
      var radius = Math.min(d.width, d.height) * d.cornerFraction;

      // The depth map is DATA, not colour — same reasoning as mosaic-reveal's:
      // loadTexture tags everything sRGB, and letting the renderer decode a
      // height field as if it were a picture bends the whole depth curve.
      var tDepth = VRGlass.loadTexture(d.depth, function (t) {
        t.colorSpace = THREE.NoColorSpace;
        t.minFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.needsUpdate = true;
      });
      tDepth.colorSpace = THREE.NoColorSpace;
      tDepth.minFilter = THREE.LinearFilter;
      tDepth.generateMipmaps = false;

      var tPhoto = VRGlass.loadTexture(d.photo, function (t) { t.anisotropy = 8; });
      tPhoto.anisotropy = 8;

      this.material = new THREE.ShaderMaterial({
        uniforms: {
          tPhoto: { value: tPhoto },
          tDepth: { value: tDepth },
          uSize: { value: new THREE.Vector2(d.width, d.height) },
          uDepthM: { value: d.depthM },
          uCornerRadius: { value: radius },
          uEdgeFeather: { value: d.edgeFeather },
          uDesaturate: { value: d.desaturate },
          uSteps: { value: Math.max(1, Math.min(24, d.steps)) }
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false
      });

      this.geometry = new THREE.PlaneGeometry(d.width, d.height);
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.el.setObject3D('parallax', this.mesh);
      this.el.classList.add('clickable');
    },

    remove: function () {
      // §3.17: nothing here frees itself.
      this.el.removeObject3D('parallax');
      if (this.geometry) this.geometry.dispose();
      if (this.material) {
        var u = this.material.uniforms;
        if (u.tPhoto.value) u.tPhoto.value.dispose();
        if (u.tDepth.value) u.tDepth.value.dispose();
        this.material.dispose();
      }
    }
  });
})();
