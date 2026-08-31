/* ═══ carousel-drag.js ═══
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ ATTACHED TO NOTHING, AND NOT LOADED, since 2026-08-30. Read this before   │
   │ putting it back on anything.                                              │
   │                                                                           │
   │ It lived on #projectsConstellation, where it was right for the layout it  │
   │ was built against: ONE 4-column grid holding all ten items, where reaching │
   │ the far cards meant spinning the cylinder.                                │
   │                                                                           │
   │ §9.1 split that grid in two, and then this became a way to break the      │
   │ scene. The projects zone is now 5 cards in 3 columns spanning ~70°, and    │
   │ its position IS its contract: 7° of clear dome to the writing column       │
   │ inboard, 9° to the photo cloud outboard, zero overlaps measured at every   │
   │ camera waypoint (§9.9). An unbounded yaw sweeps that 70° block across the  │
   │ writing column, the bio card and the cloud, snaps to a detent up to 33°    │
   │ from home, and stays there — no way back short of a reload. Nothing is     │
   │ revealed by spinning either: all five cards are already visible.           │
   │                                                                           │
   │ It also ate clicks. `threshold` is 6 px, so a trackpad press that slid     │
   │ 7 px spun the grid instead of opening the card. That is how Sebastian      │
   │ found it, on desktop.                                                     │
   │                                                                           │
   │ Kept, not deleted, because the component itself is sound and generic — a   │
   │ future cluster with more items than fit at once is exactly its job. Two    │
   │ things to fix first if you re-attach it:                                  │
   │   • pass `snapDeg: 0`, so a release springs back to home instead of        │
   │     settling wherever it lands; and/or                                     │
   │   • give it a travel BOUND with a soft edge, the way walk-controls.js      │
   │     bounds the rig (§9.5) — a zone that must not overlap its neighbours    │
   │     cannot have unbounded rotation.                                       │
   │ Raise `threshold` too, or accept that some clicks become spins.            │
   └──────────────────────────────────────────────────────────────────────────┘

   Turns a constellation container into a draggable cylindrical carousel
   (ISSUE-03). The cards are already placed on a consistent-radius arc, each
   tilted to face the viewer (constellation.js). Because a card's *position
   angle* and its *facing* both derive from its outer entity's rotation.y,
   rotating the whole container about Y moves every card along the cylinder AND
   keeps it facing the viewer — so a plain container yaw is a real carousel spin,
   no per-card re-aim needed.

   Interaction:
     • Desktop / phone: press on a card and drag horizontally to push the arc
       around; release to let it coast (momentum) and settle onto the nearest
       detent (gentle snap). A press that doesn't travel past a small threshold
       is left alone so the card's own click (open focus stage) still fires.
       While a drag is active, look-controls' mouse-look is suspended so the two
       don't fight — head tracking in VR is never touched.
     • VR: hold a controller's trigger and sweep it left/right; the container
       follows the controller's yaw. Same threshold rule distinguishes a
       sweep (spin) from a tap (select).

   Respects prefers-reduced-motion: no coasting, snaps immediately on release.

   Usage (historical — nothing carries it now; see the box above):
     <a-entity carousel-drag="snapDeg: 0"></a-entity>
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  AFRAME.registerComponent('carousel-drag', {
    schema: {
      snapDeg: { type: 'number', default: 0 },     // detent spacing; 0 → settle back to home (0°)
      speed: { type: 'number', default: 0.22 },    // degrees of yaw per pixel of pointer travel
      damping: { type: 'number', default: 6 },     // higher = momentum bleeds off faster
      threshold: { type: 'number', default: 6 }    // px (pointer) before a press becomes a drag
    },

    init: function () {
      this.rotY = (this.el.getAttribute('rotation') || {}).y || 0;
      this.vel = 0;              // deg/sec, for momentum
      this.mode = 'idle';        // 'idle' | 'drag' | 'coast' | 'snap'
      this.pointerActive = false;
      this.lastX = 0;
      this.moved = 0;
      this.head = document.querySelector('#head');

      this._onDown = this._onDown.bind(this);
      this._onMove = this._onMove.bind(this);
      this._onUp = this._onUp.bind(this);

      var canvas = this.el.sceneEl.canvas;
      var attach = function (c) {
        c.addEventListener('mousedown', this._onDown);
        c.addEventListener('touchstart', this._onDown, { passive: false });
        window.addEventListener('mousemove', this._onMove);
        window.addEventListener('touchmove', this._onMove, { passive: false });
        window.addEventListener('mouseup', this._onUp);
        window.addEventListener('touchend', this._onUp);
      }.bind(this);
      if (canvas) attach(canvas);
      else this.el.sceneEl.addEventListener('render-target-loaded', function () { attach(this.el.sceneEl.canvas); }.bind(this));

      // VR controller trigger-drag.
      this._grabHand = null;
      this._grabYaw = 0;
      ['#leftHand', '#rightHand'].forEach(function (sel) {
        var h = document.querySelector(sel);
        if (!h) return;
        h.addEventListener('triggerdown', function () { this._grabStart(h); }.bind(this));
        h.addEventListener('triggerup', function () { this._grabEnd(); }.bind(this));
      }, this);
    },

    // ── Is the pointer currently over one of this container's cards? Only then
    //    do we hijack the drag — a press on empty space should still look around.
    _pointerOnCarousel: function () {
      var cursor = document.querySelector('[cursor]');
      var rc = cursor && cursor.components && cursor.components.raycaster;
      if (!rc) return false;
      var els = rc.intersectedEls || [];
      for (var i = 0; i < els.length; i++) {
        if (this.el.contains(els[i])) return true;
      }
      return false;
    },

    _clientX: function (e) {
      if (e.touches && e.touches.length) return e.touches[0].clientX;
      if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientX;
      return e.clientX;
    },

    _onDown: function (e) {
      if (!this._pointerOnCarousel()) return;
      this.pointerActive = true;
      this.mode = 'drag';
      this.lastX = this._clientX(e);
      this.moved = 0;
      this.vel = 0;
    },

    _onMove: function (e) {
      if (!this.pointerActive) return;
      var x = this._clientX(e);
      var dx = x - this.lastX;
      this.lastX = x;
      this.moved += Math.abs(dx);
      if (this.moved < this.data.threshold) return; // still might be a tap
      // Past the threshold: this is a drag. Suspend mouse-look so the camera
      // doesn't swing with the same gesture (head tracking is untouched — this
      // only gates look-controls' pointer drag).
      this._suspendLook(true);
      if (e.cancelable) e.preventDefault();
      var d = dx * this.data.speed;
      this.rotY += d;
      this.vel = d * 60; // ≈ deg/sec assuming ~60fps between moves
      this._apply();
    },

    _onUp: function () {
      if (!this.pointerActive) return;
      this.pointerActive = false;
      this._suspendLook(false);
      if (this.moved < this.data.threshold) { this.mode = 'idle'; return; } // was a tap → leave the click alone
      this._release();
    },

    _grabStart: function (hand) {
      this._grabHand = hand;
      this._grabYaw = this._handYaw(hand);
      this.moved = 0;
      this.vel = 0;
      this.mode = 'drag';
    },

    _grabEnd: function () {
      if (!this._grabHand) return;
      this._grabHand = null;
      if (this.moved < 2) { this.mode = 'idle'; return; } // barely moved → a select, not a spin
      this._release();
    },

    _handYaw: function (hand) {
      var q = new THREE.Quaternion();
      hand.object3D.getWorldQuaternion(q);
      var f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      return Math.atan2(f.x, f.z); // radians; sign consistent frame-to-frame is all we need
    },

    _release: function () {
      if (reducedMotion) { this.rotY = this._nearestDetent(this.rotY); this._apply(); this.mode = 'idle'; return; }
      this.mode = 'coast';
    },

    _suspendLook: function (on) {
      // Only meaningful outside an immersive session; in VR look-controls is head
      // tracking and must never be disabled.
      if (this.el.sceneEl.is && this.el.sceneEl.is('vr-mode')) return;
      if (!this.head) return;
      var lc = this.head.getAttribute('look-controls');
      if (lc == null) return;
      this.head.setAttribute('look-controls', 'enabled', !on);
    },

    _nearestDetent: function (deg) {
      var s = this.data.snapDeg;
      if (!s) return 0;                 // no per-item detents → home orientation
      return Math.round(deg / s) * s;
    },

    _apply: function () {
      var r = this.el.getAttribute('rotation') || { x: 0, y: 0, z: 0 };
      this.el.setAttribute('rotation', { x: r.x, y: this.rotY, z: r.z });
    },

    tick: function (time, delta) {
      var dt = (delta || 16) / 1000;

      // VR trigger-drag: follow the grabbed controller's yaw sweep.
      if (this._grabHand) {
        var y = this._handYaw(this._grabHand);
        var dRad = y - this._grabYaw;
        // wrap to [-π, π] so crossing the ±π seam doesn't snap the arc around
        dRad = Math.atan2(Math.sin(dRad), Math.cos(dRad));
        this._grabYaw = y;
        var dDeg = THREE.MathUtils.radToDeg(dRad);
        this.rotY += dDeg;
        this.moved += Math.abs(dDeg);
        this.vel = dDeg / Math.max(dt, 0.001);
        this._apply();
        return;
      }

      if (this.mode === 'coast') {
        this.rotY += this.vel * dt;
        // exponential-ish decay, framerate independent
        this.vel *= Math.max(0, 1 - this.data.damping * dt);
        this._apply();
        if (Math.abs(this.vel) < 8) { this.mode = 'snap'; }
        return;
      }

      if (this.mode === 'snap') {
        var target = this._nearestDetent(this.rotY);
        var diff = target - this.rotY;
        if (Math.abs(diff) < 0.05) { this.rotY = target; this._apply(); this.mode = 'idle'; return; }
        this.rotY += diff * Math.min(1, 10 * dt); // gentle ease onto the detent
        this._apply();
      }
    },

    remove: function () {
      var canvas = this.el.sceneEl.canvas;
      if (canvas) {
        canvas.removeEventListener('mousedown', this._onDown);
        canvas.removeEventListener('touchstart', this._onDown);
      }
      window.removeEventListener('mousemove', this._onMove);
      window.removeEventListener('touchmove', this._onMove);
      window.removeEventListener('mouseup', this._onUp);
      window.removeEventListener('touchend', this._onUp);
    }
  });
})();
