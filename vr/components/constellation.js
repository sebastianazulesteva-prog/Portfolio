/* ═══ constellation.js ═══
   Places data-driven hub-panels around the viewer, each in its own region of
   the dome (§2 of VR_BUILD_SPEC.md).

   Each panel is wrapped as: <a-entity rotation="0 Y 0"><a-entity position="0 y -z">
   The OUTER entity only rotates (orbiting around the viewer's origin); the
   INNER entity only translates forward in that rotated local space, then tilts
   to face the head. That's what actually places something off to the side —
   rotating an entity that already carries its own position just spins it in
   place instead.

   Two entry points:
     • place(container, opts)  — the primitive: drop one panel at an exact
        (angle, radius, height). Returns { panelEl, angleDeg, radius, height }.
     • layout(container, items, opts) — spread a list evenly along one arc
        (kept for simple single-row uses like the photo cloud later).

   The hub grid is built from `place` (see index.html's layoutCluster) so that
   columns line up at fixed angles regardless of how many items land in each
   row — an even-spread arc pushes a 2-item row out to its extremes and leaves
   the middle empty, which read as scattered.
*/

(function () {
  // Drop a single panel at an exact spot and aim it at the seated head.
  function place(container, opts) {
    var radius = opts.radius || 2.3;
    var height = opts.height != null ? opts.height : 1.6;
    var eye = opts.eyeHeight != null ? opts.eyeHeight : 1.6;

    var outer = document.createElement('a-entity');
    outer.setAttribute('rotation', { x: 0, y: opts.angleDeg, z: 0 });

    var inner = document.createElement('a-entity');
    inner.setAttribute('position', { x: 0, y: height, z: -radius });
    // +X pitch tips the top of the panel back toward a head above/below it.
    inner.setAttribute('rotation', {
      x: THREE.MathUtils.radToDeg(Math.atan2(height - eye, radius)), y: 0, z: 0
    });

    var panel = document.createElement('a-entity');
    panel.setAttribute('hub-panel', opts.panelAttrs);
    // The "sunflower effect" — keep re-aiming at wherever the viewer actually
    // is, instead of trusting the one-time `eyeHeight` tilt on `inner` above,
    // which is only correct for a single assumed pose. Opt-in so the fixed-aim
    // behaviour stays available for comparison (see sunflower.js).
    if (opts.sunflower) {
      panel.setAttribute('sunflower', opts.sunflower === true ? {} : opts.sunflower);
    }
    inner.appendChild(panel);
    outer.appendChild(inner);
    container.appendChild(outer);

    // innerEl/outerEl are exposed because scrolling a column means moving the
    // INNER entity's y (column-scroll.js) — the panel itself can't be moved
    // vertically without leaving its rotated frame, and the outer entity only
    // carries the zone's yaw.
    return { panelEl: panel, innerEl: inner, outerEl: outer,
             angleDeg: opts.angleDeg, radius: radius, height: height };
  }

  // Even single-arc spread — a thin wrapper over place().
  function layout(container, items, opts) {
    var count = items.length;
    if (!count) return;
    var base = opts.baseAngleDeg || 0;
    var spread = opts.spreadDeg != null ? opts.spreadDeg : 50;
    var start = base - spread / 2;
    var step = count > 1 ? spread / (count - 1) : 0;

    items.forEach(function (item, i) {
      var placed = place(container, {
        angleDeg: start + step * i,
        radius: opts.radius, height: opts.height, eyeHeight: opts.eyeHeight,
        sunflower: opts.sunflower,
        panelAttrs: opts.panelBuilder(item, i)
      });
      if (opts.onPlaced) opts.onPlaced(item, i, placed);
    });
  }

  window.VRConstellation = { place: place, layout: layout };
})();
