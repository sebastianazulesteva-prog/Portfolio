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

  // Scene-wide accessor for xr-diag.js — returns null when no splat portrait
  // is in the scene, so the diagnostic can skip the section entirely.
  window.VRSplatDiag = function () {
    var el = document.querySelector('[splat-portrait]');
    var c = el && el.components && el.components['splat-portrait'];
    return c && c.diag ? c.diag() : null;
  };

  AFRAME.registerComponent('splat-portrait', {
    schema: {
      src: { type: 'string', default: 'assets/portrait-lod.splat' },
      // Drop near-invisible gaussians at parse time (0-255). The bake already
      // cut everything under 0.04 opacity; this is the runtime's own floor and
      // is what keeps the pruned silhouette's soft hair fringe from turning
      // into a cloud of faint specks seen edge-on.
      alphaThreshold: { type: 'number', default: 8 },
      // ── Why this is not 1.0 ─────────────────────────────────────────────
      // SHARP is metric and the f30 bake landed life-size, so scale 1.0 draws
      // him at ACTUAL SIZE — and that is the wrong answer here, because the
      // photo panel it replaces does not. A head is ~0.23 m; in a 1.08 m panel
      // his head spans about half the frame, i.e. roughly twice life size.
      //
      // At 1.0 the bust measured 239x277 px against the panel's 309x463 — 60%
      // of the height and 26.5% of the area. That is the whole of Sebastian's
      // "I couldn't see it at all": a small, dim bust with no bright backdrop,
      // in a dark dome, where a large portrait used to be. Nothing was broken.
      // 1.5 measures 343x415, which reads as the same presence as the panel.
      splatScale: { type: 'number', default: 1.5 },
      // Progressive reveal looks like a glitch on a face — it assembles from
      // the middle out. Off by default: show nothing, then show him whole.
      progressive: { type: 'boolean', default: false }
    },

    init: function () {
      var self = this;
      this.viewer = null;
      this.ready = false;
      // ── Why this reports itself ─────────────────────────────────────────
      // "I couldn't see it at all" is the only report this component has ever
      // produced from real hardware, and it was unactionable, because every
      // way it can fail is silent: _fail() wrote to console.warn and there is
      // NO CONSOLE IN A VISION PRO (§3.16). A 3 MB splat plus a 665 KB library
      // over a headset's network is also several seconds during which a
      // working load and a dead one look identical — both are an empty space
      // where the portrait was.
      //
      // So it narrates into the scene through VRBusy, the same card the reader
      // and the project rooms use. If it is slow you see it loading; if it
      // breaks you see why, in the headset, without a cable.
      this._job = (window.VRBusy && VRBusy.begin) ? VRBusy.begin('Loading the gaussian portrait') : null;
      this._say = function (stage, loaded, total) {
        if (self._job && VRBusy.update) VRBusy.update(self._job, { stage: stage, loaded: loaded, total: total });
      };
      this._done = function () {
        if (self._job && VRBusy.end) { VRBusy.end(self._job); self._job = null; }
      };
      this._say('fetching the renderer');
      // Scratch for the re-sort check in tick() — allocated once, never per frame.
      this._camPos = new THREE.Vector3();
      this._camQuat = new THREE.Quaternion();
      this._viewDir = new THREE.Vector3();
      this._lastPos = new THREE.Vector3(Infinity, Infinity, Infinity);
      this._lastDir = new THREE.Vector3(0, 0, -1);
      load(function (err) {
        if (err) { self._fail(err); return; }
        if (!self.el.parentNode) return; // removed while the library was in flight
        self._say('reading the splat');
        self._build();
      });
    },

    _fail: function (why) {
      // Never throw from here. A missing splat portrait should be an absent
      // portrait, not a broken home scene.
      console.warn('[vr] splat-portrait unavailable:', why);
      // Say it where it can actually be read. Held for a few seconds rather
      // than ended immediately — the whole point is that someone wearing a
      // headset gets to see the reason.
      var self = this;
      this._say('unavailable — ' + String(why).slice(0, 90));
      setTimeout(function () { self._done(); }, 5200);
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
        // Pre-computes splat distances on the GPU. It defaults to false, and
        // the library itself force-disables it whenever its own webXRMode is
        // set — so it is not something to switch on for a headset. Pinned
        // explicitly so a future default flip cannot quietly enable it here.
        gpuAcceleratedSort: false,
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

      var total = null;
      this.viewer.addSplatScene(this.data.src, {
        splatAlphaRemovalThreshold: this.data.alphaThreshold,
        showLoadingUI: false,           // it injects its own DOM spinner otherwise
        progressiveLoad: this.data.progressive,
        // onProgress(percent, label, status) — status is the library's
        // LoaderStatus enum, whose string form is good enough to show.
        onProgress: function (percent, label, status) {
          var stage = String(status || 'downloading').toLowerCase();
          self._say(stage === 'done' ? 'placing him' : stage, percent, 100);
        },
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [this.data.splatScale, this.data.splatScale, this.data.splatScale]
      }).then(function () {
        self.ready = true;
        self.el.setObject3D('splat', self.viewer);
        self._armStereo();
        self._done();
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

      // Thresholds, and they matter more in a headset than on a desktop: a
      // head is never perfectly still, so a tight threshold means re-sorting
      // ~97k gaussians on essentially every frame. The sort runs on a worker so
      // it does not block the frame, but each one still posts an index buffer
      // back across the thread boundary, and at 72-90 Hz that is a steady tax
      // on a standalone headset for an ordering change no one can see.
      //
      // Seated at ~1.5 m from the panel, 6 cm of head travel is about 2.3
      // degrees of parallax — below the point where the back-to-front order of
      // overlapping gaussians visibly changes.
      var presenting = !!(this.el.sceneEl.renderer && this.el.sceneEl.renderer.xr &&
                          this.el.sceneEl.renderer.xr.isPresenting);
      var moveGate = presenting ? 0.06 : 0.02;
      var turnGate = presenting ? 0.002 : 0.0005;   // ~3.6 deg vs ~1.8 deg
      var moved = this._camPos.distanceTo(this._lastPos);
      var turned = 1 - this._viewDir.dot(this._lastDir);
      if (moved < moveGate && turned < turnGate) return;
      this._sorts = (this._sorts || 0) + 1;

      this._lastPos.copy(this._camPos);
      this._lastDir.copy(this._viewDir);
      this.viewer.viewer.runSplatSort(true, false);
    },

    // ── Reading this in a headset ─────────────────────────────────────────
    // §3.16: there is no console in a Vision Pro, so anything you need to know
    // about in-session behaviour has to reach a surface inside the scene.
    // xr-diag.js picks this up and prints it on its card when the flag is on.
    // Cheap, no allocation, safe to call from a sampler.
    diag: function () {
      var v = this.viewer && this.viewer.viewer;
      var mesh = this.viewer && this.viewer.splatMesh;
      var renderer = this.el.sceneEl && this.el.sceneEl.renderer;
      return {
        ready: !!this.ready,
        splats: mesh ? mesh.getSplatCount() : 0,
        // The one number that says whether anything is on screen at all: the
        // sort sets it, and it is 0 for a splat that loaded but never sorted.
        drawn: mesh && mesh.geometry ? (mesh.geometry.instanceCount || 0) : 0,
        sorts: this._sorts || 0,
        lastSortMs: v ? v.lastSortTime : null,
        // False in-session means the stereo correction is not running and the
        // splats are sized against the full canvas width instead of one eye.
        webXRActive: v ? !!v.webXRActive : null,
        presenting: !!(renderer && renderer.xr && renderer.xr.isPresenting),
        src: this.data.src
      };
    },

    // ── Stereo: the library cannot tell it is in a headset ────────────────
    // Splat screen-space size is computed from `renderDimensions`, which in
    // drop-in mode is `renderer.getSize()` — the whole canvas. In a session
    // each eye renders to its own viewport with its own projection, so that
    // width is wrong and every gaussian is sized against the wrong horizontal
    // scale: splats come out stretched.
    //
    // The library HAS the correction (`adjustForWebXRStereo`, which rescales
    // renderDimensions by the ratio of the flat to the XR projection), but it
    // is gated on `this.webXRActive`, and that flag is only ever set inside
    // `setupWebXR()` — which runs only when the library is constructed with its
    // own `webXRMode`, a path that also builds its own VRButton into a
    // rootElement. DropInViewer forces `rootElement: null`, so setupWebXR never
    // runs, no sessionstart listener is ever registered, and the flag is false
    // forever. The correction is dead code in every drop-in scene.
    //
    // So set the flag ourselves off the renderer's own XR events. Listening on
    // renderer.xr rather than A-Frame's enter-vr/exit-vr because it is the same
    // source the library would have used, and it cannot miss a session that
    // began before this component finished loading (checked directly below).
    _armStereo: function () {
      var self = this;
      var sceneEl = this.el.sceneEl;
      var renderer = sceneEl && sceneEl.renderer;
      if (!renderer || !renderer.xr || this._stereoArmed) return;
      this._stereoArmed = true;

      var setActive = function (on) {
        if (self.viewer && self.viewer.viewer) self.viewer.viewer.webXRActive = on;
      };
      this._onSessionStart = function () { setActive(true); };
      this._onSessionEnd = function () { setActive(false); };
      renderer.xr.addEventListener('sessionstart', this._onSessionStart);
      renderer.xr.addEventListener('sessionend', this._onSessionEnd);
      // The splat can finish loading mid-session (it is megabytes), in which
      // case sessionstart already fired and will not fire again.
      setActive(!!renderer.xr.isPresenting);
    },

    remove: function () {
      // A component torn down mid-load would otherwise leave its progress card
      // in the scene with nothing left to finish it.
      this._done();
      // §3.17: removeObject3D frees nothing on its own. The viewer owns web
      // workers, a wasm sort module and GPU buffers, all of which leak if we
      // only detach the Group.
      var renderer = this.el.sceneEl && this.el.sceneEl.renderer;
      if (renderer && renderer.xr && this._onSessionStart) {
        renderer.xr.removeEventListener('sessionstart', this._onSessionStart);
        renderer.xr.removeEventListener('sessionend', this._onSessionEnd);
        this._onSessionStart = this._onSessionEnd = null;
        this._stereoArmed = false;
      }
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
