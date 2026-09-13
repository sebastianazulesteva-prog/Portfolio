/* ═══ portrait-lab.js ═══
   A room holding all three depth treatments of the contact photo, side by side,
   so they can be compared in a headset instead of argued about on a monitor.

     spatial photo   stereo pair, one image per eye. Binocular depth only —
                     move your head and nothing new appears.
     relief          the photo displaced by a baked depth map, behind a portal.
                     Real geometry, so it re-projects as you move.
     splat           SHARP's 3D gaussians. Knows what is behind an edge.

   All three are built from the SAME SHARP reconstruction of the same
   photograph, at the same size, with the same feathered opening, so the only
   thing that differs between them is the depth technique. That is the entire
   point; matching them was more work than building them.

   It reuses the hub's own hide/show convention rather than inventing one:
   `.hub-cluster` marks everything that IS the hub (see the long comment in
   index.html), and project-room.js and pdf-reader.js already hide exactly that
   set while they own the view. So does this. Adding a cluster to the scene
   later keeps working with no change here.

   Nothing is built until the button is pressed — an unopened lab costs one
   button and no textures, no splat download, and no 665 KB renderer.
*/

(function () {
  var PANEL_W = 0.72, PANEL_H = 1.08;
  // 0.95 -> 0.86 when the fourth variant arrived (2026-09-08). Four panels at
  // 0.95 span 2.85 m at z -1.85, which is +/-37.6 deg — past a comfortable
  // seated sweep, so the two ends would only ever be seen edge on, and two of
  // the four techniques here are ABOUT what happens when you see them off
  // axis. 0.86 spans 2.58 m, +/-34.9 deg, and still leaves 0.14 m of air
  // between panels.
  var GAP = 0.86;                 // centre-to-centre; ~0.14 m of air between panels
  var ROOM_Z = -1.85;             // far enough back that all three fit a seated fov

  // ── The lab is a WALK SITE, with a bigger bound than anywhere else ───────
  // Sebastian: *"the walkable space in the 3D compare portrait scene is too
  // small — expand the boundary so users can get closer to the images."*
  //
  // The lab used to inherit the HUB's bound, and the hub's bound is authored
  // for the hub: an ellipse 1.6 m across and only 1.15 m toward -Z, squashed
  // that way precisely because the home panel is 1.5 m ahead and there has to
  // be clearance to it (walk-controls.js §9.5). In here the thing 1.85 m ahead
  // is not something to keep clear of, it is the whole exhibit — so that
  // asymmetry stopped you 0.70 m short of the panels, and the outer two sit at
  // x ±0.95 where a 1.6 m lateral bound never let you stand square on to
  // either. A comparison you cannot walk up to is a poster.
  //
  // A site bound is a CIRCLE by default, which is the right shape here for the
  // reason walk-controls gives: a site's asymmetry would be authored in world
  // axes and land at an arbitrary angle to whatever the site faces. 1.35 m
  // brings you to 0.50 m from a panel — close enough to put your face in it,
  // and still 0.5 m of air, which matters because these are FIXED-AIM panels
  // and a stereo pair seen from 0.2 m is not a portrait, it is two images.
  //
  // What this does NOT fix, and cannot: *"the Vision Pro starts exiting the
  // virtual space mid-walk."* That is visionOS's own boundary — it fades an
  // immersive space back to passthrough when you physically walk out of the
  // area it recognised, and no WebXR page can move it or turn it off. The bound
  // here governs the VIRTUAL walk (joystick/WASD); on a Vision Pro, which has
  // no controllers, all locomotion is physical and Apple's limit is the real
  // one. The honest answer to reaching the panels there is that they should
  // come to you, which is what the site radius plus the closer ROOM_Z above
  // are for.
  var SITE_WALK_RADIUS = 1.35;

  // ── One photograph, four techniques — and now the reveal on ALL FOUR ─────
  // This went the wrong way once, so the reasoning is worth keeping whole.
  //
  // `spatial-photo` and `mosaic-reveal` both carry the flat site's signature
  // gaze-driven mosaic reveal and both default it ON, so two of the four
  // panels bloomed colour wherever you looked while the other two stayed
  // grey — and his hair came out GINGER. Reading that as one problem, I turned
  // the reveal off in here and cited this file's own docblock: *the only thing
  // that differs between them is the depth technique.*
  //
  // It was two problems. The ginger was never the mosaic: it was
  // mosaic-reveal's `litAmt`, an ADDITIVE sheen that is invisible on a lit
  // face and enormous on dark hair (its own shader documents 0 as "untouched
  // image"). The mosaic's hair is navy. Turning the reveal off fixed the
  // ginger by accident and cost the room the best thing on the site.
  //
  // Sebastian: *"the reveal effect (or the mosaic) is no longer working on the
  // relief panel. can you get that working again? and, can you see if you can
  // get the effect to work on the 3d gaussian too?"*
  //
  // So: `litAmt: 0` STAYS — that is the actual fix, and it is what makes the
  // grey state of all four panels identical. The reveal comes back on both
  // photo panels, and the splat gets one too (splat-portrait.js projects each
  // gaussian back into the photograph and samples the mosaic there). The
  // premise survives intact and is in fact better served: four techniques,
  // one grey photograph, one mosaic, and the only difference between them is
  // still the depth.
  //
  // Which leaves the relief panel as the only one WITHOUT a reveal-capable
  // partner... no: all four have it now. The parallax panel is the exception,
  // and it is a real one — parallax-photo.js has no second texture and no
  // reveal shader, so it stays grey. Noted rather than hidden.
  //
  // The image is named once here because "the same picture in all four" should
  // be something this file states rather than a coincidence of three separate
  // defaults. `VRGlass.loadTexture` rewrites `../images/` to the downscaled
  // `assets/tex/` derivative, so these paths cost 50 KB and 347 KB, not 88 KB
  // and 2.9 MB. The spatial panel is the exception it has to be: a stereo pair
  // is a different asset by definition (assets/portrait-eye-*, and its own
  // mosaic pair), baked from this same photograph.
  var SHOW_PHOTO = '../images/contact-photo-framed-for-mosaic.jpg';
  var SHOW_MOSAIC = '../images/contact-photo-mosaic.jpg';
  // The relief panel builds its interior for one reference viewpoint, and that
  // has to be where the panel actually is or the box does not fill its opening.
  // The home portrait's default is 1.5 m; in here they hang at 1.85 m — but
  // that is the distance to the WALL, not to a panel, and only the middle two
  // panels are anywhere near it. Each slot now passes its own straight-line
  // distance (`slotDist` in buildRoom), which is 1.90 m for the relief panel
  // where it actually sits and 2.26 m out at the ends. One constant for four
  // different distances was a small error while the panels hung square and is
  // a larger one now they are turned.
  var ROOM_Y = 1.45;
  var LABEL_DROP = 0.42;          // label sits below the panel, clear of the feather

  var VARIANTS = [
    { key: 'spatial', title: 'Spatial photo',
      note: 'stereo pair · depth, but no parallax' },
    { key: 'relief', title: 'Relief panel',
      note: 'displaced geometry · looks through' },
    { key: 'splat', title: '3D gaussians',
      note: 'SHARP splats · sees behind edges' },
    // Added 2026-09-08. Sits LAST, after the splat, because the lab reads
    // left-to-right as increasing commitment — two images, then displaced
    // geometry, then a real reconstruction — and this one is the coda: it
    // gets most of the way back to the relief panel's motion response from
    // two triangles and a texture the relief panel was already loading.
    { key: 'parallax', title: 'Parallax map',
      note: 'depth in the texture, not the mesh' }
  ];

  function setHubVisible(visible) {
    // Through VRPlace, not a local querySelectorAll: hiding a branch with
    // `visible:false` leaves every `.clickable` in it a live, invisible hit
    // target (three.js raycasts ignore `visible`). See the long note in
    // place.js — this is how a hub card behind a room's floor could swallow a
    // click, and how the hub's portrait was blocking this room's own controls.
    if (window.VRPlace && VRPlace.setHubVisible) return VRPlace.setHubVisible(visible);
    [].slice.call(document.querySelectorAll('.hub-cluster')).forEach(function (el) {
      el.setAttribute('visible', visible);
    });
  }

  // Raycasters cache their target list, so anything shown or hidden without
  // telling them stays clickable (or stops being clickable) until the next
  // refresh. project-room.js does the same thing for the same reason.
  function refreshRays() {
    [].slice.call(document.querySelectorAll('[raycaster]')).forEach(function (el) {
      var rc = el.components && el.components.raycaster;
      if (rc) rc.refreshObjects();
    });
  }

  AFRAME.registerComponent('portrait-lab', {
    schema: {
      // The asset `?quality=low` falls back to. The lab's own default is the
      // full-resolution splat — see the long note in init() for why that
      // flipped, and why the decimated one is a fallback rather than the
      // sensible choice it looks like.
      splat: { type: 'string', default: 'assets/portrait-lod.splat' }
    },

    init: function () {
      // ── Quest, Vision Pro, and why there is no second build ──────────────
      // There isn't a Quest version to write. Both run the same WebXR code
      // path — Chromium on Quest, WebKit on Vision Pro — and nothing here
      // touches an API that differs between them. The stereo split is
      // three.js layers, the splat correction is driven off renderer.xr's own
      // events, and A-Frame's tick runs on the session clock on both.
      //
      // What genuinely differs is headroom, so the knob is quality, not
      // device. Sniffing the user agent for "Quest" was the other option and
      // is worse: it is wrong on Wolvic, wrong on a tethered PC headset, wrong
      // on every device released after this was written, and it silently gives
      // someone the degraded asset with no way to say otherwise.
      //
      // ── The default FLIPPED to the full splat (2026-09-13) ───────────────
      // It used to be the LOD, reasoning that "the lab is a comparison, not a
      // shrine, and 12 MB on a headset's network is a long wait before
      // anything appears". Both halves of that turned out to be wrong here.
      //
      // The LOD is not a slightly softer version of the full splat, it has a
      // HOLE in it. The bake decimates by keeping every 2nd gaussian in each
      // axis, and where the reconstruction was already only a few gaussians
      // deep — his left shoulder — that leaves too little to be opaque with.
      // Rendered, the background shows through, which is what Sebastian had
      // been seeing as an unexplained dark smudge on a white shirt. Widening
      // cannot fill a hole. The full splat simply does not have one.
      //
      // And the wait is not paid by anyone who does not ask for it: nothing in
      // this room is built until the button is pressed, and splat-portrait
      // narrates the download on the same busy card the reader uses, with real
      // byte counts. A 12 MB opt-in behind a button on a scene that ships
      // ~0 bytes of it otherwise is a different trade from 12 MB on arrival.
      //
      // `?quality=low` goes back to the LOD for a slow network; `?quality=high`
      // still means the full splat, which is now also the default.
      var q = new URLSearchParams(location.search).get('quality');
      this.quality = q === 'low' ? 'low' : 'high';

      this.open = false;
      this.room = null;
      this._onEnter = this.openLab.bind(this);
      this._onExit = this.closeLab.bind(this);
      this.buildButton();
    },

    // ── The way in ──────────────────────────────────────────────────────────
    buildButton: function () {
      var btn = document.createElement('a-entity');
      btn.setAttribute('ui-button', {
        label: 'Compare portrait depth', width: 0.62, height: 0.13, variant: 'ghost', arrow: true
      });
      // Under the portrait, inside the home cluster, so it is hidden along with
      // everything else when a room or the reader takes over.
      btn.setAttribute('position', '-0.5 0.76 0');
      btn.classList.add('clickable');
      btn.addEventListener('click', this._onEnter);
      this.enterBtn = btn;

      var host = document.querySelector('#homeCluster') || this.el.sceneEl;
      host.appendChild(btn);
    },

    // ── The room ────────────────────────────────────────────────────────────
    buildRoom: function () {
      var room = document.createElement('a-entity');
      room.setAttribute('position', '0 0 0');
      var x0 = -GAP * (VARIANTS.length - 1) / 2;

      VARIANTS.forEach(function (v, i) {
        var slot = document.createElement('a-entity');
        var slotX = x0 + i * GAP;
        slot.setAttribute('position', slotX + ' ' + ROOM_Y + ' ' + ROOM_Z);

        // ── Toe the panels in, because two of these four are only valid
        //    seen square on ─────────────────────────────────────────────────
        // The panels used to hang on a flat wall with no rotation, all facing
        // +Z. From the middle of the room that puts the outer two at 34.9° off
        // axis — and 34.9° is not a neutral way to show either of the outer
        // techniques:
        //
        //   • a STEREO PAIR is only valid seen square on. That is not a
        //     preference, it is the reason index.html turns the hub portrait
        //     with sunflower.js: off axis the two eye images no longer
        //     correspond to the geometry your head is in, and the backdrop
        //     swims. The spatial panel sits at x -1.29.
        //   • the PARALLAX MAP marches through a depth map by the tangent of
        //     the view angle, and parallax-photo.js's own note measures what
        //     30° costs: 15.6% of the panel's width of invented texture, which
        //     is why its depth was cut to 0.085 m. At 34.9°, permanently, the
        //     edge guard is doing its maximum work all the time and the
        //     hairline carries a visible light fringe. That panel sits at
        //     x +1.29.
        //
        // So the flat wall was showing both of them in the one condition they
        // cannot do, and calling it a comparison. Each slot now turns to face
        // the room's own centre, where the viewer starts, so the NEUTRAL view
        // of every panel is the square-on one. Leaning still moves you off
        // axis — that is the whole exhibit, and the hint above the panels
        // still says so — but now it is something you choose rather than the
        // starting condition.
        //
        // It also fixes the way the room reads: fixed-aim panels seen from the
        // centre are keystoned trapezoids, which is visible in the outer two.
        // Toed in, they are rectangles, and the four of them form a shallow
        // arc rather than a flat wall.
        //
        // Yaw only, no pitch. The panels hang at 1.45 m against a 1.6 m eye,
        // which is 4.5° of drop against 34.9° of turn — and pitching them
        // would tilt the relief panel's portal box out of its own opening for
        // a correction an order of magnitude smaller than the one that
        // matters.
        var slotDist = Math.sqrt(slotX * slotX + ROOM_Z * ROOM_Z);
        slot.object3D.rotation.y = Math.atan2(-slotX, -ROOM_Z);

        var art = document.createElement('a-entity');
        if (v.key === 'spatial') {
          art.setAttribute('spatial-photo', {
            width: PANEL_W, height: PANEL_H
            // Reveal left at its default (on), with its own stereo mosaic
            // pair. See the note above SHOW_PHOTO.
          });
        } else if (v.key === 'relief') {
          art.setAttribute('mosaic-reveal', {
            gray: SHOW_PHOTO,
            color: SHOW_MOSAIC,
            // ── The amber sheen stays OFF ──────────────────────────────────
            // THIS is what made his hair ginger, not the mosaic — proved by
            // the fact that it survived turning the reveal off.
            // mosaic-reveal's own shader documents the uniform as "0 =
            // untouched image; >0 dials in the shared light rig, FOR
            // COMPARISON" — and the term is ADDITIVE (`col += spec * ... *
            // uLitAmt`). Additive light is invisible on a lit face and
            // enormous on dark hair, so 0.12 read as a wash on the one part of
            // the picture that had no headroom.
            //
            // The default stays 0.12 where it belongs: that number is
            // Sebastian's own call for the HUB portrait, which hangs alone with
            // nothing to be compared against. A controlled comparison of four
            // depth techniques wants the untouched image, which is what the
            // shader says 0 gives.
            litAmt: 0,
            width: PANEL_W, height: PANEL_H,
            relief: 'assets/portrait-relief.png',
            viewDistance: slotDist
          });
        } else if (v.key === 'parallax') {
          // Same depth map and the same metric span as the relief panel beside
          // it (parallax-photo.js's depthM defaults to the bake's relief_m), so
          // the only thing differing between those two is the technique.
          art.setAttribute('parallax-photo', {
            width: PANEL_W, height: PANEL_H, photo: SHOW_PHOTO,
            // The mosaic marches with the depth map here, because it is
            // sampled at the same parallaxed uv as the photograph. That makes
            // this the one panel where you can watch the reveal itself move.
            mosaic: SHOW_MOSAIC
          });
        } else {
          // The splat is a free-standing bust, not something behind an opening —
          // it has no backdrop to frame, because the bake prunes it away. Sized
          // to the panels so the comparison is about depth and not about scale.
          // The gaussian WIDTH goes with the asset, not with the component's
          // default: the LOD's own gaussians were already widened 1.45x by the
          // bake to cover the neighbours it dropped, so the two assets need
          // different screen-space multipliers to look the same. Both numbers
          // were measured in this room — see the long note on `splatWidth` in
          // splat-portrait.js.
          var hi = this.quality !== 'low';
          art.setAttribute('splat-portrait', {
            src: hi ? 'assets/portrait.splat' : this.data.splat,
            splatWidth: hi ? 1.3 : 1.4,
            // The same mosaic the relief panel reveals, projected back onto
            // the gaussians through the camera SHARP assumed. It is the one
            // panel in here where the reveal happens on real 3D: the lens
            // wraps his cheek and stays put on him as you lean.
            mosaic: SHOW_MOSAIC
          });
        }
        slot.appendChild(art);

        var label = document.createElement('a-entity');
        label.setAttribute('troika-text', {
          value: v.title, align: 'center', anchor: 'center', baseline: 'top',
          color: '#ffffff', font: VRFonts.title(), fontSize: VRType.body(),
          maxWidth: PANEL_W * 1.3
        });
        label.setAttribute('position', '0 ' + (-PANEL_H / 2 - LABEL_DROP * 0.42) + ' 0.02');
        slot.appendChild(label);

        var note = document.createElement('a-entity');
        note.setAttribute('troika-text', {
          value: v.note, align: 'center', anchor: 'center', baseline: 'top',
          color: '#b8863b', fillOpacity: 0.92, font: VRFonts.body(),
          fontSize: VRType.label(), maxWidth: PANEL_W * 1.3, lineHeight: 1.25
        });
        note.setAttribute('position', '0 ' + (-PANEL_H / 2 - LABEL_DROP * 0.78) + ' 0.02');
        slot.appendChild(note);

        room.appendChild(slot);
      }, this);

      var hint = document.createElement('a-entity');
      hint.setAttribute('troika-text', {
        value: 'Lean side to side. The first panel is fixed; the other three move.',
        align: 'center', anchor: 'center', baseline: 'top',
        color: '#ffffff', fillOpacity: 0.62, font: VRFonts.body(),
        fontSize: VRType.body(), maxWidth: 2.6
      });
      hint.setAttribute('position', '0 ' + (ROOM_Y + PANEL_H / 2 + 0.22) + ' ' + ROOM_Z);
      room.appendChild(hint);

      var back = document.createElement('a-entity');
      back.setAttribute('ui-button', { label: 'Back', width: 0.4, height: 0.13, variant: 'ghost' });
      back.setAttribute('position', '0 ' + (ROOM_Y - PANEL_H / 2 - 0.52) + ' ' + (ROOM_Z + 0.25));
      back.classList.add('clickable');
      back.addEventListener('click', this._onExit);
      room.appendChild(back);

      return room;
    },

    openLab: function () {
      if (this.open) return;
      this.open = true;
      setHubVisible(false);
      if (!this.room) {
        this.room = this.buildRoom();
        this.el.sceneEl.appendChild(this.room);
      } else {
        // Through VRPlace, for the same reason setHubVisible goes through it:
        // the lab BUILDS ITS ROOM ONCE and hides it on close, so between visits
        // four depth panels and a Back button sat invisible in the hub and
        // still took clicks. Measured before the fix: the hub came back from a
        // lab visit with 78 clickables against the 73 it started with, and the
        // five extra were this room.
        VRPlace.setBranchVisible(this.room, true);
      }
      // The splat and the textures land asynchronously, so the click targets
      // that exist a frame from now are not the ones that exist right now.
      // Its own walk bound, wider than the hub's. Entered at the origin so the
      // lab's own geometry (authored around 0,0) stays where it is; only the
      // BOUND changes, and walk-controls moves it with the site.
      if (window.VRWalk && VRWalk.enterSite) {
        VRWalk.enterSite({ x: 0, z: 0, radius: SITE_WALK_RADIUS });
      }
      refreshRays();
      setTimeout(refreshRays, 400);
      this.el.sceneEl.emit('portrait-lab-open', null, false);
    },

    closeLab: function () {
      if (!this.open) return;
      this.open = false;
      if (this.room) VRPlace.setBranchVisible(this.room, false);
      // Puts the viewer back on the spot they walked from, and restores the
      // hub's own ellipse.
      if (window.VRWalk && VRWalk.leaveSite) VRWalk.leaveSite();
      setHubVisible(true);
      refreshRays();
      this.el.sceneEl.emit('portrait-lab-close', null, false);
    },

    remove: function () {
      if (this.enterBtn) {
        this.enterBtn.removeEventListener('click', this._onEnter);
        if (this.enterBtn.parentNode) this.enterBtn.parentNode.removeChild(this.enterBtn);
      }
      if (this.room) {
        // §3.17 again: dropping the element leaves its geometry, materials and
        // the splat viewer's workers allocated. The components' own remove()
        // handlers run on removeChild, which is what actually frees them.
        VRGlass.disposeSubtree(this.room.object3D);
        if (this.room.parentNode) this.room.parentNode.removeChild(this.room);
      }
      this.room = null;
    }
  });
})();
