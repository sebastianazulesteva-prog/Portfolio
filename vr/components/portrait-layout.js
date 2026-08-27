/* ═══ portrait-layout.js ═══
   Recomposes the HOME VIEW for portrait phones only. Everything else —
   desktop, phone landscape, tablets, and every headset — is left exactly as
   authored in index.html.

   ── Why this is needed ──
   three.js/A-Frame drive a VERTICAL fov (default 80°), so the horizontal
   field is whatever the aspect ratio gives you. Measured on this scene:

     desktop 16:9 (1.78)    → 112° horizontal, 2.24 m visible either side @1.5 m
     phone landscape (2.17) → 122° horizontal, 2.73 m
     phone PORTRAIT (0.46)  →  42° horizontal, 0.58 m   ← 3.9× narrower

   The hub is composed across roughly ±1.6 m, so in portrait the arrival view
   crops badly: the name cut off mid-word, the bio card entirely offscreen.

   ── Why scaling the whole hub CANNOT fix it (this was tried) ──
   Every hub element sits at x=0, z=0 relative to the viewer, and horizontal
   angle is atan(x/z). A uniform scale about the viewpoint scales x and z
   equally, so x/z — and therefore the angle — is unchanged. Pushing content
   further back fails for the same reason. Only compressing the LATERAL
   SPREAD (or widening fov, which would need ~138° vertical to hold 100°
   horizontal — unusable distortion) actually recovers the view.

   ── What this does in portrait ──
   1. Scales the name/tagline group down. NOT via name-scatter-3d's `width`:
      that param only feeds the SUBTITLE's maxWidth (name-scatter-3d.js:173);
      the name itself uses a fixed VRType.display() font size and ignores it,
      so narrowing `width` would only re-wrap the tagline and leave the
      cropped name untouched. Scaling the entity shrinks it about its own
      origin, which sits at x=0 — so it compresses symmetrically toward
      centre, which is exactly the lateral compression needed. Measured: the
      title is 1.674 m wide at 1.48 m depth = 58.8°, vs a 42.4° budget, hence
      TITLE_SCALE below (with ~10% margin).
   2. Centres #homePortrait (authored at x=-0.5) so it sits dead ahead.
   3. Leaves #bioCard hidden on arrival — it's already tap-to-toggle from the
      portrait (index.html's homePortrait click handler), so nothing is lost;
      it just isn't competing for a 42° field on load. Only the ARRIVAL
      default is managed: once the visitor opens it, their choice sticks.

   Reverts cleanly on rotation to landscape, so turning the phone restores the
   authored composition (which landscape has more than enough room for).
*/

(function () {
  // Below this aspect the authored title (58.8°) no longer fits the available
  // horizontal fov. At 0.70 the field is ~61°, so it just fits; iPad portrait
  // (0.75 → ~64°) stays on the authored layout, iPhone portrait (0.46) does not.
  var NARROW_ASPECT = 0.70;

  var TITLE_SCALE = 0.6;   // 1.674 m → ~1.00 m ⇒ ~37°, inside the 42° budget
  var PORTRAIT_X_NARROW = 0;

  function isNarrow() {
    return (window.innerWidth / window.innerHeight) < NARROW_ASPECT;
  }

  // TWO waits are needed here, and skipping either one fails silently.
  //
  // 1. DOMContentLoaded — this file is a <script> in <head>, so at execution
  //    time <a-scene> does not exist yet and querySelector('a-scene') is null.
  //    Acting on that null (or treating it as "no scene, run now") applied the
  //    recomposition to elements that weren't in the DOM: a no-op that still
  //    marked itself as applied.
  // 2. Scene 'loaded' — on DOMContentLoaded the entities exist but A-Frame
  //    hasn't initialised their components, so getAttribute('position')
  //    answers {0,0,0} instead of the authored value. Reading the portrait's
  //    y/z then and writing them back sank it to the floor (world y 0, not
  //    1.42). Scene 'loaded' fires once all children have loaded.
  function onSceneReady(fn) {
    function afterDom() {
      var scene = document.querySelector('a-scene');
      if (!scene) { fn(); return; } // no scene at all — nothing to recompose
      if (scene.hasLoaded) fn();
      else scene.addEventListener('loaded', fn);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', afterDom);
    else afterDom();
  }

  onSceneReady(function () {
    var titleEl = document.querySelector('[name-scatter-3d]');
    var portraitEl = document.querySelector('#homePortrait');
    var bioEl = document.querySelector('#bioCard');

    // The authored x, so landscape restores the real value rather than a
    // hardcoded guess that could drift from index.html. Read from object3D,
    // which is the authoritative transform once the scene has loaded.
    var authoredPortraitX = portraitEl ? portraitEl.object3D.position.x : null;

    // Once the visitor opens the bio card themselves, stop managing its
    // visibility — a later rotation shouldn't slam their choice shut.
    var bioTouchedByUser = false;
    if (portraitEl) {
      portraitEl.addEventListener('click', function () { bioTouchedByUser = true; });
    }

    var applied = null; // null = not yet applied, so the first run always runs

    function apply() {
      var narrow = isNarrow();
      if (applied === narrow) return;
      applied = narrow;

      if (titleEl) {
        var s = narrow ? TITLE_SCALE : 1;
        titleEl.setAttribute('scale', { x: s, y: s, z: s });
      }

      // Only x is ours to change, but `position` is a SINGLE-PROPERTY vec3
      // component, so A-Frame's 3-arg setAttribute('position', 'x', v) does
      // NOT do a per-axis update — it parses 'x' as the whole vec3 and writes
      // {0,0,0}, which is what sank the portrait to the floor. Read y/z from
      // object3D (authoritative after scene load) and write a full vec3.
      if (portraitEl && authoredPortraitX !== null) {
        var cur = portraitEl.object3D.position;
        portraitEl.setAttribute('position', {
          x: narrow ? PORTRAIT_X_NARROW : authoredPortraitX,
          y: cur.y,
          z: cur.z
        });
      }

      if (bioEl && !bioTouchedByUser) bioEl.setAttribute('visible', !narrow);
    }

    apply();

    // Three independent triggers, because no single one is dependable:
    //   • matchMedia on the exact threshold (7/10 = NARROW_ASPECT) is the most
    //     reliable — its change event fires precisely when the boundary is
    //     crossed, and unlike resize it doesn't depend on the page being
    //     visible/foregrounded.
    //   • resize covers split-screen and desktop window drags.
    //   • orientationchange is a belt-and-braces fallback for older browsers.
    // Duplicate triggers are harmless: apply() early-returns when the state
    // hasn't actually changed.
    var mq = window.matchMedia && window.matchMedia('(max-aspect-ratio: 7/10)');
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', apply);
      else if (mq.addListener) mq.addListener(apply); // Safari < 14
    }
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);

    window.VRPortraitLayout = { apply: apply, isNarrow: isNarrow };
  });
})();
