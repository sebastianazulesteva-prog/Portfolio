/* ═══ focus-stage.js ═══
   The "pull it closer" detail view — the heart of the command-zone
   interaction Sebastian asked for. This is not a walk-up gallery: constellation
   cards (hub-panel.js) are small glance tiles arranged around a small central
   zone, close enough to read but not meant to be walked toward. Selecting one
   doesn't jump straight into a project room — the clicked card itself visibly
   flies from its constellation slot to reading distance in front of the
   viewer, growing into this enlarged panel with the full detail: blurb + tags
   for a project, the full bullet list for a role (VR_BUGFIX_NOTES.md item 5 —
   "cards should animate toward the viewer on select," tweened with GSAP per
   its own suggestion). From here the viewer decides: enter the themed project
   room, or dismiss and keep browsing the hub.

   Mechanically this is one reusable stage entity (not a clone per card): the
   origin card is hidden for the duration (so it never doubles-up or clips
   against the stage — item 11), the stage is snapped to the origin's exact
   world transform, content is built at full size, then GSAP tweens position/
   quaternion/scale from there to the destination. Every OTHER constellation
   card dims to ~1/3 opacity while one is focused (item 7), so the pulled-in
   item reads as the clear subject. FOCUS_DISTANCE is fixed well inside
   CONSTELLATION_RADIUS (index.html), so the stage is always nearer than the
   array regardless of which card opened it — no per-card tuning needed to
   avoid clipping into neighbors (item 11).

   Only yaw (not head pitch/roll) drives the destination, and destination
   height is pinned to a fixed eye level — so looking up/down doesn't plant
   the card on the ceiling or floor, and it never tilts with a head tilt.

   Usage:
     VRFocusStage.init(document.querySelector('#focusStage'));  // once, at load
     VRFocusStage.open({ type: 'project', data: projectItem }, originCardEl);
     VRFocusStage.open({ type: 'experience', data: experienceItem }, originCardEl);
     VRFocusStage.close();
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var FOCUS_DISTANCE = 1.05; // metres in front of the viewer — closer than any constellation card
  var EYE_HEIGHT = 1.55;
  var W = 1.2, H = 0.95, PAD = 0.07;
  var FLY_IN_MS = 420, FLY_OUT_MS = 280;

  // Near-opaque, per Sebastian: this is the READING view, and at the previous
  // 0.74 the whole constellation showed straight through the panel — the
  // dimmed cards behind it landed directly behind the bullet text and made it
  // genuinely hard to read (measured: every non-focused card still at
  // alpha x 0.66 after dimming). CARD_FRAG clamps final alpha to 0.96, so
  // this is effectively "as opaque as the shared glass shader goes" rather
  // than an arbitrary number.
  var FOCUS_OPACITY = 0.96;

  // Bounds for the content-fitted experience panel (see buildExperience):
  // small enough that a 2-bullet role isn't a mostly-empty slab, tall enough
  // that the longest role still fits without cropping, and never so tall it
  // runs past comfortable reading height at FOCUS_DISTANCE.
  var MIN_H = 0.42, MAX_H = 1.15;

  // How far the surroundings drop while a card is focused. The key rack and
  // the ember ambient are scaled to this, so the dome/floor/other cards all
  // fall back together and the focused panel is the only lit thing — per
  // Sebastian, "reduce the lighting in the background". Restored on close.
  var BG_LIGHT_SCALE = 0.25;

  var state = { el: null, originEl: null, tween: null, stageH: null, savedLight: null };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Rebuilds the panel plane at a new height, disposing the old geometry and
  // material — three.js never auto-disposes, and this runs on every open.
  function setPanel(el, height, accent) {
    var old = el.getObject3D('stage-mesh');
    if (old) {
      el.removeObject3D('stage-mesh');
      if (old.geometry) old.geometry.dispose();
      if (old.material) old.material.dispose();
    }
    var mat = VRGlass.makeCardMaterial(W, height, 0.055, accent, 0, FOCUS_OPACITY);
    // makeCardMaterial ships depthWrite:false, which is right for the little
    // glance tiles (they overlap each other in the constellation and must
    // blend). It is WRONG here and was the real reason this panel still read
    // as see-through after raising its opacity: with no depth written, the
    // constellation behind it is never occluded, so every card back there
    // blended through the reading surface no matter how high uOpacity went.
    // A near-opaque reading panel should occlude — measured: the cards behind
    // stayed legible straight through the bullet text at uOpacity 0.96.
    mat.depthWrite = true;
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, height), mat);
    // Draw after the constellation regardless of how three.js sorts the
    // transparent queue, so the depth write lands before anything behind it
    // gets a chance to paint over.
    mesh.renderOrder = 10;
    el.setObject3D('stage-mesh', mesh);
  }

  // The panel is forced to renderOrder 10 so its depth write beats the
  // constellation behind it; everything ON the panel (text, buttons) must
  // therefore sort above that, or the near-opaque panel paints over its own
  // content. Called repeatedly because troika text and ui-button meshes are
  // created asynchronously — a single pass at build time would miss them.
  function liftContentAbovePanel(el) {
    var panel = el.getObject3D('stage-mesh');
    el.object3D.traverse(function (o) {
      if (o.isMesh && o !== panel) o.renderOrder = 11;
    });
  }

  // Scales the shared light rack down while focused and restores it after.
  // Writes the uniform VALUES that glass-material.js hands out by reference,
  // so every glass panel, card text and the dome pick it up together with no
  // per-surface bookkeeping.
  // ── The focus stage's own close control ──
  // NOT the shared "Back to the dome" button (exit-button.js). Sebastian:
  // "there is no need for 'back to dome' buttons when you don't leave the dome."
  // The focus stage is a pull-closer overlay INSIDE the dome — nothing was left,
  // so the control just closes the card.
  //
  // It keeps the exit button's CORNER (top-right, clear of the panel's edge) so
  // "the way out of this thing is up there" is consistent, but it is
  // deliberately small and ghost: a quiet sibling of the big rust exit, not a
  // rival to it.
  var CLOSE_W = 0.30, CLOSE_H = 0.12;

  function mountClose(panelEl, panelWidth, panelHeight, accent, onClose) {
    var btn = document.createElement('a-entity');
    btn.setAttribute('ui-button', {
      label: 'Close', width: CLOSE_W, height: CLOSE_H,
      accent: accent, variant: 'ghost',
      // A five-letter word on a 0.30 x 0.12 plate came out at 0.028 — 23% of
      // the button's height, which reads as small text floating in a big pill
      // rather than as a label (Sebastian: "the text is sort small for the
      // space of the button"). 1.3x takes it to ~0.036, about 30% of the
      // height, matching how the wider CTAs sit in their plates.
      fontScale: 1.3
    });
    positionClose(btn, panelWidth, panelHeight);
    btn.addEventListener('click', onClose);
    panelEl.appendChild(btn);
    return btn;
  }

  // Split out because the experience card's height is only known once troika has
  // measured its text, so the control has to be re-placed after the reflow.
  function positionClose(btn, panelWidth, panelHeight) {
    btn.setAttribute('position', {
      x: panelWidth / 2 - CLOSE_W / 2,
      y: panelHeight / 2 + CLOSE_H / 2 + 0.03,
      z: 0.03
    });
  }

  function setBackgroundLight(dimmed) {
    if (!window.VRGlass || !VRGlass.sharedLightUniforms) return;
    var L = VRGlass.sharedLightUniforms();
    if (dimmed) {
      if (state.savedLight) return; // already dimmed — don't capture the dimmed values as the baseline
      state.savedLight = {
        colors: L.uLightColor.value.map(function (c) { return c.clone(); }),
        emberAmt: L.uEmberFall.value.x
      };
      L.uLightColor.value.forEach(function (c) { c.multiplyScalar(BG_LIGHT_SCALE); });
      L.uEmberFall.value.x *= BG_LIGHT_SCALE;
    } else {
      if (!state.savedLight) return;
      state.savedLight.colors.forEach(function (c, i) { L.uLightColor.value[i].copy(c); });
      L.uEmberFall.value.x = state.savedLight.emberAmt;
      state.savedLight = null;
    }
  }

  // Dims every OTHER constellation card while one is focused (item 7) — the
  // originEl is skipped since it's the thing IN focus (currently hidden while
  // it "becomes" the stage, so dimming it would be moot, but skip explicitly
  // for clarity/robustness if that ever changes).
  function setAllDimmed(on, exceptEl) {
    Array.prototype.forEach.call(document.querySelectorAll('[hub-panel]'), function (el) {
      if (el === exceptEl) return;
      var comp = el.components['hub-panel'];
      if (comp && comp.dim) comp.dim(on);
    });
  }

  // Tweens an object3D's position/quaternion/scale from one transform to
  // another over `duration` seconds. GSAP doesn't natively slerp quaternions,
  // so we tween a plain progress proxy and apply lerp/slerp ourselves each
  // frame — the approach GSAP's own docs suggest for non-numeric properties.
  // Note: `slerpQuaternions` is an instance method on THREE.Quaternion in
  // this three.js build (r158) — there is no static `THREE.Quaternion.slerp`.
  function tweenTransform(object3D, from, to, duration, ease, onComplete) {
    var proxy = { t: 0 };
    return gsap.to(proxy, {
      t: 1, duration: duration, ease: ease,
      onUpdate: function () {
        object3D.position.lerpVectors(from.pos, to.pos, proxy.t);
        object3D.quaternion.slerpQuaternions(from.quat, to.quat, proxy.t);
        object3D.scale.lerpVectors(from.scale, to.scale, proxy.t);
      },
      onComplete: onComplete
    });
  }

  // MEASURED, before this freed anything: 2.00 geometries leaked per open,
  // steady state, over two matching blocks of ten opens. `removeObject3D` and
  // `removeChild` unlink an object and leave its GPU allocation behind — see
  // VRGlass.disposeSubtree's note. The experience path never showed this because
  // it builds its panel through setPanel(), which has always disposed; the
  // project path built its own inline and nothing ever freed it.
  //
  // The child ENTITIES are a different matter and are left to A-Frame: troika
  // and ui-button dispose in their own component remove() hooks, which
  // removeChild triggers.
  function clearStage(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    ['stage-mesh', 'stage-image'].forEach(function (name) {
      var o = el.getObject3D(name);
      if (!o) return;
      el.removeObject3D(name);
      VRGlass.disposeSubtree(o);
    });
  }

  function buildProject(el, data) {
    var a11y = document.body.classList.contains('accessible');
    var accent = data.accent || '#b8863b';
    // Through setPanel, NOT inline. This used to build its own mesh here and
    // silently missed two things setPanel does — which is the whole argument for
    // one builder:
    //   • `mat.depthWrite = true`, whose own note in setPanel records that
    //     leaving it false was "the real reason this panel still read as
    //     see-through": with no depth written, every constellation card behind
    //     the panel blends through it however high uOpacity goes. Experience
    //     cards got the fix (they go through setPanel); PROJECT cards — the
    //     default destination for a photo card's body tap since §9.13 — did not.
    //   • `mesh.renderOrder = 10`, which is what liftContentAbovePanel's 11 is
    //     measured against. The inline panel sat at the default 0.
    // And it disposes the previous panel, which is half the leak clearStage
    // now closes.
    setPanel(el, H, accent);

    var y = H / 2 - PAD;

    if (data.image) {
      var imgH = H * 0.42;
      // Rounded corners + a hard edge, matching the hub's glance cards — this
      // is the treatment those cards were given and the focus stage never got.
      // It was `featherWorld: 0.05` with no corner radius, i.e. a SQUARE-cornered
      // rectangle fading out at its edges. On a hero shot on pure white (the
      // pendant) that reads as a bright slab pasted onto the card, next to a
      // hub card of the same photo that reads as a window with rounded corners.
      //
      // tone stays 0 deliberately: hub-panel.js records that the highlight
      // rolloff + vignette (imagetone) "read as dynamic lighting / a colour
      // filter darkening the thumbnail" in a walkthrough and was dropped
      // (ISSUE-07). Blown-out heroes are accepted as the honest image.
      // 1536: this one IS read close, so it gets more than a glance card's
      // 1024 — but it was `null` (uncapped), which meant a 24-megapixel hero
      // uploaded whole for a panel about a metre wide.
      var imgMesh = VRGlass.makeFeatheredImage(
        data.image, W - PAD * 2, imgH, 0, 1536, 0, 0.042);
      imgMesh.position.set(0, y - imgH / 2, 0.01);
      el.setObject3D('stage-image', imgMesh);
      y -= imgH + PAD * 0.8;
    }

    // Flow title → tags → blurb top-down by measured height (VRTextFlow), so
    // a long title that wraps ("Social Engineering via Predictive
    // Algorithms") pushes the tags/blurb down instead of the fixed offsets
    // stacking them on top of its second line.
    // Order: title → description → tags, so the project description sits
    // directly under the title (per Sebastian), with the tags as the quiet
    // trailing metadata line.
    var specs = [{
      value: data.title, font: VRFonts.title(), fontSize: VRType.title(),
      maxWidth: W - PAD * 2, x: -W / 2 + PAD, lineHeight: 1.15, gapAfter: 0.028
    }];
    if (data.blurb) {
      specs.push({ value: data.blurb, font: VRFonts.body(), fontSize: VRType.body(),
        fillOpacity: 0.85, maxWidth: W - PAD * 2, x: -W / 2 + PAD, lineHeight: 1.4, gapAfter: 0.026 });
    }
    if (data.tags && data.tags.length) {
      specs.push({ value: data.tags.join('  ·  '), font: VRFonts.body(), fontSize: VRType.label(),
        color: accent, fillOpacity: 0.9, maxWidth: W - PAD * 2, x: -W / 2 + PAD });
    }
    VRTextFlow.stack(el, specs, { startY: y });

    // Real, bounded buttons (VR_BUGFIX_NOTES.md item 6) — own mesh, own hit
    // target, unmistakable hover, rather than plain floating text.
    var actionY = -H / 2 + PAD + 0.055;
    var enterBtn = document.createElement('a-entity');
    enterBtn.setAttribute('ui-button', { label: 'Enter the project room', width: 0.62, height: 0.12, accent: accent, variant: 'solid', arrow: true });
    enterBtn.setAttribute('position', { x: -W / 2 + PAD + 0.31, y: actionY, z: 0.02 });
    enterBtn.addEventListener('click', function () {
      // Sealed door (index.html's VR_ROOMS). The stage stays OPEN behind the
      // notice: closing it would take away the detail the visitor is reading
      // and leave them looking at the constellation, which reads as the click
      // having thrown them out.
      if (window.VR_ROOMS === false) return window.VRNotice.comingSoonRooms();
      close(true);
      window.VRProjectRoom.enter(data);
    });
    el.appendChild(enterBtn);

    // Close, top-right — see mountClose. Was a '‹ Back' ghost pill tucked into
    // the bottom-right of the action row, which read as a form's cancel link.
    mountClose(el, W, H, accent, close);
  }

  function buildExperience(el, data) {
    var a11y = document.body.classList.contains('accessible');
    // Silvery, matching index.html's EXPERIENCE_ACCENT for the small glance
    // tile this expands from — kept as a duplicated literal, not a shared
    // constant: no module system across plain script tags here (no build
    // step) to pull one from.
    var accent = '#d6dbe0';

    // The exit control now sits ABOVE the panel (exit-button.js), so the card no
    // longer has to reserve a strip at the bottom for it — that band was 0.187 m
    // of otherwise-empty card. What's left is ordinary bottom padding.
    var BACK_BAND = PAD;

    // The card is sized to ITS OWN CONTENT, per Sebastian, instead of every
    // role sharing the fixed H. These entries vary a lot — "Guidewheel" with
    // 2 short bullets against "Virtual Human Interaction Lab (VHIL)" with a
    // 3-line company name and long research bullets — so one fixed height
    // either cropped the long ones or left the short ones as a mostly-empty
    // slab. Content is laid out from a local origin downward, its real height
    // measured (troika is async, hence the onReflow callback), and only then
    // is the panel built to match and the whole block re-centred.
    //
    // Text and button live in an inner wrapper so that re-centring is one
    // transform on the wrapper, not a reposition of every child.
    var inner = document.createElement('a-entity');
    el.appendChild(inner);

    // Flow company → role·date → bullets top-down by measured height, so a
    // long company name ("Virtual Human Interaction Lab (VHIL)") that wraps
    // doesn't collide with the role line or the bullets beneath it.
    var specs = [
      { value: data.company, font: VRFonts.title(), fontSize: VRType.title(),
        maxWidth: W - PAD * 2, x: -W / 2 + PAD, lineHeight: 1.15, gapAfter: 0.026 },
      { value: data.role + '  ·  ' + data.date, font: VRFonts.body(), fontSize: VRType.label(),
        color: accent, fillOpacity: 0.9, maxWidth: W - PAD * 2, x: -W / 2 + PAD, gapAfter: 0.032 }
    ];
    if (data.bullets && data.bullets.length) {
      specs.push({ value: data.bullets.map(function (b) { return '–  ' + b; }).join('\n\n'),
        font: VRFonts.body(), fontSize: VRType.body(), fillOpacity: 0.8,
        maxWidth: W - PAD * 2, x: -W / 2 + PAD, lineHeight: 1.4 });
    }

    // Child of `el`, NOT of `inner`: inner gets re-centred once the content has
    // been measured, and the close control has to stay pinned to the panel's own
    // top-right corner rather than travelling with the text block.
    var backBtn = mountClose(el, W, H, accent, close);

    // Provisional panel so the fly-in has something to show before troika
    // finishes measuring (typically well inside the 420ms tween).
    setPanel(el, H, accent);
    inner.object3D.position.y = H / 2 - PAD;

    VRTextFlow.stack(inner, specs, {
      startY: 0,
      onReflow: function (bottomY) {
        // bottomY is the stack's own final cursor, already below the last
        // block; it includes that block's trailing gap, which doubles as the
        // gap above the back button.
        var contentH = -bottomY;
        var fitted = clamp(PAD + contentH + BACK_BAND, MIN_H, MAX_H);
        setPanel(el, fitted, accent);
        inner.object3D.position.y = fitted / 2 - PAD;
        // The panel just changed height, so the close control's slot moved with
        // it — it is pinned to the panel's top edge, in the panel's own
        // coordinates (not the text wrapper's).
        positionClose(backBtn, W, fitted);
        state.stageH = fitted;
        liftContentAbovePanel(el);
      }
    });
  }

  // Yaw-only destination in front of wherever the viewer is currently
  // looking. Using the head entity's own world transform means this works
  // identically whether that direction came from head-aim, a controller ray,
  // or the mouse (§4's one shared pointer model).
  function destinationTransform() {
    var headEl = document.querySelector('#head');
    var worldPos = new THREE.Vector3();
    var worldQuat = new THREE.Quaternion();
    headEl.object3D.getWorldPosition(worldPos);
    headEl.object3D.getWorldQuaternion(worldQuat);
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1); // guard: looking straight up/down
    forward.normalize();

    var pos = worldPos.clone().addScaledVector(forward, FOCUS_DISTANCE);
    pos.y = EYE_HEIGHT;

    var dummy = new THREE.Object3D();
    dummy.position.copy(pos);
    var lookTarget = worldPos.clone();
    lookTarget.y = pos.y; // keep pure yaw — no pitch/roll from the viewer's head tilt
    dummy.lookAt(lookTarget);

    return { pos: pos, quat: dummy.quaternion.clone(), scale: new THREE.Vector3(1, 1, 1) };
  }

  function open(detail, originEl) {
    var el = state.el;
    if (!el || !detail) return;
    if (state.tween) state.tween.kill();

    // Switching straight from one focused card to another — restore whatever
    // was hidden for the previous one before hiding the new origin.
    if (state.originEl && state.originEl !== originEl) state.originEl.setAttribute('visible', true);
    state.originEl = originEl || null;

    clearStage(el);
    state.stageH = null; // set by buildExperience once its content is measured
    if (detail.type === 'project') buildProject(el, detail.data);
    else if (detail.type === 'experience') buildExperience(el, detail.data);
    else return;

    setAllDimmed(true, originEl);
    setBackgroundLight(true);
    if (originEl) originEl.setAttribute('visible', false);
    // Content meshes appear over the next few frames (troika layout,
    // ui-button init) — see liftContentAbovePanel.
    liftContentAbovePanel(el);
    [60, 200, 500].forEach(function (ms) {
      setTimeout(function () { if (state.el === el && el.getAttribute('visible')) liftContentAbovePanel(el); }, ms);
    });

    var to = destinationTransform();
    el.setAttribute('visible', true);

    // Fly FROM the origin card's exact world position/orientation/size, so it
    // visibly reads as "that card grew and came to you" (item 5) rather than
    // a detail panel just appearing elsewhere. Falls back to a simple
    // scale-in at the destination if there's no origin card to fly from.
    var from;
    if (originEl && !reducedMotion) {
      var originData = originEl.components['hub-panel'] && originEl.components['hub-panel'].data;
      var ow = (originData && originData.width) || 0.5, oh = (originData && originData.height) || 0.35;
      var originPos = new THREE.Vector3(), originQuat = new THREE.Quaternion();
      originEl.object3D.getWorldPosition(originPos);
      originEl.object3D.getWorldQuaternion(originQuat);
      // Against the panel's ACTUAL height where it's already known — the
      // experience panel is content-fitted, so H is only its upper bound.
      from = { pos: originPos, quat: originQuat, scale: new THREE.Vector3(ow / W, oh / (state.stageH || H), 1) };
    } else {
      from = { pos: to.pos.clone(), quat: to.quat.clone(), scale: new THREE.Vector3(0.85, 0.85, 0.85) };
    }

    if (reducedMotion) {
      el.object3D.position.copy(to.pos);
      el.object3D.quaternion.copy(to.quat);
      el.object3D.scale.copy(to.scale);
    } else {
      el.object3D.position.copy(from.pos);
      el.object3D.quaternion.copy(from.quat);
      el.object3D.scale.copy(from.scale);
      state.tween = tweenTransform(el.object3D, from, to, FLY_IN_MS / 1000, 'power2.inOut', function () {
        state.tween = null;
      });
    }
  }

  // `instant` skips the fly-back tween — used when leaving the hub entirely
  // (entering a project room), where flying the stage back to its origin card
  // would just streak across the room that's fading in.
  function close(instant) {
    var el = state.el;
    if (!el || !el.getAttribute('visible')) return;
    if (state.tween) state.tween.kill();

    setAllDimmed(false);
    setBackgroundLight(false);

    var origin = state.originEl;
    state.originEl = null;

    if (instant || reducedMotion || !origin) {
      el.setAttribute('visible', false);
      if (origin) origin.setAttribute('visible', true);
      return;
    }

    // Symmetric close: fly the stage back down to the origin card's size/
    // position, then swap back to showing the small card itself.
    var originPos = new THREE.Vector3(), originQuat = new THREE.Quaternion();
    origin.object3D.getWorldPosition(originPos);
    origin.object3D.getWorldQuaternion(originQuat);
    var originData = origin.components['hub-panel'] && origin.components['hub-panel'].data;
    var ow = (originData && originData.width) || 0.5, oh = (originData && originData.height) || 0.35;
    var from = { pos: el.object3D.position.clone(), quat: el.object3D.quaternion.clone(), scale: el.object3D.scale.clone() };
    var to = { pos: originPos, quat: originQuat, scale: new THREE.Vector3(ow / W, oh / (state.stageH || H), 1) };

    state.tween = tweenTransform(el.object3D, from, to, FLY_OUT_MS / 1000, 'power2.inOut', function () {
      el.setAttribute('visible', false);
      origin.setAttribute('visible', true);
      state.tween = null;
    });
  }

  function init(el) {
    state.el = el;
    el.setAttribute('visible', false);
  }

  window.VRFocusStage = { init: init, open: open, close: close };
})();
