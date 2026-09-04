/* ═══ themes.js ═══
   Project room palettes (§6/§7 of VR_BUILD_SPEC.md) — pulled directly from
   each project's own page :root custom properties, not invented. Keyed by
   the `theme` field set in projects.json (see mergeProjectsWithManifest in
   data-loader.js). Falls back to a neutral dark theme for anything unmapped.

   Each theme: { sky, horizon, accent, panel, ink } — sky/horizon repaint the
   dome (see dome.js's setTheme), accent tints panel rims/lines, panel/ink
   are for any 2D-ish surfaces later.

   ─── ROOM SHAPE (`room`) ───
   Rooms differ by COLOUR ONLY right now. Position and behaviour are
   deliberately identical in all five — one shape, DEFAULT_ROOM below — so the
   layout can be judged and refined once rather than five times. Per-room
   customisation is deliberately kept possible but UNUSED: `room()` merges any
   theme's partial `room` block over DEFAULT_ROOM, so customising one room
   later means adding a few numbers to that one theme and nothing else.

   The two knobs, when we get there:

     rugRadius  the lit pad you stand on (dome.js's dusk-rug). CIRCLES ONLY —
                the rug is a scene-level entity at a fixed position and does
                NOT rotate with the room (a room rotates to the viewer's entry
                yaw), so any non-round footprint would sit at a random angle
                to the room it belongs to. Radius is the only honest knob.
     gallery    where the project's own photos hang: {inner, step, radius,
                height, stagger} — inner/outer pair angles in degrees off the
                room's forward axis, distance in metres, centre height, and a
                per-pair height offset (0 = a strict, level row).

   ─── THE FOUR LIMITS — read before changing ANY of those numbers ───
   They are not free parameters. Two of the four are previously-fixed bugs.

     • inner − cardHalfWidth ≥ 40°  — clear of the centred title/blurb/tags
       column, which is 2.2 m wide at z −1.7, i.e. ±33°. An earlier ±26° arc
       overlapped the blurb; that bug is fixed and must stay fixed.
     • step > 2 × cardHalfWidth    — the two pairs must not overlap on screen.
       Depth does NOT save you here: room cards are all renderOrder 0 and the
       scene sorts transparent objects by scene-graph order, so a FARTHER card
       painting over a nearer one is a real outcome (guide §3.6). Hence: never
       stagger the two pairs in DEPTH, only in height.
     • inner + step + cardHalfWidth ≤ 90° — past a full shoulder turn a photo
       is effectively hidden.
     • radius − (walk-ellipse reach at that angle) ≥ 0.30 m — walking is
       bounded by a 1.6 m lateral / 1.15 m forward ellipse (guide §9.5), and
       the ellipse is WIDEST exactly where the outer pair hangs. A trial
       Pendant layout at radius 1.75 cleared by only 0.19 m — you could walk
       into your own photographs. Cards are also not sunflower-tracked (that's
       hub panels only): they're aimed once at a seated eye, so closer = more
       visibly mis-aimed once the viewer moves.

   ─── PARKED: five per-room layouts, already validated ───
   Designed and checked against all four limits above, then set aside in favour
   of one shared shape. Kept here so reinstating any of them is a paste, not a
   redesign — drop one into its theme as `room: {...}`.

     pendant        rugRadius 0.9  gallery { inner 52, step 21, radius 1.90, height 1.66, stagger 0.04 }
     slipdoor       rugRadius 1.8  gallery { inner 54, step 26, radius 2.05, height 1.42, stagger 0.03 }
     baston         rugRadius 1.0  gallery { inner 53, step 21, radius 1.85, height 1.50, stagger 0.09 }
     timecollector  rugRadius 1.4  gallery { inner 53, step 27, radius 2.00, height 1.54, stagger 0    }
     chess          rugRadius 1.6  gallery { inner 57, step 24, radius 2.30, height 1.55, stagger 0    }
*/

