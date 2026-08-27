/* ═══ scroll-arrows.js ═══
   The one scroll control used everywhere something scrolls: a LONG FLAT bar
   with a wide triangle on it, one above the scrollable thing and one below.
   (VR_AI_BUILD_GUIDE.md §9.2/§9.6.)

   ── Why this shape, and why shared ──
   Sebastian specified it for the writing column — "a long flat arrow button at
   the top and bottom of the scroll section which you can click on" — and said
   the reader's scroll buttons "feel off" and should be redesigned to match. A
   bar spanning the full width of the content, sitting directly above/below it,
   says "this whole column moves, that way" in a way a small chevron off to one
   side does not. Having ONE builder is the point: the reader and the writing
   column are the two places that scroll, and they should not drift apart.

   ── Why the arrow is geometry, not text ──
   Carried over from pdf-reader.js, where it was learned the hard way: '▲'/'▼'
   in troika-text rendered as empty rounded rects, because the Syne latin subset
   (fonts.js) carries no Geometric Shapes block and troika silently substitutes
   or drops the glyph — the same failure §3.6 documents for '↗'. A THREE.Shape
   triangle cannot be subset away by a webfont and is resolution-independent.

   ── Why not ui-button ──
   ui-button draws its mark with troika-text (same trap), and its geometry is
   sized for a labelled pill. This borrows ui-button's hover FEEL — the scale pop
   plus a brighten — so it still reads as the same family of control, but it does
   NOT use the glass card material: see the dark-ground note in make(), which is
   a bug this control had to be redesigned around.

   Usage:
     var bar = VRScrollArrows.make({
       up: true, width: 0.9, accent: '#c9c0ac', onClick: fn
     });
     parentEl.appendChild(bar);
     bar.setEnabled(false);   // greys out and stops responding at a travel limit

   Every geometry/material it creates is pushed onto opts.disposables (if given)
   so the caller's teardown can free them — the reader rebuilds this control on
   every open.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ARROW_EMISSIVE = 0.42;
  var ARROW_EMISSIVE_HOVER = 0.85;
  var DISABLED_OPACITY = 0.28;

  // Pill-shaped ground for the bar. Hard-cornered quads read as raw debug
  // geometry next to every other rounded surface in this scene.
  function roundedRectGeometry(w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    var x = -w / 2, y = -h / 2;
    var shape = new THREE.Shape();
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r);
    shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h);
    shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    return new THREE.ShapeGeometry(shape, 12);
  }

  function triangleGeometry(w, h, up) {
    var shape = new THREE.Shape();
    var half = h / 2;
    if (up) {
      shape.moveTo(-w / 2, -half); shape.lineTo(w / 2, -half); shape.lineTo(0, half);
    } else {
      shape.moveTo(-w / 2, half); shape.lineTo(w / 2, half); shape.lineTo(0, -half);
    }
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }

  // Same reasoning as pdf-reader.js's litMaterial: MeshStandardMaterial so the
  // scene's key rack genuinely shades it, with `emissive` as a brightness FLOOR
  // because this rack is dim and warm and a white mark otherwise sinks to a
  // muddy grey. Accessible mode gets a flat maximum-contrast fill instead —
  // hard rule 4, no surface that can dim under a light.
  function litMaterial(hex, emissiveIntensity, opacity) {
    if (document.body.classList.contains('accessible')) {
      return new THREE.MeshBasicMaterial({
        color: hex, side: THREE.DoubleSide, transparent: true,
        opacity: opacity != null ? opacity : 1
      });
    }
    var mat = new THREE.MeshStandardMaterial({
      color: hex, roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide,
      transparent: true, opacity: opacity != null ? opacity : 1
    });
    mat.emissive = new THREE.Color(hex);
    mat.emissiveIntensity = emissiveIntensity;
    return mat;
  }

  function make(opts) {
    opts = opts || {};
    var up = !!opts.up;
    var W = opts.width != null ? opts.width : 0.9;
    // Flat on purpose — this is a bar, not a pad. 0.11 keeps it comfortably
    // past the scene-wide minimum target size ui-button.js enforces (coarse VR
    // pointing needs a generous hit area) while still reading as a thin rule
    // above the content rather than a second card competing with it.
    var H = opts.height != null ? opts.height : 0.11;
    var accent = opts.accent || '#c9c0ac';
    var disposables = opts.disposables || [];

    var el = document.createElement('a-entity');

    // ── Why a DARK ground and not the warm glass card material ──
    // The first version used VRGlass.makeCardMaterial, matching the panels.
    // Against the dark dome that reads fine — but the reader floats these bars
    // over a WHITE PDF page, and a warm translucent pad on white paper is very
    // nearly invisible. (Caught by measuring: the bar was correctly positioned,
    // visible, unoccluded and first in the raycast, and still could not be
    // found in the rendered frame.) The old left-column arrows never hit this
    // because they sat OFF the page against the room.
    //
    // A dark ground with a bright arrow reads against both — same trick the 2D
    // HUD buttons use over a bright sky — so one bar design works everywhere
    // and the two scrolling surfaces stay identical.
    var padMat = litMaterial('#12100d', 0.06, 0.82);
    padMat.roughness = 0.6;
    var padGeo = roundedRectGeometry(W, H, H * 0.46);
    el.setObject3D('pad', new THREE.Mesh(padGeo, padMat));

    // Wide and shallow, matching the bar: a tall narrow triangle on a flat bar
    // reads as a stray mark, a wide flat one reads as a direction.
    // Near-white fill with the accent as its emissive lift: on the dark ground
    // a pure-accent triangle (a mid tan) only reaches about 3:1 against the
    // pad, while off-white clears it comfortably and still carries the warm
    // family tint through the glow.
    var triMat = litMaterial('#f5f5f0', ARROW_EMISSIVE);
    triMat.emissive = new THREE.Color(accent);
    var triGeo = triangleGeometry(H * 1.15, H * 0.34, up);
    var tri = new THREE.Mesh(triGeo, triMat);
    tri.position.z = 0.014;
    el.setObject3D('arrow', tri);

    disposables.push(padGeo, padMat, triGeo, triMat);

    var enabled = true;
    el.classList.add('clickable');
    el.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (!enabled) return;
      if (opts.onClick) opts.onClick();
    });

    // Hover is hand-wired because this bypasses ui-button's component and so
    // its tick()-based uHover easing. Mirrors ui-button.wake(): the same 1.08
    // pop and brighten, plus the triangle's own emissive lift.
    var hoverTween = null;
    function setHover(on) {
      if (!enabled) return;
      if (reducedMotion) {
        el.setAttribute('scale', on ? '1.06 1.06 1.06' : '1 1 1');
      } else {
        el.setAttribute('animation__hover', {
          property: 'scale', dur: 160, easing: 'easeInOutQuad',
          to: on ? '1.06 1.06 1.06' : '1 1 1'
        });
      }
      if (hoverTween) { hoverTween.kill(); hoverTween = null; }
      var e2 = on ? ARROW_EMISSIVE_HOVER : ARROW_EMISSIVE;
      // The pad is a MeshStandardMaterial now, not the glass shader, so hover
      // lifts its own opacity/emissive instead of a uHover uniform.
      var o2 = on ? 0.92 : 0.82;
      if (reducedMotion || typeof gsap === 'undefined') {
        padMat.opacity = o2;
        triMat.emissiveIntensity = e2;
        return;
      }
      var proxy = { o: padMat.opacity, e: triMat.emissiveIntensity };
      hoverTween = gsap.to(proxy, {
        o: o2, e: e2, duration: 0.18, ease: 'power2.inOut',
        onUpdate: function () {
          padMat.opacity = proxy.o;
          triMat.emissiveIntensity = proxy.e;
        }
      });
    }
    el.addEventListener('mouseenter', function () { setHover(true); });
    el.addEventListener('mouseleave', function () { setHover(false); });

    // A bar you cannot travel any further with should say so rather than
    // silently doing nothing — the "is it broken or am I at the end?" problem.
    el.setEnabled = function (on) {
      if (enabled === !!on) return;
      enabled = !!on;
      triMat.opacity = enabled ? 1 : DISABLED_OPACITY;
      triMat.needsUpdate = true;
      // The whole bar recedes when it can't be used, not just its arrow — a
      // full-strength ground under a ghosted arrow reads as a rendering fault.
      padMat.opacity = enabled ? 0.82 : 0.4;
      el.setAttribute('scale', '1 1 1');
      // Off the raycaster's target list entirely while disabled, so it can't
      // swallow a hit meant for something behind it.
      if (enabled) el.classList.add('clickable');
      else el.classList.remove('clickable');
    };

    el.setAccent = function (hex) {
      triMat.color.set(hex);
      triMat.emissive.set(hex);
      triMat.needsUpdate = true;
    };

    return el;
  }

  window.VRScrollArrows = {
    make: make, triangleGeometry: triangleGeometry,
    roundedRectGeometry: roundedRectGeometry, litMaterial: litMaterial
  };
})();
