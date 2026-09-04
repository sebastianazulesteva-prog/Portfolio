/* ═══ spatial-photo.js ═══
   The portrait as an Apple-style SPATIAL PHOTO: a stereo pair, one image per
   eye, behind a feathered opening.

   This is deliberately the WEAKEST of the three depth treatments, and it is
   here so the difference is arguable from evidence rather than from my say-so.
   A spatial photo gives you binocular depth and nothing else — each eye sees
   its own image, so the scene has real volume, but the images are fixed. Move
   your head and nothing new is revealed, because there is nothing behind them
   to reveal. Compare against `mosaic-reveal`'s relief mode, which is real
   geometry and so re-projects as you move, and against `splat-portrait`, which
   additionally knows what is behind an edge.

   HOW THE TWO EYES ARE SEPARATED
   three.js reserves layers 1 and 2 for exactly this: WebXRManager does
   `cameraL.layers.enable(1)` and `cameraR.layers.enable(2)`, and enables both
   on the ArrayCamera so layer-tagged objects survive the top-level cull and
   reach the per-eye pass (super-three 0.158, WebXRManager.js:50-61). So the
   left plate goes on layer 1 alone and the right on layer 2 alone, and each eye
   sees exactly one of them. No render targets, no second pass, no shader work.

   Outside a session there is only one camera, which sits on layer 0 and would
   therefore see NEITHER plate — a blank rectangle on every desktop visitor.
   init() enables layer 1 on the scene camera so the flat site shows the
   left eye, which is the correct mono view of a stereo pair.

   The pair is baked by vr/tools/sharp/export_spatial.py. Its disparity is
   computed for where the panel actually hangs (0.72 m wide, 1.5 m away), not
   for the captured metric depth — warping by capture depth is only right if
   your eye is 40 cm from his face, and produces ~70 px of relative shift that
   is genuinely painful to fuse. See that file's header.

   Usage: <a-entity spatial-photo="left: assets/portrait-eye-L.jpg; right: assets/portrait-eye-R.jpg"></a-entity>
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
    'uniform sampler2D tEye;',
    'uniform float uDesaturate;',
    'uniform vec2 uSize;',
    'uniform float uCornerRadius;',
    'uniform float uEdgeFeather;',
    'varying vec2 vUv;',
    'float sdRoundRect(vec2 p, vec2 b, float r){',
    '  vec2 q = abs(p) - b + r;',
    '  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;',
    '}',
    'void main() {',
    '  vec2 p = (vUv - 0.5) * uSize;',
    '  float rd = sdRoundRect(p, uSize * 0.5, uCornerRadius);',
    // Same feathered opening as the relief panel, so the three variants differ
    // in depth technique and not in how their edges are presented.
    '  float a = 1.0 - smoothstep(-uEdgeFeather, 0.0, rd);',
    '  if (a < 0.02) discard;',
    '  vec3 c = texture2D(tEye, vUv).rgb;',
    // The exact grey mosaic-reveal applies, so the two image-based variants
    // differ ONLY in how depth is produced. Without this the spatial photo
    // arrives in full colour beside a grey relief panel and reads as the
    // better one on tone alone, which is not what is being compared.
    '  float lum = dot(c, vec3(0.299, 0.587, 0.114));',
    '  c = mix(c, vec3(lum * 0.84), uDesaturate);',
    '  gl_FragColor = vec4(c, a);',
    // Load-bearing, see trap 3.5: the texture is tagged sRGB so the shader is
    // handed LINEAR values, and without this chunk they go to an sRGB
    // framebuffer unconverted — measurably darker and orange-shifted.
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  AFRAME.registerComponent('spatial-photo', {
    schema: {
      left: { type: 'string', default: 'assets/portrait-eye-L.jpg' },
      right: { type: 'string', default: 'assets/portrait-eye-R.jpg' },
      width: { type: 'number', default: 0.72 },
      height: { type: 'number', default: 1.08 },
      edgeFeather: { type: 'number', default: 0.03 },
      cornerRadius: { type: 'number', default: -1 },
      // Match mosaic-reveal's grey hero treatment. 0 shows the photo as shot.
      desaturate: { type: 'number', default: 1 }
    },

    init: function () {
      var d = this.data;
      var radius = d.cornerRadius >= 0 ? d.cornerRadius : Math.min(d.width, d.height) * 0.03;
      var geo = new THREE.PlaneGeometry(d.width, d.height);
      var self = this;

      function plate(url, layer) {
        var tex = VRGlass.loadTexture(url, function (t) { t.anisotropy = 8; });
        tex.anisotropy = 8;
        var mat = new THREE.ShaderMaterial({
          uniforms: {
            tEye: { value: tex },
            uSize: { value: new THREE.Vector2(d.width, d.height) },
            uCornerRadius: { value: radius },
            uEdgeFeather: { value: d.edgeFeather },
            uDesaturate: { value: d.desaturate }
          },
          vertexShader: VERT,
          fragmentShader: FRAG,
          transparent: true,
          depthWrite: false
        });
        var mesh = new THREE.Mesh(geo, mat);
        // set(), not enable(): the plate must leave layer 0, or both eyes would
        // see both plates and the stereo effect collapses into a double image.
        mesh.layers.set(layer);
        return mesh;
      }

      this.left = plate(d.left, 1);
      this.right = plate(d.right, 2);
      this.el.setObject3D('eye-left', this.left);
      this.el.setObject3D('eye-right', this.right);
      this.el.classList.add('clickable');

      // Without this the flat site shows an empty frame: the desktop camera is
      // on layer 0 only and both plates have left it.
      var sceneEl = this.el.sceneEl;
      var showMono = function () {
        if (sceneEl.camera) sceneEl.camera.layers.enable(1);
      };
      if (sceneEl.camera) showMono(); else sceneEl.addEventListener('camera-set-active', showMono);
    },

    remove: function () {
      // §3.17: removeObject3D frees nothing by itself.
      ['eye-left', 'eye-right'].forEach(function (k) {
        var o = this.el.getObject3D(k);
        if (!o) return;
        this.el.removeObject3D(k);
        if (o.material) {
          if (o.material.uniforms && o.material.uniforms.tEye.value) o.material.uniforms.tEye.value.dispose();
          o.material.dispose();
        }
      }, this);
      // The geometry is shared between the two plates, so it is disposed once.
      if (this.left && this.left.geometry) this.left.geometry.dispose();
      this.left = this.right = null;
    }
  });
})();
