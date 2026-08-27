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

   ── The single design (chosen with Sebastian from rendered options) ──
   • Label: "Back to the dome" everywhere. One phrase, so it is recognised
     rather than re-read. (Wording only — the ← was dropped from the string; see
     the glyph note below.)
   • Colour: RUST fill (#9e4526) inside a thick EMBER rule (#b8863b). The rust
     matters for a specific reason: it is the one warm tone used nowhere else in
     the scene — not a project accent (`projects.json`), not the dome's ember,
     not a card tint — so the way out can never be mistaken for content, and it
     reads the same over the dark dome and over a white PDF page. The ember ring
     is what ties it back to the dome it returns you to.
   • Size: 0.82 × 0.20 — about 20% larger again than the 0.68 × 0.18 first pass,
     and the largest control in the scene, because it is the one you look for
     when you feel stuck.
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
   • Position: UPPER RIGHT, defined by ANGLE rather than by metres, so it lands
     in the same place in your field of view whether the content it belongs to
     sits at 1.05 m (focus stage) or 1.9 m (reader). Same look, same spot,
     every time.

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

  // One size, one label, one variant. Exported so a caller can reserve space
  // for it without hardcoding numbers that would then drift.
  var LABEL = 'Back to the dome';
  var WIDTH = 0.82;
  var HEIGHT = 0.20;

  var RUST = '#9e4526';    // fill — deliberately unused elsewhere in the scene
  var RING = '#b8863b';    // the dome's ember, as a thick rule
  var ARROW = '#e0a94f';   // a lift on the ring colour, so the mark reads on the fill
  var LABEL_COLOR = '#f5f5f0';
  var RULE = 0.016;        // ring thickness in metres

  // Gaze-attention states. The LABEL is never dimmed — only the ring, the arrow
  // and the scale — because a control whose text fades is a control you can't
  // read when you finally find it.
  var REST_RING = 0.16, ACTIVE_RING = 0.95;
  var REST_ARROW = 0.30, ACTIVE_ARROW = 0.95;
  var REST_SCALE = 1.0, ACTIVE_SCALE = 1.05;
  var ATTENTION_DEG = 32;  // half-angle off view centre that counts as "looking for it"
  var EASE_PER_SEC = 3.2;  // state change per second, frame-rate independent

  // Where "upper right" is, in degrees off the view centre. Converted to metres
  // per call site using that context's own viewing distance, which is what keeps
  // the button in the same place on screen everywhere.
  var RIGHT_DEG = 23;
  var UP_DEG = 16;

  function make(opts) {
    opts = opts || {};
    var el = document.createElement('a-entity');

    // ui-button still does the plate, the label, the hover feel and the
    // scene-wide minimum target size. What it can't do is a border or a
    // left-pointing mark, so those are added around it below.
    //
    // The accent is RUST regardless of what the calling context passes: a
    // room's own accent on this control is exactly the ambiguity the single
    // design exists to remove. `arrow: false` because ui-button's badge is the
    // ↗ external-link cue.
    el.setAttribute('ui-button', {
      label: LABEL,
      width: WIDTH, height: HEIGHT,
      accent: RUST,
      variant: 'solid',
      // Always light. See the contrast note in the header — this must not
      // inherit ui-button's near-black solid label, which collapses to 2.1:1
      // in a room that has dimmed the key rack to 0.22.
      labelColor: LABEL_COLOR,
      arrow: false
    });

    // ── The ember rule ──
    // A slightly larger rounded rect sitting just BEHIND the plate, so only its
    // margin shows. Drawn behind rather than as four edge strips because the
    // plate's corner radius and the ring's then match by construction.
    var ringGeo = VRScrollArrows.roundedRectGeometry(
      WIDTH + RULE * 2, HEIGHT + RULE * 2, (HEIGHT + RULE * 2) * 0.5);
    var ringMat = VRScrollArrows.litMaterial(RING, REST_RING, 1);
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.z = -0.003;
    el.setObject3D('exit-ring', ring);

    // ── The back mark ──
    // Geometry, not a glyph: '←' is U+2190 and the Syne subset drops it (§3.6).
    // triangleGeometry builds an up/down triangle, so this is the up one turned
    // a quarter turn anticlockwise to point left.
    var triGeo = VRScrollArrows.triangleGeometry(HEIGHT * 0.42, HEIGHT * 0.34, true);
    var triMat = VRScrollArrows.litMaterial(ARROW, REST_ARROW, 1);
    var tri = new THREE.Mesh(triGeo, triMat);
    tri.rotation.z = Math.PI / 2;
    // Inset from the left edge. The label is centred by ui-button and measures
    // roughly 0.34 m wide at this size, so it spans about ±0.17 — this sits
    // well clear of it at -0.33.
    tri.position.set(-(WIDTH / 2) + HEIGHT * 0.42, 0, 0.02);
    el.setObject3D('exit-arrow', tri);

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
  // ATTENTION_DEG of it. Rate-limited per SECOND, not per frame, or the lift
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
      if (ring) ring.material.emissiveIntensity = REST_RING + (ACTIVE_RING - REST_RING) * k;
      if (tri) tri.material.emissiveIntensity = REST_ARROW + (ACTIVE_ARROW - REST_ARROW) * k;
      var s = REST_SCALE + (ACTIVE_SCALE - REST_SCALE) * k;
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

      var want = deg <= ATTENTION_DEG ? 1 : 0;
      var step = EASE_PER_SEC * (Math.min(delta || 0, 100) / 1000);
      if (this.k < want) this.k = Math.min(want, this.k + step);
      else if (this.k > want) this.k = Math.max(want, this.k - step);
      else return;
      this.apply(this.k);
    }
  });

  // Place it in the standard upper-right slot for a context whose content sits
  // `distance` metres ahead with its centre at `eye` height.
  //   mount(rootEl, { distance: 1.9, eye: 1.6, onExit: close })
  function mount(root, opts) {
    opts = opts || {};
    var d = opts.distance != null ? opts.distance : 1.5;
    var eye = opts.eye != null ? opts.eye : 1.6;
    var el = make(opts);
    var x = d * Math.tan(THREE.MathUtils.degToRad(RIGHT_DEG));
    var y = eye + d * Math.tan(THREE.MathUtils.degToRad(UP_DEG));
    // Pulled toward the viewer so it is never in doubt about being in front of
    // the thing it closes — a button co-planar with a page reads as part of it.
    var z = -(d) + (opts.zLift != null ? opts.zLift : 0.12);
    el.setAttribute('position', { x: opts.x != null ? opts.x : x, y: opts.y != null ? opts.y : y, z: z });
    root.appendChild(el);
    return el;
  }

  // NOTE: mountInPanel() / repositionInPanel() / panelX() used to live here, for
  // anchoring this control to a panel's top-right corner. They existed only for
  // the focus stage, which turned out not to be an exit at all (see the header),
  // so they are deleted rather than left lying around as an invitation to mount
  // a "leave the dome" button somewhere you haven't left it.

  window.VRExitButton = {
    make: make, mount: mount,
    LABEL: LABEL, WIDTH: WIDTH, HEIGHT: HEIGHT,
    RIGHT_DEG: RIGHT_DEG, UP_DEG: UP_DEG
  };
})();
