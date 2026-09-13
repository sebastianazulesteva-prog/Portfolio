/* ═══ pointer.js ═══
   Who is actually pointing at something — and the two hand rays that are not.

   ── The bug this exists for (found 2026-09-08) ──
   The scene has three raycasters: the head cursor, `#leftHand` and
   `#rightHand`. The hand entities are in the markup from page load, whether or
   not a controller ever connects — and `raycaster` does not care. It ticks, it
   casts from wherever its entity is, and with no controller attached that
   entity has never moved: it sits at the RIG ORIGIN, world y 0, with identity
   rotation. So both hands fire a permanent ray along −Z at floor level, into
   whatever happens to be dead ahead.

   Measured in the reading room, with no controllers connected anywhere:

     #head [cursor]   1 hit,  y 2.45,  distance 2.08   ← where the visitor is looking
     #leftHand        2 hits, y 0.00,  distance 1.90   ← a phantom, and NEARER
     #rightHand       2 hits, y 0.00,  distance 1.90   ← the same phantom again

   Every consumer that resolves "the pointer" as `nearest hit across all three`
   — which is the obviously correct rule, and is what reading-line.js and the
   reader's auto-scroll both do — therefore gets the phantom instead of the
   gaze, permanently, on every device with no controllers. That includes a
   Vision Pro, where controllers NEVER connect (§3.13) and the gaze is the only
   real pointer there is.

   It is a quiet bug rather than a loud one because the phantom lands at floor
   level on the thing in front of you, which is usually the same object you are
   looking at. The reading ruler still lit a line, just always the same low one;
   the auto-scroll still scrolled, just always downward.

   ── Two halves of the fix ──
   1. `hand-ray-gate` turns a hand's raycaster OFF until its controller is
      actually connected, and back on when it is. That stops the phantom at
      source, so it also stops the spurious mouseenter/mouseleave a permanent
      floor-level ray fires at whatever it is resting on — which is the same
      class of thing as arming a photo-cloud dwell nobody asked for.
   2. `VRPointer.nearest()` is the shared answer to "where is the pointer",
      so the next consumer does not re-derive the buggy version. It also skips
      a disabled or hidden ray, which the gate above now produces.

   ── The same bug from the other end: the GAZE ray on a Quest (2026-09-11) ──
   The gate above fixes "no controller, but the hand rays fire anyway". The
   mirror case is "controllers ARE connected, and the head keeps firing too".

   fallback.js used to switch the head cursor to gaze (`rayOrigin: entity`) and
   show the reticle on ANY `enter-vr`. That is exactly right on a Vision Pro,
   where the gaze is the only pointer there is. On a Quest it leaves THREE live
   rays emitting hover into handlers that cannot tell them apart — nothing in
   the scene reads `evt.detail.cursorEl`. Concretely: the photo cloud arms its
   dwell on `mouseenter` and dwell.js keeps exactly one ring, so what you LOOK
   at and what you POINT at cancel each other's ring, permanently.

   So the head cursor's mode is a decision about the whole session, not about
   `enter-vr`, and it lives here with the rest of "who is actually pointing":

     not presenting          -> mouse/touch ray, no reticle   (desktop, phone)
     presenting, no hands    -> gaze ray + reticle            (Vision Pro)
     presenting, hands live  -> head ray OFF, no reticle      (Quest)

   `syncGaze()` is called on enter-vr/exit-vr and whenever a gate flips, and
   fallback.js delegates to it rather than keeping its own copy of the rule.

   Why `setAttribute` and not a direct `data.enabled` write: turning a raycaster
   off through the component's `update()` runs `clearAllIntersections()`, which
   emits `raycaster-intersection-cleared`, which is what makes A-Frame's cursor
   emit `mouseleave`. Writing `data.enabled` straight skips all three, and
   whatever was hovered at that moment stays hovered for the rest of the
   session.

   Usage:
     <a-entity id="leftHand" laser-controls raycaster hand-ray-gate></a-entity>
     var hit = VRPointer.nearest();            // an intersection, or null
     var hit = VRPointer.nearest(function (h) { return isMine(h.object); });
     VRPointer.syncGaze();                     // re-decide the head cursor's mode
*/

