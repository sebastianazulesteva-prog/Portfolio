/* ═══ column-scroll.js ═══
   Windowed vertical scrolling for a single-column cluster — built for the
   writing column (VR_AI_BUILD_GUIDE.md §9.2).

   ── Dormant on purpose, right now ──
   Sebastian's spec: "show all 5, but build in the scroll / take note that if
   there's another article added, the scroll needs to be added." So `attach()`
   is called unconditionally and RETURNS NULL when the column already fits —
   which is today's case, 5 pieces in a 5-slot column, no arrows drawn, nothing
   to explain. Add a sixth piece and the same call wakes up: the column shows
   `visible` at a time with an arrow bar above and below. The only thing that has
   to change is the data.

   ── The behaviour he specified ──
   • a long flat arrow bar at the top and another at the bottom (scroll-arrows.js
     builds both, so they match the reader's controls exactly)
   • click to scroll — not drag-only
   • smooth, eased
   • "always lands so each article is fully visible": scrolling moves by WHOLE
     card pitches and the window holds an integer number of cards, so there is
     never a half-clipped card at either end. This is why it windows by index
     rather than translating a masked strip — a continuous offset would need a
     clipping plane to avoid showing sliced cards, and clipping planes then have
     to be threaded through every material in the column (including the glass
     shader's). Whole-slot stepping gets the same result with none of that.

   ── Why the whole column slides ──
   During a step every card moves by one pitch and cards just outside the window
   stay visible for the duration, so what you see is the column travelling past
   the bars. Hiding them for the transition instead makes the same step read as
   a jump-cut. They are hidden again on completion, so at rest exactly `visible`
   cards exist.

   Usage:
     VRColumnScroll.attach(containerEl, placedList, {
       visible: 4, pitch: 0.45, cardHeight: 0.25,
       angleDeg: 43.5, radius: 2.0, width: 0.72, accent: '#b8863b',
       belowCardClearance: 0.122   // buttons hanging under the bottom card
     });
   Returns null when dormant, else { scrollBy, offset, maxOffset, destroy }.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function attach(container, placed, opts) {
    opts = opts || {};
    var visible = opts.visible != null ? opts.visible : 4;
    // Two separate numbers, and conflating them is a real bug: `visible` is the
    // WINDOW SIZE once scrolling starts, `activateAbove` is how many cards the
    // column will show without scrolling at all. With 5 pieces and a window of
    // 4, treating them as one number starts windowing today — hiding one card
    // behind an affordance, which is exactly what Sebastian ruled out ("show
    // all 5"). activateAbove: 5 keeps it dormant now and wakes it at 6.
    var activateAbove = opts.activateAbove != null ? opts.activateAbove : visible;
    if (!container || !placed || placed.length <= activateAbove) return null;

    var pitch = opts.pitch;
    var cardH = opts.cardHeight != null ? opts.cardHeight : 0.25;
    var radius = opts.radius != null ? opts.radius : 2.0;
    var angleDeg = opts.angleDeg || 0;
    var width = opts.width != null ? opts.width : 0.72;
    var accent = opts.accent || '#b8863b';
    var below = opts.belowCardClearance != null ? opts.belowCardClearance : 0.122;
    var disposables = [];

    // The slot heights are simply the first `visible` layout positions, so a
    // windowed column occupies exactly the same band as an unwindowed one of
    // that length — the projects grid's top-alignment (§9.1) still holds.
    var baseY = placed.map(function (p) { return p.height; });
    var slotY = baseY.slice(0, visible);

    var offset = 0;
    var maxOffset = placed.length - visible;
    var tween = null;

    // ── Arrow bars ──
    // Placed in the cluster's own rotated frame, the same outer-rotates /
    // inner-translates pattern constellation.js uses — a bar positioned in
    // world space would sit in front of the wrong part of the dome.
    function mountBar(up, y, onClick) {
      var outer = document.createElement('a-entity');
      outer.setAttribute('rotation', { x: 0, y: angleDeg, z: 0 });
      var inner = document.createElement('a-entity');
      inner.setAttribute('position', { x: 0, y: y, z: -radius });
      // Same pitch-toward-the-eye tilt the cards get, so the bar sits in the
      // column's plane instead of facing straight out of the dome wall.
      inner.setAttribute('rotation', {
        x: THREE.MathUtils.radToDeg(Math.atan2(y - 1.6, radius)), y: 0, z: 0
      });
      var bar = window.VRScrollArrows.make({
        up: up, width: width, accent: accent, onClick: onClick, disposables: disposables
      });
      inner.appendChild(bar);
      outer.appendChild(inner);
      container.appendChild(outer);
      return { bar: bar, outer: outer };
    }

    var GAP = 0.06;
    var topBarY = slotY[0] + cardH / 2 + GAP;
    // The bottom card hangs its "Read the piece" / "Link" row below its own
    // edge, so the bottom bar has to clear THAT, not just the card.
    var bottomBarY = slotY[visible - 1] - cardH / 2 - below - GAP;

    var up = mountBar(true, topBarY, function () { scrollBy(-1); });
    var down = mountBar(false, bottomBarY, function () { scrollBy(1); });

    function applyOffset(animate, onDone) {
      var shift = -offset * pitch;
      // Everything visible during the move (see header), pruned on completion.
      placed.forEach(function (p) { p.innerEl.setAttribute('visible', true); });

      var settle = function () {
        placed.forEach(function (p, i) {
          p.innerEl.setAttribute('visible', i >= offset && i < offset + visible);
        });
        up.bar.setEnabled(offset > 0);
        down.bar.setEnabled(offset < maxOffset);
        if (onDone) onDone();
      };

      if (!animate || reducedMotion || typeof gsap === 'undefined') {
        placed.forEach(function (p, i) { p.innerEl.object3D.position.y = baseY[i] + shift; });
        settle();
        return;
      }

      if (tween) tween.kill();
      var proxy = { s: placed[0].innerEl.object3D.position.y - baseY[0] };
      tween = gsap.to(proxy, {
        s: shift,
        duration: 0.42,
        // VR_POLISH_STANDARDS.md §3's single curve — every transition in the
        // scene uses it, and a scroll is no exception.
        ease: 'power2.inOut',
        onUpdate: function () {
          placed.forEach(function (p, i) { p.innerEl.object3D.position.y = baseY[i] + proxy.s; });
        },
        onComplete: function () { tween = null; settle(); }
      });
    }

    function scrollBy(steps) {
      var next = Math.max(0, Math.min(maxOffset, offset + steps));
      if (next === offset) return;
      offset = next;
      applyOffset(true);
    }

    applyOffset(false);

    var api = {
      scrollBy: scrollBy,
      get offset() { return offset; },
      get maxOffset() { return maxOffset; },
      destroy: function () {
        if (tween) { tween.kill(); tween = null; }
        [up.outer, down.outer].forEach(function (o) { if (o.parentNode) o.parentNode.removeChild(o); });
        disposables.forEach(function (d) { if (d && d.dispose) d.dispose(); });
      }
    };
    return api;
  }

  window.VRColumnScroll = { attach: attach };
})();
