/* ═══ dwell.js ═══
   The intention gate: a small circle that FILLS UP in front of the thing you
   are pointing at, and only when it is full does the thing happen.

   Sebastian, on the photo cloud: *"whenever you look at an image it should just
   fly towards you … there should be maybe a tiny count, like one second, roughly
   that, just so when someone's looking through it's not pulling images towards
   them like crazy. So there's a little more intention — someone looking at the
   image for a few seconds means they want to pull it towards them. Maybe we can
   have a little animation of the circle filling up. That's probably good for all
   things."*

   So this is a general mechanism, not a photo-cloud detail:

     var token = VRDwell.start(el, { onComplete: function () { ... } });
     VRDwell.cancel(token);              // on mouseleave, or whenever intent ends

   ── This is NOT gaze-fuse selection ──────────────────────────────────────────
   Hard rule 7 (VR_AI_BUILD_GUIDE.md §2) is that nothing in this scene opens
   from just looking at it — `fuse: false` everywhere, every SELECTION needs an
   explicit click/tap/trigger/pinch. That rule is intact and this does not bend
   it. A dwell here gates a PREVIEW: the photo cloud's reach, which floats a tile
   forward and shows its caption and is reversed the moment you look away.
   Committing to a photo — pulling it out of the cloud, offering its project — is
   still a click. If you ever reach for this to fire something irreversible,
   you are back to a fuse, and the answer is no.

   ── Why the ring is in the WORLD, at the target, not on the cursor ───────────
   The obvious home for a dwell arc is the reticle — it already sits at the
   raycast hit, already keeps a constant apparent size, already draws depth-free
   on top of everything. It is the wrong home here for one hard reason:
   **the in-scene reticle is hidden outside VR.** fallback.js sets
   `reticleObj.visible = inVR`, because on desktop/phone the ray follows the
   MOUSE (`rayOrigin: mouse`) while the reticle entity sits at the eye, so a
   centre reticle would point at something the pointer isn't over. An arc drawn
   there would be invisible for every desktop and phone visitor — which is most
   of them.

   Anchoring to the target instead is one implementation that shows up
   everywhere, and it says something the cursor cannot: the circle fills up ON
   the photo it is about to pull, so the progress belongs to that photo rather
   than to the pointer. It also survives the pointer moving a few pixels within
   the same target, which a cursor-anchored ring would visibly jitter under.

   ── One dwell at a time ─────────────────────────────────────────────────────
   You can only point at one thing, so there is one ring, built once and reused,
   parked at the scene root. Starting a second dwell cancels the first. Nothing
   is allocated per dwell and there is no teardown for a caller to forget — which
   matters, because the callers are hover handlers and hover handlers get
   interrupted (trap §3.13: on a Vision Pro a pinch arrives as
   mouseenter → click → mouseleave inside a few frames).

   ── The clock ───────────────────────────────────────────────────────────────
   Progress is `(performance.now() - t0) / duration`, read on demand. Not an
   accumulated per-frame delta, and not a setTimeout:
   • `setTimeout` is clamped to ~1 s in any context the browser considers
     backgrounded, and whether visionOS calls an immersive session backgrounded
     is not documented anywhere reliable (trap §3.15). A 900 ms dwell armed with
     a timeout could take a second and a half in a headset.
   • Reading the wall clock is not scheduling — `performance.now()` is correct
     everywhere. Only the COMPLETION CHECK needs a heartbeat, and that rides
     A-Frame's own tick via a system (nothing in markup to forget, same pattern
     as xr-frame.js), which runs both on a desktop and inside an immersive
     session where the window's rAF does not (trap §3.14).

   Consequence worth knowing when testing: in a stalled preview pane A-Frame's
   loop stops, so a dwell will never complete however long you wait. Pump
   `sceneEl.tick()` (§3.1).

   ── On a Vision Pro, this ring will rarely be seen, and that is correct ─────
   There is a continuous head-gaze pointer in VR (fallback.js swaps the cursor to
   `rayOrigin: entity` on enter-vr), so a dwell does arm and fill there. But a
   pinch selects on the spot, and selection outranks the preview — so a visitor
   who pinches a photo gets it immediately without waiting out the ring. The
   dwell only ever delays the cheap reversible thing.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sebastian asked for "maybe one second, roughly that". 900 ms rather than a
  // round 1000: a ring that visibly fills reads as longer than it measures, and
  // at a full second the last third feels like the scene has stopped responding.
  // Under 700 ms it stops reading as a deliberate hold and you are back to
  // photos flying at a sweeping gaze, which is the whole thing being fixed.
  var DEFAULT_MS = 900;

  // Ring size at REF_DIST, in metres, and the fill's stroke. Scaled by
  // distance/REF_DIST every frame so the ring keeps a CONSTANT APPARENT SIZE
  // wherever it is anchored — same trick as the reticle. Without it the ring is
  // 2.6° on a near photo-cloud tile (2.2 m) and 1.6° on a far one (3.6 m), and a
  // progress indicator that changes size by 60% depending on what it is
  // measuring reads as two different controls.
  var REF_DIST = 2.0;
  var OUTER = 0.052;
  var STROKE = 0.010;

  // The track (the unfilled circle) is deliberately visible from the first
  // frame: a bare arc growing out of nothing does not tell you how far there is
  // to go, and "how much longer do I hold this" is the only question this
  // control answers. Tones are the reticle's off-white, so the newest indicator
  // in the scene is not also a new colour.
  var COLOR = '#f5f5f0';
  var TRACK_OPACITY = 0.22;
  var FILL_OPACITY = 0.92;

  // ── A soft dark scrim behind the ring ────────────────────────────────────
  // Off-white on an unknown background is a contrast gamble, and here the
  // background is *always* a photograph. Rendered and looked at: on a pale
  // subject — the shipped cloud has several, a hand holding a light wooden
  // frame, a white-paper sketch, a whiteboard — the ring very nearly
  // disappeared. It read fine over the dome's near-black, which is exactly the
  // trap: it looks correct on most tiles and vanishes on some.
  //
  // The scene already has an answer to this problem and it is worth reusing
  // rather than reinventing: photo-cloud's caption chip (CAP_BG_COLOR #0e0c09)
  // exists because *"it gets hard to read"* over whatever a caption happens to
  // float over. Same tone here, so the two backings agree.
  //
  // FEATHERED, not a disc. A hard-edged dark circle stamps a black coin onto
  // the photograph you are about to pull toward you; a radial falloff seats the
  // ring without reading as an object of its own. It is also gone in under a
  // second either way.
  var SCRIM_COLOR = '#0e0c09';
  var SCRIM_ALPHA = 0.5;
  var SCRIM_R = 1.42;      // multiple of OUTER
  var SCRIM_SOFT = 0.55;   // fraction of the scrim's radius spent fading out

  // Fade the whole thing in/out rather than popping it, and fade OUT faster
  // than in: a cancelled dwell should get out of the way promptly (you have
  // already looked elsewhere), while an arriving one should not flash.
  var FADE_IN_MS = 120;
  var FADE_OUT_MS = 90;

  // How far in front of the anchor's own surface the ring sits, along the
  // anchor→viewer direction. Small, but not zero: at zero it z-fights the
  // photo's own plane. depthTest is off anyway (see below), so this only has to
  // beat floating-point coincidence.
  var LIFT = 0.012;

  // §3.6's layer table. Above every content surface, below the reticle — the
  // cursor is always last, and a dwell ring that covered the cursor would hide
  // the one thing telling you what you are pointing at.
  var RENDER_ORDER = 900;

  var TAU = Math.PI * 2;

  // ── Colours for a shader that writes straight to the framebuffer ─────────
  // NOT THREE.Color. This is trap §3.5 from the other side, and it was caught
  // by measuring the rendered pixels rather than by reading the code:
  // `THREE.ColorManagement.enabled` is true here, so `new THREE.Color('#f2dcae')`
  // converts the hex from sRGB into the LINEAR working space, and a shader that
  // does not `#include <colorspace_fragment>` then writes those linear numbers
  // into an already-sRGB-encoded framebuffer. Measured: uTint arrived as
  // (0.888, 0.716, 0.423) instead of the authored (0.949, 0.863, 0.682) — blue
  // 38% too dark — which turned a soft cream highlighter into a saturated tan.
  //
  // The shaders here deliberately omit that include (they sample no textures and
  // their colours are hand-picked literals, exactly CARD_FRAG's case), so the
  // literal has to reach the shader UNCONVERTED. Decoding the hex by hand is the
  // only way to say that and have it stay true if three.js's colour-management
  // defaults ever move.
  function srgbVec(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }


  // ── The arc, as a shader rather than as rebuilt geometry ──────────────────
  // The reticle rebuilds its RingGeometry every frame to keep a constant stroke
  // while it grows, which is fine for a radius but wrong for an arc: a
  // 64-segment ring rebuilt per frame quantises the leading edge to 5.6° steps,
  // so the fill visibly ratchets. Masking a full ring by angle in the fragment
  // shader gives a smooth sub-segment edge and allocates nothing.
  //
  // NO `#include <colorspace_fragment>` here, deliberately, and for the same
  // reason CARD_FRAG omits it (trap §3.5): this shader samples no textures and
  // its one colour is a hand-picked literal authored in output space. Converting
  // it would brighten the ring away from the reticle's off-white it is matched to.
  // The scrim's own shader. Trivial, but a canvas radial-gradient texture would
  // be a second thing to own and dispose for the same result.
  var SCRIM_FRAG = [
    'uniform vec3 uColor;',
    'uniform float uAlpha;',
    'uniform float uSoft;',
    'varying vec2 vXY;',
    'uniform float uR;',
    'void main() {',
    '  float r = length(vXY) / uR;',
    // 1.0 - smoothstep(lo, hi, x), lo < hi — never smoothstep(hi, lo, x), which
    // is UNDEFINED in GLSL and silently returns 0 everywhere (trap §3.11).
    '  float a = (1.0 - smoothstep(1.0 - uSoft, 1.0, r)) * uAlpha;',
    '  if (a <= 0.002) discard;',
    '  gl_FragColor = vec4(uColor, a);',
    '}'
  ].join('\n');

  var ARC_VERT = [
    'varying vec2 vXY;',
    'void main() {',
    '  vXY = position.xy;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var ARC_FRAG = [
    'uniform vec3 uColor;',
    'uniform float uOpacity;',
    'uniform float uProgress;',
    'varying vec2 vXY;',
    'const float TAU = 6.28318530718;',
    'void main() {',
    // atan(x, y) — x over y, not the usual y over x — measures the angle from
    // +Y toward +X, so t is 0 at the top of the ring and grows CLOCKWISE, which
    // is the direction every progress dial on earth fills.
    '  float t = atan(vXY.x, vXY.y);',
    '  if (t < 0.0) t += TAU;',
    '  float edge = uProgress * TAU;',
    // Antialias the leading edge over a fixed angular width. Written as
    // 1.0 - smoothstep(lo, hi, x) with lo < hi: smoothstep with edge0 >= edge1
    // is UNDEFINED in GLSL and fails silently to alpha 0 everywhere (trap
    // §3.11), which here would mean an arc that simply never draws.
    '  float a = 1.0 - smoothstep(edge, edge + 0.045, t);',
    '  if (a <= 0.001) discard;',
    '  gl_FragColor = vec4(uColor, uOpacity * a);',
    '}'
  ].join('\n');

  var ring = null;        // { group, track, fill, fillMat, trackMat }
  var active = null;      // { el, obj3D, t0, duration, onComplete, onCancel, offset, token }
  var shown = 0;          // eased 0..1 visibility of the whole group
  var nextToken = 1;

  function buildRing() {
    var group = new THREE.Group();
    var geo = new THREE.RingGeometry(OUTER - STROKE, OUTER, 64);

    var scrimR = OUTER * SCRIM_R;
    var scrimGeo = new THREE.CircleGeometry(scrimR, 48);
    var scrimMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: srgbVec(SCRIM_COLOR) },
        uAlpha: { value: SCRIM_ALPHA },
        uSoft: { value: SCRIM_SOFT },
        uR: { value: scrimR }
      },
      // Shares ARC_VERT: it only forwards the local xy, which is what both
      // shaders need.
      vertexShader: ARC_VERT,
      fragmentShader: SCRIM_FRAG,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide
    });
    var scrim = new THREE.Mesh(scrimGeo, scrimMat);
    scrim.position.z = -0.0004;   // behind the ring, same hairline

    // The track is a built-in material, so three.js owns its colour space end to
    // end — `color` here is correct as a hex and must NOT go through srgbVec.
    // The fill and the scrim are custom shaders and do. Two treatments of the
    // same hex in one function, on purpose.
    var trackMat = new THREE.MeshBasicMaterial({
      color: COLOR, transparent: true, opacity: TRACK_OPACITY,
      // Depth-free, like the reticle: the ring is an overlay on a target that
      // may itself be behind other tiles in the cloud, and an indicator you
      // cannot see is not an indicator. Paired with RENDER_ORDER so it still
      // composites in a defined place rather than wherever the graph puts it
      // (§3.6 — this scene draws transparent objects in scene-graph order).
      depthTest: false, depthWrite: false, side: THREE.DoubleSide
    });
    var track = new THREE.Mesh(geo, trackMat);

    var fillMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: srgbVec(COLOR) },
        uOpacity: { value: FILL_OPACITY },
        uProgress: { value: 0 }
      },
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide
    });
    // Shares ONE geometry with the track — same ring, two treatments — so the
    // fill can never drift a fraction of a millimetre off the track it sits in.
    // Only the material is per-mesh, and disposal below frees the geometry once.
    var fill = new THREE.Mesh(geo, fillMat);
    fill.position.z = 0.0004;   // hairline in front, so the fill wins the tie

    // Scrim first, so it paints under the ring: this scene draws transparent
    // objects in SCENE-GRAPH order, not depth order (§3.6), and all three are
    // depthTest:false — so the order they are added in is the order they
    // composite in, and renderOrder states it explicitly on top of that.
    group.add(scrim);
    group.add(track);
    group.add(fill);
    group.renderOrder = RENDER_ORDER;
    scrim.renderOrder = RENDER_ORDER;
    track.renderOrder = RENDER_ORDER + 1;
    fill.renderOrder = RENDER_ORDER + 2;
    group.visible = false;

    var scene = document.querySelector('a-scene');
    if (!scene || !scene.object3D) return null;
    scene.object3D.add(group);

    return { group: group, geo: geo, track: track, fill: fill, scrim: scrim,
             scrimGeo: scrimGeo, trackMat: trackMat, fillMat: fillMat,
             scrimMat: scrimMat };
  }

  // Effective visibility — walk the parent chain, because three.js's raycaster
  // tests `layers` and not `visible`, so a hidden PARENT does not stop its
  // children being hit (the same reason xr-select.js walks it). Inside the
  // reader and the project rooms every .hub-cluster is hidden at the parent, so
  // without this a dwell could be armed on a photo tile behind a wall and then
  // fill up over a room the visitor is standing in.
  function visibleUp(obj) {
    for (var n = obj; n; n = n.parent) { if (!n.visible) return false; }
    return true;
  }

  function progressOf(d) {
    if (!d) return 0;
    if (d.duration <= 0) return 1;
    return Math.min(1, Math.max(0, (performance.now() - d.t0) / d.duration));
  }

  function finish(d, completed) {
    if (active !== d) return;
    active = null;
    if (completed) { if (d.onComplete) d.onComplete(); }
    else if (d.onCancel) d.onCancel();
  }

  window.VRDwell = {
    /* Arm a dwell on `el` (an a-entity, or anything with an object3D).
         onComplete  fired once, when the ring fills
         onCancel    fired if it is cancelled or the anchor goes away
         duration    ms; 0 completes on the next tick (the honest way to say
                     "no gate" without every caller branching)
         offset      THREE.Vector3 in the anchor's LOCAL space, for a target
                     whose centre is the wrong place to put a ring
       Returns a token to pass to cancel(). Starting a dwell cancels any other. */
    start: function (el, opts) {
      opts = opts || {};
      var obj = el && (el.object3D || (el.isObject3D ? el : null));
      if (!obj) return null;
      if (active) finish(active, false);
      active = {
        el: el,
        obj3D: obj,
        t0: performance.now(),
        duration: opts.duration == null ? DEFAULT_MS : opts.duration,
        onComplete: opts.onComplete || null,
        onCancel: opts.onCancel || null,
        offset: opts.offset || null,
        token: nextToken++
      };
      return active.token;
    },

    /* Cancel by token. Passing a stale token is a no-op rather than an error,
       which is what makes it safe to call from a mouseleave that may arrive
       after the dwell already completed or was replaced. */
    cancel: function (token) {
      if (!active) return false;
      if (token != null && active.token !== token) return false;
      finish(active, false);
      return true;
    },

    /* True while `el` is the thing being dwelt on — for a caller that wants to
       know whether it is mid-gate without holding the token. */
    isDwelling: function (el) { return !!(active && (!el || active.el === el)); },

    progress: function () { return progressOf(active); },

    // For the harnesses: complete the active dwell now, without waiting out the
    // clock. _dev-preview.html's interaction stepper needs a reach it can step
    // to; making it sit through 900 ms of real time per step would be the
    // §3.1 stalled-pane trap wearing a disguise.
    _finishNow: function () {
      if (!active) return false;
      var d = active;
      d.duration = 0;
      finish(d, true);
      return true;
    },

    _state: function () {
      return { active: !!active, token: active ? active.token : null,
               progress: progressOf(active), shown: shown,
               ringBuilt: !!ring };
    }
  };

  // ── The heartbeat ─────────────────────────────────────────────────────────
  // A system, so there is no markup to forget and no ordering question about
  // whether a component that arms a dwell has loaded yet.
  AFRAME.registerSystem('vr-dwell', {
    tick: function (time, delta) {
      var dt = delta || 16;

      if (active) {
        // The anchor can be removed or hidden under us — a photo tile inside a
        // .hub-cluster that the reader just hid, a card torn down mid-hover.
        if (!active.obj3D.parent || !visibleUp(active.obj3D)) {
          finish(active, false);
        } else if (progressOf(active) >= 1) {
          var d = active;
          active = null;
          if (d.onComplete) d.onComplete();
        }
      }

      var want = active ? 1 : 0;
      // Nothing to draw and nothing fading out: don't build the ring, don't
      // touch the graph. An arrival that never hovers a photo pays nothing.
      if (!want && shown <= 0.001) {
        if (ring && ring.group.visible) ring.group.visible = false;
        shown = 0;
        return;
      }

      if (!ring) {
        ring = buildRing();
        if (!ring) return;   // scene not up yet; try again next tick
      }

      var span = want ? FADE_IN_MS : FADE_OUT_MS;
      shown += (want - shown) * (reducedMotion ? 1 : Math.min(1, dt / span));
      if (want && shown > 0.999) shown = 1;
      if (!want && shown < 0.004) shown = 0;

      ring.group.visible = shown > 0.001;
      if (!ring.group.visible) return;

      ring.trackMat.opacity = TRACK_OPACITY * shown;
      ring.fillMat.uniforms.uOpacity.value = FILL_OPACITY * shown;
      ring.scrimMat.uniforms.uAlpha.value = SCRIM_ALPHA * shown;
      // Hold the last progress through the fade-out, so a cancelled ring fades
      // from where it got to rather than snapping back to empty first.
      if (active) ring.fillMat.uniforms.uProgress.value = progressOf(active);

      // Park it in front of the anchor, facing the camera. Anchoring by WORLD
      // position each frame rather than parenting into the anchor's subtree is
      // what keeps this out of everyone else's business: photo-cloud walks its
      // tile subtree to set renderOrder and the reader disposes its own, and a
      // borrowed indicator sitting inside either would be swept up by both.
      var camera = this.el.camera;
      if (!camera) return;
      var anchorEl = active || null;
      if (!anchorEl) return;   // mid-fade with the anchor gone: leave it where it is

      var p = ring.group.position;
      anchorEl.obj3D.updateMatrixWorld();
      p.setFromMatrixPosition(anchorEl.obj3D.matrixWorld);
      if (anchorEl.offset) {
        p.add(anchorEl.offset.clone().applyQuaternion(
          anchorEl.obj3D.getWorldQuaternion(new THREE.Quaternion())));
      }

      var eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      var toEye = eye.clone().sub(p);
      var dist = toEye.length() || REF_DIST;
      // Lift toward the viewer along the eye direction, not along the anchor's
      // own normal: a photo-cloud tile faces the ORIGIN, not wherever the
      // visitor has walked to, so its normal is only approximately at the eye.
      p.add(toEye.clone().multiplyScalar(LIFT / dist));
      ring.group.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
      ring.group.scale.setScalar(Math.max(0.25, dist / REF_DIST));
    }
  });
})();