(function () {
  var HEAD = '#head [cursor]';
  var SELECTORS = [HEAD, '#leftHand', '#rightHand'];

  // A hand ray only counts once its controller is really there. The head
  // cursor always counts: it is either the mouse (desktop), the touch/gyro
  // pointer (phone) or the gaze (headset), and all three are real.
  function isLive(el) {
    if (!el) return false;
    var rc = el.components && el.components.raycaster;
    if (!rc || rc.data.enabled === false) return false;
    if (!el.object3D.visible) return false;
    var gate = el.components['hand-ray-gate'];
    if (gate && !gate.connected) return false;
    return true;
  }

  // ── Gaze arbitration ─────────────────────────────────────────────────────
  // Every hand-ray-gate registers here so a connect/disconnect can re-decide
  // the head cursor. Instances rather than a count: a gate can be removed.
  var gates = [];

  function headCursorEl() { return document.querySelector(HEAD); }

  function handsConnected() {
    for (var i = 0; i < gates.length; i++) { if (gates[i].connected) return true; }
    return false;
  }

  function presenting() {
    var scene = document.querySelector('a-scene');
    return !!(scene && scene.is && scene.is('vr-mode'));
  }

  // The one place that decides what the head cursor is for. See the header.
  function syncGaze() {
    var el = headCursorEl();
    if (!el) return;
    var inVR = presenting();
    var gaze = inVR && !handsConnected();

    // rayOrigin: on desktop/phone the ray follows the mouse/touch point, so any
    // visible panel is directly clickable (VR_BUGFIX item 9). In a headset there
    // is no mouse and the entity IS the eye.
    el.setAttribute('cursor', 'rayOrigin', inVR ? 'entity' : 'mouse');

    // ── A-Frame leaves the mouse ray behind when you switch away from it ──
    // In `rayOrigin: mouse` the cursor writes an explicit world-space
    // origin/direction onto the raycaster on every mousemove. Switching back to
    // `entity` resets `useWorldCoordinates` to false (cursor.js
    // updateMouseEventListeners) and **does not clear those two**, so they are
    // reinterpreted as a LOCAL offset from the eye — the gaze ray then starts
    // wherever the pointer last was and aims in the direction it last had.
    //
    // That is not an edge case: every desktop visitor moves the mouse before
    // clicking Enter VR, and on a Quest the controller laser generates mousemove
    // over the flat page too. So the FIRST thing a headset gets is a gaze ray
    // offset by the last mouse position. It survived because until now nothing
    // depended on the gaze ray's accuracy — xr-select does its own raycast
    // (§3.13) and there is no hover in a headset — but the reticle's depth rides
    // it, and on a controller-less headset it is the only pointer there is.
    if (inVR) {
      el.setAttribute('raycaster', 'origin', { x: 0, y: 0, z: 0 });
      el.setAttribute('raycaster', 'direction', { x: 0, y: 0, z: -1 });
    }
    // Off only in the one case that has a better pointer already.
    if (el.components && el.components.raycaster) {
      el.setAttribute('raycaster', 'enabled', !inVR || gaze);
    }
    // The reticle is the gaze's own cursor. Outside VR it would point at
    // something the mouse isn't over; with controllers the laser is the cursor.
    var reticle = el.getObject3D('reticle');
    if (reticle) reticle.visible = gaze;
  }

  window.VRPointer = {
    // The nearest live intersection, optionally filtered — pass a predicate to
    // ask "the nearest hit ON MY THING", which is what a consumer that only
    // cares about its own surfaces actually wants, and is not the same as
    // "the nearest hit, if it happens to be mine".
    nearest: function (accept) {
      var best = null, bestD = Infinity;
      for (var i = 0; i < SELECTORS.length; i++) {
        var el = document.querySelector(SELECTORS[i]);
        if (!isLive(el)) continue;
        var hits = el.components.raycaster.intersections;
        if (!hits || !hits.length) continue;
        for (var h = 0; h < hits.length; h++) {
          if (accept && !accept(hits[h])) continue;
          if (hits[h].distance < bestD) { bestD = hits[h].distance; best = hits[h]; }
          break;   // only the nearest hit per ray: anything behind it is occluded
        }
      }
      return best;
    },

    // Re-decide what the head cursor is for. Called on enter-vr/exit-vr and by
    // every hand-ray-gate that flips; safe to call at any time.
    syncGaze: syncGaze,
    handsConnected: handsConnected,

    // Diagnostic, for a headset where there is no console (§3.16).
    state: function () {
      return SELECTORS.map(function (sel) {
        var el = document.querySelector(sel);
        var rc = el && el.components && el.components.raycaster;
        return { sel: sel, present: !!el, live: isLive(el),
                 hits: rc && rc.intersections ? rc.intersections.length : 0 };
      });
    }
  };

  // ── The gate ─────────────────────────────────────────────────────────────
  // A-Frame's tracked-controls fires `controllerconnected` /
  // `controllerdisconnected` on the entity. Starting DISABLED is the important
  // half: on a Vision Pro neither event ever fires, so a gate that only reacted
  // to disconnect would leave both phantoms running for the entire session on
  // the one device where the gaze is the only pointer.
  AFRAME.registerComponent('hand-ray-gate', {
    init: function () {
      var self = this;
      this.connected = false;
      gates.push(this);
      this._apply = function () {
        var rc = self.el.components.raycaster;
        if (!rc) return;
        // Through setAttribute, not `rc.data.enabled = …`: the component's
        // update() is what runs clearAllIntersections(), which emits
        // `raycaster-intersection-cleared`, which is what makes A-Frame's cursor
        // emit `mouseleave`. Set the flag directly and a controller that
        // disconnects mid-hover leaves that element hovered for good.
        if (rc.data.enabled !== self.connected) {
          self.el.setAttribute('raycaster', 'enabled', self.connected);
        }
        // Belt and braces: a disabled raycaster keeps its last intersections,
        // and a stale hit is exactly as wrong as a live phantom to anything
        // reading the list.
        if (!self.connected && rc.intersections) rc.intersections.length = 0;
      };
      // A controller arriving or leaving changes which ray the head cursor
      // should defer to, so both edges re-run the gaze decision.
      this._on = function () { self.connected = true; self._apply(); syncGaze(); };
      this._off = function () { self.connected = false; self._apply(); syncGaze(); };
      this.el.addEventListener('controllerconnected', this._on);
      this.el.addEventListener('controllerdisconnected', this._off);
      // The raycaster component may initialise after this one.
      this.el.addEventListener('componentinitialized', function (e) {
        if (e.detail && e.detail.name === 'raycaster') self._apply();
      });
      this._apply();
    },
    remove: function () {
      this.el.removeEventListener('controllerconnected', this._on);
      this.el.removeEventListener('controllerdisconnected', this._off);
      var i = gates.indexOf(this);
      if (i !== -1) gates.splice(i, 1);
      var rc = this.el.components.raycaster;
      if (rc) this.el.setAttribute('raycaster', 'enabled', true);
      syncGaze();
    }
  });

  // The scene does not exist yet at load — this file is a <script> in the head,
  // like every other component here. Both edges matter: entering VR is what
  // makes gaze possible at all, and leaving is what puts the mouse back.
  function wire() {
    var scene = document.querySelector('a-scene');
    if (!scene) return;
    scene.addEventListener('enter-vr', syncGaze);
    scene.addEventListener('exit-vr', syncGaze);
    // And once now, for the flat arrival state.
    syncGaze();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
