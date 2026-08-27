/* ═══ walk-controls.js ═══
   Bounded walking — desktop WASD + arrow keys, phone touch joystick.
   (VR_AI_BUILD_GUIDE.md §9.5.)

   ── Why this exists, and what it deliberately overrides ──
   The build guide's rule 7 said "snap turn only, no teleport, no smooth
   locomotion", chosen for comfort. Sebastian asked for walking explicitly and
   confirmed the override after that trade-off was put to him, so translation is
   now smooth and user-driven. Rotation is untouched: snap-turn still handles all
   turning, there is still no teleport, and there is still no smooth *look*.

   ── Why it is BOUNDED, and how the bound is meant to feel ──
   Every constellation card sits at radius 2.0-2.3 m from the origin, and the
   photo cloud starts at 2.21 m. Free roam of the dome would walk you straight
   through the cards — the scene is a composition seen from a spot, not a room
   to cross. So position is clamped to a circle.

   The first pass used 1.1 m at 1.0 m/s, which was too tight to read as walking:
   you reached the clamp in about a second and spent most of your time pressed
   against it. 1.7 m at 1.7 m/s is the game-feel version — a couple of seconds
   of travel in any direction, close enough to a card to read it comfortably
   (2.0 m -> ~0.3 m) while still stopping short of any card's plane.

   The edge is SOFT, which is most of why it stopped feeling like a bug. A hard
   clamp with a slide term still ends in an abrupt halt; instead the outward
   component of the *wanted* velocity is bled off over the last `softEdge`
   metres, so you decelerate into the boundary the way you would into a wall in
   any first-person game. The hard clamp stays underneath as a backstop.

   Tune with ?walkRadius=<m> and ?walkSpeed=<m/s>; ?walk=0 disables it entirely
   (for comparing against the old fixed-viewpoint composition).

   ── Reduced motion ──
   Movement is continuously user-driven, not an animation played at you, so it
   is NOT disabled under prefers-reduced-motion — silently removing a control
   would read as broken (guide rule 4). What reduced motion does change: the
   velocity ramp is skipped (input applies immediately, no glide) and the motion
   vignette never appears.

   Usage — one component on the rig, which owns rig position:
     <a-entity id="rig" walk-controls></a-entity>
   Exposes window.VRWalk = { setAxis, axis, active, radius } for the dev
   harnesses and for anything else that wants to drive movement.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var params = new URLSearchParams(location.search);
  var DISABLED = params.get('walk') === '0';

  // Both WASD and the arrows map to the same four directions — "classic WASD +
  // arrow key controls" per Sebastian. The arrows are NOT bound to turning:
  // looking is the mouse's job on desktop (§9.5) and turning has its own
  // snap-turn controls, so making Left/Right strafe keeps every movement key
  // doing the same kind of thing.
  var KEY_DIR = {
    KeyW: [0, 1], ArrowUp: [0, 1],
    KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0]
  };

  AFRAME.registerComponent('walk-controls', {
    schema: {
      speed: { type: 'number', default: 1.7 },   // metres/second at full deflection
      radius: { type: 'number', default: 1.7 },  // clamp, metres from the seat
      ramp: { type: 'number', default: 0.14 },   // seconds to reach full speed
      softEdge: { type: 'number', default: 0.4 } // metres of decel before the clamp
    },

    init: function () {
      this.keys = {};
      this.stick = { x: 0, y: 0 };     // joystick, -1..1 each axis
      this.axis = { x: 0, y: 0 };      // resolved input this frame
      this.vel = new THREE.Vector3();
      this.moving = false;

      if (params.get('walkRadius')) this.data.radius = parseFloat(params.get('walkRadius'));
      if (params.get('walkSpeed')) this.data.speed = parseFloat(params.get('walkSpeed'));

      this._forward = new THREE.Vector3();
      this._right = new THREE.Vector3();
      this._want = new THREE.Vector3();
      this._camQuat = new THREE.Quaternion();

      this.onKeyDown = this.onKeyDown.bind(this);
      this.onKeyUp = this.onKeyUp.bind(this);
      this.onBlur = this.onBlur.bind(this);
      if (!DISABLED) {
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        // Without this, holding W and then tabbing away leaves the key stuck
        // down and the rig grinding against the clamp forever.
        window.addEventListener('blur', this.onBlur);
      }

      this._mountVignette();
      this._mountJoystick();

      var self = this;
      window.VRWalk = {
        setAxis: function (x, y) { self.setAxis(x, y); },
        get axis() { return { x: self.axis.x, y: self.axis.y }; },
        get active() { return self.moving; },
        get radius() { return self.data.radius; },
        disabled: DISABLED
      };
    },

    remove: function () {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
    },

    onKeyDown: function (evt) {
      if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
      if (!KEY_DIR[evt.code]) return;
      this.keys[evt.code] = true;
      // The arrows scroll the page otherwise, which on a full-bleed canvas
      // reads as the whole scene twitching.
      evt.preventDefault();
    },

    onKeyUp: function (evt) {
      if (KEY_DIR[evt.code]) this.keys[evt.code] = false;
    },

    onBlur: function () { this.keys = {}; this.stick.x = this.stick.y = 0; },

    // Joystick input, -1..1 per axis. y is FORWARD-positive, matching KEY_DIR.
    setAxis: function (x, y) {
      this.stick.x = Math.max(-1, Math.min(1, x || 0));
      this.stick.y = Math.max(-1, Math.min(1, y || 0));
    },

    tick: function (time, delta) {
      if (DISABLED) return;
      var dt = Math.min(delta || 0, 100) / 1000; // cap: a long frame shouldn't teleport you
      if (!dt) return;

      // Keys first, joystick layered on top — a phone with a bluetooth keyboard
      // can use either without one zeroing the other.
      var ix = this.stick.x, iy = this.stick.y;
      for (var code in this.keys) {
        if (!this.keys[code]) continue;
        ix += KEY_DIR[code][0];
        iy += KEY_DIR[code][1];
      }
      var mag = Math.sqrt(ix * ix + iy * iy);
      if (mag > 1) { ix /= mag; iy /= mag; }   // no diagonal speed bonus
      this.axis.x = ix; this.axis.y = iy;

      // Direction is taken from where the CAMERA is looking, not the rig's own
      // rotation: look-controls turns the head inside the rig, so using the rig
      // would make "forward" mean whatever direction you were facing at the
      // last snap-turn instead of where you're actually looking.
      var camEl = this.el.sceneEl.camera && this.el.sceneEl.camera.el;
      var camObj = camEl ? camEl.object3D : null;
      if (!camObj) return;
      camObj.getWorldQuaternion(this._camQuat);

      this._forward.set(0, 0, -1).applyQuaternion(this._camQuat);
      this._forward.y = 0;
      // Looking straight up or down leaves no horizontal component to walk
      // along; keep the last usable heading rather than stalling.
      if (this._forward.lengthSq() < 1e-6) this._forward.set(0, 0, -1);
      this._forward.normalize();
      // right = forward × up, which for forward (fx, 0, fz) and up (0,1,0) is
      // (-fz, 0, fx). Getting this backwards is silent and plausible-looking —
      // it was, and W+D walked forward-LEFT. Sanity check: looking down -Z,
      // forward is (0,0,-1) and right must come out (1,0,0).
      this._right.set(-this._forward.z, 0, this._forward.x);

      this._want.set(0, 0, 0)
        .addScaledVector(this._forward, iy)
        .addScaledVector(this._right, ix)
        .multiplyScalar(this.data.speed);

      // ── Soft boundary ──
      // Bleed the OUTWARD part of the wanted velocity away over the last
      // `softEdge` metres, before the ramp sees it, so approaching the edge is
      // a deceleration rather than an impact. Sideways and inward motion are
      // untouched, so you can still run along the boundary at full speed.
      var pos = this.el.object3D.position;
      var r = this.data.radius;
      var soft = Math.min(this.data.softEdge, r * 0.5);
      var d0 = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
      if (soft > 0 && d0 > r - soft) {
        var ux = pos.x / (d0 || 1), uz = pos.z / (d0 || 1);
        var out0 = this._want.x * ux + this._want.z * uz;
        if (out0 > 0) {
          var keep = Math.max(0, (r - d0) / soft);
          this._want.x -= out0 * (1 - keep) * ux;
          this._want.z -= out0 * (1 - keep) * uz;
        }
      }

      if (reducedMotion || this.data.ramp <= 0) {
        this.vel.copy(this._want);
      } else {
        // Frame-rate independent ease toward the wanted velocity, so the glide
        // feels the same at 60 and 120 fps (the same lesson as sunflower.js's
        // deg/sec rate limiting).
        var k = 1 - Math.exp(-dt / this.data.ramp);
        this.vel.lerp(this._want, k);
      }

      var moving = this.vel.lengthSq() > 1e-5;

      if (moving) {
        pos.x += this.vel.x * dt;
        pos.z += this.vel.z * dt;

        // ── Hard clamp, the backstop under the soft edge above ──
        var d = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
        if (d > r) {
          var s = r / d;
          pos.x *= s; pos.z *= s;
          // Kill the OUTWARD part of the velocity so you slide along the
          // boundary instead of pressing into it and stopping dead — otherwise
          // walking into the edge at an angle feels like hitting glue.
          var nx = pos.x / r, nz = pos.z / r;
          var outward = this.vel.x * nx + this.vel.z * nz;
          if (outward > 0) { this.vel.x -= outward * nx; this.vel.z -= outward * nz; }
        }
      }

      if (moving !== this.moving) {
        this.moving = moving;
        this._holdVignette(moving);
      }
    },

    // ── Comfort vignette, held for the duration of the move ──
    // vignette-flash's one-shot flash is right for a room transition but wrong
    // for walking: it would blink once per step. This holds it on while you move
    // and fades it when you stop.
    _holdVignette: function (on) {
      var v = document.querySelector('#comfortVignette');
      if (!v || reducedMotion) return;
      if (v.components && v.components['vignette-flash'] && v.components['vignette-flash'].hold) {
        v.components['vignette-flash'].hold(on);
      }
    },

    // The vignette is authored as a scene-level entity at the seat's eye
    // position. Once the rig can move, a world-fixed vignette gets left behind
    // the moment you walk — it has to ride with the viewer. Reparenting it into
    // the rig is a no-op at the seat (rig at origin ⇒ same world transform), so
    // room transitions look exactly as they did.
    _mountVignette: function () {
      var v = document.querySelector('#comfortVignette');
      if (v && v.parentNode !== this.el) this.el.appendChild(v);
    },

    // ── Touch joystick ──
    // Lives in the 2D overlay rather than in-scene: it is the phone's movement
    // control, and the phone is looking at a flat canvas. Pointer events cover
    // touch and mouse with one path.
    _mountJoystick: function () {
      var pad = document.getElementById('moveStick');
      var thumb = document.getElementById('moveThumb');
      if (!pad || !thumb || DISABLED) return;
      var self = this;
      var active = false, id = null, cx = 0, cy = 0, reach = 1;

      function start(e) {
        var r = pad.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        // The thumb travels within the pad, so its own radius comes off the
        // reach — otherwise full deflection pushes it half outside the ring.
        reach = Math.max(1, r.width / 2 - thumb.offsetWidth / 2);
        active = true; id = e.pointerId;
        pad.classList.add('active');
        if (pad.setPointerCapture) { try { pad.setPointerCapture(id); } catch (err) {} }
        move(e);
      }
      function move(e) {
        if (!active || (id !== null && e.pointerId !== id)) return;
        var dx = e.clientX - cx, dy = e.clientY - cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > reach) { dx *= reach / d; dy *= reach / d; }
        thumb.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        // Screen y grows downward; forward is up.
        self.setAxis(dx / reach, -dy / reach);
        e.preventDefault();
      }
      function end(e) {
        if (!active || (id !== null && e.pointerId !== id)) return;
        active = false; id = null;
        pad.classList.remove('active');
        thumb.style.transform = '';
        self.setAxis(0, 0);
      }

      pad.addEventListener('pointerdown', start);
      pad.addEventListener('pointermove', move);
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      pad.addEventListener('lostpointercapture', end);
    }
  });
})();
