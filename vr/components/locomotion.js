/* ═══ locomotion.js ═══
   Comfort-first movement: teleport + snap-turn only, never smooth locomotion
   (base spec guardrail — nausea/comfort is non-negotiable).

   - teleport-controls (from aframe-extras, c-frame org) handles the arc +
     teleport itself, bound to the trigger/grip on tracked controllers.
   - "snap-turn" rotates the rig in fixed steps on thumbstick input.
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
      var x = evt.detail.axis[2] !== undefined ? evt.detail.axis[2] : evt.detail.axis[0];
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
      m.onBeforeCompile = function (shader) {
        shader.vertexShader = 'varying vec3 vVigView;\n' + shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n  vVigView = mvPosition.xyz;'
        );
        shader.fragmentShader = 'varying vec3 vVigView;\n' + shader.fragmentShader.replace(
          '#include <alphamap_fragment>',
          '#include <alphamap_fragment>\n'
          // vigC = cos(angle off the view axis): 1 dead ahead, ~0.5 in the
          // corners of a 16:9 80deg frame. Written as 1.0 - smoothstep(lo, hi)
          // rather than smoothstep(hi, lo) because GLSL leaves smoothstep
          // UNDEFINED when edge0 >= edge1 — the reversed form compiled clean
          // and returned alpha 0 everywhere, i.e. a vignette that silently
          // never drew.
          + '  float vigC = -normalize(vVigView).z;\n  diffuseColor.a *= 1.0 - smoothstep(0.38, 0.90, vigC);'
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
