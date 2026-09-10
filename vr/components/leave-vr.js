/* ═══ leave-vr.js ═══
   The way OUT of the whole experience — look down at your feet.

   Sebastian: *"add an exit VR button to return to the regular website.
   Possible trigger: user looks straight down at their feet. Confirm whether
   this is buildable or handled natively by Apple."*

   ── The answer to the question ──
   Both, and they are different exits, which is why this is worth building.
   visionOS already lets you leave an immersive space at any time with the
   Digital Crown, and Quest has the system menu; neither can be intercepted,
   overridden or removed by a web page, and neither should be. But both of
   those END THE SESSION AND LEAVE YOU IN THE BROWSER, looking at /vr's flat
   page — which is a WebXR scene with an "Enter VR" button on it, not the
   portfolio. There is no native affordance for "and take me back to the
   website", because the system has no idea this page has a website behind it.
   That last step is the part only this page can do, and it is the part
   Sebastian actually asked for.

   So: `session.end()`, then navigate to `/`. Ending first matters — a
   navigation issued while a session is live races the session teardown, and on
   some runtimes the unload handler runs before the compositor has released the
   display, which drops the visitor into a black immersive space belonging to a
   document that no longer exists.

   ── Why the floor, and why looking down ──
   Every other control in this scene competes for the space in front of you.
   The floor is the one surface with nothing on it, and looking at your feet is
   not something you do by accident while reading — which is exactly the
   property an exit wants. It is also the only "spare" direction: up is the
   dome, forward is content, behind is the photo cloud.

   ── This is NOT a gaze fuse (hard rule 7) ──
   Looking down REVEALS the pad. It does not press it. Leaving is irreversible
   in the strongest sense available here — the session ends and the page
   changes — so it takes an explicit click/pinch, and the reveal is a
   reversible animation that undoes itself the moment you look back up. The
   same line dwell.js draws, on the far side of it: dwell gates a cheap
   reversible preview and even that is not allowed to complete an irreversible
   action.

   ── It lives OUTSIDE .hub-cluster, on purpose ──
   A project room, the reader and the portrait lab all hide (and, as of
   2026-09-08, make un-clickable) everything carrying that class. This is the
   one control that must work from inside all of them, because "I want out" is
   most likely to be felt somewhere that already replaced the hub.

   Usage: <a-entity leave-vr></a-entity>   (once, at the scene root)
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  AFRAME.registerComponent('leave-vr', {
    schema: {
      // Where the flat site is. Root rather than /index.html so it works the
      // same from a local server, a preview and sesteva.com.
      href: { type: 'string', default: '/' },
      // Pitch below the horizon that starts showing the pad, and the shallower
      // angle it hides again at. Hysteresis for the same reason the reading
      // ruler has it: a head held still drifts a degree or two, and a control
      // that blinks at its own boundary reads as a glitch rather than a door.
      showDeg: { type: 'number', default: 45 },
      hideDeg: { type: 'number', default: 32 },
      // How far in front of the feet, in metres. Not directly underfoot: at
      // eye height 1.6 a gaze 45° down meets the floor 1.6 m ahead and a gaze
      // 66° down meets it at 0.71 m, so a pad centred at 0.70 puts the whole
      // range of "looking at my feet" on it, and the pad is already fully faded
      // in by the time the ray reaches it.
      ahead: { type: 'number', default: 0.70 },
      fadeMs: { type: 'number', default: 260 }
    },

    init: function () {
      this.k = 0;              // 0..1 reveal
      this.shown = false;
      this.leaving = false;
      this._q = new THREE.Quaternion();
      this._f = new THREE.Vector3();
      this._camPos = new THREE.Vector3();
      this._build();
    },

    _build: function () {
      var self = this;

      // A pad lying ON the floor, not a card standing on it. Flat is what makes
      // it read as part of the ground you are looking at rather than as one
      // more panel that happens to be low down — and a standing card at the
      // feet is edge-on from above, which is where you are looking.
      var root = document.createElement('a-entity');
      root.setAttribute('rotation', '-90 0 0');   // A-Frame's floor convention
      this.el.appendChild(root);
      this.root = root;

      var W = 0.78, H = 0.34;

      // ── UNLIT, and the floor is the reason ────────────────────────────
      // exit-button.js draws its console deck in this same #141816 through
      // VRScrollArrows.litMaterial and it reads as dark furniture — because
      // that deck stands up facing the viewer, edge-on to a key rack that
      // hangs at y 3.3. This pad lies FLAT and points its normal straight up
      // at those four warm lights, so the identical colour and the identical
      // material came back tan. Rendered and looked at, which is the only way
      // that shows up: the numbers are the same in both places.
      //
      // So the pad opts out of the rack. It is a hole in the floor, not a
      // surface in the room, and the one thing on it that should catch light
      // is the mint rule — which carries its own colour here rather than
      // borrowing the rack's.
      var deck = new THREE.Mesh(
        VRScrollArrows.roundedRectGeometry(W, H, H * 0.38),
        new THREE.MeshBasicMaterial({ color: '#101413', transparent: true, opacity: 0, depthWrite: false })
      );
      root.setObject3D('leave-deck', deck);
      this.deck = deck;

      var rim = new THREE.Mesh(
        VRScrollArrows.roundedRectGeometry(W + 0.020, H + 0.020, (H + 0.020) * 0.38),
        new THREE.MeshBasicMaterial({ color: '#58b892', transparent: true, opacity: 0, depthWrite: false })
      );
      rim.position.z = -0.003;
      root.setObject3D('leave-rim', rim);
      this.rim = rim;

      // Two lines at two sizes, so two entities: troika lays out one block at
      // one size, and these are not peers. The first is the action; the second
      // is the destination, and saying it out loud is the whole reason this
      // exists rather than being left to the Digital Crown (see the header).
      //
      // 'Leave VR' at body size subtends 1.0° at the ~1.75 m slant from the eye
      // to a pad 0.70 m ahead on the floor — a little over the reading guide
      // toggle's 0.80°, which is the smallest type in the scene that Sebastian
      // has signed off on, and this one is read at a glance rather than studied.
      var line1 = document.createElement('a-entity');
      line1.setAttribute('troika-text', {
        value: 'Leave VR', align: 'center', anchor: 'center', baseline: 'bottom',
        color: '#eafaf2', fillOpacity: 0, font: VRFonts.bodyBold(),
        fontSize: VRType.body(), maxWidth: W * 0.92
      });
      line1.object3D.position.set(0, 0.012, 0.006);
      root.appendChild(line1);

      var line2 = document.createElement('a-entity');
      line2.setAttribute('troika-text', {
        value: 'back to the website', align: 'center', anchor: 'center', baseline: 'top',
        color: '#9fe6c6', fillOpacity: 0, font: VRFonts.body(),
        fontSize: VRType.label(), maxWidth: W * 0.92
      });
      line2.object3D.position.set(0, -0.014, 0.006);
      root.appendChild(line2);
      this.lines = [{ el: line1, base: 1 }, { el: line2, base: 0.85 }];

      // The hit target is the deck itself. `.clickable` on the ENTITY, and the
      // meshes attached with setObject3D — that pair is what actually puts
      // something in a raycaster's list. A raw object3D.add() renders fine and
      // is invisible to every ray in the scene (see the long note in
      // project-room.js's PDF station, which is where that cost real time).
      root.classList.add('clickable');
      this._onClick = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        // Only when it is actually up. The pad is a live hit target the whole
        // time — taking it in and out of the ray lists on every glance would
        // mean a refreshObjects() per look — so the reveal is what gates it.
        if (self.k < 0.6) return;
        self.leave();
      };
      root.addEventListener('click', this._onClick);
    },

    // End the session first, THEN navigate — see the header.
    leave: function () {
      if (this.leaving) return;
      this.leaving = true;
      var href = this.data.href;
      function go() { window.location.href = href; }
      var renderer = this.el.sceneEl && this.el.sceneEl.renderer;
      var session = renderer && renderer.xr && renderer.xr.getSession && renderer.xr.getSession();
      if (!session) { go(); return; }
      // Belt and braces: `end()` resolves on every runtime that implements it,
      // but a navigation that never happens strands the visitor in a scene
      // whose exit they have already pressed — so a timer runs it regardless.
      var done = false;
      function once() { if (done) return; done = true; go(); }
      setTimeout(once, 1200);
      try {
        var p = session.end();
        if (p && p.then) p.then(once, once); else once();
      } catch (e) { once(); }
    },

    tick: function (time, delta) {
      var cam = this.el.sceneEl && this.el.sceneEl.camera;
      if (!cam) return;

      cam.getWorldPosition(this._camPos);
      cam.getWorldQuaternion(this._q);
      this._f.set(0, 0, -1).applyQuaternion(this._q);
      var pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(this._f.y, -1, 1)));

      if (pitch <= -this.data.showDeg) this.shown = true;
      else if (pitch >= -this.data.hideDeg) this.shown = false;

      var want = this.shown ? 1 : 0;
      if (reducedMotion) this.k = want;
      else this.k += (want - this.k) * Math.min(1, (delta || 16) / this.data.fadeMs);

      var vis = this.k > 0.004;
      if (this.root.object3D.visible !== vis) this.root.object3D.visible = vis;
      if (!vis) return;

      // Follow the HEAD's ground position, not the rig's: with room-scale
      // tracking the two are metres apart after a walk, and the pad belongs
      // under the visitor's feet rather than under the origin they started at.
      // Yawed to the heading so the label is upright from where they are
      // standing however they have turned.
      var yaw = Math.atan2(-this._f.x, -this._f.z);
      this.root.object3D.position.set(
        this._camPos.x - Math.sin(yaw) * this.data.ahead,
        0.015,
        this._camPos.z - Math.cos(yaw) * this.data.ahead
      );
      this.root.object3D.rotation.set(-Math.PI / 2, 0, -yaw);

      this.deck.material.opacity = 0.92 * this.k;
      this.rim.material.opacity = 0.85 * this.k;
      for (var i = 0; i < this.lines.length; i++) {
        this.lines[i].el.setAttribute('troika-text', 'fillOpacity', this.lines[i].base * this.k);
      }
    },

    remove: function () {
      if (this.root) {
        this.root.removeEventListener('click', this._onClick);
        ['leave-deck', 'leave-rim'].forEach(function (n) {
          var o = this.root.getObject3D(n);
          if (!o) return;
          this.root.removeObject3D(n);
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        }, this);
      }
    }
  });
})();
