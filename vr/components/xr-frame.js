/* ═══ xr-frame.js ═══
   TIME, inside an immersive WebXR session. The sibling of xr-select.js: that
   file exists because INPUT does not work the way it does on a desktop in a
   headset, and this one exists because the CLOCK doesn't either.

   ── The fact this file is built on ──
   In an immersive session three.js hands the render loop over to the session's
   own clock. Verified in the pinned builds, not from memory:

     • aframe 1.5.0 a-scene:  renderer.setAnimationLoop(this.render)  — and
       `render()` calls `this.tick(time, delta)`, which ticks every component
       behaviour AND every system. So A-Frame's loop keeps running in-session.
     • three.js r158 WebXRManager REPLACES setAnimationLoop, so that callback is
       driven by `session.requestAnimationFrame`, not the window's.
     • gsap 3.12.5 ticker:  `m = requestAnimationFrame`, `p = _(yl)` — its
       ticker rides the WINDOW's rAF and nothing else.

   Per the WebXR model (and three.js's own migration guidance) the window's rAF
   is NOT serviced while an immersive session owns the display. The scene keeps
   drawing, components keep ticking, clicks keep working — and every GSAP tween
   in the scene stops dead, because the only thing that advances GSAP is a clock
   that is no longer ticking.

   That one fact explains a whole session's worth of "it's broken":
     card-flip's flip, pdf-reader's room transition and scroll, photo-cloud's
     bring-forward, bio-card's skills fly-in, focus-stage, notice's fade,
     column-scroll, name-scatter — every one of them is `gsap.to(...)`.
   And it explains why CLICKS worked throughout: xr-select.js is pure event
   handling with no clock in it at all.

   ── The fix ──
   A-Frame's loop is alive and runs on the XR clock, so drive GSAP from it.
   A SYSTEM, not a component, deliberately: a system is instantiated with the
   scene and ticks with no markup at all. VR_AI_BUILD_GUIDE.md §9.12 records a
   live bug where a class marker was dropped from index.html while the code
   reading it stayed on disk — anything that CAN be forgotten in markup
   eventually is. Systems also tick AFTER component behaviours and before
   `renderer.render()`, so a tween advanced here lands in the frame about to be
   drawn.

   ── Why double-driving is safe (this is the load-bearing detail) ──
   Read gsap's tick function: it derives its time from the WALL CLOCK, not by
   accumulating a per-call delta —

     function yl(t){ var a = Date.now() - z, s = (t===true);
                     ... i = (z += a) - A ; b = i - 1000*g.time; g.time = i/1000
                     ... s || (p = _(yl)) ... }

   So a second call in the same frame sees `a ≈ 0` and advances tween time by
   ≈ 0 ms. Ticking manually cannot double-advance anything, and because
   `s === true` skips the `p = _(yl)` re-arm, it cannot spawn a competing rAF
   loop either. That makes this safe on a runtime where the window's rAF DOES
   survive a session (Quest, today) as well as one where it doesn't.

   `lagSmoothing` is left at its default (500 ms → 33 ms) on purpose: it is
   what stops a tween from lurching after a real stall, and this file gives it
   nothing to protect against that it didn't already have.

   ── Scope ──
   Pumped ONLY while `renderer.xr.isPresenting`. Outside a session A-Frame's
   loop and GSAP's ticker are the same window rAF, so if one is starved the
   other is too and pumping could not help — including in the Claude preview
   pane, whose rAF stalls are trap §3.1 and need the workarounds in §9.10.10,
   not this. `?pump=0` disables it, which is how the A/B on the device is run:
   the same tap with the pump off is the control.

   ── VRPoll ──
   Also here, because it is the same problem wearing a different hat. There are
   nine "poll until troika has measured" loops in this codebase and every one is
   a self-scheduling `setTimeout`. setTimeout is clamped to ~1 s in a context
   the browser considers backgrounded, and whether visionOS calls an immersive
   session backgrounded is exactly what ?xrdiag=1 measures. A poll armed by
   BOTH a tick and a timeout, first one to fire wins, is strictly more robust
   than either alone: ticks survive a session, timeouts survive a stalled
   render loop in the preview pane.

     VRPoll.every(40, fn, {attempts: 80, onGiveUp: fn})   // fn returns true to stop

   Diagnostics: VRFrame.stats() — see xr-diag.js, which reads it.
*/

