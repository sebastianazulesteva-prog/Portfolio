/* ═══ pdf-reader.js ═══
   The reading space for the write-up projects (HP's Reckoning, Algorithmic
   Modeling, 3D-Printed Glasses Frames, Social Engineering, Apple's Medical
   Licensure) — the pieces that are a PDF rather than a photographed object.

   Per Sebastian: these REPLACE the themed project room. You are transported
   somewhere else to read, the surroundings go dark, and the piece opens huge
   in front of you with an obvious scroll control on the left.

   ── Design decisions and why ───────────────────────────────────────────────

   PAGE SIZE / READING ERGONOMICS. Sized off the bio card (1.05 x 1.46m) and
   a bit bigger, per Sebastian — not the original ~3m "10 ft" page, which at
   reading distance spanned about 74 degrees vertically and was unreadable
   without constantly craning.

   Page 1 rests with its BOTTOM at knee height and its top towering overhead,
   so the first few lines genuinely are above eye level and you look up to
   start the piece — that was the ask. From there, scrolling TRANSLATES the
   whole strip upward so that whatever you are reading settles to eye level:
   you look up to begin, then read comfortably straight ahead. That keeps the
   sense of a document towering over you without making your neck pay for all
   28 pages. (Sebastian chose this reading-band behaviour over "look up and
   down at a fixed page".)

   CONTINUOUS SCROLL, LAZILY RENDERED. All pages form one vertical strip, so
   scrolling is continuous rather than page-flipping. But these documents run
   to 28 pages, and rendering every page at readable resolution would cost
   roughly 350MB of texture memory — enough to kill a Quest. So only pages
   near the reading band are rendered, and pages that scroll far away have
   their canvas texture disposed. Page PLANES always exist (cheap); only their
   textures come and go.

   TEXT SHARPNESS. Pages render to a canvas at RENDER_PX tall and are shown
   unlit (MeshBasicMaterial) — a lit material would shade the paper unevenly
   and make body text harder to read, which is the opposite of the point here.
   This is the same reasoning as the project thumbnails staying ungraded
   (BUILD_NOTES ISSUE-07).

   THE SCROLL CONTROL IS A RAIL ON THE RIGHT, AND IT IS SCROLL-ARROWS' JOB.
   One vertical column off the page's right edge — up pad, position track, down
   pad — built by scroll-arrows.js makeRail(). See the long note above
   buildScrollControl for why it went pads-on-the-left → bars-above-and-below →
   back to a rail, and why the right side. Nothing about it is built in here.
   The arrows are still real THREE.Shape geometry rather than '▲'/'▼' troika
   text (§3.6's missing-glyph trap), and track/thumb are still lit pills.

   YOU ARE ACTUALLY MOVED THERE. Sebastian, on the shipped version: "I don't
   think they actually enter / are moved to another room right now?" — correct.
   The reader used to build itself around the seat and hide the hub, so the room
   changed around a viewer who never went anywhere. Now the rig is genuinely
   translated to a reading alcove across the dome (READING_SITE), the alcove
   brings its own ground and the key-light rack with it, and walk-controls'
   movement bound is re-centred there so you can step around inside it. Two
   reasons it is worth doing for real rather than faking it: a backdrop swap
   reads as a backdrop swap, and leaving the hub one metre off your shoulder
   means anything that forgets to hide is suddenly IN your reading space —
   which is exactly what happened to the writing column (VR_TEST_REPORT B1).

   THE GROUND IS THE DOME'S GROUND. open() does not retint dusk-floor — the
   alcove stands on the same dusk floor as the hub, and lays its own rug on top
   of it (the dome's own rug stays behind at the seat, 12 m away).

   PDF.js is loaded from CDN, pinned, on first use only — it is a sizeable
   dependency and most visits never open a paper. No build step, per the
   project's standing constraint.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Pinned, like every other CDN dependency here — never "latest".
  // 3.11.174 is the last release shipping a plain UMD build that defines
  // window.pdfjsLib; 4.x is ESM-first, which would need a module script and
  // therefore a different load path for no benefit.
  var PDFJS_VERSION = '3.11.174';
  var PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/build/';

  // Bio card is 1.05w x 1.46h; this is deliberately a bit bigger than that.
  // Width follows from the PDF's own aspect (~0.773 for US Letter portrait),
  // so 1.95 tall works out ~1.51 wide.
  var PAGE_HEIGHT = 1.95;
  var PAGE_GAP = 0.10;
  var READ_DISTANCE = 1.9;     // strip sits this far in front of the viewer
  var EYE_HEIGHT = 1.6;
  // Page 1's bottom edge rests here, so the page towers from knee height to
  // well above the head and the opening lines sit above eye level.
  var KNEE_HEIGHT = 0.5;
  var RENDER_PX = 1700;        // canvas height per page — ~870px/m at this size
  var RENDER_WINDOW = 1;       // pages either side of the current one to keep rendered

  // ── Where the reading room IS ──
  // A real spot in the dome, 12 m from the seat: far enough that the hub is
  // unmistakably somewhere else, well inside the 40 m dome floor (dome.js), and
  // near enough the centre that the sky sphere's off-axis distortion stays
  // invisible — which it is anyway here, since open() paints the whole dome
  // near-black and the ember horizon band with it.
  var READING_SITE = { x: 0, z: 12 };
  // How far you may walk once you are there. A circle, not the seat's
  // -Z-squashed ellipse: the page is 1.9 m ahead of wherever you were looking
  // when you opened it, not on a world axis. 1.2 m is enough to lean around the
  // page or step back from it without walking through it.
  var SITE_WALK_RADIUS = 1.2;
  // The alcove's own rug, a little wider than the dome's (1.3) so the standing
  // area reads as a room rather than a mat.
  var RUG_RADIUS = 1.75;

  var state = {
    open: false,
    root: null,
    doc: null,
    pages: [],        // { el, mesh, material, texture, rendering, index }
    scroll: 0,        // metres scrolled from the top of page 1
    maxScroll: 0,
    project: null,
    transTween: null,
    rail: null,         // the one scroll control: up pad, position track, down pad
    rackOffset: null,   // non-null while the key rack is parked at the alcove
    seatPos: null,      // fallback when walk-controls isn't running (?walk=0 aside)
    // three.js never auto-disposes: removing `root` from the DOM frees the
    // entities but leaks every geometry/material hung off them. Collected here
    // on build, dispose()d on close.
    disposables: []
  };

  // The hub is whatever carries .hub-cluster (see index.html), plus the focus
  // stage — the reader is opened FROM the focus stage, so unlike a project room
  // it has to put that away too. Both of these were hardcoded id lists that had
  // drifted apart from project-room.js's copy, and both missed
  // #writingConstellation, leaving the other four writing cards floating in the
  // reading space (VR_TEST_REPORT B1).
  function setHubVisible(visible) {
    [].slice.call(document.querySelectorAll('.hub-cluster')).forEach(function (el) {
      el.setAttribute('visible', visible);
    });
    var focus = document.querySelector('#focusStage');
    if (focus) focus.setAttribute('visible', visible);
  }

  // Same reason as project-room.js's copy: a control created after load isn't
  // in any raycaster's cached target list yet, and waiting for A-Frame's
  // MutationObserver is a frame-timing gamble that in-headset loses often
  // enough that the button reads as dead (ISSUE-01).
  function refreshClickableRaycasters() {
    ['#head [cursor]', '#leftHand', '#rightHand'].forEach(function (sel) {
      var el = document.querySelector(sel);
      var rc = el && el.components && el.components.raycaster;
      if (rc) rc.refreshObjects();
    });
  }

  function currentHeadYawDeg() {
    var head = document.querySelector('#head');
    if (!head) return 0;
    var fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
      head.object3D.getWorldQuaternion(new THREE.Quaternion())
    );
    return THREE.MathUtils.radToDeg(Math.atan2(-fwd.x, -fwd.z));
  }

  // ── Going there, and coming back ─────────────────────────────────────────
  // The four .key-light fixtures and their visible housings sit above the home
  // title (index.html). Once the viewer is moved for real, every lit surface in
  // the reading room — the scroll bars, the exit button's ember ring and back
  // mark, the lit troika text — is 12 m outside a point light with distance:9,
  // so it all collapses to its emissive floor and the controls read as flat
  // unlit chips. So the rack travels with you. Moving the fixture ENTITIES (not
  // just the shader uniforms) is what keeps the real three.js lights and the
  // glass shader's own light array in agreement; syncRack() re-reads the world
  // positions, which is exactly what it exists for.
  //
  // Direct object3D writes are safe here: these entities were created at load,
  // long before this runs, so the `position` component has already initialised
  // and cannot clobber them afterwards (trap §3.4).
  function moveLightRack(dx, dz) {
    [].slice.call(document.querySelectorAll('.key-light'))
      .concat([].slice.call(document.querySelectorAll('[light-rack-housings]')))
      .forEach(function (el) {
        el.object3D.position.x += dx;
        el.object3D.position.z += dz;
        el.object3D.updateMatrixWorld();
      });
    var scene = document.querySelector('a-scene');
    var sys = scene && scene.systems && scene.systems['vr-key-light'];
    if (sys) sys.syncRack();
  }

  function goToReadingRoom() {
    // Idempotent: a second open() while the first reader's close transition is
    // still in flight must not stack a second rack offset (which would park the
    // lights 24 m out and leave the alcove unlit).
    if (state.rackOffset) return;
    if (window.VRWalk && VRWalk.enterSite) {
      // walk-controls owns rig position (§9.5) — it does the teleport and moves
      // its own soft bound with it, so nothing here fights it next tick. The
      // HUD's recentre button reads the same site.
      VRWalk.enterSite({ x: READING_SITE.x, z: READING_SITE.z, radius: SITE_WALK_RADIUS });
    } else {
      var rig = document.querySelector('#rig');
      if (rig) {
        state.seatPos = rig.object3D.position.clone();
        rig.object3D.position.set(READING_SITE.x, rig.object3D.position.y, READING_SITE.z);
      }
    }
    moveLightRack(READING_SITE.x, READING_SITE.z);
    state.rackOffset = { x: READING_SITE.x, z: READING_SITE.z };
  }

  function returnToDome() {
    if (state.rackOffset) {
      moveLightRack(-state.rackOffset.x, -state.rackOffset.z);
      state.rackOffset = null;
    }
    if (window.VRWalk && VRWalk.leaveSite) {
      VRWalk.leaveSite();
    } else if (state.seatPos) {
      var rig = document.querySelector('#rig');
      if (rig) rig.object3D.position.copy(state.seatPos);
      state.seatPos = null;
    }
  }

  // The alcove's ground. The dome's own rug (dusk-rug, radius 1.3 at the seat)
  // stays behind, so without this you arrive standing on the bare void floor
  // and the one cue that says "this is a place" is missing. Same flat unlit
  // treatment and near-tone as dusk-rug — a shade cooler and darker, because
  // this room is deliberately not the warm dusk one you left.
  function buildGround(root) {
    var geo = new THREE.CircleGeometry(RUG_RADIUS, 48);
    var mat = new THREE.MeshBasicMaterial({ color: '#151109' });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.004; // above dusk-floor (-0.02); no rug here to fight
    root.setObject3D('reading-ground', mesh);
    state.disposables.push(geo, mat);
  }

  // ── PDF.js loading ───────────────────────────────────────────────────────
  //
  // MEASURED, and this is the single biggest reason "entering the reading room
  // takes forever": pdf.min.js is 320 KB and pdf.worker.min.js is 1,087 KB, and
  // both used to be fetched at the moment of the tap, from a CDN origin the page
  // had never spoken to (so: DNS + TLS + 1.4 MB, before the PDF itself).
  //
  // So `prefetch()` now pulls them during idle time after arrival — see the
  // bottom of this file. By the time anyone taps a writing card they are in
  // cache, and the tap costs only the document. The tap path is unchanged if
  // the prefetch has not finished: loadPdfJs() returns the same memoised
  // promise either way.
  var pdfjsPromise = null;
  function loadPdfJs() {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise(function (resolve, reject) {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      var s = document.createElement('script');
      s.src = PDFJS_BASE + 'pdf.min.js';
      s.onload = function () {
        if (!window.pdfjsLib) return reject(new Error('pdfjsLib missing after load'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('failed to load pdf.js')); };
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }

  // The worker is not loaded by the script tag — pdf.js only fetches it on the
  // first getDocument(), which put 1,087 KB back on the tap path even with the
  // script warm. A bare fetch() is enough to get it into the HTTP cache.
  var workerWarmed = false;
  function warmWorker() {
    if (workerWarmed) return;
    workerWarmed = true;
    fetch(PDFJS_BASE + 'pdf.worker.min.js', { cache: 'force-cache' })
      .then(function () { console.info('[vr] pdf-reader: worker warmed'); })
      .catch(function () { workerWarmed = false; });
  }

  function prefetch() {
    loadPdfJs().then(warmWorker).catch(function () { /* it will retry on tap */ });
  }

  // ── Page rendering ───────────────────────────────────────────────────────
  function renderPage(rec, onSettled) {
    function settled() { rec.rendering = false; if (onSettled) onSettled(); }
    if (rec.texture || rec.rendering || !state.doc) { if (onSettled) onSettled(); return; }
    rec.rendering = true;
    state.doc.getPage(rec.index + 1).then(function (page) {
      // Bail if the reader closed, or this page scrolled out of the window,
      // while the async render was in flight — otherwise we'd allocate a
      // texture nobody is going to look at.
      if (!state.open || !rec.wanted) { settled(); return; }
      var base = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: RENDER_PX / base.height });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
        .then(function () {
          settled();
          if (!state.open || !rec.wanted) return;
          var tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          rec.texture = tex;
          rec.material.map = tex;
          rec.material.color.set('#ffffff'); // stop tinting once real content is in
          rec.material.needsUpdate = true;
        });
    }).catch(function (err) {
      settled();
      console.warn('[vr] pdf-reader: page ' + (rec.index + 1) + ' failed:', err);
    });
  }

  function disposePage(rec) {
    if (!rec.texture) return;
    rec.material.map = null;
    // Lifted from #15120e: against the reader's #040404 sky that was invisible,
    // so an unrendered strip read as a void rather than as pages waiting — half
    // of why an empty reader looked broken rather than loading.
    rec.material.color.set('#2a241c');
    rec.material.needsUpdate = true;
    rec.texture.dispose();
    rec.texture = null;
  }

  // Keep only the pages near the reading band rendered — see the memory note
  // at the top of this file.
  // ── One page at a time, nearest first ────────────────────────────────────
  // pdf.js rasterises on the MAIN THREAD. At RENDER_PX a page canvas is about
  // 1314 × 1700 (2.2 megapixels), and this used to hand pdf.js all three pages
  // in the window at once — so a scroll tap that crossed a page boundary
  // interleaved two or three multi-megapixel rasterisations and the frame rate
  // went with them. That is the other half of "the up and down buttons were
  // super laggy" (the first half was xr-select.js's dropped pinches).
  //
  // Serialised instead, ordered by distance from the page you are on, so the
  // page you are actually looking at rasterises first and each individual stall
  // is one page long rather than three.
  //
  // RENDER_PX itself is deliberately NOT reduced: the page is 1.95 m tall at
  // 1.9 m, and the band you can actually see is ~1.2 m of that, so 1700 px
  // works out at ~30 pixels per degree against a Vision Pro's ~34. Lowering it
  // would be visible as soft type, which is the whole point of the reader.
  var renderQueue = [];
  var renderBusy = false;
  var renderToken = 0;
  var renderWatchdog = null;
  // Long enough that a real page (a few hundred ms) never trips it, short
  // enough that a stuck one doesn't read as a broken reader.
  var RENDER_TIMEOUT_MS = 4000;

  // Serialising has one failure mode parallel rendering did not: a single
  // render that never settles blocks every page behind it, and the reader sits
  // blank forever. Found in testing, where the preview pane suspends rAF (which
  // pdf.js's chunked rasteriser needs) and page 1 hung indefinitely. That is a
  // harness artifact, but "the reader never loaded" is exactly the class of
  // failure being fixed here, so the queue gets a watchdog rather than trusting
  // pdf.js to always come back.
  function releaseRender(token) {
    if (token !== renderToken) return;   // a newer render already owns the slot
    if (renderWatchdog) { clearTimeout(renderWatchdog); renderWatchdog = null; }
    renderBusy = false;
    pumpRenderQueue();
  }

  function pumpRenderQueue() {
    if (renderBusy || !renderQueue.length || !state.open) return;
    var rec = renderQueue.shift();
    if (!rec.wanted || rec.texture || !state.open) return pumpRenderQueue();
    renderBusy = true;
    var token = ++renderToken;
    renderWatchdog = setTimeout(function () {
      console.warn('[vr] pdf-reader: page ' + (rec.index + 1) + ' render exceeded ' +
        RENDER_TIMEOUT_MS + 'ms — releasing the queue (it may still land later)');
      releaseRender(token);
    }, RENDER_TIMEOUT_MS);
    renderPage(rec, function () { releaseRender(token); });
  }

  var lastWindowIndex = null;
  function updateRenderWindow(force) {
    var step = PAGE_HEIGHT + PAGE_GAP;
    var current = Math.floor(state.scroll / step);
    // applyScroll runs on every frame of the scroll tween; the window only
    // changes when the page index does.
    if (!force && current === lastWindowIndex) return;
    lastWindowIndex = current;

    var wanted = [];
    state.pages.forEach(function (rec) {
      rec.wanted = Math.abs(rec.index - current) <= RENDER_WINDOW;
      if (rec.wanted) wanted.push(rec);
      else disposePage(rec);
    });
    wanted.sort(function (a, b) {
      return Math.abs(a.index - current) - Math.abs(b.index - current);
    });
    // Rebuilt, not appended to: a queue carrying pages that have since scrolled
    // out would rasterise them anyway, behind the one you are looking at.
    renderQueue = wanted.filter(function (rec) { return !rec.texture && !rec.rendering; });
    pumpRenderQueue();
  }

  // ── Scroll ───────────────────────────────────────────────────────────────
  // The strip slides so the reading band stays at eye level: page 1's top
  // starts at eye level, and scrolling moves the whole strip UP past it.
  function applyScroll() {
    if (!state.stripEl) return;
    state.scroll = Math.max(0, Math.min(state.maxScroll, state.scroll));
    state.stripEl.object3D.position.y = state.scroll;
    updateRenderWindow();
    updateScrollIndicator();
  }

  function scrollBy(metres) {
    var target = Math.max(0, Math.min(state.maxScroll, state.scroll + metres));
    if (reducedMotion || typeof gsap === 'undefined') {
      state.scroll = target;
      applyScroll();
      return;
    }
    // Eased, matching VR_POLISH_STANDARDS.md §3's single curve — a scroll that
    // snaps is disorienting when the thing moving fills your view.
    if (state.scrollTween) state.scrollTween.kill();
    var proxy = { v: state.scroll };
    state.scrollTween = gsap.to(proxy, {
      v: target, duration: 0.55, ease: 'power2.inOut',
      onUpdate: function () { state.scroll = proxy.v; applyScroll(); }
    });
  }

  function updateScrollIndicator() {
    if (!state.rail) return;
    var frac = state.maxScroll > 0 ? state.scroll / state.maxScroll : 0;
    state.rail.setProgress(frac);
    // A pad you can't travel any further with says so, rather than looking live
    // and doing nothing — the "is it broken or am I at the end?" problem.
    state.rail.setUpEnabled(state.scroll > 0.001);
    state.rail.setDownEnabled(state.scroll < state.maxScroll - 0.001);
    if (state.pageLabelEl) {
      var step = PAGE_HEIGHT + PAGE_GAP;
      var current = Math.min(state.doc.numPages, Math.floor(state.scroll / step) + 1);
      state.pageLabelEl.setAttribute('troika-text', 'value', current + ' / ' + state.doc.numPages);
    }
  }

  window.VRPdfReader = {
    open: open,
    close: close,
    // Pulls pdf.min.js (320 KB) + pdf.worker.min.js (1,087 KB) into cache during
    // idle time after arrival, so the first tap on a writing card pays only for
    // the document. index.html calls this; nothing else should need to.
    prefetch: prefetch,
    isOpening: function () { return !!opening; },
    isOpen: function () { return state.open; },
    scrollBy: scrollBy,
    // Exposed for the dev harness / camera-path rig, so the reader's scroll
    // state can be driven and asserted on without faking pointer input.
    _state: state
  };

  // ── Build ────────────────────────────────────────────────────────────────
  function build(project, pdfDoc) {
    var root = document.createElement('a-entity');
    // At the alcove, facing wherever the viewer was looking when they opened it.
    // setAttribute for both, not object3D writes: this entity is created in the
    // same synchronous block, so the `position`/`rotation` components would
    // initialise afterwards and overwrite direct writes with the attribute
    // values (trap §3.4).
    root.setAttribute('position', { x: READING_SITE.x, y: 0, z: READING_SITE.z });
    root.setAttribute('rotation', { x: 0, y: currentHeadYawDeg(), z: 0 });

    var pageCount = pdfDoc.numPages;
    var step = PAGE_HEIGHT + PAGE_GAP;
    // Enough travel to bring the LAST page's lower portion down to the reading
    // band, not just to slide the last page into page 1's starting slot —
    // otherwise the final page's closing lines stay stuck up above eye level
    // and can't be read comfortably.
    state.maxScroll = Math.max(0, (pageCount - 1) * step + (KNEE_HEIGHT + PAGE_HEIGHT - EYE_HEIGHT));

    // Aspect from the real first page, so the plane matches the document
    // rather than assuming US Letter.
    var strip = document.createElement('a-entity');
    strip.setAttribute('position', { x: 0, y: 0, z: 0 });
    root.appendChild(strip);
    state.stripEl = strip;

    state.pages = [];
    state.disposables = [];
    for (var i = 0; i < pageCount; i++) {
      var pageW = PAGE_HEIGHT * state.pageAspect;
      // See disposePage() for why this is not #15120e any more.
      var mat = new THREE.MeshBasicMaterial({ color: '#2a241c', side: THREE.FrontSide });
      var pageGeo = new THREE.PlaneGeometry(pageW, PAGE_HEIGHT);
      var mesh = new THREE.Mesh(pageGeo, mat);
      state.disposables.push(pageGeo, mat);
      var pageEl = document.createElement('a-entity');
      // Page 1's BOTTOM at knee height (so its top towers overhead and the
      // opening lines are above eye level); subsequent pages hang below.
      var topY = (KNEE_HEIGHT + PAGE_HEIGHT) - i * step;
      pageEl.object3D.position.set(0, topY - PAGE_HEIGHT / 2, -READ_DISTANCE);
      pageEl.setObject3D('page', mesh);
      strip.appendChild(pageEl);
      state.pages.push({ el: pageEl, mesh: mesh, material: mat, texture: null, rendering: false, index: i, wanted: false });
    }

    buildGround(root);
    buildScrollControl(root, project);
    return root;
  }

  // The shape + material helpers that used to live here (triangleGeometry,
  // roundedRectGeometry, litMaterial) are gone: the reader now builds its
  // scroll control entirely through scroll-arrows.js makeRail(), which owns
  // the same three. They were private copies of that file's versions and had
  // no other caller in here — keeping them would have left two sets of
  // materials for one control to drift apart.

  // ── The scroll control: back to a rail, on the right ──────────────────────
  //
  // Third version, and it goes back to the shape of the first. History, because
  // the reasoning matters more than the geometry:
  //
  //   1. Two pads stacked in a tall column off to the LEFT of the page, with
  //      the position track beside them. Sebastian: the scroll buttons "feel
  //      off" — the control for moving text vertically sat somewhere the text
  //      wasn't, and up/down read as "two buttons" rather than a direction.
  //   2. A long flat arrow bar above the reading band and another below it
  //      (scroll-arrows.js make()), with the track demoted to a slim indicator
  //      at the page's right edge.
  //   3. This: one vertical RAIL — up pad, position track, down pad — off the
  //      page's right edge.
  //
  // Why back: in the first Vision Pro session the bars barely worked. *"In the
  // reading room the up and down buttons were super laggy, it didn't even work
  // at all. Let's switch back to the old buttons — the ones on the side that had
  // the tracker on it."* Most of that was the input bug xr-select.js fixes (a
  // pinch is a one-frame `transient-pointer` and A-Frame's cursor dropped it),
  // but the shape is his call and version 1 was closer.
  //
  // RIGHT, not the left where version 1 lived — Sebastian's own reasoning, that
  // everyone is used to a scrollbar being on the right.
  //
  // What the rail fixes that version 1 didn't: the pads and the tracker are one
  // object now, so the thumb reads as the thing the pads move, instead of the
  // answer to "where am I" sitting at the opposite side of the page from the
  // controls.
  //
  // KNOWN, and accepted: at x ≈ 0.85 the rail is ~24° off the view centre. That
  // is comfortable in a headset and OFF-SCREEN on a portrait phone, which has
  // about ±21° of horizontal field — the same trade the exit button already
  // makes at 26°. Per §9.4 the scene is not recomposed for phones; the arrival
  // gate says the flat view is the lesser one instead. Do not "fix" this by
  // pulling the rail onto the page: it would then sit over the type, and a warm
  // pad on white paper is very nearly invisible (see make()'s note).
  //
  // The bars are NOT deleted — they are still what the writing column uses, and
  // that shape is Sebastian's own spec for it. Both come out of scroll-arrows.js.

  // Rail geometry, all derived so nothing collides silently:
  //   top    EYE + 0.52 = 2.12, clear of the exit button's lower edge at ~2.21
  //   bottom EYE - 0.72 = 0.88, the old down bar's height
  var RAIL_TOP_OFFSET = 0.52;
  var RAIL_BOTTOM_OFFSET = 0.72;
  var RAIL_W = 0.22;      // 6.6° at READ_DISTANCE — a generous pointing target
  var RAIL_PAD_H = 0.26;  // 7.8°
  var RAIL_GAP_X = 0.10;  // clear of the page's right edge
  function buildScrollControl(root, project) {
    var pageW = PAGE_HEIGHT * state.pageAspect;
    var ACCENT = '#c9c0ac';
    // Pulled toward the viewer so the rail is unambiguously in front of the
    // page rather than fighting it for depth.
    var RAIL_Z = -READ_DISTANCE + 0.10;
    var RAIL_TOP = EYE_HEIGHT + RAIL_TOP_OFFSET;
    var RAIL_BOTTOM = EYE_HEIGHT - RAIL_BOTTOM_OFFSET;
    var railH = RAIL_TOP - RAIL_BOTTOM;
    var railX = pageW / 2 + RAIL_GAP_X;

    // Up moves you back toward page 1, so it scrolls NEGATIVE — kept from every
    // previous version: the arrow points the way the CONTENT travels, which is
    // also the way you travel through it.
    var rail = window.VRScrollArrows.makeRail({
      height: railH, width: RAIL_W, padH: RAIL_PAD_H,
      thumbFrac: 1 / Math.max(1, state.doc.numPages),
      accent: ACCENT, disposables: state.disposables,
      onUp: function () { scrollBy(-PAGE_HEIGHT * 0.45); },
      onDown: function () { scrollBy(PAGE_HEIGHT * 0.45); }
    });
    rail.setAttribute('position', { x: railX, y: (RAIL_TOP + RAIL_BOTTOM) / 2, z: RAIL_Z });
    root.appendChild(rail);
    state.rail = rail;

    var pageLabel = document.createElement('a-entity');
    pageLabel.setAttribute('troika-text', {
      value: '1 / ' + state.doc.numPages, align: 'center', anchor: 'center', baseline: 'center',
      color: '#f5f5f0', font: VRFonts.bodyBold(), fontSize: VRType.label()
    });
    // Directly under the rail, with "where am I" now sitting on the same axis as
    // the controls rather than across the page from them.
    pageLabel.setAttribute('position', { x: railX, y: RAIL_BOTTOM - 0.10, z: RAIL_Z + 0.01 });
    root.appendChild(pageLabel);
    state.pageLabelEl = pageLabel;
    VRGlass.lightTroikaText(pageLabel, '#f5f5f0', { emissive: true });

    // Title of the piece, clear of the page's towering top edge so it can't
    // collide with page 1 (which now reaches KNEE_HEIGHT + PAGE_HEIGHT).
    var title = document.createElement('a-entity');
    title.setAttribute('troika-text', {
      value: project.title, align: 'center', anchor: 'center', baseline: 'bottom',
      color: '#ffffff', font: VRFonts.title(), fontSize: VRType.title() * 1.2, maxWidth: pageW
    });
    title.setAttribute('position', { x: 0, y: KNEE_HEIGHT + PAGE_HEIGHT + 0.12, z: -READ_DISTANCE + 0.02 });
    root.appendChild(title);
    VRGlass.lightTroikaText(title, '#ffffff', { emissive: true });

    // The one shared exit control (exit-button.js): upper right, bigger, and
    // identical to the one in every other context. It used to be a small ghost
    // button low and LEFT at knee height — deliberately out of the way, which
    // also made it the hardest thing in the scene to find. The up bar occupies
    // x ±0.41 at a similar height; at RIGHT_DEG 26 this lands at x 0.93 and is
    // 0.60 wide, so its inner edge is at 0.63 and the two clear each other by
    // 0.21 m.
    VRExitButton.mount(root, { distance: READ_DISTANCE, eye: EYE_HEIGHT, onExit: close });
  }

  // ── Transition (mirrors project-room.js's dip-to-dark) ───────────────────
  function runTransition(applyChanges) {
    if (state.transTween) { state.transTween.kill(); state.transTween = null; }
    var v = document.querySelector('#comfortVignette');
    var mesh = v && v.getObject3D('mesh');
    if (reducedMotion || !mesh || typeof gsap === 'undefined') { applyChanges(); return; }
    var mat = mesh.material;
    var half = 0.7;
    var flash = v.components && v.components['vignette-flash'];
    // Flat fill for the duration — the walking vignette leaves the centre of
    // the view completely clear, and this transition now has a real teleport to
    // hide, not just a backdrop swap. See locomotion.js's setFlat.
    if (flash && flash.setFlat) flash.setFlat(true);
    v.setAttribute('visible', true);
    mat.opacity = 0;
    state.transTween = gsap.to(mat, {
      opacity: 0.95, duration: half, ease: 'power2.inOut',
      onComplete: function () {
        applyChanges();
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

  // ── Opening ───────────────────────────────────────────────────────────────
  //
  // Rewritten after Sebastian's second Vision Pro session. The old version had
  // three separate defects stacked on top of each other, and together they read
  // as "the reading room is broken", which is worse than slow:
  //
  //  1. NO FEEDBACK. Every download happened before runTransition(), and the dip
  //     is the only thing that changes on screen. Many seconds of silence with
  //     the hub still live and clickable — so you tap again, and the second tap
  //     lands on whatever your ray is on. VRBusy fixes this half.
  //
  //  2. IT COMMITTED TO THE ROOM WITH NOTHING TO SHOW. Measured on the shipped
  //     build: at the moment the transition completed, all 6 hub clusters were
  //     hidden, the rig had been teleported to (0, 12), and all 7 page planes
  //     had NO texture and sat at their #15120e placeholder tone — inside a room
  //     whose sky had just been themed #040404. A black room containing
  //     near-black rectangles, with the whole hub gone.
  //
  //     That is Sebastian's *"I couldn't even flip the cards to read them after
  //     I tried opening the reading room"*: the Experience cards are
  //     `.hub-cluster` children, so the reader had correctly hidden them — he
  //     was standing IN the reader without it looking like a reader.
  //
  //     Now page 1 is RASTERISED before the dip starts. You arrive with
  //     something to read.
  //
  //  3. NO RE-ENTRANCY GUARD. `if (state.open) close()` only catches a reader
  //     that has already finished opening; during the async window state.open is
  //     still false, so every extra tap started another full load. One accident
  //     was hiding it — a second runTransition kills the first one's tween, so
  //     the first build callback never fired — but that is luck, not design, and
  //     on other timing it appends a second reader root and leaks the first.
  var opening = null;    // the in-flight open, if any

  function open(project) {
    if (!project || !project.pdf) {
      console.warn('[vr] pdf-reader: no pdf for', project && project.title);
      return;
    }
    // Already loading: a repeat tap on the SAME piece is a no-op rather than a
    // second download, and on a different piece it replaces the target.
    if (opening) {
      if (opening.pdf === project.pdf) return;
      opening.cancelled = true;
    }
    if (state.open) close();
    state.project = project;

    var job = { pdf: project.pdf, cancelled: false };
    opening = job;

    var busy = window.VRBusy && VRBusy.begin('Opening “' + (project.title || 'the piece') + '”');
    if (busy) busy.onCancel = function () { job.cancelled = true; opening = null; };
    function say(stage, loaded, total) {
      if (busy && window.VRBusy) VRBusy.update(busy, { stage: stage, loaded: loaded, total: total });
    }
    function done() {
      if (busy && window.VRBusy) VRBusy.end(busy);
      if (opening === job) opening = null;
    }

    say('fetching the reader');
    loadPdfJs().then(function (lib) {
      if (job.cancelled) throw new Error('cancelled');
      say('downloading the document');
      // pdf.js reports real byte progress here — this is what turns "it just
      // sits there" into "it is 2.1 MB into 7.3 MB".
      var task = lib.getDocument(project.pdf);
      task.onProgress = function (p) {
        if (!job.cancelled) say('downloading the document', p.loaded, p.total);
      };
      return task.promise;
    }).then(function (doc) {
      if (job.cancelled) { try { doc.destroy(); } catch (e) {} throw new Error('cancelled'); }
      state.doc = doc;
      say('reading page 1', null, null);
      return doc.getPage(1);
    }).then(function (page) {
      if (job.cancelled) throw new Error('cancelled');
      var vp = page.getViewport({ scale: 1 });
      state.pageAspect = vp.width / vp.height;
      state.open = true;
      state.scroll = 0;
      // Rasterise page 1 BEFORE the dip — defect 2 above. Not fatal if it
      // fails: firstPage resolves either way, and the page planes will fill in
      // behind the transition as they always did.
      say('rendering the first page');
      return rasterisePageOne(page);
    }).then(function (firstTexture) {
      if (job.cancelled) throw new Error('cancelled');
      done();
      runTransition(function () {
        // At the dark peak, so the move itself is never seen. The comfort
        // vignette is parented to the rig (walk-controls._mountVignette), so it
        // travels with the viewer and the dip holds through the teleport.
        goToReadingRoom();
        // Still hidden even though it is now 12 m behind you: two constellations
        // and 32 drifting photo tiles glowing at that distance read as
        // distraction, not as scenery.
        setHubVisible(false);
        // Read in a neutral dark room — no themed sky. The piece is the only
        // thing that should carry colour here.
        //
        // The GROUND is deliberately left alone, per Sebastian: it should be
        // the same floor as the main room. An earlier version darkened it to
        // #080706, which read as standing on a different, blacker surface than
        // the dome you just came from — and because dome.js pins the floor's
        // radius to the dome's so its rim lands exactly on the ember horizon,
        // retinting it also broke that seam. dusk-rug is untouched either way
        // (it carries no .hub-cluster class), so the warm circle underfoot carries
        // straight over from the dome.
        var sky = document.querySelector('[dusk-sky]');
        if (sky) sky.components['dusk-sky'].setTheme('#040404', '#0d0a08');

        var root = build(project, state.doc);
        document.querySelector('a-scene').appendChild(root);
        state.root = root;
        // Page 1's texture was rendered before the dip; hand it straight to the
        // plane so the room is readable on arrival instead of a black rectangle
        // that fills in a second or two later.
        adoptFirstPage(firstTexture);
        // force: lastWindowIndex is 0 from the previous document, and scroll
        // starts at 0 too, so an unforced first call would decide the window
        // hasn't changed and render nothing at all.
        applyScroll();
        updateRenderWindow(true);
        setTimeout(refreshClickableRaycasters, 0);
      });
    }).catch(function (err) {
      done();
      if (String(err && err.message) === 'cancelled') {
        console.info('[vr] pdf-reader: open cancelled');
        // Nothing was torn down or hidden yet — the transition had not run — so
        // there is nothing to restore. This is exactly why the hub is now hidden
        // only AFTER everything has loaded.
        return;
      }
      console.warn('[vr] pdf-reader: could not open', project.pdf, err);
      // A failure past the transition would leave the hub hidden and the viewer
      // in an empty alcove with no reader and no way back. close() restores the
      // clusters, the light rack, the sky and the seat.
      if (state.open) close();
      else if (window.VRNotice && VRNotice.show) {
        VRNotice.show('That piece could not be opened', 'The document failed to load. It is still available on the flat site.');
      }
    });
  }

  // Page 1, rendered before the room transition so the reader is never entered
  // empty. Resolves with a texture, or with null if anything goes wrong — a
  // failure here must not block entry, since the strip fills in behind the dip
  // regardless.
  //
  // BOUNDED, and that bound is the point. Waiting for page 1 turns "enters an
  // empty black room" into "opens with something to read" — but it also puts a
  // pdf.js rasterisation on the critical path, and if that never settles the
  // reader would hang on the loading card forever, which is strictly worse than
  // the bug it fixes. (Not hypothetical: pdf.js's rasteriser needs real rAF, and
  // testing hit a pane where rAF was throttled to 0.2 fps and it never
  // returned.) So: 6 s, then go in anyway and let the render queue finish the
  // job behind the dip, exactly as it used to.
  var FIRST_PAGE_TIMEOUT_MS = 6000;

  function rasterisePageOne(page) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(tex) {
        if (settled) { if (tex) tex.dispose(); return; }
        settled = true;
        resolve(tex);
      }
      setTimeout(function () {
        if (settled) return;
        console.warn('[vr] pdf-reader: page 1 render exceeded ' + FIRST_PAGE_TIMEOUT_MS +
          'ms — entering anyway, the strip will fill in');
        finish(null);
      }, FIRST_PAGE_TIMEOUT_MS);
      try {
        var base = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: RENDER_PX / base.height });
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
          .then(function () {
            var tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 8;
            finish(tex);
          })
          .catch(function () { finish(null); });
      } catch (e) { finish(null); }
    });
  }

  function adoptFirstPage(tex) {
    if (!tex) return;
    var rec = state.pages[0];
    if (!rec) { tex.dispose(); return; }
    if (rec.texture) { tex.dispose(); return; }   // the queue beat us to it
    rec.texture = tex;
    rec.rendering = false;
    rec.material.map = tex;
    rec.material.color.set('#ffffff');
    rec.material.needsUpdate = true;
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    if (state.scrollTween) { state.scrollTween.kill(); state.scrollTween = null; }
    runTransition(function () {
      state.pages.forEach(disposePage);
      state.pages = [];
      if (state.doc) { try { state.doc.destroy(); } catch (e) {} state.doc = null; }
      if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
      // disposePage only frees page TEXTURES; these are the page planes' own
      // geometries/materials plus everything the scroll control built.
      state.disposables.forEach(function (d) { try { d.dispose(); } catch (e) {} });
      state.disposables = [];
      state.root = null;
      state.stripEl = null;
      state.pageLabelEl = null;
      // Cleared with everything else the scroll control built: a stale rail
      // reference would have updateScrollIndicator poking a removed entity on
      // the next open.
      state.rail = null;
      // Reset with everything else, or the next document inherits this one's
      // window index and render queue.
      renderQueue = [];
      renderBusy = false;
      lastWindowIndex = null;
      opening = null;                                    // no in-flight open survives a close
      renderToken++;                                     // orphan any in-flight settle
      if (renderWatchdog) { clearTimeout(renderWatchdog); renderWatchdog = null; }
      // No floor to reset — open() never retints it (see the ground note there).
      var sky = document.querySelector('[dusk-sky]');
      if (sky) sky.components['dusk-sky'].clearTheme();
      returnToDome();
      setHubVisible(true);
      refreshClickableRaycasters();
    });
  }
})();
