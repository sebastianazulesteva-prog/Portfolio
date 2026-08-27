/* ═══ sunflower.js ═══
   The "sunflower effect": a panel slowly turns to face wherever the viewer
   actually is, like a sunflower tracking the sun. Instead of being aimed once
   at a seated head and then staying fixed, a panel keeps orienting itself at
   the camera as the viewer moves or looks around.

   Why this exists: constellation.js aims each panel at a single assumed eye
   position (`eyeHeight`, default 1.6m) at build time. That is correct for
   exactly one viewer pose — the moment someone stands, crouches, or leans
   within the command zone, every panel is subtly mis-aimed, and the ones off
   to the sides are seen at an increasingly oblique angle. This fixes that
   continuously rather than per-pose.

   Deliberately SLOW and steady, per Sebastian — a drift, not a snap. Panels
   that whip around to face you read as jittery and, in a headset, as
   uncomfortable: the panel appears to react to every small head tremor. A low
   turn rate means it settles a beat after you do, which reads as calm and
   deliberate.

   Implementation notes:
     • Rotates only as much as needed each frame, capped by MAX_TURN_RATE
       (deg/sec), so the speed is FRAME-RATE INDEPENDENT — a 120fps headset and
       a 60fps laptop drift at the same real-world speed. Lerping by a fixed
       fraction per frame would make it twice as fast at double the frame rate.
     • Uses quaternions via Object3D.lookAt + Quaternion.rotateTowards rather
       than eulers. Aiming at a target that is above/below AND off to the side
       is a combined pitch+yaw; doing that with separate euler axes gimbals and
       twists the panel's roll.
     • Respects prefers-reduced-motion: with it set, the panel simply faces the
       camera immediately and stops animating, so nothing continuously moves in
       the periphery for someone who asked for less motion.

   Usage:  <a-entity hub-panel="..." sunflower></a-entity>
           <a-entity sunflower="rate: 25; maxYaw: 60"></a-entity>
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  AFRAME.registerComponent('sunflower', {
    schema: {
      // Degrees per second. Slow on purpose — see the note above.
      rate: { type: 'number', default: 18 },
      // Don't bother re-aiming for sub-threshold changes; stops the panel
      // trembling in response to head-tracking noise when the viewer is still.
      deadzoneDeg: { type: 'number', default: 0.4 },
      // Optional clamp on how far a panel will turn from its ORIGINAL
      // orientation. 0 = unlimited. Useful if a cluster should still read as
      // belonging to its own angular zone rather than all panels everywhere
      // rotating to point at one spot.
      maxTurnDeg: { type: 'number', default: 0 },
      enabled: { type: 'boolean', default: true }
    },

    init: function () {
      this._camWorld = new THREE.Vector3();
      this._selfWorld = new THREE.Vector3();
      this._targetQuat = new THREE.Quaternion();
      this._restQuat = null;   // original orientation, for maxTurnDeg
      this._aimHelper = new THREE.Object3D();
      this._settled = false;
    },

    tick: function (time, delta) {
      if (!this.data.enabled) return;
      var cam = this.el.sceneEl.camera;
      if (!cam) return;

      var obj = this.el.object3D;
      if (!this._restQuat) this._restQuat = obj.quaternion.clone();

      cam.getWorldPosition(this._camWorld);
      obj.getWorldPosition(this._selfWorld);

      // Build the desired orientation with a throwaway helper placed at our
      // own world position, looking at the camera. Copying the helper's
      // quaternion gives a clean combined pitch+yaw with no roll — see the
      // gimbal note above.
      this._aimHelper.position.copy(this._selfWorld);
      this._aimHelper.up.set(0, 1, 0);
      this._aimHelper.lookAt(this._camWorld);
      this._aimHelper.updateMatrix();
      this._targetQuat.copy(this._aimHelper.quaternion);

      // The helper's orientation is in WORLD space; the panel's quaternion is
      // relative to its parent. constellation.js nests every panel inside a
      // rotated outer entity, so skipping this conversion would leave each
      // panel off by its own zone's angle.
      var parent = obj.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        var parentQuat = new THREE.Quaternion();
        parent.getWorldQuaternion(parentQuat);
        this._targetQuat.premultiply(parentQuat.invert());
      }

      if (this.data.maxTurnDeg > 0) {
        var fromRest = this._restQuat.angleTo(this._targetQuat);
        var limit = THREE.MathUtils.degToRad(this.data.maxTurnDeg);
        if (fromRest > limit) {
          // Clamp: walk from the rest pose toward the aim, but only `limit` far.
          this._targetQuat.copy(this._restQuat).rotateTowards(this._targetQuat, limit);
        }
      }

      var remaining = obj.quaternion.angleTo(this._targetQuat);
      if (remaining < THREE.MathUtils.degToRad(this.data.deadzoneDeg)) return;

      if (reducedMotion) {
        obj.quaternion.copy(this._targetQuat);
        return;
      }

      // delta is ms. Capping the step by rate*dt is what makes the drift
      // frame-rate independent.
      var step = THREE.MathUtils.degToRad(this.data.rate) * ((delta || 16) / 1000);
      obj.quaternion.rotateTowards(this._targetQuat, step);
    }
  });
})();
