/* ═══ floor-lever.js ═══
   A railway ground-frame lever, set into the floor, that opens and closes the
   roof (skylight.js). Replaces the "Open roof" ghost pill under the bio card.

   Sebastian, 2026-09-20, with a photograph of a Victorian ground frame:
   "instead of 'open roof' can we design a switch like the one in the image,
   which will sit in the floor — sorta between my experience and the bio — and
   it will operate the open roof function. I only want one lever, and I want
   the handle part to change colour slowly as the arm moves from the open to
   close position."

   ── The design, chosen from rendered options (2026-09-20) ──
   Three were rendered: the full cast frame standing on timber bearers, this
   one, and a dome-native brass instrument. He picked **set into the floor**,
   **square to the viewer**, and **a fast throw with the roof following**.

   Set into the floor is taken literally, which is the whole reason this file
   touches dome.js: the machinery lives in a PIT below floor level and only
   the arm and the toothed quadrant come up through a machined slot. An opaque
   floor plane hides everything under it, so there is no way to fake that — the
   floor disc itself needs an opening, which is what VRDome.setFloorHoles is
   for. Nothing else in the scene uses it.

   ── Every tunable lives in CFG ──
   Same arrangement as exit-button.js, and for the same reason: the bench
   (vr/_dev-lever.html) tunes the REAL component rather than a lookalike, so
   what you dial in is what ships. CFG is read at build() time, never captured
   in a const.

   ── Geometry conventions ──
   Local origin sits at FLOOR LEVEL, centred on the pit. +Z faces the visitor;
   the lever swings in the YZ plane, so a positive rotation about X tips the
   handle toward you — "pull to open". The pivot is below y=0 (CFG.pivotY is
   negative) and everything above the floor is what the visitor sees.
*/
(function () {
  'use strict';

  var CFG = {
    // ── Travel ────────────────────────────────────────────────────────────
    // Degrees from vertical, positive = toward the visitor. Closed stands very
    // nearly upright and open is thrown right down at your feet: that is a
    // 0.92 m → 0.45 m drop in the crown, which is what keeps the state legible
    // from across the room even though the frame faces you square-on and the
    // travel itself is foreshortened.
    closedDeg: -5,
    openDeg: 42,

    // ── The pit ───────────────────────────────────────────────────────────
    pitW: 0.40, pitD: 0.62, pitDepth: 0.38,   // must exceed hole by ~2x the wall margin
    holeW: 0.34, holeD: 0.56, holeR: 0.04,   // the opening cut in dusk-floor (and the rug)
    rimInnerW: 0.30, rimInnerD: 0.52,        // machined plate around the mouth
    rimOuterW: 0.46, rimOuterD: 0.68,
    rimThick: 0.014,

    // ── The lever ─────────────────────────────────────────────────────────
    pivotY: -0.18,       // below the floor — this is what makes the slot long
    armLen: 1.10,        // pivot to the crown of the handle
    barW: 0.062,         // the forged bar's width across the frame
    handleLen: 0.34,     // the coloured part
    handleR: 0.034,
    // The grip swells to this multiple of handleR a little below its middle
    // and narrows again toward the crown, instead of running as a flat blade.
    // 1 gives back the straight forged bar of the reference photograph.
    handleSwell: 1.4,

    // ── The quadrant ──────────────────────────────────────────────────────
    // Deliberately tall enough to break the floor line: a toothed crescent
    // standing 0.12 m proud of the slot is the single most recognisable part
    // of the reference photograph, and burying it in the pit throws that away.
    rackOuter: 0.30, rackInner: 0.235, rackTeeth: 13,
    rackThick: 0.028, rackX: 0.055,          // offset sideways, clear of the bar

    // ── Frame ─────────────────────────────────────────────────────────────
    cheekHalfSpan: 0.082, cheekThick: 0.020, cheekHalfZ: 0.185,
    // The St Andrew's cross let into the standards. OFF since 2026-09-28: it
    // was rendered both ways, from the arrival spot and from the side through
    // a slot widened to 0.42 m for the purpose, and the two were
    // indistinguishable. The standards run fore-and-aft and stop 13 cm below
    // the floor, so they are dark iron seen edge-on in a dark pit from every
    // place a visitor can stand. true brings it back.
    brace: false,

    // ── Colours ───────────────────────────────────────────────────────────
    ironColor: '#2c2a26',      // japanned cast iron, warm near-black
    steelColor: '#8f9498',     // pivot boss, ferrule, bolts
    plateColor: '#15161a',     // the machined rim — cool, so the warm rack can't gild it
    pitColor: '#16171a',       // inside the pit — cooled, it read sandy under the lamp
    brassColor: '#9a7434',

    // The handle ramp, closed → open. Three stops rather than two on purpose:
    // a straight ember→sky lerp passes through a dead tan-grey at halfway,
    // where a pale warm middle reads as the light actually changing.
    handleRamp: ['#b8863b', '#e6dccb', '#9dc0e4'],
    handleGlow: 0.16,          // emissive, so it is findable in a dark room

    // ── Legibility in a near-black room ───────────────────────────────────
    floorY: -0.02,             // dusk-floor's own drop (dome.js); local y=0 = floor
    pool: true,                // soft pool of light on the floor around it
    poolRadius: 0.62,
    poolStrength: 0.26,
    pitLight: 1.2,            // small warm point light down in the pit (was 1.7: washed the walls)
    label: 'ROOF',             // cast into the brass plate on the rim
    labelNumber: '1',          // railway levers are numbered; '' to drop it
    showLabel: true,

    // ── The pull ──────────────────────────────────────────────────────────
    // Hand travel along the crown's arc is multiplied by pullGain, so a
    // 0.45 m pull throws the full 47° rather than the ~0.9 m of arc a real
    // 1.1 m lever sweeps. Desktop and phone drag DOWN the screen instead,
    // and dragPx is a full throw as a fraction of the canvas height.
    pullGain: 2.0,
    dragPx: 0.32,
    tapMax: 0.06,              // throw moved less than this = a tap, not a pull
    settleMs: 380,             // release → nearest end
    hoverGlow: 0.34            // handle emissive while a ray is on it
  };

  // ── Materials ───────────────────────────────────────────────────────────
  // Deliberately OPAQUE and FrontSide (§3.6: everything transparent in this
  // scene fights over draw order, and machinery has no business in that pass).
  // MeshStandardMaterial so the key-light rack actually reaches it — §3.8.
  function metal(hex, rough, metalness, emissive, emissiveHex) {
    if (document.body.classList.contains('accessible')) {
      return new THREE.MeshBasicMaterial({ color: hex });
    }
    var m = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: rough != null ? rough : 0.48,
      metalness: metalness != null ? metalness : 0.62
    });
    if (emissive) {
      m.emissive = new THREE.Color(emissiveHex || hex);
      m.emissiveIntensity = emissive;
    }
    return m;
  }

  // ── Shape → geometry, in the lever's own plane ──────────────────────────
  // A THREE.Shape lives in XY and extrudes along +Z. Every profile here is
  // drawn in the (z, y) plane and given thickness in x, so the geometry is
  // rotated -90° about Y: (sx, sy, sz) → (-sz, sy, sx), i.e. shape-x becomes
  // world z and the extrusion depth becomes world x.
  function extrudeZY(shape, thickness, bevel) {
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: bevel !== false,
      bevelThickness: 0.0035, bevelSize: 0.0035, bevelSegments: 2, curveSegments: 20
    });
    geo.rotateY(-Math.PI / 2);
    geo.translate(thickness / 2, 0, 0);
    return geo;
  }

  function roundedRect(w, d, r) {
    var hw = w / 2, hd = d / 2, s = new THREE.Path();
    r = Math.min(r, hw, hd);
    s.moveTo(-hw + r, -hd);
    s.lineTo(hw - r, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + r);
    s.lineTo(hw, hd - r);  s.quadraticCurveTo(hw, hd, hw - r, hd);
    s.lineTo(-hw + r, hd); s.quadraticCurveTo(-hw, hd, -hw, hd - r);
    s.lineTo(-hw, -hd + r); s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    return s;
  }

  // The cast cheek that carries the pivot: a standard with a St Andrew's cross
  // let into it, which is the silhouette that makes the reference photograph
  // read as a ground frame. It lives down in the pit, seen from above.
  function cheekShape() {
    var zb = CFG.cheekHalfZ, zt = 0.072;
    var yBot = -CFG.pitDepth + 0.02;               // sits on the pit floor
    var yTop = CFG.pivotY + 0.048;
    var s = new THREE.Shape();
    s.moveTo(-zb, yBot);
    s.lineTo(zb, yBot);
    s.lineTo(zb, yBot + 0.035);
    s.lineTo(zt + 0.012, yTop - 0.085);
    s.lineTo(zt, yTop - 0.045);
    s.absarc(0, yTop - 0.045, zt, 0, Math.PI, false);
    s.lineTo(-zt - 0.012, yTop - 0.085);
    s.lineTo(-zb, yBot + 0.035);
    s.lineTo(-zb, yBot);

    // Four triangular voids leave a cross. Each is one edge of the inner quad
    // plus its centre, INSET by a constant so the rim and both ribs come out
    // the same thickness. (Shrinking each triangle toward its own centroid is
    // not an inset: it leaves the ribs fat where they cross and the voids
    // reading as four darts. That was the first version.)
    var y0 = yBot + 0.038, y1 = yTop - 0.095;
    if (!CFG.brace || y1 - y0 < 0.06) return s;  // plain standard, or too shallow to brace
    var q = [[-zb + 0.030, y0], [zb - 0.030, y0], [zt - 0.002, y1], [-zt + 0.002, y1]];
    var cx = 0, cy = (y0 + y1) / 2, rib = 0.012;
    function insetTri(tri, d) {
      var out = [];
      for (var v = 0; v < 3; v++) {
        var P = tri[v], A = tri[(v + 2) % 3], B = tri[(v + 1) % 3];
        var ux = A[0] - P[0], uy = A[1] - P[1], ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
        var vx = B[0] - P[0], vy = B[1] - P[1], vl = Math.hypot(vx, vy); vx /= vl; vy /= vl;
        var bx = ux + vx, by = uy + vy, bl = Math.hypot(bx, by);
        if (bl < 1e-6) { out.push(P); continue; }
        bx /= bl; by /= bl;
        var sinHalf = Math.max(0.12, Math.sqrt(Math.max(0, (1 - (ux * vx + uy * vy)) / 2)));
        out.push([P[0] + bx * d / sinHalf, P[1] + by * d / sinHalf]);
      }
      return out;
    }
    for (var i = 0; i < 4; i++) {
      var tri = insetTri([q[i], q[(i + 1) % 4], [cx, cy]], rib);
      var h = new THREE.Path();
      h.moveTo(tri[0][0], tri[0][1]);
      h.lineTo(tri[1][0], tri[1][1]);
      h.lineTo(tri[2][0], tri[2][1]);
      h.closePath();
      s.holes.push(h);
    }
    return s;
  }

  // The quadrant rack. Angles are measured from vertical, positive toward the
  // visitor, so the arc covers the travel with a little margin at each end.
  function rackShape() {
    var a0 = THREE.MathUtils.degToRad(CFG.closedDeg - 14);
    var a1 = THREE.MathUtils.degToRad(CFG.openDeg + 10);
    var Ro = CFG.rackOuter, Ri = CFG.rackInner, d = 0.020;
    var s = new THREE.Shape();
    function at(r, a) { return [r * Math.sin(a), CFG.pivotY + r * Math.cos(a)]; }
    var p = at(Ri, a0); s.moveTo(p[0], p[1]);
    var STEPS = 44, i;
    for (i = 1; i <= STEPS; i++) { p = at(Ri, a0 + (a1 - a0) * i / STEPS); s.lineTo(p[0], p[1]); }
    var n = CFG.rackTeeth;
    for (i = 0; i < n; i++) {
      var s0 = a1 - (a1 - a0) * i / n, s1 = a1 - (a1 - a0) * (i + 1) / n;
      var land = s0 + (s1 - s0) * 0.40, rise = s0 + (s1 - s0) * 0.72;
      p = at(Ro, s0); s.lineTo(p[0], p[1]);
      p = at(Ro, land); s.lineTo(p[0], p[1]);
      p = at(Ro - d, land); s.lineTo(p[0], p[1]);
      p = at(Ro - d, rise); s.lineTo(p[0], p[1]);
      p = at(Ro, rise); s.lineTo(p[0], p[1]);
    }
    p = at(Ro, a0); s.lineTo(p[0], p[1]);
    s.closePath();
    return s;
  }

  // A soft pool of light on the floor. The floor is #0c0b0a unlit, so without
  // this the ironwork is a silhouette in a black room; with it the lever reads
  // as a thing standing in its own light. Additive, depthWrite off.
  function poolMesh() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.34)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    var mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: CFG.poolStrength
    });
    var mesh = new THREE.Mesh(new THREE.CircleGeometry(CFG.poolRadius, 40), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.006;
    mesh.renderOrder = -1;
    return mesh;
  }

  // ── Colour ramp ─────────────────────────────────────────────────────────
  // t = 0 closed, 1 open. Piecewise through CFG.handleRamp.
  function rampColor(t) {
    var stops = CFG.handleRamp, n = stops.length - 1;
    var x = Math.max(0, Math.min(1, t)) * n;
    var i = Math.min(n - 1, Math.floor(x));
    var a = new THREE.Color(stops[i]), b = new THREE.Color(stops[i + 1]);
    return a.lerp(b, x - i);
  }

  // ── The build ───────────────────────────────────────────────────────────
  function build() {
    var group = new THREE.Group();
    group.position.y = CFG.floorY;
    var handleMats = [], geos = [], mats = [];
    function keep(g, m) { if (g) geos.push(g); if (m) mats.push(m); return g; }
    function add(geo, mat, x, y, z) {
      keep(geo, mat);
      var m = new THREE.Mesh(geo, mat);
      if (x != null) m.position.set(x, y, z);
      group.add(m);
      return m;
    }

    var ironMat  = metal(CFG.ironColor, 0.52, 0.55);
    var steelMat = metal(CFG.steelColor, 0.28, 0.88);

    // ── The pit ───────────────────────────────────────────────────────────
    // One box rendered from the INSIDE (BackSide): front faces are culled, so
    // you look straight down through where the lid would be and see the far
    // wall and the floor of it. Its walls sit OUTSIDE the floor opening, so
    // the seam between hole and pit is never visible at a grazing angle.
    var pitMat = metal(CFG.pitColor, 0.92, 0.10);
    pitMat.side = THREE.BackSide;
    // The pit's mouth rises just ABOVE the floor plane and is hidden under the
    // rim plate. Stopping it below the floor instead leaves a slot of open sky
    // between the two, which reads as a pale halo around the opening at any
    // grazing angle — the floor is a plane with a hole, not a solid.
    var pitTop = 0.008;
    add(new THREE.BoxGeometry(CFG.pitW, CFG.pitDepth + pitTop, CFG.pitD), pitMat,
        0, (pitTop - CFG.pitDepth) / 2, 0);
    // A separate, slightly lighter floor to the pit: one uniformly shaded box
    // interior reads as a shallow tray no matter how deep it is, because
    // nothing in it falls off with distance. The contrast between wall and
    // bottom is what says "hole".
    add(new THREE.PlaneGeometry(CFG.pitW - 0.004, CFG.pitD - 0.004),
        metal('#0a0908', 0.95, 0.05), 0, -CFG.pitDepth + 0.002, 0)
      .rotation.x = -Math.PI / 2;

    // ── The machined rim around the mouth ─────────────────────────────────
    var rimShape = roundedRect(CFG.rimOuterW, CFG.rimOuterD, 0.07);
    var rimHole = roundedRect(CFG.rimInnerW, CFG.rimInnerD, CFG.holeR);
    var rimS = new THREE.Shape(rimShape.getPoints(48));
    rimS.holes.push(new THREE.Path(rimHole.getPoints(48)));
    var rimGeo = new THREE.ExtrudeGeometry(rimS, {
      depth: CFG.rimThick, bevelEnabled: true, bevelThickness: 0.0035,
      bevelSize: 0.0035, bevelSegments: 2, curveSegments: 20
    });
    rimGeo.rotateX(-Math.PI / 2);
    add(rimGeo, metal(CFG.plateColor, 0.84, 0.12), 0, CFG.rimThick - 0.004, 0);

    // Countersunk bolts around the rim.
    var boltGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.008, 6);
    var bx = (CFG.rimOuterW + CFG.rimInnerW) / 4, bz = (CFG.rimOuterD + CFG.rimInnerD) / 4;
    [[-bx, -bz], [bx, -bz], [-bx, bz], [bx, bz]].forEach(function (b) {
      add(boltGeo, steelMat, b[0], CFG.rimThick, b[1]);
    });

    // ── Standards and quadrant, down in the pit ───────────────────────────
    var cheekGeo = extrudeZY(cheekShape(), CFG.cheekThick);
    add(cheekGeo, ironMat, -CFG.cheekHalfSpan - CFG.cheekThick, 0, 0);
    add(cheekGeo, ironMat, CFG.cheekHalfSpan, 0, 0);

    // The toothed crescent — the one piece of machinery that deliberately
    // breaks the floor line, standing ~0.12 m proud of the slot.
    add(extrudeZY(rackShape(), CFG.rackThick), metal('#1f1d1a', 0.46, 0.68),
        CFG.rackX - CFG.rackThick / 2, 0, 0);

    var boss = add(new THREE.CylinderGeometry(0.030, 0.030,
      CFG.cheekHalfSpan * 2 + CFG.cheekThick * 2 + 0.02, 20), steelMat, 0, CFG.pivotY, 0);
    boss.rotation.z = Math.PI / 2;

    // ── The arm ───────────────────────────────────────────────────────────
    // A lever arm is a FLAT FORGED BAR, not a rod — that is most of what makes
    // the reference photograph read as a signal lever rather than a joystick.
    // Wide across the frame (x), thin fore-and-aft (z), so it is built as a
    // side profile in the travel plane and extruded sideways, like everything
    // else here.
    var arm = new THREE.Group();
    arm.position.set(0, CFG.pivotY, 0);
    group.add(arm);

    var shankLen = CFG.armLen - CFG.handleLen;
    function barShape(y0, y1, hz0, hz1, roundTop) {
      var sh = new THREE.Shape();
      sh.moveTo(-hz0, y0);
      sh.lineTo(hz0, y0);
      sh.lineTo(hz1, y1 - (roundTop ? hz1 : 0));
      if (roundTop) sh.absarc(0, y1 - hz1, hz1, 0, Math.PI, false);
      else sh.lineTo(-hz1, y1);
      sh.lineTo(-hz0, y0);
      sh.closePath();
      return sh;
    }
    function bar(shape, mat, bevel) {
      // A fatter bevel eats into the depth so the overall width stays barW.
      var b = bevel || 0.0035, depth = CFG.barW - (b - 0.0035) * 2;
      var g = new THREE.ExtrudeGeometry(shape, {
        depth: depth, bevelEnabled: true, bevelThickness: b,
        bevelSize: b, bevelSegments: bevel ? 4 : 2, curveSegments: 16
      });
      g.rotateY(-Math.PI / 2);
      g.translate(depth / 2, 0, 0);
      var m = new THREE.Mesh(keep(g, mat), mat);
      arm.add(m);
      return m;
    }

    bar(barShape(-0.14, shankLen + 0.004, 0.034, 0.021, false), ironMat);

    var ferrule = new THREE.Mesh(
      keep(new THREE.BoxGeometry(CFG.barW + 0.008, 0.020, 0.052), steelMat), steelMat);
    ferrule.position.y = shankLen;
    arm.add(ferrule);

    // ── THE HANDLE — the part that changes colour ─────────────────────────
    var handleMat = metal(CFG.handleRamp[0], 0.38, 0.22, CFG.handleGlow);
    handleMats.push(handleMat);
    keep(null, handleMat);
    // The grip: swells below its middle and narrows toward a round crown. A
    // quadratic's midpoint is ¼P0 + ½C + ¼P2, so the control point that puts
    // the widest part at exactly handleSwell × handleR is 2·rm − ½(r0 + r1).
    function gripShape(y0, y1) {
      var r0 = CFG.handleR * 0.86, r1 = CFG.handleR * 0.82;
      var rm = CFG.handleR * CFG.handleSwell, c = 2 * rm - 0.5 * (r0 + r1);
      var yc = y0 + (y1 - r1 - y0) * 0.45;
      var sh = new THREE.Shape();
      sh.moveTo(-r0, y0);
      sh.lineTo(r0, y0);
      sh.quadraticCurveTo(c, yc, r1, y1 - r1);
      sh.absarc(0, y1 - r1, r1, 0, Math.PI, false);
      sh.quadraticCurveTo(-c, yc, -r0, y0);
      return sh;
    }
    // A fatter bevel than the forged shank, so the grip reads as turned and
    // rounded in the hand rather than as a blade with its corners broken.
    bar(gripShape(shankLen + 0.008, CFG.armLen), handleMat,
        CFG.handleSwell > 1 ? 0.009 : null);

    // ── Catch handle ──────────────────────────────────────────────────────
    // The sprung sub-lever you squeeze to lift the catch out of the rack: the
    // detail that makes this read as a signalman's lever and not a joystick.
    var catchMat = metal('#6f7478', 0.34, 0.85);
    keep(null, catchMat);
    var rodTop = CFG.armLen - 0.055, rodBot = 0.34, zOff = CFG.handleR + 0.008;
    var rod = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(0.0095, 0.0095, rodTop - rodBot, 12), catchMat), catchMat);
    rod.position.set(0, (rodTop + rodBot) / 2, zOff);
    arm.add(rod);
    var link = new THREE.Mesh(keep(new THREE.BoxGeometry(0.014, 0.012, zOff), catchMat), catchMat);
    link.position.set(0, rodTop, zOff / 2);
    arm.add(link);
    var bracket = new THREE.Mesh(
      keep(new THREE.BoxGeometry(0.030, 0.026, zOff + 0.012), ironMat), ironMat);
    bracket.position.set(0, rodBot, zOff / 2 - 0.004);
    arm.add(bracket);
    // …and down the arm to the catch block that drops into the rack's notches.
    var down = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(0.008, 0.008, rodBot - CFG.rackOuter + 0.09, 10), catchMat), catchMat);
    down.position.set(CFG.rackX * 0.5, (rodBot + CFG.rackOuter - 0.09) / 2, 0.012);
    down.rotation.z = -0.09;
    arm.add(down);
    var blockMat = metal('#4a4d50', 0.40, 0.80);
    var block = new THREE.Mesh(
      keep(new THREE.BoxGeometry(0.042, 0.040, 0.032), blockMat), blockMat);
    block.position.set(CFG.rackX, CFG.rackOuter - 0.046, 0.008);
    arm.add(block);

    // ── What a ray can take hold of ───────────────────────────────────────
    // The arm alone is a 6 cm bar, which is a hard thing to land a hand ray
    // on from a metre and a half. This invisible sleeve is what the pointer
    // actually finds: fat around the grip, following the arm as it swings.
    // Invisible by writing nothing, NOT by visible:false — the scene's own
    // ray tests skip hidden objects (xr-select walks visibility), so a hidden
    // sleeve would be ungrabbable in a headset and grabbable on a desktop.
    var hitMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, colorWrite: false
    });
    keep(null, hitMat);
    var hitLen = CFG.armLen + 0.05 - 0.22;
    var hit = new THREE.Mesh(keep(new THREE.BoxGeometry(0.16, hitLen, 0.14), hitMat), hitMat);
    hit.position.y = 0.22 + hitLen / 2;
    arm.add(hit);

    // ── Brass plate ───────────────────────────────────────────────────────
    // A cast plate states what the machine is FOR. It deliberately does not
    // state the state — the arm's own position does that, which is the whole
    // argument for a lever over a pill that has to relabel itself.
    var plateEl = null;
    if (CFG.showLabel) {
      var pm = metal(CFG.brassColor, 0.36, 0.78, 0.12);
      var pMesh = new THREE.Mesh(keep(new THREE.BoxGeometry(0.175, 0.010, 0.056), pm), pm);
      pMesh.position.set(0, CFG.rimThick + 0.002, (CFG.rimOuterD + CFG.rimInnerD) / 4);
      group.add(pMesh);
      plateEl = pMesh;
    }

    var pool = CFG.pool ? poolMesh() : null;
    if (pool) group.add(pool);

    // Only the arm takes a ray. The pool is a 1.2 m disc and the pit a box
    // seen from inside: left raycastable, either one turns a patch of floor
    // into a handle, and the pit would catch rays aimed at the lever itself.
    var noRay = function () {};
    group.children.forEach(function (o) {
      if (o !== arm) o.traverse(function (m) { m.raycast = noRay; });
    });

    return { group: group, arm: arm, handleMats: handleMats, pool: pool,
             plate: plateEl, geos: geos, mats: mats };
  }

  // ── The component ───────────────────────────────────────────────────────
  AFRAME.registerComponent('floor-lever', {
    schema: {
      throw: { type: 'number', default: 0 },      // 0 closed → 1 open
      cutFloor: { type: 'boolean', default: true } // false on benches with no dusk-floor
    },

    init: function () {
      var self = this;
      this.rebuild();
      // The opening is cut in WORLD space, so it can only be placed once this
      // entity's own transform is real. On init it is still identity — the
      // first version cut a neat 0.34 x 0.56 hole at the middle of the room
      // and left the pit sealed under an intact floor two metres away, which
      // rendered as a 2 cm tray (the top of the pit box poking through) and
      // looked like a lighting problem for a good half hour.
      if (this.el.sceneEl.hasLoaded) setTimeout(function () { self.cutFloor(); }, 0);
      else this.el.sceneEl.addEventListener('loaded', function () { self.cutFloor(); }, { once: true });
      this._shown = true;
      this.bindInput();
    },

    // ══ Taking hold of it ══════════════════════════════════════════════════
    // One pull, three kinds of hand:
    //
    //   • IN A HEADSET — Quest controllers, Quest hands and a Vision Pro pinch
    //     alike — the press is the SESSION's own selectstart/squeezestart,
    //     tested against the same ray and the same targets xr-select.js uses
    //     for its clicks, so the lever grabs exactly when a click would have
    //     landed on it. From then on it is the HAND's position, read from the
    //     input source's pose every frame, that drives the arm: pull toward
    //     yourself and the handle comes with you. This cannot ride A-Frame's
    //     mousedown: on a Vision Pro the pinch is a transient input source
    //     that A-Frame never tracks (guide §3.13), so there would be nothing
    //     to follow once it had started.
    //   • ON A DESKTOP OR PHONE, press on it and drag DOWN the screen, which is
    //     what "toward you" looks like on a flat display. look-controls is
    //     suspended for the drag, or the same drag would also spin the view.
    //   • A TAP — any press that barely moves it — throws it all the way,
    //     which is also what a quick Vision Pro pinch is.
    //
    // The roof answers at the END STOP, not on release: the moment the handle
    // bottoms out the roof starts to move, with a pulse in the controller, so
    // it is the pull that does it and letting go only settles the arm. A
    // release short of the stop settles to the nearer end, and if that is the
    // end it started from, nothing happened — you let go halfway.
    //
    // A-Frame's cursor and xr-select both still emit `click` on the lever at
    // the end of a press. Those are ignored for a moment after a press this
    // file handled itself, or every pull would be followed by a second throw.
    bindInput: function () {
      var self = this;
      var scene = this.el.sceneEl;
      this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3();
      this._m = new THREE.Matrix4();

      this._onXRStart = function (evt) { self.xrPress(evt); };
      this._onXREnd = function (evt) {
        if (self._drag && self._drag.src === evt.inputSource) self.release();
      };
      this._onEnterVR = function () {
        var session = scene.renderer && scene.renderer.xr && scene.renderer.xr.getSession();
        if (!session) return;
        self._session = session;
        ['selectstart', 'squeezestart'].forEach(function (t) { session.addEventListener(t, self._onXRStart); });
        ['selectend', 'squeezeend'].forEach(function (t) { session.addEventListener(t, self._onXREnd); });
      };
      this._onExitVR = function () {
        var session = self._session;
        if (session) {
          ['selectstart', 'squeezestart'].forEach(function (t) { session.removeEventListener(t, self._onXRStart); });
          ['selectend', 'squeezeend'].forEach(function (t) { session.removeEventListener(t, self._onXREnd); });
        }
        self._session = null;
        if (self._drag) self.release();
      };
      scene.addEventListener('enter-vr', this._onEnterVR);
      scene.addEventListener('exit-vr', this._onExitVR);

      // Flat screens. mousedown here is A-Frame's cursor event (the mouse
      // cursor is rayOrigin: mouse, and it synthesises this from touches too);
      // the movement is read from the window, so a drag that leaves the lever
      // keeps working.
      this._onDown = function (evt) {
        if (scene.is('vr-mode') || self._drag) return;
        var d = evt.detail || {};
        var cursor = d.cursorEl && d.cursorEl.components && d.cursorEl.components.cursor;
        if (!cursor || cursor.data.rayOrigin !== 'mouse') return;
        var me = d.mouseEvent || d.touchEvent;
        self.grab({ kind: 'screen', y: self.clientY(me) });
        self.suspendLook(true);
      };
      this._onMove = function (e) {
        var g = self._drag;
        if (!g || g.kind !== 'screen') return;
        var y = self.clientY(e);
        if (y == null || g.y == null) { g.y = y; return; }
        var h = (scene.canvas && scene.canvas.clientHeight) || window.innerHeight || 800;
        self.follow(g.t0 + (y - g.y) / (h * CFG.dragPx));
        if (e.cancelable && e.type === 'touchmove') e.preventDefault();
      };
      this._onUp = function () {
        if (self._drag && self._drag.kind === 'screen') self.release();
      };
      this.el.addEventListener('mousedown', this._onDown);
      window.addEventListener('mousemove', this._onMove);
      window.addEventListener('touchmove', this._onMove, { passive: false });
      window.addEventListener('mouseup', this._onUp);
      window.addEventListener('touchend', this._onUp);
      window.addEventListener('touchcancel', this._onUp);

      this._onClick = function () {
        if (self._drag || performance.now() - (self._handledAt || -1e9) < 700) return;
        self.flip();
      };
      this.el.addEventListener('click', this._onClick);

      // Hover: the handle brightens while a ray is on it. Headsets without
      // hover (a Vision Pro) simply never see this — press is their first
      // feedback, the same as every other control in the scene.
      this._onEnter = function () { self._hover = true; self.applyGlow(); };
      this._onLeave = function () { self._hover = false; self.applyGlow(); };
      this.el.addEventListener('mouseenter', this._onEnter);
      this.el.addEventListener('mouseleave', this._onLeave);

      // Kept in step with the roof when something ELSE moves it — the HUD's
      // pill, or ?sky=1 landing with it already open.
      this._onSky = function (evt) {
        var open = !!(evt.detail && evt.detail.open);
        if (!self._drag && self._goal !== (open ? 1 : 0)) self.throwTo(open ? 1 : 0);
      };
      var sky = document.querySelector('[open-sky]');
      if (sky) sky.addEventListener('skychange', this._onSky);
      this._skyEl = sky;
      var sync = function () {
        if (window.VRSkylight && VRSkylight.isOpen() && self._t < 0.5) self.throwTo(1, 0);
      };
      if (scene.hasLoaded) setTimeout(sync, 0); else scene.addEventListener('loaded', sync, { once: true });
    },

    unbindInput: function () {
      if (!this._onDown) return;
      var scene = this.el.sceneEl;
      this._onExitVR();
      scene.removeEventListener('enter-vr', this._onEnterVR);
      scene.removeEventListener('exit-vr', this._onExitVR);
      this.el.removeEventListener('mousedown', this._onDown);
      window.removeEventListener('mousemove', this._onMove);
      window.removeEventListener('touchmove', this._onMove);
      window.removeEventListener('mouseup', this._onUp);
      window.removeEventListener('touchend', this._onUp);
      window.removeEventListener('touchcancel', this._onUp);
      this.el.removeEventListener('click', this._onClick);
      this.el.removeEventListener('mouseenter', this._onEnter);
      this.el.removeEventListener('mouseleave', this._onLeave);
      if (this._skyEl) this._skyEl.removeEventListener('skychange', this._onSky);
      this._onDown = null;
    },

    clientY: function (e) {
      if (!e) return null;
      var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      return t ? t.clientY : (e.clientY != null ? e.clientY : null);
    },

    // Same move carousel-drag.js makes: on a flat screen look-controls turns a
    // drag into a look, so it is paused for the pull. Never inside a session,
    // where look-controls IS the head.
    suspendLook: function (on) {
      if (this.el.sceneEl.is('vr-mode')) return;
      var head = document.querySelector('#head');
      if (!head || head.getAttribute('look-controls') == null) return;
      head.setAttribute('look-controls', 'enabled', !on);
    },

    // A headset press. Resolved through xr-select's own ray and target list,
    // so "the ray was on the lever" means what it means for every click.
    xrPress: function (evt) {
      if (this._drag || !this._shown) return;
      var xs = this.el.sceneEl.components['xr-select'];
      if (!xs || !xs.rayFrom(evt.inputSource, evt.frame)) return;
      var hits = xs.raycaster.intersectObjects(xs.targets(), true);
      var first = null;
      for (var i = 0; i < hits.length && !first; i++) {
        for (var o = hits[i].object; o; o = o.parent) { if (o.el) { first = o.el; break; } }
      }
      if (first !== this.el) return;
      var pos = this.handPos(evt.inputSource, evt.frame);
      if (!pos) return;
      this.grab({ kind: 'xr', src: evt.inputSource, p0: pos.clone() });
    },

    // Where the hand is, in THIS entity's local space. The grip space is the
    // hand itself; a Vision Pro transient pointer may have none, and its ray
    // space then carries the hand's motion instead. Same parent correction as
    // xr-select.rayFrom — the pose is relative to the camera's parent (the
    // rig, which walking moves), not to the world.
    handPos: function (src, frame) {
      var scene = this.el.sceneEl;
      var ref = scene.renderer.xr.getReferenceSpace();
      if (!frame || !ref || !src) return null;
      var pose = (src.gripSpace && frame.getPose(src.gripSpace, ref)) ||
                 frame.getPose(src.targetRaySpace, ref);
      if (!pose) return null;
      this._m.fromArray(pose.transform.matrix);
      var parent = scene.camera && scene.camera.parent;
      if (parent) { parent.updateWorldMatrix(true, false); this._m.premultiply(parent.matrixWorld); }
      this._v1.setFromMatrixPosition(this._m);
      this.el.object3D.updateWorldMatrix(true, false);
      return this.el.object3D.worldToLocal(this._v1);
    },

    grab: function (g) {
      if (this._tween) { this._tween.kill(); this._tween = null; }
      g.t0 = this._t || 0;
      g.start = g.t0;
      g.from = g.t0 < 0.5 ? 0 : 1;      // the end it was resting at
      g.at = performance.now();
      g.moved = 0;
      this._drag = g;
      this._handledAt = g.at;
      this.applyGlow();
    },

    tick: function () {
      this.trackVisibility();
      var g = this._drag;
      if (!g || g.kind !== 'xr') return;
      var scene = this.el.sceneEl;
      var session = this._session;
      // A transient pointer vanishes with its pinch; if selectend was missed,
      // the source leaving the session is the release.
      if (!session || Array.prototype.indexOf.call(session.inputSources, g.src) < 0) { this.release(); return; }
      var p = this.handPos(g.src, scene.frame);
      if (!p) return;
      // Hand displacement projected onto the direction the crown moves at the
      // angle it was grabbed at — toward you and down — so pulling back
      // brings it with you, and lifting or pushing sends it home.
      var th = THREE.MathUtils.degToRad(CFG.closedDeg + (CFG.openDeg - CFG.closedDeg) * g.t0);
      var dz = p.z - g.p0.z, dy = p.y - g.p0.y;
      var arc = dz * Math.cos(th) - dy * Math.sin(th);
      var dDeg = THREE.MathUtils.radToDeg(arc * CFG.pullGain / CFG.armLen);
      this.follow(g.t0 + dDeg / (CFG.openDeg - CFG.closedDeg));
    },

    // The held arm goes where the hand puts it. Reaching the far stop is what
    // throws the roof.
    follow: function (t) {
      var g = this._drag;
      t = Math.max(0, Math.min(1, t));
      g.moved = Math.max(g.moved, Math.abs(t - g.start));
      this.applyThrow(t);
      var stop = g.from === 0 ? t >= 0.995 : t <= 0.005;
      if (stop && !g.fired) {
        g.fired = true;
        this.setRoof(g.from === 0);
        this.pulse(g.src, 0.55, 45);
      }
    },

    release: function () {
      var g = this._drag;
      if (!g) return;
      this._drag = null;
      this._handledAt = performance.now();
      if (g.kind === 'screen') this.suspendLook(false);
      this.applyGlow();
      if (g.moved < CFG.tapMax && !g.fired) { this.flip(g.from === 0 ? 1 : 0); return; }
      var end = this._t >= 0.5 ? 1 : 0;
      if (end !== g.from && !g.fired) { this.setRoof(end === 1); this.pulse(g.src, 0.4, 35); }
      else if (end === g.from && g.fired) this.setRoof(end === 1);   // pulled through, then pushed back
      this.throwTo(end, CFG.settleMs);
    },

    // A tap, or a plain click from anything that is not a pull.
    flip: function (to) {
      if (to == null) to = (this._goal != null ? this._goal : (this._t >= 0.5 ? 1 : 0)) ? 0 : 1;
      this.throwTo(to);
      this.setRoof(to === 1);
    },

    setRoof: function (open) {
      if (window.VRSkylight && VRSkylight.isOpen() !== open) {
        this._goal = open ? 1 : 0;       // so our own skychange doesn't re-throw
        VRSkylight[open ? 'open' : 'close']();
      }
    },

    pulse: function (src, intensity, ms) {
      var hap = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
      try { if (hap && hap.pulse) hap.pulse(intensity, ms); } catch (e) { /* no haptics */ }
    },

    applyGlow: function () {
      if (!this.built) return;
      var k = (this._hover || this._drag) ? CFG.hoverGlow : CFG.handleGlow;
      this.built.handleMats.forEach(function (m) { if (m.emissive) m.emissiveIntensity = k; });
    },

    // The hub hides itself by parent visibility when a project room or the
    // reader opens (place.js). A hidden lever must also take its hole with it,
    // or the room gets a slot of open pit in its floor with nothing in it.
    trackVisibility: function () {
      var v = true;
      for (var o = this.el.object3D; o; o = o.parent) { if (o.visible === false) { v = false; break; } }
      if (v === this._shown) return;
      this._shown = v;
      if (v) this.cutFloor(); else { if (this._drag) this.release(); this.uncutFloor(); }
    },

    // Callers that move the lever after load must call this again — there is
    // no transform-changed event to hang it on.
    reposition: function () { this.cutFloor(); },

    rebuild: function () {
      this.teardown();
      var built = build();
      this.built = built;
      this.el.setObject3D('lever', built.group);
      this.applyThrow(this.data.throw);
      this.buildLabels();
      if (this._hole) this.cutFloor();
    },

    // ── The hole in the floor ─────────────────────────────────────────────
    // World-space, because the floor is one disc at the scene root. Resolved
    // per call rather than cached — dusk-floor may not have initialised when
    // this runs, and a cached failure would silently leave the pit sealed for
    // the whole session (the load-order bug §9.29.2 caught in skylight.js).
    cutFloor: function () {
      if (!this.data.cutFloor || !window.VRDome || !VRDome.setFloorHoles) return;
      if (this._shown === false) return;
      var self = this;
      var o = this.el.object3D;
      this.el.sceneEl.object3D.updateMatrixWorld(true);
      var p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      o.matrixWorld.decompose(p, q, s);
      var e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      this._hole = { x: p.x, z: p.z, w: CFG.holeW, d: CFG.holeD, r: CFG.holeR, rotY: e.y };
      var others = (VRDome.getFloorHoles() || []).filter(function (h) { return h.__lever !== self.el.id; });
      this._hole.__lever = this.el.id || 'lever';
      if (!VRDome.setFloorHoles(others.concat([this._hole]))) {
        // floor not up yet — one retry on the scene's own loaded event
        this.el.sceneEl.addEventListener('loaded', function () { self.cutFloor(); }, { once: true });
      }
    },

    uncutFloor: function () {
      if (!this._hole || !window.VRDome || !VRDome.setFloorHoles) return;
      var id = this._hole.__lever;
      VRDome.setFloorHoles((VRDome.getFloorHoles() || []).filter(function (h) { return h.__lever !== id; }));
      this._hole = null;
    },

    // troika text and the pit lamp are ENTITIES, not object3D meshes, so they
    // are built separately from the geometry.
    buildLabels: function () {
      var self = this;
      (this._kids || []).forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
      this._kids = [];

      if (CFG.pitLight > 0) {
        var lamp = document.createElement('a-entity');
        // No class="key-light": glass-material.js's rack is a fixed four and a
        // fifth member of that class is silently never read (§9.29). This lamp
        // is for the pit's own MeshStandard machinery, nothing else.
        lamp.setAttribute('light', {
          type: 'point', color: '#ffbc7d', intensity: CFG.pitLight, distance: 1.0, decay: 1.5
        });
        lamp.object3D.position.set(0, -CFG.pitDepth * 0.45, 0.02);
        this.el.appendChild(lamp);
        this._kids.push(lamp);
      }

      if (!CFG.showLabel || !this.built.plate) return;
      var p = this.built.plate.position;
      function text(value, size, color, dx) {
        var e = document.createElement('a-entity');
        e.setAttribute('troika-text', {
          value: value, align: 'center', anchor: 'center', baseline: 'middle',
          color: color, font: window.VRFonts ? VRFonts.bodyBold() : '',
          fontSize: size, letterSpacing: 0.14
        });
        // Lying flat on the plate, reading correctly for someone standing on
        // the +Z side looking down at it.
        e.object3D.position.set(dx, p.y + 0.006, p.z);
        e.object3D.rotation.x = -Math.PI / 2;
        self.el.appendChild(e);
        self._kids.push(e);
      }
      var size = window.VRType ? VRType.label() : 0.022;
      text(CFG.label, size, '#f0e3c8', CFG.labelNumber ? 0.018 : 0);
      if (CFG.labelNumber) text(CFG.labelNumber, size * 1.1, '#f6ecd6', -0.056);
    },

    update: function () {
      if (!this.built) return;
      this.applyThrow(this.data.throw);
    },

    // The only thing that moves, and the only thing that changes colour.
    applyThrow: function (t) {
      t = Math.max(0, Math.min(1, t));
      this._t = t;
      var deg = CFG.closedDeg + (CFG.openDeg - CFG.closedDeg) * t;
      this.built.arm.rotation.x = THREE.MathUtils.degToRad(deg);
      var c = rampColor(t);
      this.built.handleMats.forEach(function (m) {
        m.color.copy(c);
        if (m.emissive) m.emissive.copy(c);
      });
      if (this.built.pool) {
        // The pool takes the handle's colour too, at a fraction: the light on
        // the floor comes from the same place the sky is about to.
        this.built.pool.material.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.25);
      }
    },

    // Throw it, with the clunk at the end. Deliberately much faster than the
    // roof it drives (skylight's OPEN_MS is 6500): you work the machine, then
    // the building answers. Honours reduced motion by arriving instantly.
    throwTo: function (t, ms) {
      var self = this;
      this._goal = t;
      if (this._tween) { this._tween.kill(); this._tween = null; }
      var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || !window.gsap || ms === 0) { this.el.setAttribute('floor-lever', 'throw', t); return; }
      var state = { v: this._t != null ? this._t : this.data.throw };
      this._tween = gsap.to(state, {
        v: t, duration: (ms != null ? ms : 1150) / 1000, ease: 'power3.inOut',
        onUpdate: function () { self.applyThrow(state.v); },
        onComplete: function () {
          self._tween = null;
          self.el.setAttribute('floor-lever', 'throw', t);
        }
      });
    },

    teardown: function () {
      if (!this.built) return;
      if (this._tween) { this._tween.kill(); this._tween = null; }
      this.el.removeObject3D('lever');
      this.built.geos.forEach(function (g) { g.dispose(); });
      this.built.mats.forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); });
      (this._kids || []).forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
      this.built = null;
    },

    remove: function () { this.unbindInput(); this.teardown(); this.uncutFloor(); }
  });

  window.VRFloorLever = { CFG: CFG, build: build, rampColor: rampColor };
})();
