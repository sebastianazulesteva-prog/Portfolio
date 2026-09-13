/* ═══ xr-select.js ═══
   Selection for headsets that have no controllers — Apple Vision Pro, and any
   other browser whose input arrives as WebXR `transient-pointer`.

   ── Why this exists ──
   VR_TEST_REPORT.md's "Genuinely blocked on hardware" section predicted this
   exactly, and the first Vision Pro session confirmed it: buttons that need
   several tries, a room that takes "a few minutes" to open, a photo in the
   cloud that can't be picked at all.

   The scene selects through A-Frame's `cursor`, which emits `click` only if the
   SAME entity was intersected on both the press and the release, and it learns
   what is intersected from a `raycaster` running on tick. On the hands that
   raycaster hangs off `laser-controls`, which is built on `tracked-controls` and
   matches *controller* profiles.

   Vision Pro Safari has no controllers. A pinch materialises an input source
   with `targetRayMode: 'transient-pointer'`, fires selectstart → select →
   selectend, and takes it away again. There is no persistent pose to track, no
   hover before the press, and often not a single tick in which A-Frame's
   raycaster sees the target — so most pinches produce nothing, and the ones
   that land look like luck. That is the "lag": not frame rate, dropped input.

   ── What it does instead ──
   Hooks the SESSION's own select events, and on each one takes the ray straight
   from `frame.getPose(inputSource.targetRaySpace, referenceSpace)` and does its
   own raycast, then emits A-Frame's `click` on whatever it hit. One frame, one
   pose, one hit — no hover state, no tick ordering, no profile matching.

   Every control in the scene already listens for `click`, so all ~70 clickables
   start working with no change of their own. The ray Apple gives is eye-based,
   which also means you select what you are LOOKING at rather than what your
   nose is pointed at.

   ── Why not every tracked-pointer ──
   A Quest CONTROLLER is left strictly alone: A-Frame handles it correctly and a
   second click emitter would fire everything twice — open-then-close,
   enter-then-exit. The one thing this does take over is the HAND raycasters,
   and only once a transient pointer has actually been seen: A-Frame's
   `generic-tracked-controller-controls` matches any profile at all, so it can
   bind to a transient pointer for the frame it exists and emit a competing
   click. Disabled on first sight, restored on exit.

   ── Quest HAND TRACKING takes the same path (2026-09-11) ──
   A hand-tracked source is `tracked-pointer`, not `transient-pointer`, so the
   old scoping skipped it — and nothing else picked it up either:

   • `oculus-touch-controls` sets `handTrackingEnabled: false`, so it never
     matches a hand.
   • `generic-tracked-controller-controls` DOES match (Quest's hand profiles are
     `generic-hand-select-grasp` / `generic-hand`, and it matches on the prefix
     `generic`), which fires `controllerconnected` and opens pointer.js's
     `hand-ray-gate`. But it binds `cursor` to `triggerdown`, and a hand input
     source has no gamepad to fire one. So a hands-only visitor got a laser and
     no way to click with it. With `hand-ray-gate` now starting disabled, the
     more recent state was no laser and no click: an entirely inert scene.

   Two things fix it, and the split matters:

   1. THE CLICK comes from here, on exactly the same machinery as a Vision Pro
      pinch. The gate is `!inputSource.gamepad`: if a browser ever does expose a
      gamepad on a hand, A-Frame can emit the click itself and this steps back
      out rather than doubling it. Self-correcting, rather than a version check.
   2. THE AIM has to be retargeted. `tracked-controls-webxr` defaults to
      `gripSpace`, which for a hand is the PALM — so A-Frame drew the laser out
      of the side of your hand while the select ray came from
      `targetRaySpace`, the pinch-pointing ray metres away from it. Pointing
      one place and selecting another is worse than no line at all, so
      `aimHandRay()` moves that entity onto `targetRaySpace` (read fresh every
      tick, so a live setAttribute is enough) and the drawn line becomes the
      ray this file raycasts. If the component isn't there to retarget, the
      hand is muted instead — no line beats a lying one.

   What a hand does NOT get is a controller's full hover-before-press, because
   the two rays have to agree and only one of them is drawn. Press is the first
   feedback, same as the Vision Pro deal below.

   Diagnostics: load with `?xrdebug=1` to log every input source (handedness,
   targetRayMode, profiles) and every hit/miss with distance. That is the
   difference between diagnosing the next headset session in seconds and
   guessing at it.
*/

