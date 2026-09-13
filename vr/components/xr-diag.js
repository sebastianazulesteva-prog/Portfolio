/* ═══ xr-diag.js ═══
   The measurement, taken where it counts, shown where it can be read.

   ── Why this file exists at all ──
   There is NO console in a Vision Pro. No devtools, no remote inspector while
   the headset is in an immersive session, no way to paste a snippet. So the
   standing method for this codebase — measure, don't assume (§3.1) — has no
   instrument on the one device where the bugs are. Every claim about in-headset
   behaviour up to now has been either a desktop measurement or a guess.

   So: `?xrdiag=1` samples the clocks in-session and prints the answer ON A CARD
   IN THE SCENE, in front of the viewer, in plain language. Screenshot it and
   the measurement leaves the headset.

   ── What it is measuring, and why each number is here ──
   The question is whether `window.requestAnimationFrame` is serviced inside an
   immersive session. If it is not, GSAP stops (its ticker rides the window's
   rAF and nothing else), which would freeze every transition, card flip and
   fly-in in the scene while leaving the render loop, the component ticks and
   the clicks all working — see xr-frame.js.

     window rAF   the whole question. ~0 means the hypothesis holds.
     XR rAF       the control. Should be ~90/s. If BOTH are ~0 the session is
                  paused and nothing here means anything.
     scene tick   A-Frame's own loop, driven by the XR clock. Proves the scene
                  is alive independently of the window's clock.
     GSAP ticker  the consequence. Frozen frame count = frozen tweens.
     test tween   the same thing end to end: a real gsap.to() run over the
                  sample window. 0% is the bug you can see.
     setTimeout   clamped to ~1 s in a context the browser considers
                  backgrounded. Nine "poll until troika measured" loops in this
                  codebase are self-scheduling setTimeouts, so this decides
                  whether they are 40× slower in a headset.
     MessageChannel  the fallback pump, if setTimeout turns out to be clamped.
     microtask    sanity floor. If promises don't drain, stop reading. Counted
                  in BOUNDED bursts re-armed on each poll — see the long note
                  at the sampler, because the unbounded version of this row is
                  what stopped this instrument ever producing a card.
     hidden / visibilityState / session.visibilityState
                  the two things that would suspend timers and, on some
                  runtimes, animation libraries. Measured, not assumed.

   ── The second section: the gaussian portrait ──
   Added 2026-09-13, because splat-portrait.js had spent three passes building
   a diag() that nothing read. Its own comment said "xr-diag.js picks this up
   and prints it on its card" and that was simply untrue, so every number it
   collected was console-only — on the one panel whose every failure mode is an
   empty patch of dome, on the one device with no console (§3.16).

   The section appears only when a splat portrait is in the scene, and the card
   RE-RUNS ITSELF when the portrait lab opens, because that is the only moment
   the two can coexist: the lab builds nothing until its button is pressed, the
   card is raised before that, and closing the card is one-way. It then waits
   for the splat to settle rather than reporting on a download in flight.

   ── The A/B that proves causation ──
     ?xrdiag=1              pump on  (xr-frame.js drives GSAP)  → tween 100%
     ?xrdiag=1&pump=0       pump off (the shipped behaviour before this pass)
                                                                → tween 0%
   Two taps, two cards, and the difference is the proof. Run the pump=0 one
   FIRST, while the bug is still reproducible.

   ── Two reasons this card had never actually been seen ──
   Both found 2026-09-13, while wiring the portrait section, and both are the
   same kind of failure this file exists to expose.

   1. THE SAMPLER FROZE THE PAGE. The microtask row was an unbounded chain —
      each microtask scheduling the next — and the browser drains microtasks to
      exhaustion before running any task. So no timer, no rAF and no VRPoll arm
      could ever fire, `stop` was never set, sample() never resolved, and
      `?xrdiag=1` simply hung the scene. Found by pausing the blocked thread
      over CDP: one call frame, the sampler itself.
   2. THE TEXT WAS OFF THE PLATE. VRTextFlow.stack left-ANCHORS at `s.x || 0`,
      which is the middle of the card; every other caller passes `-W/2 + PAD`
      and this one did not, so the column started at the centre and the long
      verdict lines ran off the right edge into the dome.

   Neither is subtle once the card is in front of you. Nobody could get it in
   front of them.

   ── Notes on how it is built ──
   Nothing in this file uses GSAP, on purpose: the instrument cannot depend on
   the thing under test. The card is placed by a tick-driven component, its
   lines are stacked by VRTextFlow (so a long verdict cannot mush into the line
   under it — the bug §5.3 was about), and the plate is sized from the measured
   stack. It is inert unless the flag is present: no entity is created, no
   sampler runs, nothing is registered but the API.

   Console, for the desktop/preview case: `VRDiag.run()` returns a promise for
   the same numbers, and logs them.
*/

