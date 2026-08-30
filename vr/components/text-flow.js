/* ═══ text-flow.js ═══
   Stacks a column of troika-text blocks top-down using each block's REAL
   measured height, so a block that wraps to N lines pushes the next block
   down instead of colliding with it. This is the shared fix for the
   recurring "text overlaps text" bug (VR bugfix walkthrough — "text overlap
   is an issue, e.g. in my career section"): the constellation cards, the
   focus stage, and the project rooms all previously placed each line at a
   FIXED vertical offset that silently assumed the line above was exactly one
   line tall — which breaks for long titles like "Virtual Human Interaction
   Lab (VHIL)" or "Social Engineering via Predictive Algorithms".

   troika measures asynchronously (font load + layout), so blocks are created
   immediately at a provisional stacked guess, then repositioned once every
   block reports its real blockBounds — a single reflow, no per-frame jitter.

   VRTextFlow.stack(container, specs, opts)
     specs: [{ value, font, fontSize, color, fillOpacity, maxWidth, align('left'|'center'),
               x, lineHeight, letterSpacing, gapAfter }]
     opts:  { startY, defaultGap, z }
   Returns the created entities immediately (positions settle shortly after).
*/

(function () {
  function blockHeight(el) {
    var m = el.components['troika-text'] && el.components['troika-text'].troikaTextMesh;
    if (!m || !m.textRenderInfo || !m.textRenderInfo.blockBounds) return null;
    var bb = m.textRenderInfo.blockBounds;
    return bb[3] - bb[1];
  }

  function stack(container, specs, opts) {
    opts = opts || {};
    var startY = opts.startY != null ? opts.startY : 0;
    var defaultGap = opts.defaultGap != null ? opts.defaultGap : 0.03;
    var z = opts.z != null ? opts.z : 0.016;

    var els = specs.map(function (s, i) {
      var e = document.createElement('a-entity');
      var align = s.align || 'left';
      e.setAttribute('troika-text', {
        value: s.value,
        align: align, anchor: align, baseline: 'top',
        color: s.color || '#f5f5f0',
        fillOpacity: s.fillOpacity != null ? s.fillOpacity : 1,
        font: s.font, fontSize: s.fontSize, maxWidth: s.maxWidth,
        lineHeight: s.lineHeight || 1.3, letterSpacing: s.letterSpacing || 0,
        // Optional dark halo, for text that floats over a background this file
        // can't know (a project room's sky above the horizon and its themed
        // floor below it can be near-black and near-white in the SAME theme, so
        // no single fill colour clears 4.5:1 against both — see project-room).
        outlineWidth: s.outlineWidth || 0,
        outlineColor: s.outlineColor || '#000000',
        outlineOpacity: s.outlineOpacity != null ? s.outlineOpacity : 1,
        outlineBlur: s.outlineBlur || 0
      });
      // Provisional stacked guess (one line each) so it's roughly right even
      // before the reflow lands — the real reflow corrects it below.
      e.object3D.position.set(s.x || 0, startY - i * (s.fontSize * 1.4 + defaultGap), z);
      container.appendChild(e);
      return e;
    });

    // Polled through VRPoll (xr-frame.js), not a bare setTimeout: a timeout is
    // clamped to ~1 s in any context the browser considers backgrounded, which
    // would turn this 40 ms poll into a 40× slower one inside an immersive
    // session (?xrdiag=1 measures whether visionOS does that). VRPoll is armed
    // by BOTH the scene tick and a timeout, first one to fire — so it survives
    // a session AND a preview pane whose render loop has stalled (§3.1).
    // Falls back to the old bare timeout if xr-frame.js isn't loaded.
    function reflow() {
      if (!els.every(function (e) { return blockHeight(e) != null; })) return false;
      var y = startY;
      els.forEach(function (e, i) {
        e.object3D.position.y = y;
        y -= blockHeight(e) + (specs[i].gapAfter != null ? specs[i].gapAfter : defaultGap);
      });
      if (opts.onReflow) opts.onReflow(y); // final y (bottom of the stack), for callers that place something under it
      return true;
    }
    if (window.VRPoll) {
      VRPoll.every(40, reflow, { attempts: 80 });
    } else {
      var attempts = 0;
      (function loop() {
        if (reflow()) return;
        if (++attempts > 80) return;      // give up quietly rather than spin forever
        setTimeout(loop, 40);
      })();
    }

    return els;
  }

  window.VRTextFlow = { stack: stack };
})();