(function () {
  var params = new URLSearchParams(location.search);
  var PUMP_ENABLED = params.get('pump') !== '0';

  // ── VRPoll ────────────────────────────────────────────────────────────────
  // Dual-armed. `dueAt` is on performance.now() so both arms share one clock;
  // whichever fires first runs the attempt and re-arms both.
  var polls = [];

  function every(intervalMs, fn, opts) {
    opts = opts || {};
    var rec = {
      fn: fn,
      interval: Math.max(0, intervalMs || 0),
      max: opts.attempts != null ? opts.attempts : 80,
      onGiveUp: opts.onGiveUp || null,
      attempts: 0,
      dueAt: 0,
      timer: null,
      done: false
    };
    arm(rec);
    polls.push(rec);
    return { cancel: function () { finish(rec); } };
  }

  function arm(rec) {
    if (rec.done) return;
    rec.dueAt = perfNow() + rec.interval;
    rec.timer = setTimeout(function () { rec.timer = null; fire(rec); }, rec.interval);
  }

  function finish(rec) {
    if (rec.done) return;
    rec.done = true;
    if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    var i = polls.indexOf(rec);
    if (i >= 0) polls.splice(i, 1);
  }

  function fire(rec) {
    if (rec.done) return;
    if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    rec.attempts++;
    var stop;
    try {
      stop = rec.fn(rec.attempts);
    } catch (e) {
      console.warn('[vr] xr-frame: poll threw, dropping it —', e);
      finish(rec);
      return;
    }
    if (stop) { finish(rec); return; }
    if (rec.attempts >= rec.max) {
      finish(rec);
      if (rec.onGiveUp) { try { rec.onGiveUp(); } catch (e) {} }
      return;
    }
    arm(rec);
  }

  function perfNow() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function runPolls() {
    if (!polls.length) return;
    var now = perfNow();
    // Copy: fire() mutates `polls`, and a poll's own callback may add another.
    var due = null;
    for (var i = 0; i < polls.length; i++) {
      if (polls[i].dueAt <= now) { (due || (due = [])).push(polls[i]); }
    }
    if (due) for (var j = 0; j < due.length; j++) fire(due[j]);
  }

  // ── The GSAP pump ─────────────────────────────────────────────────────────
  var stats = {
    installed: false,
    pumpEnabled: PUMP_ENABLED,
    presenting: false,
    sceneTicks: 0,
    pumpTicks: 0,
    lastGsapFrame: -1,
    gsapSeen: typeof gsap !== 'undefined'
  };

  function isPresenting(sceneEl) {
    var r = sceneEl && sceneEl.renderer;
    if (r && r.xr && typeof r.xr.isPresenting === 'boolean') return r.xr.isPresenting;
    // Fallback for a scene that hasn't built its renderer yet, and for the
    // A-Frame-only signal.
    return !!(sceneEl && sceneEl.is && sceneEl.is('vr-mode'));
  }

  AFRAME.registerSystem('xr-frame', {
    init: function () {
      stats.installed = true;
      console.info('[vr] xr-frame: GSAP pump ' + (PUMP_ENABLED ? 'armed' : 'DISABLED by ?pump=0') +
        ' (drives gsap.ticker from the XR render loop while presenting)');
    },
    tick: function () {
      stats.sceneTicks++;
      runPolls();
      if (typeof gsap === 'undefined') return;
      stats.gsapSeen = true;
      var presenting = isPresenting(this.sceneEl);
      stats.presenting = presenting;
      if (!PUMP_ENABLED || !presenting) {
        stats.lastGsapFrame = gsap.ticker.frame;
        return;
      }
      gsap.ticker.tick();
      stats.pumpTicks++;
      stats.lastGsapFrame = gsap.ticker.frame;
    }
  });

  window.VRPoll = { every: every };
  window.VRFrame = {
    stats: function () {
      return {
        installed: stats.installed,
        pumpEnabled: stats.pumpEnabled,
        presenting: stats.presenting,
        sceneTicks: stats.sceneTicks,
        pumpTicks: stats.pumpTicks,
        gsapSeen: stats.gsapSeen,
        pendingPolls: polls.length
      };
    }
  };
})();
