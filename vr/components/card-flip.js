/* ═══ card-flip.js ═══
   An Experience card turns over in place and shows its bullet list on the back.

   ── Why, and why not the focus stage ──
   Sebastian, after the first Vision Pro session: *"for my experience section,
   where you click on the card where I've worked — I think what it should do is
   it should just flip over, the same card, and then talk about what I did, the
   bullet points breakdown. Make sure the font is bigger and easier to read on
   that side too."*

   Until now an Experience card opened focus-stage.js: a separate, larger panel
   that appears in front of you while the card stays where it was. That is the
   right gesture for a PROJECT (you are moving toward the work) and the wrong
   one for a job, where the card IS the record and the bullets are its reverse.

   ── The one thing that couldn't be taken literally ──
   "The same size, the same card" is geometrically impossible. A glance card is
   0.50 × 0.34 m; at the body type Sebastian named as the readable size that is
   ~17 characters a line and about nine lines total, and the bullet lists run
   from two bullets of 60 characters to four bullets totalling 283. Fifteen to
   twenty-five lines do not go into nine.

   So the card flips AND grows, on his call: GROW = 2, ending at 1.00 m wide at
   1.02 m from the eye — the same reading distance the bio card's Skills panel
   and the focus stage both use, so all three "come here and read this" moves in
   the scene land in the same place. The back is BUILT at the front's size
   (BACK_W / GROW) and scales with the card, so the motion is one continuous
   turn-and-approach rather than a card that pops to a new size mid-flip.

   ── Built lazily, on first flip ──
   Ten Experience cards × (title + meta + up to 4 bullets + 4 markers) is ~90
   troika-text instances, against 127 in the whole scene today. Building those
   at load would undo a good part of the arrival-cost work in the same pass that
   did it. Nothing is built until a card is first turned over.

   The whole back is the target that turns it home again — no close pill. In a
   headset the complaint was that things were hard to hit; the answer to that is
   not another small control.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var GROW = 2.0;                 // front card size -> reading size
  var READ_DISTANCE = 1.02;       // matches bio-card's Skills panel and focus-stage
  var READ_HEIGHT = 1.55;
  var FLIP_IN_MS = 520, FLIP_OUT_MS = 380;

  // Above the focus stage (10/11) and the Skills panel (12/13/14), below
  // notice.js's 20/21/22 — a "project rooms are coming soon" notice still lands
  // on top of everything. renderOrder is not optional here: transparent objects
  // are not depth-sorted in this scene (VR_AI_BUILD_GUIDE.md §3.6), so being
  // nearer the eye does NOT put the back face in front of the constellation.
  var ORDER_PLATE = 15, ORDER_GLASS = 16, ORDER_CONTENT = 17;

  // FINAL, world-space sizes — every one is divided by GROW to build in the
  // card's own local units. Keep them here in the units they are judged in.
  var BACK_W = 1.00;
  var PAD = 0.055;
  var TITLE_SIZE = 0.044;         // company
  var META_SIZE = 0.024;          // role · date
  var BULLET_SIZE = 0.030;        // the bullets themselves: above VRType.body()
  var HINT_SIZE = 0.020;
  var BULLET_GAP = 0.020;
  var MARKER_INDENT = 0.032;      // hanging indent, so wrapped lines clear the ·

  var openCard = null;            // only ever one card turned over

  function mult() { return VRType.cardMult ? VRType.cardMult() : 1; }

  // ── Build the back face ───────────────────────────────────────────────────
  // rotation.y = 180 so its own front faces the card's LOCAL -Z. The reading
  // transform then yaws the card 180°, which points local -Z at the viewer.
  function build(cardEl) {
    var spec = cardEl.__flipSpec;
    var m = mult();
    var localW = (BACK_W / GROW) * m;
    var pad = (PAD / GROW) * m;
    var titleSize = (TITLE_SIZE / GROW) * m;
    var metaSize = (META_SIZE / GROW) * m;
    var bulletSize = (BULLET_SIZE / GROW) * m;
    var hintSize = (HINT_SIZE / GROW) * m;
    var bulletGap = (BULLET_GAP / GROW) * m;
    var indent = (MARKER_INDENT / GROW) * m;

    var back = document.createElement('a-entity');
    back.setAttribute('rotation', { x: 0, y: 180, z: 0 });
    back.object3D.visible = false;
    cardEl.appendChild(back);

    var leftX = -localW / 2 + pad;
    var textW = localW - pad * 2;

    var specs = [{
      value: spec.title, font: VRFonts.title(), fontSize: titleSize,
      color: '#ffffff', maxWidth: textW, x: leftX, lineHeight: 1.14, gapAfter: pad * 0.30
    }, {
      value: spec.subtitle, font: VRFonts.body(), fontSize: metaSize,
      color: spec.accent, fillOpacity: 0.95, maxWidth: textW, x: leftX,
      lineHeight: 1.25, gapAfter: pad * 0.95
    }];

    // Bullets are laid out WITHOUT their marker, indented, and the '·' is placed
    // separately once the stack has reflowed — that gives a real hanging indent,
    // so a bullet that wraps to three lines still reads as one item instead of
    // running back under the marker column.
    var bullets = spec.bullets || [];
    bullets.forEach(function (b, i) {
      specs.push({
        value: b, font: VRFonts.body(), fontSize: bulletSize,
        color: '#f5f5f0', maxWidth: textW - indent, x: leftX + indent,
        lineHeight: 1.34, gapAfter: i === bullets.length - 1 ? pad * 0.9 : bulletGap
      });
    });
    specs.push({
      value: 'Tap to turn it back over', font: VRFonts.body(), fontSize: hintSize,
      color: '#f5f5f0', fillOpacity: 0.5, maxWidth: textW, x: leftX,
      lineHeight: 1.2, gapAfter: 0
    });

    var startY = 0;   // corrected in onReflow, once the real height is known
    var markers = [];
    var els = VRTextFlow.stack(back, specs, {
      startY: startY, defaultGap: bulletGap, z: 0.014 / GROW,
      onReflow: function (endY) {
        // endY is the bottom of the stack, measured. The whole column is
        // shifted so the content is centred in a plate sized to fit it — the
        // plate cannot be sized before this point, and sizing it from an
        // estimate is the exact bug VRTextFlow exists to remove.
        var contentH = startY - endY;
        var panelH = contentH + pad * 2;
        var shift = panelH / 2 - pad;
        els.forEach(function (e) { e.object3D.position.y += shift; });

        // Markers, on the first line of each bullet. 0.72 of the font size down
        // from the block top puts the '·' on the first line's optical centre;
        // baseline:'top' means the entity's y is the top of the block, not the
        // baseline.
        markers.forEach(function (mk, i) {
          var host = els[2 + i];
          mk.object3D.position.set(leftX, host.object3D.position.y - bulletSize * 0.72, 0.014 / GROW);
        });

        buildPlate(back, localW, panelH, spec.accent);
        back.__panelH = panelH;
        back.__ready = true;
        // If the flip already reached its halfway swap while troika was still
        // measuring, the reveal was deferred rather than showing bare text over
        // the constellation with no plate behind it. Honour it now.
        if (back.__wantVisible) { back.object3D.visible = true; back.__wantVisible = false; }
        lift(back);
        // troika and the plate both settle asynchronously; re-assert the paint
        // order a few times rather than hope one pass caught everything (the
        // Skills panel needed the same treatment).
        [60, 200, 500].forEach(function (ms) { setTimeout(function () { lift(back); }, ms); });
      }
    });

    bullets.forEach(function (b, i) {
      var mk = document.createElement('a-entity');
      mk.setAttribute('troika-text', {
        value: '·', align: 'left', anchor: 'left', baseline: 'center',
        color: spec.accent, fillOpacity: 0.9, font: VRFonts.bodyBold(),
        fontSize: bulletSize * 1.4
      });
      mk.object3D.position.set(leftX, 0, 0.014 / GROW);
      back.appendChild(mk);
      markers.push(mk);
    });

    els.forEach(function (e, i) {
      VRGlass.lightTroikaText(e, i === 1 ? spec.accent : '#f5f5f0');
    });

    cardEl.__flipBack = back;
    return back;
  }

  // An OPAQUE plate under the glass, for the reason the Skills panel documents:
  // the card shader clamps at 0.96 and even that measurably bleeds, so a
  // reading surface floating in front of a constellation needs something solid
  // behind the type or the cards and the dome show through the words.
  function buildPlate(back, w, h, accent) {
    var plateGeo = VRScrollArrows.roundedRectGeometry(w, h, 0.05 / GROW);
    var plate = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({ color: '#0e0c09' }));
    plate.position.z = -0.004;
    back.setObject3D('flip-plate', plate);

    back.setObject3D('flip-glass', new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      VRGlass.makeCardMaterial(w, h, 0.05 / GROW, accent, 0, 0.96)
    ));
  }

  function lift(back) {
    var plate = back.getObject3D('flip-plate');
    var glass = back.getObject3D('flip-glass');
    back.object3D.traverse(function (o) {
      if (!o.isMesh) return;
      o.renderOrder = (o === plate) ? ORDER_PLATE
                    : (o === glass) ? ORDER_GLASS
                    : ORDER_CONTENT;
    });
  }

  // ── Where it flies to ─────────────────────────────────────────────────────
  // Same construction as bio-card's _skillsReadingTransform: a point
  // READ_DISTANCE ahead of the head at a fixed height, yaw-only so the card
  // never tips, expressed in the card's PARENT space (a constellation entity
  // that is itself rotated and translated) and with the parent's scale divided
  // out so GROW means GROW in world terms.
  function readingTransform(cardEl) {
    var headEl = document.querySelector('#head');
    if (!headEl) return null;

    var headPos = new THREE.Vector3(), headQuat = new THREE.Quaternion();
    headEl.object3D.getWorldPosition(headPos);
    headEl.object3D.getWorldQuaternion(headQuat);

    var fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);      // looking straight up or down
    fwd.normalize();

    var target = headPos.clone().addScaledVector(fwd, READ_DISTANCE);
    target.y = READ_HEIGHT;

    // Face the viewer, yaw only.
    var dummy = new THREE.Object3D();
    dummy.position.copy(target);
    var look = headPos.clone();
    look.y = target.y;
    dummy.lookAt(look);

    var parent = cardEl.object3D.parent;
    parent.updateWorldMatrix(true, false);
    var parentQuat = new THREE.Quaternion(), parentScale = new THREE.Vector3();
    parent.getWorldQuaternion(parentQuat);
    parent.getWorldScale(parentScale);

    var localPos = parent.worldToLocal(target.clone());
    var faceQuat = parentQuat.clone().invert().multiply(dummy.quaternion);

    var s = GROW / (parentScale.x || 1);
    return { pos: localPos, faceQuat: faceQuat, scale: new THREE.Vector3(s, s, s) };
  }

  function pose(cardEl) {
    var o = cardEl.object3D;
    return { pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone() };
  }

  // The front's meshes and child entities, with their CURRENT visibility
  // recorded. Restoring a snapshot rather than setting everything true matters:
  // hub-panel hides things of its own (a hover caption, the hint badge), and a
  // blanket restore would light them all up on the way home.
  function snapshotFront(cardEl, backObj) {
    var out = [];
    cardEl.object3D.children.forEach(function (c) {
      if (c === backObj) return;
      out.push({ obj: c, was: c.visible });
    });
    return out;
  }

  function setFront(snapshot, visible) {
    snapshot.forEach(function (rec) { rec.obj.visible = visible ? rec.was : false; });
  }

  // ── The turn ──────────────────────────────────────────────────────────────
  // The rotation is NOT a plain slerp between two quaternions. From the card's
  // home aim to "facing you, turned over" is close to 180°, where the shortest
  // arc is ambiguous and can come out as a tumble about an arbitrary axis. So
  // the two halves are driven separately and composed: slerp toward facing you,
  // times a yaw of PI·t about the card's own Y. That is always a clean flip.
  function flipTween(cardEl, from, to, extraYaw, ms, onUpdate, onDone) {
    var obj = cardEl.object3D;
    var yaw = new THREE.Quaternion();
    var axis = new THREE.Vector3(0, 1, 0);

    function apply(t) {
      obj.position.lerpVectors(from.pos, to.pos, t);
      obj.scale.lerpVectors(from.scale, to.scale, t);
      obj.quaternion.slerpQuaternions(from.quat, to.quat, t);
      yaw.setFromAxisAngle(axis, extraYaw * t);
      obj.quaternion.multiply(yaw);
      if (onUpdate) onUpdate(t);
    }

    if (cardEl.__flipTween) cardEl.__flipTween.kill();
    if (reducedMotion || typeof gsap === 'undefined') {
      apply(1);
      if (onDone) onDone();
      return;
    }
    var proxy = { t: 0 };
    cardEl.__flipTween = gsap.to(proxy, {
      t: 1, duration: ms / 1000, ease: 'power2.inOut',
      onUpdate: function () { apply(proxy.t); },
      onComplete: function () { cardEl.__flipTween = null; if (onDone) onDone(); }
    });
  }

  function sunflower(cardEl, on) {
    if (cardEl.getAttribute('sunflower') != null) cardEl.setAttribute('sunflower', 'enabled', on);
  }

  // ── The drift has to be stopped, or the card never moves ──────────────────
  // hub-panel.js gives every card an `animation__drift` — a looping alternate
  // tween on POSITION, its idle float. A-Frame's animation component rewrites
  // position on every tick from anime.js's own state, so it overwrites whatever
  // the flip tween just wrote: the first build of this file scaled the card to
  // 2× and turned it to face the viewer, and it sat exactly where it started,
  // because scale and quaternion were free and position was not.
  //
  // Matched by PROPERTY, not by the `animation__drift` name, so a second
  // transform animation added to these cards later is caught too. Also worth
  // knowing that this is why focus-stage.js never hit it: that builds a new
  // panel and leaves the card alone.
  var DRIFT_PROPS = { position: 1, rotation: 1, scale: 1 };

  function transformAnimations(cardEl) {
    var out = [];
    Object.keys(cardEl.components || {}).forEach(function (name) {
      if (name.indexOf('animation') !== 0) return;
      var comp = cardEl.components[name];
      var prop = comp.data && comp.data.property;
      if (prop && DRIFT_PROPS[prop.split('.')[0]]) out.push({ name: name, comp: comp });
    });
    return out;
  }

  // pauseAnimation / resumeAnimation, NOT pause/play: those two are the A-Frame
  // COMPONENT lifecycle hooks and also tear down the component's event
  // listeners. And it is resumeAnimation, not playAnimation — A-Frame 1.5.0 has
  // no playAnimation, so guessing that name silently no-ops and the card's idle
  // drift never comes back. (pauseAnimation is a one-liner that clears
  // `animationIsPlaying`, which the component's own tick gates on.)
  // Pauses every transform animation that was running — they would all fight the
  // flip tween — but RESUMES only the looping ones.
  //
  // That asymmetry is the point. hub-panel's hover animation is also on scale,
  // and in a headset it is always mid-flight when the flip starts: xr-select.js
  // delivers a pinch as mouseenter → click → mouseleave, so wake(true) has just
  // set `animation__hover` toward 1.07 when the click arrives. Resuming that on
  // the way home would leave the card sitting 7% large at rest, with no pointer
  // anywhere near it. A one-shot tween that got interrupted has no business
  // being restarted; a looping idle drift does.
  function setDrift(cardEl, on) {
    if (!on) {
      cardEl.__flipPaused = transformAnimations(cardEl).filter(function (rec) {
        return rec.comp.animationIsPlaying !== false;
      });
      cardEl.__flipPaused.forEach(function (rec) {
        if (rec.comp.pauseAnimation) rec.comp.pauseAnimation();
        else { cardEl.setAttribute(rec.name, 'enabled', true); cardEl.setAttribute(rec.name, 'enabled', false); }
      });
      return;
    }
    (cardEl.__flipPaused || []).forEach(function (rec) {
      if (!rec.comp.data || !rec.comp.data.loop) return;
      if (rec.comp.resumeAnimation) rec.comp.resumeAnimation();
      else { cardEl.setAttribute(rec.name, 'enabled', false); cardEl.setAttribute(rec.name, 'enabled', true); }
    });
    cardEl.__flipPaused = null;
  }

  function turnOut(cardEl) {
    var to = readingTransform(cardEl);
    if (!to) return;

    var back = cardEl.__flipBack || build(cardEl);
    // Home is captured HERE, not at attach time: sunflower.js is still turning
    // the card to face the viewer right up to the moment it is clicked, so the
    // transform recorded at build time is not the one it is sitting at.
    cardEl.__flipHome = pose(cardEl);
    cardEl.__flipFront = snapshotFront(cardEl, back.object3D);
    cardEl.__flipped = true;
    openCard = cardEl;
    sunflower(cardEl, false);
    setDrift(cardEl, false);

    var swapped = false;
    flipTween(cardEl, cardEl.__flipHome,
      { pos: to.pos, quat: to.faceQuat, scale: to.scale },
      Math.PI, FLIP_IN_MS,
      function (t) {
        // Swap faces at the halfway point, edge-on, where neither side is
        // readable — the card material is DoubleSide, so without this you watch
        // the front's photo and title run backwards through the turn.
        if (!swapped && t >= 0.5) {
          swapped = true;
          setFront(cardEl.__flipFront, false);
          // Only if the plate exists. On a card's FIRST flip the back is being
          // built in the same beat, and its plate cannot be sized until troika
          // reports real block heights — revealing before that shows the
          // bullets floating over the constellation with nothing behind them.
          if (back.__ready) { back.object3D.visible = true; lift(back); }
          else { back.__wantVisible = true; }
        }
      },
      function () { lift(back); });
  }

  function turnHome(cardEl) {
    var back = cardEl.__flipBack;
    var home = cardEl.__flipHome;
    if (!back || !home) return;
    cardEl.__flipped = false;
    back.__wantVisible = false;
    if (openCard === cardEl) openCard = null;

    var swapped = false;
    flipTween(cardEl, pose(cardEl), home, -Math.PI, FLIP_OUT_MS,
      function (t) {
        if (!swapped && t >= 0.5) {
          swapped = true;
          back.object3D.visible = false;
          setFront(cardEl.__flipFront, true);
        }
      },
      function () {
        back.object3D.visible = false;
        setFront(cardEl.__flipFront, true);
        // Re-aimed from wherever it landed; sunflower takes it from here, and
        // the idle drift picks up again from its own stored from/to.
        sunflower(cardEl, true);
        setDrift(cardEl, true);
        // And put hover explicitly back to rest. wake() was a no-op for the
        // whole flip (hub-panel guards on __flipped/__flipTween), so whatever
        // hover state the opening pinch left is stale by now — this supersedes
        // it with a fresh animation to 1, from the scale the card actually has.
        var hub = cardEl.components && cardEl.components['hub-panel'];
        if (hub && hub.wake) hub.wake(false);
      });
  }

  window.VRCardFlip = {
    // spec: { title, subtitle, bullets: [string], accent }
    attach: function (cardEl, spec) {
      cardEl.__flipSpec = spec;
    },

    toggle: function (cardEl) {
      if (!cardEl || !cardEl.__flipSpec) return false;
      if (cardEl.__flipped) { turnHome(cardEl); return true; }
      // One at a time: two cards turned over at the same reading spot would
      // occupy the same metre of air.
      if (openCard && openCard !== cardEl) turnHome(openCard);
      turnOut(cardEl);
      return true;
    },

    close: function () { if (openCard) turnHome(openCard); },
    isOpen: function () { return !!openCard; }
  };
})();
