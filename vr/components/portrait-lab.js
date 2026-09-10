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
  // The relief panel builds its interior for one reference viewpoint, and that
  // has to be where the panel actually is or the box does not fill its opening.
  // The home portrait's default is 1.5 m; in here they hang at 1.85 m.
  var ROOM_VIEW_DIST = 1.85;
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
      // Which splat to load in the lab. The decimated one by default: the lab
      // is a comparison, not a shrine, and 12 MB on a headset's network is a
      // long wait before anything appears.
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
      // device. The default is already the conservative one: the decimated
      // splat (97k gaussians, 3.1 MB) rather than the full 385k / 12.3 MB.
      // That is the right default for a standalone headset AND perfectly good
      // on a desktop, so nothing has to detect anything. ?quality=high opts
      // into the full-resolution splat when you know the machine can take it.
      //
      // Sniffing the user agent for "Quest" was the other option and is worse:
      // it is wrong on Wolvic, wrong on a tethered PC headset, wrong on every
      // device released after this was written, and it silently gives someone
      // the degraded asset with no way to say otherwise.
      var q = new URLSearchParams(location.search).get('quality');
      this.quality = q === 'high' ? 'high' : 'default';

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
        slot.setAttribute('position', (x0 + i * GAP) + ' ' + ROOM_Y + ' ' + ROOM_Z);

        var art = document.createElement('a-entity');
        if (v.key === 'spatial') {
          art.setAttribute('spatial-photo', {
            width: PANEL_W, height: PANEL_H
          });
        } else if (v.key === 'relief') {
          art.setAttribute('mosaic-reveal',
            'gray: ../images/contact-photo-framed-for-mosaic.jpg;'
            + ' color: ../images/contact-photo-mosaic.jpg;'
            + ' width: ' + PANEL_W + '; height: ' + PANEL_H + ';'
            + ' relief: assets/portrait-relief.png;'
            + ' viewDistance: ' + ROOM_VIEW_DIST);
        } else if (v.key === 'parallax') {
          // Same depth map and the same metric span as the relief panel beside
          // it (parallax-photo.js's depthM defaults to the bake's relief_m), so
          // the only thing differing between those two is the technique.
          art.setAttribute('parallax-photo', {
            width: PANEL_W, height: PANEL_H
          });
        } else {
          // The splat is a free-standing bust, not something behind an opening —
          // it has no backdrop to frame, because the bake prunes it away. Sized
          // to the panels so the comparison is about depth and not about scale.
          var src = this.quality === 'high' ? 'assets/portrait.splat' : this.data.splat;
          art.setAttribute('splat-portrait', 'src: ' + src);
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
