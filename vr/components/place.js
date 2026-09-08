/* ═══ place.js ═══
   ONE place at a time. The scene has several "places" a visitor can be in —
   the hub, a project room, the reading room, the portrait lab — and each one
   already knew how to hide the hub. None of them knew about EACH OTHER.

   Every place did its own `querySelectorAll('.hub-cluster').forEach(hide)`,
   which correctly hides the hub, because the hub is a class. But a project
   room is `#projectRoom`, the reader builds its own root, and the lab builds
   a third — none of which carries that class, and none of which any other
   place looked for. So two places could be live at once, and were:

   Measured, opening the reader on top of the Pendant room — the state
   Sebastian screenshotted, with photographs floating in the distance behind
   the pages:

     hub clusters hidden ....... yes (each place gets this right)
     project room in the DOM ... yes, visible:true, 8 children
     still drawing ............. 18 meshes, 6 textures
     visible clickables ........ TWO buttons both labelled "Back to the dome"

   Two identical exits, one of which returns you to a room you cannot see, is
   worse than the visual leak. Hence a registry: entering any place evicts
   whichever other place is live, so the invariant is stated once here instead
   of being half-remembered in three files that don't import each other.

     VRPlace.enter('room')   // before you build. Evicts the others.
     VRPlace.leave('room')   // when you've torn down. Back to 'hub'.
     VRPlace.current()       // 'hub' | 'room' | 'reader' | 'lab'
     VRPlace.open()          // diagnostic: who reports themselves open

   ── Eviction is SYNCHRONOUS and silent, by contract ─────────────────────────

   A place's `evict()` is not its `close()`. The incoming place is already
   running its own dip-to-dark, so the outgoing one must not start a second
   transition — and, more importantly, must not put its disposal inside a GSAP
   callback. pdf-reader.js's own comments explain why at length: in an
   immersive session the window rAF is not serviced, so a tween's `onComplete`
   may never fire, and disposal parked in one simply never happens. That is the
   bug that left a capturing click listener installed and killed every click in
   the scene. An `evict()` therefore tears down NOW, in one synchronous call.

   ── The lab is adapted from out here, not edited ────────────────────────────

   portrait-lab.js belongs to a concurrent session, so this file adapts it
   rather than modifying it: it already exposes `.open` and `.closeLab()` on
   the component, and already emits `portrait-lab-open` / `portrait-lab-close`
   on the scene. That is a complete enough surface to register from outside,
   with no edit to a file someone else may be typing in right now.
*/

(function () {
  var HUB = 'hub';
  var places = {};
  var current = HUB;

  function isOpen(name) {
    var p = places[name];
    if (!p) return false;
    try { return !!p.isOpen(); } catch (e) { return false; }
  }

  function evictOthers(incoming) {
    Object.keys(places).forEach(function (name) {
      if (name === incoming || !isOpen(name)) return;
      // Loud on purpose: a place being evicted is always a state we did not
      // expect to reach (nothing in the UI should offer two doors at once), so
      // it is worth seeing in the console even though it is handled.
      console.info('[vr] place: evicting "' + name + '" to enter "' + incoming + '"');
      try {
        places[name].evict();
      } catch (e) {
        // A failed eviction must not abort the incoming place — a visitor
        // stuck with nothing is worse than a visitor with a stale panel.
        console.warn('[vr] place: evict("' + name + '") threw', e);
      }
    });
  }

  window.VRPlace = {
    register: function (name, api) { places[name] = api; },

    // Call BEFORE building. Returns the place that was evicted, if any, purely
    // so a caller can log or test it.
    enter: function (name) {
      var was = Object.keys(places).filter(function (n) { return n !== name && isOpen(n); });
      evictOthers(name);
      current = name;
      return was;
    },

    // Call AFTER tearing down. Guarded so a late teardown from an already
    // evicted place cannot yank `current` out from under whoever replaced it.
    leave: function (name) { if (current === name) current = HUB; },

    current: function () { return current; },
    open: function () { return Object.keys(places).filter(isOpen); },
    registered: function () { return Object.keys(places); }
  };

  // ── The portrait lab adapter (see the header) ────────────────────────────
  function labComponent() {
    var el = document.querySelector('#portraitLab');
    return el && el.components && el.components['portrait-lab'];
  }

  window.VRPlace.register('lab', {
    isOpen: function () { var c = labComponent(); return !!(c && c.open); },
    evict: function () { var c = labComponent(); if (c && c.closeLab) c.closeLab(); }
  });

  // The lab is opened by its own button, not through VRPlace, so mirror its
  // events to keep `current` honest — and so opening the lab evicts a room or
  // the reader the same way entering them evicts the lab.
  function wireLabEvents() {
    var scene = document.querySelector('a-scene');
    if (!scene) return;
    scene.addEventListener('portrait-lab-open', function () { window.VRPlace.enter('lab'); });
    scene.addEventListener('portrait-lab-close', function () { window.VRPlace.leave('lab'); });
  }

  // This file loads from <head>, before <a-scene> exists, so the wiring waits
  // for the document — but guard the case where it is loaded late (the dev
  // harnesses inject components after load), or the listeners silently never
  // attach and the lab stops participating.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireLabEvents);
  } else {
    wireLabEvents();
  }
})();
