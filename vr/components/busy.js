/* ═══ busy.js ═══
   The one loading state, and the one input gate that goes with it.

   ── Why this exists ──
   Sebastian, second Vision Pro session: *"it still takes forever to load stuff,
   like going into rooms. And when one thing loads and I click on it, it lets me
   load and clicks on something else. If there's a load happening, that should be
   shown to the user."*

   Both halves are the same missing piece. Measured on the shipped reader, a tap
   on a writing card did this:

     tap → download pdf.min.js (320 KB) → download pdf.worker.min.js (1,087 KB)
         → download the PDF (17 KB … 7,315 KB) → parse page 1 → THEN dip

   1.41 MB of pdf.js fetched at the moment of the tap, from a CDN origin the page
   has not spoken to yet, and the dip transition — the only thing that changes on
   screen — comes last. So there are many seconds of total silence in which the
   hub is still fully visible and fully clickable, and of course you tap again.
   The second tap lands on whatever your ray is on.

   ── What it does ──
   - `VRBusy.begin(label)` puts a card in front of the viewer in the SAME FRAME,
     and turns on a click gate. `update()` carries the stage and real byte
     progress; `end()` takes it down.
   - The gate is ONE capturing `click` listener on the scene. A-Frame's `emit`
     bubbles, so a capturing listener on an ancestor runs before the target's own
     handler and `stopPropagation()` there stops the click reaching it. That
     covers every input path at once — the mouse cursor, laser-controls, and
     xr-select's synthesised clicks — with no per-component change.
   - Clicks on the card itself are let through, so Cancel still works. A stray
     tap during a load does nothing at all rather than cancelling: Sebastian's
     complaint was taps going somewhere unintended, and making a stray tap abort
     the thing he asked for would be the same bug wearing a different hat.
   - The DOM overlay (Back to site, the HUD) sits outside `<a-scene>` and is
     deliberately NOT gated. There is always a way out.

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
  var W = 0.78, PAD = 0.055;
  var BAR_H = 0.022;
  var FOLLOW = 0.12;          // lerp per frame toward the gaze target
  // Above notice.js's 20/21/22 — a loading card outranks everything, including a
  // "coming soon" notice. Transparent objects are not depth-sorted in this scene
  // (VR_AI_BUILD_GUIDE.md §3.6), so this is what puts it in front, not distance.
  var ORDER_PLATE = 30, ORDER_GLASS = 31, ORDER_CONTENT = 32;
  var ACCENT = '#c9c0ac';

  var jobs = [];              // a stack; nested loads are possible in principle
  var root = null;            // the card, built once and reused
  var titleEl, stageEl, barFill, barTrack, cancelEl;
  var gateInstalled = false;

  function scene() { return document.querySelector('a-scene'); }

  function fmtBytes(n) {
    if (n == null) return null;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
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

    // Height is fixed rather than content-fitted: this card appears and
    // disappears constantly and a plate that resizes as the stage text changes
    // length reads as a glitch.
    var H = PAD * 2 + 0.062 + 0.030 + BAR_H + 0.052;

    var plateGeo = VRScrollArrows.roundedRectGeometry(W, H, 0.05);
    var plate = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({ color: '#0e0c09' }));
    plate.position.z = -0.004;
    root.setObject3D('busy-plate', plate);

    root.setObject3D('busy-glass', new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      VRGlass.makeCardMaterial(W, H, 0.05, ACCENT, 0, 0.96)
    ));

    var leftX = -W / 2 + PAD;
    var topY = H / 2 - PAD;

    titleEl = document.createElement('a-entity');
    titleEl.setAttribute('troika-text', {
      value: 'Loading', align: 'left', anchor: 'left', baseline: 'top',
      color: '#ffffff', font: VRFonts.title(), fontSize: 0.038,
      maxWidth: W - PAD * 2, lineHeight: 1.15
    });
    titleEl.object3D.position.set(leftX, topY, 0.014);
    root.appendChild(titleEl);
    VRGlass.lightTroikaText(titleEl, '#ffffff');

    stageEl = document.createElement('a-entity');
    stageEl.setAttribute('troika-text', {
      value: '', align: 'left', anchor: 'left', baseline: 'top',
      color: ACCENT, fillOpacity: 0.95, font: VRFonts.body(), fontSize: 0.024,
      maxWidth: W - PAD * 2, lineHeight: 1.25
    });
    stageEl.object3D.position.set(leftX, topY - 0.056, 0.014);
    root.appendChild(stageEl);
    VRGlass.lightTroikaText(stageEl, ACCENT);

    // Progress bar. Geometry, not text — a percentage you have to read is worse
    // than a length you can see at a glance, and this is the one thing on screen
    // that answers "is it actually doing anything".
    var trackGeo = VRScrollArrows.roundedRectGeometry(W - PAD * 2, BAR_H, BAR_H / 2);
    barTrack = new THREE.Mesh(trackGeo, new THREE.MeshBasicMaterial({
      color: '#241d15', transparent: true, opacity: 0.9
    }));
    barTrack.position.set(0, topY - 0.104, 0.014);
    root.object3D.add(barTrack);

    var fillGeo = VRScrollArrows.roundedRectGeometry(W - PAD * 2, BAR_H, BAR_H / 2);
    barFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: ACCENT }));
    // Scaled from its LEFT edge, so the group is offset and the mesh sits inside
    // it — scaling the mesh directly would grow it from the centre outward.
    var fillPivot = new THREE.Group();
    fillPivot.position.set(-(W - PAD * 2) / 2, topY - 0.104, 0.016);
    barFill.position.x = (W - PAD * 2) / 2;
    fillPivot.add(barFill);
    root.object3D.add(fillPivot);
    root.__fillPivot = fillPivot;

    cancelEl = document.createElement('a-entity');
    cancelEl.setAttribute('ui-button', {
      label: 'Cancel', width: 0.26, height: 0.10, accent: ACCENT,
      variant: 'ghost', fontScale: 1.15
    });
    cancelEl.object3D.position.set(W / 2 - PAD - 0.13, -H / 2 + PAD + 0.05, 0.03);
    cancelEl.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      var job = jobs[jobs.length - 1];
      if (job && job.onCancel) job.onCancel();
      end(job);
    });
    root.appendChild(cancelEl);

    lift();
    [60, 200, 500].forEach(function (ms) { setTimeout(lift, ms); });
    return root;
  }

  function lift() {
    if (!root) return;
    var plate = root.getObject3D('busy-plate');
    var glass = root.getObject3D('busy-glass');
    root.object3D.traverse(function (o) {
      if (!o.isMesh) return;
      o.renderOrder = (o === plate) ? ORDER_PLATE : (o === glass) ? ORDER_GLASS : ORDER_CONTENT;
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
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }, true);
  }

  // ── Gaze follow ───────────────────────────────────────────────────────────
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
    tick: function () {
      if (!jobs.length) return;
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
    var job = { label: label || 'Loading', onCancel: null, id: Math.random() };
    jobs.push(job);
    if (el) {
      if (!el.getAttribute('busy-follow')) el.setAttribute('busy-follow', '');
      var f = el.components['busy-follow'];
      if (f) f.first = true;                       // snap on first appearance
      el.setAttribute('visible', true);
      titleEl.setAttribute('troika-text', 'value', job.label);
      stageEl.setAttribute('troika-text', 'value', 'starting…');
      setFraction(0);
      lift();
    }
    return job;
  }

  function setFraction(f) {
    if (!root || !root.__fillPivot) return;
    // A hair of width even at zero, so the bar reads as a control that is about
    // to move rather than an empty slot.
    root.__fillPivot.scale.x = Math.max(0.004, Math.min(1, f || 0));
  }

  function update(job, info) {
    if (!job || !root || jobs.indexOf(job) < 0) return;
    info = info || {};
    if (info.label) { job.label = info.label; titleEl.setAttribute('troika-text', 'value', info.label); }

    var text = info.stage || '';
    if (info.total) {
      text += (text ? ' — ' : '') + fmtBytes(info.loaded || 0) + ' of ' + fmtBytes(info.total);
      setFraction((info.loaded || 0) / info.total);
    } else if (info.fraction != null) {
      setFraction(info.fraction);
    } else {
      // Indeterminate: park the bar at a third rather than pretending to a
      // number we don't have.
      setFraction(0.34);
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
  // would stay on and the scene would be permanently unclickable. Nothing
  // should rely on this — it is a backstop, and it logs loudly.
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
    isBusy: function () { return jobs.length > 0; }
  };
})();
