/* ═══ glass-material.js ═══
   Shared glass-card shader + helpers — the "glass-material.js" registry
   VR_DESIGN_RESOURCES.md §11 asks for (one place to pick per-panel glass
   quality/variants). Used by hub-panel.js (constellation cards), focus-stage.js
   (the pulled-close detail view), and anything else that wants the same look.

   VRGlass.makeCardMaterial(w, h, radius, accent, captionFrac, opacity)
     -> ShaderMaterial for the rounded-rect glass frame (frosted fill, hairline
        border, accent rim/contact glow — see the shader comments below).

   VRGlass.coverFit(texture, planeAspect)
     -> sets repeat/offset on a texture so it crops (never stretches) to fill
        a plane of the given aspect ratio.

   VRGlass.makeFeatheredImage(url, w, h, featherWorld)
     -> a THREE.Mesh (PlaneGeometry + ShaderMaterial) showing `url` cover-fit
        into a w×h plane, with its edges softly feathered to transparent over
        a `featherWorld`-metre band, so the photo melts into the surrounding
        glass instead of reading as a hard-edged snapshot dropped on top.
*/

(function () {
  var CARD_VERT = [
    'varying vec2 vUv;',
    'varying vec3 vWorld;',
    'varying vec3 vNormal;',
    'void main() {',
    '  vUv = uv;',
    '  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
    // World-space normal. mat3(modelMatrix) is correct here because panels are
    // only ever rotated/translated, never non-uniformly scaled.
    '  vNormal = normalize(mat3(modelMatrix) * normal);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  // ── The scene's one key light ────────────────────────────────────────────
  // VR_POLISH_STANDARDS.md §2 mandates a SINGLE key light whose direction
  // never changes; project-room.js only ever shifts its colour temperature.
  // Until now nothing in the scene consumed it at all — every surface was
  // self-lit or MeshBasicMaterial — so both the key light and the per-room
  // retint were invisible no-ops. These uniforms make it real.
  //
  // The uniform value objects are MODULE-LEVEL and shared by reference across
  // every card material, so moving the light or retuning it is a single write
  // that updates all panels at once, and the per-frame camera update is one
  // assignment rather than one per panel.
  // Up to LIGHT_MAX fixtures — a rack above the home title. The count is a
  // compile-time constant because GLSL ES 1.0 requires constant loop bounds;
  // unused slots carry a black colour and so contribute nothing.
  var LIGHT_MAX = 4;

  function zeros(n, make) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(make());
    return a;
  }

  var LIGHT = {
    uLightPos: { value: zeros(LIGHT_MAX, function () { return new THREE.Vector3(); }) },
    uCamPos: { value: new THREE.Vector3(0, 1.6, 0) },
    // Colour is premultiplied by each fixture's intensity, so an unused slot
    // is simply black and drops out of the sum.
    uLightColor: { value: zeros(LIGHT_MAX, function () { return new THREE.Vector3(); }) },
    // x=diffuse, y=specular, z=shininess, w=self-lit retained
    //
    // Specular-DOMINANT on purpose. A strong diffuse term washes out the
    // cream-coloured type these panels carry (measured: the heading loses
    // most of its contrast against a diffuse-lit panel), whereas the
    // specular highlight adds the same "lit object" read while leaving the
    // fill dark. Specular is also the only term that responds to where the
    // VIEWER is, which is what makes a flat panel feel physical in a headset.
    uLightTune: { value: new THREE.Vector4(0.55, 4.5, 40.0, 0.9) },
    // Dusk-dome ember bounce. dome.js paints the warm band at the sphere's
    // EQUATOR (y=0, all the way around), so it surrounds the viewer — a
    // wraparound ring has no direction, which is why this is a flat ambient
    // term and deliberately NOT a bottom-edge gradient.
    uEmber: { value: new THREE.Vector3(0.227, 0.141, 0.094) }, // #3a2418
    // x=ember amount, y=distance falloff
    uEmberFall: { value: new THREE.Vector2(0.25, 0.55) }
  };

  var LIGHT_FRAG = [
    '  vec3 N = normalize(vNormal);',
    '  vec3 V = normalize(uCamPos - vWorld);',
    '  vec3 lightSum = vec3(0.0);',
    '  for (int i = 0; i < ' + LIGHT_MAX + '; i++) {',
    '    vec3 Lv = uLightPos[i] - vWorld;',
    '    float ldist = length(Lv);',
    '    vec3 L = Lv / max(ldist, 0.0001);',
    '    float atten = 1.0 / (1.0 + ldist * ldist * uEmberFall.y);',
    '    float ndl = max(dot(N, L), 0.0);',
    '    vec3 Hv = normalize(L + V);',
    '    float ndh = pow(max(dot(N, Hv), 0.0), uLightTune.z);',
    '    lightSum += uLightColor[i] * (ndl * atten * uLightTune.x + ndh * atten * uLightTune.y);',
    '  }',
    // A card dimmed behind the focused one must recede fully — otherwise its
    // specular highlight stays at full strength and it reads as MORE
    // prominent than the card in focus.
    '  float litMask = 1.0 - uDim * 0.7;',
    '  col *= uLightTune.w;',
    '  col += uEmber * uEmberFall.x * litMask;',
    '  col += lightSum * litMask;'
  ].join('\n');

  var CARD_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'varying vec3 vWorld;',
    'varying vec3 vNormal;',
    'uniform vec3 uLightPos[' + LIGHT_MAX + '];',
    'uniform vec3 uCamPos;',
    'uniform vec3 uLightColor[' + LIGHT_MAX + '];',
    'uniform vec4 uLightTune;',
    'uniform vec3 uEmber;',
    'uniform vec2 uEmberFall;',
    'uniform vec2 uSize;',       // panel size in metres
    'uniform float uRadius;',    // corner radius in metres
    'uniform vec3 uAccent;',     // rim / border tint
    'uniform float uHover;',     // 0..1 wake amount
    'uniform float uOpacity;',   // base glass opacity
    'uniform float uCaption;',   // caption-bar height as a fraction of height (0 = none)
    'uniform float uDim;',       // 0..1 — recedes into the background when another card is focused (VR_BUGFIX_NOTES.md item 7)
    'float sdRoundRect(vec2 p, vec2 b, float r){',
    '  vec2 q = abs(p) - b + r;',
    '  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;',
    '}',
    'void main() {',
    '  vec2 p = (vUv - 0.5) * uSize;',
    '  vec2 b = uSize * 0.5;',
    '  float d = sdRoundRect(p, b, uRadius);',
    '  float aa = 0.0016;',
    '  float shape = 1.0 - smoothstep(-aa, aa, d);',
    '  if (shape <= 0.001) discard;',
    '  float g = clamp(vUv.y, 0.0, 1.0);',
    '  vec3 fill = mix(vec3(0.115, 0.110, 0.101), vec3(0.185, 0.176, 0.162), g);',
    '  fill += uAccent * 0.05;',
    '  float inCaption = uCaption > 0.0 ? (1.0 - smoothstep(uCaption - 0.01, uCaption + 0.01, vUv.y)) : 0.0;',
    '  fill = mix(fill, fill * 0.70, inCaption * 0.9);',
    '  float bw = 0.007;',
    '  float border = smoothstep(-bw, -bw * 0.35, d) * shape;',
    '  float glow = (smoothstep(-0.06, -0.006, d)) * (1.0 - smoothstep(-0.006, 0.0, d)) * shape;',
    '  vec3 col = fill;',
    // Hover brighten pushed further (VR_BUGFIX_NOTES.md item 3: the previous
    // wake state was too subtle to read as "this responded to me") — the fill
    // itself lifts too, not just the border/glow, so the whole card visibly
    // lights up rather than just gaining a slightly brighter edge.
    '  col += uAccent * uHover * 0.16;',
    '  col = mix(col, uAccent, border * (0.35 + 0.6 * uHover));',
    '  col += uAccent * glow * (0.06 + 0.32 * uHover);',
    '  col += vec3(0.9, 0.92, 1.0) * border * smoothstep(0.5, 1.0, vUv.y) * 0.10;',
    '  if (uCaption > 0.0) {',
    '    float divider = 1.0 - smoothstep(0.0, 0.0035, abs(vUv.y - uCaption));',
    '    col += vec3(1.0) * divider * 0.06 * shape;',
    '  }',
    '  float alpha = shape * (uOpacity + 0.30 * border + 0.22 * uHover) + inCaption * 0.12;',
    '  alpha = clamp(alpha, 0.0, 0.96);',
    '  alpha *= mix(1.0, 0.32, uDim);',
    '  col = mix(col, col * 0.55, uDim * 0.6);',
    LIGHT_FRAG,
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  function makeCardMaterial(w, h, radius, accent, captionFrac, opacity) {
    var col = new THREE.Color(accent);
    return new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: new THREE.Vector2(w, h) },
        uRadius: { value: radius },
        uAccent: { value: new THREE.Vector3(col.r, col.g, col.b) },
        uHover: { value: 0 },
        uOpacity: { value: opacity != null ? opacity : 0.62 },
        uCaption: { value: captionFrac || 0 },
        uDim: { value: 0 },
        // Shared by reference — see the LIGHT note above. Do NOT clone these.
        uLightPos: LIGHT.uLightPos,
        uCamPos: LIGHT.uCamPos,
        uLightColor: LIGHT.uLightColor,
        uLightTune: LIGHT.uLightTune,
        uEmber: LIGHT.uEmber,
        uEmberFall: LIGHT.uEmberFall
      },
      vertexShader: CARD_VERT,
      fragmentShader: CARD_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
  }

  // Set the whole rack at once: an array of { pos, color, intensity }. Every
  // card material picks it up on the next frame, since they all reference the
  // same uniform objects. Slots beyond `fixtures.length` are blacked out.
  function setLights(fixtures) {
    for (var i = 0; i < LIGHT_MAX; i++) {
      var f = fixtures[i];
      if (!f) { LIGHT.uLightColor.value[i].set(0, 0, 0); continue; }
      LIGHT.uLightPos.value[i].copy(f.pos);
      var c = new THREE.Color(f.color || '#ffd0a0');
      var k = f.intensity != null ? f.intensity : 1;
      LIGHT.uLightColor.value[i].set(c.r * k, c.g * k, c.b * k);
    }
  }

  function setEmber(color) {
    var e = new THREE.Color(color);
    LIGHT.uEmber.value.set(e.r, e.g, e.b);
  }

  // Retune the response. Any omitted field keeps its current value, so this
  // is safe to call with a partial object from the dev harness.
  function setTune(t) {
    t = t || {};
    var v = LIGHT.uLightTune.value;
    if (t.diffuse != null) v.x = t.diffuse;
    if (t.specular != null) v.y = t.specular;
    if (t.shininess != null) v.z = t.shininess;
    if (t.selfLit != null) v.w = t.selfLit;
    var ef = LIGHT.uEmberFall.value;
    if (t.emberAmt != null) ef.x = t.emberAmt;
    if (t.falloff != null) ef.y = t.falloff;
  }

  function getLight() {
    return {
      fixtures: LIGHT.uLightPos.value.map(function (p, i) {
        var c = LIGHT.uLightColor.value[i];
        return { pos: p.clone(), rgb: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)] };
      }),
      tune: {
        diffuse: LIGHT.uLightTune.value.x, specular: LIGHT.uLightTune.value.y,
        shininess: LIGHT.uLightTune.value.z, selfLit: LIGHT.uLightTune.value.w,
        emberAmt: LIGHT.uEmberFall.value.x, falloff: LIGHT.uEmberFall.value.y
      }
    };
  }

  // The specular term needs the live camera position. A system (rather than a
  // component) so it runs without needing an attribute on <a-scene>, and one
  // shared-uniform write per frame covers every panel in the scene.
  // Visible housing for each .key-light fixture: a small bright core with a
  // soft halo around it, so you can see where the light is coming from. Purely
  // decorative — it emits nothing, the <a-light> entities do the work.
  // One shared radial-gradient texture for every fixture's glow sprite. The
  // stops are deliberately weighted toward the centre — a linear ramp reads as
  // a flat disc rather than a light source. Built once, reused.
  var _glowTex = null;
  function glowTexture() {
    if (_glowTex) return _glowTex;
    var size = 256;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.06, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.16, 'rgba(255,255,255,0.36)');
    g.addColorStop(0.34, 'rgba(255,255,255,0.11)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.03)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    _glowTex = new THREE.CanvasTexture(c);
    _glowTex.colorSpace = THREE.SRGBColorSpace;
    return _glowTex;
  }

  AFRAME.registerComponent('light-rack-housings', {
    init: function () {
      var self = this;
      var build = function () {
        var els = [].slice.call(document.querySelectorAll('.key-light'));
        els.forEach(function (lightEl, i) {
          var p = lightEl.getAttribute('position');
          var l = lightEl.getAttribute('light') || {};
          var colour = l.color || '#ffd0a0';

          var core = new THREE.Mesh(
            new THREE.SphereGeometry(0.045, 20, 14),
            new THREE.MeshBasicMaterial({ color: '#fff6e6', fog: false })
          );
          core.position.set(p.x, p.y, p.z);
          self.el.setObject3D('core' + i, core);

          // Glow as a single camera-facing sprite with a smooth radial
          // gradient. Concentric additive spheres were tried first and banded
          // into visible rings — each shell's silhouette reads as a hard edge.
          // A sprite is one quad, always faces the viewer, and the falloff is
          // baked into the texture so it's genuinely smooth. Cheap stand-in
          // for a postprocessing bloom pass, which the spec keeps as a last
          // resort because of the Quest perf cost.
          var glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture(),
            color: colour,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            fog: false
          }));
          glow.position.copy(core.position);
          glow.scale.setScalar(1.15);
          self.el.setObject3D('glow' + i, glow);
        });
      };
      if (this.el.sceneEl.hasLoaded) build();
      else this.el.sceneEl.addEventListener('loaded', build);
    }
  });

  AFRAME.registerSystem('vr-key-light', {
    init: function () {
      this._v = new THREE.Vector3();
      this._wp = new THREE.Vector3();
      // index.html stays the single source of truth for where the lights are:
      // this reads every .key-light entity's real WORLD position, so moving a
      // fixture in the markup needs no change here.
      var self = this;
      this.el.addEventListener('loaded', function () { self.syncRack(); });
      // Accessible mode wants maximum text contrast, so keep the panel fill at
      // full self-lit strength and take the specular right down.
      if (document.body.classList.contains('accessible')) {
        setTune({ selfLit: 1.0, specular: 1.6, diffuse: 0.2, emberAmt: 0.12 });
      }
    },

    // Re-read the rack from the DOM. Call after moving/recolouring a fixture.
    syncRack: function () {
      var els = [].slice.call(document.querySelectorAll('.key-light'));
      if (!els.length) return;
      this._rackEls = els;
      // Snapshot what index.html AUTHORED, once, the first time we see the
      // rack — before any project room has had a chance to retint it. This is
      // what restoreAuthored() below puts back. project-room.js used to keep
      // its own hand-copied constant for that, which had drifted to 10x too
      // dim (#e0a878 @ 0.15 vs the authored #ffc98a @ 1.5) and permanently
      // darkened the hub by ~17% after any room visit. Deriving it from the
      // markup means the two can't drift again.
      if (!this._authored) {
        this._authored = els.map(function (el) {
          var l = el.getAttribute('light') || {};
          return { el: el, color: l.color, intensity: l.intensity };
        });
      }
      var self = this;
      setLights(els.map(function (el) {
        el.object3D.updateMatrixWorld();
        var l = el.getAttribute('light') || {};
        return {
          pos: el.object3D.getWorldPosition(new THREE.Vector3()),
          color: l.color || '#ffd0a0',
          // Four fixtures summing into one surface would blow out at full
          // strength, so the shader contribution is scaled per fixture.
          intensity: (l.intensity != null ? l.intensity : 1) * self.perFixtureScale(els.length)
        };
      }));
    },

    perFixtureScale: function (n) { return 1 / Math.max(1, Math.sqrt(n)); },

    // Put every fixture back to its authored colour AND intensity — used when
    // a project room closes. Per-fixture, not one blanket value: the rack is
    // deliberately not uniform (amber #ffc98a at the edges @1.5, warmer white
    // #ffe0bb in the middle @1.7), so restoring the lead's colour across all
    // four would flatten it. _lastColor is reset here too, otherwise tick()
    // below would see the lead's "new" colour on the next frame and re-mirror
    // it over the three fixtures we just restored.
    restoreAuthored: function () {
      var a = this._authored;
      if (!a || !a.length) return;
      a.forEach(function (rec) {
        if (rec.color == null && rec.intensity == null) return;
        var d = {};
        if (rec.color != null) d.color = rec.color;
        if (rec.intensity != null) d.intensity = rec.intensity;
        rec.el.setAttribute('light', d);
      });
      this._lastColor = a[0].color;
      this.syncRack();
    },

    tick: function () {
      var cam = this.el.camera;
      if (!cam) return;
      cam.getWorldPosition(this._v);
      LIGHT.uCamPos.value.copy(this._v);

      // project-room.js retints #keyLight per room; mirror that onto the whole
      // rack so an entered room's palette reaches every panel.
      var els = this._rackEls;
      if (!els || !els.length) return;
      var lead = document.querySelector('#keyLight');
      if (!lead) return;
      var l = lead.getAttribute('light');
      if (l && l.color && l.color !== this._lastColor) {
        this._lastColor = l.color;
        els.forEach(function (el) { if (el !== lead) el.setAttribute('light', 'color', l.color); });
        this.syncRack();
      }
    }
  });

  // Cover-fit a texture into a plane of a given aspect (crop, never stretch).
  function coverFit(texture, planeAspect) {
    var img = texture.image;
    if (!img || !img.width) return;
    var texAspect = img.width / img.height;
    if (texAspect > planeAspect) {
      var rx = planeAspect / texAspect;
      texture.repeat.set(rx, 1);
      texture.offset.set((1 - rx) / 2, 0);
    } else {
      var ry = texAspect / planeAspect;
      texture.repeat.set(1, ry);
      texture.offset.set(0, (1 - ry) / 2);
    }
    texture.needsUpdate = true;
  }

  // ── Feathered-edge image plane ──
  // A photo that fades softly to transparent at its own edges (over a
  // featherWorld-metre band) so it reads as integrated into the glass behind
  // it rather than a hard-edged snapshot pasted on top. The feather is
  // computed in the plane's own UV space (0..1 across w/h), which stays
  // correct regardless of how coverFit has repositioned the texture within
  // that UV range — the fade follows the plane's physical edge, not the
  // photo's content.
  var IMG_VERT = CARD_VERT;
  var IMG_FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D map;',
    'uniform vec2 featherUv;',
    'uniform float uDim;',
    'uniform float uTone;', // 0..1 — highlight rolloff + vignette for blown-out product shots (VR_BUGFIX item 5: pendant hero)
    'uniform vec2 uImgSize;',      // plane size in metres, for the rounded-corner mask
    'uniform float uImgCorner;',   // corner radius in metres (0 = square)
    'float sdRoundRectImg(vec2 p, vec2 b, float r){',
    '  vec2 q = abs(p) - b + r;',
    '  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;',
    '}',
    'void main() {',
    // Rounded-corner mask, so a FULL-BLEED image can sit edge-to-edge on a
    // card and still follow the card's rounded silhouette instead of poking
    // square corners out past the glass behind it.
    '  float imgShape = 1.0;',
    '  if (uImgCorner > 0.0) {',
    '    vec2 pp = (vUv - 0.5) * uImgSize;',
    '    float dd = sdRoundRectImg(pp, uImgSize * 0.5, uImgCorner);',
    '    imgShape = 1.0 - smoothstep(-0.0016, 0.0016, dd);',
    '    if (imgShape <= 0.001) discard;',
    '  }',
    '  vec4 tex = texture2D(map, vUv);',
    '  vec3 rgb = tex.rgb;',
    // Highlight rolloff: a Reinhard-ish compression pulls blown-out whites
    // (the pendant hero is shot on pure white) down toward the dusk range,
    // while leaving midtones/shadows largely untouched — so a glary product
    // shot settles into the dome instead of flaring. Strength = uTone.
    '  vec3 rolled = (rgb / (1.0 + rgb * 1.2)) * 1.35;',
    '  rgb = mix(rgb, rolled, uTone);',
    // Gentle radial vignette (also uTone-scaled) so the frame edges seat into
    // the surrounding glass rather than ending on a bright rim.
    '  float vig = 1.0 - uTone * 0.4 * smoothstep(0.34, 0.72, distance(vUv, vec2(0.5)));',
    '  rgb *= vig;',
    '  float ax = smoothstep(0.0, featherUv.x, vUv.x) * smoothstep(0.0, featherUv.x, 1.0 - vUv.x);',
    '  float ay = smoothstep(0.0, featherUv.y, vUv.y) * smoothstep(0.0, featherUv.y, 1.0 - vUv.y);',
    '  gl_FragColor = vec4(rgb * mix(1.0, 0.55, uDim), tex.a * ax * ay * imgShape * mix(1.0, 0.32, uDim));',
    // ── Output colour space — load-bearing, do not remove ──
    // `map` is tagged SRGBColorSpace, so the GPU hands this shader LINEAR
    // values. three.js injects `linearToOutputTexel` into every ShaderMaterial
    // fragment prefix but only CALLS it where the shader includes this chunk.
    // Without it we wrote linear values straight to an sRGB framebuffer, so
    // every photo rendered darker and warm/orange-shifted.
    //
    // Measured, same texture at the same size: a built-in MeshBasicMaterial
    // gave [186,186,185] where this shader gave [135,117,78] — blue crushed
    // hardest (-107), which is exactly why photos read orange.
    //
    // This was the true cause of BUILD_NOTES.md ISSUE-07 ("thumbnails render
    // dark/tinted as if a colour grade is applied"). That was previously
    // closed by removing the `imagetone` grading from the glance cards, which
    // reduced the symptom without finding this.
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  // texture anisotropy: default anisotropy is 1 (no oblique-angle filtering)
  // — bumping it to 8 (widely supported, three.js clamps to the driver's
  // real max at render time) noticeably sharpens photos viewed off-axis,
  // which is the common case for a command-zone card tilted to face the
  // seated viewer (VR_BUGFIX_NOTES.md item 4's "pixelation" note).
  var ANISOTROPY = 8;

  // ── VR-only texture derivatives ──────────────────────────────────────────
  // Arrival used to cost 50.9 MB — 50.0 MB of it the 34 site photos, at their
  // native sizes (chess-hero is 5712×4284, baston-hero 5184×3058). Measured on
  // the shipped scene: ~284 MB of texture image data held, ~250 megapixels of
  // JPEG decode on arrival, and 34 main-thread canvas downscales behind that.
  // None of it shows: a 0.5 m card at 1.5 m cannot resolve past ~1600 px.
  //
  // .tools/vr-make-textures.py writes a downscaled copy of each into
  // vr/assets/tex (49.8 MB → 6.4 MB, 87% smaller) plus manifest.js, which
  // index.html loads as a plain script before any component — the same idiom
  // as window.VR_AUDIO, so there is no fetch to sequence and no build step.
  // The flat site keeps using /images untouched (hard rule 3).
  //
  // An explicit map, not extension-guessing: two images legitimately have NO
  // derivative (their originals were already smaller) and one keeps .png for a
  // real cut-out, so guessing would 404 on every load of those three.
  var TEX_DIR = 'assets/tex/';

  function texUrl(url) {
    if (!url || !window.VR_TEX) return url;
    // Both forms appear: '../images/x.jpg' from the markup and '/images/x.jpg'
    // from data-loader.js's rootHref().
    var m = /(?:^|\/)images\/([^/?#]+)$/.exec(url);
    var mapped = m && window.VR_TEX[m[1]];
    return mapped ? TEX_DIR + mapped : url;
  }

  // Texture loads are queued, not fired all at once. Even at 6.4 MB the decode
  // of 34 images lands on the main thread, and 34 at once is one long stall on
  // arrival — exactly the window where a visitor is trying to click something.
  // Four in flight keeps the pipe full without owning the frame.
  var MAX_INFLIGHT = 4;
  var inflight = 0;
  var texQueue = [];
  var texLoader = new THREE.TextureLoader();

  function pump() {
    while (inflight < MAX_INFLIGHT && texQueue.length) {
      var job = texQueue.shift();
      inflight++;
      job.run();
    }
  }

  // Move a queued load to the FRONT.
  //
  // Sebastian, second Vision Pro session: *"it's the rooms and pulling an image
  // from the cloud to read."* The Photo Cloud is 32 tiles behind a 4-at-a-time
  // queue, so the last tiles arrive well after the first — and selecting one
  // whose texture has not landed pulls an EMPTY frame to your face and holds it
  // there until its turn comes up. Nothing is broken; it is simply waiting its
  // place in a queue that has no idea you are looking at it.
  //
  // So a selection re-prioritises. Cheap (an array move), and it means the tile
  // you asked for is next rather than 20th.
  function prioritise(url) {
    if (!url) return false;
    for (var i = 0; i < texQueue.length; i++) {
      if (texQueue[i].url !== url) continue;
      if (i === 0) return true;
      texQueue.unshift(texQueue.splice(i, 1)[0]);
      return true;
    }
    return false;   // already loading, already loaded, or never queued
  }

  // Loads the derivative and falls back to the ORIGINAL url on error, so a
  // stale or half-generated vr/assets/tex can never blank out the scene — it
  // just costs the old download. Returns the THREE.Texture immediately (empty
  // until the image lands), which is what every caller already expects.
  //
  // `onError` is optional and was added for pdf-reader.js, which needs to know:
  // it holds a page plane at its placeholder tone until the image lands, and
  // gates the room transition on page 1 arriving. Every other caller passes two
  // arguments and is unaffected — but note that WITHOUT this the failure path
  // was silent, which is the shape of bug this codebase keeps finding.
  function loadTexture(url, onLoad, onError) {
    var tex = new THREE.Texture();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = ANISOTROPY;

    function settle(img) {
      inflight--;
      tex.image = img;
      tex.needsUpdate = true;
      if (onLoad) onLoad(tex);
      pump();
    }

    function failed(why) {
      inflight--;
      if (onError) onError(why || url);
      pump();
    }

    texQueue.push({ url: url, run: function () {
      var derived = texUrl(url);
      texLoader.load(derived, function (t) {
        settle(t.image);
      }, null, function () {
        if (derived === url) { failed(url); return; }
        console.warn('[vr] texture derivative missing, using original:', derived);
        texLoader.load(url, function (t) { settle(t.image); },
          null, function () { failed(url); });
      });
    } });
    pump();
    return tex;
  }

  // Downscale a loaded image to at most `maxSize` on its long edge via a
  // canvas, so we don't hold dozens of multi-thousand-pixel textures in GPU
  // memory (the Photo Cloud loads ~34 at once; §11 wants VR textures ≤1024).
  // Returns a canvas to use as the texture source, or the original image if
  // it's already small enough.
  //
  // Still here, and still worth passing a cap for, even with the derivatives
  // above: it is the backstop for anything with no derivative, and it is what
  // holds the Photo Cloud's 34 tiles at 512.
  function downscaled(img, maxSize) {
    var long = Math.max(img.width, img.height);
    if (!maxSize || long <= maxSize) return img;
    var scale = maxSize / long;
    var c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function featheredMaterial(tex, w, h, featherWorld, tone, cornerRadius) {
    var feather = featherWorld != null ? featherWorld : 0.045;
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex },
        featherUv: { value: new THREE.Vector2(feather / w, feather / h) },
        uDim: { value: 0 },
        uTone: { value: tone || 0 },
        uImgSize: { value: new THREE.Vector2(w, h) },
        uImgCorner: { value: cornerRadius || 0 }
      },
      vertexShader: IMG_VERT,
      fragmentShader: IMG_FRAG,
      transparent: true,
      depthWrite: false
    });
  }

  // `tone` (0..1) taps the shader's highlight-rolloff + vignette — pass a
  // value for glary/blown-out sources (the pendant hero) so they settle into
  // the dusk theme; 0 (default) leaves well-exposed photos untouched.
  function makeFeatheredImage(url, w, h, featherWorld, maxSize, tone, cornerRadius) {
    var tex = loadTexture(url, function (t) {
      if (maxSize && t.image) { t.image = downscaled(t.image, maxSize); t.needsUpdate = true; }
      coverFit(t, w / h);
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), featheredMaterial(tex, w, h, featherWorld, tone, cornerRadius));
  }

  // Procedural placeholder for projects with no photography (HP's Reckoning,
  // Algorithmic Modeling, the glasses frames, Social Engineering) — an
  // accent-tinted dusk panel with a subtle geometric motif + the project's
  // large faded initial, so an image-less card reads as intentional artwork
  // rather than a broken/empty frame next to the photo-backed panels
  // (VR_BUGFIX item 6). Drawn to a canvas → CanvasTexture, then fed through
  // the same feathered material so it melts into the glass like a real hero.
  function makePlaceholderTexture(accentHex, label) {
    var S = 512;
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var ctx = c.getContext('2d');

    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#17140f');
    g.addColorStop(1, '#231d15');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    var col = new THREE.Color(accentHex);
    var a = Math.round(col.r * 255) + ',' + Math.round(col.g * 255) + ',' + Math.round(col.b * 255);

    // Fine diagonal hatch — quiet texture across the whole panel.
    ctx.strokeStyle = 'rgba(' + a + ',0.05)';
    ctx.lineWidth = 2;
    for (var x = -S; x < S * 2; x += 30) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + S, S); ctx.stroke();
    }
    // Two concentric rings framing the initial.
    ctx.strokeStyle = 'rgba(' + a + ',0.16)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.30, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + a + ',0.08)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.38, 0, Math.PI * 2); ctx.stroke();

    // Large faded serif initial of the project title.
    var ch = ((label || '').trim().charAt(0) || '·').toUpperCase();
    ctx.fillStyle = 'rgba(' + a + ',0.5)';
    ctx.font = '600 250px Georgia, "Playfair Display", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, S / 2, S / 2 + 12);

    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = ANISOTROPY;
    return tex;
  }

  function makePlaceholderImage(w, h, accent, label, featherWorld, cornerRadius) {
    var tex = makePlaceholderTexture(accent, label);
    coverFit(tex, w / h); // canvas dims are known immediately, so this can run now
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), featheredMaterial(tex, w, h, featherWorld, 0, cornerRadius));
  }

  // ── Lit text ─────────────────────────────────────────────────────────────
  // Swaps a troika-text entity's rendered mesh from its default unlit
  // MeshBasicMaterial to a real MeshStandardMaterial lit by the shared
  // key-light rack, so the LETTERS THEMSELVES pick up highlight/shading
  // instead of reading as flat text with a fake outline underneath them.
  //
  // This replaced a black outline (outlineWidth/outlineColor/outlineBlur)
  // that was added to hub-panel's photo captions for legibility — Sebastian's
  // read was that it "looks strange, like a standard black shadow", which is
  // an accurate description of what it is: a static AA halo with no relation
  // to where the light actually is, unlike every other lit surface in the
  // scene. This is the same fix already applied to the home title's letters
  // (name-scatter-3d.js); this helper is the shared version of that so every
  // troika-text entity in the scene can opt in with one call instead of each
  // component re-implementing its own poll-and-swap.
  //
  // metalness stays low deliberately: there is no environment map in this
  // scene, and a metallic surface with nothing to reflect renders near-black.
  // Skipped entirely in accessible mode, where flat maximum-contrast text
  // wins over anything that can dim under the wrong angle.
  function lightTroikaText(el, colorHex, opts) {
    if (document.body.classList.contains('accessible')) return;
    opts = opts || {};
    var tries = 0;
    (function poll() {
      var comp = el.components && el.components['troika-text'];
      var mesh = comp && comp.troikaTextMesh;
      if (!mesh) { if (++tries < 100) setTimeout(poll, 40); return; }
      if (mesh.material && mesh.material.__vrLit) return;
      var base = colorHex || '#f5f5f0';
      var mat = new THREE.MeshStandardMaterial({
        color: base,
        roughness: opts.roughness != null ? opts.roughness : 0.36,
        metalness: opts.metalness != null ? opts.metalness : 0.08,
        transparent: true
      });
      // `emissive` sets a FLOOR on brightness. Without it the glyphs are lit
      // purely by the rack, and this scene's rack is dim and warm — so white
      // text rendered as a dim warm grey. Fine for the home title floating in
      // a dark dome, unreadable for a caption sitting over a bright photo.
      //
      // Emissive keeps the text at its intended colour no matter what the
      // lights are doing, while the diffuse/specular terms still layer real
      // highlights on top — so it reads as part of the lit scene rather than
      // reverting to a flat unlit label.
      if (opts.emissive) {
        mat.emissive = new THREE.Color(opts.emissive === true ? base : opts.emissive);
        mat.emissiveIntensity = opts.emissiveIntensity != null ? opts.emissiveIntensity : 1;
      }
      mat.__vrLit = true;
      mesh.material = mat;
    })();
  }

  window.VRGlass = {
    makeCardMaterial: makeCardMaterial,
    setLights: setLights,
    // Restore the authored <a-light> rack (colour + intensity per fixture).
    // project-room.js calls this on exit; index.html stays the single source
    // of truth for what "authored" means.
    restoreKeyRack: function () {
      var scene = document.querySelector('a-scene');
      var sys = scene && scene.systems && scene.systems['vr-key-light'];
      if (!sys) return false;
      sys.restoreAuthored();
      return true;
    },
    setEmber: setEmber,
    setTune: setTune,
    getLight: getLight,
    // For OTHER custom shaders (mosaic-reveal.js) that want the same rack
    // without duplicating light state — returns the actual uniform VALUE
    // objects by reference, so wiring them into another ShaderMaterial's
    // uniforms keeps that material in sync with setLights()/setTune() for
    // free. Do not clone what this returns.
    sharedLightUniforms: function () { return LIGHT; },
    LIGHT_MAX: LIGHT_MAX,
    coverFit: coverFit,
    makeFeatheredImage: makeFeatheredImage,
    makePlaceholderImage: makePlaceholderImage,
    lightTroikaText: lightTroikaText,
    // For the one other place that loads a photo through its own shader
    // (mosaic-reveal.js) — so the derivative swap and the load queue are not
    // things a second call site has to remember.
    texUrl: texUrl,
    loadTexture: loadTexture,
    // photo-cloud.js calls this when a tile is selected — see prioritise().
    prioritiseTexture: prioritise
  };
})();
