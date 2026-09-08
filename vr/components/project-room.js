/* ═══ project-room.js ═══
   The "elegant world transform" (§7 of VR_BUILD_SPEC.md): selecting a
   project doesn't just link out — it transforms the whole dome into that
   project's own themed room, styled after the real project page's own color
   tokens (see themes.js). A calm "← Return to dome" eases back.

   A themed room retints THREE things, not just one: the dome sky/horizon,
   the floor, and — new — the scene's actual ambient/key lights (previously
   only the dome elements changed; the real lighting stayed dusk-colored, so
   a room never quite stopped feeling like the hub with a different
   backdrop). It also arranges up to 4 of the project's own real gallery
   images (data-loader.js's `roomImages`, pulled live from the project's own
   page) as small feathered glass cards around the visitor, tilted to face
   them — the room actually holds the project's images now, not one flat
   hero. Projects with no photography (the four PDF write-up pages) simply
   skip the gallery and stay text-forward — never blocked on missing assets.

   Rough-pass transition: cross-fade the hub out / room in over ~500ms.
   Respects reduced-motion (instant swap, no fade) per the addendum.

   Usage: VRProjectRoom.enter(project); VRProjectRoom.exit();
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TRANSITION_MS = 1400; // full dip-to-dark-and-emerge, within §7's 1.2–2s

  // Read from the DOM, never a hardcoded id list: this used to be five ids that
  // silently missed #writingConstellation (VR_TEST_REPORT B1) — the writing
  // cards stayed visible AND clickable inside every room, so a visitor could
  // open the PDF reader on top of an open room. See the .hub-cluster comment in
  // index.html. Queried per call rather than cached, because the clusters are
  // populated after load and a cached NodeList would freeze that moment.

  // The scene's base lighting used to be hand-copied here as two constants
  // "matching the <a-light> defaults in index.html". They had drifted: the key
  // restored #e0a878 @ 0.15 against an authored #ffc98a @ 1.5 — 10x too dim
  // plus a colour shift — and only #keyLight was touched at all, so the other
  // three fixtures kept the room's colour for the rest of the session. Net
  // effect: every room visit permanently dimmed the hub's lit glass by ~17%.
  // Nothing is copied now; both are snapshotted from the live markup below.
  var ambientBase = null;

  // Snapshot the authored ambient once, before the first retint. The key-light
  // rack's snapshot lives in glass-material.js's vr-key-light system (it owns
  // the rack and the room-colour mirroring), so both come from index.html.
  function captureBaseLights() {
    if (ambientBase) return;
    var ambient = document.querySelector('#ambientLight');
    var l = ambient && ambient.getAttribute('light');
    if (l) ambientBase = { color: l.color, intensity: l.intensity };
  }

  // Resolved per call, never cached: the rug is authored in index.html but its
  // component may not have initialised when this file loads, and a cached null
  // would silently disable rug theming for the whole session.
  function rugComponent() {
    var el = document.querySelector('[dusk-rug]');
    var c = el && el.components && el.components['dusk-rug'];
    return (c && c.setColor) ? c : null;
  }

  // Dark halo for any text a room floats over its own themed background. 8% of
  // the glyph size, not a hairline: at 5% the tags still measured 4.3:1 against
  // the pendant theme's near-white floor.
  var ROOM_HALO = { outlineWidth: '8%', outlineColor: '#0b0a08', outlineOpacity: 1, outlineBlur: '10%' };

  var state = { open: false, roomEl: null, transTween: null, video: null };

  // A <video> is the one thing a room builds that keeps working after its
  // object3D is gone: removeChild unlinks the mesh, but the element carries on
  // decoding and the VideoTexture carries on uploading a frame per frame, for
  // the rest of the session. disposeSubtree cannot help — it frees textures it
  // tagged, and a VideoTexture wraps a DOM element rather than a decoded
  // image. So it is stopped and emptied explicitly.
  function releaseVideo() {
    var v = state.video;
    if (!v) return;
    state.video = null;
    try {
      v.video.pause();
      // Emptying the source list and reloading is what actually makes the
      // browser drop the decoder and the buffered data; pause() alone leaves
      // both resident.
      while (v.video.firstChild) v.video.removeChild(v.video.firstChild);
      v.video.removeAttribute('src');
      v.video.load();
      if (v.video.parentNode) v.video.parentNode.removeChild(v.video);
    } catch (e) { /* a torn-down element is fine to fail on */ }
    if (v.texture) v.texture.dispose();
    if (v.mesh) {
      if (v.mesh.geometry) v.mesh.geometry.dispose();
      if (v.mesh.material) v.mesh.material.dispose();
    }
  }


  // Every selection ray in the scene (the camera cursor + both hand
  // controllers) caches its list of `.clickable` targets and only rebuilds it
  // when marked dirty. A project room — and its "← Return to dome" button — is
  // created and appended *after* load, at the transition's dark peak; unlike
  // the persistent #focusStage, its button isn't in any raycaster's list yet.
  // A-Frame's own MutationObserver eventually catches it, but that's a frame-
  // timing gamble that in-headset lost often enough that Return read as dead
  // (ISSUE-01): the ray had no target to hit, so the pinch/tap fell through.
  // Refresh every clickable ray explicitly the moment the room is in the graph,
  // so the button is a live hit target on the very first look — no dropped taps.
  function refreshClickableRaycasters() {
    ['#head [cursor]', '#leftHand', '#rightHand'].forEach(function (sel) {
      var el = document.querySelector(sel);
      var rc = el && el.components && el.components.raycaster;
      if (rc) rc.refreshObjects();
    });
  }

  function setHubVisible(visible) {
    [].slice.call(document.querySelectorAll('.hub-cluster')).forEach(function (el) {
      el.setAttribute('visible', visible);
    });
  }

  // The viewer's current heading (yaw only) in world space, captured the moment
  // a room opens. The room's whole content column is authored facing local -Z;
  // rotating the room container by this yaw makes that forward align with wherever
  // the viewer is actually looking — so the title + gallery spawn front-and-centre
  // instead of wherever world -Z happens to be (ISSUE-02). Yaw only: pitch/roll are
  // dropped so a head tilt can't cant the room. Captured ONCE here (the room stays
  // put afterward) — it anchors to the entry pose, it doesn't follow the head.
  function currentHeadYawDeg() {
    var head = document.querySelector('#head');
    if (!head) return 0;
    var q = new THREE.Quaternion();
    head.object3D.getWorldQuaternion(q);
    var fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    if (Math.abs(fwd.x) < 1e-6 && Math.abs(fwd.z) < 1e-6) return 0; // looking straight up/down
    // A room rotated rotation.y = θ points its local -Z to world (-sinθ, -cosθ);
    // solve that against the gaze forward so the room faces exactly where the
    // viewer looks (setting rotation.y = -atan2(fwd.x, fwd.z) would double the
    // offset instead of cancelling it — the sign matters).
    return THREE.MathUtils.radToDeg(Math.atan2(-fwd.x, -fwd.z));
  }

  // Recolor the SINGLE key light to the theme (VR_POLISH_STANDARDS.md §2) —
  // never its direction or the ambient fill. The ambient stays a constant low
  // neutral fill so shadows/tone read consistently scene-wide; only the key's
  // colour temperature shifts per room (warmer for Time Collector, cooler for
  // Chess, etc.). Direction is fixed in index.html and never touched here.
  // (The hub's glass panels are self-lit by design — they glow against the
  // dark rather than being lit by this key; the key light governs any lit
  // content, e.g. future 3D models on pedestals, and sets the one direction
  // convention the whole scene shares.)
  function retintLights(color, intensity) {
    var key = document.querySelector('#keyLight');
    if (key) key.setAttribute('light', { color: color, intensity: intensity });
  }

  function resetLights() {
    var ambient = document.querySelector('#ambientLight');
    if (ambient && ambientBase) ambient.setAttribute('light', ambientBase);
    // Restores colour AND intensity on all four .key-light fixtures from their
    // authored values, and clears the mirror's cached colour so it doesn't
    // immediately re-spread the lead's colour over the rest of the rack.
    if (window.VRGlass && VRGlass.restoreKeyRack) VRGlass.restoreKeyRack();
  }

  // Places a plain feathered-image glass card at (angleDeg, radius, height),
  // tilted to face a seated eye-level viewer — same outer-rotates/inner-
  // translates-then-tilts pattern as constellation.js's place(), but simpler
  // (no title/caption/click — these are decorative room dressing, not
  // navigable tiles).
  // Trim an alt string into a short one/two-line image caption.
  function shortCaption(alt) {
    alt = (alt || '').replace(/\s+/g, ' ').trim();
    if (alt.length > 78) alt = alt.slice(0, 76).replace(/[\s,.;:]+\S*$/, '') + '…';
    return alt;
  }

  function placeImageCard(container, image, angleDeg, radius, height, accent, a11y) {
    var eyeHeight = 1.6;
    var w = 0.62, h = 0.8;

    var outer = document.createElement('a-entity');
    outer.setAttribute('rotation', { x: 0, y: angleDeg, z: 0 });
    var inner = document.createElement('a-entity');
    inner.setAttribute('position', { x: 0, y: height, z: -radius });
    inner.setAttribute('rotation', { x: THREE.MathUtils.radToDeg(Math.atan2(height - eyeHeight, radius)), y: 0, z: 0 });

    var frame = new THREE.Mesh(new THREE.PlaneGeometry(w, h), VRGlass.makeCardMaterial(w, h, 0.045, accent, 0, 0.5));
    var img = VRGlass.makeFeatheredImage(image.src, w - 0.06, h - 0.06, 0.08, 1024);
    img.position.z = 0.008;

    var wrap = document.createElement('a-entity');
    wrap.object3D.add(frame);
    wrap.object3D.add(img);
    inner.appendChild(wrap);

    // Short description for each image (from its alt text) — visible on entry,
    // no interaction needed. Floats ABOVE the frame.
    if (image.alt) {
      var cap = document.createElement('a-entity');
      // Above, not below, for two reasons. It is what the hub already does
      // ("Caption, floating ABOVE the card" — hub-panel.js, same 0.026 gap and
      // the same baseline:'bottom' so the block grows upward away from the
      // card); these room captions were the only ones in the scene hanging the
      // other way. And below the card is where the horizon band is: a caption
      // at ~16° under the eye landed in it, which is what made Bastón's read
      // as text on magenta. Above the card clears the band in every room.
      //
      // Keeps the ROOM_HALO either way — a caption still crosses a themed sky
      // whose colour this function cannot know, and full opacity for the same
      // reason the tags are: dimming text short of contrast costs more of it.
      cap.setAttribute('troika-text', {
        value: shortCaption(image.alt), align: 'center', anchor: 'center', baseline: 'bottom',
        color: '#f5f5f0', fillOpacity: 1, font: VRFonts.body(),
        fontSize: VRType.label(), maxWidth: w + 0.14, lineHeight: 1.2,
        outlineWidth: ROOM_HALO.outlineWidth, outlineColor: ROOM_HALO.outlineColor,
        outlineOpacity: ROOM_HALO.outlineOpacity, outlineBlur: ROOM_HALO.outlineBlur
      });
      cap.setAttribute('position', { x: 0, y: h / 2 + 0.026, z: 0.01 });
      inner.appendChild(cap);
    }

    outer.appendChild(inner);
    container.appendChild(outer);
  }

  // ── Which way round, and what is awake ───────────────────────────────────
  // Two jobs, one piece of maths, so they share a component rather than each
  // computing "where is the viewer looking" separately.
  //
  // 1. THE DIRECTION CUE, shown not told. A travelling brightness runs through
  //    the stations in order — station 1 wakes, then 2, then 3 — so the room
  //    itself keeps sweeping clockwise and your eye follows it. It rides
  //    `uHover`, the card shader's existing "wake amount" (glass-material.js),
  //    which already lifts the accent, the border, the glow and the alpha
  //    together. So this is the same visual language as hovering a card, used
  //    as a hint instead of as feedback — no arrows to read, no copy to
  //    translate, nothing that says "turn right".
  //
  // 2. IDLE, for the one thing where it is genuinely expensive. A playing video texture
  //    re-uploads a frame to the GPU every frame regardless of whether it is
  //    on screen, so Slip Door's hero pauses when you are looking away from it
  //    and resumes before you come back. The thresholds are asymmetric on
  //    purpose (resume at 120°, pause at 150°): a single threshold flaps
  //    on/off when you sit right at the boundary, and restarting a decoder
  //    repeatedly is worse than letting it run.
  //
  //    Generous, per Sebastian: resuming at 120° means it is already playing
  //    well before it enters view, so it is never caught starting up.
  var WAVE_PERIOD_MS = 5200;   // one full lap of the wave
  var WAVE_SPREAD = 0.55;      // how much of the lap separates neighbours
  var WAVE_AMP = 0.42;         // peak uHover; a hover is 1.0, so this stays a hint
  var VIDEO_RESUME_DEG = 120, VIDEO_PAUSE_DEG = 150;

  AFRAME.registerComponent('room-walk', {
    // `|| this.x` rather than plain assignment, because init is NOT guaranteed
    // to run before the room registers its stations. The room is built inside
    // the transition's callback and its `loaded` handler can fire either side
    // of component init — so registration has to be order-independent in both
    // directions: addStation creates the array if init hasn't run, and init
    // must not then wipe what was already registered.
    init: function () {
      this.stations = this.stations || [];
      this.video = this.video || null;
      this.head = document.querySelector('#head');
      this._fwd = new THREE.Vector3();
      this._to = new THREE.Vector3();
      this._hp = new THREE.Vector3();
      this._sp = new THREE.Vector3();
      this._q = new THREE.Quaternion();
    },

    addStation: function (entry, index) {
      if (!this.stations) this.stations = [];
      this.stations.push({
        el: entry.el, at: entry.at || entry.el, index: index,
        mat: entry.material, focus: entry.focus
      });
    },
    setVideo: function (rec) { this.video = rec; },

    // Off-axis angle between where the viewer faces and where `obj` is, both
    // flattened to the horizontal plane. Deliberately computed from vectors
    // rather than from yaw arithmetic: the room is itself rotated to the entry
    // heading, and every previous attempt in this file to reason about angles
    // through that rotation got a sign wrong (see currentHeadYawDeg's note).
    offAxisDeg: function (obj) {
      if (!this.head) return 0;
      this.head.object3D.getWorldPosition(this._hp);
      this.head.object3D.getWorldQuaternion(this._q);
      this._fwd.set(0, 0, -1).applyQuaternion(this._q);
      this._fwd.y = 0;
      if (this._fwd.lengthSq() < 1e-8) return 0;   // looking straight up or down
      this._fwd.normalize();
      obj.getWorldPosition(this._sp);
      this._to.subVectors(this._sp, this._hp);
      this._to.y = 0;
      if (this._to.lengthSq() < 1e-8) return 0;
      this._to.normalize();
      return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(this._fwd.dot(this._to), -1, 1)));
    },

    tick: function (time, dt) {
      // Guarded because tick is not guaranteed to run after init here: the room
      // is built inside the transition's callback, mid-frame, and both the dev
      // harnesses and _dev-camera-path pump sceneEl.tick() by hand. Without
      // this, a hand-pumped tick on a freshly attached room throws on
      // `stations.length` and takes the whole frame with it.
      if (!this.stations) return;
      // The wave is motion, so reduced motion gets none of it — but it must
      // still leave the stations in a legible resting state rather than dark,
      // hence a flat low wake instead of zero.
      var n = this.stations.length;
      for (var i = 0; i < n; i++) {
        var st = this.stations[i];
        // The document station grows/shrinks by how far off-axis it is. Driven
        // from here so there is one place that answers "where is the viewer
        // looking", and so the easing runs on the scene's own clock.
        if (st.focus && st.at) st.focus(this.offAxisDeg(st.at.object3D), dt);
        if (!st.mat || !st.mat.uniforms || !st.mat.uniforms.uHover) continue;
        if (reducedMotion) { st.mat.uniforms.uHover.value = 0.12; continue; }
        var phase = (time % WAVE_PERIOD_MS) / WAVE_PERIOD_MS - (st.index / Math.max(1, n)) * WAVE_SPREAD;
        // Only the crest shows: a full sine would light everything half the
        // time and read as a throb rather than as a direction.
        var pulse = Math.sin(phase * Math.PI * 2);
        st.mat.uniforms.uHover.value = pulse > 0 ? WAVE_AMP * pulse * pulse : 0;
      }

      if (this.video && this.video.video) {
        var deg = this.offAxisDeg(this.video.mesh);
        var v = this.video.video;
        if (deg < VIDEO_RESUME_DEG && v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else if (deg > VIDEO_PAUSE_DEG && !v.paused) { v.pause(); }
      }
    }
  });

  // ── One station on the walk round ───────────────────────────────────────
  // A station is ONE footprint whatever it holds — a single photo or a mosaic
  // of four. That is deliberate: the stations are beads on a circle, and a
  // 4-image station drawn four times the area of a 1-image one would read as
  // four separate things rather than one phase of the build. So the box is
  // fixed and the images TILE inside it.
  //
  // 0.86 x 0.62 at radius 1.85 subtends 26.4°. With the widest real station
  // count (5 -> 60° spacing) that leaves a 33.6° gap between neighbours, so no
  // two stations overlap on screen — which matters more here than anywhere
  // else in the scene, because everything in a room is renderOrder 0 and
  // overlapping quads paint in scene-graph order rather than by depth (§3.6).
  var ST_W = 0.86, ST_H = 0.62;
  var ST_GAP = 0.014;          // between mosaic cells
  var ST_Y = 1.56;             // station centre height

  // How many texels a surface of `metres` at `dist` actually deserves. 30 px
  // per degree is chosen with headroom: a Quest 3 is ~20 and a Vision Pro
  // higher, and the images are cover-fitted so some of the texture is cropped
  // away unseen. Snapped UP to a familiar size so the GPU gets round numbers,
  // and clamped — 128 is the floor below which a thumbnail turns to mush, 1024
  // the ceiling nothing in a room needs.
  var PX_PER_DEG = 30;
  function texelsFor(metres, dist) {
    var deg = 2 * THREE.MathUtils.radToDeg(Math.atan((metres / 2) / dist));
    var want = deg * PX_PER_DEG;
    var steps = [128, 256, 384, 512, 768, 1024];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= want) return steps[i];
    return 1024;
  }

  // Rows/cols per image count. 3 deliberately goes 2-over-1 rather than 3 in a
  // row: three cells across an 0.86 m box are 0.27 m wide, which at 1.85 m is
  // too small to read as anything.
  function mosaicGrid(n) {
    if (n <= 1) return [[1]];
    if (n === 2) return [[1, 1]];
    if (n === 3) return [[1, 1], [1]];
    return [[1, 1], [1, 1]];   // 4+ -> 2x2, extras are dropped by the caller
  }

  // ── The document station ────────────────────────────────────────────────
  // Some projects end in a written analysis rather than a photograph — Time
  // Collector's FEA study is the only one today (4 pages, already pre-rendered
  // in vr/assets/pages by .tools/vr-make-pages.py). It becomes the last
  // station on the walk, because that is where it comes in the story.
  //
  // It GROWS IN PLACE instead of opening the reading room. Sebastian's call,
  // and the reason matters: a page at station size (0.62 m tall at 2 m) has
  // body text about 0.2° high, which is illegible on any headset made — but
  // opening the real reader would evict the room (place.js) and take you out
  // of Time Collector to read Time Collector's own document. So the station
  // eases up to 1.7 m when you look at it and eases back down when you look
  // away. The growing IS the affordance: no button, nothing to read first.
  //
  // ONE page texture is resident at a time, which is the reader's own
  // discipline (it keeps a ±1 window and never more than 3 pages). Four pages
  // at 1024 would be ~13 MB standing in a room the whole time it is open, to
  // show one of them.
  var PDF_COVER_H = 0.62;      // matches a photo station's height
  var PDF_GROWN_H = 1.70;      // readable; the reading room itself uses ~1.95
  var PDF_FOCUS_DEG = 26;      // start growing inside this
  var PDF_BLUR_DEG = 40;       // start shrinking outside this (hysteresis)
  var PDF_EASE_MS = 260;

  function pageManifest(pdfPath) {
    if (!pdfPath || !window.VR_PAGES) return null;
    // Keyed by bare filename — data-loader roots the href, the manifest does not.
    var file = String(pdfPath).split('/').pop();
    return window.VR_PAGES[file] || null;
  }

  // A real triangle, not a glyph. The Syne subset has no Geometric Shapes
  // block and would silently drop an arrow character — the same trap that
  // makes the reader's own scroll arrows geometry (see §3.7).
  function triangle(size, up, color) {
    var g = new THREE.BufferGeometry();
    var s = size, y = up ? 1 : -1;
    g.setAttribute('position', new THREE.Float32BufferAttribute(
      [-s, -s * 0.6 * y, 0, s, -s * 0.6 * y, 0, 0, s * 0.8 * y, 0], 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false
    }));
  }

  function placePdfStation(container, project, index, total, angleDeg, radius, accent) {
    var man = pageManifest(project.pdf);
    if (!man || !man.files || !man.files.length) return null;

    var aspect = man.aspect || (man.w && man.h ? man.w / man.h : 0.7727);
    var outer = document.createElement('a-entity');
    outer.setAttribute('rotation', { x: 0, y: angleDeg, z: 0 });
    var inner = document.createElement('a-entity');
    inner.setAttribute('position', { x: 0, y: ST_Y, z: -radius });
    inner.setAttribute('rotation', {
      x: THREE.MathUtils.radToDeg(Math.atan2(ST_Y - EYE_Y, radius)), y: 0, z: 0
    });

    // Authored at COVER size; the whole group is scaled up to grow, so the
    // plate's corner radius grows with it rather than staying a hairline.
    var w = PDF_COVER_H * aspect, h = PDF_COVER_H;
    var wrap = document.createElement('a-entity');
    var plate = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 0.05, h + 0.05),
      VRGlass.makeCardMaterial(w + 0.05, h + 0.05, 0.03, accent, 0, 0.5)
    );
    wrap.object3D.add(plate);

    // The page itself. A plain textured plane, not the feathered image shader:
    // a document should have a hard edge like paper, and feathering the margin
    // eats the first line of text.
    var pageMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false });
    var pageMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), pageMat);
    pageMesh.position.z = 0.006;
    wrap.object3D.add(pageMesh);

    var st = {
      page: 0, tex: null, loading: false,
      grown: 0,           // 0..1, eased in room-walk's tick
      focused: false
    };

    function showPage(i) {
      if (i < 0 || i >= man.files.length || st.loading) return;
      st.loading = true;
      var url = '/vr/assets/pages/' + man.dir + '/' + man.files[i];
      // 1024 because it has to survive being 1.7 m tall; the cover is the same
      // texture shown small, which costs nothing extra.
      var tex = VRGlass.loadTexture(url, function () {
        st.loading = false;
        // Swap only once the new page has actually arrived, so navigating
        // never flashes an empty plate.
        var old = st.tex;
        st.tex = tex;
        st.page = i;
        pageMat.map = tex;
        pageMat.opacity = 1;
        pageMat.needsUpdate = true;
        if (old) old.dispose();       // one page resident, per the header note
        if (label) label.setAttribute('troika-text', 'value', (i + 1) + ' / ' + man.files.length);
      }, function () { st.loading = false; });
    }

    // Page counter + the two arrows, all hidden until grown — at cover size
    // they would be unreadable clutter, and there is nothing to navigate until
    // you can read the page.
    var controls = document.createElement('a-entity');
    var label = document.createElement('a-entity');
    label.setAttribute('troika-text', {
      value: '1 / ' + man.files.length, align: 'center', anchor: 'center', baseline: 'top',
      color: '#f5f5f0', fillOpacity: 1, font: VRFonts.body(),
      fontSize: VRType.label() * 0.8, maxWidth: w,
      outlineWidth: ROOM_HALO.outlineWidth, outlineColor: ROOM_HALO.outlineColor,
      outlineOpacity: ROOM_HALO.outlineOpacity, outlineBlur: ROOM_HALO.outlineBlur
    });
    label.setAttribute('position', { x: 0, y: -h / 2 - 0.03, z: 0.01 });
    controls.appendChild(label);

    [{ up: true, d: -1 }, { up: false, d: 1 }].forEach(function (spec) {
      var btn = document.createElement('a-entity');
      var tri = triangle(0.035, spec.up, '#f5f5f0');
      btn.object3D.add(tri);
      // A generous invisible hit target around a small triangle — ui-button's
      // scene-wide minimum applies to anything selectable, and a 3.5 cm arrow
      // is far under it.
      var hit = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.11),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      btn.object3D.add(hit);
      btn.setAttribute('position', { x: w / 2 + 0.11, y: spec.up ? 0.09 : -0.09, z: 0.01 });
      btn.classList.add('clickable');
      btn.addEventListener('click', function () { showPage(st.page + spec.d); });
      controls.appendChild(btn);
    });
    controls.setAttribute('visible', false);
    wrap.appendChild(controls);

    inner.appendChild(wrap);

    // Heading, same shape as a photo station's so it reads as one of the set.
    var head = document.createElement('a-entity');
    head.setAttribute('troika-text', {
      value: (index + 1) + ' / ' + total + '   ' + (project.pdfLabel || 'Document'),
      align: 'center', anchor: 'center', baseline: 'bottom',
      color: '#f5f5f0', fillOpacity: 1, font: VRFonts.body(),
      fontSize: VRType.label(), maxWidth: ST_W + 0.2, lineHeight: 1.2,
      outlineWidth: ROOM_HALO.outlineWidth, outlineColor: ROOM_HALO.outlineColor,
      outlineOpacity: ROOM_HALO.outlineOpacity, outlineBlur: ROOM_HALO.outlineBlur
    });
    head.setAttribute('position', { x: 0, y: PDF_COVER_H / 2 + 0.05, z: 0.01 });
    inner.appendChild(head);

    outer.appendChild(inner);
    container.appendChild(outer);
    showPage(0);   // the cover, eagerly: it is on screen from the moment you arrive

    // Eased by room-walk rather than GSAP on purpose. Every tween in the scene
    // rides gsap.ticker, which is not serviced inside an immersive session
    // without xr-frame's pump (§3.14) — and a panel that grows only sometimes
    // is worse than one that grows plainly. A lerp in the scene's own tick
    // cannot be starved by that.
    var scaleTarget = 1, scaleNow = 1;
    return {
      el: outer,
      // What to MEASURE against. `outer` is only a rotation — its origin is
      // the room's centre, so a head-to-outer vector is zero length and every
      // off-axis reading came back 0, which left the document permanently
      // grown. `inner` is the entity carrying the actual z offset.
      at: inner,
      material: plate.material,
      isPdf: true,
      focus: function (deg, dt) {
        if (deg < PDF_FOCUS_DEG) st.focused = true;
        else if (deg > PDF_BLUR_DEG) st.focused = false;
        scaleTarget = st.focused ? (PDF_GROWN_H / PDF_COVER_H) : 1;
        if (reducedMotion) scaleNow = scaleTarget;
        else scaleNow += (scaleTarget - scaleNow) * Math.min(1, (dt || 16) / PDF_EASE_MS);
        wrap.object3D.scale.setScalar(scaleNow);
        // Controls appear only once it is most of the way open, so they do not
        // swim about during the grow.
        var open = scaleNow > (PDF_GROWN_H / PDF_COVER_H) * 0.8;
        if (open !== controls.getAttribute('visible')) {
          controls.setAttribute('visible', open);
          refreshClickableRaycasters();
        }
      },
      dispose: function () { if (st.tex) { st.tex.dispose(); st.tex = null; } }
    };
  }

  function placeStation(container, station, index, total, angleDeg, radius, accent) {
    var images = (station.images || []).slice(0, 4);
    if (!images.length) return null;

    var outer = document.createElement('a-entity');
    outer.setAttribute('rotation', { x: 0, y: angleDeg, z: 0 });
    var inner = document.createElement('a-entity');
    inner.setAttribute('position', { x: 0, y: ST_Y, z: -radius });
    // Same tilt-to-the-seated-eye as everything else in here: these are aimed
    // once, not sunflower-tracked (that is hub panels only).
    inner.setAttribute('rotation', {
      x: THREE.MathUtils.radToDeg(Math.atan2(ST_Y - EYE_Y, radius)), y: 0, z: 0
    });

    // Backing plate for the whole station, so a mosaic reads as one object.
    var plate = new THREE.Mesh(
      new THREE.PlaneGeometry(ST_W, ST_H),
      VRGlass.makeCardMaterial(ST_W, ST_H, 0.045, accent, 0, 0.5)
    );
    var wrap = document.createElement('a-entity');
    wrap.object3D.add(plate);

    var rows = mosaicGrid(images.length);
    var pad = 0.03;
    var cellH = (ST_H - pad * 2 - ST_GAP * (rows.length - 1)) / rows.length;
    var k = 0;
    rows.forEach(function (row, r) {
      var cellW = (ST_W - pad * 2 - ST_GAP * (row.length - 1)) / row.length;
      // Texture sized to the CELL, not a flat 1024. Measured: a part-loaded
      // Chess room was already 22.5 MB of decoded texture across 8 images, all
      // of them 1024-class — while a 2x2 cell subtends about 11° x 8°, i.e.
      // roughly 230 x 160 screen pixels on a Quest. That is ~20x more texels
      // than the cell can show, and it is the reason loading a room looked
      // expensive enough to need deferring. Right-sized, the whole room is
      // cheap enough to load up front, which is what we want: no dwell gate on
      // a photograph, and nothing popping in as you turn.
      var cellPx = texelsFor(Math.max(cellW, cellH), radius);
      row.forEach(function (_, c) {
        var im = images[k++];
        if (!im) return;
        var mesh = VRGlass.makeFeatheredImage(im.src, cellW, cellH, 0.05, cellPx);
        mesh.position.set(
          -ST_W / 2 + pad + cellW / 2 + c * (cellW + ST_GAP),
          ST_H / 2 - pad - cellH / 2 - r * (cellH + ST_GAP),
          0.008
        );
        wrap.object3D.add(mesh);
      });
    });
    inner.appendChild(wrap);

    // Heading ABOVE the station: the page's own phase name where it has one,
    // and the step number always, so the direction of travel is legible from
    // any single station rather than only by turning. Same halo as everything
    // else a room floats over its own themed sky.
    var head = document.createElement('a-entity');
    head.setAttribute('troika-text', {
      value: (index + 1) + ' / ' + total + (station.label ? '   ' + station.label : ''),
      align: 'center', anchor: 'center', baseline: 'bottom',
      color: '#f5f5f0', fillOpacity: 1, font: VRFonts.body(),
      fontSize: VRType.label(), maxWidth: ST_W + 0.2, lineHeight: 1.2,
      outlineWidth: ROOM_HALO.outlineWidth, outlineColor: ROOM_HALO.outlineColor,
      outlineOpacity: ROOM_HALO.outlineOpacity, outlineBlur: ROOM_HALO.outlineBlur
    });
    head.setAttribute('position', { x: 0, y: ST_H / 2 + 0.026, z: 0.01 });
    inner.appendChild(head);

    outer.appendChild(inner);
    container.appendChild(outer);
    // The plate material goes back to the caller so room-walk can drive its
    // uHover for the direction wave.
    return { el: outer, at: inner, material: plate.material };
  }

  // A decorative generated panel for text-forward rooms (the PDF write-ups
  // have no photography) — same placement/tilt as placeImageCard, but the
  // hero is a procedural accent graphic (VRGlass.makePlaceholderImage) instead
  // of a photo, so the room feels composed rather than a lone floating title
  // (VR_BUGFIX item 1 / item 6).
  function placePlaceholderCard(container, label, angleDeg, radius, height, accent) {
    var eyeHeight = 1.6;
    var w = 0.62, h = 0.8;

    var outer = document.createElement('a-entity');
    outer.setAttribute('rotation', { x: 0, y: angleDeg, z: 0 });
    var inner = document.createElement('a-entity');
    inner.setAttribute('position', { x: 0, y: height, z: -radius });
    inner.setAttribute('rotation', { x: THREE.MathUtils.radToDeg(Math.atan2(height - eyeHeight, radius)), y: 0, z: 0 });

    var frame = new THREE.Mesh(new THREE.PlaneGeometry(w, h), VRGlass.makeCardMaterial(w, h, 0.045, accent, 0, 0.5));
    var img = VRGlass.makePlaceholderImage(w - 0.06, h - 0.06, accent, label, 0.08);
    img.position.z = 0.008;

    var wrap = document.createElement('a-entity');
    wrap.object3D.add(frame);
    wrap.object3D.add(img);
    inner.appendChild(wrap);

    outer.appendChild(inner);
    container.appendChild(outer);
  }

  // ── The hero panel ──────────────────────────────────────────────────────
  // Centred, at eye height, on arrival, and sized to match the home portrait —
  // the bio image of Sebastian, 0.72 x 1.08 in index.html's mosaic-reveal.
  //
  // Matched by AREA, not by a bounding box. Fitting inside a box was the first
  // attempt and it made the portrait-aspect heroes far weaker than the
  // landscape ones: Pendant came out 18° wide against Bastón's 36°, because a
  // 3:4 image hits the box's height limit while a 16:9 one hits its width.
  // Equal area gives every hero the same visual weight whatever its shape,
  // which is what "the same size as the portrait" has to mean across aspects
  // ranging from 0.75 to 1.778.
  //
  // HERO_AREA is the portrait's own area. The hero sits at 2.0 m against the
  // portrait's 1.5 m, so it subtends a little less — ~22° wide for Pendant
  // against the portrait's 27° — which is why this is "roughly", not exact.
  // Bringing it to 1.5 m to match angularly too would put it in front of the
  // text plane and inside the walk bound's 1.15 m forward cap.
  var HERO_AREA = 0.72 * 1.08;
  // Guard only: keeps a hypothetical ultra-wide hero clear of the gallery's
  // inner edge at 45.7°. The widest real one (Slip Door, 16:9) is 1.18.
  var HERO_MAX_W = 1.45;
  // 1.7 m, i.e. 15% nearer than the 2.0 m this first shipped at, which puts
  // the tallest hero at 25° wide against the home portrait's 27° — very close
  // to matching it as SEEN, not just in metres. It stays clear of the walk
  // bound's 1.15 m forward cap by 0.55 m.
  var HERO_Y = 1.62, HERO_Z = 1.7;

  // The text sits FARTHER than the hero (2.0 m vs 1.7 m), so the two are no
  // longer on one plane and nothing about their layout can be reasoned about
  // in Y any more — only in ANGLE. Moving the hero 15% nearer grew it ~18%
  // angularly, and at the fixed Y values this had before, Pendant's title
  // overlapped its own hero by 1.4°: text is appended after the hero, so it
  // would have painted straight over the photograph (guide §3.6).
  var TEXT_Z = 2.0;
  var EYE_Y = 1.6;
  // How much of the dome's horizon band text has to stay off. Read from
  // dome.js rather than hand-copied — this was a local `14.4` duplicating a
  // number that lives there, and dome.js's own history is a warning about
  // exactly that (its light values drifted out of sync with index.html's).
  //
  // The band is now a crisp ~2.5° core inside a dim bloom out to 14.4°, so
  // only the core plus its ramp is bright enough to fight text; the bloom is
  // readable over with ROOM_HALO. That is why the title no longer has to sit
  // 22° up: for most heroes the HERO is now the binding constraint, not the
  // band. Falls back to the old full-width figure if dome.js hasn't loaded.
  function bandAvoidDeg() {
    var d = window.VRDome;
    return d ? (d.BAND_CORE_DEG + d.BAND_RAMP_DEG) : 14.4;
  }
  // Budget for the title's own block (one line plus slack) and the breathing
  // gap either side, both measured at the text plane.
  var TITLE_BLOCK = 0.14, TEXT_GAP = 0.06;

  // A y at the hero's distance -> the y at the TEXT distance that sits at the
  // same angle from the eye. This is the conversion that makes the clearances
  // below honest across the two planes.
  function heroYToTextY(y) {
    return EYE_Y + TEXT_Z * (y - EYE_Y) / HERO_Z;
  }

  // A playing <video> hero. Only Slip Door has one, and it is the project's
  // actual hero on the flat site: the door sliding open, which no still frame
  // conveys.
  //
  // MUTED at the element, not just at a mixer, and never given an audio path at
  // all — the scene's standing rule is that /vr makes no sound (VR_AUDIO is
  // hard false), and a video element is the one thing in here that could
  // smuggle some in. `muted` is also what lets it autoplay without a gesture.
  //
  // Returns the element too, so the idle manager can pause it: a playing video
  // texture re-uploads a frame to the GPU every frame whether or not anyone is
  // looking, which is the one place in a room where "idle to save power" is
  // literally true rather than just tidy.
  function makeVideoHero(project, w, h) {
    var v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.volume = 0;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    (project.video.sources || []).forEach(function (s) {
      var el = document.createElement('source');
      el.src = s.src;
      if (s.type) el.type = s.type;
      v.appendChild(el);
    });

    // IN the document, not detached. A VideoTexture will read from a detached
    // element in some browsers and quietly never decode in others, which is
    // exactly the kind of works-here-fails-in-the-headset difference this
    // codebase keeps getting bitten by. Parked off-screen at 1px rather than
    // display:none, because a display:none video is allowed to stop decoding.
    v.style.cssText = 'position:absolute;left:-2px;top:-2px;width:1px;height:1px;opacity:0.01;pointer-events:none';
    v.setAttribute('aria-hidden', 'true');
    document.body.appendChild(v);

    var tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Not tagged __vrOwned: VideoTexture owns a DOM element rather than a
    // decoded image, and disposeSubtree's texture branch is written for the
    // latter. It is disposed explicitly in the teardown below instead.
    var mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    var play = v.play();
    if (play && play.catch) play.catch(function () { /* autoplay refused; the idle manager retries on approach */ });
    return { mesh: mesh, video: v, texture: tex };
  }

  function placeHero(container, project, accent) {
    if (!project.image && !(project.video && project.video.sources && project.video.sources.length)) return null;

    // Fall back to 4:3 if a card ever ships without width/height rather than
    // guessing square, which is the one aspect none of the heroes are.
    var aspect = (project.imageW && project.imageH)
      ? (project.imageW / project.imageH)
      : (4 / 3);
    // Equal area, preserving aspect: w*h = HERO_AREA and w/h = aspect.
    var w = Math.sqrt(HERO_AREA * aspect), h = Math.sqrt(HERO_AREA / aspect);
    if (w > HERO_MAX_W) { w = HERO_MAX_W; h = HERO_MAX_W / aspect; }

    var wrap = document.createElement('a-entity');
    wrap.setAttribute('position', { x: 0, y: HERO_Y, z: -HERO_Z });

    // Same plate + inset feathered image as the gallery cards, so the hero is
    // recognisably the same kind of object — just bigger and dead ahead.
    // heroTone taps the shader's highlight rolloff for a hero shot on pure
    // white (the pendant, projects.json's heroTone 0.6); it was already
    // scraped and, until now, only the hub's card used it.
    var plate = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      VRGlass.makeCardMaterial(w, h, 0.045, accent, 0, 0.5)
    );
    // A video hero wins over the still. Slip Door is the only project with
    // one, and projects.json's `image` override exists purely to give its card
    // SOMETHING to show, so preferring the video here undoes a workaround
    // rather than overriding a choice.
    var vid = null, img;
    if (project.video && project.video.sources && project.video.sources.length) {
      vid = makeVideoHero(project, w - 0.06, h - 0.06);
      img = vid.mesh;
    } else {
      img = VRGlass.makeFeatheredImage(project.image, w - 0.06, h - 0.06, 0.08, 1024, project.heroTone || 0);
    }
    img.position.z = 0.008;

    wrap.object3D.add(plate);
    wrap.object3D.add(img);
    container.appendChild(wrap);
    if (vid) state.video = vid;   // so applyExit can stop and free it
    return { el: wrap, w: w, h: h, top: HERO_Y + h / 2, bottom: HERO_Y - h / 2 };
  }

  function buildRoom(project) {
    var a11y = document.body.classList.contains('accessible');
    // ONE accent per room, from themes.js. This used to read project.accent
    // (projects.json) while retintLights() read theme.accent — two sources for
    // "the accent", and they had diverged in two of the five rooms: Slip Door
    // was lit pale ice #cdeffa but trimmed saturated #0091c8, and Chess was lit
    // near-white #f7f5f0 but trimmed mid-grey #8a8a8a. A room now lights and
    // trims itself the same colour, and themes.js is the only place to change
    // it. projects.json's accent still styles that project's card out in the
    // HUB, which is a different surface in different light — left alone.
    var accent = VRThemes.get(project.theme).accent || project.accent || '#b8863b';
    var room = document.createElement('a-entity');
    room.id = 'projectRoom';

    // Title → blurb → tags, flowed top-down by measured height (VRTextFlow)
    // so the long essay-project titles ("Social Engineering via Predictive
    // Algorithms") that wrap to 2 lines don't collide with the blurb beneath.
    // Centered column, anchored at a fixed top (y 2.02) and z -1.7.
    // Every line in this column carries a thin dark halo. The room's own theme
    // paints the sky from theme.sky and the FLOOR from theme.panel, and in at
    // least one shipped theme those are #3a3a38 and #f7f6f3 — a dark upper half
    // and a near-white lower half. Text at y 1.25–2.0 crosses that boundary on
    // screen depending on where the visitor looks, which is how the tags
    // measured 3.45:1 and the Return button 3.55:1 (VR_TEST_REPORT: project
    // rooms). An outline fixes contrast against BOTH halves without putting a
    // backing plate behind the text and changing how a room reads.
    function withHalo(spec) {
      Object.keys(ROOM_HALO).forEach(function (k) { spec[k] = ROOM_HALO[k]; });
      return spec;
    }
    var titleSpec = withHalo({
      value: project.title, align: 'center', font: VRFonts.title(),
      fontSize: VRType.title(), maxWidth: 2.2, lineHeight: 1.15, gapAfter: 0.05
    });
    var belowSpecs = [];
    if (project.blurb) {
      // The summary, front and centre — prominence via full opacity + centred
      // position, not a bespoke size (§5: hierarchy through weight/colour/
      // position, not a fourth text size).
      belowSpecs.push(withHalo({ value: project.blurb, align: 'center', font: VRFonts.body(),
        fillOpacity: 0.95, fontSize: VRType.body(), maxWidth: 1.9, lineHeight: 1.35, gapAfter: 0.05 }));
    }
    if (project.tags && project.tags.length) {
      // Full opacity, not 0.9: the tags were the worst-measured line in a room
      // and dimming accent-coloured text was costing contrast it didn't have.
      belowSpecs.push(withHalo({ value: project.tags.join('  ·  '), align: 'center', font: VRFonts.body(),
        color: accent, fillOpacity: 1, fontSize: VRType.label(), maxWidth: 1.9 }));
    }

    // ── The hero, dead ahead on arrival ──────────────────────────────────
    // A room used to open on its TEXT, with the project's own photographs out
    // at ±53–80° where you had to go looking for them, and the card hero —
    // the one image that says what this is — shown nowhere at all
    // (data-loader drops it from roomImages precisely because it is the card's).
    // Now the hero hangs centred at eye height, so the first thing in front of
    // you when the room resolves is the project itself.
    //
    // It is APPENDED FIRST, before any text, which is load-bearing: room
    // content is all renderOrder 0 and the scene sorts transparent objects by
    // scene-graph order, not depth (guide §3.6), so anything appended after
    // the hero paints over it. Text sits clear of it in Y anyway; this is
    // belt-and-braces for whatever gets added next.
    //
    // Sized to the hero's OWN aspect (project.imageW/H, off the flat card)
    // rather than to a fixed box, because the shader cover-fits: a fixed
    // landscape frame crops 44% of the height off a 3:4 hero and takes the
    // chain off the pendant. Fitted inside HERO_MAX so a 16:9 hero and a 3:4
    // hero read as the same weight of object rather than the same width.
    var hero = placeHero(room, project, accent);

    // Title ABOVE the hero, blurb + tags BELOW it, rather than one column.
    // Splitting it is what keeps both blocks out of the horizon band: the band
    // spans ±14.4° of elevation (dome.js's gradient stops), which at the text
    // plane is y 1.163–2.037 — exactly where a single top-anchored column used
    // to sit, and why Bastón's blurb and tags washed out on its magenta. The
    // hero now occupies that zone and masks it; the text brackets it.
    // Both stacks are top-anchored and flow DOWN, so these are tops, not
    // centres, and the gaps allow a title wrapping to two lines.
    if (hero) {
      // Derived per hero rather than fixed, so a tall 3:4 hero pushes its
      // title up only as far as it actually needs and a wide 16:9 one doesn't
      // pay for it. Whichever is more restrictive wins: the hero's own edge,
      // or the band's — see BAND_DEG.
      var bandHalf = TEXT_Z * Math.tan(bandAvoidDeg() * Math.PI / 180);
      var titleTop = Math.max(heroYToTextY(hero.top), EYE_Y + bandHalf) + TEXT_GAP + TITLE_BLOCK;
      var belowTop = Math.min(heroYToTextY(hero.bottom), EYE_Y - bandHalf) - TEXT_GAP;
      VRTextFlow.stack(room, [titleSpec], { startY: titleTop, z: -TEXT_Z });
      if (belowSpecs.length) VRTextFlow.stack(room, belowSpecs, { startY: belowTop, z: -TEXT_Z });
    } else {
      // No hero (the PDF write-ups, which have no card image): the original
      // single top-anchored column, unchanged.
      VRTextFlow.stack(room, [titleSpec].concat(belowSpecs), { startY: 2.02, z: -1.7 });
    }

    // ── The walk round ───────────────────────────────────────────────────
    // The gallery used to be a MIRROR: up to four photos at ±55° and ±80°,
    // which is a display, not a story — the same two images either side of you
    // with no order and no reason to turn one way rather than the other.
    //
    // It is a one-directional circle now. The hero holds 0°, and the project's
    // build stations run CLOCKWISE from just right of it all the way round, so
    // turning right from the hero starts at the beginning and continuing in
    // that direction takes you through the making of the thing and back to
    // where you started. Stations take the page's own phase headings
    // ("Sketching & Ideation" -> "Cardboard Prototype" -> "Refined Prototype"
    // -> "Force Analysis"), grouped by data-loader.js.
    //
    // Angles: the hero occupies one of N+1 evenly spaced slots and the stations
    // take the rest, so the last station lands just LEFT of the hero and the
    // circle closes without any station colliding with it.
    var stations = project.roomStations || [];
    var g = VRThemes.room(project.theme).gallery;
    var placed = [];
    // A written analysis is the last stop on the walk, if the project has one.
    // Counted into the total up front so the headings read "5 / 6" rather than
    // the document arriving as an unnumbered extra.
    var hasDoc = !!pageManifest(project.pdf);
    if (stations.length) {
      var total = stations.length + (hasDoc ? 1 : 0);
      var step = 360 / (total + 1);
      stations.forEach(function (st, i) {
        placed.push(placeStation(room, st, i, total, (i + 1) * step, g.radius, accent));
      });
      if (hasDoc) {
        placed.push(placePdfStation(room, project, total - 1, total, total * step, g.radius, accent));
      }
    } else if ((project.roomImages || []).length) {
      // Images but no grouping (a page whose markup this pass has not seen):
      // fall back to one station per image rather than dropping them.
      (project.roomImages || []).forEach(function (im, i, arr) {
        placed.push(placeStation(room, { label: '', images: [im] }, i, arr.length,
                    (i + 1) * (360 / (arr.length + 1)), g.radius, accent));
      });
    } else {
      // No photography → a symmetric pair of generated accent panels flanking
      // the text, keeping the same out-to-the-sides placement so the forward
      // column (title/blurb/tags + buttons) stays clear.
      placePlaceholderCard(room, project.title, -g.inner, g.radius, g.height, accent);
      placePlaceholderCard(room, project.title, g.inner, g.radius, g.height, accent);
    }

    // Drive the direction wave and the video's idle state. Attached even with
    // no stations (a write-up room) so there is one code path, and it simply
    // has nothing to animate.
    room.setAttribute('room-walk', '');
    room.addEventListener('loaded', function () {
      // Bail if this room is no longer the open one. `loaded` is asynchronous,
      // so entering a room and immediately pressing Back — which a visitor can
      // absolutely do, and which every rapid test does — fires this against a
      // room that has already been torn down and detached. It threw five
      // uncaught TypeErrors in one such run, one per abandoned room.
      if (state.roomEl !== room) return;
      var walk = room.components['room-walk'];
      if (!walk) return;
      placed.forEach(function (p, i) { if (p) walk.addStation(p, i); });
      if (state.video) walk.setVideo(state.video);
    }, { once: true });
    // The document station swaps its page texture as you navigate, so the
    // resident one is not the one the room was built with. disposeSubtree only
    // frees what it can still reach, so the station hands back its own closer.
    state.stationDisposers = placed
      .filter(function (p) { return p && p.dispose; })
      .map(function (p) { return p.dispose; });

    // Only a Return control — the experience stays fully in VR (no link out
    // to the flat webpage). Everything the room has to say is already visible
    // on entry: the summary front-and-centre and a caption under each image.
    // The one shared exit control (exit-button.js) — same label, size, variant
    // and upper-right position as the reader's and the focus stage's. This was
    // '← Return to dome', 0.44 x 0.12, centred at y 1.25: a different phrase and
    // a different place from every other way out.
    //
    // The room's own accent is passed through so the plate still belongs to the
    // room, but the LIGHT label is not negotiable: a room dims the key rack to
    // 0.22, and ui-button's near-black solid label (9.15:1 in the hub) collapses
    // to 2.1:1 in here. exit-button.js hardcodes the light label for that reason.
    // eye: 1.6 is the VIEWER's eye height, not the old button's y of 1.25 —
    // exit-button.js measures its upper-right slot as an angle up from the eye,
    // so feeding it the old button position put the new one back at eye level
    // (measured: screen NDC y 0.02 instead of 0.36, level with the horizon
    // rather than up and to the right like every other context's).
    var returnBtn = VRExitButton.mount(room, {
      distance: 1.3, eye: 1.6, accent: accent,
      onExit: function () { window.VRProjectRoom.exit(); }
    });

    // Once this button is fully loaded its object3D (and 'button-mesh') is
    // attached to the scene graph, so it's now safe to register it with the
    // selection rays — see the note in applyEnter on why an earlier refresh
    // misses it (ISSUE-01). This is the authoritative trigger: it fires when
    // the actual clickable is attached, not just its containing room.
    if (returnBtn.hasLoaded) refreshClickableRaycasters();
    else returnBtn.addEventListener('loaded', refreshClickableRaycasters, { once: true });

    return room;
  }

  // The world-transform transition (§7 + VR_POLISH_STANDARDS.md §3): a single
  // eased dip-to-dark and emerge, using the comfort vignette as a full-view
  // mask. Ease UP to near-opaque, swap the whole world at the dark peak
  // (nothing visibly pops), ease back DOWN — one continuous power2.inOut curve,
  // ~1.4s total, never a snap. Reduced-motion → instant swap, no vignette.
  function runTransition(applyChanges) {
    if (state.transTween) { state.transTween.kill(); state.transTween = null; }
    var v = document.querySelector('#comfortVignette');
    var mesh = v && v.getObject3D('mesh');
    if (reducedMotion || !mesh || typeof gsap === 'undefined') { applyChanges(); return; }

    var mat = mesh.material;
    var half = (TRANSITION_MS / 1000) / 2;
    var flash = v.components && v.components['vignette-flash'];
    // A FLAT fill, not the walking vignette: dead ahead the radial term is
    // exactly 0, so without this the swap happens in plain view at the centre
    // of the screen however high opacity goes (see locomotion.js's setFlat).
    if (flash && flash.setFlat) flash.setFlat(true);
    v.setAttribute('visible', true);
    mat.opacity = 0;
    state.transTween = gsap.to(mat, {
      opacity: 0.92, duration: half, ease: 'power2.inOut',
      onComplete: function () {
        applyChanges(); // swap at peak darkness
        state.transTween = gsap.to(mat, {
          opacity: 0, duration: half, ease: 'power2.inOut',
          onComplete: function () {
            v.setAttribute('visible', false);
            if (flash && flash.setFlat) flash.setFlat(false);
            state.transTween = null;
          }
        });
      }
    });
  }

  function applyEnter(project) {
    setHubVisible(false);
    captureBaseLights(); // before the retint below, so it records the hub's own
    var scene = document.querySelector('a-scene');
    var theme = window.VRThemes.get(project.theme);
    var sky = document.querySelector('[dusk-sky]');
    var floor = document.querySelector('[dusk-floor]');
    if (sky) sky.components['dusk-sky'].setTheme(theme.sky, theme.horizon);
    if (floor) floor.components['dusk-floor'].setColor(theme.panel);
    // The rug was the one ground surface a room didn't retint, so the hub's
    // dark brown pad stayed put on top of the room's own floor colour: a
    // stain on the near-white Pendant floor, invisible on the dark ones. Its
    // colour is derived from the theme (VRThemes.rug). Its radius is set too,
    // but every room currently asks for the hub's own 1.3 — setRadius
    // early-returns on an unchanged value, so today this is a colour-only
    // change and the size hook is simply ready for later.
    var rug = rugComponent();
    if (rug) {
      rug.setColor(VRThemes.rug(project.theme));
      rug.setRadius(VRThemes.room(project.theme).rugRadius);
    }
    retintLights(theme.accent, 0.22);

    var room = buildRoom(project);
    room.setAttribute('visible', true);
    // Face the room's content toward wherever the viewer is looking on entry, so
    // the title + hero land front-and-centre rather than off at world -Z, forcing
    // a hunt (ISSUE-02). Captured once — the room doesn't track the head after.
    room.setAttribute('rotation', { x: 0, y: currentHeadYawDeg(), z: 0 });
    scene.appendChild(room);
    state.roomEl = room;
    // The room's "← Return to dome" button registers itself with the selection
    // rays once it finishes loading — see buildRoom(). It must happen after the
    // button's object3D is attached to the scene graph, or flattenObject3DMaps()
    // silently drops it and Return reads as dead (ISSUE-01).
  }

  function applyExit() {
    var sky = document.querySelector('[dusk-sky]');
    var floor = document.querySelector('[dusk-floor]');
    if (sky) sky.components['dusk-sky'].clearTheme();
    if (floor) floor.components['dusk-floor'].resetColor();
    var rug = rugComponent();
    if (rug) { rug.resetColor(); rug.resetRadius(); }
    resetLights();
    // Null-safe: only detach if it's still parented (guards against a double
    // exit or the node being pulled out from under us), so a stray exit never
    // throws and leaves the hub half-restored.
    releaseVideo();   // before the subtree goes, while the element is still reachable
    (state.stationDisposers || []).forEach(function (d) { try { d(); } catch (e) {} });
    state.stationDisposers = null;
    if (state.roomEl) {
      // Frees the room's own frames, hero images and buttons. Sealed behind
      // window.VR_ROOMS today, so this leaked nothing in practice — but the code
      // is live and each enter() builds a plate plus a 1024 px feathered image
      // per room photo, so it would have leaked as soon as the flag flipped.
      VRGlass.disposeSubtree(state.roomEl.object3D);
      if (state.roomEl.parentNode) state.roomEl.parentNode.removeChild(state.roomEl);
      state.roomEl = null;
    }
    setHubVisible(true);
    // The room's clickables are gone now — drop them from every ray's cached
    // target list so a stale mesh can't keep swallowing hits back in the hub.
    refreshClickableRaycasters();
    if (window.VRPlace) VRPlace.leave('room');
  }

  function enter(project) {
    if (state.open) applyExit(); // clean up any open room instantly (rare — rooms are only entered from the hub)
    // Evict the reader or the portrait lab if either is live. Without this a
    // room could open on top of the reader — measured at 18 meshes and two
    // rival "Back to the dome" buttons (see place.js).
    if (window.VRPlace) VRPlace.enter('room');
    state.open = true;
    runTransition(function () { applyEnter(project); });
  }

  function exit() {
    if (!state.open) return;
    state.open = false;
    runTransition(applyExit);
  }

  // Instant teardown for place.js, with no transition and nothing deferred:
  // whoever is evicting us is already running their own dip, and disposal
  // parked in a GSAP callback may never run at all in a headset.
  function evict() {
    if (!state.open) return;
    state.open = false;
    if (state.transTween) { state.transTween.kill(); state.transTween = null; }
    applyExit();
  }

  window.VRProjectRoom = { enter: enter, exit: exit, evict: evict, isOpen: function () { return state.open; } };

  if (window.VRPlace) VRPlace.register('room', { isOpen: function () { return state.open; }, evict: evict });
})();
