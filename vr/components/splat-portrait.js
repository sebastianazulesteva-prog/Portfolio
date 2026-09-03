/* ═══ splat-portrait.js ═══
   The home portrait as REAL 3D gaussians instead of a displaced photo.

   `vr/assets/portrait.splat` is a single-image reconstruction of the contact
   photo made with Apple's SHARP (github.com/apple/ml-sharp, "Sharp Monocular
   View Synthesis in Less Than a Second"): one feed-forward pass turns one
   photograph into a metric 3D gaussian scene. The bake is documented in
   vr/assets/portrait-bake.json. What ships here is already
     • subject only — the seamless studio backdrop is pruned away, so he reads
       as a bust in the dome rather than a photo in a box,
     • in three.js axes (SHARP emits OpenCV: x right, y DOWN, z FORWARD),
     • life-size, origin at the head centre, so the entity's own `position`
       places the head and needs no magic offset,
     • SH degree 0 — SHARP predicts no view-dependent colour, so there is no
       spherical-harmonics payload to carry.
   Because the front surface ends up facing +z, no corrective rotation is
   needed: the seated viewer looking down -z sees the front.

   THE COST, stated plainly, because it is the whole reason this exists as an
   alternative rather than a replacement:
     • a 665 KB renderer from CDN, versus 0 for the displaced panel,
     • 3.0 MB (LOD) or 12 MB (full) of gaussians, against 170 KB for a relief
       map, on a scene that fought its arrival payload down from 50.9 MB,
     • the library's peer range is three >= 0.160 and A-Frame 1.5.0 bundles
       super-three 0.158 — see the version note in load() below,
     • the mosaic gaze-reveal (the flat site's signature hero effect) cannot
       follow onto gaussians. This component has no reveal. That is a real
       feature loss, not an oversight.

   Usage: <a-entity splat-portrait="src: assets/portrait-lod.splat"></a-entity>
*/

