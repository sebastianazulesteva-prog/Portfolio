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

   THE PAGES ARE PRE-RENDERED IMAGES. NO PDF.JS. This is the third headset
   session's finding and the reason this file changed shape: pdf.js rasterises a
   page in chunks and schedules each one on window.requestAnimationFrame, and
   the window's rAF is NOT serviced inside an immersive WebXR session — the
   session's own clock drives the frame loop instead (see xr-frame.js). So in a
   headset no page ever finished rasterising, the 6 s first-page timeout fired
   every time, and the reader entered a black room full of near-black
   rectangles. On a desktop it worked perfectly, which is why it survived.

   Sebastian's call: pre-render every page at build time and load the results as
   ordinary textures. An <img> decode is not on the rAF clock, so it works in a
   session. `.tools/vr-make-pages.py` writes vr/assets/pages/<stem>/pNNN.webp
   plus a manifest.js publishing `window.VR_PAGES` — the same idiom as
   window.VR_TEX, a plain script with no fetch to sequence. Measured: 80 pages,
   10.6 MB of derivatives shipped, and opening a piece now costs ONE ~146 KB
   image instead of 1.41 MB of pdf.js plus up to 3.5 MB of PDF.

   CONTINUOUS SCROLL, LAZILY LOADED. All pages form one vertical strip, so
   scrolling is continuous rather than page-flipping. But these documents run to
   28 pages and a page image is up to 2.1 megapixels (8.4 MB of RGBA on the
   GPU), so only pages near the reading band hold a texture and the rest are
   disposed. Page PLANES always exist (cheap); only their textures come and go.
   The loads go through VRGlass.loadTexture, which is the scene's one four-at-a-
   time queue, and the page you are actually on is moved to the FRONT of it
   (prioritiseTexture) — the same fix the photo cloud needed in §9.17.

   TEXT SHARPNESS. Pages are shown unlit (MeshBasicMaterial) — a lit material
   would shade the paper unevenly and make body text harder to read, which is
   the opposite of the point here. Same reasoning as the project thumbnails
   staying ungraded (BUILD_NOTES ISSUE-07). Resolution is the generator's
   business: 150 DPI, long edge capped at 1700 px, which is ~30 pixels per
   degree at the size the page is shown against a Vision Pro's ~34.

   PAGE WIDTH IS CAPPED, and that is a real change. Two of the five pieces are
   16:9 slide decks, not letter portrait. Sizing them by HEIGHT alone — the old
   behaviour, arithmetic straight off the shipped constants — made a page
   1.95 x 3.47 m at 1.9 m from the eye: 85 degrees of yaw to read one line, and
   it put the scroll rail 44 degrees off view centre instead of the portrait
   case's 24. PAGE_MAX_W caps displayed width at the portrait page's own width,
   so every document reads at the same size and the rail and exit button land in
   the same place in all five. Letter portrait is untouched, to the millimetre.

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

   NO NEW RUNTIME DEPENDENCY. The page images are generated by a local tool and
   shipped as static files, so the standing "no build step, everything by CDN"
   rule is intact — this is the same arrangement vr/assets/tex already has.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Where the pre-rendered pages live, relative to the page that loads this
  // (vr/index.html and vr/_dev-preview.html are both in vr/). Same shape as
  // glass-material's TEX_DIR.
  var PAGES_DIR = 'assets/pages/';

  // Bio card is 1.05w x 1.46h; this is deliberately a bit bigger than that.
  // A page is fitted INSIDE this box, preserving its own aspect: letter
  // portrait (0.7727) is height-bound and comes out 1.95 x 1.507, exactly as
  // before; a 16:9 slide is width-bound and comes out 1.55 x 0.872. See the
  // PAGE WIDTH IS CAPPED note in the header for why the cap exists.
  var PAGE_MAX_H = 1.95;
  var PAGE_MAX_W = 1.55;
  var PAGE_GAP = 0.10;
  var READ_DISTANCE = 1.9;     // strip sits this far in front of the viewer
  var EYE_HEIGHT = 1.6;
  // Page 1's bottom edge used to rest at knee height, which put 0.85 m of a
  // 1.95 m page above eye level so the opening lines are overhead and you look
  // up to start reading. Expressed as a FRACTION so a short (landscape) page
  // gets the same framing rather than sinking to knee height and being read
  // from above: 0.436 of the page sits above the eye, whatever the page is.
  // For letter portrait this is arithmetically identical to the old constants.
  var KNEE_HEIGHT = 0.5;
  var LEAD_FRACTION = (KNEE_HEIGHT + PAGE_MAX_H - EYE_HEIGHT) / PAGE_MAX_H;
  var RENDER_WINDOW = 1;       // pages either side of the current one to keep loaded

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
    // Everything the reader needs about the document now comes from the
    // manifest, resolved once in open() — there is no document object any more.
    entry: null,      // the window.VR_PAGES record
    pageCount: 0,
    pageW: 0, pageH: 0, step: 0, topY1: 0,
    pages: [],        // { el, mesh, material, texture, loading, index, url }
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

  // ── The pages ────────────────────────────────────────────────────────────
  //
  // window.VR_PAGES is a plain script written by .tools/vr-make-pages.py — the
  // same idiom as window.VR_TEX, so the map is present before any component
  // runs and there is nothing to sequence. Keyed by the PDF's FILENAME, because
  // data-loader.js scrapes project.pdf off the project page and rootHref()s it
  // to "/<filename>".
  function manifestFor(pdfHref) {
    if (!pdfHref || !window.VR_PAGES) return null;
    var leaf = String(pdfHref).split('/').pop().split('?')[0].split('#')[0];
    var entry = window.VR_PAGES[leaf];
    if (!entry) {
      try { entry = window.VR_PAGES[decodeURIComponent(leaf)]; } catch (e) {}
    }
    return entry || null;
  }

  function pageUrl(entry, i) {
    return PAGES_DIR + entry.dir + '/' + entry.files[i];
  }

  // Fit the page inside the PAGE_MAX_W x PAGE_MAX_H box, preserving aspect.
  function pageBox(aspect) {
    var h = PAGE_MAX_H, w = h * aspect;
    if (w > PAGE_MAX_W) { w = PAGE_MAX_W; h = w / aspect; }
    return { w: w, h: h };
  }

  // ── Loading a page ───────────────────────────────────────────────────────
  //
  // Through VRGlass.loadTexture, deliberately: that is the scene's ONE texture
  // queue (four in flight) and the one place that knows about colour space and
  // anisotropy. It also gives prioritiseTexture() for free, which is what makes
  // "the page you are looking at loads first" true without a bespoke queue,
  // watchdog and render token in here — all three of which existed only because
  // pdf.js rasterised on the main thread and could hang.
  //
  // The plane keeps its placeholder tone and NO map until the image lands: a
  // THREE.Texture with no image assigned as a `map` renders as nothing useful,
  // and #2a241c reads as a page waiting rather than a hole in the room.
  function loadPage(rec, onSettled) {
    if (rec.texture || rec.loading) { if (onSettled) onSettled(rec.texture || null); return; }
    rec.loading = true;
    VRGlass.loadTexture(rec.url, function (tex) {
      rec.loading = false;
      // Closed, or scrolled out of the window while the image was in flight.
      if (!state.open || !rec.wanted) {
        tex.dispose();
        if (onSettled) onSettled(null);
        return;
      }
      rec.texture = tex;
      rec.material.map = tex;
      rec.material.color.set('#ffffff');   // stop tinting once real content is in
      rec.material.needsUpdate = true;
      if (onSettled) onSettled(tex);
    }, function () {
      rec.loading = false;
      console.warn('[vr] pdf-reader: page image failed to load:', rec.url,
        '— regenerate with .tools/vr-make-pages.py');
      if (onSettled) onSettled(null);
    });
    VRGlass.prioritiseTexture(rec.url);
  }

  function disposePage(rec) {
    if (!rec.texture) return;
    rec.material.map = null;
    // Against the reader's #040404 sky the old #15120e was invisible, so an
    // unloaded strip read as a void rather than as pages waiting — half of why
    // an empty reader looked broken rather than loading.
    rec.material.color.set('#2a241c');
    rec.material.needsUpdate = true;
    rec.texture.dispose();
    rec.texture = null;
  }

  // Keep only the pages near the reading band loaded.
  var lastWindowIndex = null;
  function updateRenderWindow(force) {
    if (!state.step) return;
    var current = Math.floor(state.scroll / state.step);
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
    // Nearest first, so the page you are on jumps the shared queue ahead of its
    // neighbours rather than sitting behind them.
    wanted.sort(function (a, b) {
      return Math.abs(a.index - current) - Math.abs(b.index - current);
    });
    wanted.forEach(function (rec) { loadPage(rec); });
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
      var current = Math.min(state.pageCount, Math.floor(state.scroll / state.step) + 1);
      state.pageLabelEl.setAttribute('troika-text', 'value', current + ' / ' + state.pageCount);
    }
  }

  window.VRPdfReader = {
    open: open,
    close: close,
    // prefetch() is GONE with pdf.js. There is nothing left to warm: opening a
    // piece costs one ~146 KB page image, so pre-pulling five of them for a
    // visitor who may open none would be the worse trade. index.html's idle
    // warm-up call went with it.
    isOpening: function () { return !!opening; },
    isOpen: function () { return state.open; },
    scrollBy: scrollBy,
    // Exposed for the dev harness / camera-path rig, so the reader's scroll
    // state can be driven and asserted on without faking pointer input.
    _state: state
  };

  // ── Build ────────────────────────────────────────────────────────────────
  function build(project, entry) {
    var root = document.createElement('a-entity');
    // At the alcove, facing wherever the viewer was looking when they opened it.
    // setAttribute for both, not object3D writes: this entity is created in the
    // same synchronous block, so the `position`/`rotation` components would
    // initialise afterwards and overwrite direct writes with the attribute
    // values (trap §3.4).
    root.setAttribute('position', { x: READING_SITE.x, y: 0, z: READING_SITE.z });
    root.setAttribute('rotation', { x: 0, y: currentHeadYawDeg(), z: 0 });

    // Geometry was resolved in open() from the manifest — one size for every
    // page in the document, which the generator refuses to produce otherwise.
    var pageCount = state.pageCount;
    var step = state.step;
    // Enough travel to bring the LAST page's lower portion down to the reading
    // band, not just to slide the last page into page 1's starting slot —
    // otherwise the final page's closing lines stay stuck up above eye level
    // and can't be read comfortably.
    state.maxScroll = Math.max(0, (pageCount - 1) * step + (state.topY1 - EYE_HEIGHT));

    var strip = document.createElement('a-entity');
    strip.setAttribute('position', { x: 0, y: 0, z: 0 });
    root.appendChild(strip);
    state.stripEl = strip;

    state.pages = [];
    state.disposables = [];
    for (var i = 0; i < pageCount; i++) {
      // See disposePage() for why this is not #15120e any more.
      var mat = new THREE.MeshBasicMaterial({ color: '#2a241c', side: THREE.FrontSide });
      var pageGeo = new THREE.PlaneGeometry(state.pageW, state.pageH);
      var mesh = new THREE.Mesh(pageGeo, mat);
      state.disposables.push(pageGeo, mat);
      var pageEl = document.createElement('a-entity');
      // LEAD_FRACTION of page 1 sits above eye level (0.85 m of a 1.95 m
      // portrait page — the old knee-height placement, restated so a short
      // landscape page gets the same framing); subsequent pages hang below.
      var topY = state.topY1 - i * step;
      pageEl.object3D.position.set(0, topY - state.pageH / 2, -READ_DISTANCE);
      pageEl.setObject3D('page', mesh);
      strip.appendChild(pageEl);
      state.pages.push({ el: pageEl, mesh: mesh, material: mat, texture: null,
                         loading: false, index: i, wanted: false,
                         url: pageUrl(state.entry, i) });
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
    var pageW = state.pageW;
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
      thumbFrac: 1 / Math.max(1, state.pageCount),
      accent: ACCENT, disposables: state.disposables,
      onUp: function () { scrollBy(-state.pageH * 0.45); },
      onDown: function () { scrollBy(state.pageH * 0.45); }
    });
    rail.setAttribute('position', { x: railX, y: (RAIL_TOP + RAIL_BOTTOM) / 2, z: RAIL_Z });
    root.appendChild(rail);
    state.rail = rail;

    var pageLabel = document.createElement('a-entity');
    pageLabel.setAttribute('troika-text', {
      value: '1 / ' + state.pageCount, align: 'center', anchor: 'center', baseline: 'center',
      color: '#f5f5f0', font: VRFonts.bodyBold(), fontSize: VRType.label()
    });
    // Directly under the rail, with "where am I" now sitting on the same axis as
    // the controls rather than across the page from them.
    pageLabel.setAttribute('position', { x: railX, y: RAIL_BOTTOM - 0.10, z: RAIL_Z + 0.01 });
    root.appendChild(pageLabel);
    state.pageLabelEl = pageLabel;
    VRGlass.lightTroikaText(pageLabel, '#f5f5f0', { emissive: true });

    // Title of the piece, clear of the page's towering top edge so it can't
    // collide with page 1 (whose top is state.topY1).
    var title = document.createElement('a-entity');
    title.setAttribute('troika-text', {
      value: project.title, align: 'center', anchor: 'center', baseline: 'bottom',
      color: '#ffffff', font: VRFonts.title(), fontSize: VRType.title() * 1.2, maxWidth: pageW
    });
    title.setAttribute('position', { x: 0, y: state.topY1 + 0.12, z: -READ_DISTANCE + 0.02 });
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
  // Four defects have been fixed here across three headset sessions. Keeping the
  // list because each one produced a symptom that looked like something else:
  //
  //  1. NO FEEDBACK. Every download happened before runTransition(), and the dip
  //     is the only thing that changes on screen. Many seconds of silence with
  //     the hub still live and clickable — so you tap again, and the second tap
  //     lands on whatever your ray is on. VRBusy fixes this half.
  //
  //  2. IT COMMITTED TO THE ROOM WITH NOTHING TO SHOW. Measured on that build:
  //     at the moment the transition completed, all 6 hub clusters were hidden,
  //     the rig had been teleported to (0, 12), and all 7 page planes had NO
  //     texture. A black room containing near-black rectangles, with the whole
  //     hub gone — which is Sebastian's *"I couldn't even flip the cards to read
  //     them after I tried opening the reading room"*: the Experience cards are
  //     `.hub-cluster` children, so the reader had correctly hidden them. He was
  //     standing IN the reader without it looking like a reader. Page 1 now
  //     arrives before the dip.
  //
  //  3. NO RE-ENTRANCY GUARD. `if (state.open) close()` only catches a reader
  //     that has already finished opening; during the async window state.open was
  //     still false, so every extra tap started another full load.
  //
  //  4. THE PAGE NEVER CAME. pdf.js needs window rAF, which does not run in an
  //     immersive session, so in a headset step 2's fix could not work either:
  //     page 1 timed out at 6 s every time, the loading card vanished (which is
  //     the *"eventually it just closed"* Sebastian described), and then the
  //     transition — a GSAP tween, also on window rAF — never ran, so he was
  //     never moved and there was no way back because there was no reader.
  //     Fixed at the root by xr-frame.js (the tween) and by pre-rendered page
  //     images (the page). See the header.
  //
  // Two smaller ones, both real and both fixed below: `state.open` was set
  // BEFORE the last await, so a cancel left a phantom-open reader with no root;
  // and `close()` never called `VRBusy.end()`, so a reader that closed with a
  // job outstanding left the capturing click gate on and every click in the
  // scene was dead until reload.
  var opening = null;    // the in-flight open, if any
  var busyJob = null;    // the loading card's job, so close() can put it away

  // Page 1 is loaded BEFORE the dip so the reader is never entered empty — but
  // bounded, because that puts a network fetch on the critical path and a reader
  // that hangs on the loading card forever is strictly worse than the bug it
  // fixes. After the timeout it enters anyway and the page fills in behind the
  // transition. 4 s rather than the old 6: this is now one ~146 KB image, not a
  // main-thread rasterisation of a 3.5 MB document.
  var FIRST_PAGE_TIMEOUT_MS = 4000;

  function endBusy() {
    if (busyJob && window.VRBusy) VRBusy.end(busyJob);
    busyJob = null;
  }

  function open(project) {
    if (!project || !project.pdf) {
      console.warn('[vr] pdf-reader: no pdf for', project && project.title);
      return;
    }
    var entry = manifestFor(project.pdf);
    if (!entry || !entry.files || !entry.files.length) {
      // Nothing to fall back to — the runtime rasteriser is gone on purpose. Say
      // so plainly rather than opening an empty room, and name the fix in the
      // console for whoever added the piece.
      console.warn('[vr] pdf-reader: no pre-rendered pages for', project.pdf,
        '— run .tools/vr-make-pages.py and reload. window.VR_PAGES has',
        window.VR_PAGES ? Object.keys(window.VR_PAGES).length : 0, 'entries.');
      if (window.VRNotice && VRNotice.show) {
        VRNotice.show('That piece isn’t ready to read here yet',
          'It is available on the flat site. (Its pages have not been prepared for VR.)');
      }
      return;
    }

    // Already loading: a repeat tap on the SAME piece is a no-op rather than a
    // second load, and on a different piece it replaces the target.
    if (opening) {
      if (opening.pdf === project.pdf) return;
      opening.cancelled = true;
    }
    if (state.open) close();
    state.project = project;

    var job = { pdf: project.pdf, cancelled: false };
    opening = job;

    busyJob = window.VRBusy ? VRBusy.begin('Opening “' + (project.title || 'the piece') + '”') : null;
    if (busyJob) busyJob.onCancel = function () { job.cancelled = true; opening = null; };
    function say(stage, loaded, total) {
      if (busyJob && window.VRBusy) VRBusy.update(busyJob, { stage: stage, loaded: loaded, total: total });
    }
    function done() {
      endBusy();
      if (opening === job) opening = null;
    }

    // Geometry first, and it is synchronous now — the manifest already knows the
    // page count and aspect, so there is no document to parse before the reader
    // knows how big it is.
    var box = pageBox(entry.aspect);
    state.entry = entry;
    state.pageCount = entry.files.length;
    state.pageW = box.w;
    state.pageH = box.h;
    state.step = box.h + PAGE_GAP;
    state.topY1 = EYE_HEIGHT + LEAD_FRACTION * box.h;
    state.scroll = 0;

    say('loading page 1 of ' + state.pageCount);

    firstPage(entry).then(function (firstTexture) {
      if (job.cancelled) {
        if (firstTexture) firstTexture.dispose();
        console.info('[vr] pdf-reader: open cancelled');
        // Deliberately NOT done() here. Two ways to get cancelled, and neither
        // wants it: the Cancel button's own handler in busy.js already ended
        // this job, and a tap on a DIFFERENT piece has already overwritten
        // `busyJob` and `opening` with the new load's — so ending "the" job here
        // would tear down the one the viewer is now waiting on.
        return;
      }
      done();
      // state.open is set HERE, inside the transition callback, not before the
      // await above. It used to be set before the last await, so cancelling left
      // a phantom-open reader — state.open true with no root, no rail and a
      // visible hub — and the next tap's `if (state.open) close()` then ran a
      // teardown against nothing.
      runTransition(function () {
        state.open = true;
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

        var root = build(project, entry);
        document.querySelector('a-scene').appendChild(root);
        state.root = root;
        // Page 1's image was fetched before the dip; hand it straight to the
        // plane so the room is readable on arrival instead of a placeholder
        // rectangle that fills in a second later.
        adoptFirstPage(firstTexture);
        // force: lastWindowIndex is 0 from the previous document, and scroll
        // starts at 0 too, so an unforced first call would decide the window
        // hasn't changed and load nothing at all.
        applyScroll();
        updateRenderWindow(true);
        setTimeout(refreshClickableRaycasters, 0);
      });
    }).catch(function (err) {
      done();
      console.warn('[vr] pdf-reader: could not open', project.pdf, err);
      // A failure past the transition would leave the hub hidden and the viewer
      // in an empty alcove with no reader and no way back. close() restores the
      // clusters, the light rack, the sky and the seat.
      if (state.open) close();
      else if (window.VRNotice && VRNotice.show) {
        VRNotice.show('That piece could not be opened', 'The first page failed to load. It is still available on the flat site.');
      }
    });
  }

  // Resolves with page 1's texture, or with null if it did not arrive in time —
  // never rejects, because a slow first page must not stop the reader opening.
  // The texture is created OUTSIDE the page records (build() has not run yet)
  // and adopted by adoptFirstPage once the planes exist.
  function firstPage(entry) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(tex) {
        if (settled) { if (tex) tex.dispose(); return; }
        settled = true;
        resolve(tex || null);
      }
      var url = pageUrl(entry, 0);
      VRGlass.loadTexture(url, finish, function () {
        console.warn('[vr] pdf-reader: page 1 image failed:', url);
        finish(null);
      });
      VRGlass.prioritiseTexture(url);
      setTimeout(function () {
        if (settled) return;
        console.warn('[vr] pdf-reader: page 1 exceeded ' + FIRST_PAGE_TIMEOUT_MS +
          'ms — entering anyway, the strip will fill in');
        finish(null);
      }, FIRST_PAGE_TIMEOUT_MS);
    });
  }

  function adoptFirstPage(tex) {
    if (!tex) return;
    var rec = state.pages[0];
    if (!rec || rec.texture) { tex.dispose(); return; }
    rec.texture = tex;
    rec.loading = false;
    rec.material.map = tex;
    rec.material.color.set('#ffffff');
    rec.material.needsUpdate = true;
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    if (state.scrollTween) { state.scrollTween.kill(); state.scrollTween = null; }

    // SYNCHRONOUSLY, before the transition — not in the callback below. These
    // two are guards, not visuals, and putting them at the dark peak is what
    // made the input gate leak: if the transition never completed (which is
    // exactly what happened in a headset, since it is a GSAP tween on a clock
    // that had stopped), `close()` cleared its own `opening` flag and never
    // called VRBusy.end(), so busy.js's capturing click listener stayed
    // installed and EVERY click in the scene was dead until reload. That is the
    // best candidate explanation for *"experience cards will not flip"* on a
    // second attempt, and it is the reason the four §5 bugs were worth chasing
    // separately from the clock.
    endBusy();
    opening = null;                                      // no in-flight open survives a close

    runTransition(function () {
      state.pages.forEach(disposePage);
      state.pages = [];
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
      // window index and page geometry.
      lastWindowIndex = null;
      state.entry = null;
      state.pageCount = 0;
      state.pageW = state.pageH = state.step = state.topY1 = 0;
      // No floor to reset — open() never retints it (see the ground note there).
      var sky = document.querySelector('[dusk-sky]');
      if (sky) sky.components['dusk-sky'].clearTheme();
      returnToDome();
      setHubVisible(true);
      refreshClickableRaycasters();
    });
  }
})();