(function () {
  var DEBUG = /[?&]xrdebug=1/.test(location.search);
  var FAR = 20;   // matches the head cursor's raycaster="far: 20"

  function log() {
    if (!DEBUG) return;
    console.info.apply(console, ['[xr-select]'].concat(Array.prototype.slice.call(arguments)));
  }

  // The nearest ancestor that IS an A-Frame entity. A hit lands on a
  // THREE.Mesh, and only objects installed via setObject3D carry `.el` — a
  // plain `object3D.add(mesh)` child (the reader's scroll thumb, the skills
  // plate) carries nothing, so walking up is required, not defensive.
  function entityFor(obj) {
    while (obj) {
      if (obj.el) return obj.el;
      obj = obj.parent;
    }
    return null;
  }

  // three.js's raycaster does NOT test `visible` — it only tests layers — so a
  // hidden parent does not protect its children. That matters here more than
  // anywhere: inside the reader and the project rooms every `.hub-cluster` is
  // hidden at the PARENT, and without this walk all six clusters stay clickable
  // through the wall of the room you are standing in (the same effective-
  // visibility problem sunflower.js had to solve).
  function visible(obj) {
    while (obj) {
      if (obj.visible === false) return false;
      obj = obj.parent;
    }
    return true;
  }

  // A hand-tracked source: `hand` is the XRHand, and the ray is the browser's
  // pinch-pointing ray rather than a controller's.
  function isHand(src) {
    return !!(src && src.hand && src.targetRayMode === 'tracked-pointer');
  }

  // Does THIS file own the click for this source? A transient pointer always
  // (nothing else can), a hand only while nothing else can emit one for it.
  function handles(src) {
    if (!src) return false;
    if (src.targetRayMode === 'transient-pointer') return true;
    return isHand(src) && !src.gamepad;
  }

  AFRAME.registerComponent('xr-select', {
    init: function () {
      this.raycaster = new THREE.Raycaster();
      this.raycaster.far = FAR;
      this.origin = new THREE.Vector3();
      this.direction = new THREE.Vector3();
      this.rayMat = new THREE.Matrix4();
      this.pressed = null;        // entity hit at selectstart
      this.sawTransient = false;
      this.handsMuted = [];
      this.aimed = [];            // hand entities moved onto targetRaySpace
      this.warnedNoPose = false;
      this.session = null;

      this.onSelectStart = this.onSelectStart.bind(this);
      this.onSelect = this.onSelect.bind(this);
      this.onSelectEnd = this.onSelectEnd.bind(this);
      this.onSourcesChange = this.onSourcesChange.bind(this);

      this.el.addEventListener('enter-vr', this.attach.bind(this));
      this.el.addEventListener('exit-vr', this.detach.bind(this));
    },

    attach: function () {
      var session = this.el.renderer && this.el.renderer.xr && this.el.renderer.xr.getSession();
      if (!session) return;
      this.session = session;
      session.addEventListener('selectstart', this.onSelectStart);
      session.addEventListener('select', this.onSelect);
      session.addEventListener('selectend', this.onSelectEnd);
      session.addEventListener('inputsourceschange', this.onSourcesChange);
      this.onSourcesChange({ added: session.inputSources });
      log('attached; mode', session.environmentBlendMode, 'sources', session.inputSources.length);
    },

    detach: function () {
      var session = this.session;
      if (!session) return;
      session.removeEventListener('selectstart', this.onSelectStart);
      session.removeEventListener('select', this.onSelect);
      session.removeEventListener('selectend', this.onSelectEnd);
      session.removeEventListener('inputsourceschange', this.onSourcesChange);
      this.session = null;
      this.pressed = null;
      this.sawTransient = false;
      this.warnedNoPose = false;
      this.unmuteHands();
    },

    onSourcesChange: function (evt) {
      var added = evt.added || [];
      for (var i = 0; i < added.length; i++) {
        var src = added[i];
        log('source', src.handedness, src.targetRayMode, 'hand:' + !!src.hand,
            'gamepad:' + !!src.gamepad, JSON.stringify(src.profiles));
        if (src.targetRayMode === 'transient-pointer') this.muteHands();
        else if (isHand(src)) this.aimHandRay(src);
      }
    },

    // Move this hand's entity onto the ray the browser actually aims with. See
    // the header: the default is `gripSpace`, which for a hand is the palm, so
    // A-Frame draws the laser out of the side of your hand while every select
    // resolves from `targetRaySpace`. `tracked-controls-webxr` re-reads
    // `data.space` every tick, so setting it live is enough.
    //
    // Falls back to muting that hand: with no way to make the drawn line agree
    // with the ray, no line is better than a wrong one.
    aimHandRay: function (src) {
      var sel = src.handedness === 'left' ? '#leftHand'
              : src.handedness === 'right' ? '#rightHand' : null;
      if (!sel) return;
      var el = document.querySelector(sel);
      if (!el) return;
      if (el.components && el.components['tracked-controls-webxr']) {
        el.setAttribute('tracked-controls-webxr', 'space', 'targetRaySpace');
        this.aimed.push(el);
        log('hand ray retargeted to targetRaySpace on', sel);
        return;
      }
      if (el.getAttribute('raycaster')) {
        el.setAttribute('raycaster', 'enabled', false);
        el.setAttribute('raycaster', 'showLine', false);
        this.handsMuted.push(el);
        log('no tracked-controls-webxr on', sel, '— muted instead');
      }
    },

    // See the header: A-Frame's generic controller component matches ANY
    // profile, so it can bind to a transient pointer and emit a competing
    // click. Silence the hand rays rather than remove the components, so
    // exit-vr can put them back exactly as authored.
    muteHands: function () {
      if (this.sawTransient) return;
      this.sawTransient = true;
      var self = this;
      ['#leftHand', '#rightHand'].forEach(function (sel) {
        var el = document.querySelector(sel);
        if (!el || !el.getAttribute('raycaster')) return;
        el.setAttribute('raycaster', 'enabled', false);
        el.setAttribute('raycaster', 'showLine', false);
        self.handsMuted.push(el);
      });
      log('transient-pointer detected — hand raycasters muted');
      if (window.VRPointer) window.VRPointer.syncGaze();
    },

    unmuteHands: function () {
      this.handsMuted.forEach(function (el) {
        el.setAttribute('raycaster', 'enabled', true);
        el.setAttribute('raycaster', 'showLine', true);
      });
      this.handsMuted.length = 0;
      // Put any retargeted hand back on the authored space, or the next session
      // — which may well be controllers — inherits a hand's aim.
      this.aimed.forEach(function (el) {
        if (el.components && el.components['tracked-controls-webxr']) {
          el.setAttribute('tracked-controls-webxr', 'space', 'gripSpace');
        }
      });
      this.aimed.length = 0;
      // pointer.js decides what the head cursor is for, and muting/unmuting a
      // hand ray is one of the inputs to that decision.
      if (window.VRPointer) window.VRPointer.syncGaze();
    },

    // Every `.clickable` object3D that is actually visible right now. Rebuilt
    // per select rather than cached: the scene adds and removes clickables
    // constantly (focus stage, notice cards, the reader's controls), and a
    // stale list is how you get a click on a card that closed.
    targets: function () {
      var els = document.querySelectorAll('.clickable');
      var out = [];
      for (var i = 0; i < els.length; i++) {
        var obj = els[i].object3D;
        if (obj && visible(obj)) out.push(obj);
      }
      return out;
    },

    // Ray from the input source's own targetRaySpace, in WORLD space.
    //
    // The pose comes back in the session's reference space, whose origin is
    // wherever the camera's PARENT sits — that is the transform three.js's
    // WebXRManager applies to the XR camera each frame, so it is the one to
    // apply here too. Using the rig, or nothing, silently offsets every ray by
    // however far the visitor has walked (walk-controls moves the rig).
    rayFrom: function (inputSource, frame) {
      var refSpace = this.el.renderer.xr.getReferenceSpace();
      if (!refSpace || !frame) return false;
      var pose = frame.getPose(inputSource.targetRaySpace, refSpace);
      if (!pose) return false;

      this.rayMat.fromArray(pose.transform.matrix);
      var parent = this.el.camera && this.el.camera.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        this.rayMat.premultiply(parent.matrixWorld);
      }
      this.origin.setFromMatrixPosition(this.rayMat);
      // -Z is forward for an XR ray space, and the matrix may carry the
      // parent's scale, so normalize rather than trusting the column.
      this.direction.set(-this.rayMat.elements[8], -this.rayMat.elements[9], -this.rayMat.elements[10]).normalize();
      this.raycaster.set(this.origin, this.direction);
      return true;
    },

    hit: function (evt) {
      if (!handles(evt.inputSource)) return null;
      if (!this.rayFrom(evt.inputSource, evt.frame)) {
        log('no pose');
        // A pinch that reports no pose is the one case where a hands-only
        // visitor is genuinely stuck: nothing else in the scene can emit a
        // click for them. Say so once, in-scene, rather than leaving them
        // pinching at an unresponsive dome. Controllers are the reliable path
        // on this headset and every one of them has a pair.
        if (isHand(evt.inputSource) && !this.warnedNoPose) {
          this.warnedNoPose = true;
          if (window.VRNotice) {
            VRNotice.show('Pick up your controllers',
                          'Hand tracking isn\u2019t reporting a pointer in this browser.');
          }
        }
        return null;
      }

      var hits = this.raycaster.intersectObjects(this.targets(), true);
      for (var i = 0; i < hits.length; i++) {
        var el = entityFor(hits[i].object);
        if (el) {
          log('hit', el.id || el.className || el.tagName, hits[i].distance.toFixed(2) + 'm');
          return { el: el, intersection: hits[i] };
        }
      }
      log('miss', hits.length ? '(no entity behind ' + hits.length + ' hits)' : '(nothing on the ray)');
      return null;
    },

    // A-Frame's cursor emits mouseenter/mousedown on press and mouseup/click on
    // release, and the scene's controls (ui-button, exit-button, scroll-arrows)
    // draw their hover and press states off those. A transient pointer gives no
    // hover at all before the pinch, so press IS the first feedback there is —
    // without this a tap on a button looks like nothing happened even when it
    // worked.
    onSelectStart: function (evt) {
      var hit = this.hit(evt);
      this.pressed = hit;
      if (!hit) return;
      hit.el.emit('mouseenter', { intersection: hit.intersection, cursorEl: this.el });
      hit.el.emit('mousedown', { intersection: hit.intersection, cursorEl: this.el });
    },

    onSelect: function (evt) {
      if (!handles(evt.inputSource)) return;
      // Prefer the fresh hit; fall back to what the press landed on. A-Frame's
      // cursor demands the same entity for press and release and drops the
      // click otherwise — deliberately more forgiving here, because the ray
      // moves during a pinch and dropping the click is the exact failure this
      // file exists to remove.
      var hit = this.hit(evt) || this.pressed;
      if (!hit) return;
      hit.el.emit('click', { intersection: hit.intersection, cursorEl: this.el });
    },

    onSelectEnd: function (evt) {
      if (!handles(evt.inputSource)) return;
      var hit = this.pressed;
      this.pressed = null;
      if (!hit) return;
      hit.el.emit('mouseup', { intersection: hit.intersection, cursorEl: this.el });
      hit.el.emit('mouseleave', { intersection: hit.intersection, cursorEl: this.el });
    }
  });
})();
