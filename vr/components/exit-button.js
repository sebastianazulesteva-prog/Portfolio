/* ═══ exit-button.js ═══
   The one way out, everywhere. (VR_AI_BUILD_GUIDE.md §9.6.)

   ── Where this belongs, and where it does NOT ──
   ONLY in the two contexts that actually take you out of the dome: the project
   room and the PDF reader. Sebastian, explicitly: "there is no need for 'back to
   dome' buttons when you don't leave the dome, which is only happening when you
   enter project rooms and whatnot."

   The focus stage is NOT one of them. It is a pull-closer overlay that happens
   *inside* the dome — you never left, so offering to take you back misdescribes
   where you are. It has its own small "Close" control instead (focus-stage.js).
   Don't mount this there.

   ── The problem this fixes ──
   The two real exits were both different, and the note was that they should be
   bigger, easier to find, in the upper right, and the SAME:

     pdf-reader   '← Back to the dome'  0.50 × 0.13  ghost   low LEFT, knee height
     project-room '← Return to dome'    0.44 × 0.12  solid   centred, y 1.25

   Two labels, two sizes, two variants, two positions. Nothing about finding
   your way out transferred from one to the other.

   ── Every tunable lives in CFG ──
   One object, exported as VRExitButton.CFG, read at make()/mount() time rather
   than captured in consts. That is what lets _dev-exit-button.html tune the
   REAL component live instead of a lookalike copy — the thing you dial in on
   that page is the thing that ships. Change a default here and the harness
   picks it up on reload; change it in the harness and paste the values back.
   Nothing dev-only branches in this file.

   ── The single design (chosen with Sebastian from rendered options) ──
   • Label: "Back to the dome" everywhere. One phrase, so it is recognised
     rather than re-read. (Wording only — the ← was dropped from the string; see
     the glyph note below.)
   • Colour: SIGNAL GREEN fill inside a bright mint rule. Sebastian picked it
     from six rendered options (2026-09-05); the previous rust is kept below as
     a commented palette.

     The rust was chosen for a stated reason — "the one warm tone used nowhere
     else in the scene" — and green keeps that property and strengthens it.
     Verified rather than assumed: every hex in themes.js and projects.json was
     scanned for hue 85-175 at any usable saturation, and there are NO greens.
     The scene is warm end to end, so the way out is the only cool thing in it
     and can never be mistaken for content. It also borrows the one colour
     convention a viewer already has for a way out.

     Measured 6.6:1 label-on-plate in a project room (pendant, the brightest
     sky) — see the contrast note below for how that is sampled.
   • Size: it was 0.82 × 0.20 — the largest control in the scene, on the
     reasoning that it is the one you look for when you feel stuck. In the
     reader that came out ~24° wide sitting over the page's top-right corner,
     and Sebastian's read was blunt: "far too annoying and big, push it off to
     the side a bit for now." So it is smaller and further out — see rightDeg /
     upDeg below. This is an interim placement he intends to design properly;
     don't build anything that depends on these exact numbers.
   • Arrow: a LEFT-pointing triangle, not ui-button's ↗ badge. You are going
     back, not out; ↗ is the flat site's external-link cue and means the wrong
     thing here.
   • Attention: it rests dimmed and lifts to full strength as your gaze comes
     toward it (`exit-attention` below), so it is quiet while you read and
     obvious the moment you look for it.
   • Variant: solid with an explicitly LIGHT label. Ghost puts a label straight
     onto whatever is behind it, and a project room paints its sky from
     theme.sky and its FLOOR from theme.panel — one theme pairs #3a3a38 with
     #f7f6f3, so a ghost label crossed a dark upper half and a near-white lower
     half and measured 3.55:1. An opaque plate makes the background known.
   • Position: A CENTRAL CONSOLE. See the section below — the upper-right corner
     it used to occupy turned out to have no position that worked, and the
     `corner` placement is kept only as a fallback.

   ── Why the upper-right corner was abandoned (measured 2026-09-04) ──
   The corner placement had two hard constraints and no position satisfying
   both. Measured in the reader, whose page is the binding case:

     the page      spans ±22.2° horizontally, top edge 24.1° above the eye
     a portrait phone   has only ~±21° of horizontal field (§9.4)

   • To clear the page by going RIGHT needs rightDeg ≥ 29.9° — which puts the
     button's outer edge ~16° beyond a phone's field. At the shipped 26° it was
     already 12° off the side of a phone screen. That crop is *documented and
     accepted* (§9.4: the scene is not recomposed for phones), so going further
     right is spending the one thing already overdrawn.
   • To clear the page by going UP needs upDeg ≥ 26.5°, which is geometrically
     fine and fits a phone — but the reader carries the key-light rack with it
     (`moveLightRack`, pdf-reader.js) and the rack stays at y 3.3. A button at
     26.5°+ sits ~2.6–2.8 m up, half a metre under a point light, and the plate
     blows out. Measured label-against-plate contrast, sampling the rendered
     framebuffer inside the plate:

       corner 26/20 (shipped)   3.20:1   marginal
       corner 18/24             2.99:1
       corner 10/32             1.04:1   the label is simply not there

     So "just move it up" is not a placement change, it is a lighting change.

   ── The console (Sebastian, 2026-09-04: "a simple central console, with a big
      button type button on it") ──
   Dead centre, low, on its own tilted deck, at an ABSOLUTE 1.10 m rather than
   at the calling context's distance. Three things fall out of that:
   • Centred costs nothing on a phone. The button subtends ±15.3°, inside the
     ±21° field with room to spare, so the whole control is on screen on every
     device — the first placement for which that is true.
   • Low keeps it out of the way of reading, and visible without looking down
     (NDC y −0.61 at pitch 0).

     CAVEAT, measured 2026-09-05 and NOT true of the original claim here, which
     said it "never argues with the page": in the READER it does. The console
     sits at 1.10 m and the page at 1.90 m, so the console's shadow on the page
     — eye through the deck's corners, onto z = −1.90 — covers the bottom
     **23.8%** of it, full width. The earlier note only measured where the
     console itself lands on screen, never what it hides behind it.

     consoleDownDeg is the lever. Measured, page area covered / gaze angle at a
     forward look (attentionDeg is 32, so past that it stops lifting on its own):

       27deg (current)  23.8%   lifts
       30deg            17.6%   lifts
       32deg            13.2%   lifts, exactly at the threshold
       34deg             8.7%   no lift
       38deg             0.0%   no lift, NDC y −0.93 (hugging the bottom edge)

     Going past 32deg means raising attentionDeg to match, or the control stops
     waking up when you look forward. Sebastian took 32 (2026-09-05): half the
     occlusion, and the last row that still wakes on its own. attentionDeg went
     32 -> 36 at the same time, for the margin reason noted at that key.
   • A fixed distance finally makes it the SAME control everywhere. The corner
     version was positioned by angle but sized in metres, so the same button
     subtended 27.3° in a room (1.3 m) and 18.9° in the reader (1.9 m) — a 44%
     difference in apparent size, in the one control whose whole premise was
     being identical everywhere. The console is 30.2° in both.
   • And it is the best lit of the lot, being furthest from the rack: 4.26:1 in
     the reader, 4.60:1 in a room, against the corner's 3.20:1.

   ── No arrow glyph in the label ──
   '←' is U+2190, and the Syne latin subset (fonts.js) is exactly the kind of
   subset that drops it — §3.6 records '↗' rendering as a solid filled box for
   this reason, diagnosed only by raycasting into the scene and reading the
   material back. The old labels carried '←' and may well have been showing a
   box on some of those surfaces. ui-button's own `arrow` badge draws its glyph
   into a canvas with a system font (arrowGlyphTexture), which is the path known
   to work, so the direction cue goes there instead of into troika text.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── The whole design, as data ──
  // One size, one label, one variant, one palette. Read at call time (see the
  // CFG note in the header), so a live editor can reassign any of these and the
  // next mount picks it up.
  var CFG = {
    label: 'Back to the dome',
    // Sized for the console deck. The arrow is inset by height*0.42 from the
    // left edge, and the label measures ~0.28 m at this type size, so a width
    // below ~0.50 walks the arrow straight into the 'B' of 'Back'.
    width: 0.60,
    height: 0.165,

    fill: '#1d5c46',        // signal green; the only cool hue in the scene

    // ── What actually paints the plate ──
    // 'glass' routes the fill through ui-button's VRGlass card, which is the
    // shipped look. Be aware of what that shader does with a colour before
    // trying to theme it: the fill is a HARDCODED dark gradient
    //   fill = mix(#1d1c1a, #2f2d29, y);  fill += uAccent * 0.05;
    // so the accent contributes 5% of the plate and is otherwise only visible
    // on the border and rim glow. Every 'fill' you can name comes out the same
    // deep warm brown — measured, not guessed: #9e4526 (rust) and #17150f
    // (near-black) rendered indistinguishably side by side.
    //
    // 'solid' hides that card and draws an opaque rounded rect in CFG.fill
    // instead, which is the only way this control's plate colour is actually
    // selectable. It gives up the glass hover wake, which costs nothing here
    // because the gaze attention below drives the ring, arrow and scale anyway.
    plateStyle: 'solid',    // 'solid' (shipped) | 'glass' (the pre-2026-09-05 look)
    fillGlow: 0.20,         // emissive floor for the solid plate, so it can't
                            // sink to mud when a room dims the key rack
    ring: '#58b892',        // mint, a clear lift on the fill so the rule reads
    arrow: '#9fe6c6',       // brighter again, so the mark reads on the fill
    labelColor: '#eafaf2',
    rule: 0.014,            // ring thickness in metres

    // The rust palette this replaced, kept because it was the design for long
    // enough to be referenced elsewhere and re-deriving it means re-rendering
    // the whole option set. Restore by pasting over the six keys above:
    //   fill '#9e4526'  ring '#b8863b'  arrow '#e0a94f'  labelColor '#f5f5f0'
    //   rule 0.016  consoleFill '#1b1917'  consoleRuleColor '#2b2724'
    // With plateStyle 'glass' that is the exact pre-2026-09-05 shipped look.

    showArrow: true,

    // ── Placement ──
    // 'console' (default) or 'corner'. See the placement note in the header for
    // why the upper-right corner was abandoned; 'corner' is kept because it is
    // still the right answer if the console is ever in the way, and deleting it
    // would mean re-deriving all of this from scratch.
    placement: 'console',

    // ── Console placement ──
    // Dead centre, low, on its own surface. Centred costs nothing on a phone
    // (the corner cost 12deg of it) and low means it never argues with the
    // page. Distance is absolute, not per-context: a console is furniture you
    // walk up to, so it sits in the same place whatever you were reading.
    consoleDistance: 1.10,   // metres in front of the eye
    // 32, not 27. At 27 the deck's shadow on the reader's page covered the
    // bottom 23.8% of it; 32 halves that to 13.2%. See the caveat table in the
    // header for the full curve and why going further costs the gaze lift.
    consoleDownDeg: 32,      // degrees below view centre, to the console centre
    consoleTilt: 0,          // extra tilt beyond facing the eye; 0 = square on
    // 0.88 x 0.35, not the original 0.74 x 0.28. At the tighter size the deck
    // margin was about the same width as the button's own rule, so the pair
    // read as one mis-registered double border instead of a button resting on
    // a surface. The deck needs to be visibly a surface or it is just a frame.
    consoleW: 0.88,
    consoleH: 0.35,
    consoleFill: '#141816',  // a surface, not a control — reads as furniture
    consoleRule: 0.010,
    // The deck's rim is its OWN colour, not the button's ring. Defaulting it to
    // CFG.ring (which is what it used to hardcode) draws two concentric ember
    // outlines around one control, and the pair reads as a mis-registered
    // double border rather than a button sitting on a surface. Set it to null
    // to fall back to CFG.ring.
    consoleRuleColor: '#24302b',

    // Where "upper right" is, in degrees off the view centre — 'corner' only.
    // Converted to metres per call site using that context's own viewing
    // distance, which is what kept it in the same place on screen everywhere.
    rightDeg: 26,
    upDeg: 20,
    // Pulled toward the viewer so it is never in doubt about being in front of
    // the thing it closes — a button co-planar with a page reads as part of it.
    zLift: 0.12,

    // Gaze-attention states. The LABEL is never dimmed — only the ring, the
    // arrow and the scale — because a control whose text fades is a control you
    // can't read when you finally find it.
    restRing: 0.16, activeRing: 0.95,
    restArrow: 0.30, activeArrow: 0.95,
    restScale: 1.0, activeScale: 1.05,
    // 36, deliberately NOT 32. The console now sits exactly 32deg below a
    // forward gaze, so an attentionDeg of 32 puts the wake condition precisely
    // on its own boundary — `deg <= attentionDeg` passes only by equality, and
    // any drift in eye height or deck centre silently stops the control ever
    // lighting up when you look straight ahead. 4deg of margin, still tight
    // enough that looking away (43deg at yaw 35) leaves it resting.
    attentionDeg: 36,       // half-angle off view centre that counts as "looking for it"
    easePerSec: 3.2         // state change per second, frame-rate independent
  };

  function make(opts) {
    opts = opts || {};
    var el = document.createElement('a-entity');

    // ui-button still does the plate, the label, the hover feel and the
    // scene-wide minimum target size. What it can't do is a border or a
    // left-pointing mark, so those are added around it below.
    //
    // The accent is the rust regardless of what the calling context passes: a
    // room's own accent on this control is exactly the ambiguity the single
    // design exists to remove. `arrow: false` because ui-button's badge is the
    // ↗ external-link cue.
    el.setAttribute('ui-button', {
      label: CFG.label,
      width: CFG.width, height: CFG.height,
      accent: CFG.fill,
      variant: 'solid',
      // Always light. See the contrast note in the header — this must not
      // inherit ui-button's near-black solid label, which collapses to 2.1:1
      // in a room that has dimmed the key rack to 0.22.
      labelColor: CFG.labelColor,
      arrow: false
    });

    // ── The opaque plate ──
    // See the plateStyle note in CFG. Sits just in FRONT of ui-button's glass
    // card (z 0.002 against the card's 0) and behind the label (0.008) and the
    // arrow (0.02), so the label and mark keep rendering over it. The card
    // itself is hidden on 'loaded' rather than here, because the component has
    // not initialised at make() time and its mesh does not exist yet.
    if (CFG.plateStyle === 'solid') {
      var plateGeo = VRScrollArrows.roundedRectGeometry(
        CFG.width, CFG.height, CFG.height * 0.5);
      var plate = new THREE.Mesh(plateGeo, VRScrollArrows.litMaterial(CFG.fill, CFG.fillGlow, 1));
      plate.position.z = 0.002;
      el.setObject3D('exit-plate', plate);
      el.addEventListener('loaded', function () {
        var ub = el.components['ui-button'];
        if (ub && ub.mesh) ub.mesh.visible = false;
      });
    }

    // ── The ember rule ──
    // A slightly larger rounded rect sitting just BEHIND the plate, so only its
    // margin shows. Drawn behind rather than as four edge strips because the
    // plate's corner radius and the ring's then match by construction.
    if (CFG.rule > 0) {
      var ringGeo = VRScrollArrows.roundedRectGeometry(
        CFG.width + CFG.rule * 2, CFG.height + CFG.rule * 2, (CFG.height + CFG.rule * 2) * 0.5);
      var ringMat = VRScrollArrows.litMaterial(CFG.ring, CFG.restRing, 1);
      var ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.z = -0.003;
      el.setObject3D('exit-ring', ring);
    }

    // ── The back mark ──
    // Geometry, not a glyph: '←' is U+2190 and the Syne subset drops it (§3.6).
    // triangleGeometry builds an up/down triangle, so this is the up one turned
    // a quarter turn anticlockwise to point left.
    if (CFG.showArrow) {
      var triGeo = VRScrollArrows.triangleGeometry(CFG.height * 0.42, CFG.height * 0.34, true);
      var triMat = VRScrollArrows.litMaterial(CFG.arrow, CFG.restArrow, 1);
      var tri = new THREE.Mesh(triGeo, triMat);
      tri.rotation.z = Math.PI / 2;
      // Inset from the left edge. The label is centred by ui-button and measures
      // roughly 0.28 m wide at this size, so it spans about ±0.14 — this sits
      // clear of it at -0.23.
      tri.position.set(-(CFG.width / 2) + CFG.height * 0.42, 0, 0.02);
      el.setObject3D('exit-arrow', tri);
    }

    el.setAttribute('exit-attention', '');

    if (opts.onExit) {
      el.addEventListener('click', function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        opts.onExit();
      });
    }
    return el;
  }

  // ── Gaze attention ──
  // Rests dimmed, lifts to full as the viewer's gaze comes within
  // CFG.attentionDeg of it. Rate-limited per SECOND, not per frame, or the lift
  // runs twice as fast at 120fps as at 60 (the sunflower.js lesson).
  //
  // Under reduced motion it simply sits at full strength: "arrives in the final
  // state instantly" (hard rule 4), and a control that never brightens because
  // animation is off would be permanently dimmed.
  AFRAME.registerComponent('exit-attention', {
    init: function () {
      this.k = reducedMotion ? 1 : 0;
      this._fwd = new THREE.Vector3();
      this._toBtn = new THREE.Vector3();
      this._camPos = new THREE.Vector3();
      this._btnPos = new THREE.Vector3();
      this.apply(this.k);
    },

    apply: function (k) {
      var ring = this.el.getObject3D('exit-ring');
      var tri = this.el.getObject3D('exit-arrow');
      if (ring) ring.material.emissiveIntensity = CFG.restRing + (CFG.activeRing - CFG.restRing) * k;
      if (tri) tri.material.emissiveIntensity = CFG.restArrow + (CFG.activeArrow - CFG.restArrow) * k;
      var s = CFG.restScale + (CFG.activeScale - CFG.restScale) * k;
      this.el.object3D.scale.set(s, s, s);
    },

    tick: function (time, delta) {
      if (reducedMotion) return;
      var cam = this.el.sceneEl.camera;
      if (!cam) return;
      cam.getWorldPosition(this._camPos);
      this.el.object3D.getWorldPosition(this._btnPos);
      this._toBtn.copy(this._btnPos).sub(this._camPos);
      if (this._toBtn.lengthSq() < 1e-6) return;
      this._toBtn.normalize();
      this._fwd.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
      var deg = THREE.MathUtils.radToDeg(Math.acos(
        THREE.MathUtils.clamp(this._fwd.dot(this._toBtn), -1, 1)));

      var want = deg <= CFG.attentionDeg ? 1 : 0;
      var step = CFG.easePerSec * (Math.min(delta || 0, 100) / 1000);
      if (this.k < want) this.k = Math.min(want, this.k + step);
      else if (this.k > want) this.k = Math.max(want, this.k - step);
      else return;
      this.apply(this.k);
    }
  });

  // ── Console placement ──
  // One surface, dead centre, below the content, carrying one big button.
  //
  // Returns the BUTTON, not the console, because both call sites use the return
  // value to know when the clickable is attached (project-room.js waits on its
  // 'loaded' to refresh the selection raycasters). Handing back the console
  // would fire that before the thing you can actually click exists.
  function mountConsole(root, opts) {
    var eye = opts.eye != null ? opts.eye : 1.6;
    var d = CFG.consoleDistance;
    var down = CFG.consoleDownDeg;

    var deck = document.createElement('a-entity');
    deck.setAttribute('position', {
      x: 0, y: eye - d * Math.tan(THREE.MathUtils.degToRad(down)), z: -d
    });
    // Square on to the eye. A-Frame's floor convention is rotation "-90 0 0",
    // i.e. NEGATIVE x tips the surface back and points its normal up — so
    // -down aims the deck straight at the viewer, and consoleTilt leans it
    // further toward horizontal from there.
    deck.setAttribute('rotation', { x: -(down + CFG.consoleTilt), y: 0, z: 0 });

    var deckGeo = VRScrollArrows.roundedRectGeometry(CFG.consoleW, CFG.consoleH, CFG.consoleH * 0.22);
    var deckMesh = new THREE.Mesh(deckGeo, VRScrollArrows.litMaterial(CFG.consoleFill, 0.10, 1));
    deck.setObject3D('console-deck', deckMesh);

    if (CFG.consoleRule > 0) {
      var rimGeo = VRScrollArrows.roundedRectGeometry(
        CFG.consoleW + CFG.consoleRule * 2, CFG.consoleH + CFG.consoleRule * 2,
        (CFG.consoleH + CFG.consoleRule * 2) * 0.22);
      var rimColor = CFG.consoleRuleColor != null ? CFG.consoleRuleColor : CFG.ring;
      var rim = new THREE.Mesh(rimGeo, VRScrollArrows.litMaterial(rimColor, 0.10, 1));
      rim.position.z = -0.004;
      deck.setObject3D('console-rim', rim);
    }

    root.appendChild(deck);
    var el = make(opts);
    el.setAttribute('position', { x: 0, y: 0, z: 0.012 });
    deck.appendChild(el);
    return el;
  }

  // Place it in the standard upper-right slot for a context whose content sits
  // `distance` metres ahead with its centre at `eye` height.
  //   mount(rootEl, { distance: 1.9, eye: 1.6, onExit: close })
  function mount(root, opts) {
    opts = opts || {};
    if (CFG.placement === 'console') return mountConsole(root, opts);
    var d = opts.distance != null ? opts.distance : 1.5;
    var eye = opts.eye != null ? opts.eye : 1.6;
    var el = make(opts);
    var x = d * Math.tan(THREE.MathUtils.degToRad(CFG.rightDeg));
    var y = eye + d * Math.tan(THREE.MathUtils.degToRad(CFG.upDeg));
    var z = -(d) + (opts.zLift != null ? opts.zLift : CFG.zLift);
    el.setAttribute('position', { x: opts.x != null ? opts.x : x, y: opts.y != null ? opts.y : y, z: z });
    root.appendChild(el);
    return el;
  }

  // NOTE: mountInPanel() / repositionInPanel() / panelX() used to live here, for
  // anchoring this control to a panel's top-right corner. They existed only for
  // the focus stage, which turned out not to be an exit at all (see the header),
  // so they are deleted rather than left lying around as an invitation to mount
  // a "leave the dome" button somewhere you haven't left it.

  window.VRExitButton = { make: make, mount: mount, CFG: CFG };

  // Back-compat aliases for the five values that used to be exported as flat
  // consts. Getters, not copies, so they can't go stale when CFG is retuned.
  ['LABEL:label', 'WIDTH:width', 'HEIGHT:height', 'RIGHT_DEG:rightDeg', 'UP_DEG:upDeg']
    .forEach(function (pair) {
      var p = pair.split(':');
      Object.defineProperty(window.VRExitButton, p[0], {
        get: function () { return CFG[p[1]]; }, enumerable: true
      });
    });
})();
