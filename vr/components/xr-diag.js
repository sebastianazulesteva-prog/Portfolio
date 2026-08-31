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
     microtask    sanity floor. If promises don't drain, stop reading.
     hidden / visibilityState / session.visibilityState
                  the two things that would suspend timers and, on some
                  runtimes, animation libraries. Measured, not assumed.

   ── The A/B that proves causation ──
     ?xrdiag=1              pump on  (xr-frame.js drives GSAP)  → tween 100%
     ?xrdiag=1&pump=0       pump off (the shipped behaviour before this pass)
                                                                → tween 0%
   Two taps, two cards, and the difference is the proof. Run the pump=0 one
   FIRST, while the bug is still reproducible.

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
      (function mi() { if (stop) return; microFires++; Promise.resolve().then(mi); })();

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
        if (perfNow() - t0 < SAMPLE_MS) return false;
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
          frameRate: (sess && sess.frameRate) || null
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
      'microtasks        ' + r.microtaskFires,
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

    var body = fmt(r);
    var notes = verdict(r);

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
    var specs = [{
      value: 'XR clock — ' + (r.inSession ? 'in session' : 'desktop, no session'),
      font: VRFonts.title(), fontSize: 0.034, color: '#ffffff', maxWidth: maxW, gapAfter: 0.030
    }];
    body.forEach(function (line, i) {
      specs.push({
        value: line, font: VRFonts.body(), fontSize: 0.0235, color: ACCENT,
        maxWidth: maxW, lineHeight: 1.2, gapAfter: i === body.length - 1 ? 0.030 : 0.009
      });
    });
    notes.forEach(function (line) {
      specs.push({
        value: line, font: VRFonts.body(), fontSize: 0.0245, color: '#ffffff',
        maxWidth: maxW, lineHeight: 1.28, gapAfter: 0.014
      });
    });

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