(function () {
  // Pinned exactly, per hard rule 2 — never `latest`. UMD (not the ESM build)
  // because this site has no bundler and no import maps: the UMD wrapper takes
  // `global.THREE`, which is the very super-three instance A-Frame is already
  // running, so the splats share one WebGL context and one scene graph.
  var LIB_URL = 'https://unpkg.com/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.umd.cjs';

  var libState = 'idle'; // idle → loading → ready → failed
  var libWaiters = [];

  // The UMD wrapper assigns global["Gaussian Splats 3D"] — WITH SPACES, from
  // the package's display name — not `GaussianSplats3D`. Guessing the camel
  // case name is why this component first reported "library loaded but exposed
  // no GaussianSplats3D" against a library that had loaded perfectly. Both are
  // checked so an upstream rename to the obvious identifier keeps working.
  function lib() {
    return window['Gaussian Splats 3D'] || window.GaussianSplats3D || null;
  }

  function load(cb) {
    if (libState === 'ready') { cb(null); return; }
    if (libState === 'failed') { cb('splat library failed to load'); return; }
    libWaiters.push(cb);
    if (libState === 'loading') return;
    libState = 'loading';

    // A-Frame 1.5.0 ships super-three 0.158.0 while this library declares a
    // peer of three >= 0.160.0. It is loaded anyway, deliberately: the APIs it
    // actually touches (InstancedBufferGeometry, ShaderMaterial, DataTexture,
    // renderer.getContext) are unchanged across that gap, and the peer range
    // is npm metadata, not a runtime check. If a future three bump does break
    // it, it breaks HERE and only this component goes dark — which is why the
    // failure path below leaves the rest of the scene alone.
    var s = document.createElement('script');
    s.src = LIB_URL;
    s.async = true;
    s.onload = function () {
      libState = lib() ? 'ready' : 'failed';
      flush(libState === 'ready' ? null : 'loaded, but no splat global on window');
    };
    s.onerror = function () { libState = 'failed'; flush('could not fetch ' + LIB_URL); };
    document.head.appendChild(s);
  }

  function flush(err) {
    var w = libWaiters;
    libWaiters = [];
    for (var i = 0; i < w.length; i++) w[i](err);
  }

  AFRAME.registerComponent('splat-portrait', {
    schema: {
      src: { type: 'string', default: 'assets/portrait-lod.splat' },
      // Drop near-invisible gaussians at parse time (0-255). The bake already
      // cut everything under 0.04 opacity; this is the runtime's own floor and
      // is what keeps the pruned silhouette's soft hair fringe from turning
      // into a cloud of faint specks seen edge-on.
      alphaThreshold: { type: 'number', default: 8 },
      splatScale: { type: 'number', default: 1 },
      // Progressive reveal looks like a glitch on a face — it assembles from
      // the middle out. Off by default: show nothing, then show him whole.
      progressive: { type: 'boolean', default: false }
    },

    init: function () {
      var self = this;
      this.viewer = null;
      this.ready = false;
      // Scratch for the re-sort check in tick() — allocated once, never per frame.
      this._camPos = new THREE.Vector3();
      this._camQuat = new THREE.Quaternion();
      this._viewDir = new THREE.Vector3();
      this._lastPos = new THREE.Vector3(Infinity, Infinity, Infinity);
      this._lastDir = new THREE.Vector3(0, 0, -1);
      load(function (err) {
        if (err) { self._fail(err); return; }
        if (!self.el.parentNode) return; // removed while the library was in flight
        self._build();
      });
    },

    _fail: function (why) {
      // Never throw from here. A missing splat portrait should be an absent
      // portrait, not a broken home scene.
      console.warn('[vr] splat-portrait unavailable:', why);
      this.el.emit('splat-portrait-failed', { reason: why }, false);
    },

    _build: function () {
      var GS = lib();
      var self = this;

      // sharedMemoryForWorkers defaults TRUE, which needs SharedArrayBuffer,
      // which needs COOP/COEP response headers. GitHub Pages does not send
      // them, so leaving this on means the sort worker never starts and the
      // scene renders unsorted mush. This is the single setting that decides
      // whether this component works on the live site at all.
      this.viewer = new GS.DropInViewer({
        sharedMemoryForWorkers: false,
        // No view-dependent colour in a SHARP bake, so do not pay for it.
        sphericalHarmonicsDegree: 0,
        dynamicScene: false,
        antialiased: true,
        // The scene owns the render loop (xr-frame.js) — this must not try to
        // drive its own, and DropInViewer already forces selfDrivenMode off.
        // Left explicit so a library default change cannot quietly re-enable a
        // second rAF loop inside an immersive session (trap 3.14).
        useBuiltInControls: false
      });

      this.viewer.addSplatScene(this.data.src, {
        splatAlphaRemovalThreshold: this.data.alphaThreshold,
        showLoadingUI: false,           // it injects its own DOM spinner otherwise
        progressiveLoad: this.data.progressive,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [this.data.splatScale, this.data.splatScale, this.data.splatScale]
      }).then(function () {
        self.ready = true;
        self.el.setObject3D('splat', self.viewer);
        self.el.emit('splat-portrait-ready', {
          count: self.viewer.splatMesh ? self.viewer.splatMesh.getSplatCount() : 0
        }, false);
      }).catch(function (e) {
        self._fail((e && e.message) || String(e));
      });
    },

    // ── Why this component sorts the splats itself ───────────────────────
    // Gaussians must be drawn back-to-front, so the library re-sorts whenever
    // the camera moves enough. Its own trigger (Viewer.runSplatSort) tests
    // `this.camera.position` and `this.camera.quaternion` — the camera's LOCAL
    // transform.
    //
    // In A-Frame that is always the identity. The THREE camera is attached to
    // the camera ENTITY via setObject3D('camera', ...), so the entity's
    // object3D carries the rig's movement and the camera itself never leaves
    // (0,0,0) with no rotation. The library therefore sees a camera that has
    // never moved, its heuristic returns Promise.resolve(false) every frame,
    // and instanceCount stays 0 — the splats are loaded, sorted zero times,
    // and nothing is drawn. It fails completely silently: no error, no
    // warning, a correct splat count, and an empty screen.
    //
    // So the movement test is done here against the camera's WORLD transform
    // and the sort is forced past the dead heuristic. `force` only skips the
    // early-out; the library's partial-sort tiers still apply, so a small head
    // turn does not pay for a full re-sort of every gaussian.
    resort: function () {
      if (!this.ready || !this.viewer) return null;
      this._lastPos.set(Infinity, Infinity, Infinity); // make the next tick unconditional
      return this.viewer.viewer.runSplatSort(true, false);
    },

    tick: function () {
      if (!this.ready || !this.viewer) return;
      var cam = this.el.sceneEl && this.el.sceneEl.camera;
      if (!cam) return;
      cam.getWorldPosition(this._camPos);
      cam.getWorldQuaternion(this._camQuat);
      this._viewDir.set(0, 0, -1).applyQuaternion(this._camQuat);

      // 2 cm, or about 1.8 degrees of turn. Below that the existing order is
      // still correct enough to look right, and re-sorting 98k gaussians on
      // every frame of a slow head drift is wasted work in a headset.
      var moved = this._camPos.distanceTo(this._lastPos);
      var turned = 1 - this._viewDir.dot(this._lastDir);
      if (moved < 0.02 && turned < 0.0005) return;

      this._lastPos.copy(this._camPos);
      this._lastDir.copy(this._viewDir);
      this.viewer.viewer.runSplatSort(true, false);
    },

    remove: function () {
      // §3.17: removeObject3D frees nothing on its own. The viewer owns web
      // workers, a wasm sort module and GPU buffers, all of which leak if we
      // only detach the Group.
      if (this.viewer) {
        this.el.removeObject3D('splat');
        try {
          this.viewer.viewer.dispose();
        } catch (e) {
          console.warn('[vr] splat-portrait dispose:', e && e.message);
        }
        this.viewer = null;
      }
      this.ready = false;
    }
  });
})();