(function () {
  var params = new URLSearchParams(location.search);
  var ENABLED = params.get('xrdiag') === '1';

  var SAMPLE_MS = 3000;
  var SETTLE_MS = 600;        // let the session get past its first frames
  var TIMEOUT_INTERVAL = 50;  // chained; ~60 fires in 3 s if unclamped
  // Microtasks enqueued per burst. Small enough to drain in microseconds;
  // the bound itself is what stops the sampler starving the event loop.
  var MICRO_BURST = 200;

  var CARD_W = 1.02;
  var CARD_DIST = 1.15;
  var PAD = 0.055;
  var ACCENT = '#c9c0ac';
  // Above busy.js's 30/31/32 — this is an instrument and must be readable even
  // if a loading card is up. Transparent objects are not depth sorted here
  // (§3.6), so renderOrder is what puts it in front, not distance.
  var ORDER_PLATE = 40, ORDER_GLASS = 41, ORDER_TEXT = 42;

  var running = false;
  var cardEl = null;

  function scene() { return document.querySelector('a-scene'); }

  function perfNow() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function session() {
    var s = scene();
    var r = s && s.renderer;
    try { return (r && r.xr && r.xr.getSession) ? r.xr.getSession() : null; }
    catch (e) { return null; }
  }

  // ── The sample ────────────────────────────────────────────────────────────
  function sample() {
    return new Promise(function (resolve) {
      var sess = session();
      var t0 = perfNow();

      var winFrames = 0, xrFrames = 0, timeoutFires = 0, msgFires = 0, microFires = 0;
      var stop = false;

      var frameStats0 = (window.VRFrame && VRFrame.stats()) || { sceneTicks: 0, pumpTicks: 0 };
      var gsapOK = typeof gsap !== 'undefined';
      var gsapFrame0 = gsapOK ? gsap.ticker.frame : 0;
      var gsapTime0 = gsapOK ? gsap.ticker.time : 0;

      // A real tween, not an inference. Duration is a little under the sample
      // window so a healthy clock finishes it and reports exactly 100%.
      var proxy = { v: 0 };
      var tween = null;
      if (gsapOK) {
        tween = gsap.to(proxy, { v: 1, duration: (SAMPLE_MS * 0.6) / 1000, ease: 'none' });
      }

      (function w() { if (stop) return; winFrames++; window.requestAnimationFrame(w); })();
      if (sess) (function x() { if (stop) return; xrFrames++; sess.requestAnimationFrame(x); })();
      (function tm() { if (stop) return; timeoutFires++; setTimeout(tm, TIMEOUT_INTERVAL); })();

      // ── The microtask sampler has to be BOUNDED, and that is load-bearing ──
      // This was `(function mi() { if (stop) return; microFires++;
      // Promise.resolve().then(mi); })()` — an unbounded chain of microtasks,
      // each one scheduling the next. The browser drains the microtask queue
      // to EXHAUSTION before it runs the next task, so a microtask that
      // schedules a microtask never gives the event loop back: no timers, no
      // rAF, no MessageChannel, no VRPoll. `stop` was therefore never set, the
      // closer below never ran, this promise never resolved, and no card was
      // ever built. `?xrdiag=1` froze the entire scene from the moment it was
      // used, which is why nothing in the repo ever read VRSplatDiag from a
      // card that could not exist.
      //
      // Found by pausing the blocked thread over CDP: one frame, `mi`, here.
      //
      // The note under the closer reasons carefully about WHICH clock times
      // the sample window and concludes VRPoll is safe because it is
      // dual-armed on tick and timeout. Both of those are tasks. The bug was
      // upstream of the choice.
      //
      // So: a bounded burst, re-armed from the closer (which VRPoll calls
      // every 100 ms). Still a rate over the whole window — ~30 bursts — and
      // the queue drains completely between them, so everything else runs.
      var microBurst = function () {
        var n = 0;
        (function step() {
          if (stop || n >= MICRO_BURST) return;
          n++; microFires++;
          Promise.resolve().then(step);
        })();
      };
      microBurst();

      var mc = null;
      if (window.MessageChannel) {
        mc = new MessageChannel();
        mc.port1.onmessage = function () { if (stop) return; msgFires++; mc.port2.postMessage(0); };
        mc.port2.postMessage(0);
      }

      // The sample window itself must NOT be timed by setTimeout — that is one
      // of the things under test. VRPoll is dual-armed (tick + timeout), so it
      // closes on whichever clock is actually running.
      var closer = function () {
        if (perfNow() - t0 < SAMPLE_MS) { microBurst(); return false; }
        stop = true;
        var frameStats1 = (window.VRFrame && VRFrame.stats()) || { sceneTicks: 0, pumpTicks: 0 };
        var secs = (perfNow() - t0) / 1000;
        if (tween) tween.kill();
        resolve({
          seconds: secs,
          windowRaf: winFrames,
          xrRaf: sess ? xrFrames : null,
          sceneTicks: frameStats1.sceneTicks - frameStats0.sceneTicks,
          pumpTicks: frameStats1.pumpTicks - frameStats0.pumpTicks,
          pumpEnabled: !!frameStats1.pumpEnabled,
          pumpInstalled: !!frameStats1.installed,
          gsapPresent: gsapOK,
          gsapFrames: gsapOK ? gsap.ticker.frame - gsapFrame0 : null,
          gsapSeconds: gsapOK ? +(gsap.ticker.time - gsapTime0).toFixed(2) : null,
          tweenProgress: gsapOK ? +proxy.v.toFixed(3) : null,
          timeoutFires: timeoutFires,
          timeoutExpected: Math.round(SAMPLE_MS / TIMEOUT_INTERVAL),
          messageChannelFires: msgFires,
          microtaskFires: microFires,
          documentHidden: !!document.hidden,
          visibilityState: document.visibilityState || 'n/a',
          sessionVisibility: sess ? (sess.visibilityState || 'n/a') : null,
          inSession: !!sess,
          frameRate: (sess && sess.frameRate) || null,
          // Null when there is no splat portrait in the scene, which is the
          // contract splat-portrait.js's own accessor documents — so the whole
          // section drops out rather than printing a row of dashes.
          splat: window.VRSplatDiag ? VRSplatDiag() : null
        });
        return true;
      };
      if (window.VRPoll) VRPoll.every(100, closer, { attempts: 400 });
      else { var iv = setInterval(function () { if (closer()) clearInterval(iv); }, 100); }
    });
  }

  // ── Reading the numbers ───────────────────────────────────────────────────
  function verdict(r) {
    var out = [];
    if (!r.inSession) {
      out.push('Not in a session — this is the desktop baseline, not the answer.');
    }
    var winPerSec = r.windowRaf / r.seconds;
    var xrPerSec = r.xrRaf != null ? r.xrRaf / r.seconds : null;

    if (r.inSession && xrPerSec != null && xrPerSec < 5) {
      out.push('The XR clock is not running either — the session is paused. Nothing else here is meaningful.');
      return out;
    }
    if (r.inSession) {
      if (winPerSec < 5) {
        out.push('CONFIRMED: window rAF is dead in-session (' + winPerSec.toFixed(1) +
          '/s) while the XR clock runs at ' + xrPerSec.toFixed(0) + '/s.');
      } else if (winPerSec < xrPerSec * 0.5) {
        out.push('window rAF is STARVED, not dead: ' + winPerSec.toFixed(1) + '/s against ' +
          xrPerSec.toFixed(0) + '/s on the XR clock. GSAP runs slow, not stopped.');
      } else {
        out.push('window rAF is HEALTHY in-session (' + winPerSec.toFixed(0) +
          '/s). The GSAP hypothesis is WRONG on this runtime — look elsewhere.');
      }
    }
    if (r.gsapPresent) {
      if (r.pumpEnabled && r.pumpTicks > 0) {
        out.push('Pump is driving GSAP (' + r.pumpTicks + ' ticks). Test tween reached ' +
          Math.round(r.tweenProgress * 100) + '% — ' +
          (r.tweenProgress > 0.95 ? 'the fix works.' : 'the fix is NOT enough.'));
      } else if (r.tweenProgress < 0.05) {
        out.push('GSAP is FROZEN: ' + r.gsapFrames + ' ticker frames, test tween at ' +
          Math.round(r.tweenProgress * 100) + '%. Every tween in the scene is stopped.');
      } else {
        out.push('GSAP advanced on its own: tween at ' + Math.round(r.tweenProgress * 100) + '%.');
      }
    }
    if (r.timeoutFires < r.timeoutExpected * 0.4) {
      out.push('setTimeout is CLAMPED (' + r.timeoutFires + ' of ~' + r.timeoutExpected +
        '). Every poll-until-measured loop is running slow.');
    }
    if (r.documentHidden) out.push('document.hidden is TRUE in-session — timers are throttled by design.');
    return out;
  }

  // ── The gaussian portrait ─────────────────────────────────────────────────
  // Wired in 2026-09-13, and it should have been from the start. splat-portrait
  // had built a careful diag() and its own comment claimed "xr-diag.js picks
  // this up and prints it on its card" — nothing did. So every number it
  // gathered was reachable only from a console, and §3.16 is that there is no
  // console in a headset. The one device where the splat has ever misbehaved
  // was the one device that could not be asked why.
  //
  // Every failure this panel has actually had looks identical from inside a
  // headset — an empty patch of dome — and each is a different row here:
  //   ready false, splats 0     the download or the parse failed
  //   splats > 0, drawn 0       loaded and never sorted (the library's own
  //                             heuristic tests the camera's LOCAL transform,
  //                             which is always identity in A-Frame)
  //   bytes != contentLength    the server compressed it; this is NORMAL on
  //                             GitHub Pages and used to be fatal (§3.18)
    //   webXRActive false while presenting
  //                             the stereo correction is off and the splats
  //                             are sized against the whole canvas, not an eye
  function splatFmt(d) {
    var wire = d.wire || {};
    var enc = wire.encoding || '—';
    var lines = [
      'src               ' + String(d.src || '—').replace(/^assets\//, ''),
      'gaussians         ' + d.splats + ' loaded, ' + d.drawn + ' drawn',
      'sorts             ' + d.sorts + (d.lastSortMs == null ? '' : '   (last ' + Math.round(d.lastSortMs) + ' ms)'),
      'splat width       ' + (d.splatWidth == null ? '—' : d.splatWidth),
      'stereo fix        ' + (d.webXRActive == null ? '—' : d.webXRActive) +
        (d.presenting ? '   (presenting)' : '   (flat)')
    ];
    if (wire.contentLength != null || wire.bytes) {
      // One row, not two: the whole point is the COMPARISON, and on a card
      // this tall every line has to earn itself.
      lines.push('transfer          ' + enc + ' ' +
        (wire.contentLength == null ? '?' : kb(wire.contentLength)) + ' -> ' +
        kb(wire.bytes || 0) + ' decoded' +
        (wire.bytes && wire.contentLength && wire.bytes !== wire.contentLength ? '   (differs)' : ''));
    }
    if (wire.trimmed != null) {
      lines.push('conditioned       ' + wire.trimmed + ' trimmed, ' +
        (wire.hiddenLayer || 0) + ' hidden, ' + (wire.darkened || 0) + ' darkened');
    }
    return lines;
  }

  function kb(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB';
  }

  function splatVerdict(d) {
    var out = [];
    var wire = d.wire || {};
    if (!d.ready) {
      out.push('The gaussian portrait has NOT loaded' +
        (wire.url ? ' (' + wire.url + ')' : '') + '. If it had failed outright the busy card ' +
        'would have said why; if this is a fresh open it may still be downloading.');
      return out;
    }
    if (!d.splats) {
      out.push('It reports ready with ZERO gaussians — the file parsed to nothing.');
      return out;
    }
    if (!d.drawn) {
      out.push('Loaded ' + d.splats + ' gaussians and is drawing NONE. It has been sorted ' +
        d.sorts + ' times. Nothing is on screen; this is the silent failure.');
    } else if (d.drawn < d.splats) {
      out.push('Drawing ' + d.drawn + ' of ' + d.splats + ' gaussians.');
    } else {
      out.push('Drawing all ' + d.splats + ' gaussians.');
    }
    if (wire.bytes && wire.contentLength && wire.bytes !== wire.contentLength) {
      out.push('The server sent it as ' + (wire.encoding || 'encoded') + ': ' +
        kb(wire.contentLength) + ' on the wire, ' + kb(wire.bytes) + ' decoded. That is ' +
        'correct and expected here — it is also what used to break the load (trap 3.18).');
    }
    if (d.presenting && d.webXRActive === false) {
      out.push('In a session with the stereo correction OFF: the splats are being sized ' +
        'against the whole canvas instead of one eye, so they will look stretched.');
    }
    return out;
  }

  function fmt(r) {
    var lines = [
      'window rAF        ' + r.windowRaf + '   (' + (r.windowRaf / r.seconds).toFixed(1) + '/s)',
      'XR rAF            ' + (r.xrRaf == null ? 'no session' : r.xrRaf + '   (' + (r.xrRaf / r.seconds).toFixed(0) + '/s)'),
      'scene tick        ' + r.sceneTicks + '   (' + (r.sceneTicks / r.seconds).toFixed(0) + '/s)',
      'GSAP ticker       ' + (r.gsapFrames == null ? 'no gsap' : r.gsapFrames + ' frames, ' + r.gsapSeconds + ' s'),
      'test tween        ' + (r.tweenProgress == null ? '—' : Math.round(r.tweenProgress * 100) + '%'),
      'GSAP pump         ' + (!r.pumpInstalled ? 'not installed' :
                              !r.pumpEnabled ? 'off (?pump=0)' : r.pumpTicks + ' ticks'),
      'setTimeout(50)    ' + r.timeoutFires + ' of ~' + r.timeoutExpected,
      'MessageChannel    ' + r.messageChannelFires,
      'microtasks        ' + r.microtaskFires + '   (bursts of ' + MICRO_BURST + ')',
      'document.hidden   ' + r.documentHidden + '   (' + r.visibilityState + ')',
      'session.visible   ' + (r.sessionVisibility == null ? '—' : r.sessionVisibility),
      'session.frameRate ' + (r.frameRate == null ? '—' : r.frameRate)
    ];
    return lines;
  }

  // ── The card ──────────────────────────────────────────────────────────────
  // Placed and oriented from a tick, like busy.js's follow: it must not need
  // GSAP to arrive, and it follows the CAMERA object rather than #head because
  // in a session three.js drives the camera inside #head and #head itself no
  // longer moves.
  AFRAME.registerComponent('xr-diag-place', {
    schema: { dist: { default: CARD_DIST } },
    init: function () {
      this.placed = false;
      this.camPos = new THREE.Vector3();
      this.camQuat = new THREE.Quaternion();
      this.fwd = new THREE.Vector3();
      this.look = new THREE.Vector3();
      this.dummy = new THREE.Object3D();
    },
    tick: function () {
      if (this.placed) return;
      var cam = this.el.sceneEl.camera;
      if (!cam) return;
      cam.getWorldPosition(this.camPos);
      cam.getWorldQuaternion(this.camQuat);
      this.fwd.set(0, 0, -1).applyQuaternion(this.camQuat);
      this.fwd.y = 0;
      if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
      this.fwd.normalize();
      var o = this.el.object3D;
      o.position.copy(this.camPos).addScaledVector(this.fwd, this.data.dist);
      o.position.y = this.camPos.y - 0.06;
      this.look.copy(this.camPos);
      this.look.y = o.position.y;
      this.dummy.position.copy(o.position);
      this.dummy.lookAt(this.look);
      o.quaternion.copy(this.dummy.quaternion);
      this.placed = true;      // a fixed card, not a follower — it gets screenshotted
    }
  });

  function destroyCard() {
    if (cardEl) {
      // "Run again" rebuilds this card, so it is a real teardown path and had
      // the same bug as everything else here: removeChild frees the entities and
      // leaves the plate geometry, the glass material and its program allocated.
      VRGlass.disposeSubtree(cardEl.object3D);
      if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    }
    cardEl = null;
  }

  function showCard(r) {
    var s = scene();
    if (!s) return;
    destroyCard();

    // ── Why the clock's numbers drop out when a splat is present ────────────
    // Measured, not guessed: both sections in full is 32 lines, which the
    // plate sizing turns into a card 1.55 m tall. At CARD_DIST that is 68° of
    // vertical view — you would have to crane your neck to read it and the
    // bottom would be through the floor. An instrument that does not fit in
    // front of you is not an instrument.
    //
    // So the clock keeps its VERDICT (the plain-language lines, which are the
    // answer) and loses its twelve numeric rows, which are not what you are
    // looking at when you are looking at the portrait. Nothing is lost across
    // a session: the card raised at scene start, before the lab exists, always
    // prints the clock in full.
    var body = r.splat ? [] : fmt(r);
    var notes = verdict(r);
    if (r.splat) {
      notes = notes.concat(['Clock numbers omitted to fit the portrait section — ' +
        'they are on the card raised before the lab opens.']);
    }

    cardEl = document.createElement('a-entity');
    cardEl.setAttribute('xr-diag-place', '');
    // `vr-ungated` is the class busy.js's capturing click gate lets through, so
    // Run again / Close still work if a loading card happens to be up — an
    // instrument must not be disabled by the thing it is measuring. `vr-diag` is
    // just a handle for tests.
    cardEl.classList.add('vr-diag');
    cardEl.classList.add('vr-ungated');
    s.appendChild(cardEl);

    var inner = document.createElement('a-entity');
    cardEl.appendChild(inner);

    var maxW = CARD_W - PAD * 2;
    // ── Every spec needs its own x ────────────────────────────────────────
    // VRTextFlow.stack left-ANCHORS each line and places it at `s.x || 0`,
    // and 0 is the middle of the plate — so without this the whole column
    // starts at the centre and the long verdict lines run off the right-hand
    // edge into the dome. focus-stage.js and card-flip.js both pass
    // `-W / 2 + PAD` for exactly this reason; this file was the one caller
    // that did not, and nobody ever saw it because the microtask sampler
    // above meant no card was ever built to look at.
    var leftX = -CARD_W / 2 + PAD;
    var specs = [{
      value: 'XR clock — ' + (r.inSession ? 'in session' : 'desktop, no session'),
      font: VRFonts.title(), fontSize: 0.034, color: '#ffffff', maxWidth: maxW,
      x: leftX, gapAfter: 0.030
    }];
    body.forEach(function (line, i) {
      specs.push({
        value: line, font: VRFonts.body(), fontSize: 0.0235, color: ACCENT,
        maxWidth: maxW, x: leftX, lineHeight: 1.2,
        gapAfter: i === body.length - 1 ? 0.030 : 0.009
      });
    });
    notes.forEach(function (line) {
      specs.push({
        value: line, font: VRFonts.body(), fontSize: 0.0245, color: '#ffffff',
        maxWidth: maxW, x: leftX, lineHeight: 1.28, gapAfter: 0.014
      });
    });

    // The splat section, only when there is a splat. Its own subheading,
    // because the card's title is about the XR clock and these numbers are
    // about something else entirely — two sections under one heading would
    // read as one list of unrelated rows.
    if (r.splat) {
      var splatBody = splatFmt(r.splat);
      var splatNotes = splatVerdict(r.splat);
      specs.push({
        value: 'Gaussian portrait', font: VRFonts.title(), fontSize: 0.030,
        color: '#ffffff', maxWidth: maxW, x: leftX, gapAfter: 0.022
      });
      splatBody.forEach(function (line, i) {
        specs.push({
          value: line, font: VRFonts.body(), fontSize: 0.0235, color: ACCENT,
          maxWidth: maxW, x: leftX, lineHeight: 1.2,
          gapAfter: i === splatBody.length - 1 ? 0.030 : 0.009
        });
      });
      splatNotes.forEach(function (line) {
        specs.push({
          value: line, font: VRFonts.body(), fontSize: 0.0245, color: '#ffffff',
          maxWidth: maxW, x: leftX, lineHeight: 1.28, gapAfter: 0.014
        });
      });
    }

    // Buttons sit under the measured stack, so a long verdict pushes them down
    // instead of running under them.
    var BTN_H = 0.10, BTN_GAP = 0.030;

    VRTextFlow.stack(inner, specs, {
      startY: 0, defaultGap: 0.012, z: 0.014,
      onReflow: function (bottomY) {
        var contentH = -bottomY;                       // startY is 0, bottomY is negative
        var H = PAD * 2 + contentH + BTN_GAP + BTN_H;
        // Re-centre the whole assembly: the stack was laid out from y=0 down.
        inner.object3D.position.y = H / 2 - PAD;

        var plateGeo = VRScrollArrows.roundedRectGeometry(CARD_W, H, 0.05);
        var plate = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({ color: '#0e0c09' }));
        plate.position.z = -0.004;
        cardEl.setObject3D('diag-plate', plate);
        cardEl.setObject3D('diag-glass', new THREE.Mesh(
          new THREE.PlaneGeometry(CARD_W, H),
          VRGlass.makeCardMaterial(CARD_W, H, 0.05, ACCENT, 0, 0.96)
        ));

        var btnY = -H / 2 + PAD + BTN_H / 2;
        var again = document.createElement('a-entity');
        again.setAttribute('ui-button', {
          label: 'Run again', width: 0.32, height: BTN_H, accent: ACCENT,
          variant: 'solid', labelColor: '#12100c', fontScale: 1.1
        });
        again.object3D.position.set(-CARD_W / 2 + PAD + 0.16, btnY, 0.03);
        again.addEventListener('click', function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
          run();
        });
        cardEl.appendChild(again);

        var close = document.createElement('a-entity');
        close.setAttribute('ui-button', {
          label: 'Close', width: 0.26, height: BTN_H, accent: ACCENT,
          variant: 'ghost', fontScale: 1.1
        });
        close.object3D.position.set(CARD_W / 2 - PAD - 0.13, btnY, 0.03);
        close.addEventListener('click', function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
          destroyCard();
        });
        cardEl.appendChild(close);

        lift();
        // ui-button and troika both finish asynchronously; re-lift so anything
        // that arrives late still sorts above the plate (§3.6 — moving it
        // forward is not what puts it in front).
        VRPoll.every(120, function (n) { lift(); return n >= 6; }, { attempts: 6 });
      }
    });
  }

  function lift() {
    if (!cardEl) return;
    var plate = cardEl.getObject3D('diag-plate');
    var glass = cardEl.getObject3D('diag-glass');
    cardEl.object3D.traverse(function (o) {
      if (!o.isMesh) return;
      o.renderOrder = (o === plate) ? ORDER_PLATE : (o === glass) ? ORDER_GLASS : ORDER_TEXT;
    });
  }

  // ── Entry points ──────────────────────────────────────────────────────────
  function run() {
    if (running) return Promise.resolve(null);
    running = true;
    destroyCard();
    return new Promise(function (resolve) {
      VRPoll.every(SETTLE_MS, function () {
        sample().then(function (r) {
          running = false;
          console.info('[vr] xr-diag —', JSON.stringify(r, null, 1));
          verdict(r).forEach(function (l) { console.info('[vr] xr-diag: ' + l); });
          if (r.splat) splatVerdict(r.splat).forEach(function (l) { console.info('[vr] xr-diag/splat: ' + l); });
          try { showCard(r); } catch (e) { console.warn('[vr] xr-diag: card failed', e); }
          resolve(r);
        });
        return true;
      }, { attempts: 1 });
    });
  }

  window.VRDiag = { run: run, sample: sample, close: destroyCard, enabled: ENABLED };

  if (!ENABLED) return;

  var s = document.querySelector('a-scene');
  function arm() {
    var sc = document.querySelector('a-scene');
    if (!sc) return;
    if (!window.VRPoll) {
      // xr-frame.js is what publishes VRPoll and is loaded first; if it is
      // missing the pump is missing too and there is nothing here worth
      // measuring, so say so rather than throwing at load.
      console.warn('[vr] xr-diag: VRPoll missing — is components/xr-frame.js loaded?');
      return;
    }
    sc.addEventListener('enter-vr', function () { run(); });

    // ── Re-run when the portrait lab opens ───────────────────────────────────
    // Without this the splat section could never actually be seen. The card is
    // raised at scene start and on enter-vr, at which point there is no splat
    // in the scene at all — the lab builds nothing until its button is
    // pressed — so `VRSplatDiag()` is null and the section drops out. And once
    // the card is closed there is no affordance anywhere to summon it back, so
    // the order you need (open the lab, THEN measure) was unreachable: the
    // only way to get the card was a reload, which closes the lab.
    //
    // So the lab's own open event re-runs it. Then it WAITS, because the splat
    // arrives seconds later — up to 12 MB — and a card that says "has NOT
    // loaded" about something still downloading is worse than no card. Polls
    // until it settles either way, and gives up after ~20 s and reports
    // whatever it found, which is itself the answer if a load has hung.
    sc.addEventListener('portrait-lab-open', function () {
      var waited = 0;
      VRPoll.every(700, function () {
        waited += 700;
        // Keep waiting through a run that is already in flight rather than
        // giving up on one. The first version returned `true` here — stop
        // polling — which meant that if the desktop baseline run happened to
        // still be sampling when the lab opened, the splat card silently never
        // appeared. Exactly the class of bug this card exists to expose.
        if (running) return waited > 30000;
        var d = window.VRSplatDiag ? VRSplatDiag() : null;
        var settled = d && (d.drawn > 0 || (d.ready && d.sorts > 0));
        if (!settled && waited < 20000) return false;
        run();
        return true;
      }, { attempts: 48 });
    });
    // Desktop / preview baseline, so the same card can be checked without a
    // headset. Skipped if a session is already up — enter-vr owns that case.
    VRPoll.every(2500, function () {
      if (!running && !cardEl && !session()) run();
      return true;
    }, { attempts: 1 });
  }
  if (s) arm();
  else document.addEventListener('DOMContentLoaded', arm);
})();
