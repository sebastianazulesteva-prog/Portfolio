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
    },
    // Held on for the duration of a walk (walk-controls.js). The one-shot
    // flash() below is right for a room transition but would blink once per
    // step while moving, so continuous motion gets its own steady state.
    // Deliberately dimmer than the flash's 0.55: this one is on the whole time
    // you're moving, and at flash strength it reads as the view going dark
    // rather than as edge softening.
    hold: function (on) {
      var el = this.el;
      if (reducedMotion) return;
      el.removeAttribute('animation__in');
      el.removeAttribute('animation__out');
      if (on) {
        this._held = true;
        el.setAttribute('visible', true);
        el.setAttribute('animation__hold', { property: 'material.opacity', to: 0.30, dur: 220, easing: 'easeOutQuad' });
        return;
      }
      this._held = false;
      el.setAttribute('animation__hold', { property: 'material.opacity', to: 0, dur: 300, easing: 'easeOutQuad' });
      var self = this;
      setTimeout(function () { if (!self._held) el.setAttribute('visible', false); }, 320);
    },
    flash: function () {
      var el = this.el;
      el.setAttribute('visible', true);
      el.setAttribute('animation__in', { property: 'material.opacity', from: 0, to: 0.55, dur: 80 });
      setTimeout(function () {
        el.setAttribute('animation__out', { property: 'material.opacity', from: 0.55, to: 0, dur: 220 });
        setTimeout(function () { el.setAttribute('visible', false); }, 230);
      }, 90);
    }
  });
})();
