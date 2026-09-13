/* ═══ locomotion.js ═══
   Comfort-first movement: teleport + snap-turn only, never smooth locomotion
   (base spec guardrail — nausea/comfort is non-negotiable).

   - teleport-controls (from aframe-extras, c-frame org) handles the arc +
     teleport itself, bound to the trigger/grip on tracked controllers.
   - "snap-turn" rotates the rig in fixed steps on thumbstick input. RIGHT hand
     only since 2026-09-11 — the left one drives bounded walking now
     (walk-controls.js's `stick-walk`), and with snap-turn on both hands a
     strafe also turned you.
   - "recenter-button" puts the A button on the right controller through the
     same recentre the DOM HUD's crosshair uses. In an immersive session that
     2D control is not rendered at all, so without this there is no way back to
     the seat from inside a headset.
   - "comfort-vignette" briefly darkens the view edges during a teleport.

   Both respect prefers-reduced-motion: under reduced motion the vignette is
   skipped and turns are instant (no eased camera moves). */

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  AFRAME.registerComponent('snap-turn', {
    schema: {
      degrees: { type: 'number', default: 35 },
      deadzone: { type: 'number', default: 0.5 }
    },
    init: function () {
      this._ready = true;
      this.onAxisMove = this.onAxisMove.bind(this);
      this.el.addEventListener('axismove', this.onAxisMove);
    },
    onAxisMove: function (evt) {
      // The WebXR `oculus-touch` profile puts the thumbstick at axes [2],[3];
      // axes [0],[1] are the absent touchpad and read a constant 0. The older
      // WebVR mapping and some generic profiles use [0],[1]. Length is the
      // honest discriminator — "[2] exists" is also true of a touchpad
      // controller, and reading it there drives a turn off the wrong control.
      var a = evt.detail.axis;
      if (!a) return;
      var x = a.length >= 4 ? a[2] : a[0];
      if (x === undefined) return;
      var rig = this.el.sceneEl.querySelector('#rig');
      if (!rig) return;

      if (Math.abs(x) < this.data.deadzone) { this._ready = true; return; }
      if (!this._ready) return;
      this._ready = false;

      var turn = this.data.degrees * (x > 0 ? 1 : -1);
      var current = rig.getAttribute('rotation');
      rig.setAttribute('rotation', { x: current.x, y: current.y + turn, z: current.z });
    }
  });

  /* ═══ recenter-button ═══
     A on the right controller = the HUD's crosshair. Mount on the right hand.

     Why a button at all: `hud.js` owns recentre, but its control lives in the
     2D overlay (vr.css), and the overlay is not rendered in an immersive
     session. Walking is bounded by a soft ellipse you decelerate into, so it is
     genuinely possible to end up parked against the edge facing nowhere with no
     way back — which is the state this exists for.

     `abuttondown` comes from `oculus-touch-controls`, which maps the right
     hand's buttons as [trigger, grip, none, thumbstick, abutton, bbutton,
     surface] and emits `<name>down`/`<name>up`. A controller that matches only
     `generic-tracked-controller-controls` has no face buttons in its mapping
     and simply never fires this; nothing breaks, there is just no shortcut.

     Deliberately NOT the thumbstick click: that is the control the same thumb
     is already holding to walk, and teleporting yourself back to the seat
     mid-stride is a hard mispress to forgive. */
  AFRAME.registerComponent('recenter-button', {
    init: function () {
      this.onPress = function () {
        if (window.VRHud && window.VRHud.recenter) window.VRHud.recenter();
      };
      this.el.addEventListener('abuttondown', this.onPress);
    },
    remove: function () {
      this.el.removeEventListener('abuttondown', this.onPress);
    }
  });

  AFRAME.registerComponent('comfort-vignette', {
    init: function () {
      this.onTeleported = function () {
        if (reducedMotion) return;
        var vignette = document.querySelector('#comfortVignette');
        if (vignette) vignette.emit('flash');
      };
      this.el.addEventListener('teleported', this.onTeleported);
    }
  });

  // Was always rendered (visible: true, opacity 0 when idle) — a low-poly
  // (8×8 segment) BackSide sphere sitting right at the camera position, at
  // grazing silhouette angles, is exactly the kind of thing that reads as a
  // faint dark spherical outline when idle (VR_BUGFIX_NOTES.md item 9: "a
  // faint dark spherical outline... looking down/around"). Toggling `visible`
  // off between flashes means it isn't in the scene graph at all except
  // during the brief transition flash, which is the robust fix — no reliance
  // on opacity/blending edge cases to keep it truly invisible at rest.
  AFRAME.registerComponent('vignette-flash', {
    init: function () {
      this.el.setAttribute('visible', false);
      // Shared with the injected shader below, by reference, so setFlat() can
      // change it without a recompile. 0 = radial vignette (walking), 1 = flat
      // blackout (a room transition, which has to actually COVER the swap).
      this._flat = { value: 0 };
      // The radial edges, as uniforms rather than shader literals, so the mask
      // can be OPENED from the centre outward. wake.js drives these: starting
      // at (0.995, 1.0) the view is black but for a pinhole dead ahead, and
      // easing them down to the resting (0.38, 0.90) grows that hole out to the
      // edges — which is the whole arrival, "awareness branching out from the
      // centre". Shared by reference like _flat, so no recompile per frame.
      this._lo = { value: 0.38 };
      this._hi = { value: 0.90 };
      this.el.addEventListener('flash', this.flash.bind(this));
      this._harden();
    },

    // ── Two things this sphere got wrong, both invisible until you held it on ──
    //
    // 1. DEPTH. It sits at the eye, so in view space its centre is z = 0. That
    //    is the LARGEST z of anything on screen, and three.js sorts the
    //    transparent pass back-to-front, so it drew BEFORE every panel. With
    //    depthWrite on it stamped the depth buffer at 0.3 m and every
    //    transparent object further away failed the depth test. As a 200 ms
    //    flash that just looked like a flash. Held on for the duration of a
    //    walk (walk-controls.js) it read as "the whole scene disappears the
    //    moment I press W" — dome, floor and rug survived only because they
    //    are opaque and had already been drawn. An overlay must not
    //    participate in depth at all: no test, no write, and composite last.
    //
    // 2. IT WAS NOT A VIGNETTE. A flat black BackSide sphere is a uniform
    //    screen dim, so "comfort vignette" at 0.30 meant the entire view went
    //    30% darker while you moved, rather than the edges softening. The
    //    injected radial term below fades alpha in by the angle off the view
    //    axis, computed in VIEW space (`-normalize(mvPosition).z`) so it stays
    //    centred on wherever the head is looking, independent of how the rig
    //    or the sphere are oriented. Injecting into the stock MeshBasicMaterial
    //    rather than swapping in a ShaderMaterial keeps `material.opacity` the
    //    single strength knob, which is what both animations below drive.
    _harden: function () {
      var el = this.el;
      // Persistent, not one-shot, and re-entrant: A-Frame's material component
      // builds its own material AFTER this component's init, and may rebuild it
      // later, so a single early pass patches an object that gets thrown away.
      // The flag lives on the material itself, so re-running against a fresh
      // one re-patches it and re-running against the same one is a no-op. Both
      // public entry points below call this again before showing the sphere.
      if (!this._watching) {
        this._watching = true;
        var self = this;
        el.addEventListener('object3dset', function (e) {
          if (e.detail.type === 'mesh') self._harden();
        });
      }
      var mesh = el.getObject3D('mesh');
      if (!mesh) return;
      var m = mesh.material;
      if (!m || m.__vignetteHardened) return;
      m.__vignetteHardened = true;
      m.depthTest = false;
      m.depthWrite = false;
      mesh.renderOrder = 999;
      mesh.frustumCulled = false;
      var self2 = this;
      m.onBeforeCompile = function (shader) {
        shader.uniforms.uVigFlat = self2._flat;
        shader.uniforms.uVigLo = self2._lo;
        shader.uniforms.uVigHi = self2._hi;
        shader.vertexShader = 'varying vec3 vVigView;\n' + shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n  vVigView = mvPosition.xyz;'
        );
        shader.fragmentShader = 'varying vec3 vVigView;\nuniform float uVigFlat;\nuniform float uVigLo;\nuniform float uVigHi;\n' + shader.fragmentShader.replace(
          '#include <alphamap_fragment>',
          '#include <alphamap_fragment>\n'
          // vigC = cos(angle off the view axis): 1 dead ahead, ~0.5 in the
          // corners of a 16:9 80deg frame. Written as 1.0 - smoothstep(lo, hi)
          // rather than smoothstep(hi, lo) because GLSL leaves smoothstep
          // UNDEFINED when edge0 >= edge1 — the reversed form compiled clean
          // and returned alpha 0 everywhere, i.e. a vignette that silently
          // never drew.
          // uVigFlat lifts the radial term to a uniform screen fill. The radial
          // vignette is right for walking, and WRONG for a room transition: dead
          // ahead vigC is 1, so `1.0 - smoothstep(0.38, 0.90, vigC)` is exactly
          // 0 there and the centre of the view stays perfectly clear no matter
          // how high material.opacity goes. Both room transitions
          // (project-room.js, pdf-reader.js) tween that opacity to 0.95 in the
          // belief that it dips to black and hides the swap — after the radial
          // term was added for walking they were swapping the world in plain
          // view. Anything that needs real cover calls setFlat(true) first.
          + '  float vigC = -normalize(vVigView).z;\n'
          // uVigLo/uVigHi were the literals 0.38 and 0.90. GLSL leaves
          // smoothstep undefined for edge0 >= edge1, and an animated pair can
          // cross, so they are clamped into order here rather than trusted.
          + '  float vLo = min(uVigLo, uVigHi - 0.001);\n'
          + '  diffuseColor.a *= mix(1.0 - smoothstep(vLo, uVigHi, vigC), 1.0, uVigFlat);'
        );
      };
      m.needsUpdate = true;
    },
    // Held on for the duration of a walk (walk-controls.js). The one-shot
    // flash() below is right for a room transition but would blink once per
    // step while moving, so continuous motion gets its own steady state.
    // Still dimmer than the flash's 0.55: this one is on the whole time you're
    // moving. Now that the radial term in _harden() confines it to the edges,
    // it can be stronger than the old flat 0.30 without darkening the view.
    // Open or close the clear hole in the middle of the mask. (1.0, 1.0) is
    // effectively shut; the resting vignette is (0.38, 0.90).
    setRadius: function (lo, hi) {
      this._harden();
      this._lo.value = lo;
      this._hi.value = hi;
    },
    resetRadius: function () { this.setRadius(0.38, 0.90); },

    hold: function (on) {
      var el = this.el;
      if (reducedMotion) return;
      this._harden();
      el.removeAttribute('animation__in');
      el.removeAttribute('animation__out');
      if (on) {
        this._held = true;
        el.setAttribute('visible', true);
        el.setAttribute('animation__hold', { property: 'material.opacity', to: 0.42, dur: 220, easing: 'easeOutQuad' });
        return;
      }
      this._held = false;
      el.setAttribute('animation__hold', { property: 'material.opacity', to: 0, dur: 300, easing: 'easeOutQuad' });
      var self = this;
      setTimeout(function () { if (!self._held) el.setAttribute('visible', false); }, 320);
    },
    // Flat screen fill instead of an edge vignette, for the duration of a
    // transition that has to hide a world swap. Idempotent; always paired with
    // a setFlat(false) when the transition finishes, so walking gets its
    // edges-only treatment back.
    setFlat: function (on) { this._flat.value = on ? 1 : 0; },

    flash: function () {
      var el = this.el;
      this._harden();
      el.setAttribute('visible', true);
      el.setAttribute('animation__in', { property: 'material.opacity', from: 0, to: 0.55, dur: 80 });
      setTimeout(function () {
        el.setAttribute('animation__out', { property: 'material.opacity', from: 0.55, to: 0, dur: 220 });
        setTimeout(function () { el.setAttribute('visible', false); }, 230);
      }, 90);
    }
  });
})();
