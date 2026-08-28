/* ═══ notice.js ═══
   One transient in-scene message. Built for exactly one job right now: telling
   a visitor who reached for a project room that the rooms aren't ready.

   Per Sebastian: "the project rooms are just ugly right now, so I don't want
   there to be a way into them just yet" — and then "let's have a little
   'project rooms will be coming soon' pop up when people hit that." So the
   doors stay where they are and stay obviously clickable; what changes is
   where they lead. A control that silently does nothing reads as broken, and a
   control that quietly disappears reads as a missing feature you can't ask
   about. Saying "coming soon" is the honest third option.

   ── Why this is in-scene geometry and not a DOM panel ──
   /vr is composed for a headset, and in an immersive session the 2D overlay
   (vr.css) is not rendered at all — a DOM toast would be invisible exactly
   where it matters most. This is a small glass card, in the same material and
   type scale as everything else, placed like the focus stage does it: yaw-only,
   at a fixed eye height, nearer than any constellation card.

   ── The bits that are easy to get wrong ──
   • RENDER ORDER. The scene runs with sortTransparentObjects:false and nearly
     every surface is transparent with depthWrite off, so being NEARER does not
     put you in front — DOM/scene-graph order does (VR_AI_BUILD_GUIDE.md §3.6).
     A notice that appears behind the card you just clicked is worse than none,
     so the panel writes depth and the whole subtree gets a renderOrder above
     the focus stage's own 10/11.
   • RAYCASTER REFRESH. It is created after load, so no raycaster has it in its
     cached target list yet; without an explicit refresh the first tap on it
     falls through (ISSUE-01, the same lesson as project-room and pdf-reader).
   • REDUCED MOTION. No fade, and a longer hold — "arrives in final state
     instantly" (hard rule 4), not "flashes past unread".

   Usage:  VRNotice.show('Project rooms are coming soon',
                         'This part of the dome is still being built.');
           VRNotice.hide();
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var DISTANCE = 0.95;      // nearer than the focus stage's 1.05, so it reads as "on top"
  var EYE_HEIGHT = 1.55;    // matches focus-stage.js, so the two never fight for the same slot
  var W = 0.78, H = 0.26, PAD = 0.07, RADIUS = 0.05;
  var ACCENT = '#b8863b';   // the dome's ember — this is scene furniture, not a project
  var OPACITY = 0.96;       // CARD_FRAG clamps at 0.96; this is "as opaque as the glass goes"
  var RENDER_ORDER = 20;    // above the focus stage (10/11) and the photo cloud's 10/5
  var HOLD_MS = 3200;
  var HOLD_MS_REDUCED = 4600;
  var FADE_MS = 220;

  // `fading` is the one that is on its way out. It has to be tracked separately
  // from `el`, because hide() clears `el` the moment it STARTS the fade — so a
  // second show() a beat later would find nothing to clean up and leave the
  // outgoing card sitting on top of the new one (and if its fade never
  // completes, orphaned in the scene graph for good). Caught in testing, where
  // a frozen GSAP ticker left exactly that: two notices, one at alpha 0.93.
  var state = { el: null, fading: null, timer: null, tween: null, fadeTween: null, disposables: [] };

  // Yank whatever is mid-fade, now. Called before building a new notice.
  function dropFading() {
    if (state.fadeTween) { state.fadeTween.kill(); state.fadeTween = null; }
    var el = state.fading;
    state.fading = null;
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function dispose() {
    state.disposables.forEach(function (d) { try { d.dispose(); } catch (e) {} });
    state.disposables = [];
  }

  // Yaw-only placement in front of wherever the viewer is looking — the same
  // approach as focus-stage.js's destinationTransform(), and for the same
  // reasons: head pitch must not plant this on the floor or the ceiling, and a
  // head tilt must not cant it.
  function placeInFront(el) {
    var headEl = document.querySelector('#head');
    if (!headEl) return;
    var worldPos = new THREE.Vector3();
    var worldQuat = new THREE.Quaternion();
    headEl.object3D.getWorldPosition(worldPos);
    headEl.object3D.getWorldQuaternion(worldQuat);
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);   // looking straight up/down
    forward.normalize();

    var pos = worldPos.clone().addScaledVector(forward, DISTANCE);
    pos.y = EYE_HEIGHT;

    var dummy = new THREE.Object3D();
    dummy.position.copy(pos);
    var look = worldPos.clone();
    look.y = pos.y;              // pure yaw
    dummy.lookAt(look);

    el.object3D.position.copy(pos);
    el.object3D.quaternion.copy(dummy.quaternion);
  }

  // Three explicit layers, back to front: the solid backing plate, the glass
  // card, then everything else (the text). Re-run on a timer because troika
  // builds its mesh asynchronously (same as focus-stage.js) and a single pass
  // at build time misses it.
  function liftSubtree(el) {
    var panel = el.getObject3D('notice-panel');
    var back = el.getObject3D('notice-back');
    el.object3D.traverse(function (o) {
      if (!o.isMesh) return;
      o.renderOrder = (o === back) ? RENDER_ORDER
                    : (o === panel) ? RENDER_ORDER + 1
                    : RENDER_ORDER + 2;
    });
  }

  function refreshClickableRaycasters() {
    ['#head [cursor]', '#leftHand', '#rightHand'].forEach(function (sel) {
      var e = document.querySelector(sel);
      var rc = e && e.components && e.components.raycaster;
      if (rc) rc.refreshObjects();
    });
  }

  function text(parent, value, y, size, font, color, opacity) {
    var t = document.createElement('a-entity');
    t.setAttribute('troika-text', {
      value: value, align: 'center', anchor: 'center', baseline: 'center',
      color: color, font: font, fontSize: size, fillOpacity: opacity,
      maxWidth: W - PAD * 2, lineHeight: 1.25
    });
    t.setAttribute('position', { x: 0, y: y, z: 0.012 });
    parent.appendChild(t);
    VRGlass.lightTroikaText(t, color, { emissive: true });
    return t;
  }

  function show(headline, sub) {
    hide(true);
    dropFading();

    var el = document.createElement('a-entity');

    // ── An OPAQUE backing plate, under the glass ──
    // The glass card alone is not enough. Measured: with the card at its
    // maximum uOpacity (0.96) the bio card's paragraphs and the portrait's face
    // were still plainly legible straight through the notice — the shader's
    // fill is translucent by design, and 0.96 is the clamp on that, not a
    // guarantee of coverage. depthWrite doesn't rescue it either: with
    // sortTransparentObjects:false everything else in the scene has
    // renderOrder 0 and has already painted by the time a renderOrder-20
    // overlay draws, so writing depth is too late to occlude anything (§3.6).
    // A message you read the room through is not a message. So: a solid unlit
    // plate in the dome's own near-black, exactly the card's size and corner
    // radius, sitting just behind it — the glass keeps its edge treatment and
    // ember rim, and nothing bleeds through the middle.
    var backGeo = VRScrollArrows.roundedRectGeometry(W, H, RADIUS);
    var backMat = new THREE.MeshBasicMaterial({ color: '#0e0c09' });
    var back = new THREE.Mesh(backGeo, backMat);
    back.position.z = -0.004;
    el.setObject3D('notice-back', back);
    state.disposables.push(backGeo, backMat);

    var mat = VRGlass.makeCardMaterial(W, H, RADIUS, ACCENT, 0, OPACITY);
    // depthWrite ON, unlike the glance tiles: this must OCCLUDE whatever it
    // covers rather than blending with it (focus-stage.js records the same
    // fix — a reading surface you can see the constellation through isn't a
    // reading surface).
    mat.depthWrite = true;
    var geo = new THREE.PlaneGeometry(W, H);
    var mesh = new THREE.Mesh(geo, mat);
    el.setObject3D('notice-panel', mesh);
    state.disposables.push(geo, mat);

    text(el, headline, H / 2 - PAD - 0.018, VRType.body(), VRFonts.bodyBold(), '#ffffff', 1);
    if (sub) text(el, sub, -H / 2 + PAD + 0.004, VRType.label(), VRFonts.body(), '#e8e2d6', 0.85);

    // Tap it to dismiss early. It is the only clickable thing in front of you
    // while it is up, so a stray tap aimed at the button behind it lands here
    // and clears it rather than doing nothing.
    el.classList.add('clickable');
    el.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      hide();
    });

    document.querySelector('a-scene').appendChild(el);
    state.el = el;
    // Entity created in this same synchronous block, so position/rotation are
    // written straight to object3D only AFTER a frame would let the components
    // initialise (trap §3.4). placeInFront writes object3D directly, so do it
    // on the next tick — and once more immediately, so it is never visible at
    // the origin for a frame.
    placeInFront(el);
    setTimeout(function () { if (state.el === el) placeInFront(el); }, 0);

    liftSubtree(el);
    [60, 200, 500].forEach(function (ms) {
      setTimeout(function () { if (state.el === el) liftSubtree(el); }, ms);
    });
    setTimeout(refreshClickableRaycasters, 0);

    var hold = reducedMotion ? HOLD_MS_REDUCED : HOLD_MS;
    if (!reducedMotion && typeof gsap !== 'undefined') {
      el.object3D.scale.set(0.94, 0.94, 0.94);
      mat.uniforms.uOpacity.value = 0;
      // The plate fades with the glass, or the notice pops in as a black slab
      // that the card then catches up to.
      backMat.transparent = true;
      backMat.opacity = 0;
      state.tween = gsap.to(mat.uniforms.uOpacity, {
        value: OPACITY, duration: FADE_MS / 1000, ease: 'power2.inOut'
      });
      gsap.to(backMat, { opacity: 1, duration: FADE_MS / 1000, ease: 'power2.inOut' });
      gsap.to(el.object3D.scale, { x: 1, y: 1, z: 1, duration: FADE_MS / 1000, ease: 'power2.inOut' });
    }
    state.timer = setTimeout(function () { hide(); }, hold);
    return el;
  }

  function hide(immediate) {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    if (state.tween) { state.tween.kill(); state.tween = null; }
    var el = state.el;
    if (!el) return;
    state.el = null;

    function remove() {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (state.fading === el) state.fading = null;
      dispose();
      refreshClickableRaycasters();
    }
    var mesh = el.getObject3D('notice-panel');
    var back = el.getObject3D('notice-back');
    if (immediate || reducedMotion || typeof gsap === 'undefined' || !mesh) return remove();
    if (back) {
      back.material.transparent = true;
      gsap.to(back.material, { opacity: 0, duration: FADE_MS / 1000, ease: 'power2.inOut' });
    }
    state.fading = el;
    state.fadeTween = gsap.to(mesh.material.uniforms.uOpacity, {
      value: 0, duration: FADE_MS / 1000, ease: 'power2.inOut', onComplete: remove
    });
  }

  // The one message this exists for today, so the copy lives in ONE place
  // instead of being retyped at each of the three doors (hub-panel,
  // focus-stage, photo-cloud).
  function comingSoonRooms() {
    return show('Project rooms are coming soon',
                'This part of the dome is still being built.');
  }

  window.VRNotice = { show: show, hide: hide, comingSoonRooms: comingSoonRooms };
})();
