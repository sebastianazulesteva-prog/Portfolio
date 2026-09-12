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

  // ── Hiding a branch does NOT stop it being clicked ────────────────────────
  // Found 2026-09-08, chasing "I can't page through the FEA analysis" in the
  // Time Collector room. The document station's two arrows sit at NDC x ≈ 0.89,
  // and the FIRST thing the head cursor hit when aimed at them was
  // `#homePortrait` — a hub element, inside a `.hub-cluster` that the room had
  // correctly hidden, at 1.68 m, invisible, and in the way.
  //
  // `setAttribute('visible', false)` sets `object3D.visible = false`, which
  // three.js honours when RENDERING and ignores when RAYCASTING: r158's
  // `intersect()` tests only `object.layers`, never `visible`, and A-Frame's
  // raycaster does not filter the results either. So every `.clickable` in the
  // hub — 33 photo tiles, ten project cards, five writing cards, the bio card's
  // Skills toggle, the portrait — stays a live, invisible hit target inside
  // every room, the reader and the lab.
  //
  // Two ways that shows up, and both were reported: a control in the place you
  // ARE in silently refuses to respond because something you cannot see is
  // nearer the eye, and a click on empty room floor lands on a hub card and
  // OPENS ANOTHER PROJECT'S CONTENT on top of the room you are standing in.
  //
  // The fix is the class, because the class is already the contract: A-Frame's
  // raycasters here are all `objects: .clickable`, so taking the class off a
  // hidden branch takes it out of every ray at once, and nothing has to agree
  // about layers or filters. Recorded on the element so restoring cannot guess
  // wrong — some descendants of a hidden cluster were never clickable, and
  // handing them the class on the way back out would make the hub grow new hit
  // targets every time you left a room.
  var INERT_FLAG = 'vrWasClickable';

  function setBranchClickable(root, on) {
    if (!root) return;
    var els = [].slice.call(root.querySelectorAll(on ? '[data-vr-was-clickable]' : '.clickable'));
    if (!on && root.classList && root.classList.contains('clickable')) els.push(root);
    if (on && root.dataset && root.dataset[INERT_FLAG]) els.push(root);
    els.forEach(function (el) {
      if (on) {
        el.classList.add('clickable');
        delete el.dataset[INERT_FLAG];
      } else {
        el.classList.remove('clickable');
        el.dataset[INERT_FLAG] = '1';
      }
    });
  }

  // The three rays in the scene cache their target lists, so any change to who
  // is clickable has to tell them. Same list as project-room.js's own
  // refreshClickableRaycasters — kept here too because this helper is called
  // from files that have no other reason to know about hands.
  function refreshRays() {
    ['#head [cursor]', '#leftHand', '#rightHand'].forEach(function (sel) {
      var el = document.querySelector(sel);
      var rc = el && el.components && el.components.raycaster;
      if (rc) rc.refreshObjects();
    });
  }

  // Hide or show a whole branch AND take it out of / put it back into the
  // selection rays. This is what every place should call instead of
  // `el.setAttribute('visible', false)`.
  function setBranchVisible(el, visible) {
    if (!el) return;
    el.setAttribute('visible', visible);
    setBranchClickable(el, visible);
  }

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

    // See the long note above: `visible:false` alone leaves a branch clickable.
    setBranchVisible: setBranchVisible,
    refreshRays: refreshRays,

    // Hide/show every `.hub-cluster` at once — the call all three places were
    // hand-rolling identically, now in the file that owns "one place at a
    // time" and with the hit-testing half included.
    //
    // AND dismiss the focus stage, which is the bug Sebastian reported as
    // "engineering communication builder content appearing incorrectly in the
    // Time Collector room" (2026-09-11). #focusStage is deliberately not a
    // `.hub-cluster` — it is the transient detail view, not part of the hub —
    // so hiding the clusters left a focused card floating inside whatever place
    // you entered next. That card is how you enter a room in the first place:
    // focus the Time Collector card, press its button, and the big panel you
    // pressed stays hanging in the room you just walked into. pdf-reader.js had
    // spotted this and hid #focusStage in its own wrapper; project-room.js and
    // portrait-lab.js both `return` out of this function early, so they never
    // did, and the reader's is the only path that was ever covered.
    //
    // DISMISS rather than hide: hiding only defers it, because the matching
    // setHubVisible(true) on the way out would bring a stale detail view back
    // with the hub. close(true) is the instant path — synchronous, no tween —
    // and it restores the origin card's own visibility, which is exactly why it
    // has to run BEFORE the clusters are hidden, so the card it un-hides is
    // hidden again on the very next line.
    setHubVisible: function (visible) {
      if (!visible && window.VRFocusStage && VRFocusStage.close) {
        // A detail view that refuses to close must not stop a room opening.
        try { VRFocusStage.close(true); } catch (e) {
          console.warn('[vr] place: VRFocusStage.close(true) threw', e);
        }
      }
      [].slice.call(document.querySelectorAll('.hub-cluster')).forEach(function (el) {
        setBranchVisible(el, visible);
      });
      refreshRays();
    },

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
