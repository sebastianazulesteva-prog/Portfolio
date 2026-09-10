/* ═══ wake.js ═══
   Arriving. Everything at once, slowly, from the middle outward.

   Sebastian, 2026-09-09: *"I want everything to appear at the same time, and
   slowly — like you're waking up from a dream (awareness slowly branching out
   from the centre). So it's ok to have a little loading screen as everything
   loads in the background. Because right now, the image of me loads first and
   it just feels weird (same thing goes for the project rooms)."*

   ── What was actually wrong ──
   Nothing was staged. `hud.js` faded the DOM arrival veil on the scene's own
   `loaded` event, which fires when A-Frame has a renderer and the markup is
   attached — well BEFORE `VRData.load()` has scraped the site, before the
   constellations exist, and before a single photograph has decoded. So the
   first thing a visitor saw was whatever happened to finish first, which is
   reliably the hero portrait: it is in the markup rather than built from
   scraped data, and its four eye textures are queued before anything else
   asks. Then cards arrived one at a time over the next few seconds. The scene
   did not open, it accumulated.

   ── The shape of the fix ──
   Two halves, and the first is the one that matters:

   1. NOTHING IS SHOWN UNTIL EVERYTHING IS READY. Ready means the scene has
      loaded, the content has been wired (index.html fires `vr-content-ready`
      once every cluster is placed), and the shared texture queue has actually
      drained (`VRGlass.texturesPending() === 0`, held for a few frames so a
      momentary gap between one image finishing and the next starting does not
      read as done).

   2. THEN IT OPENS FROM THE CENTRE. The mask is the comfort vignette, which
      is already a black BackSide sphere at the eye compositing last with no
      depth (locomotion.js), and whose alpha already falls off by the angle off
      the view axis. Its edges are uniforms now, so easing them from a pinhole
      out to the resting vignette grows a clear hole from the middle of your
      vision to its edges. That is the "awareness branching out" literally: you
      can see straight ahead first and your periphery arrives last.

   ── Why the mask and not fading the content ──
   The obvious alternative is to fade every panel in. It is worse in three
   ways. Materials in this scene are a mix — a custom glass shader, feathered
   image shaders, troika text, MeshBasic plates — with no common opacity, so it
   would mean a per-type walker. Turning `transparent` on for opaque materials
   forces recompiles and changes how the whole scene sorts (§3.6). And it
   cannot cover the frames BEFORE the content exists, which is the actual
   complaint. One mask in front of the eye has none of those problems and is
   the same in a headset as on a monitor.

   ── The escape hatch is not optional ──
   A gate that waits for "everything" will eventually wait forever: one 404
   texture, one slow CDN font, one hung fetch. Every wait here is bounded, and
   when the budget runs out the scene opens anyway. A visitor who is shown a
   slightly incomplete dome is fine; a visitor held behind a black sphere is
   looking at a broken site.

   Usage: <a-entity wake></a-entity>          (once, at the scene root)
          VRWake.open({ ms: 1600 })            — reused by project rooms
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Resting values of the vignette's own radial edges — where the mask ends up.
  var REST_LO = 0.38, REST_HI = 0.90;
  // Shut: alpha 1 everywhere except a pinhole dead ahead. Not (1.0, 1.0),
  // which is the degenerate smoothstep the shader guards against.
  var SHUT_LO = 0.995, SHUT_HI = 1.0;

  var OPEN_MS = 2600;          // centre -> periphery. Slow on purpose.
  var FADE_TAIL = 0.42;        // last fraction of the open spent fading the
                               // residual edge darkening away to nothing
  var READY_HOLD_MS = 260;     // texture queue must read empty this long
  var MAX_WAIT_MS = 11000;     // hard cap; see the escape-hatch note above

  // ── The little loading screen ───────────────────────────────────────────
  // Sebastian allowed one — "it's ok to have a little loading screen" — and
  // it is not optional in practice: the wait measured 3.1 s on a warm local
  // server, and VR_BUGFIX item 10 already records that a long dark hold reads
  // as a broken load. Three seconds of black with nothing in it is exactly
  // that bug with a longer fuse.
  //
  // A ring, because it says "working" without words in any language, and
  // because the scene already speaks in rings (dwell.js). Parented to the
  // CAMERA so it sits dead centre however the head is turned — the one moment
  // in the whole scene where something is allowed to be head-locked, since
  // there is nothing else to look at yet.
  var RING_R = 0.055, RING_W = 0.006, RING_Z = -1.1, SEGS = 96;
  var ring = null;

  function ringBuild() {
    if (ring) return ring;
    var head = document.querySelector('#head');
    if (!head) return null;
    var g = new THREE.Group();
    // Track: the whole circle, very dim, so the arc has something to run in.
    var track = new THREE.Mesh(
      new THREE.RingGeometry(RING_R - RING_W / 2, RING_R + RING_W / 2, SEGS),
      new THREE.MeshBasicMaterial({ color: '#b8863b', transparent: true, opacity: 0.16,
                                    depthTest: false, depthWrite: false })
    );
    // Arc: rebuilt per frame from thetaLength. A ring this small is 96 tris;
    // rebuilding it is cheaper than the alternative of a shader, and this runs
    // for about three seconds once per page load.
    var arc = new THREE.Mesh(
      new THREE.RingGeometry(RING_R - RING_W / 2, RING_R + RING_W / 2, SEGS, 1, Math.PI / 2, 0.001),
      new THREE.MeshBasicMaterial({ color: '#e0a878', transparent: true, opacity: 0.95,
                                    depthTest: false, depthWrite: false })
    );
    track.renderOrder = arc.renderOrder = 1001;   // in front of the mask's 999
    g.add(track); g.add(arc);
    g.position.set(0, 0, RING_Z);
    g.frustumCulled = false;
    head.object3D.add(g);
    ring = { group: g, track: track, arc: arc, t0: performance.now() };
    return ring;
  }

  // frac < 0 means indeterminate: a short arc chasing its own tail, for the
  // stretch before anything has been queued and there is nothing to measure.
  function ringSet(frac) {
    var r = ringBuild();
    if (!r) return;
    var start, len;
    if (frac < 0) {
      var t = (performance.now() - r.t0) / 1000;
      start = Math.PI / 2 - t * 2.2;
      len = 0.9;
    } else {
      start = Math.PI / 2;
      len = Math.max(0.001, Math.min(1, frac) * Math.PI * 2);
    }
    r.arc.geometry.dispose();
    // Negative sweep so it fills clockwise from the top, the way a clock reads.
    r.arc.geometry = new THREE.RingGeometry(RING_R - RING_W / 2, RING_R + RING_W / 2,
                                            SEGS, 1, start, -len);
  }

  function ringFade() {
    var r = ring;
    if (!r) return;
    var t0 = performance.now();
    (function step() {
      var k = Math.min(1, (performance.now() - t0) / 340);
      r.track.material.opacity = 0.16 * (1 - k);
      r.arc.material.opacity = 0.95 * (1 - k);
      if (k < 1) return requestAnimationFrame(step);
      ringDispose();
    })();
  }

  function ringDispose() {
    if (!ring) return;
    var r = ring; ring = null;
    if (r.group.parent) r.group.parent.remove(r.group);
    [r.track, r.arc].forEach(function (m) {
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
  }

  function vignette() {
    var el = document.querySelector('#comfortVignette');
    var c = el && el.components && el.components['vignette-flash'];
    return c ? { el: el, c: c } : null;
  }

  // ── The mask ────────────────────────────────────────────────────────────
  function shut() {
    var v = vignette();
    if (!v) return;
    v.el.removeAttribute('animation__in');
    v.el.removeAttribute('animation__out');
    v.el.removeAttribute('animation__hold');
    v.c.setFlat(true);                       // real cover, not a vignette
    v.c.setRadius(SHUT_LO, SHUT_HI);
    v.el.setAttribute('visible', true);
    v.el.setAttribute('material', 'opacity', 1);
  }

  // Ease the hole open. Driven from a tick rather than GSAP: this runs during
  // arrival, which is exactly when the main thread is busiest, and a tween
  // whose ticker is starved would leave the mask shut (§3.14 — and in an
  // immersive session gsap.ticker is not serviced at all without xr-frame's
  // pump, which is a dependency this has no reason to take).
  function open(opts) {
    opts = opts || {};
    var v = vignette();
    if (!v) return Promise.resolve();
    var ms = opts.ms || OPEN_MS;
    if (reducedMotion) {
      v.c.setFlat(false); v.c.resetRadius();
      v.el.setAttribute('material', 'opacity', 0);
      v.el.setAttribute('visible', false);
      return Promise.resolve();
    }
    v.c.setFlat(false);                      // back to a radial shape to open it
    return new Promise(function (resolve) {
      var t0 = performance.now();
      function step() {
        var k = Math.min(1, (performance.now() - t0) / ms);
        // easeInOutSine: no hard start, no hard stop. A linear open reads as a
        // wipe; this reads as coming to.
        var e = 0.5 - Math.cos(Math.PI * k) / 2;
        v.c.setRadius(SHUT_LO + (REST_LO - SHUT_LO) * e,
                      SHUT_HI + (REST_HI - SHUT_HI) * e);
        // The edge darkening only starts letting go once the hole has most of
        // the frame, so the periphery is the last thing to resolve.
        var tail = Math.max(0, (k - (1 - FADE_TAIL)) / FADE_TAIL);
        v.el.setAttribute('material', 'opacity', 1 - tail);
        if (k < 1) { requestAnimationFrame(step); return; }
        v.el.setAttribute('visible', false);
        v.c.resetRadius();
        resolve();
      }
      requestAnimationFrame(step);
    });
  }

  // ── Waiting ─────────────────────────────────────────────────────────────
  // Resolves when the texture queue has been empty for READY_HOLD_MS, or when
  // `budget` runs out. Never rejects.
  function texturesSettled(budget) {
    return new Promise(function (resolve) {
      if (!window.VRGlass || !VRGlass.texturesPending) return resolve('no queue to watch');
      var t0 = performance.now(), emptySince = 0, peak = 0;
      (function poll() {
        var pending = VRGlass.texturesPending();
        var now = performance.now();
        // Progress is measured against the HIGH-WATER mark, because there is
        // no total to ask for: work is queued as each component builds, so the
        // denominator only becomes known as the queue grows. It can therefore
        // stall (never go backwards) if a late component queues more — which
        // is honest, and better than a bar that jumps back.
        peak = Math.max(peak, pending);
        ringSet(peak ? 1 - pending / peak : -1);
        if (pending === 0) {
          if (!emptySince) emptySince = now;
          if (now - emptySince >= READY_HOLD_MS) return resolve('settled');
        } else {
          emptySince = 0;
        }
        if (now - t0 >= budget) return resolve('timed out with ' + pending + ' pending');
        setTimeout(poll, 90);
      })();
    });
  }

  function once(target, ev, budget) {
    return new Promise(function (resolve) {
      var done = false;
      function fire(why) { if (done) return; done = true; resolve(why); }
      target.addEventListener(ev, function () { fire(ev); }, { once: true });
      setTimeout(function () { fire('timeout waiting for ' + ev); }, budget);
    });
  }

  window.VRWake = {
    shut: shut,
    ringSet: ringSet,
    ringFade: ringFade,
    open: open,
    texturesSettled: texturesSettled,
    // What the arrival did, for the dev harnesses and for xr-diag.
    report: function () { return window.__vrWakeReport || null; }
  };

  AFRAME.registerComponent('wake', {
    init: function () {
      var scene = this.el.sceneEl;
      var t0 = performance.now();
      var log = {};

      // Shut the mask as early as possible — before the first painted frame if
      // the material exists yet, and again on 'loaded' in case it did not.
      shut();
      scene.addEventListener('loaded', shut, { once: true });

      var budget = MAX_WAIT_MS;
      Promise.resolve()
        .then(function () {
          return scene.hasLoaded ? 'already loaded' : once(scene, 'loaded', budget);
        })
        .then(function (why) {
          log.sceneLoaded = Math.round(performance.now() - t0) + 'ms (' + why + ')';
          shut();
          // index.html fires this once every cluster has been placed.
          var spin = setInterval(function () { ringSet(-1); }, 33);
          return once(scene, 'vr-content-ready', Math.max(0, budget - (performance.now() - t0)))
            .then(function (w) { clearInterval(spin); return w; });
        })
        .then(function (why) {
          log.contentReady = Math.round(performance.now() - t0) + 'ms (' + why + ')';
          return texturesSettled(Math.max(500, budget - (performance.now() - t0)));
        })
        .then(function (why) {
          log.texturesSettled = Math.round(performance.now() - t0) + 'ms (' + why + ')';
          // Hand the DOM veil off first: it is a flat-screen-only overlay and
          // holding both would double-darken the open.
          var veil = document.getElementById('arrivalVeil');
          if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
          // The ring goes first and faster than the mask, so the last thing
          // you see before the scene is the dome and not a UI element fading
          // over it.
          ringFade();
          return open();
        })
        .then(function () {
          log.opened = Math.round(performance.now() - t0) + 'ms';
          window.__vrWakeReport = log;
          scene.emit('vr-woke', log, false);
        });
    }
  });
})();
