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
  var GAP = 0.95;                 // centre-to-centre; ~0.23 m of air between panels
  var ROOM_Z = -1.85;             // far enough back that all three fit a seated fov
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
      note: 'SHARP splats · sees behind edges' }
  ];

  function setHubVisible(visible) {
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
        } else {
          // The splat is a free-standing bust, not something behind an opening —
          // it has no backdrop to frame, because the bake prunes it away. Sized
          // to the panels so the comparison is about depth and not about scale.
          var src = this.quality === 'high' ? 'assets/portrait.splat' : this.data.splat;
          art.setAttribute('splat-portrait', 'src: ' + src + '; splatScale: 1.144');
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
        value: 'Lean side to side. Only the middle and right panels change.',
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
        this.room.setAttribute('visible', true);
      }
      // The splat and the textures land asynchronously, so the click targets
      // that exist a frame from now are not the ones that exist right now.
      refreshRays();
      setTimeout(refreshRays, 400);
      this.el.sceneEl.emit('portrait-lab-open', null, false);
    },

    closeLab: function () {
      if (!this.open) return;
      this.open = false;
      if (this.room) this.room.setAttribute('visible', false);
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
