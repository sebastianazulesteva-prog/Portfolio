/* ═══ portrait-lab.js ═══
   A room holding four depth treatments of ONE photograph, side by side, so
   they can be compared in a headset instead of argued about on a monitor.

   The photograph is the Time Collector, not the portrait (issue #1). It used
   to be him, four times over, beside the hub portrait that is already him —
   and a room explaining how depth is made read as a gallery of one face. The
   hub keeps the spatial photo of him; the button under it asks how that depth
   was made, and this room answers on a different subject. The machine is also
   simply the better specimen: gears at a dozen depths on a dark sweep, where a
   face is one smooth surface in front of a wall.

     spatial photo   stereo pair, one image per eye. Binocular depth only —
                     move your head and nothing new appears.
     relief          the photo displaced by a baked depth map, behind a portal.
                     Real geometry, so it re-projects as you move.
     splat           SHARP's 3D gaussians. Knows what is behind an edge.

   All four are built from the SAME SHARP reconstruction of the same
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

  // ── One photograph, four techniques, no reveal and no grey ───────────────
  // Every panel here used to wear the flat site's gaze-driven mosaic reveal
  // over a greyed photo, because the photo was his and the mosaic is his. The
  // Time Collector has no mosaic, and a grey machine would be hiding the one
  // thing that makes it legible — cream parts against brown board against a
  // dark sweep. So all four panels show the photo in its own colour
  // (`desaturate: 0`) and none of them builds a reveal (`reveal: false`, or no
  // `mosaic`). That also retires the one asymmetry this room had to explain:
  // the splat was the panel that could not carry the reveal, and now none do.
  //
  // `litAmt: 0` on the relief panel stays, for the reason it was first set: the
  // sheen is ADDITIVE, and a comparison of depth techniques wants the
  // untouched image.
  //
  // Baked by vr/tools/sharp from images/timecollector-hero-side.png, cropped
  // centrally to 2:3 (788 x 1182, x 47..835) so it fills the same 0.72 x 1.08
  // panel the portrait did and nothing about the room's geometry moves. SHARP
  // ran on that crop, not on the original, so there is no alignment window to
  // carry — the gaussian grid and the displayed image are the same pixels.
  // vr/assets/lab-timecollector-bake.json has the numbers.
  var SHOW_PHOTO = 'assets/lab-timecollector.jpg';
  var SHOW_RELIEF = 'assets/lab-timecollector-relief.png';
  // How deep the machine is drawn, in metres behind each opening. Its TRUE
  // depth at this panel's scale is ~0.65 m (0.87 m of SHARP relief across a
  // 1.44 m frame drawn 1.08 m tall), more than three times the portrait's
  // 0.195 — a face is shallow for its size, a machine seen three-quarter on is
  // not. The stereo pair is baked at the same number, so the spatial and
  // relief panels agree about the one thing being compared.
  var SHOW_DEPTH = 0.30;
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
      splat: { type: 'string', default: 'assets/lab-timecollector-lod.splat' }
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
        // 0.62 -> 0.74 with the new label (issue #1): the old 0.62 wrapped
        // "How was this depth made?" onto two lines. 0.74 is the portrait's
        // own 0.72 width to within the button's rounding, so it still reads as
        // belonging to the photo above it.
        label: 'How was this depth made?', width: 0.74, height: 0.13, variant: 'ghost', arrow: true
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
            width: PANEL_W, height: PANEL_H,
            left: 'assets/lab-timecollector-eye-L.jpg',
            right: 'assets/lab-timecollector-eye-R.jpg',
            reveal: false, desaturate: 0,
            // The pair's own `disparity_px.far` (lab-timecollector-eye.json),
            // baked for this slot's 2.26 m rather than the hub's 1.5 m.
            farDisparityPx: 4.62
          });
        } else if (v.key === 'relief') {
          art.setAttribute('mosaic-reveal', {
            gray: SHOW_PHOTO,
            reveal: false, desaturate: 0,
            litAmt: 0,
            width: PANEL_W, height: PANEL_H,
            relief: SHOW_RELIEF,
            reliefDepth: SHOW_DEPTH,
            // A relief panel has to span every depth step with one continuous
            // surface, and a machine is nothing BUT depth steps: every gear
            // tooth against the backdrop 0.3 m behind it. Seen from the side
            // those spans stretched into streaks off every tooth. tearFade
            // opens them into gaps along the bake's silhouette channel instead,
            // and against this photo's near-black backdrop a gap reads as the
            // backdrop. The portrait never needed it — one face, one outline.
            tearFade: 0.9,
            viewDistance: slotDist
          });
        } else if (v.key === 'parallax') {
          // Same depth map as the relief panel beside it. Its depth stays at
          // the component's 0.085 m, not SHOW_DEPTH: that is the ceiling of the
          // technique rather than a property of the subject — past it a 30°
          // view marches off the photograph (see parallax-photo.js).
          art.setAttribute('parallax-photo', {
            width: PANEL_W, height: PANEL_H, photo: SHOW_PHOTO,
            depth: SHOW_RELIEF, desaturate: 0
          });
        } else {
          // The splat is a free-standing object, not something behind an
          // opening: the bake prunes the back wall (z > 1.75 m) and keeps the
          // machine plus the strip of floor it stands on. Sized to the panels
          // so the comparison is about depth and not about scale — SHARP's
          // metric frame is 1.44 m tall at the machine and the panels draw it
          // 1.08 m, so 0.75. The gaussian WIDTH goes with the asset (see the
          // long note on `splatWidth` in splat-portrait.js).
          //
          // `trimBottom: 0`: the trim exists because his bust ended in a torn
          // fringe at the chest. The machine does not end, it stands on the
          // floor, and trimming the lowest 5% would cut its feet off.
          var hi = this.quality !== 'low';
          art.setAttribute('splat-portrait', {
            src: hi ? 'assets/lab-timecollector.splat' : this.data.splat,
            splatWidth: hi ? 1.3 : 1.4,
            splatScale: 0.75, trimBottom: 0, desaturate: 0
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
