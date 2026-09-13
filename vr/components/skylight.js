/* ═══ skylight.js ═══
   The roof opens.

   Sebastian: *"add a button which essentially cuts the top 3rd of the dome,
   and then reveals a beautiful, sunny, blue sky with clouds… and that's where
   the light will be coming from."*

   So: one toggle, four things behind it.

     1. dome.js's `dusk-sky` punches a feathered hole in its own gradient,
        irising open from the zenith out to the top third. That component owns
        the cut because it owns the canvas the cut is painted into — see
        CUT_FRAC there for why "the top third" lands on a number that leaves
        the ember band and the whole gradient below it untouched.
     2. This file builds what is behind the hole: a daylight sky cap, a sun,
        and a two-deck field of 3D cumulus.
     3. The light changes. The aperture becomes the room's light source — a
        sun fixture in the sky's own direction, the ambient lifting from ember
        brown to a sky-blue bounce, and the four ember fixtures dropping back
        so the sun is plainly the thing lighting the room.
     4. A pool of daylight lands on the floor.

   Registers:
     open-sky   — the whole daylight layer + the toggle. One entity, no
                  attributes. Publishes `window.VRSkylight`.

   ── Why the clouds are geometry and not a picture of clouds ───────────────
   A painted cloud texture on the sky cap would be one draw call and would look
   like a photograph pasted to a ceiling: every cloud the same size, no
   perspective, no depth. A real cloud deck is a horizontal LAYER at a finite
   altitude, so looking up through a hole you see the ones overhead from
   underneath and large, and the ones toward the rim crowded, foreshortened and
   hazed — which is the whole reason a sky reads as a space rather than a
   backdrop. That is free if the clouds are actually up there, so they are:
   ~50 clusters of soft billboard quads on two decks at different altitudes,
   drifting at different speeds.

   All of it in ONE draw call — one merged BufferGeometry, one ShaderMaterial
   that billboards each quad in the vertex shader. See the shader comments for
   the traps (guide §3.5 colour space, §3.11 smoothstep, atlas bleed).
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Where the sun is ─────────────────────────────────────────────────────
  // Azimuth is measured from "forward" (-z, the way you land facing the home
  // panel) toward your LEFT. 38° left and 54° up puts the sun comfortably
  // inside the aperture — you find it by looking up and to the left, it is
  // never in your eyes on arrival, and it is above BOTH cloud decks so every
  // cloud is lit from over its shoulder and shows you its shaded base.
  //
  // The same unit vector drives four things that would look wrong if any of
  // them disagreed: the sun sprite, the cloud shader's `uSunDir`, the sun
  // light fixture, and which way the floor's daylight pool is offset. One
  // constant, four consumers.
  var SUN_AZ_DEG = 38;
  var SUN_EL_DEG = 54;
  var SUN_DIR = (function () {
    var az = SUN_AZ_DEG * Math.PI / 180, el = SUN_EL_DEG * Math.PI / 180;
    return new THREE.Vector3(
      -Math.sin(az) * Math.cos(el),
      Math.sin(el),
      -Math.cos(az) * Math.cos(el)
    ).normalize();
  })();

  // ── The sky cap ──────────────────────────────────────────────────────────
  // 90 m, not the dome's 40: the far cloud deck reaches ~67 m out, and the cap
  // is OPAQUE and depth-writing, so anything beyond it would be depth-rejected
  // and silently vanish. Keep this comfortably larger than CLOUD_FAR below.
  //
  // A cap rather than a sphere (100° of arc, zenith down to 10° BELOW the
  // horizon) because the bottom of a full sphere is a full-screen opaque fill
  // that the floor covers anyway. The overshoot past the horizon is what makes
  // sure no sliver of nothing shows along the floor's rim.
  var SKY_RADIUS = 90;
  var SKY_ARC_DEG = 100;

  // Painted as a plain 1-D canvas gradient in sRGB hex, exactly like
  // dome.js's dusk sky — the one sky technique in this build that is
  // verified working (aframe-environment-component's gradient shader renders
  // flat black here; see dome.js's header).
  //
  // Stops are authored in ELEVATION, not in texture rows, because the texture
  // row for a given elevation depends on SKY_ARC_DEG and the two drifted apart
  // the first time this was written. `skyTexture()` does the conversion.
  //
  // Only elevation ≳ 40° is ever visible through the aperture, so the top three
  // stops are the ones that matter; the rest exist so the gradient has somewhere
  // sane to go. Sampled toward the reference image Sebastian sent: a real
  // midday sky, rich but not navy overhead, pale and hazy at the bottom.
  var SKY_STOPS = [
    { el:  90, c: '#2f6fc0' },
    { el:  65, c: '#4589d4' },
    { el:  45, c: '#63a3e2' },
    { el:  25, c: '#96c3ec' },
    { el:   8, c: '#c9e0f4' },
    { el: -10, c: '#e4eff8' }
  ];

  // ── The cloud decks ──────────────────────────────────────────────────────
  // Altitudes and field sizes are coupled, and getting the coupling wrong is
  // the one thing here that shows as an obvious artefact:
  //
  //   Through a hole that starts at 41.8° of elevation, a deck at altitude H
  //   is visible out to a ground radius of H / tan(41.8°) = H * 1.118. The
  //   drift WRAPS each cluster at ±span/2, and a cluster that wraps inside
  //   that radius pops in full view. So span/2 must clear it, with room for
  //   the cluster's own width.
  //
  //   Deck A: H≈29 → visible to 32 m; span 120 wraps at 60. Clear.
  //   Deck B: H≈46 → visible to 51 m; span 200 wraps at 100. Clear.
  //
  // `z` needs the same clearance but does not wrap, so it just has to COVER
  // the visible radius or the deck ends in a straight edge across the sky.
  var DECKS = [
    { // the cumulus you actually look at
      count: 44, puffs: [18, 28],
      alt: [26, 33], span: 180, zHalf: 78,
      clusterR: [5.0, 12.0], clusterH: [1.8, 3.4],
      puffSize: [2.2, 4.6], drift: 0.30, opacity: 1.00
    },
    { // a higher, smaller, slower deck — pure depth cue
      count: 34, puffs: [8, 13],
      alt: [42, 52], span: 260, zHalf: 110,
      clusterR: [2.6, 6.0], clusterH: [0.8, 1.8],
      puffSize: [1.2, 2.4], drift: 0.11, opacity: 0.78
    }
  ];

  // ── Why so many small puffs and not a few big ones ───────────────────────
  // The first pass used 11–19 puffs of 3–7 m in a cluster 5–13 m across, so
  // each puff was over half the cluster's width. Screenshotted, that reads as
  // a pile of soap bubbles: you see the individual discs, not a cloud. The
  // silhouette of a cumulus is made of lobes much smaller than the whole, and
  // the only way to get it is to use enough of them to overlap into one mass.
  // ~23 puffs at ~a quarter of the cluster width does it.
  //
  // ── And why the fields got so much bigger when the cut came down ─────────
  // Lowering the cut widens the hole, and a wider hole sees FURTHER along a
  // cloud deck, not just more of the sky: a deck at altitude H is visible out
  // to (H − eye)/tan(cut), so dropping the cut from ~40° to ~28° of apparent
  // elevation took deck A's reach from ~37 m to ~59 m and deck B's from ~58 m
  // to ~95 m. Both numbers are hard constraints, in two different ways:
  //
  //   * `span` is where the drift WRAPS, and a cluster that wraps inside the
  //     visible cone pops into view at full size. The guard in
  //     buildCloudField() checks this and says so.
  //   * `zHalf` does not wrap, so it merely has to COVER the reach — if it
  //     does not, the deck ends in a straight edge across the sky, which is
  //     not something a guard can catch because it looks like a cloudless
  //     stretch.
  //
  // Both are set with room for a cut as low as 30° of latitude, so neither has
  // to move again if this angle is tuned. Counts went up with them to keep the
  // density: the area roughly doubled, and 24 clusters over the old field
  // already left the zenith an empty blue hole.
  var CLOUD_FAR = 78;      // haze reaches full strength here; also the depth
                           // budget the sky cap has to sit outside of

  var CLOUD_TOP   = '#ffffff';   // sunlit crown
  var CLOUD_BASE  = '#8fa8c6';   // shaded underside, blue from the sky bounce
  var CLOUD_SUN   = '#ffeccd';   // the warm side, and the rim on thin edges
  var CLOUD_HAZE  = '#8ab4de';   // what a distant cloud fades into
  var HAZE_AMT = 0.40;           // was 0.55, which bleached the rim clouds

  // ── Timing ───────────────────────────────────────────────────────────────
  // Opening is slower than closing: opening is the reveal and wants to be
  // watched, closing is a dismissal. Both are driven from the component's
  // own tick(), NOT from rAF or GSAP — guide §3.14: window rAF does not run
  // inside an immersive session, and one hand-rolled scalar does not need the
  // GSAP pump that xr-frame.js exists to provide.
  // Sebastian, after seeing it: *"make the opening process way slower to
  // please."* 1800 ms was paced like a UI transition; this is a sixty-metre
  // roof, and the thing it wants to feel like is machinery. 6500 ms with the
  // easeInOutCubic below means it leaves slowly, gathers through the middle and
  // settles — about as long as you can hold a reveal before it stops being a
  // reveal and starts being a wait.
  //
  // Closing stays much quicker. It is a dismissal, not a reveal, and nobody
  // wants to sit through six seconds of putting the lid back on.
  var OPEN_MS = 6500;
  var CLOSE_MS = 2800;

  // ── Lighting, open vs closed ─────────────────────────────────────────────
  // The ambient is the big one: it is what every card's glass and every troika
  // glyph sits in, so moving it from ember brown at 0.5 to a sky-blue bounce at
  // 0.95 is most of what makes the room read as daylit.
  //
  // RACK_DIM drops the four ember fixtures to 42%. Not to zero: the housings
  // are visible unlit spheres, so lamps that go black while still glowing would
  // read as a bug. Daylight washing them out is the truth of the picture.
  var AMBIENT_OPEN = { color: '#8fb4dd', intensity: 0.95 };
  // Was 0.42. Sebastian asked for the overhead lights to DISAPPEAR as the dome
  // opens, and the housings below now fade to nothing — so leaving their light
  // at 42% would have left four warm pools on the cards cast by lamps you can
  // no longer see, which is the exact "light arriving from nowhere" the visible
  // housings exist to prevent (index.html). 0.18 is a trace, kept only so the
  // glass keeps a little specular life; the cards' actual daylight comes from
  // the ember term below.
  var RACK_DIM = 0.18;

  // ── The lamp housings fade too ───────────────────────────────────────────
  // glass-material.js's light-rack-housings gives each fixture a visible core
  // and an ADDITIVE glow sprite, so you can see where the light comes from.
  // Against a near-black dusk dome they read as four lamps. Against a bright
  // blue sky — and they sit at ~41° of elevation, which is within a degree of
  // the cut, so they are silhouetted right on the rim of the hole — additive
  // glow on an already-bright background clips straight to white and they read
  // as four lens flares. In the first screenshots they were brighter than the
  // sun and you genuinely could not tell them apart from it.
  //
  // Fading them is also the honest thing: a small lamp does not stop emitting
  // when the roof opens, it stops MATTERING, and an additive glow is exactly
  // the term that should disappear when the surround gets brighter.
  //
  // ── All the way to nothing, cores included ───────────────────────────────
  // The previous pass faded only the glow sprites and left the little core
  // beads alone, on the grounds that a 55%-opacity white sphere against a
  // bright sky reads as a grey smudge — which it does. Sebastian then asked
  // for the overhead lights to *disappear*, and 0 is not 55%: a bead at zero
  // opacity has no smudge to be. So both go, and what is left overhead is the
  // opening.
  //
  // This also fixes something the lower cut created. The housings sit at 41.1°
  // and 50.3° of apparent elevation; the cut now appears BELOW both, so they
  // are no longer on the rim, they are inside the hole — four beads and four
  // blown-out additive halos floating in open sky.
  var HOUSING_DIM = 0;
  var SUN_LIGHT_INTENSITY = 1.4;
  var SUN_LIGHT_DIST = 16;     // only a direction; see index.html's #sunLight

  // ── How the CARDS get daylight ───────────────────────────────────────────
  // They do not get it from #ambientLight. The glass shader has no ambient
  // term at all (glass-material.js's LIGHT_FRAG is the four-fixture sum plus
  // one flat `uEmber` bounce), so the ember IS the cards' ambient — it exists
  // because dome.js paints the warm band all the way around the equator, and
  // a wraparound ring has no direction. Open the roof and the thing
  // surrounding the cards is a blue sky instead, so the ember becomes a
  // daylight bounce. That, plus the rack dimming, is what moves a card from
  // ember-lit to daylit.
  //
  // Written as raw sRGB fractions straight into the uniform rather than
  // through VRGlass.setEmber(), which runs the hex through THREE.Color and so
  // LINEARISES it — #3a2418's 0.227 would arrive as 0.042. That disagrees with
  // glass-material.js's own authored default, which is the sRGB fraction of
  // #3a2418 unconverted, because CARD_FRAG is the one shader in this build
  // that deliberately does NOT include <colorspace_fragment> (guide §3.5): its
  // colours are hand-authored in output space. Matching the authored
  // convention is the only way the closed dome is bit-identical to before.
  //
  // EMBER_DUSK is read back from the live uniform at capture time, not copied
  // here, for the same reason nothing else in this file copies a light value.
  var EMBER_DAY = [0.616, 0.753, 0.894];   // #9dc0e4, a sky-blue bounce

  // ── The floor's pool of daylight ─────────────────────────────────────────
  // A 60-metre-wide hole does not make a crisp shaft; it floods. So this is a
  // broad, very soft, ADDITIVE disc rather than a shaped pool: additive means
  // it lightens whatever colour the floor happens to be, which is the only way
  // it can survive a project room retinting the ground under it without this
  // file and themes.js having to know about each other.
  var POOL_RADIUS = 26;
  var POOL_OFFSET = 3.2;       // toward the ANTI-sun azimuth: light from the
                               // upper left lands down and to the right
  var POOL_PEAK = 0.30;

  // COOL, not warm. The first version used the sun's own #ffeece at 0.26 and
  // the floor came out tan — a big brown disc that read as a stain rather than
  // as light, and it fought the ember horizon it sits inside. Direct sunlight
  // is warm, but the thing actually lighting a floor under a 96°-wide hole is
  // the whole SKY, and skylight is famously blue: ~7000 K against the sun's
  // 5000 K. A faint warm core inside a cool wash is what the two sources
  // together look like.
  var POOL_STOPS = [
    [0.00, 'rgba(232,242,255,0.92)'],
    [0.22, 'rgba(224,238,255,0.66)'],
    [0.52, 'rgba(214,232,252,0.28)'],
    [0.78, 'rgba(208,228,250,0.08)'],
    [1.00, 'rgba(208,228,250,0)']
  ];

  // ── Paint order ──────────────────────────────────────────────────────────
  // This scene runs with transparent sorting OFF (guide §3.6): transparent
  // draw order is scene-graph order and renderOrder is the one lever that
  // still works. The chain, and it has to be exactly this:
  //
  //   sky cap (opaque, draws before every transparent whatever its order)
  //     → sun disc + halo   ORDER_SUN
  //     → cloud deck        ORDER_CLOUD   (so clouds can cover the sun)
  //     → sun bloom         ORDER_BLOOM   (so a veiled sun still glows)
  //     → dusk dome MASK    -1            (dome.js — hides all of the above
  //                                        outside the hole)
  //     → the room          0+
  var ORDER_SKY = -7;
  var ORDER_SUN = -6;
  var ORDER_CLOUD = -5;
  var ORDER_BLOOM = -4;

  function lerp(a, b, t) { return a + (b - a) * t; }

  function mixHex(a, b, t) {
    var ca = new THREE.Color(a), cb = new THREE.Color(b);
    return '#' + ca.lerp(cb, t).getHexString();
  }

  // Deterministic PRNG (mulberry32). The cloud field must be identical on
  // every load: a sky that reshuffles itself each visit cannot be judged in a
  // screenshot, and a bad cluster would be unreproducible.
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ranf(r, range) { return lerp(range[0], range[1], r()); }

  // ═══ Textures ═════════════════════════════════════════════════════════════

  function skyTexture() {
    var c = document.createElement('canvas');
    c.width = 2;
    c.height = 512;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, c.height);
    SKY_STOPS.forEach(function (s) {
      // Canvas row 0 is the top of the cap (SphereGeometry's uv.y is 1 at
      // thetaStart, and a CanvasTexture's flipY maps that to row 0), so
      // elevation 90° is offset 0 and the arc runs down from there.
      var f = (90 - s.el) / SKY_ARC_DEG;
      g.addColorStop(Math.max(0, Math.min(1, f)), s.c);
    });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    var tex = new THREE.CanvasTexture(c);
    // Plain sRGB hex painted like CSS — tag it, or the colour-managed renderer
    // treats the bytes as linear light and the sky washes out (dome.js, same).
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ── Two sun textures, because one cannot do both jobs ────────────────────
  // The first version reused a single glass-material-style glow whose stops put
  // almost all the energy inside the central 8% of the sprite. Scaled up to a
  // 30 m halo that means the bright part is still only ~2° wide, so the sun
  // rendered the same size and brightness as one of the light rack's little
  // lamp housings 3 m overhead — screenshotted, you could not tell which of
  // the five bright dots in the aperture was the sun.
  //
  // So: CORE is tight (a small blown-out disc, which is what a photographed sun
  // actually is) and GLARE is broad and flat (the wide bloom around it). A
  // gradient that is right for a lamp is wrong for a sun.
  function radialTex(stops) {
    var size = 256, h = size / 2;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(h, h, 0, h, h, h);
    stops.forEach(function (st) { g.addColorStop(st[0], st[1]); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  var _sunCoreTex = null, _sunGlareTex = null;
  function sunCoreTexture() {
    if (_sunCoreTex) return _sunCoreTex;
    _sunCoreTex = radialTex([
      [0.00, 'rgba(255,255,255,1)'],
      [0.30, 'rgba(255,254,248,1)'],
      [0.52, 'rgba(255,248,226,0.72)'],
      [0.74, 'rgba(255,242,210,0.22)'],
      [1.00, 'rgba(255,240,206,0)']
    ]);
    return _sunCoreTex;
  }
  function sunGlareTexture() {
    if (_sunGlareTex) return _sunGlareTex;
    _sunGlareTex = radialTex([
      [0.00, 'rgba(255,246,226,0.62)'],
      [0.16, 'rgba(255,244,220,0.44)'],
      [0.38, 'rgba(255,240,212,0.20)'],
      [0.62, 'rgba(252,236,208,0.07)'],
      [0.82, 'rgba(250,234,206,0.02)'],
      [1.00, 'rgba(250,234,206,0)']
    ]);
    return _sunGlareTex;
  }

  function poolTexture() {
    return radialTex(POOL_STOPS);
  }

  // ── The puff atlas ───────────────────────────────────────────────────────
  // Four variants in a 2×2 grid so a cluster is not the same blob repeated.
  // Each variant is drawn into its OWN tile canvas and then blitted in:
  // `destination-in` masks the whole canvas it runs on, so masking per-variant
  // in the atlas would erase the neighbouring tiles.
  //
  // Every blob is kept well inside its tile (lobes within 0.24, mask fully out
  // by 0.48 of the tile) so mipmapping cannot bleed one tile into the next at
  // the small sizes the rim clouds render at. They are all soft white blobs, so
  // even if it bled it would bleed into a soft white blob.
  //
  // ── Two things here were the whole reason the first version looked like
  //    bokeh rather than cloud ────────────────────────────────────────────
  //  1. The lobe alpha fell off over more than half the lobe's radius
  //     (full to 0.46, gone by 1.0). A cumulus edge against blue sky is
  //     nearly SHARP — it is a phase boundary, not a fog bank. Full to 0.70
  //     and gone by 1.0 is still soft enough to hide the polygon and crisp
  //     enough to read as an edge.
  //  2. A global radial mask faded EVERY puff out from 0.29 of the tile
  //     regardless of where its lobes were, which put a soft circular
  //     vignette on every single quad — the soap-bubble look, applied
  //     uniformly. The mask is now a safety clip at the very edge (full to
  //     0.90 of its radius) and the lobes are what shape the silhouette.
  //
  // The alpha also carries the tail the fragment shader's rim term keys off,
  // so the falloff has to be a band and not a hairline.
  var _puffTex = null;
  function puffAtlas() {
    if (_puffTex) return _puffTex;
    var TILE = 256, N = 2;
    var atlas = document.createElement('canvas');
    atlas.width = atlas.height = TILE * N;
    var actx = atlas.getContext('2d');
    var r = rng(20260913);

    for (var i = 0; i < N * N; i++) {
      var t = document.createElement('canvas');
      t.width = t.height = TILE;
      var ctx = t.getContext('2d');
      var cx = TILE / 2, cy = TILE / 2;

      // ── The lobes are drawn ADDITIVELY ('lighter'), not stacked ─────────
      // With source-over, each lobe keeps its own visible edge wherever it
      // laps another, so the alpha inside a puff dips between lobes — and the
      // fragment shader's rim term keys off exactly those dips and draws a
      // bright outline around every internal lobe. Screenshotted, that is the
      // "bunch of soap bubbles" read.
      // Additively, a handful of half-strength lobes SATURATE to alpha 1
      // wherever two or more overlap, so the interior is one solid mass and
      // the only falloff left is the union's outer boundary — which is lumpy,
      // because it is the union of thirteen circles. One soft edge per puff,
      // shaped like a cauliflower, which is the shape wanted.
      ctx.globalCompositeOperation = 'lighter';
      var lobes = 13 + Math.floor(r() * 6);
      for (var j = 0; j < lobes; j++) {
        var ang = r() * Math.PI * 2;
        var dist = Math.sqrt(r()) * TILE * 0.22;
        var rad = TILE * (0.11 + r() * 0.10);
        var lx = cx + Math.cos(ang) * dist;
        var ly = cy + Math.sin(ang) * dist;
        var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, rad);
        g.addColorStop(0.00, 'rgba(255,255,255,0.58)');
        g.addColorStop(0.42, 'rgba(255,255,255,0.44)');
        g.addColorStop(1.00, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, ly, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // Safety clip only — see the note above. Without SOME clip a stray lobe
      // can touch the tile edge and bleed into its neighbour through the mips.
      ctx.globalCompositeOperation = 'destination-in';
      var mask = ctx.createRadialGradient(cx, cy, 0, cx, cy, TILE * 0.48);
      mask.addColorStop(0.00, 'rgba(0,0,0,1)');
      mask.addColorStop(0.90, 'rgba(0,0,0,1)');
      mask.addColorStop(1.00, 'rgba(0,0,0,0)');
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.globalCompositeOperation = 'source-over';

      actx.drawImage(t, (i % N) * TILE, Math.floor(i / N) * TILE);
    }

    _puffTex = new THREE.CanvasTexture(atlas);
    // NoColorSpace, not SRGBColorSpace: only the ALPHA of this texture is
    // used, and tagging it sRGB makes three.js decode the RGB it never reads
    // while doing nothing at all to the alpha (alpha is never colour-managed).
    _puffTex.colorSpace = THREE.NoColorSpace;
    return _puffTex;
  }

  // ═══ The cloud field ══════════════════════════════════════════════════════

  var CLOUD_VERT = [
    'uniform float uTime;',
    'uniform vec3 uSunDir;',
    'uniform float uHazeFar;',
    'attribute vec3 aOffset;',
    'attribute vec2 aCorner;',
    'attribute vec2 aTile;',
    'attribute float aSize;',
    'attribute float aRot;',
    'attribute float aShade;',
    'attribute float aDrift;',
    'attribute float aSpan;',
    'attribute float aFade;',
    'varying vec2 vUv;',
    'varying vec2 vQuad;',
    'varying float vShade;',
    'varying float vSun;',
    'varying float vHaze;',
    'varying float vFade;',
    'void main() {',
    // Each CLUSTER drifts and wraps; `position` carries the cluster centre and
    // `aOffset` the puff's place inside it, so a whole cluster wraps as one
    // piece instead of tearing apart at the seam. GLSL mod() is always
    // positive, which is what makes this work for negative x.
    '  vec3 c = position;',
    '  float wrapHalf = aSpan * 0.5;',   // NOT `half` — reserved word in GLSL ES 1.00
    '  c.x = mod(c.x + uTime * aDrift + wrapHalf, aSpan) - wrapHalf;',
    '  vec3 world = c + aOffset;',
    // Billboard in VIEW space. Camera-facing is not a compromise here, it is
    // correct: the viewer barely leaves the middle of the dome, so a quad that
    // faces the eye is horizontal-ish overhead and near-vertical out at the
    // rim — which is exactly how a cloud deck presents itself from below.
    '  vec4 mv = modelViewMatrix * vec4(world, 1.0);',
    '  float sr = sin(aRot), cr = cos(aRot);',
    '  vec2 corner = vec2(aCorner.x * cr - aCorner.y * sr, aCorner.x * sr + aCorner.y * cr);',
    '  mv.xy += corner * aSize;',
    '  gl_Position = projectionMatrix * mv;',
    '  vUv = aTile + (aCorner * 0.5 + 0.5) * 0.5;',
    '  vShade = aShade;',
    // Which side of its own cluster this puff sits on, relative to the sun.
    // normalize(vec3(0)) is NaN, so the degenerate centre puff gets 0.
    '  float ol = length(aOffset);',
    '  vSun = ol > 0.0001 ? dot(aOffset / ol, uSunDir) : 0.0;',
    '  vHaze = clamp(length(world) / uHazeFar, 0.0, 1.0);',
    '  vFade = aFade;',
    // The quad's own coordinate, used in the fragment shader as a FAKE SPHERE
    // NORMAL. This is the single biggest thing that turns a billboard into a
    // lobe of vapour: n = (q.x, q.y, sqrt(1 - |q|²)) is the normal of a unit
    // hemisphere facing the eye, so lighting it gives every puff a lit crescent
    // on the sun side and a shaded one opposite. Without it each puff is flat
    // and the cluster reads as a pile of discs however good the texture is.
    // Cheap, standard, and it costs one varying.
    '  vQuad = aCorner;',
    '}'
  ].join('\n');

  var CLOUD_FRAG = [
    'uniform sampler2D uMap;',
    'uniform vec3 uTop;',
    'uniform vec3 uBase;',
    'uniform vec3 uSun;',
    'uniform vec3 uHaze;',
    'uniform vec3 uSunView;',
    'uniform float uOpacity;',
    'uniform float uHazeAmt;',
    'varying vec2 vUv;',
    'varying vec2 vQuad;',
    'varying float vShade;',
    'varying float vSun;',
    'varying float vHaze;',
    'varying float vFade;',
    'void main() {',
    '  vec4 t = texture2D(uMap, vUv);',
    '  float a = t.a * uOpacity * vFade;',
    '  if (a < 0.004) discard;',
    // ── Per-puff volume, from a fake hemisphere normal ─────────────────────
    // vQuad is the quad's own ±1 coordinate and the quad faces the eye, so
    // this is the view-space normal of a sphere sitting in it. uSunView is
    // SUN_DIR rotated into view space by the component's tick. ndl is then a
    // real Lambert term per pixel: a bright crescent toward the sun, a blue
    // shaded side away from it. Clamped at the silhouette so the edge does not
    // go black.
    '  float q2 = dot(vQuad, vQuad);',
    '  vec3 n = vec3(vQuad, sqrt(max(0.0, 1.0 - min(q2, 1.0))));',
    '  float ndl = dot(normalize(n), uSunView);',
    // Two shading terms, deliberately: `ndl` is the lobe's own form, `vShade`
    // is where the lobe sits in its cluster (crown vs base). A cumulus needs
    // both — all-lobe and you get a bag of lit spheres, all-cluster and you
    // get a flat gradient.
    // ── Why there is a constant term ──────────────────────────────────────
    // You are looking at these from UNDERNEATH, and the puffs you can see are
    // therefore the BASE ones — low vShade, and mostly facing away from a sun
    // that is above them. Weighted purely on the two shading terms, every
    // cloud in the aperture came out grey-blue: physically right for a cloud
    // base, and not the sunny sky that was asked for. The 0.26 floor is the
    // light that has bounced around inside the cloud and come out of the
    // bottom, which is a real thing and is why a fair-weather cumulus base is
    // bright grey rather than dark. It is what puts the white back.
    '  float lit = 0.26 + 0.46 * smoothstep(-0.45, 0.80, ndl)',
    '                   + 0.28 * smoothstep(0.00, 0.70, vShade);',
    '  vec3 col = mix(uBase, uTop, clamp(lit, 0.0, 1.0));',
    '  float sunSide = max(vSun, 0.0);',
    '  col += uSun * sunSide * 0.18;',
    // Rim light: the thin edge of a sun-side puff is where light gets through.
    // Written as 1.0 - smoothstep(lo, hi, x) — guide §3.11, a reversed
    // smoothstep is UNDEFINED in GLSL and returns 0 everywhere with no error.
    // Weaker than the first pass's 0.55, which blew every silhouette white.
    '  float edge = 1.0 - smoothstep(0.10, 0.70, t.a);',
    '  col += uSun * edge * sunSide * 0.26;',
    '  col = mix(col, uHaze, vHaze * uHazeAmt);',
    '  gl_FragColor = vec4(col, a);',
    // Guide §3.5. The uniforms are THREE.Color, which converts sRGB hex to the
    // renderer's LINEAR working space, so everything above is linear and has to
    // be encoded on the way out. Without this the clouds render dark and
    // orange-shifted — the exact failure ISSUE-07 chased for a week.
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  function buildCloudField() {
    var r = rng(913202609);
    var pos = [], off = [], corner = [], tile = [], size = [], rot = [],
        shade = [], drift = [], span = [], fade = [], index = [];
    var quad = 0;

    // Clusters are emitted FARTHEST FIRST, and each cluster's puffs top-down.
    // The field is one merged geometry with depthWrite off, so quads paint in
    // buffer order and nothing sorts them: far-before-near means a near cloud
    // covers a far one, and top-before-base means each cluster shows you its
    // base, which is the face you are actually looking at from underneath.
    DECKS.forEach(function (deck, deckIndex) {
      // ── The one coupling here that breaks silently ────────────────────────
      // A cluster that WRAPS inside the visible cone pops into view at full
      // size. The visible ground radius of a deck is alt / tan(cut elevation),
      // so it depends on dome.js's cut angle — read from VRDome rather than
      // kept as a second copy of 41.81°, which is the whole reason dome.js
      // publishes CUT_ELEV_DEG. Change an altitude or a span and this says so
      // instead of leaving a cloud blinking in and out overhead.
      var cutElev = (window.VRDome && VRDome.CUT_ELEV_DEG) || 41.81;
      var reach = deck.alt[1] / Math.tan(cutElev * Math.PI / 180) + deck.clusterR[1];
      if (deck.span / 2 < reach) {
        console.warn('[vr] skylight: cloud deck ' + deckIndex + ' wraps at ' +
          (deck.span / 2).toFixed(0) + ' m but is visible out to ' + reach.toFixed(0) +
          ' m — clusters will pop in and out overhead. Widen its span.');
      }

      var clusters = [];
      for (var i = 0; i < deck.count; i++) {
        clusters.push({
          x: (r() - 0.5) * deck.span,
          y: ranf(r, deck.alt),
          z: (r() - 0.5) * 2 * deck.zHalf,
          rx: ranf(r, deck.clusterR),
          // Cumulus are wider across than deep, and never round in plan —
          // an equal rx/rz reads as a ball of cotton wool.
          rz: ranf(r, deck.clusterR) * 0.82,
          ry: ranf(r, deck.clusterH),
          n: Math.round(ranf(r, deck.puffs)),
          seed: r()
        });
      }
      clusters.sort(function (a, b) {
        return (b.x * b.x + b.z * b.z) - (a.x * a.x + a.z * a.z);
      });

      clusters.forEach(function (cl) {
        var pr = rng(Math.floor(cl.seed * 4294967296));
        var puffs = [];
        for (var j = 0; j < cl.n; j++) {
          // A cumulus is a flat-bottomed HEAP: broadest at the base, narrowing
          // upward, with the mass low. So height is strongly biased down
          // (pow 1.9) and the lateral radius shrinks with height rather than
          // the puffs being scattered through an ellipsoid — an ellipsoid
          // gives a rugby ball, which is the one silhouette a cloud never has.
          var ang = pr() * Math.PI * 2;
          var hy = Math.pow(pr(), 1.9);
          var rad = Math.sqrt(pr()) * (1.0 - 0.55 * hy);
          puffs.push({
            x: Math.cos(ang) * rad * cl.rx,
            y: hy * cl.ry,
            z: Math.sin(ang) * rad * cl.rz,
            // Base puffs a little larger: it is what makes the underside read
            // as one flat mass rather than a row of bumps.
            s: ranf(pr, deck.puffSize) * (1.15 - 0.30 * hy),
            rot: pr() * Math.PI * 2,
            tile: Math.floor(pr() * 4),
            shade: hy
          });
        }
        puffs.sort(function (a, b) { return b.y - a.y; });

        puffs.forEach(function (p) {
          var tx = (p.tile % 2) * 0.5, ty = Math.floor(p.tile / 2) * 0.5;
          for (var k = 0; k < 4; k++) {
            pos.push(cl.x, cl.y, cl.z);
            off.push(p.x, p.y, p.z);
            size.push(p.s);
            rot.push(p.rot);
            shade.push(p.shade);
            drift.push(deck.drift);
            span.push(deck.span);
            fade.push(deck.opacity);
            tile.push(tx, ty);
          }
          corner.push(-1, -1, 1, -1, 1, 1, -1, 1);
          var b = quad * 4;
          index.push(b, b + 1, b + 2, b, b + 2, b + 3);
          quad++;
        });
      });
    });

    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aOffset', new THREE.Float32BufferAttribute(off, 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
    g.setAttribute('aTile', new THREE.Float32BufferAttribute(tile, 2));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aRot', new THREE.Float32BufferAttribute(rot, 1));
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    g.setAttribute('aDrift', new THREE.Float32BufferAttribute(drift, 1));
    g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
    g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
    g.setIndex(index);

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: puffAtlas() },
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIR.clone() },
        uHazeFar: { value: CLOUD_FAR },
        uTop: { value: new THREE.Color(CLOUD_TOP) },
        uBase: { value: new THREE.Color(CLOUD_BASE) },
        uSun: { value: new THREE.Color(CLOUD_SUN) },
        uHaze: { value: new THREE.Color(CLOUD_HAZE) },
        uSunView: { value: SUN_DIR.clone() },
        uHazeAmt: { value: HAZE_AMT },
        uOpacity: { value: 1 }
      },
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });

    var mesh = new THREE.Mesh(g, mat);
    // `position` holds cluster centres and the quads are built in the vertex
    // shader, so three.js's bounding sphere is wrong by a cluster's width AND
    // the drift moves geometry it never sees. Culling this mesh is meaningless
    // anyway — it is either overhead or masked.
    mesh.frustumCulled = false;
    return { mesh: mesh, material: mat, quads: quad };
  }

  // ═══ The component ════════════════════════════════════════════════════════

  AFRAME.registerComponent('open-sky', {
    init: function () {
      this.aperture = 0;        // 0 closed, 1 fully open
      this.target = 0;
      this.tweening = false;
      this._built = false;
      this._rackBase = null;
      this._ambientBase = null;
      this._emberBase = null;
      this._housings = null;
      this._heal = 0;

      var self = this;
      // Two different moments, deliberately:
      //   • the AUTHORED lighting is snapshotted at scene load, before any
      //     project room can retint it (see captureBase),
      //   • the sky itself is built on FIRST OPEN, so a visitor who never
      //     presses the button pays nothing for it.
      var capture = function () { self.captureBase(); };
      if (this.el.sceneEl.hasLoaded) capture();
      else this.el.sceneEl.addEventListener('loaded', capture);

      this.buildControls();

      window.VRSkylight = {
        open: function () { self.setOpen(true); },
        close: function () { self.setOpen(false); },
        toggle: function () { self.setOpen(!self.isOpen()); },
        isOpen: function () { return self.isOpen(); },
        // For the camera-path harness and ?sky=1 — jump straight to a state
        // with no tween, so a screenshot is never taken mid-iris.
        set: function (v) { self.jumpTo(v ? 1 : 0); }
      };

      // ?sky=1 — land with the roof already open. The harnesses need this
      // (guide §5): a tweened reveal and a screenshot are a race.
      if (/[?&]sky=1/.test(location.search)) {
        var openNow = function () { self.jumpTo(1); };
        if (this.el.sceneEl.hasLoaded) setTimeout(openNow, 0);
        else this.el.sceneEl.addEventListener('loaded', openNow);
      }
    },

    // ── Snapshot the authored lighting, once, from the live markup ──────────
    // Eagerly, at load. Doing it lazily on first open was a real bug: open the
    // sky from INSIDE a project room and the "authored" ambient captured would
    // be that room's retint, so closing the sky afterwards would leave the hub
    // permanently wearing the room's colour. index.html is the only source of
    // truth for these, and it is only untouched before the first room opens.
    captureBase: function () {
      var ambient = document.querySelector('#ambientLight');
      var al = ambient && ambient.getAttribute('light');
      if (al && !this._ambientBase) {
        this._ambientBase = { color: al.color, intensity: al.intensity };
      }
      if (!this._emberBase && window.VRGlass && VRGlass.sharedLightUniforms) {
        var L0 = VRGlass.sharedLightUniforms();
        if (L0 && L0.uEmber) {
          this._emberBase = [L0.uEmber.value.x, L0.uEmber.value.y, L0.uEmber.value.z];
        }
      }
      var rack = [].slice.call(document.querySelectorAll('.key-light'));
      if (rack.length && !this._rackBase) {
        this._rackBase = rack.map(function (el) {
          var l = el.getAttribute('light') || {};
          return { el: el, intensity: (l.intensity != null ? l.intensity : 1) };
        });
      }

      // index.html authors the sun fixture with no position on purpose: this is
      // the one place that knows where the sun is, and the sprite, the cloud
      // shader and the floor's pool all read the same vector. For a
      // DIRECTIONAL light the position is only a direction (three.js shines it
      // from `position` at the origin), so the 16 m is arbitrary — it just has
      // to be outside the room and on the right bearing.
      var sunEl = document.querySelector('#sunLight');
      if (sunEl && !this._sunPlaced) {
        this._sunPlaced = true;
        var p = SUN_DIR.clone().multiplyScalar(SUN_LIGHT_DIST);
        sunEl.setAttribute('position', { x: p.x, y: p.y, z: p.z });
      }
    },

    // ── The two ways in ─────────────────────────────────────────────────────
    // Both drive the same toggle, and both are kept in step by refreshControls.
    //
    //   • An in-scene ui-button under the bio card. This is the one that works
    //     in a headset: the DOM HUD below is not composited into an immersive
    //     session at all, so a HUD-only control would make this a flat-screen
    //     feature. It carries .hub-cluster's parent (#homeCluster) so a project
    //     room or the reader puts it away with the rest of the hub.
    //   • The HUD's ☀ pill, next to ‹ › ♪, for the phone and desktop views.
    //     Wired here rather than in hud.js so the whole feature is one file;
    //     hud.js owns turn/recenter/mute and knows nothing about the sky.
    //
    // ISSUE-05 (in-scene controls read as persistent clutter) is why this is
    // ONE small pill anchored to an existing card, and not a floating,
    // camera-locked panel like the ⌖/♪ pair that was removed.
    buildControls: function () {
      var self = this;

      var btn = document.createElement('a-entity');
      btn.setAttribute('ui-button', {
        label: 'Open the sky', width: 0.46, height: 0.13,
        accent: '#b8863b', variant: 'ghost',
        // Three short words on a 0.52 m plate measured as a lot of empty
        // glass around small type. Narrower plate, and the bump ui-button.js
        // documents fontScale for rather than inventing a fourth type size.
        fontScale: 1.15
      });
      // Under the bio card, which spans y 0.62–2.08 at x 0.62 (index.html):
      // 0.075 m of air under its lower edge, the same relationship the
      // portrait's "Compare portrait depth" pill has to the portrait.
      // homeCluster sits at z=-1.5 and the bio card at -1.52, so -0.02 puts
      // the pill in the card's own plane.
      btn.setAttribute('position', '0.62 0.47 -0.02');
      btn.classList.add('clickable');
      btn.addEventListener('click', function () { self.setOpen(!self.isOpen()); });
      this.sceneBtn = btn;

      var host = document.querySelector('#homeCluster') || this.el.sceneEl;
      host.appendChild(btn);

      var hud = document.getElementById('skyBtn');
      if (hud) {
        this.hudBtn = hud;
        hud.addEventListener('click', function () { self.setOpen(!self.isOpen()); });
      }
      this.refreshControls();
    },

    refreshControls: function () {
      var open = this.isOpen();
      if (this.sceneBtn) {
        this.sceneBtn.setAttribute('ui-button', 'label', open ? 'Close the sky' : 'Open the sky');
      }
      if (this.hudBtn) {
        var label = open ? 'Close the sky' : 'Open the sky';
        this.hudBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
        this.hudBtn.setAttribute('aria-label', label);
        this.hudBtn.setAttribute('title', label);
        this.hudBtn.classList.toggle('sky-open', open);
      }
    },

    isOpen: function () { return this.target > 0.5; },

    // ── Everything behind the hole ──────────────────────────────────────────
    // Built once, on first open — never at load. The atlas is four 256²
    // canvases and the field is ~600 quads of generated buffers; a visitor who
    // never presses the button should not pay for any of it, and arrival cost
    // is the thing §9.16 spent a whole session removing. Same bargain
    // portrait-lab.js strikes with its splat.
    build: function () {
      if (this._built) return;
      this._built = true;

      var group = new THREE.Group();
      group.visible = false;

      // Sky cap. Opaque and first: it is the thing every transparent layer
      // above it blends onto, and being in the opaque pass means it draws
      // before all of them regardless of renderOrder.
      var skyGeo = new THREE.SphereGeometry(
        SKY_RADIUS, 40, 24, 0, Math.PI * 2, 0, SKY_ARC_DEG * Math.PI / 180
      );
      this.skyTex = skyTexture();
      var skyMat = new THREE.MeshBasicMaterial({
        map: this.skyTex, side: THREE.BackSide, fog: false
      });
      this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
      this.skyMesh.renderOrder = ORDER_SKY;
      group.add(this.skyMesh);

      // The dusk dome is the MASK in the chain above. It is transparent now,
      // with a hole painted into its alpha, so it paints over all of this
      // everywhere except the hole — which is why the cloud deck can hang at
      // 30 m, INSIDE the 40 m dome, without showing through the walls.
      // Masking by alpha rather than by geometry is also what lets the cut
      // have a feathered edge.
      var sunDist = SKY_RADIUS * 0.78;
      var sunPos = SUN_DIR.clone().multiplyScalar(sunDist);
      function sunSprite(tex, colour, scale, order) {
        var sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, color: colour, blending: THREE.AdditiveBlending,
          transparent: true, depthWrite: false, fog: false
        }));
        sp.position.copy(sunPos);
        sp.scale.setScalar(sunDist * scale);
        sp.renderOrder = order;
        group.add(sp);
        return sp;
      }

      // The glare and the disc sit BEHIND the cloud deck (ORDER_SUN, before
      // ORDER_CLOUD), so a cloud drifting across the sun really does cover it.
      // Scales are fractions of the 70 m distance, i.e. 0.62 ≈ 43 m ≈ 35° of
      // glare around a disc of 0.062 ≈ 4.3 m ≈ 3.5°. The disc is ~7× the real
      // sun's 0.53°, deliberately: at true angular size, in a dome whose
      // aperture is 96° across, it is a speck.
      this.sunGlow = sunSprite(sunGlareTexture(), '#fff2dc', 0.62, ORDER_SUN);
      this.sunCore = sunSprite(sunCoreTexture(), '#ffffff', 0.062, ORDER_SUN);

      // ── The bloom, and why it draws AFTER the clouds ────────────────────
      // The deck at 30 m fills a good part of a hole that starts at 41.8°, so
      // the sun spends a lot of the time behind a cloud — realistic, and it
      // cost the feature its whole point: "that's where the light will be
      // coming from" does not survive the light source being invisible.
      // A dimmer additive bloom drawn over the clouds is the forward
      // scattering you actually see through thin cloud: the veiled sun still
      // blooms, and the cloud it is behind gets a lit edge out of it for free.
      this.sunBloom = sunSprite(sunGlareTexture(), '#ffe6bc', 0.34, ORDER_BLOOM);

      var field = buildCloudField();
      this.cloudMesh = field.mesh;
      this.cloudMat = field.material;
      this.cloudMesh.renderOrder = ORDER_CLOUD;
      group.add(this.cloudMesh);

      this.el.setObject3D('sky', group);
      this.group = group;

      // ── The pool of daylight on the floor ────────────────────────────────
      // Its own object3D, not in `group`: the floor is a different place in the
      // scene and this has to sit a hair above it, so keeping them separate
      // means the sky group can be hidden without a stray lit patch surviving.
      this.poolTex = poolTexture();
      var poolMat = new THREE.MeshBasicMaterial({
        map: this.poolTex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      });
      var pool = new THREE.Mesh(new THREE.CircleGeometry(POOL_RADIUS, 48), poolMat);
      pool.rotation.x = -Math.PI / 2;
      // Above dusk-floor (-0.02) and dusk-rug (+0.002), both of which are
      // opaque and therefore already drawn by the time this blends over them.
      pool.position.set(-SUN_DIR.x * POOL_OFFSET, 0.008, -SUN_DIR.z * POOL_OFFSET);
      pool.visible = false;
      this.poolMesh = pool;
      this.poolMat = poolMat;
      this.el.setObject3D('pool', pool);

      if (window.VR_DEBUG) {
        console.log('[vr] skylight: ' + field.quads + ' cloud quads, 1 draw call');
      }
    },

    // ── The toggle ──────────────────────────────────────────────────────────
    setOpen: function (open) {
      this.build();
      var to = open ? 1 : 0;
      if (this.target === to && !this.tweening) { this.applyState(to); return; }
      this.target = to;
      if (reducedMotion) { this.jumpTo(to); return; }
      this.tweening = true;
      this.from = this.aperture;
      this.elapsed = 0;
      this.dur = open ? OPEN_MS : CLOSE_MS;
      this.refreshControls();
      this.el.emit('skychange', { open: open }, false);
    },

    jumpTo: function (v) {
      this.build();
      this.target = v;
      this.tweening = false;
      this.applyState(v);
      this.refreshControls();
      this.el.emit('skychange', { open: v > 0.5 }, false);
    },

    tick: function (time, delta) {
      if (this.tweening) {
        this.elapsed += (delta || 16);
        var t = Math.min(1, this.elapsed / this.dur);
        // easeInOutCubic — the iris leaves and arrives slowly, which is what
        // makes a 60 m hole in a ceiling read as deliberate rather than as a
        // glitch.
        var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.applyState(lerp(this.from, this.target, e));
        if (t >= 1) this.tweening = false;
      }

      if (this.cloudMat && this.group && this.group.visible) {
        if (!reducedMotion) this.cloudMat.uniforms.uTime.value = time / 1000;
        this.syncSunView();
      }

      // ── Self-healing ─────────────────────────────────────────────────────
      // project-room.js resets the ambient and the whole key rack to their
      // authored values when a room closes (resetLights / restoreKeyRack), and
      // it has every right to — it has no idea the roof is open. Rather than
      // teach it about this file, re-assert the daylight rig twice a second
      // while open. Cheap, and it also covers anything else that touches the
      // lights.
      if (this.aperture > 0.99 && time - this._heal > 500) {
        this._heal = time;
        this.applyLights(1);
      }
    },

    // The cloud shader lights each puff against a fake hemisphere normal built
    // in VIEW space, so it needs the sun's direction in that space — which
    // changes every time the head moves. Split out of tick() so a capture
    // harness can call it after posing the camera; a frozen loop means tick
    // never runs and every puff would be lit for wherever the camera was when
    // the sky opened.
    syncSunView: function () {
      var cam = this.el.sceneEl.camera;
      if (!cam || !this.cloudMat) return;
      this.cloudMat.uniforms.uSunView.value.copy(SUN_DIR).transformDirection(cam.matrixWorldInverse);
    },

    applyState: function (a) {
      this.aperture = a;

      // Resolved per call until it resolves, then cached: dome.js's component
      // may not have initialised when this one does, and a cached null would
      // silently disable the cut for the whole session (the same trap
      // project-room.js documents for the rug).
      if (!this._duskSky) {
        var skyEl = document.querySelector('[dusk-sky]');
        var c = skyEl && skyEl.components && skyEl.components['dusk-sky'];
        if (c && c.setAperture) this._duskSky = c;
      }
      if (this._duskSky) this._duskSky.setAperture(a);

      if (this.group) this.group.visible = a > 0.001;
      if (this.poolMesh) {
        this.poolMesh.visible = a > 0.001;
        this.poolMat.opacity = POOL_PEAK * a;
      }
      this.applyLights(a);
    },

    // ── The light now comes from the hole ───────────────────────────────────
    applyLights: function (a) {
      var sunEl = document.querySelector('#sunLight');
      var ambient = document.querySelector('#ambientLight');
      var sys = this.el.sceneEl.systems && this.el.sceneEl.systems['vr-key-light'];

      if (!this._ambientBase || !this._rackBase) this.captureBase();

      if (ambient && this._ambientBase) {
        ambient.setAttribute('light', {
          color: mixHex(this._ambientBase.color, AMBIENT_OPEN.color, a),
          intensity: lerp(this._ambientBase.intensity, AMBIENT_OPEN.intensity, a)
        });
      }

      if (this._rackBase) {
        this._rackBase.forEach(function (rec) {
          rec.el.setAttribute('light', 'intensity', lerp(rec.intensity, rec.intensity * RACK_DIM, a));
        });
      }

      if (sunEl) sunEl.setAttribute('light', 'intensity', SUN_LIGHT_INTENSITY * a);

      // Reached for through the public object3D graph rather than by adding an
      // API to glass-material for one caller. The housings are unnamed meshes
      // and sprites on that entity; `isSprite` picks out the glows and skips
      // the core beads, and the authored opacity is snapshotted on first touch
      // rather than assumed to be 1.
      var housingEl = document.querySelector('[light-rack-housings]');
      if (housingEl && housingEl.object3D) {
        if (!this._housings) {
          var list = [];
          housingEl.object3D.traverse(function (o) {
            if (o.material) list.push({ o: o, opacity: o.material.opacity });
          });
          this._housings = list.length ? list : null;
        }
        if (this._housings) {
          this._housings.forEach(function (h) {
            var op = lerp(h.opacity, h.opacity * HOUSING_DIM, a);
            h.o.material.opacity = op;
            // The core beads are authored OPAQUE, so opacity does nothing until
            // the material blends. Flipped back off at rest rather than left on
            // for the session: an opaque mesh sitting in the transparent pass
            // is one more thing subject to §3.6's scene-graph paint order for
            // no reason, and while the roof is shut these are opaque beads.
            h.o.material.transparent = op < 0.999;
          });
        }
      }

      // The rack's dimmed intensities only reach the cards through the shader's
      // light array, which syncRack() rebuilds from the DOM.
      if (sys && sys.syncRack) sys.syncRack();

      // The cards' own daylight. `sharedLightUniforms()` hands back the live
      // uniform objects by reference and is documented for exactly this —
      // focus-stage.js writes uEmberFall the same way. uEmberFall itself is
      // left alone: focus-stage saves and restores that one, and two owners of
      // a single value is how it would end up stuck at the wrong number.
      if (window.VRGlass && VRGlass.sharedLightUniforms) {
        var L = VRGlass.sharedLightUniforms();
        if (L && L.uEmber) {
          if (!this._emberBase) {
            var e = L.uEmber.value;
            this._emberBase = [e.x, e.y, e.z];
          }
          var b = this._emberBase;
          L.uEmber.value.set(
            lerp(b[0], EMBER_DAY[0], a),
            lerp(b[1], EMBER_DAY[1], a),
            lerp(b[2], EMBER_DAY[2], a)
          );
        }
      }
    },

    remove: function () {
      // Guide §3.17: removeObject3D unlinks, it does not free.
      if (this.cloudMesh) {
        this.cloudMesh.geometry.dispose();
        this.cloudMat.dispose();
      }
      if (this.skyMesh) {
        this.skyMesh.geometry.dispose();
        this.skyMesh.material.dispose();
      }
      if (this.skyTex) this.skyTex.dispose();
      if (this.poolMesh) {
        this.poolMesh.geometry.dispose();
        this.poolMat.dispose();
      }
      if (this.poolTex) this.poolTex.dispose();
      if (this.sunGlow) this.sunGlow.material.dispose();
      if (this.sunCore) this.sunCore.material.dispose();
      if (this.sunBloom) this.sunBloom.material.dispose();
      if (this.sceneBtn && this.sceneBtn.parentNode) {
        this.sceneBtn.parentNode.removeChild(this.sceneBtn);
      }
      this.el.removeObject3D('sky');
      this.el.removeObject3D('pool');
      if (window.VRSkylight) delete window.VRSkylight;
    }
  });
})();
