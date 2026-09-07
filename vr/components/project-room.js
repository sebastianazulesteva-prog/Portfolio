/* ═══ project-room.js ═══
   The "elegant world transform" (§7 of VR_BUILD_SPEC.md): selecting a
   project doesn't just link out — it transforms the whole dome into that
   project's own themed room, styled after the real project page's own color
   tokens (see themes.js). A calm "← Return to dome" eases back.

   A themed room retints THREE things, not just one: the dome sky/horizon,
   the floor, and — new — the scene's actual ambient/key lights (previously
   only the dome elements changed; the real lighting stayed dusk-colored, so
   a room never quite stopped feeling like the hub with a different
   backdrop). It also arranges up to 4 of the project's own real gallery
   images (data-loader.js's `roomImages`, pulled live from the project's own
   page) as small feathered glass cards around the visitor, tilted to face
   them — the room actually holds the project's images now, not one flat
   hero. Projects with no photography (the four PDF write-up pages) simply
   skip the gallery and stay text-forward — never blocked on missing assets.

   Rough-pass transition: cross-fade the hub out / room in over ~500ms.
   Respects reduced-motion (instant swap, no fade) per the addendum.

   Usage: VRProjectRoom.enter(project); VRProjectRoom.exit();
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TRANSITION_MS = 1400; // full dip-to-dark-and-emerge, within §7's 1.2–2s

  // Read from the DOM, never a hardcoded id list: this used to be five ids that
  // silently missed #writingConstellation (VR_TEST_REPORT B1) — the writing
  // cards stayed visible AND clickable inside every room, so a visitor could
  // open the PDF reader on top of an open room. See the .hub-cluster comment in
  // index.html. Queried per call rather than cached, because the clusters are
  // populated after load and a cached NodeList would freeze that moment.

  // The scene's base lighting used to be hand-copied here as two constants
  // "matching the <a-light> defaults in index.html". They had drifted: the key
  // restored #e0a878 @ 0.15 against an authored #ffc98a @ 1.5 — 10x too dim
  // plus a colour shift — and only #keyLight was touched at all, so the other
  // three fixtures kept the room's colour for the rest of the session. Net
  // effect: every room visit permanently dimmed the hub's lit glass by ~17%.
  // Nothing is copied now; both are snapshotted from the live markup below.
  var ambientBase = null;

  // Snapshot the authored ambient once, before the first retint. The key-light
  // rack's snapshot lives in glass-material.js's vr-key-light system (it owns
  // the rack and the room-colour mirroring), so both come from index.html.
  function captureBaseLights() {
    if (ambientBase) return;
    var ambient = document.querySelector('#ambientLight');
    var l = ambient && ambient.getAttribute('light');
    if (l) ambientBase = { color: l.color, intensity: l.intensity };
  }

  // Resolved per call, never cached: the rug is authored in index.html but its
  // component may not have initialised when this file loads, and a cached null
  // would silently disable rug theming for the whole session.
  function rugComponent() {
    var el = document.querySelector('[dusk-rug]');
    var c = el && el.components && el.components['dusk-rug'];
    return (c && c.setColor) ? c : null;
  }

  // Dark halo for any text a room floats over its own themed background. 8% of
  // the glyph size, not a hairline: at 5% the tags still measured 4.3:1 against
  // the pendant theme's near-white floor.
  var ROOM_HALO = { outlineWidth: '8%', outlineColor: '#0b0a08', outlineOpacity: 1, outlineBlur: '10%' };

  var state = { open: false, roomEl: null, transTween: null };


  // Every selection ray in the scene (the camera cursor + both hand
  // controllers) caches its list of `.clickable` targets and only rebuilds it
  // when marked dirty. A project room — and its "← Return to dome" button — is
  // created and appended *after* load, at the transition's dark peak; unlike
  // the persistent #focusStage, its button isn't in any raycaster's list yet.
  // A-Frame's own MutationObserver eventually catches it, but that's a frame-
  // timing gamble that in-headset lost often enough that Return read as dead
  // (ISSUE-01): the ray had no target to hit, so the pinch/tap fell through.
  // Refresh every clickable ray explicitly the moment the room is in the graph,
  // so the button is a live hit target on the very first look — no dropped taps.
  function refreshClickableRaycasters() {
    ['#head [cursor]', '#leftHand', '#rightHand'].forEach(function (sel) {
      var el = document.querySelector(sel);
      var rc = el && el.components && el.components.raycaster;
      if (rc) rc.refreshObjects();
    });
  }

  function setHubVisible(visible) {
    [].slice.call(document.querySelectorAll('.hub-cluster')).forEach(function (el) {
      el.setAttribute('visible', visible);
    });
  }

  // The viewer's current heading (yaw only) in world space, captured the moment
  // a room opens. The room's whole content column is authored facing local -Z;
  // rotating the room container by this yaw makes that forward align with wherever
  // the viewer is actually looking — so the title + gallery spawn front-and-centre
  // instead of wherever world -Z happens to be (ISSUE-02). Yaw only: pitch/roll are
  // dropped so a head tilt can't cant the room. Captured ONCE here (the room stays
  // put afterward) — it anchors to the entry pose, it doesn't follow the head.
  function currentHeadYawDeg() {
    var head = document.querySelector('#head');
    if (!head) return 0;
    var q = new THREE.Quaternion();
    head.object3D.getWorldQuaternion(q);
    var fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    if (Math.abs(fwd.x) < 1e-6 && Math.abs(fwd.z) < 1e-6) return 0; // looking straight up/down
    // A room rotated rotation.y = θ points its local -Z to world (-sinθ, -cosθ);
    // solve that against the gaze forward so the room faces exactly where the
    // viewer looks (setting rotation.y = -atan2(fwd.x, fwd.z) would double the
    // offset instead of cancelling it — the sign matters).
    return THREE.MathUtils.radToDeg(Math.atan2(-fwd.x, -fwd.z));
  }

  // Recolor the SINGLE key light to the theme (VR_POLISH_STANDARDS.md §2) —
  // never its direction or the ambient fill. The ambient stays a constant low
  // neutral fill so shadows/tone read consistently scene-wide; only the key's
  // colour temperature shifts per room (warmer for Time Collector, cooler for
  // Chess, etc.). Direction is fixed in index.html and never touched here.
  // (The hub's glass panels are self-lit by design — they glow against the
  // dark rather than being lit by this key; the key light governs any lit
  // content, e.g. future 3D models on pedestals, and sets the one direction
  // convention the whole scene shares.)
  function retintLights(color, intensity) {
    var key = document.querySelector('#keyLight');
    if (key) key.setAttribute('light', { color: color, intensity: intensity });
  }

  function resetLights() {
    var ambient = document.querySelector('#ambientLight');
    if (ambient && ambientBase) ambient.setAttribute('light', ambientBase);
    // Restores colour AND intensity on all four .key-light fixtures from their
    // authored values, and clears the mirror's cached colour so it doesn't
    // immediately re-spread the lead's colour over the rest of the rack.
    if (window.VRGlass && VRGlass.restoreKeyRack) VRGlass.restoreKeyRack();
  }

  // Places a plain feathered-image glass card at (angleDeg, radius, height),
  // tilted to face a seated eye-level viewer — same outer-rotates/inner-
  // translates-then-tilts pattern as constellation.js's place(), but simpler
  // (no title/caption/click — these are decorative room dressing, not
  // navigable tiles).
  // Trim an alt string into a short one/two-line image caption.
  function shortCaption(alt) {
    alt = (alt || '').replace(/\s+/g, ' ').trim();
    if (alt.length > 78) alt = alt.slice(0, 76).replace(/[\s,.;:]+\S*$/, '') + '…';
    return alt;
  }

  function placeImageCard(container, image, angleDeg, radius, height, accent, a11y) {
    var eyeHeight = 1.6;
    var w = 0.62, h = 0.8;

    var outer = document.createElement('a-entity');
    outer.setAttribute('rotation', { x: 0, y: angleDeg, z: 0 });
    var inner = document.createElement('a-entity');
    inner.setAttribute('position', { x: 0, y: height, z: -radius });
    inner.setAttribute('rotation', { x: THREE.MathUtils.radToDeg(Math.atan2(height - eyeHeight, radius)), y: 0, z: 0 });

    var frame = new THREE.Mesh(new THREE.PlaneGeometry(w, h), VRGlass.makeCardMaterial(w, h, 0.045, accent, 0, 0.5));
    var img = VRGlass.makeFeatheredImage(image.src, w - 0.06, h - 0.06, 0.08, 1024);
    img.position.z = 0.008;

    var wrap = document.createElement('a-entity');
    wrap.object3D.add(frame);
    wrap.object3D.add(img);
    inner.appendChild(wrap);

    // Short description under each image (from its alt text) — visible on
    // entry, no interaction needed. Sits just below the frame.
    if (image.alt) {
      var cap = document.createElement('a-entity');
      // Same dark halo as the centre column (see ROOM_HALO): these captions hang
      // BELOW their image card, i.e. directly over the themed floor, which is
      // near-white in some themes — they measured 3.9:1 without it. Full
      // opacity for the same reason the tags are: dimming text that is already
      // short of contrast only costs more of it.
      cap.setAttribute('troika-text', {
        value: shortCaption(image.alt), align: 'center', anchor: 'center', baseline: 'top',
        color: '#f5f5f0', fillOpacity: 1, font: VRFonts.body(),
        fontSize: VRType.label(), maxWidth: w + 0.14, lineHeight: 1.2,
        outlineWidth: ROOM_HALO.outlineWidth, outlineColor: ROOM_HALO.outlineColor,
        outlineOpacity: ROOM_HALO.outlineOpacity, outlineBlur: ROOM_HALO.outlineBlur
      });
      cap.setAttribute('position', { x: 0, y: -h / 2 - 0.035, z: 0.01 });
      inner.appendChild(cap);
    }

    outer.appendChild(inner);
    container.appendChild(outer);
  }

  // A decorative generated panel for text-forward rooms (the PDF write-ups
  // have no photography) — same placement/tilt as placeImageCard, but the
  // hero is a procedural accent graphic (VRGlass.makePlaceholderImage) instead
  // of a photo, so the room feels composed rather than a lone floating title
  // (VR_BUGFIX item 1 / item 6).
  function placePlaceholderCard(container, label, angleDeg, radius, height, accent) {
    var eyeHeight = 1.6;
    var w = 0.62, h = 0.8;

    var outer = document.createElement('a-entity');
    outer.setAttribute('rotation', { x: 0, y: angleDeg, z: 0 });
    var inner = document.createElement('a-entity');
    inner.setAttribute('position', { x: 0, y: height, z: -radius });
    inner.setAttribute('rotation', { x: THREE.MathUtils.radToDeg(Math.atan2(height - eyeHeight, radius)), y: 0, z: 0 });

    var frame = new THREE.Mesh(new THREE.PlaneGeometry(w, h), VRGlass.makeCardMaterial(w, h, 0.045, accent, 0, 0.5));
    var img = VRGlass.makePlaceholderImage(w - 0.06, h - 0.06, accent, label, 0.08);
    img.position.z = 0.008;

    var wrap = document.createElement('a-entity');
    wrap.object3D.add(frame);
    wrap.object3D.add(img);
    inner.appendChild(wrap);

    outer.appendChild(inner);
    container.appendChild(outer);
  }

  // ── The hero panel ──────────────────────────────────────────────────────
  // Centred, at eye height, on arrival, and sized to match the home portrait —
  // the bio image of Sebastian, 0.72 x 1.08 in index.html's mosaic-reveal.
  //
  // Matched by AREA, not by a bounding box. Fitting inside a box was the first
  // attempt and it made the portrait-aspect heroes far weaker than the
  // landscape ones: Pendant came out 18° wide against Bastón's 36°, because a
  // 3:4 image hits the box's height limit while a 16:9 one hits its width.
  // Equal area gives every hero the same visual weight whatever its shape,
  // which is what "the same size as the portrait" has to mean across aspects
  // ranging from 0.75 to 1.778.
  //
  // HERO_AREA is the portrait's own area. The hero sits at 2.0 m against the
  // portrait's 1.5 m, so it subtends a little less — ~22° wide for Pendant
  // against the portrait's 27° — which is why this is "roughly", not exact.
  // Bringing it to 1.5 m to match angularly too would put it in front of the
  // text plane and inside the walk bound's 1.15 m forward cap.
  var HERO_AREA = 0.72 * 1.08;
  // Guard only: keeps a hypothetical ultra-wide hero clear of the gallery's
  // inner edge at 45.7°. The widest real one (Slip Door, 16:9) is 1.18.
  var HERO_MAX_W = 1.45;
  // 1.7 m, i.e. 15% nearer than the 2.0 m this first shipped at, which puts
  // the tallest hero at 25° wide against the home portrait's 27° — very close
  // to matching it as SEEN, not just in metres. It stays clear of the walk
  // bound's 1.15 m forward cap by 0.55 m.
  var HERO_Y = 1.62, HERO_Z = 1.7;

  // The text sits FARTHER than the hero (2.0 m vs 1.7 m), so the two are no
  // longer on one plane and nothing about their layout can be reasoned about
  // in Y any more — only in ANGLE. Moving the hero 15% nearer grew it ~18%
  // angularly, and at the fixed Y values this had before, Pendant's title
  // overlapped its own hero by 1.4°: text is appended after the hero, so it
  // would have painted straight over the photograph (guide §3.6).
  var TEXT_Z = 2.0;
  var EYE_Y = 1.6;
  // Half-height of the dome's ember band, from dome.js's 0.42/0.58 gradient
  // stops. Text has to clear this as well as the hero — a 16:9 hero is only
  // 0.66 m tall and does NOT cover the band's full extent, so in the wide
  // rooms it is the BAND, not the hero, that sets where text can go.
  var BAND_DEG = 14.4;
  // Budget for the title's own block (one line plus slack) and the breathing
  // gap either side, both measured at the text plane.
  var TITLE_BLOCK = 0.14, TEXT_GAP = 0.06;

  // A y at the hero's distance -> the y at the TEXT distance that sits at the
  // same angle from the eye. This is the conversion that makes the clearances
  // below honest across the two planes.
  function heroYToTextY(y) {
    return EYE_Y + TEXT_Z * (y - EYE_Y) / HERO_Z;
  }

  function placeHero(container, project, accent) {
    if (!project.image) return null;

    // Fall back to 4:3 if a card ever ships without width/height rather than
    // guessing square, which is the one aspect none of the heroes are.
    var aspect = (project.imageW && project.imageH)
      ? (project.imageW / project.imageH)
      : (4 / 3);
    // Equal area, preserving aspect: w*h = HERO_AREA and w/h = aspect.
    var w = Math.sqrt(HERO_AREA * aspect), h = Math.sqrt(HERO_AREA / aspect);
    if (w > HERO_MAX_W) { w = HERO_MAX_W; h = HERO_MAX_W / aspect; }

    var wrap = document.createElement('a-entity');
    wrap.setAttribute('position', { x: 0, y: HERO_Y, z: -HERO_Z });

    // Same plate + inset feathered image as the gallery cards, so the hero is
    // recognisably the same kind of object — just bigger and dead ahead.
    // heroTone taps the shader's highlight rolloff for a hero shot on pure
    // white (the pendant, projects.json's heroTone 0.6); it was already
    // scraped and, until now, only the hub's card used it.
    var plate = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      VRGlass.makeCardMaterial(w, h, 0.045, accent, 0, 0.5)
    );
    var img = VRGlass.makeFeatheredImage(project.image, w - 0.06, h - 0.06, 0.08, 1024, project.heroTone || 0);
    img.position.z = 0.008;

    wrap.object3D.add(plate);
    wrap.object3D.add(img);
    container.appendChild(wrap);
    return { el: wrap, w: w, h: h, top: HERO_Y + h / 2, bottom: HERO_Y - h / 2 };
  }

  function buildRoom(project) {
    var a11y = document.body.classList.contains('accessible');
    // ONE accent per room, from themes.js. This used to read project.accent
    // (projects.json) while retintLights() read theme.accent — two sources for
    // "the accent", and they had diverged in two of the five rooms: Slip Door
    // was lit pale ice #cdeffa but trimmed saturated #0091c8, and Chess was lit
    // near-white #f7f5f0 but trimmed mid-grey #8a8a8a. A room now lights and
    // trims itself the same colour, and themes.js is the only place to change
    // it. projects.json's accent still styles that project's card out in the
    // HUB, which is a different surface in different light — left alone.
    var accent = VRThemes.get(project.theme).accent || project.accent || '#b8863b';
    var room = document.createElement('a-entity');
    room.id = 'projectRoom';

    // Title → blurb → tags, flowed top-down by measured height (VRTextFlow)
    // so the long essay-project titles ("Social Engineering via Predictive
    // Algorithms") that wrap to 2 lines don't collide with the blurb beneath.
    // Centered column, anchored at a fixed top (y 2.02) and z -1.7.
    // Every line in this column carries a thin dark halo. The room's own theme
    // paints the sky from theme.sky and the FLOOR from theme.panel, and in at
    // least one shipped theme those are #3a3a38 and #f7f6f3 — a dark upper half
    // and a near-white lower half. Text at y 1.25–2.0 crosses that boundary on
    // screen depending on where the visitor looks, which is how the tags
    // measured 3.45:1 and the Return button 3.55:1 (VR_TEST_REPORT: project
    // rooms). An outline fixes contrast against BOTH halves without putting a
    // backing plate behind the text and changing how a room reads.
    function withHalo(spec) {
      Object.keys(ROOM_HALO).forEach(function (k) { spec[k] = ROOM_HALO[k]; });
      return spec;
    }
    var titleSpec = withHalo({
      value: project.title, align: 'center', font: VRFonts.title(),
      fontSize: VRType.title(), maxWidth: 2.2, lineHeight: 1.15, gapAfter: 0.05
    });
    var belowSpecs = [];
    if (project.blurb) {
      // The summary, front and centre — prominence via full opacity + centred
      // position, not a bespoke size (§5: hierarchy through weight/colour/
      // position, not a fourth text size).
      belowSpecs.push(withHalo({ value: project.blurb, align: 'center', font: VRFonts.body(),
        fillOpacity: 0.95, fontSize: VRType.body(), maxWidth: 1.9, lineHeight: 1.35, gapAfter: 0.05 }));
    }
    if (project.tags && project.tags.length) {
      // Full opacity, not 0.9: the tags were the worst-measured line in a room
      // and dimming accent-coloured text was costing contrast it didn't have.
      belowSpecs.push(withHalo({ value: project.tags.join('  ·  '), align: 'center', font: VRFonts.body(),
        color: accent, fillOpacity: 1, fontSize: VRType.label(), maxWidth: 1.9 }));
    }

    // ── The hero, dead ahead on arrival ──────────────────────────────────
    // A room used to open on its TEXT, with the project's own photographs out
    // at ±53–80° where you had to go looking for them, and the card hero —
    // the one image that says what this is — shown nowhere at all
    // (data-loader drops it from roomImages precisely because it is the card's).
    // Now the hero hangs centred at eye height, so the first thing in front of
    // you when the room resolves is the project itself.
    //
    // It is APPENDED FIRST, before any text, which is load-bearing: room
    // content is all renderOrder 0 and the scene sorts transparent objects by
    // scene-graph order, not depth (guide §3.6), so anything appended after
    // the hero paints over it. Text sits clear of it in Y anyway; this is
    // belt-and-braces for whatever gets added next.
    //
    // Sized to the hero's OWN aspect (project.imageW/H, off the flat card)
    // rather than to a fixed box, because the shader cover-fits: a fixed
    // landscape frame crops 44% of the height off a 3:4 hero and takes the
    // chain off the pendant. Fitted inside HERO_MAX so a 16:9 hero and a 3:4
    // hero read as the same weight of object rather than the same width.
    var hero = placeHero(room, project, accent);

    // Title ABOVE the hero, blurb + tags BELOW it, rather than one column.
    // Splitting it is what keeps both blocks out of the horizon band: the band
    // spans ±14.4° of elevation (dome.js's gradient stops), which at the text
    // plane is y 1.163–2.037 — exactly where a single top-anchored column used
    // to sit, and why Bastón's blurb and tags washed out on its magenta. The
    // hero now occupies that zone and masks it; the text brackets it.
    // Both stacks are top-anchored and flow DOWN, so these are tops, not
    // centres, and the gaps allow a title wrapping to two lines.
    if (hero) {
      // Derived per hero rather than fixed, so a tall 3:4 hero pushes its
      // title up only as far as it actually needs and a wide 16:9 one doesn't
      // pay for it. Whichever is more restrictive wins: the hero's own edge,
      // or the band's — see BAND_DEG.
      var bandHalf = TEXT_Z * Math.tan(BAND_DEG * Math.PI / 180);
      var titleTop = Math.max(heroYToTextY(hero.top), EYE_Y + bandHalf) + TEXT_GAP + TITLE_BLOCK;
      var belowTop = Math.min(heroYToTextY(hero.bottom), EYE_Y - bandHalf) - TEXT_GAP;
      VRTextFlow.stack(room, [titleSpec], { startY: titleTop, z: -TEXT_Z });
      if (belowSpecs.length) VRTextFlow.stack(room, belowSpecs, { startY: belowTop, z: -TEXT_Z });
    } else {
      // No hero (the PDF write-ups, which have no card image): the original
      // single top-anchored column, unchanged.
      VRTextFlow.stack(room, [titleSpec].concat(belowSpecs), { startY: 2.02, z: -1.7 });
    }

    // The room's real gallery — up to 4 of the project's own images (§7:
    // "holds the project's images ... around you"). Wrapped to the SIDES
    // (min ±26°) so they never sit in the central column where the title/
    // blurb/tags and the action buttons live — a bounding-box sweep caught
    // the previous ±14°/±42° arc overlapping the centered text. Skipped
    // entirely for the four PDF write-ups, which have no photography.
    var images = (project.roomImages || []).slice(0, 4);
    // Gallery lives out to the SIDES, fully clear of the forward column where
    // the text + buttons sit — you turn slightly to browse it, which is the
    // spec's "its images around you" feel and the only reliable way to avoid
    // the wide, wrapping blurb text colliding with them (a bounding-box sweep
    // of an earlier ±26° arc caught the blurb overlapping the inner cards, and
    // the cards overlapping each other).
    //
    // The angles/radius/height live in themes.js now (`room.gallery`) rather
    // than as constants here — but they are deliberately the SAME for every
    // room for now: rooms differ by colour only, so this layout gets judged
    // and refined once instead of five times. No theme overrides it; when one
    // does, only that room changes.
    // Read the four limits in themes.js before retuning any of these: the safe
    // range is narrow, and two of them are previously-fixed bugs (blurb
    // overlap, and walking into your own photographs).
    var g = VRThemes.room(project.theme).gallery;
    if (images.length) {
      images.forEach(function (image, i) {
        var mag = g.inner + Math.floor(i / 2) * g.step;
        var angle = (i % 2 === 0 ? -1 : 1) * mag;
        // Stagger alternates ACROSS the pair (left up / right down), so a
        // stagger of 0 is a strict level row — see chess and timecollector.
        var height = g.height + (i % 2 === 0 ? g.stagger : -g.stagger);
        placeImageCard(room, image, angle, g.radius, height, accent, a11y);
      });
    } else {
      // No photography → a symmetric pair of generated accent panels flanking
      // the text, keeping the same out-to-the-sides placement so the forward
      // column (title/blurb/tags + buttons) stays clear.
      placePlaceholderCard(room, project.title, -g.inner, g.radius, g.height, accent);
      placePlaceholderCard(room, project.title, g.inner, g.radius, g.height, accent);
    }

    // Only a Return control — the experience stays fully in VR (no link out
    // to the flat webpage). Everything the room has to say is already visible
    // on entry: the summary front-and-centre and a caption under each image.
    // The one shared exit control (exit-button.js) — same label, size, variant
    // and upper-right position as the reader's and the focus stage's. This was
    // '← Return to dome', 0.44 x 0.12, centred at y 1.25: a different phrase and
    // a different place from every other way out.
    //
    // The room's own accent is passed through so the plate still belongs to the
    // room, but the LIGHT label is not negotiable: a room dims the key rack to
    // 0.22, and ui-button's near-black solid label (9.15:1 in the hub) collapses
    // to 2.1:1 in here. exit-button.js hardcodes the light label for that reason.
    // eye: 1.6 is the VIEWER's eye height, not the old button's y of 1.25 —
    // exit-button.js measures its upper-right slot as an angle up from the eye,
    // so feeding it the old button position put the new one back at eye level
    // (measured: screen NDC y 0.02 instead of 0.36, level with the horizon
    // rather than up and to the right like every other context's).
    var returnBtn = VRExitButton.mount(room, {
      distance: 1.3, eye: 1.6, accent: accent,
      onExit: function () { window.VRProjectRoom.exit(); }
    });

    // Once this button is fully loaded its object3D (and 'button-mesh') is
    // attached to the scene graph, so it's now safe to register it with the
    // selection rays — see the note in applyEnter on why an earlier refresh
    // misses it (ISSUE-01). This is the authoritative trigger: it fires when
    // the actual clickable is attached, not just its containing room.
    if (returnBtn.hasLoaded) refreshClickableRaycasters();
    else returnBtn.addEventListener('loaded', refreshClickableRaycasters, { once: true });

    return room;
  }

  // The world-transform transition (§7 + VR_POLISH_STANDARDS.md §3): a single
  // eased dip-to-dark and emerge, using the comfort vignette as a full-view
  // mask. Ease UP to near-opaque, swap the whole world at the dark peak
  // (nothing visibly pops), ease back DOWN — one continuous power2.inOut curve,
  // ~1.4s total, never a snap. Reduced-motion → instant swap, no vignette.
  function runTransition(applyChanges) {
    if (state.transTween) { state.transTween.kill(); state.transTween = null; }
    var v = document.querySelector('#comfortVignette');
    var mesh = v && v.getObject3D('mesh');
    if (reducedMotion || !mesh || typeof gsap === 'undefined') { applyChanges(); return; }

    var mat = mesh.material;
    var half = (TRANSITION_MS / 1000) / 2;
    var flash = v.components && v.components['vignette-flash'];
    // A FLAT fill, not the walking vignette: dead ahead the radial term is
    // exactly 0, so without this the swap happens in plain view at the centre
    // of the screen however high opacity goes (see locomotion.js's setFlat).
    if (flash && flash.setFlat) flash.setFlat(true);
    v.setAttribute('visible', true);
    mat.opacity = 0;
    state.transTween = gsap.to(mat, {
      opacity: 0.92, duration: half, ease: 'power2.inOut',
      onComplete: function () {
        applyChanges(); // swap at peak darkness
        state.transTween = gsap.to(mat, {
          opacity: 0, duration: half, ease: 'power2.inOut',
          onComplete: function () {
            v.setAttribute('visible', false);
            if (flash && flash.setFlat) flash.setFlat(false);
            state.transTween = null;
          }
        });
      }
    });
  }

  function applyEnter(project) {
    setHubVisible(false);
    captureBaseLights(); // before the retint below, so it records the hub's own
    var scene = document.querySelector('a-scene');
    var theme = window.VRThemes.get(project.theme);
    var sky = document.querySelector('[dusk-sky]');
    var floor = document.querySelector('[dusk-floor]');
    if (sky) sky.components['dusk-sky'].setTheme(theme.sky, theme.horizon);
    if (floor) floor.components['dusk-floor'].setColor(theme.panel);
    // The rug was the one ground surface a room didn't retint, so the hub's
    // dark brown pad stayed put on top of the room's own floor colour: a
    // stain on the near-white Pendant floor, invisible on the dark ones. Its
    // colour is derived from the theme (VRThemes.rug). Its radius is set too,
    // but every room currently asks for the hub's own 1.3 — setRadius
    // early-returns on an unchanged value, so today this is a colour-only
    // change and the size hook is simply ready for later.
    var rug = rugComponent();
    if (rug) {
      rug.setColor(VRThemes.rug(project.theme));
      rug.setRadius(VRThemes.room(project.theme).rugRadius);
    }
    retintLights(theme.accent, 0.22);

    var room = buildRoom(project);
    room.setAttribute('visible', true);
    // Face the room's content toward wherever the viewer is looking on entry, so
    // the title + hero land front-and-centre rather than off at world -Z, forcing
    // a hunt (ISSUE-02). Captured once — the room doesn't track the head after.
    room.setAttribute('rotation', { x: 0, y: currentHeadYawDeg(), z: 0 });
    scene.appendChild(room);
    state.roomEl = room;
    // The room's "← Return to dome" button registers itself with the selection
    // rays once it finishes loading — see buildRoom(). It must happen after the
    // button's object3D is attached to the scene graph, or flattenObject3DMaps()
    // silently drops it and Return reads as dead (ISSUE-01).
  }

  function applyExit() {
    var sky = document.querySelector('[dusk-sky]');
    var floor = document.querySelector('[dusk-floor]');
    if (sky) sky.components['dusk-sky'].clearTheme();
    if (floor) floor.components['dusk-floor'].resetColor();
    var rug = rugComponent();
    if (rug) { rug.resetColor(); rug.resetRadius(); }
    resetLights();
    // Null-safe: only detach if it's still parented (guards against a double
    // exit or the node being pulled out from under us), so a stray exit never
    // throws and leaves the hub half-restored.
    if (state.roomEl) {
      // Frees the room's own frames, hero images and buttons. Sealed behind
      // window.VR_ROOMS today, so this leaked nothing in practice — but the code
      // is live and each enter() builds a plate plus a 1024 px feathered image
      // per room photo, so it would have leaked as soon as the flag flipped.
      VRGlass.disposeSubtree(state.roomEl.object3D);
      if (state.roomEl.parentNode) state.roomEl.parentNode.removeChild(state.roomEl);
      state.roomEl = null;
    }
    setHubVisible(true);
    // The room's clickables are gone now — drop them from every ray's cached
    // target list so a stale mesh can't keep swallowing hits back in the hub.
    refreshClickableRaycasters();
  }

  function enter(project) {
    if (state.open) applyExit(); // clean up any open room instantly (rare — rooms are only entered from the hub)
    state.open = true;
    runTransition(function () { applyEnter(project); });
  }

  function exit() {
    if (!state.open) return;
    state.open = false;
    runTransition(applyExit);
  }

  window.VRProjectRoom = { enter: enter, exit: exit };
})();
