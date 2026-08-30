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

   ── Why only transient-pointer ──
   `tracked-pointer` sources (Quest controllers) are left strictly alone:
   A-Frame handles those correctly and a second click emitter would fire
   everything twice — open-then-close, enter-then-exit. The one thing this does
   take over is the HAND raycasters, and only once a transient pointer has
   actually been seen: A-Frame's `generic-tracked-controller-controls` matches
   any profile at all, so it can bind to a transient pointer for the frame it
   exists and emit a competing click. Disabled on first sight, restored on exit.

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
      this.unmuteHands();
    },

    onSourcesChange: function (evt) {
      var added = evt.added || [];
      for (var i = 0; i < added.length; i++) {
        log('source', added[i].handedness, added[i].targetRayMode, JSON.stringify(added[i].profiles));
        if (added[i].targetRayMode === 'transient-pointer') this.muteHands();
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
    },

    unmuteHands: function () {
      this.handsMuted.forEach(function (el) {
        el.setAttribute('raycaster', 'enabled', true);
        el.setAttribute('raycaster', 'showLine', true);
      });
      this.handsMuted.length = 0;
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
      if (evt.inputSource.targetRayMode !== 'transient-pointer') return null;
      if (!this.rayFrom(evt.inputSource, evt.frame)) { log('no pose'); return null; }

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
      if (evt.inputSource.targetRayMode !== 'transient-pointer') return;
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
      if (evt.inputSource.targetRayMode !== 'transient-pointer') return;
      var hit = this.pressed;
      this.pressed = null;
      if (!hit) return;
      hit.el.emit('mouseup', { intersection: hit.intersection, cursorEl: this.el });
      hit.el.emit('mouseleave', { intersection: hit.intersection, cursorEl: this.el });
    }
  });
})();
