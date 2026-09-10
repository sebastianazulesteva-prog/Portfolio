/* ═══ photo-cloud.js ═══
   The VR-only Photo Catalog (§9 / build directive item 9): every image on the
   site drifts as a loose 3D constellation in its own zone BEHIND the viewer —
   turn around from the hub to find it. Hold your gaze (or the pointer) on one
   for ~0.9 s — a small ring fills on the tile while you do, see dwell.js — and
   it floats forward, enlarges, and shows its caption (vr/images.json's label
   for that file, else the image's alt text, + the project it belongs to).
   Clicking one SELECTS it, which is immediate and skips the ring.

   A completed reach is LOCKED FORWARD. Looking away does nothing; it goes home
   only when another tile's ring completes, when it is clicked (promoting it to
   a selection), or when the selection is cleared. This reverses the original
   "look away and it eases back" — see the long note on the mouseleave handler.

   Data-driven (data-loader.js's `images` catalog), so new photos on the real
   site appear here automatically. Textures are downscaled to 512px on load
   (glass-material.js) — 34 full-res photos would otherwise be a lot of GPU
   memory. Placement is deterministic (a golden-ratio hash), so the cloud
   looks scattered but is stable across loads, and the slow idle drift is
   disabled under reduced-motion.

   Usage:
     <a-entity photo-cloud></a-entity>
     el.components['photo-cloud'].setImages(data.images);
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── The cloud's own zone, bounded to leave a CLEAR GAP on both sides ──
  // (VR_AI_BUILD_GUIDE.md §9.1.) Stated as explicit bounds cut to clear the
  // real cluster edges, and NOT symmetric about 180 — the two sides hold
  // different amounts of card.
  //
  // The gap is sized for PARITY with the hub's own tightest section boundary,
  // per Sebastian: the writing column and the projects grid are separated by
  // 7.8° of yaw, and that reads as "two distinct sections", so the cloud gets
  // the same 7.8° rather than a wider moat of its own. It previously stood off
  // by ~19° on both sides, which left the cloud bunched into 67° of dome behind
  // the viewer and reading as one tight clump instead of an arc that wraps
  // around to meet the sections either side.
  //
  // Measured off the placed panels (card edges in each card's OWN frame — an
  // AABB of a rotated card is not its size), in this component's angle sense
  // where 0° is straight ahead and +90° is the viewer's right:
  //   Experience outer edge    116.75°   -> tile edges start 124.5°
  //   projects grid outer edge 228.46°   -> tile edges stop  220.7°
  //   (reference: projects grid 298.54° -> writing column 306.30° = 7.76°)
  //
  // These bound the tiles' VISUAL EDGES, not their centres, and each tile's own
  // half-width is subtracted per tile when it's placed (below). Bounding centres
  // instead needs a single worst-case inset — the largest tile at the nearest
  // radius, ~8° — which then applies to every tile including the small distant
  // ones, and since no tile lands exactly on a bound the cloud ends up standing
  // off further than intended anyway (measured 12.4°/13.4° against a 7.8°
  // target). Stating the gap once, here, is the whole point.
  var EDGE_MIN_DEG = 124.5;  // toward Experience (viewer's right)
  var EDGE_MAX_DEG = 220.7;  // toward the projects grid (viewer's left)
  var MIN_R = 2.2, MAX_R = 3.6;
  var MIN_H = 0.7, MAX_H = 2.6;
  var TILE = 0.5;          // base tile size (long edge, metres)
  var FOCUS_R = 1.6;       // how close a reached tile floats in
  var FOCUS_SCALE = 1.45;  // enlarge on reach — kept modest so a focused tile can't loom over neighbouring panels (VR_BUGFIX item 8)
  var FOCUS_TOP = 1.9;     // a focused tile's TOP edge is clamped below this height, so it can never rise into the title banner above the hub

  // ── Coming and going are deliberately not the same speed ──────────────────
  // Sebastian: *"slow down the deselection, but not too slow."* Arriving should
  // feel answered — you held a ring for 0.9 s to ask for it — so IN stays quick.
  // Going away is not an answer to anything the visitor just did (a reach is
  // dismissed by picking something ELSE), so at 0.6 s the old photo whipped out
  // of frame at the same moment the new one arrived and both movements
  // competed for the eye. Slowing the exit lets the handover read as one
  // exchange instead of two events. Past about a second it stops reading as
  // "leaving" and starts reading as "stuck", which is the other failure — hence
  // "not too slow".
  var IN_S = 0.5;          // reach in (unchanged)
  var OUT_S = 0.95;        // reach out / deselect / cloud returning from recede
  var RECEDE_S = 0.55;     // the cloud pushing BACK is a background move, stays brisk

  // ── Selection (§9.8) ── distinct from the hover/reach above.
  // Sebastian: "when a user selects a photo to view/read it, that photo should
  // come forward and stack in front of the others. Other photos behind it
  // should not interrupt/overlap the selected one."
  //
  // Both halves are geometric rather than a render-order trick. The selected
  // tile travels to 1.15 m — nearer than EVERY other tile's home radius (2.21 m
  // minimum), so after the move nothing in the cloud can physically be in front
  // of it and normal depth testing does the stacking. Meanwhile the rest of the
  // cloud pushes 18% further out and dims, so the neighbours stop competing for
  // the frame instead of merely being behind.
  var SELECT_R = 1.15;
  // Bringing the selected tile FORWARD is not enough on its own to bring it to
  // the FRONT, because this scene runs with A-Frame's
  // `sortTransparentObjects: false` — transparent draw order is scene-graph
  // order, not depth order — and the tile shader is transparent with
  // depthWrite:false, so nothing depth-rejects a farther tile either. A tile
  // later in #photoCloud's child list therefore paints straight over the
  // selected one: measured 12–36% of the selected tile's OWN face overwritten
  // by other tiles, while it sat a full metre nearer the eye.
  //
  // renderOrder is honoured even under that stable sort, so lifting the whole
  // selected subtree (tile, caption, action button) above the rest of the cloud
  // fixes the paint order without touching depth semantics, without reordering
  // the DOM (the tile must stay inside #photoCloud so rooms/reader still hide
  // it), and without turning on scene-wide transparent sorting — which would
  // change how every other panel composites.
  var SELECTED_RENDER_ORDER = 10;
  var FOCUSED_RENDER_ORDER = 5;   // hover/reach — same fix, one rung down
  var SELECT_SCALE = 1.9;
  var OTHERS_PUSH = 1.18;  // multiplier on every other tile's home radius
  // ── Caption backing ──
  // Sebastian: "add a little background to the text for the cloud photos once
  // they are pulled in (the descriptions) because it gets hard to read." The
  // caption floats free below the tile, so whatever it happens to be over —
  // another photo, the ember horizon, a bright shirt — sets its contrast, and
  // some of those backgrounds are near-white. A rounded chip behind it makes
  // the background known.
  //
  // Deliberately a chip, not a card: 0.86 alpha over the dome's near-black, no
  // ember rim, no glass shader. The glass card material is the scene's word for
  // "this is a surface you interact with"; a caption is a label, and at this
  // size a full card behind every hovered tile would read as a second panel
  // floating in the cloud. Tone matches the notice's and the skills panel's
  // plates (#0e0c09) so the three backings in the scene agree.
  var CAP_BG_COLOR = '#0e0c09';
  // 0.92, not the 0.86 first tried: at 0.86 a bright photo behind the chip
  // still came through at ~30 luma and you could read ANOTHER tile's caption
  // ghosting under this one. Measured on the worst case in the cloud, the
  // background behind a caption ranges 11-216 luma; the chip flattens that to
  // 12-40 at 0.86 and to 12-27 here, which is the difference between "legible"
  // and "clean".
  var CAP_BG_ALPHA = 0.92;
  var CAP_BG_PAD_X = 0.030;
  var CAP_BG_PAD_Y = 0.018;
  var CAP_BG_RADIUS = 0.020;

  var OTHERS_DIM = 0.55;   // uDim for the rest of the cloud while one is selected
  var SELECT_TOP = 2.05;   // as FOCUS_TOP, but the selected tile is bigger

  function frac(x) { return x - Math.floor(x); }

  // Turn a messy alt string + owning project into a short one-line caption.
  // `im.caption` is data-loader's resolved label: vr/images.json's entry for
  // this file if it has one, else the flat site's alt. Falls back to the raw
  // alt so a catalog that failed to fetch degrades to the old behaviour rather
  // than to a cloud of "Untitled".
  function caption(im) {
    var alt = (im.caption || im.alt || '').replace(/\s+/g, ' ').trim();
    if (alt.length > 90) alt = alt.slice(0, 88).replace(/[\s,.;:]+\S*$/, '') + '…';
    if (im.project) return (alt ? alt + '  ·  ' : '') + im.project;
    return alt || 'Untitled';
  }

  AFRAME.registerComponent('photo-cloud', {
    init: function () {
      this._tiles = [];
      this._selected = null;
      // title -> project object, supplied by index.html (the scene's data owner).
      // The catalog only knows a photo's project by TITLE, and entering a room
      // needs the whole project record.
      this._resolveProject = null;
    },

    // index.html calls this with a lookup built from the scraped project list.
    setProjectResolver: function (fn) { this._resolveProject = fn; },

    setImages: function (images) {
      var self = this;
      var a11y = document.body.classList.contains('accessible');
      var list = images || [];
      // Golden-ratio hashing spreads the tiles nicely but its extremes fall
      // short of 0 and 1 for any finite set (0.03–0.97 across 32 images), so
      // the arc stood off its own bounds by a further ~3° at each end on top of
      // the per-tile inset. Normalising the ANGLE fractions to span [0,1] makes
      // the cloud actually reach the gap the zone declares, at any image count.
      // Only s1 is normalised: radius/height/size want their natural jitter,
      // and pinning those to their extremes would put a tile exactly on the
      // floor-height and far-radius limits every time.
      var rawAngle = list.map(function (im, i) { return frac((i + 1) * 0.61803398875); });
      var aMin = Math.min.apply(null, rawAngle), aMax = Math.max.apply(null, rawAngle);
      var aSpread = (aMax - aMin) || 1;
      list.forEach(function (im, i) {
        // Deterministic pseudo-random placement (golden-ratio hashing).
        var s1 = (rawAngle[i] - aMin) / aSpread;
        var s2 = frac((i + 1) * 0.38196601125 + 0.13);
        var s3 = frac((i + 1) * 0.27201964951 + 0.71);
        var s4 = frac((i + 1) * 0.13 + 0.37);

        var radius = MIN_R + s2 * (MAX_R - MIN_R);
        var height = MIN_H + s3 * (MAX_H - MIN_H);
        // Slightly varied tile size so the cloud reads organically, not gridded.
        // Needed BEFORE the angle: this tile's own angular half-width is what
        // gets inset from the zone's edge bounds.
        var size = TILE * (0.82 + s4 * 0.4);

        // A tile faces the viewer, so its plane is ~tangential and its angular
        // half-width is atan((size/2) / radius): ~7.9° for the biggest tile at
        // 2.2 m, ~3.9° for the smallest at 3.6 m. Insetting per tile means a
        // near tile keeps its distance while a small far one is free to sit
        // right at the boundary, so the cloud actually reaches the gap it was
        // given instead of leaving a second, invisible margin.
        var halfDeg = THREE.MathUtils.radToDeg(Math.atan2(size / 2, radius));
        var lo = EDGE_MIN_DEG + halfDeg, hi = EDGE_MAX_DEG - halfDeg;
        var angle = lo + s1 * (hi - lo);
        var rad = THREE.MathUtils.degToRad(angle);
        var home = new THREE.Vector3(Math.sin(rad) * radius, height, -Math.cos(rad) * radius);

        var tileEl = document.createElement('a-entity');
        tileEl.classList.add('clickable');
        tileEl.object3D.position.copy(home);
        // Face the viewer at the origin. lookAt() alone is correct here and
        // must NOT be followed by a rotateY(PI) "correction": Object3D.lookAt
        // SWAPS its arguments for non-camera/non-light objects
        // (m1.lookAt(_target, _position, up)), so a plane's front (+Z) already
        // ends up pointing AT the target. The extra flip turned all 34 tiles
        // toward the dome wall — and since makeFeatheredImage's ShaderMaterial
        // is FrontSide, backface culling made the whole cloud invisible AND
        // un-raycastable (so every tile's hover caption/reach was dead too).
        // Don't "fix" a facing problem here with side: DoubleSide either — that
        // shows the tiles mirrored.
        tileEl.object3D.lookAt(0, height, 0);

        var mesh = VRGlass.makeFeatheredImage(im.src, size, size, size * 0.12, 512);
        // Depth cue: farther tiles sit a little dimmer, so the cloud reads as
        // having real front-to-back depth rather than a flat wall of photos
        // (the depth/contrast pass). Static — zero per-frame cost; a reached
        // tile brightens back to full as it floats in (see _focus).
        var depthDim = ((radius - MIN_R) / (MAX_R - MIN_R)) * 0.32;
        mesh.material.uniforms.uDim.value = depthDim;
        tileEl.setObject3D('tile', mesh);

        // Caption — hidden until reached. Placed below the tile; sized so that
        // at FOCUS_SCALE it's comfortably readable.
        //
        // maxWidth is the TILE's width, not 2.2x it. At 2.2 a long alt string
        // stayed on one line and ran to 1.12 m in the tile's own units — x1.9
        // when selected, that is a 2.2 m line at 1.15 m from the eye, about 88
        // degrees of yaw to read one sentence, with both ends outside a phone's
        // frame entirely (measured on the pendant tile: the caption was more
        // than twice the width of the photo it belongs to). Wrapping to two or
        // three lines under the photo is both easier to read and what a caption
        // should look like. This is the other half of "it gets hard to read" —
        // the backing chip below is the first half.
        var cap = document.createElement('a-entity');
        cap.setAttribute('troika-text', {
          value: caption(im), align: 'center', anchor: 'center', baseline: 'top',
          color: '#f5f5f0', fillOpacity: 0.9, font: VRFonts.body(),
          fontSize: VRType.body(), maxWidth: size * 1.05, lineHeight: 1.3
        });
        cap.object3D.position.set(0, -size * 0.62, 0.02);
        cap.object3D.visible = false;
        tileEl.appendChild(cap);

        self.el.appendChild(tileEl);

        var tile = {
          el: tileEl, cap: cap, home: home.clone(), size: size, depthDim: depthDim, mat: mesh.material,
          im: im,
          driftPhase: s1 * Math.PI * 2, driftAmp: 0.02 + s2 * 0.03, hovered: false, tween: null,
          selected: false, actionEl: null,
          dwell: null   // VRDwell token while this tile's reach is being held for
        };
        self._tiles.push(tile);

        // Hover is suppressed while something is selected: the rest of the cloud
        // has receded and dimmed on purpose, and letting a tile back there float
        // forward on hover would put it right back in front of the thing the
        // visitor is actually looking at.
        //
        // ── The reach is GATED BY A DWELL (dwell.js) ──
        // Sebastian: *"whenever you look at an image it should just fly towards
        // you … just so when someone's looking through it's not pulling images
        // towards them like crazy. So there's a little more intention."* Hover
        // used to call _focus() on the frame the ray arrived, which meant
        // sweeping a gaze (or a mouse) across the cloud fired every tile it
        // crossed — up to a dozen 0.5 s flights in flight at once, all of them
        // reversing behind you. Now hover only ARMS: VRDwell fills a small ring
        // on the tile over ~0.9 s and the reach runs when it completes.
        //
        // This is not a fuse (hard rule 7): the reach is a reversible preview,
        // and SELECTING a photo is still an explicit click — see the long note
        // at the top of dwell.js.
        tileEl.addEventListener('mouseenter', function () {
          if (self._selected && self._selected !== tile) return;
          if (tile.selected) return;
          // Already forward: nothing to arm. Re-running the ring on the tile it
          // has already pulled in is pure noise — it draws a filling circle over
          // a photo that is not going to move when it finishes.
          if (tile.hovered) return;
          self._armReach(tile);
        });
        tileEl.addEventListener('mouseleave', function () {
          if (self._selected && self._selected !== tile) return;
          if (tile.selected) return;
          // Disarm an INCOMPLETE dwell — you looked away before the ring filled,
          // so the reach never happens. A dwell abandoned half-way never moved
          // the tile, so there is nothing to unwind.
          self._disarmReach(tile);
          // ── THE REACH IS LOCKED, and does not unwind on mouseleave ────────
          // This used to call _focus(tile, false) here. Sebastian, on the walk-
          // through: *"once an image is fully circled, it should always come
          // forward … it deselects mid-load if the gaze drifts."* Which is
          // exactly what happened: the ring costs ~0.9 s of deliberate holding,
          // and then a photo that may still be fetching its full-size texture
          // was sent home again by half a degree of head drift — the visitor
          // paid the gate and got nothing for it, and the bigger the photo the
          // more likely it was still loading when the gaze wandered.
          //
          // So a completed reach now holds until something explicit replaces it:
          // another tile's ring completing (_focus's handover below), a click
          // (which promotes it to a full selection), or select(null).
        });
        tileEl.addEventListener('click', function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
          // A click outranks the gate it was waiting on. Committing to a photo
          // is the explicit act the dwell exists to hold back FROM, so a visitor
          // who has already decided must never be made to sit out the ring —
          // and on a Vision Pro the whole hover cycle (mouseenter → click →
          // mouseleave, trap §3.13) arrives inside a few frames, so a pinch
          // would otherwise always cancel a dwell that had barely started.
          self._disarmReach(tile);
          self.select(tile.selected ? null : tile);
        });
      });
    },

    // ── The dwell gate in front of the reach ──────────────────────────────
    // Arming is idempotent per tile and there is only ever one dwell in the
    // scene (dwell.js keeps one ring), so arming a second tile releases the
    // first for free — which is the right behaviour: you are looking at the new
    // one now. The token is kept per tile only so a LATE mouseleave (the
    // ordering is not guaranteed when the ray crosses two tiles in one frame)
    // cancels its own dwell rather than whichever one happens to be current.
    _armReach: function (tile) {
      if (!window.VRDwell) { this._focus(tile, true); return; }  // gate absent, don't lose the feature
      var self = this;
      this._disarmReach(tile);
      tile.dwell = VRDwell.start(tile.el, {
        onComplete: function () { tile.dwell = null; self._focus(tile, true); }
      });
    },

    _disarmReach: function (tile) {
      if (tile.dwell == null) return;
      if (window.VRDwell) VRDwell.cancel(tile.dwell);
      tile.dwell = null;
    },

    // Float a tile forward + enlarge (reach), or ease it back into the cloud.
    //
    // Only ONE tile is ever reached, and this is where the handover happens: a
    // reach is locked (see the mouseleave note), so the next one has to send the
    // last one home itself. Done on COMPLETION rather than when the new ring is
    // armed, so a ring the visitor abandons half-way leaves the tile they
    // already pulled in exactly where it is.
    _focus: function (tile, on) {
      if (on && this._reached && this._reached !== tile) this._focus(this._reached, false);
      this._reached = on ? tile : (this._reached === tile ? null : this._reached);
      tile.hovered = on;
      this._setCaptionVisible(tile, on);
      // Same paint-order problem as selection, one step smaller: a reached tile
      // floats to 1.6 m while the rest of the cloud stays at 2.2 m+, and
      // without a lift the later-in-DOM tiles paint over it and its caption.
      // Below SELECTED_RENDER_ORDER, so a selected tile still wins if the ray
      // happens to be resting on a different one.
      if (!tile.selected) this._setRenderOrder(tile, on ? FOCUSED_RENDER_ORDER : 0);

      var target;
      if (on) {
        // Float in along the tile's OWN direction (stays in the back zone,
        // never swings around to the front), and clamp the height so the
        // enlarged tile's top edge stays below the title banner — so a reached
        // tile can't intersect the hub's other panels (VR_BUGFIX item 8).
        var dir = tile.home.clone(); dir.y = 0; dir.normalize();
        var halfH = tile.size * FOCUS_SCALE / 2;
        var focusY = Math.min(1.5, FOCUS_TOP - halfH);
        target = { pos: dir.multiplyScalar(FOCUS_R).setY(focusY), scale: FOCUS_SCALE };
      } else {
        target = { pos: tile.home.clone(), scale: 1 };
      }

      var targetDim = on ? 0 : tile.depthDim; // reached tile brightens to full

      if (reducedMotion || typeof gsap === 'undefined') {
        tile.el.object3D.position.copy(target.pos);
        tile.el.object3D.scale.setScalar(target.scale);
        tile.mat.uniforms.uDim.value = targetDim;
        return;
      }
      if (tile.tween) tile.tween.kill();
      var o = tile.el.object3D;
      var from = { x: o.position.x, y: o.position.y, z: o.position.z, s: o.scale.x, d: tile.mat.uniforms.uDim.value };
      var proxy = { t: 0 };
      tile.tween = gsap.to(proxy, {
        t: 1, duration: on ? IN_S : OUT_S, ease: 'power2.inOut',
        onUpdate: function () {
          o.position.set(
            from.x + (target.pos.x - from.x) * proxy.t,
            from.y + (target.pos.y - from.y) * proxy.t,
            from.z + (target.pos.z - from.z) * proxy.t
          );
          o.scale.setScalar(from.s + (target.scale - from.s) * proxy.t);
          tile.mat.uniforms.uDim.value = from.d + (targetDim - from.d) * proxy.t;
        },
        onComplete: function () { tile.tween = null; }
      });
    },

    // ── Select / deselect ──
    // Pass null to clear. Selecting a second tile releases the first, so there
    // is only ever one thing forward.
    select: function (tile) {
      var prev = this._selected;
      if (prev === tile) return;

      // Any dwell in flight is moot the moment something is selected: the rest
      // of the cloud is about to recede and dim, so a ring left filling on a
      // tile back there would complete into a reach that _recedeOthers has
      // already overruled. (select(null) too — a deselect returns the cloud to
      // where hover can act again, and it should start from a clean gate.)
      this._tiles.forEach(this._disarmReach, this);

      // A locked reach (see _focus) is also released by selection, and it has
      // to be released THROUGH _focus so the lock pointer, the caption and the
      // render order all come down with the tile. Two cases: the reached tile
      // IS the one being selected — it is about to be moved again by the
      // selection itself, so only the bookkeeping is undone — or it is some
      // other tile, which _recedeOthers is about to push home underneath us
      // without ever clearing the lock.
      if (this._reached) {
        if (this._reached === tile) { this._reached = null; }
        else { this._focus(this._reached, false); }
      }

      // Jump this tile's texture to the front of the shared load queue. With 32
      // tiles loading four at a time, the one you just picked can be twentieth
      // in line — and until it lands, selecting it pulls an EMPTY frame to your
      // face and holds it there. This is Sebastian's "pulling an image from the
      // cloud" note: not broken, just waiting its turn in a queue that didn't
      // know you were looking at it.
      if (tile && tile.im && tile.im.src && VRGlass.prioritiseTexture) {
        var pending = !(tile.mat && tile.mat.uniforms.map.value && tile.mat.uniforms.map.value.image);
        if (pending) VRGlass.prioritiseTexture(tile.im.src);
      }

      if (prev) {
        prev.selected = false;
        this._teardownAction(prev);
        this._setCaptionVisible(prev, false);
        this._setRenderOrder(prev, 0);
        this._moveTile(prev, prev.home.clone(), 1, prev.depthDim, OUT_S);
      }

      this._selected = tile || null;

      if (!tile) {
        this._recedeOthers(false);
        return;
      }

      tile.selected = true;
      tile.hovered = false;
      this._setCaptionVisible(tile, true);

      // Forward along the tile's OWN direction, so it stays in the cloud's zone
      // behind the hub rather than swinging around into the arrival view — same
      // reasoning as _focus, just nearer. Height is clamped so the enlarged
      // tile's top edge can't climb into the panels above.
      var dir = tile.home.clone(); dir.y = 0; dir.normalize();
      var halfH = tile.size * SELECT_SCALE / 2;
      var y = Math.min(1.55, SELECT_TOP - halfH);
      this._moveTile(tile, dir.multiplyScalar(SELECT_R).setY(y), SELECT_SCALE, 0, IN_S);

      this._recedeOthers(true);
      this._buildAction(tile);
      // After _buildAction, so the button is included. Its ui-button meshes are
      // built when that entity loads, which is a frame or two away — hence the
      // repeat on 'loaded' rather than trusting this pass to have caught it.
      this._setRenderOrder(tile, SELECTED_RENDER_ORDER);
      if (tile.actionEl && !tile.actionEl.hasLoaded) {
        var self = this;
        tile.actionEl.addEventListener('loaded', function () {
          if (self._selected === tile) self._setRenderOrder(tile, SELECTED_RENDER_ORDER);
        }, { once: true });
      }
    },

    // Show/hide a caption, building its backing chip the first time it is
    // needed. Lazy on purpose: 32 tiles x (poll troika + build a mesh) at load
    // would pay for 32 backings when a visit typically reveals a handful, and
    // troika has not laid the text out at build time anyway.
    _setCaptionVisible: function (tile, on) {
      if (!tile || !tile.cap) return;
      tile.cap.object3D.visible = on;
      if (on) this._ensureCaptionBg(tile);
    },

    // The chip is sized from the caption's REAL measured text block, not from
    // an estimate off fontSize x characters — these captions wrap to one or two
    // lines depending on the alt text, and a fixed-height chip would either
    // clip the second line or float a slab under a single one.
    //
    // troika measures asynchronously and `blockBounds` simply does not exist
    // until it has (VR_AI_BUILD_GUIDE.md §3.2), so this polls. It also bails
    // out if the caption has been hidden again in the meantime — a tile the
    // pointer brushed past should not build geometry a beat later.
    _ensureCaptionBg: function (tile) {
      if (tile.capBg || tile.capBgPending) return;
      tile.capBgPending = true;
      var cap = tile.cap;
      var tries = 0;
      (function poll() {
        if (!tile.cap || !tile.cap.object3D.visible) { tile.capBgPending = false; return; }
        var comp = cap.components['troika-text'];
        var mesh = comp && comp.troikaTextMesh;
        var bb = mesh && mesh.textRenderInfo && mesh.textRenderInfo.blockBounds;
        if (!bb) {
          if (++tries > 120) { tile.capBgPending = false; return; }
          setTimeout(poll, 40);
          return;
        }
        var w = (bb[2] - bb[0]) + CAP_BG_PAD_X * 2;
        var h = (bb[3] - bb[1]) + CAP_BG_PAD_Y * 2;
        var geo = VRScrollArrows.roundedRectGeometry(w, h, Math.min(CAP_BG_RADIUS, h / 2));
        var mat = new THREE.MeshBasicMaterial({
          color: CAP_BG_COLOR, transparent: true, opacity: CAP_BG_ALPHA,
          // An overlay behind a label, not a surface: it must not stamp depth
          // and cut a hole in the feathered tile above it (§3.6's warning about
          // depthWrite on soft-edged materials).
          depthWrite: false
        });
        var bg = new THREE.Mesh(geo, mat);
        // Centred on the text's own block, which is anchored top-centre — so
        // the block hangs BELOW the caption's origin and its centre is not 0.
        bg.position.set((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, -0.004);
        // Marked so _setRenderOrder can keep it one rung BEHIND its own text.
        // It is added to the subtree AFTER troika's mesh (it had to wait for the
        // measurement), and with equal renderOrder the transparent pass falls
        // back to scene-graph order — which would paint the chip over the words
        // it exists to support.
        bg.__capBg = true;
        cap.setObject3D('cap-bg', bg);
        tile.capBg = bg;
        tile.capBgPending = false;
        // Adopt whatever paint order the tile is currently sitting at.
        var order = 0;
        if (tile.selected) order = SELECTED_RENDER_ORDER;
        else if (tile.hovered) order = FOCUSED_RENDER_ORDER;
        bg.renderOrder = order - 1;
      })();
    },

    // Lift or drop a tile's whole subtree in the transparent paint order. Walks
    // the object3D tree rather than just the 'tile' mesh, so the caption and the
    // "View full project" button ride along instead of being painted over by the
    // cloud they now float in front of.
    _setRenderOrder: function (tile, order) {
      if (!tile || !tile.el) return;
      tile.el.object3D.traverse(function (n) {
        if (!(n.isMesh || n.isSprite || n.isPoints || n.isLine)) return;
        // The caption's backing chip rides one rung behind the caption itself,
        // or it paints over the text (see _ensureCaptionBg).
        n.renderOrder = n.__capBg ? order - 1 : order;
      });
    },

    // Push the rest of the cloud back and dim it, or restore it.
    _recedeOthers: function (on) {
      var self = this;
      this._tiles.forEach(function (t) {
        if (t === self._selected) return;
        if (t.cap) t.cap.object3D.visible = false;
        var target = t.home.clone();
        if (on) {
          // Scale the horizontal radius only — pushing y as well would drag the
          // whole cloud toward the floor as it recedes.
          var r = Math.sqrt(target.x * target.x + target.z * target.z);
          var k = (r * OTHERS_PUSH) / (r || 1);
          target.x *= k; target.z *= k;
        }
        self._moveTile(t, target, 1, on ? OTHERS_DIM : t.depthDim, on ? RECEDE_S : OUT_S);
      });
    },

    // One tween path for hover, select and recede, so they can't fight: every
    // caller goes through here and the previous tween is always killed first.
    _moveTile: function (tile, pos, scale, dim, dur) {
      if (tile.tween) { tile.tween.kill(); tile.tween = null; }
      var o = tile.el.object3D;
      if (reducedMotion || typeof gsap === 'undefined') {
        o.position.copy(pos);
        o.scale.setScalar(scale);
        tile.mat.uniforms.uDim.value = dim;
        return;
      }
      var from = { x: o.position.x, y: o.position.y, z: o.position.z, s: o.scale.x, d: tile.mat.uniforms.uDim.value };
      var proxy = { t: 0 };
      tile.tween = gsap.to(proxy, {
        t: 1, duration: dur, ease: 'power2.inOut',
        onUpdate: function () {
          o.position.set(
            from.x + (pos.x - from.x) * proxy.t,
            from.y + (pos.y - from.y) * proxy.t,
            from.z + (pos.z - from.z) * proxy.t
          );
          o.scale.setScalar(from.s + (scale - from.s) * proxy.t);
          tile.mat.uniforms.uDim.value = from.d + (dim - from.d) * proxy.t;
        },
        onComplete: function () { tile.tween = null; }
      });
    },

    // ── "View full project" ──
    // Only where the photo actually belongs to one: the catalog tags a photo's
    // project by matching its filename stem against a project href
    // (data-loader.js), so contact photos and anything unmatched simply don't
    // get the action. Destination is the themed VR room — the same place the
    // grid's "Enter the project room" goes, per §9.8.
    _buildAction: function (tile) {
      this._teardownAction(tile);
      var title = tile.im && tile.im.project;
      if (!title || !this._resolveProject) return;
      var project = this._resolveProject(title);
      if (!project) return;

      var btn = document.createElement('a-entity');
      btn.setAttribute('ui-button', {
        label: 'View full project', width: 0.44, height: 0.11,
        accent: project.accent || '#b8863b', variant: 'solid', arrow: true,
        labelColor: '#f5f5f0'
      });
      // Counter-scaled by SELECT_SCALE: the button is a child of the tile, and
      // without this it would be blown up with it and read as a slab rather
      // than a control. Authored size is the size you get.
      btn.object3D.scale.setScalar(1 / SELECT_SCALE);
      // Below the caption, which is anchored top at -size*0.62 and can run to
      // two lines at this size.
      btn.object3D.position.set(0, -tile.size * 0.62 - 0.20, 0.03);
      btn.addEventListener('click', function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        // Sealed door (index.html's VR_ROOMS): the tile stays selected and
        // forward, the notice explains why nothing opened.
        if (window.VR_ROOMS === false) return window.VRNotice.comingSoonRooms();
        window.VRProjectRoom.enter(project);
      });
      tile.el.appendChild(btn);
      tile.actionEl = btn;
    },

    _teardownAction: function (tile) {
      if (tile.actionEl && tile.actionEl.parentNode) tile.actionEl.parentNode.removeChild(tile.actionEl);
      tile.actionEl = null;
    },

    tick: function (time) {
      if (reducedMotion) return;
      // Very slow idle bob, only on tiles that aren't reached (so it doesn't
      // fight the focus tween). Cheap — a sine per tile, no allocations.
      // Skipped entirely while anything is selected: the bob writes y from
      // `home`, so it would drag the selected tile back out of its forward
      // position (and the receded tiles back toward their old radius) one frame
      // after the tween finished. This is the same class of bug as the
      // position-component clobber in §3.4 — a second writer to the same
      // transform.
      if (this._selected) return;
      for (var i = 0; i < this._tiles.length; i++) {
        var t = this._tiles[i];
        if (t.hovered || t.tween) continue;
        t.el.object3D.position.y = t.home.y + Math.sin(time * 0.0004 + t.driftPhase) * t.driftAmp;
      }
    },

    remove: function () {
      this._tiles.forEach(function (t) {
        if (t.tween) t.tween.kill();
        // The caption chips are the one thing here built lazily at runtime, so
        // they are the one thing this has to free — three.js never auto-disposes
        // (the tile meshes and their textures predate this method and are still
        // not freed; the cloud is never actually removed in the shipped scene).
        if (t.capBg) {
          if (t.capBg.geometry) t.capBg.geometry.dispose();
          if (t.capBg.material) t.capBg.material.dispose();
          t.capBg = null;
        }
      });
      this._tiles = [];
      this._selected = null;
    }
  });
})();