(function () {
  window.VRThemes = {
    // No `room` block on any theme by design — see the header. Every room uses
    // DEFAULT_ROOM, so all five are identical in position and behaviour and
    // differ only in colour.
    pendant: { // Graduation Pendant — bright silver gallery (pendant.html --bg/--bg-panel/--ink)
      // THE ONE ACCENT NOT TAKEN FROM ITS PAGE, and it can't be: pendant.html
      // is genuinely achromatic — white, off-white, near-black ink, nothing
      // else. Both real candidates fail as a light: --ink #161513 has chroma
      // 0.07 and luminance 0.008, so tinting the key with it is the same as
      // turning it off, and --bg-panel #f7f6f3 is invisible against the floor
      // it already is. Champagne is the deliberate judgment call — the warm
      // cast gallery lighting throws on silver — and it's the only thing here
      // giving a near-white room any warmth.
      //
      // panel (THE FLOOR) was --bg-panel #f7f6f3 and that was the single worst
      // colour in the set. `panel` is a page BACKGROUND on pendant.html; in
      // here it is a 40 m luminous floor, and it made this the only room whose
      // own text sat on near-white: the image captions and the blurb are
      // #f5f5f0 fill, i.e. 1.02 against that floor, so ROOM_HALO's 8% outline
      // was doing 100% of the legibility work and they rendered as stencil
      // outlines (screenshotted, not theorised). It also filled ~65% of the
      // view with glare. --ink #161513 is the page's own dark token, so the
      // floor is still derived: captions go 1.02 -> 16.4, and the near-white
      // horizon band now has something to glow AGAINST, which is what makes
      // this room read as a bright gallery in the first place.
      sky: '#3a3a38', horizon: '#f7f6f3', accent: '#d8c9a0', panel: '#161513', ink: '#161513'
    },
    slipdoor: { // The Slip Door — clean automotive/accessible (slipdoor.html --vwblue/--gold/--ink)
      // accent was --vwblue #cdeffa, which is the page's BACKGROUND wash, not
      // its accent: at luminance 0.82 it tints the key light almost white, so
      // the room lit up pale and characterless. --magenta #0091c8 (misnamed in
      // that page's :root, it's the VW blue) is the colour the page itself
      // accents with, and it's the only fully-saturated candidate of the three
      // — chroma 1.00 against 0.82, so it actually colours the light.
      sky: '#0d1b20', horizon: '#0091c8', accent: '#0091c8', panel: '#141414', ink: '#e3f6fc'
    },
    baston: { // Bastón — warm personal craft (baston.html --pink/--pink-deep/--cream)
      sky: '#1c0e16', horizon: '#b8066c', accent: '#e30887', panel: '#221018', ink: '#f4efe9'
    },
    timecollector: { // Time Collector — warm brass/marble/timekeeping (timecollector.html --brass/--copper/--ink)
      // accent was --brass #b8863b — which is ALSO _default's accent and the
      // site's own ember gold, so the one room whose floor and sky are the
      // same colour (both #1a1408, making the accent its only colour) was lit
      // exactly like the generic fallback room. --brass-light #d69c47 is the
      // same metal from the same palette, distinct from the global ember, and
      // more luminous: accent-on-floor contrast goes 5.67 → 7.59. Chose it
      // over --highlight-gold #f4c95d, which at chroma 0.87 reads gold-leaf
      // rather than brass mechanism.
      sky: '#1a1408', horizon: '#a15c3e', accent: '#d69c47', panel: '#1a1408', ink: '#f6e3bd'
    },
    chess: { // Poser Chess Set — stark monochrome (chess.html --bg/--white)
      // --white, and now the card rims and tags too. They used to take
      // projects.json's #8a8a8a, which is a PURE NEUTRAL (chroma 0.00): as a
      // key-light tint that doesn't colour the light, it only lowers it, so
      // the darkest room in the set was also the dimmest lit. #f7f5f0 is the
      // page's only non-black token and the crispest reading available here.
      //
      // horizon was --bg-panel #0e0e0e, which gave THIS ROOM NO HORIZON. The
      // dome paints the band at the equator and feathers it to #0a0908 either
      // side, so the band was 1.03 against its surround and 1.00 against the
      // floor — the ember ring the whole dome/floor radius contract exists to
      // produce (ISSUE-09: "the ground always meets the glowing horizon") was
      // black on black. The shipped hub band measures 1.37/1.35, so that is
      // the target, not an arbitrary threshold. #252524 is chess.html's own
      // --line (white at 15% over --bg) and lands at 1.30/1.26 — as present
      // as the hub's ember, restrained enough for a monochrome room, and a
      // real page token rather than an invented grey.
      sky: '#000000', horizon: '#252524', accent: '#f7f5f0', panel: '#0e0e0e', ink: '#f7f5f0'
    },
    // Shared by the four PDF write-up pages (glasses, HP's Reckoning,
    // Algorithmic Modeling, Social Engineering) — checked their real :root
    // tokens directly and all four are identical (--bg/--bg-panel/--white),
    // matching VR_BUILD_SPEC.md §6's "Glasses / essays: signature dark" row.
    // A warm parchment accent (not reused from any other theme) keeps them
    // feeling distinct from the base dome without inventing new brand color.
    signatureDark: {
      sky: '#050505', horizon: '#111111', accent: '#c9c0ac', panel: '#111111', ink: '#e8e8e8'
      // No `room`: these four are the PDF write-ups, which open the reader and
      // never a room at all. They inherit DEFAULT_ROOM if that ever changes.
    },
    _default: {
      sky: '#050505', horizon: '#3a2418', accent: '#b8863b', panel: '#161514', ink: '#f5f5f0'
    }
  };

  // THE room shape — every room uses exactly this today, and these are the
  // numbers project-room.js had hardcoded before, so the shared layout is the
  // one that's already been looked at rather than a new guess. 1.3 matches
  // index.html's authored dusk-rug radius, so a room no longer resizes the rug
  // at all (only recolours it). Edit here to change ALL FIVE rooms at once.
  var DEFAULT_ROOM = {
    rugRadius: 1.3,
    gallery: { inner: 55, step: 25, radius: 1.90, height: 1.52, stagger: 0.07 }
  };

  function hex2rgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgb2hex(c) {
    return '#' + c.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }

  window.VRThemes.get = function (key) {
    return window.VRThemes[key] || window.VRThemes._default;
  };

  // Room geometry, always complete: a theme may specify part of `room` (or
  // none of it) and still get usable numbers back.
  window.VRThemes.room = function (key) {
    var t = window.VRThemes.get(key);
    var r = t.room || {};
    var g = r.gallery || {};
    var out = { rugRadius: r.rugRadius || DEFAULT_ROOM.rugRadius, gallery: {} };
    Object.keys(DEFAULT_ROOM.gallery).forEach(function (k) {
      out.gallery[k] = (typeof g[k] === 'number') ? g[k] : DEFAULT_ROOM.gallery[k];
    });
    return out;
  };

  // The rug colour is DERIVED, not authored, and that is deliberate. The hub's
  // rug is a slight warm lift off its own floor (#1a140f on #0c0b0a) — but a
  // room repaints the floor from theme.panel and never touched the rug, so the
  // Pendant room (panel #f7f6f3, near-white) put a dark brown disc on a white
  // floor: it read as a stain, not as a rug. Deriving it from the theme's own
  // panel + accent means the relationship holds for every theme automatically,
  // including any added later, and there is no sixth hex value to forget.
  // (project-room.js hand-copied the light values once and they drifted — same
  // class of bug, so: compute, don't copy.)
  // Matched by CONTRAST RATIO, not by a fixed blend amount. A flat "mix 35%
  // toward the accent" was measured across the five themes and ranged from
  // 1.15 (pendant) to 3.03 (chess) — i.e. a barely-there tint on the white
  // floor and a bright mid-grey disc on the near-black one, which is not one
  // design language, it's five accidents. The shipped hub rug sits at 1.08
  // against its own floor; rooms target a little more presence than that
  // because a room's floor is far lighter and more varied than the hub's
  // near-black void, but the point is that every room lands on the SAME
  // number, so a rug reads as the same object everywhere.
  var RUG_TARGET = 1.20;

  function relLum(c) {
    var l = c.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  }

  function contrast(a, b) {
    var x = relLum(a), y = relLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  function mix(a, b, t) {
    return [0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; });
  }

  window.VRThemes.rug = function (key) {
    var t = window.VRThemes.get(key);
    var panel = hex2rgb(t.panel);
    // Direction depends on the floor: you cannot lift a pad off a near-white
    // floor, and darkening a near-black one does nothing. Pendant's floor is
    // #f7f6f3, so its rug goes DOWN toward its own ink; every other theme's
    // goes UP toward its accent.
    var darken = relLum(panel) > 0.35;
    var toward = hex2rgb(darken ? t.ink : t.accent);
    // If a theme's own colour happens to sit on the wrong side of its floor,
    // fall back to plain black/white so the pad still reads at all.
    if ((relLum(toward) > relLum(panel)) === darken) toward = darken ? [0, 0, 0] : [255, 255, 255];

    var out = panel;
    for (var m = 0.02; m <= 1.0001; m += 0.02) {
      out = mix(panel, toward, m);
      if (contrast(out, panel) >= RUG_TARGET) break;
    }
    return rgb2hex(out);
  };
})();
