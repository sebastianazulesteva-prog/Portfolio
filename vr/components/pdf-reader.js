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

   THE SCROLL CONTROL IS REAL GEOMETRY, AND IT IS LIT. The arrows are
   THREE.Shape triangles, not '▲'/'▼' troika text — the text version rendered
   as blank rounded rects (§3.6's missing-glyph trap, same root cause as the
   '↗' badge). Track and thumb are rounded pills on MeshStandardMaterial with
   an emissive floor, so the scene's light rack genuinely shades them instead
   of them reading as flat unlit chips.

   THE GROUND IS THE DOME'S GROUND. open() does not retint dusk-floor — you
   are meant to be standing on the same floor you arrived on.

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

  // Scroll-control visuals. The arrow triangles and the position thumb carry a
  // small emissive floor at rest and brighten on hover — see litMaterial().
  var TRACK_W = 0.075;
  var THUMB_EMISSIVE = 0.42;

  var state = {
    open: false,
    root: null,
    doc: null,
    pages: [],        // { el, mesh, material, texture, rendering, index }
    scroll: 0,        // metres scrolled from the top of page 1
    maxScroll: 0,
    project: null,
    transTween: null,
    thumbMesh: null,
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

  // ── PDF.js loading ───────────────────────────────────────────────────────
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

  // ── Page rendering ───────────────────────────────────────────────────────
  function renderPage(rec) {
    if (rec.texture || rec.rendering || !state.doc) return;
    rec.rendering = true;
    state.doc.getPage(rec.index + 1).then(function (page) {
      // Bail if the reader closed, or this page scrolled out of the window,
      // while the async render was in flight — otherwise we'd allocate a
      // texture nobody is going to look at.
      if (!state.open || !rec.wanted) { rec.rendering = false; return; }
      var base = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: RENDER_PX / base.height });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
        .then(function () {
          rec.rendering = false;
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
      rec.rendering = false;
      console.warn('[vr] pdf-reader: page ' + (rec.index + 1) + ' failed:', err);
    });
  }

  function disposePage(rec) {
    if (!rec.texture) return;
    rec.material.map = null;
    rec.material.color.set('#15120e'); // placeholder tone while unrendered
    rec.material.needsUpdate = true;
    rec.texture.dispose();
    rec.texture = null;
  }

  // Keep only the pages near the reading band rendered — see the memory note
  // at the top of this file.
  function updateRenderWindow() {
    var step = PAGE_HEIGHT + PAGE_GAP;
    var current = Math.floor(state.scroll / step);
    state.pages.forEach(function (rec) {
      rec.wanted = Math.abs(rec.index - current) <= RENDER_WINDOW;
      if (rec.wanted) renderPage(rec);
      else disposePage(rec);
    });
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
    if (!state.thumbMesh || !state.trackH) return;
    var frac = state.maxScroll > 0 ? state.scroll / state.maxScroll : 0;
    var travel = state.trackH - state.thumbH;
    // A bare THREE.Mesh, not an a-entity, specifically so this write can't be
    // clobbered — see the trap note in buildScrollControl.
    state.thumbMesh.position.y = travel / 2 - frac * travel;
    // A bar you can't travel any further with says so, rather than looking live
    // and doing nothing — the "is it broken or am I at the end?" problem.
    if (state.upBar && state.upBar.setEnabled) state.upBar.setEnabled(state.scroll > 0.001);
    if (state.downBar && state.downBar.setEnabled) state.downBar.setEnabled(state.scroll < state.maxScroll - 0.001);
    if (state.pageLabelEl) {
      var step = PAGE_HEIGHT + PAGE_GAP;
      var current = Math.min(state.doc.numPages, Math.floor(state.scroll / step) + 1);
      state.pageLabelEl.setAttribute('troika-text', 'value', current + ' / ' + state.doc.numPages);
    }
  }

  window.VRPdfReader = {
    open: open,
    close: close,
    isOpen: function () { return state.open; },
    scrollBy: scrollBy,
    // Exposed for the dev harness / camera-path rig, so the reader's scroll
    // state can be driven and asserted on without faking pointer input.
    _state: state
  };

  // ── Build ────────────────────────────────────────────────────────────────
  function build(project, pdfDoc) {
    var root = document.createElement('a-entity');
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
      var mat = new THREE.MeshBasicMaterial({ color: '#15120e', side: THREE.FrontSide });
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

    buildScrollControl(root, project);
    return root;
  }

  // ── Shape + material helpers for the scroll control ──────────────────────
  // The arrows are real GEOMETRY, not a font glyph. The first version labelled
  // two ui-buttons with troika-text '▲' / '▼' and they rendered as empty
  // rounded rects — exactly the failure documented for '↗' in
  // VR_AI_BUILD_GUIDE.md §3.6: the Syne latin subset (fonts.js) carries no
  // Geometric Shapes block, so troika silently substitutes or drops the glyph.
  // ui-button.js sidesteps that for its arrow badge by drawing into a canvas;
  // here a THREE.Shape is simpler and resolution-independent, and a triangle
  // can't be subset away by a webfont.
  function triangleGeometry(w, h, up) {
    var shape = new THREE.Shape();
    var half = h / 2;
    if (up) {
      shape.moveTo(-w / 2, -half); shape.lineTo(w / 2, -half); shape.lineTo(0, half);
    } else {
      shape.moveTo(-w / 2, half); shape.lineTo(w / 2, half); shape.lineTo(0, -half);
    }
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }

  // Pill-shaped track/thumb. The previous pair were hard-cornered rectangles,
  // which read as raw debug quads next to every other rounded surface in the
  // scene (the glass cards, ui-button, the page corners).
  function roundedRectGeometry(w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    var x = -w / 2, y = -h / 2;
    var shape = new THREE.Shape();
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r);
    shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h);
    shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    return new THREE.ShapeGeometry(shape, 12);
  }

  // Everything in the control is genuinely lit, per Sebastian ("add the
  // lighting effect to it all"). Same approach as VRGlass.lightTroikaText:
  // MeshStandardMaterial so the scene's light rack really shades it, with
  // `emissive` as a brightness FLOOR — this scene's rack is dim and warm, so
  // without the floor a white indicator sinks to a muddy grey (the exact
  // reasoning recorded in glass-material.js). The rack-lit terms still layer
  // real highlights on top, so it reads as part of the lit scene rather than
  // reverting to a flat unlit chip like the MeshBasicMaterial version was.
  function litMaterial(hex, emissiveIntensity, opts) {
    opts = opts || {};
    // Hard rule #4, and lightTroikaText's own precedent: accessible mode gets
    // flat maximum-contrast fills, never a surface that can dim under a light.
    if (document.body.classList.contains('accessible')) {
      return new THREE.MeshBasicMaterial({
        color: hex, side: THREE.DoubleSide,
        transparent: !!opts.transparent,
        opacity: opts.opacity != null ? opts.opacity : 1
      });
    }
    var mat = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: opts.roughness != null ? opts.roughness : 0.34,
      // Low metalness deliberately: there is no environment map in this scene,
      // and a metallic surface with nothing to reflect renders near-black.
      metalness: opts.metalness != null ? opts.metalness : 0.08,
      side: THREE.DoubleSide,
      transparent: !!opts.transparent,
      opacity: opts.opacity != null ? opts.opacity : 1
    });
    mat.emissive = new THREE.Color(hex);
    mat.emissiveIntensity = emissiveIntensity;
    return mat;
  }

  // The scroll control (redesigned, §9.6). Sebastian on the previous version:
  // the scroll-down buttons "feel off". They were two pads stacked in a tall
  // column off to the LEFT of the page, which put the control for moving text
  // vertically somewhere that isn't where the text is, and made the up/down
  // relationship read as "two buttons" rather than as a direction.
  //
  // Now: a LONG FLAT arrow bar at the top of the reading band and another at
  // the bottom, built by scroll-arrows.js — the same builder the writing column
  // uses, so the two scrolling surfaces in the scene are the same control
  // (Sebastian asked for exactly this shape for the column, and for the reader's
  // to match). A bar directly above the text that you click to move the text up
  // says what it does without a label.
  //
  // The bars sit at 55% of the page width, not the full width: they float in
  // front of the page, and at full width they'd mask a whole line of type at
  // each end of the band. At 55%, centred, the text either side of them stays
  // readable and they still read as bars rather than buttons.
  //
  // The track and thumb survive but are demoted to what they always actually
  // were — a position INDICATOR, not a control — and move to a slim strip down
  // the right edge of the page, out of the way of the arrows entirely.
  function buildScrollControl(root, project) {
    var pageW = PAGE_HEIGHT * state.pageAspect;
    var ACCENT = '#c9c0ac';
    var BAR_W = pageW * 0.55;
    // Just inside the top and bottom of the comfortable reading band, and
    // pulled toward the viewer so they're unambiguously in front of the page.
    var BAR_Z = -READ_DISTANCE + 0.10;
    var UP_Y = EYE_HEIGHT + 0.62;
    var DOWN_Y = EYE_HEIGHT - 0.72;

    function mkBar(up, y, dir) {
      var bar = window.VRScrollArrows.make({
        up: up, width: BAR_W, height: 0.115, accent: ACCENT,
        disposables: state.disposables,
        onClick: function () { scrollBy(dir * PAGE_HEIGHT * 0.45); }
      });
      bar.setAttribute('position', { x: 0, y: y, z: BAR_Z });
      root.appendChild(bar);
      return bar;
    }

    // Up moves you back toward page 1, so it scrolls NEGATIVE — the same
    // mapping the old pads had, kept deliberately: the bar's arrow points the
    // way the CONTENT travels, which is also the way you travel through it.
    state.upBar = mkBar(true, UP_Y, -1);
    state.downBar = mkBar(false, DOWN_Y, 1);

    // ── Position indicator, right edge ──
    var indicator = document.createElement('a-entity');
    indicator.setAttribute('position', { x: (pageW / 2) + 0.10, y: EYE_HEIGHT, z: BAR_Z });
    root.appendChild(indicator);

    state.trackH = 1.30;
    state.thumbH = Math.max(0.10, state.trackH / Math.max(1, state.doc.numPages));

    // The track sits in the rug's warm dark tone rather than pure black, so it
    // reads as a recess in the room instead of a hole punched through it.
    var trackGeo = roundedRectGeometry(TRACK_W, state.trackH, TRACK_W / 2);
    var trackMat = litMaterial('#1a140f', 0.10, { transparent: true, opacity: 0.6, roughness: 0.62 });
    indicator.setObject3D('track', new THREE.Mesh(trackGeo, trackMat));

    // A bare THREE.Mesh parented to the entity's object3D, NOT an a-entity.
    // As an entity this hit trap §3.4: the default `position` component
    // initialises after the synchronous build and overwrites whatever
    // updateScrollIndicator() had already written, so the thumb snapped from
    // the top of the track to its centre for the first frames of every open.
    // A plain mesh has no component to fight.
    var thumbGeo = roundedRectGeometry(TRACK_W, state.thumbH, TRACK_W / 2);
    var thumbMat = litMaterial('#f5f5f0', THUMB_EMISSIVE, { roughness: 0.26, metalness: 0.14 });
    var thumb = new THREE.Mesh(thumbGeo, thumbMat);
    thumb.position.z = 0.006;
    indicator.object3D.add(thumb);
    state.thumbMesh = thumb;

    state.disposables.push(trackGeo, trackMat, thumbGeo, thumbMat);

    var pageLabel = document.createElement('a-entity');
    pageLabel.setAttribute('troika-text', {
      value: '1 / ' + state.doc.numPages, align: 'center', anchor: 'center', baseline: 'center',
      color: '#f5f5f0', font: VRFonts.bodyBold(), fontSize: VRType.label()
    });
    // Directly under the down bar, so "where am I" and "go further" sit
    // together instead of at opposite ends of the reading band.
    pageLabel.setAttribute('position', { x: 0, y: EYE_HEIGHT - 0.86, z: BAR_Z + 0.01 });
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
    // x ±0.41 at a similar height, and this lands at x 0.81, so they don't meet.
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
    v.setAttribute('visible', true);
    mat.opacity = 0;
    state.transTween = gsap.to(mat, {
      opacity: 0.95, duration: half, ease: 'power2.inOut',
      onComplete: function () {
        applyChanges();
        state.transTween = gsap.to(mat, {
          opacity: 0, duration: half, ease: 'power2.inOut',
          onComplete: function () { v.setAttribute('visible', false); state.transTween = null; }
        });
      }
    });
  }

  function open(project) {
    if (!project || !project.pdf) {
      console.warn('[vr] pdf-reader: no pdf for', project && project.title);
      return;
    }
    if (state.open) close();
    state.project = project;

    loadPdfJs().then(function (lib) {
      return lib.getDocument(project.pdf).promise;
    }).then(function (doc) {
      state.doc = doc;
      return doc.getPage(1);
    }).then(function (page) {
      var vp = page.getViewport({ scale: 1 });
      state.pageAspect = vp.width / vp.height;
      state.open = true;
      state.scroll = 0;
      runTransition(function () {
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
        applyScroll();
        setTimeout(refreshClickableRaycasters, 0);
      });
    }).catch(function (err) {
      console.warn('[vr] pdf-reader: could not open', project.pdf, err);
    });
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
      state.thumbMesh = null;
      state.pageLabelEl = null;
      // Cleared with everything else the scroll control built: a stale bar
      // reference would have updateScrollIndicator poking a removed entity on
      // the next open.
      state.upBar = null;
      state.downBar = null;
      // No floor to reset — open() never retints it (see the ground note there).
      var sky = document.querySelector('[dusk-sky]');
      if (sky) sky.components['dusk-sky'].clearTheme();
      setHubVisible(true);
      refreshClickableRaycasters();
    });
  }
})();
