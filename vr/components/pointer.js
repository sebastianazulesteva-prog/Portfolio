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

   Usage:
     <a-entity id="leftHand" laser-controls raycaster hand-ray-gate></a-entity>
     var hit = VRPointer.nearest();            // an intersection, or null
     var hit = VRPointer.nearest(function (h) { return isMine(h.object); });
*/

(function () {
  var SELECTORS = ['#head [cursor]', '#leftHand', '#rightHand'];

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
      this._apply = function () {
        var rc = self.el.components.raycaster;
        if (rc) rc.data.enabled = self.connected;
        // A disabled raycaster keeps its last intersections, and a stale hit is
        // exactly as wrong as a live phantom to anything reading the list.
        if (rc && !self.connected && rc.intersections) rc.intersections.length = 0;
      };
      this._on = function () { self.connected = true; self._apply(); };
      this._off = function () { self.connected = false; self._apply(); };
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
      var rc = this.el.components.raycaster;
      if (rc) rc.data.enabled = true;
    }
  });
})();
