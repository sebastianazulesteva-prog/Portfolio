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
     • the mosaic gaze-reveal (the flat site's signature hero effect) does not
       survive onto gaussians. This component has no reveal. See below: that
       is a measured conclusion, not an assumption.

   ── THE REVEAL: TRIED, MEASURED, REMOVED (2026-09-13) ──
   It is tempting, and it half works, which is worse than not working. The
   bust is a reconstruction of ONE PHOTOGRAPH, so every gaussian has a place
   in that photograph — project it back through the camera SHARP assumed and
   sample the mosaic there. Six multiplies in the fragment shader, no extra
   per-splat data. Head-on, near the projector axis, it registers exactly:
   mosaic eyes on his eyes, the DNA helix on his nose, the icon row on his
   collar.

   Move, and it falls apart — and the lab is a room you are told to lean
   around in. Three fixes, each sound, none sufficient:

     1. A front-surface depth map in the original camera's image space, so a
        gaussian only wears a texel if it IS the surface that texel belongs
        to. Kills the case where the inpainted layer behind him wears his
        cheek's tile. Barely changed the picture.
     2. A graze fade off that map's own gradient, derived rather than guessed
        (a cell is 7.75 image px = 1.56 mm at his depth, so a 45° surface
        moves 1.6 mm per cell and the first threshold of 20 mm caught nothing
        but true silhouettes). Cleaner at the neck. Still a smeared face.
     3. textureLod instead of texture2D, because each gaussian samples one
        point with near-zero uv derivatives, always reads mip 0, and a field
        of hard-edged tiles aliases per splat. Blurrier, not better.

   What is left is not fixable by filtering: a flat artwork painted from one
   viewpoint onto a surface reconstructed from that same viewpoint has no
   information for any other viewpoint, and the gaussians resolve that as
   per-splat colour noise rather than as honest stretching. Sebastian, after
   seeing it from four angles: *"if you can't — just remove the feature."*

   The reveal stays on the other three lab panels, where it is a texture
   lookup on a surface with real uv continuity and it holds up.

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
      // ── The gaussians are authored for a 2976 px photo, not a 287 px bust ─
      // This is the library's `splatScale` UNIFORM, which is a different thing
      // from the `splatScale` above: that one scales the world transform and
      // moves the gaussians apart, this one widens each gaussian in SCREEN
      // SPACE and leaves every centre where it is.
      //
      // Sebastian, looking at the lab: *"it looks ugly, way worse than
      // Apple's."* He was right, and the reason is a resolution mismatch that
      // has nothing to do with the count. SHARP sized these gaussians for the
      // photograph it reconstructed — 1984x2976, where the median gaussian
      // (sigma 0.318 mm on a 0.56 m bust) covers about 1.7 px. In the lab the
      // bust draws 287 px tall, so the same gaussian covers 0.163 px: every
      // one of them lands inside a single pixel.
      //
      // That is not a coverage problem — 385k gaussians over ~63k pixels of
      // silhouette is six per pixel — it is an OPACITY problem, and it is
      // `antialiased` mode that turns it into one. Antialiasing convolves each
      // 2D gaussian with a 0.3 px kernel and rescales opacity by the ratio of
      // the determinants, so a 0.163 px gaussian at alpha 0.99 comes out near
      // 0.2. Six of those stacked never reach opaque, so the FRONT of his face
      // does not hide what is behind it — and what is behind it is SHARP's
      // inpainted second layer, which is dark because it was never
      // photographed. Hence black speckle over the nose, lips and chin,
      // exactly where the depth steps put layer 1 within a few mm of the
      // surface. Hence also the milky look: the dome's orange horizon was
      // shining through him.
      //
      // Widening was the FIRST fix for that, and it works — area grows as the
      // square, so twice as wide is four times the alpha contribution — but it
      // is the wrong lever and the measurements say so. With antialiasing
      // still on, the full splat needed 2.0 before the face came clean, and
      // 2.0 costs his eyebrows; 6.0 is soup with no features at all. Turning
      // antialiasing OFF removes the cause instead of compensating for it (see
      // the long note in _build), and then widening goes back to being what it
      // should be: a small amount of fill for places where the reconstruction
      // is genuinely thin.
      //
      // Re-measured with `antialiased: false`, in the lab, bust 287 px tall:
      //     full splat  1.0   sharp, faint speckle returning on nose + cheek
      //                 1.3   clean face, sharp brows, no thin spots   <- best
      //                 2.0   over-soft, brows gone
      //     LOD         1.0   sharp, but a visible hole in his left shoulder
      //                 1.4   shoulder reads as soft shadow rather than hole
      // The LOD's shoulder is not a tuning failure, it is the decimation: the
      // bake keeps every 2nd gaussian in each axis, so where the surface was
      // already only a few gaussians deep there is nothing left to be opaque
      // with, and no width hides a hole it cannot fill. The full splat has no
      // such spot. That is why the lab now loads the full one and this default
      // stays the LOD's number, for the hub portrait which uses the LOD.
      splatWidth: { type: 'number', default: 1.4 },
      // ── The bottom of a bust has to end somewhere ────────────────────────
      // The bake cuts him off at the chest, and that cut is not a hem: it is a
      // torn fringe of individual blobs hanging off it, which is what the lab
      // has been showing under the polo shirt. These two numbers end him
      // deliberately instead. Set trimBottom to 0 to see the raw cut.
      //
      // Two wrong answers first, because both are the obvious one:
      //
      //  1. FADE THE ALPHA OUT. Tried, and it makes the fringe worse. As the
      //     white front gaussians go transparent they stop hiding SHARP's
      //     inpainted layer behind them, which is dark because it was never
      //     photographed — so a dissolve came out as a dark speckled band
      //     across his chest. Fading anything against a black dome darkens it.
      //
      //  2. CUT ON ALPHA. Also tried, on the theory that the fringe is the
      //     faint material and the shirt is the opaque material. Measured, it
      //     is not: slice the bottom 18 cm into 1 cm bands and every band has
      //     both, in a ratio that slides smoothly from 87% opaque at y -0.20
      //     to 31% at y -0.32. There is no boundary to cut on, only a density
      //     that thins out until it can no longer form a surface. Cutting the
      //     faint half left a sparse scatter of opaque blobs — the same ragged
      //     edge, just dimmer.
      //
      // What works is to cut on DENSITY and then darken rather than dissolve:
      //   trimBottom  drop the lowest N% of gaussians by height. The cloud is
      //               too sparse to read as a surface below about y p5 — 1846
      //               gaussians in the 1 cm band at -0.20 against 118 at
      //               -0.32 — so that is where he ends.
      //   fadeBottom  above the cut, ramp the gaussians' COLOUR to black over
      //               this many metres. Not their alpha: they stay opaque, so
      //               they still hide the inpainted layer, and a black opaque
      //               bust bottom against a near-black dome simply is not
      //               there. It dissolves without ever becoming see-through.
      trimBottom: { type: 'number', default: 5 },
      fadeBottom: { type: 'number', default: 0.07 },
      // ── The dark smudges are SHARP's second layer showing through ────────
      // A bake holds two layers: the surface the camera saw, and an inpainted
      // layer behind it that exists so there is something to reveal when you
      // move your head. That second layer is the entire basis of this panel's
      // claim ("sees behind edges"), so it does not get deleted.
      //
      // But part of it bleeds forward. Mapped on a 220x220 grid, 4,493
      // gaussians (4.6%) sit more than 8 mm behind the front surface, 37.5% of
      // them darker than luminance 150, and they cluster exactly where the
      // render had unexplained dark patches: a ring around the hair and two
      // blooms at the shoulders. It is the same root cause as the face
      // speckle — sub-pixel gaussians never accumulate to opaque, so the front
      // does not hide the back — and widening does not finish the job. At
      // splatWidth 1.9 the shoulder patch shrinks but survives, and his
      // eyebrows go soft paying for it.
      //
      // So the rule removes only the part that can be SEEN to be wrong:
      // material far enough behind to be invented, AND much darker than the
      // surface it is hiding behind. Behind his hair, dark-behind-dark has no
      // contrast and is kept — which is where the disocclusion fill actually
      // matters. Behind a white polo shirt, a luminance-90 gaussian is a
      // smudge and nothing else. 0 on either number switches it off.
      occludeBehind: { type: 'number', default: 0.008 },
      occludeContrast: { type: 'number', default: 60 },
      // ── Match the other three panels, which are all grayscale ────────────
      // spatial-photo and parallax-photo both ship `desaturate: 1`, and the
      // relief panel is handed the flat site's gray image. The splat was the
      // only panel in the room still in colour, so the one comparison that was
      // supposed to isolate DEPTH also swung skin tone against three
      // black-and-white prints — and the splat, being the one with no bright
      // studio backdrop, read as the odd warm object rather than as the fourth
      // treatment of one photograph.
      //
      // Rec.601 luma, the same weights the other two shaders use. Done on the
      // stored bytes rather than in a shader because there is no shader of
      // ours here to do it in: the library owns the material. That means it
      // happens in sRGB rather than linear, which lands a little lighter than
      // the panels' `lum * 0.84` — hence the trim below, measured against
      // them rather than derived.
      desaturate: { type: 'number', default: 1 },
      desaturateGain: { type: 'number', default: 0.9 },
      // See the long note at the `antialiased` option in _build. Short version:
      // the library's antialiasing rescales opacity by a covariance-determinant
      // ratio that assumes roughly pixel-sized gaussians, and these are a sixth
      // of a pixel, so it crushed the alpha and the bust went see-through.
      antialiased: { type: 'boolean', default: false },
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
      this._say('unavailable: ' + String(why).slice(0, 90));
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
        // ── OFF, and this is the single biggest quality decision here ───────
        // It was on, because "antialiased" is obviously the good option. What
        // it actually does is convolve each 2D gaussian with a 0.3 px kernel
        // and then rescale its opacity by the ratio of the covariance
        // determinants — correct, and designed for gaussians that are about a
        // pixel across. These are 0.163 px across (the bust draws 287 px tall
        // and SHARP sized its gaussians for a 2976 px photograph), so the
        // ratio is tiny and the rescale crushes a 0.99-alpha gaussian to
        // roughly 0.2.
        //
        // Every visible complaint about this panel followed from that. The
        // front of him never accumulated to opaque, so:
        //   • SHARP's dark inpainted second layer showed through as black
        //     speckle over the nose, lips and chin,
        //   • the dome's orange horizon shone through his face, which is what
        //     made him look milky,
        //   • and where the surface is thinnest — his left shoulder — the
        //     background came straight through. Tested by putting a magenta
        //     card behind the bust: the "dark smudge" on his shoulder rendered
        //     MAGENTA. It was never dark gaussians. It was a hole.
        //
        // Turning it off keeps full opacity and costs nothing in sharpness,
        // which is the part widening could not do: splatWidth 1.9 shrank the
        // shoulder hole but softened his eyebrows paying for it.
        antialiased: this.data.antialiased,
        // The scene owns the render loop (xr-frame.js) — this must not try to
        // drive its own, and DropInViewer already forces selfDrivenMode off.
        // Left explicit so a library default change cannot quietly re-enable a
        // second rAF loop inside an immersive session (trap 3.14).
        useBuiltInControls: false
      });

      var s = this.data.splatScale;
      this._fetch(this.data.src).then(function (buf) {
        if (!self.el.parentNode) return null;   // removed while the body was in flight
        self._say('unpacking the gaussians');
        buf = self._condition(buf);
        // The blob is what the library is actually pointed at. See _fetch.
        self._blobUrl = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
        return self.viewer.addSplatScene(self._blobUrl, {
          // A blob: URL has no file extension, and the library picks its parser
          // from one (`sceneFormatFromPath`, which returns null here). Without
          // this it throws "Could not determine file type".
          format: GS.SceneFormat.Splat,
          splatAlphaRemovalThreshold: self.data.alphaThreshold,
          showLoadingUI: false,           // it injects its own DOM spinner otherwise
          // Now only describes how the library ASSEMBLES the buffer, not how it
          // arrives: by this point the bytes are already in memory, so there is
          // no download left for a reveal to overlap with.
          progressiveLoad: self.data.progressive,
          // onProgress(percent, label, status) — status is the library's
          // LoaderStatus enum, whose string form is good enough to show. No
          // byte counts here: this stage is a memcpy, and _fetch already
          // narrated the part that takes time.
          onProgress: function (percent, label, status) {
            var stage = String(status || 'processing').toLowerCase();
            self._say(stage === 'done' ? 'placing him' : stage);
          },
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [s, s, s]
        });
      }).then(function (added) {
        if (added === null) return;             // detached mid-load; nothing to show
        self._releaseBlob();
        // Screen-space gaussian width. Has to be set AFTER the scene is added,
        // because the SplatMesh (and its material, which owns the uniform) is
        // built by addSplatScene — there is nothing to set it on before that.
        if (self.viewer.splatMesh && self.data.splatWidth !== 1) {
          self.viewer.splatMesh.setSplatScale(self.data.splatWidth);
        }
        self.ready = true;
        self.el.setObject3D('splat', self.viewer);
        self._armStereo();
        self._done();
        self.el.emit('splat-portrait-ready', {
          count: self.viewer.splatMesh ? self.viewer.splatMesh.getSplatCount() : 0
        }, false);
      }).catch(function (e) {
        self._releaseBlob();
        self._fail((e && e.message) || String(e));
      });
    },

    // ── Why the splat is fetched HERE, and handed over as a blob ───────────
    // Because `Content-Length` is the length of the bytes ON THE WIRE, and the
    // library reads it as the length of the bytes after decoding.
    //
    // This is the whole of "the 3D gaussians panel is blank on the live site",
    // and it is why it always worked locally. `python3 -m http.server` sends
    // the file as-is; GitHub Pages sends `.splat` (served as
    // application/octet-stream) through gzip, so the same 3,112,512-byte asset
    // arrives as `content-encoding: gzip, content-length: 2764346`. Both are
    // correct HTTP. Then, in SplatLoader.loadFromURL:
    //
    //     maxSplatCount    = fileSize / SplatParser.RowSizeBytes   // 86385.8125
    //     directLoadBufferIn = new ArrayBuffer(fileSize)           // 2,764,346
    //
    // and the read loop copies the DECODED stream into that buffer with
    // `new Uint8Array(directLoadBufferIn, numBytesLoaded, chunk.byteLength)`.
    // Somewhere past 2.7 MB the offset walks off the end, the typed-array
    // constructor throws a RangeError inside the reader loop, and it surfaces
    // as the library's generic `Viewer::addSplatScene -> Could not load file`.
    // Nothing about it hints at the server. On the live site it happened every
    // single time, on desktop and in the headset both, and the panel was
    // simply empty — which is exactly the class of silent failure the watchdog
    // and the busy card in this file were built for.
    //
    // There is no way to ask for an unencoded body: `Accept-Encoding` is a
    // forbidden header name, so `fetch` drops it. The server is GitHub Pages
    // and sends what it sends. So the interposition happens here: `fetch`
    // decodes transparently, `arrayBuffer()` is the true length, and a
    // `blob:` URL of those bytes is served back by the browser with an exact
    // `Content-Length` and no encoding — which makes the library's own fast
    // path correct instead of avoiding it.
    //
    // It costs one extra copy of the asset (3 MB at the LOD, 12 MB at full)
    // held only until addSplatScene resolves, and it buys real byte progress
    // on the busy card, which the old `percent`-as-bytes call never gave.
    _fetch: function (url) {
      var self = this;
      this._wire = { url: url, encoding: null, contentLength: null, bytes: 0 };
      return fetch(url, { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText + ' for ' + url);
        var enc = res.headers.get('content-encoding');
        var len = parseInt(res.headers.get('content-length'), 10);
        self._wire.encoding = enc || 'identity';
        self._wire.contentLength = isFinite(len) ? len : null;
        // No streams (or an opaque body): still correct, just no progress.
        if (!res.body || !res.body.getReader) return res.arrayBuffer();

        var reader = res.body.getReader();
        var chunks = [], got = 0;
        return (function pump() {
          return reader.read().then(function (r) {
            if (r.done) {
              var out = new Uint8Array(got), at = 0;
              for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], at); at += chunks[i].length; }
              return out.buffer;
            }
            chunks.push(r.value);
            got += r.value.length;
            // Quote a total only while it is still credible. `got` counts
            // DECODED bytes and contentLength counts encoded ones, so on a
            // compressed body the two are not comparable and the bar would
            // sail past 100%. Past that point the card shows a byte count
            // against an indeterminate bar, which is the honest reading.
            var total = (self._wire.contentLength && got <= self._wire.contentLength)
              ? self._wire.contentLength : 0;
            self._say('downloading the gaussians', got, total);
            return pump();
          });
        })();
      }).then(function (buf) {
        self._wire.bytes = buf.byteLength;
        // 32 bytes per gaussian: 3 float32 centre, 3 float32 scale, 4 uint8
        // colour, 4 uint8 rotation. A body that is not a whole number of rows
        // is not a .splat, whatever the server thought it was sending — and
        // saying which number was wrong beats "could not load file".
        if (!buf.byteLength) throw new Error('empty response from ' + url);
        if (buf.byteLength % 32) {
          throw new Error(buf.byteLength + ' bytes is not a whole number of 32-byte gaussians');
        }
        return buf;
      });
    },

    // ── Conditioning the bytes on the way past ────────────────────────────
    // Only possible because _fetch now holds the whole asset (see the note
    // there), and worth doing precisely because the bake cannot be re-run:
    // `vr/tools/sharp/export_assets.py` needs the SHARP output it was baked
    // from — `seb_f30.ply` and `z_f30.npy` — and those are not in this repo
    // and are not on this machine any more. `portrait.splat` IS the source
    // now, so it is left byte-for-byte alone and shaped here instead, where
    // the reasoning is next to the numbers and `fadeBottom: 0` undoes it.
    //
    // 32-byte rows, so this is one pass of integer arithmetic over 97k (or
    // 385k) rows — under 5 ms, against a download measured in seconds.
    _condition: function (buf) {
      var trimPct = this.data.trimBottom;
      var fade = this.data.fadeBottom;
      if (!(trimPct > 0) && !(fade > 0)) return buf;
      var n = buf.byteLength / 32;
      var f32 = new Float32Array(buf);
      var u8 = new Uint8Array(buf);
      var i, y, b;

      // Heights, and the cut taken as a PERCENTILE of them rather than a
      // hardcoded y. That way the same numbers land correctly on the LOD and
      // on the full splat (their shapes are identical, their counts are not),
      // and they would survive a re-bake at a different framing.
      var ys = new Float32Array(n);
      for (i = 0; i < n; i++) ys[i] = f32[i * 8 + 1];
      var sorted = Float32Array.from(ys).sort();
      var pick = function (pct) {
        return sorted[Math.min(n - 1, Math.max(0, Math.round(pct / 100 * (n - 1))))];
      };
      var yCut = trimPct > 0 ? pick(trimPct) : sorted[0];
      var yFade = yCut + fade;

      var trimmed = 0, darkened = 0;
      for (i = 0; i < n; i++) {
        y = ys[i];
        b = i * 32;
        if (y < yCut) {
          // Zeroed rather than spliced out: the library's own
          // `splatAlphaRemovalThreshold` drops the rows as it parses, so they
          // cost nothing to draw and nothing to sort, and this stays a single
          // in-place walk with no reallocation of a 12 MB buffer.
          u8[b + 27] = 0;
          trimmed++;
          continue;
        }
        if (fade > 0 && y < yFade) {
          // Smoothstep, so there is no corner at the top of the ramp. A linear
          // one puts a visible horizontal band across a plain white shirt.
          var t = (y - yCut) / fade;
          var k = t * t * (3 - 2 * t);
          u8[b + 24] *= k;
          u8[b + 25] *= k;
          u8[b + 26] *= k;
          darkened++;
        }
      }
      this._wire.trimmed = trimmed;
      this._wire.darkened = darkened;
      this._wire.endsAt = +yCut.toFixed(4);

      // ── Drop the invented layer where it can be seen to be wrong ─────────
      // One grid pass. He faces +z and the viewer looks down -z, so within a
      // cell the LARGEST z is the surface the camera saw and everything behind
      // it is either the same surface seen thick or SHARP's inpainting.
      var back = this.data.occludeBehind;
      var minContrast = this.data.occludeContrast;
      var lumOf = function (j) {
        var o = j * 32;
        return 0.299 * u8[o + 24] + 0.587 * u8[o + 25] + 0.114 * u8[o + 26];
      };
      if (back > 0 && minContrast > 0) {
        // 220 cells across a 0.45 m bust is ~2 mm per cell — fine enough that a
        // cell is one patch of surface, coarse enough that every occupied cell
        // holds a few gaussians rather than one.
        var G = 220;
        var xlo = Infinity, xhi = -Infinity, ylo2 = Infinity, yhi2 = -Infinity;
        for (i = 0; i < n; i++) {
          if (!u8[i * 32 + 27]) continue;              // already removed above
          var xv = f32[i * 8];
          if (xv < xlo) xlo = xv;
          if (xv > xhi) xhi = xv;
          if (ys[i] < ylo2) ylo2 = ys[i];
          if (ys[i] > yhi2) yhi2 = ys[i];
        }
        var sx = G / Math.max(xhi - xlo, 1e-6), sy = G / Math.max(yhi2 - ylo2, 1e-6);
        var cellOf = new Int32Array(n);
        var frontZ = new Float32Array(G * G);
        var frontIx = new Int32Array(G * G);
        for (i = 0; i < G * G; i++) { frontZ[i] = -Infinity; frontIx[i] = -1; }
        var cx, cy, cellIx, zv;
        for (i = 0; i < n; i++) {
          if (!u8[i * 32 + 27]) { cellOf[i] = -1; continue; }
          cx = (f32[i * 8] - xlo) * sx | 0;
          cy = (ys[i] - ylo2) * sy | 0;
          if (cx < 0) cx = 0; else if (cx >= G) cx = G - 1;
          if (cy < 0) cy = 0; else if (cy >= G) cy = G - 1;
          cellIx = cy * G + cx;
          cellOf[i] = cellIx;
          // Only reasonably opaque gaussians get to DEFINE the surface; a
          // faint one in front of the face is haze, not the face.
          if (u8[i * 32 + 27] > 96) {
            zv = f32[i * 8 + 2];
            if (zv > frontZ[cellIx]) { frontZ[cellIx] = zv; frontIx[cellIx] = i; }
          }
        }
        var hidden = 0;
        for (i = 0; i < n; i++) {
          cellIx = cellOf[i];
          if (cellIx < 0) continue;
          var fi = frontIx[cellIx];
          if (fi < 0 || fi === i) continue;
          if (frontZ[cellIx] - f32[i * 8 + 2] <= back) continue;
          if (lumOf(fi) - lumOf(i) < minContrast) continue;   // no contrast, no smudge
          u8[i * 32 + 27] = 0;
          hidden++;
        }
        this._wire.hiddenLayer = hidden;
      }


      // ── Desaturate, last, so the two passes above see real colours ───────
      var ds = this.data.desaturate;
      if (ds > 0) {
        var gain = this.data.desaturateGain;
        for (i = 0; i < n; i++) {
          b = i * 32;
          if (!u8[b + 27]) continue;
          var g = (0.299 * u8[b + 24] + 0.587 * u8[b + 25] + 0.114 * u8[b + 26]) * gain;
          if (g > 255) g = 255;
          u8[b + 24] += (g - u8[b + 24]) * ds;
          u8[b + 25] += (g - u8[b + 25]) * ds;
          u8[b + 26] += (g - u8[b + 26]) * ds;
        }
      }
      return buf;
    },

    _releaseBlob: function () {
      if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
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
      // ── The watchdog: loaded, and drawing nothing ────────────────────
      // Sebastian, after a headset pass: *"the 3D Gaussian splat is still not
      // rendering."* Every failure mode this component has left is SILENT and
      // looks identical from inside a headset — empty space where a bust
      // should be — and §3.16 means there is no console to ask.
      //
      // `instanceCount` is the one number that separates them: it is what the
      // sort worker writes, and it is 0 for a splat that downloaded perfectly,
      // parsed perfectly, and has never been ordered. So: if the viewer is
      // ready and nothing is being drawn, force a sort rather than waiting for
      // the head to move past the gate — and if it is STILL zero after a few
      // seconds of trying, say so on the busy card, because "it did not work"
      // is worth more to someone wearing a headset than an empty patch of dome.
      //
      // Bounded on purpose. This is a recovery path, not a render loop: five
      // attempts a second apart, then it gives up and reports.
      var mesh = this.viewer.splatMesh;
      var drawn = mesh && mesh.geometry ? (mesh.geometry.instanceCount || 0) : 0;
      if (!drawn) {
        var now = performance.now();
        if (!this._blankSince) this._blankSince = now;
        if (now - this._blankSince > 900) {
          this._blankSince = now;
          this._blankTries = (this._blankTries || 0) + 1;
          if (this._blankTries <= 5) { this.resort(); return; }
          if (this._blankTries === 6) {
            var n = mesh && mesh.getSplatCount ? mesh.getSplatCount() : 0;
            this._say(n
              ? 'gaussians loaded (' + n + ') but the sort never returned'
              : 'gaussians loaded but the scene is empty');
            var self2 = this;
            setTimeout(function () { self2._done(); }, 5200);
          }
          return;
        }
      } else if (this._blankSince) {
        this._blankSince = 0;
        this._blankTries = 0;
      }

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
    //
    // `?xrdiag=1` now prints this as a second section on xr-diag.js's card,
    // and re-raises the card when the portrait lab opens so the two can
    // actually be on screen together. That sentence USED TO BE HERE AND WAS
    // FALSE: nothing in the repo read VRSplatDiag, so every number below was
    // reachable only from a console, on the one panel whose every failure mode
    // looks like an empty patch of dome. Three passes of careful diagnostics
    // that could not be read where they were needed. If you add a field here,
    // add its row in xr-diag.js's splatFmt().
    //
    // Cheap, no allocation, safe to call from a sampler.
    diag: function () {
      var v = this.viewer && this.viewer.viewer;
      var mesh = this.viewer && this.viewer.splatMesh;
      var renderer = this.el.sceneEl && this.el.sceneEl.renderer;
      // `data` is populated by A-Frame AFTER the component object exists, so a
      // sampler that catches the gap gets an object with no data and this
      // threw on `this.data.src`. Which defeats the point of a diagnostic
      // whose whole job is to be safe to call at any moment — and it threw
      // inside VRSplatDiag, i.e. inside the thing you reach for when the panel
      // is blank.
      var d = this.data || {};
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
        src: d.src,
        // The two quality knobs, on the card because they are the answer to
        // "why does he look like that" and they differ per asset.
        splatWidth: mesh ? mesh.splatScale : d.splatWidth,
        fadeBottom: d.fadeBottom,
        // What the SERVER said versus what actually arrived. `encoding` other
        // than identity with `bytes` != `contentLength` is the normal, healthy
        // reading on GitHub Pages — and it is the state that used to break the
        // load outright (see _fetch). Kept on the card so the next blank panel
        // can be told apart from this one in a headset, where there is no
        // network tab either (§3.16).
        wire: this._wire || null
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
        // FORCE A RE-SORT ON EVERY SESSION CHANGE. `webXRActive` switches the
        // library's `adjustForWebXRStereo` on and off, which rescales the
        // splats' render dimensions by the ratio of the flat projection to the
        // per-eye one — so the geometry that was sorted a moment ago was sorted
        // for a different projection. Nothing else would trigger it: tick()'s
        // gate is on how far the HEAD has moved, and putting a headset on does
        // not move the head. The result is a splat that looked right on the
        // monitor and is wrong (or absent) for the whole first still moment of
        // the session, which is exactly when someone decides it is broken.
        // Also reset the watchdog: this is a fresh chance to draw.
        self._blankSince = 0;
        self._blankTries = 0;
        if (self.resort) self.resort();
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
      // And a blob: URL torn down mid-load pins its whole ArrayBuffer — 12 MB
      // at full quality — until the document goes away.
      this._releaseBlob();
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
