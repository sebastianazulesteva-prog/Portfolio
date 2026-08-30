/* ═══ busy.js ═══
   The one loading state, and the one input gate that goes with it.

   ── Why this exists ──
   Sebastian, second Vision Pro session: *"it still takes forever to load stuff,
   like going into rooms. And when one thing loads and I click on it, it lets me
   load and clicks on something else. If there's a load happening, that should be
   shown to the user."*

   Both halves are the same missing piece: feedback that arrives in the same
   frame as the tap, and an input gate for the window in between.

   ── What it does ──
   - `VRBusy.begin(label)` puts a card in front of the viewer in the SAME FRAME,
     and turns on a click gate. `update()` carries the stage and real byte
     progress; `end()` takes it down.
   - The gate is ONE capturing `click` listener on the scene. A-Frame's `emit`
     bubbles, so a capturing listener on an ancestor runs before the target
     entity's own handler and `stopPropagation()` there stops the click reaching
     it. That covers every input path at once — the mouse cursor, laser-controls,
     and xr-select's synthesised clicks — with no per-component change.
   - Clicks on the card itself are let through, so Cancel still works, as are
     clicks on anything marked `.vr-ungated` (the ?xrdiag=1 card, so an
     instrument is never gated by the thing it is measuring). A stray tap during
     a load does nothing at all rather than cancelling: Sebastian's complaint was
     taps going somewhere unintended, and making a stray tap abort the thing he
     asked for would be the same bug wearing a different hat.
   - The DOM overlay (Back to site, the HUD) sits outside `<a-scene>` and is
     deliberately NOT gated. There is always a way out.

   ── Three things this file got wrong, found after the third headset session ──

   1. THE TEXT COLLIDED. Title, stage line and bar were placed at HARDCODED y
      offsets — title at topY, stage at topY − 0.056 — on a plate of fixed
      height. The title is `Opening “<piece title>”`, which for
      *Social Engineering via Predictive Algorithms* wraps to three lines at
      0.038 m in a 0.67 m column, so line 2 landed on the stage line and line 3
      on the progress bar. That is exactly the *"its text is visibly
      overlapping / mushed up"* Sebastian reported, and this repo has had the fix
      for it — `text-flow.js`, measured stacking — since the bio card hit the
      same wall (§9.4). Now the stack is measured and the plate is sized from it.
      Arithmetic on the shipped version, for the record: the bar sat at
      y −0.021 ± 0.011 and the Cancel button spanned y −0.083…+0.017 over
      x 0.075…0.335, so the bar ran THROUGH the button as well.

   2. THE BAR LIED. With no byte total it parked at a hard 0.34, which is
      indistinguishable from a download stalled at 34% — and it is what
      Sebastian was looking at ("the progress bar sits at about 30%") for the
      whole of the stage that was actually failing. Indeterminate now LOOKS
      indeterminate: a segment shuttles along the track, driven from the tick
      (which runs on the XR clock, unlike anything on window rAF — see
      xr-frame.js) so it keeps moving inside an immersive session.

   3. THE GATE COULD OUTLIVE ITS JOB, and that is severe: this listener eats
      every click in the scene, so a job that is begun and never ended leaves
      the whole scene dead until reload. pdf-reader's `close()` cleared its own
      guard and never called `end()`. That call site is fixed, and `clearAll()`
      is now a real backstop instead of a function nothing ever called: a job
      with no `update()` for STALE_MS is force-ended from the tick, loudly.
      Checked on the tick and not a timer, because a timer is the other thing
      that may not be running (§3.14).

   ── Why it follows the gaze ──
   Softly, at 1.2 m and a little below eye level. A card placed once where you
   happened to be looking is a card you lose the moment you glance away — and
   glancing away is exactly what people do when nothing is happening. It is
   lerped, not snapped: head-locked UI that tracks rigidly is unpleasant.

   NOTE it follows the CAMERA object, not `#head`. In an immersive session
   three.js drives the camera that `camera` created *inside* `#head`, and
   `#head`'s own object3D no longer moves — so anything parented to `#head`
   is rig-locked, not gaze-locked, and would sit off to one side of wherever
   you are actually looking.

   Usage:
     var job = VRBusy.begin('Opening the reading room');
     VRBusy.update(job, { stage: 'fetching the reader', loaded: n, total: m });
     VRBusy.update(job, { stage: 'rendering page 1' });      // indeterminate
     VRBusy.end(job);
     job.onCancel = function () { ... };                      // optional
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var DIST = 1.2;
  var DROP_DEG = 11;          // below eye level, so it doesn't mask what you tapped
  var W = 0.78, PAD = 0.050;
  var BAR_H = 0.022;
  var BTN_H = 0.10;           // ui-button's enforced minimum; see ui-button.js
  var FOLLOW = 0.12;          // lerp per frame toward the gaze target
  // Vertical gaps between the four rows. Named because the plate's height is
  // derived from them plus the MEASURED title height — nothing here is a magic
  // offset any more.
  var GAP_TITLE = 0.016, GAP_STAGE = 0.018, GAP_BAR = 0.024;
  var TITLE_SIZE = 0.038, STAGE_SIZE = 0.024, STAGE_LINE = 1.25;
  // The stage line's height is RESERVED at two lines rather than measured. It
  // changes on every update ("downloading — 2.1 MB of 7.3 MB" is two lines,
  // "starting…" is one), and a plate that resizes while you watch it reads as a
  // glitch. The title only changes once per job, so that one is measured.
  var STAGE_LINES = 2;
  // Above notice.js's 20/21/22 — a loading card outranks everything, including a
  // "coming soon" notice. Transparent objects are not depth-sorted in this scene
  // (VR_AI_BUILD_GUIDE.md §3.6), so this is what puts it in front, not distance.
  var ORDER_PLATE = 30, ORDER_GLASS = 31, ORDER_CONTENT = 32;
  var ACCENT = '#c9c0ac';

  // Indeterminate shuttle: a segment this fraction of the track, sweeping the
  // full travel and back over this period.
  var SEG_FRAC = 0.24;
  var SHUTTLE_PERIOD = 1.7;   // seconds for a full there-and-back

  // A job with no update() for this long is force-ended. Generous: a slow link
  // fetching a 3.5 MB document with progress reporting will never go this quiet.
  // The alternative to a backstop here is a scene that is dead until reload.
  var STALE_MS = 30000;

  var jobs = [];              // a stack; nested loads are possible in principle
  var root = null;            // the card, built once and reused
  var titleEl, stageEl, barFill, barTrack, fillPivot, cancelEl, plateMesh, glassMesh;
  var gateInstalled = false;
  var trackW = W - PAD * 2;
  var plateH = 0;
  var indeterminate = false;
  var shuttlePhase = 0;
  var layoutPoll = null;

  function scene() { return document.querySelector('a-scene'); }

  function fmtBytes(n) {
    if (n == null) return null;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function blockHeight(el) {
    var m = el && el.components['troika-text'] && el.components['troika-text'].troikaTextMesh;
    if (!m || !m.textRenderInfo || !m.textRenderInfo.blockBounds) return null;
    var bb = m.textRenderInfo.blockBounds;
    return bb[3] - bb[1];
  }

  // ── The card ──────────────────────────────────────────────────────────────
  function build() {
    if (root) return root;
    var s = scene();
    if (!s) return null;

    root = document.createElement('a-entity');
    root.setAttribute('visible', false);
    root.classList.add('vr-busy');
    s.appendChild(root);

    plateMesh = new THREE.Mesh(
      VRScrollArrows.roundedRectGeometry(W, 0.3, 0.05),
      new THREE.MeshBasicMaterial({ color: '#0e0c09' })
    );
    plateMesh.position.z = -0.004;
    root.setObject3D('busy-plate', plateMesh);

    glassMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 0.3),
      VRGlass.makeCardMaterial(W, 0.3, 0.05, ACCENT, 0, 0.96)
    );
    root.setObject3D('busy-glass', glassMesh);

    titleEl = document.createElement('a-entity');
    titleEl.setAttribute('troika-text', {
      value: 'Loading', align: 'left', anchor: 'left', baseline: 'top',
      color: '#ffffff', font: VRFonts.title(), fontSize: TITLE_SIZE,
      maxWidth: W - PAD * 2, lineHeight: 1.15
    });
    root.appendChild(titleEl);
    VRGlass.lightTroikaText(titleEl, '#ffffff');

    stageEl = document.createElement('a-entity');
    stageEl.setAttribute('troika-text', {
      value: '', align: 'left', anchor: 'left', baseline: 'top',
      color: ACCENT, fillOpacity: 0.95, font: VRFonts.body(), fontSize: STAGE_SIZE,
      maxWidth: W - PAD * 2, lineHeight: STAGE_LINE
    });
    root.appendChild(stageEl);
    VRGlass.lightTroikaText(stageEl, ACCENT);

    // Progress bar. Geometry, not text — a percentage you have to read is worse
    // than a length you can see at a glance, and this is the one thing on screen
    // that answers "is it actually doing anything".
    barTrack = new THREE.Mesh(
      VRScrollArrows.roundedRectGeometry(trackW, BAR_H, BAR_H / 2),
      new THREE.MeshBasicMaterial({ color: '#241d15', transparent: true, opacity: 0.9 })
    );
    root.object3D.add(barTrack);

    barFill = new THREE.Mesh(
      VRScrollArrows.roundedRectGeometry(trackW, BAR_H, BAR_H / 2),
      new THREE.MeshBasicMaterial({ color: ACCENT })
    );
    // Scaled from its LEFT edge, so the group is offset and the mesh sits inside
    // it — scaling the mesh directly would grow it from the centre outward. The
    // pivot's x also SLIDES, which is what makes the indeterminate shuttle work
    // without a second mesh.
    fillPivot = new THREE.Group();
    barFill.position.x = trackW / 2;
    fillPivot.add(barFill);
    root.object3D.add(fillPivot);

    cancelEl = document.createElement('a-entity');
    cancelEl.setAttribute('ui-button', {
      label: 'Cancel', width: 0.26, height: BTN_H, accent: ACCENT,
      variant: 'ghost', fontScale: 1.15
    });
    cancelEl.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      var job = jobs[jobs.length - 1];
      if (job && job.onCancel) job.onCancel();
      end(job);
    });
    root.appendChild(cancelEl);

    layout(TITLE_SIZE * 1.15);   // provisional, corrected by relayout()'s poll
    return root;
  }

  // ── Layout, from the measured title height ────────────────────────────────
  function layout(titleH) {
    var stageH = STAGE_SIZE * STAGE_LINE * STAGE_LINES;
    var H = PAD * 2 + titleH + GAP_TITLE + stageH + GAP_STAGE + BAR_H + GAP_BAR + BTN_H;
    // relayout() polls until the measured title height is stable, so this runs
    // two or three times per job — no point rebuilding two geometries when the
    // answer hasn't moved.
    if (Math.abs(H - plateH) < 1e-6) return;
    plateH = H;

    if (plateMesh) {
      plateMesh.geometry.dispose();
      plateMesh.geometry = VRScrollArrows.roundedRectGeometry(W, H, 0.05);
    }
    if (glassMesh) {
      glassMesh.geometry.dispose();
      glassMesh.geometry = new THREE.PlaneGeometry(W, H);
      // The card shader reads its own size for the rounded corners and the
      // border, so a resized plate has to be told (§3.5's neighbourhood — a
      // shader whose uniforms drift from its geometry fails silently).
      var u = glassMesh.material.uniforms;
      if (u && u.uSize) u.uSize.value.set(W, H);
    }

    var leftX = -W / 2 + PAD;
    var y = H / 2 - PAD;
    titleEl.object3D.position.set(leftX, y, 0.014);
    y -= titleH + GAP_TITLE;
    stageEl.object3D.position.set(leftX, y, 0.014);
    y -= stageH + GAP_STAGE + BAR_H / 2;
    barTrack.position.set(0, y, 0.014);
    fillPivot.position.set(-trackW / 2, y, 0.016);
    y -= BAR_H / 2 + GAP_BAR + BTN_H / 2;
    cancelEl.object3D.position.set(W / 2 - PAD - 0.13, y, 0.03);
    lift();
  }

  // The title is the one measured block, and troika measures asynchronously.
  // Trap §3.2: after changing `value` the OLD blockBounds is still readable, so
  // "does it exist yet" returns immediately with the previous title's numbers.
  // Rather than try to detect the change, this re-lays-out on every poll and
  // stops once the height has been STABLE across two consecutive reads — the
  // same both-signals pattern the bio card needed (§9.4).
  function relayout() {
    if (layoutPoll) { layoutPoll.cancel(); layoutPoll = null; }
    var lastH = null;
    var poll = function () {
      var h = blockHeight(titleEl);
      if (h == null) return false;
      layout(h);
      if (lastH != null && Math.abs(h - lastH) < 0.0005) return true;
      lastH = h;
      return false;
    };
    if (window.VRPoll) layoutPoll = VRPoll.every(40, poll, { attempts: 30 });
    else { var n = 0; (function l() { if (poll() || ++n > 30) return; setTimeout(l, 40); })(); }
  }

  function lift() {
    if (!root) return;
    root.object3D.traverse(function (o) {
      if (!o.isMesh) return;
      o.renderOrder = (o === plateMesh) ? ORDER_PLATE : (o === glassMesh) ? ORDER_GLASS : ORDER_CONTENT;
    });
  }

  // ── The gate ──────────────────────────────────────────────────────────────
  function installGate() {
    if (gateInstalled) return;
    var s = scene();
    if (!s) return;
    gateInstalled = true;
    // Capture phase, on the scene: runs before the target entity's own click
    // handler, so stopping here stops the click reaching hub-panel, photo-cloud,
    // ui-button, everything — one gate for every input path.
    s.addEventListener('click', function (e) {
      if (!jobs.length) return;
      if (root && (e.target === root || root.contains(e.target))) return;  // Cancel
      if (e.target && e.target.closest && e.target.closest('.vr-ungated')) return;
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }, true);
  }

  // ── Gaze follow, the shuttle, and the staleness backstop ──────────────────
  AFRAME.registerComponent('busy-follow', {
    init: function () {
      this.target = new THREE.Vector3();
      this.camPos = new THREE.Vector3();
      this.camQuat = new THREE.Quaternion();
      this.fwd = new THREE.Vector3();
      this.look = new THREE.Vector3();
      this.dummy = new THREE.Object3D();
      this.first = true;
    },
    tick: function (t, dt) {
      if (!jobs.length) return;

      // Backstop, checked here rather than on a timer because the tick is the
      // clock that survives an immersive session (xr-frame.js) — and a timer is
      // what this is meant to protect against in the first place.
      var job = jobs[jobs.length - 1];
      if (job && job.touched && Date.now() - job.touched > STALE_MS) {
        clearAll('no update for ' + Math.round(STALE_MS / 1000) + 's — the caller never called end()');
        return;
      }

      if (indeterminate && !reducedMotion) {
        shuttlePhase = (shuttlePhase + (dt || 16) / 1000 / SHUTTLE_PERIOD) % 1;
        var u = 0.5 - 0.5 * Math.cos(shuttlePhase * Math.PI * 2);   // eased ping-pong
        fillPivot.scale.x = SEG_FRAC;
        fillPivot.position.x = -trackW / 2 + u * trackW * (1 - SEG_FRAC);
      }

      var cam = this.el.sceneEl.camera;
      if (!cam) return;
      cam.getWorldPosition(this.camPos);
      cam.getWorldQuaternion(this.camQuat);

      this.fwd.set(0, 0, -1).applyQuaternion(this.camQuat);
      // Yaw-only, plus a fixed drop — following pitch as well would put the card
      // over your feet when you look down at the page.
      this.fwd.y = 0;
      if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
      this.fwd.normalize();

      this.target.copy(this.camPos).addScaledVector(this.fwd, DIST);
      this.target.y = this.camPos.y - DIST * Math.tan(THREE.MathUtils.degToRad(DROP_DEG));

      var o = this.el.object3D;
      if (this.first || reducedMotion) { o.position.copy(this.target); this.first = false; }
      else o.position.lerp(this.target, FOLLOW);

      this.look.copy(this.camPos);
      this.look.y = o.position.y;      // face the viewer without tipping
      this.dummy.position.copy(o.position);
      this.dummy.lookAt(this.look);
      if (this.first || reducedMotion) o.quaternion.copy(this.dummy.quaternion);
      else o.quaternion.slerp(this.dummy.quaternion, FOLLOW);
    }
  });

  // ── API ───────────────────────────────────────────────────────────────────
  function begin(label) {
    installGate();
    var el = build();
    var job = { label: label || 'Loading', onCancel: null, id: Math.random(), touched: Date.now() };
    jobs.push(job);
    if (el) {
      if (!el.getAttribute('busy-follow')) el.setAttribute('busy-follow', '');
      var f = el.components['busy-follow'];
      if (f) f.first = true;                       // snap on first appearance
      el.setAttribute('visible', true);
      titleEl.setAttribute('troika-text', 'value', job.label);
      stageEl.setAttribute('troika-text', 'value', 'starting…');
      setIndeterminate(true);
      relayout();
    }
    return job;
  }

  function setFraction(f) {
    indeterminate = false;
    if (!fillPivot) return;
    fillPivot.position.x = -trackW / 2;
    // A hair of width even at zero, so the bar reads as a control that is about
    // to move rather than an empty slot.
    fillPivot.scale.x = Math.max(0.004, Math.min(1, f || 0));
  }

  function setIndeterminate(on) {
    indeterminate = !!on;
    if (!fillPivot) return;
    if (!on) return;
    // Reduced motion means "arrives in final state instantly", and a shuttle has
    // no final state — so there it is a static, obviously-partial segment rather
    // than a number it does not have.
    fillPivot.scale.x = SEG_FRAC;
    fillPivot.position.x = -trackW / 2 + (reducedMotion ? 0.5 * trackW * (1 - SEG_FRAC) : 0);
  }

  function update(job, info) {
    if (!job || !root || jobs.indexOf(job) < 0) return;
    info = info || {};
    job.touched = Date.now();
    if (info.label) {
      job.label = info.label;
      titleEl.setAttribute('troika-text', 'value', info.label);
      relayout();
    }

    var text = info.stage || '';
    if (info.total) {
      text += (text ? ' — ' : '') + fmtBytes(info.loaded || 0) + ' of ' + fmtBytes(info.total);
      setFraction((info.loaded || 0) / info.total);
    } else if (info.fraction != null) {
      setFraction(info.fraction);
    } else {
      // No number to show. Say so by moving, instead of parking at a hard 0.34
      // that is indistinguishable from a download stalled at a third.
      setIndeterminate(true);
    }
    stageEl.setAttribute('troika-text', 'value', text);
  }

  function end(job) {
    var i = job ? jobs.indexOf(job) : -1;
    if (i >= 0) jobs.splice(i, 1);
    else if (!job) jobs.length = 0;
    if (!jobs.length && root) root.setAttribute('visible', false);
  }

  // Belt and braces: if a caller throws between begin() and end(), the gate
  // would stay on and the scene would be permanently unclickable. Called by the
  // tick's staleness check, and available to anything that knows it has lost
  // track. It logs loudly — a force-clear always means a bug upstream.
  function clearAll(why) {
    if (!jobs.length) return;
    console.warn('[vr] busy: force-cleared', jobs.length, 'job(s) —', why || 'no reason given');
    jobs.length = 0;
    if (root) root.setAttribute('visible', false);
  }

  window.VRBusy = {
    begin: begin,
    update: update,
    end: end,
    clearAll: clearAll,
    isBusy: function () { return jobs.length > 0; },
    // For tests and for the dev harness: the plate is sized from the measured
    // title, so its height is the thing to assert on.
    _metrics: function () {
      return { plateH: plateH, jobs: jobs.length, indeterminate: indeterminate,
               fillScaleX: fillPivot ? fillPivot.scale.x : null,
               fillX: fillPivot ? fillPivot.position.x : null };
    }
  };
})();
