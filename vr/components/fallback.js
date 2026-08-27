/* ═══ fallback.js ═══
   Feature detection + the 2D dome view (§3/§13 of VR_BUILD_SPEC.md). The 2D
   view is a first-class experience on its own — this file never shows an
   error or a broken button when WebXR is unavailable; it just stays in the
   ordinary orbit/gyro view. Also reads the site's a11y + reduced-motion
   settings so VR mirrors the flat pages' behavior. */

(function () {
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    var enterBtn = document.getElementById('enterVrBtn');
    var scene = document.querySelector('a-scene');
    var cursorEl = document.querySelector('[cursor]');

    // ── Pointer mode (VR_BUGFIX item 9) ──
    // Desktop/phone: the cursor raycasts from the mouse/touch point
    // (rayOrigin:mouse, set in index.html), so any visible panel is directly
    // clickable — and the fixed centre reticle would be misleading (it can't
    // track the mouse), so it's hidden. In an immersive session there's no
    // mouse: switch to gaze (rayOrigin:entity) and show the reticle as the
    // controller-less selection fallback.
    function applyPointerMode(inVR) {
      if (!cursorEl) return;
      cursorEl.setAttribute('cursor', 'rayOrigin', inVR ? 'entity' : 'mouse');
      var reticleObj = cursorEl.getObject3D('reticle');
      if (reticleObj) reticleObj.visible = inVR;
    }
    // The reticle's object3D is built in reticle.js's init — hide it once the
    // cursor entity has loaded (and as a backstop, shortly after).
    if (cursorEl) {
      if (cursorEl.hasLoaded) applyPointerMode(false);
      else cursorEl.addEventListener('loaded', function () { applyPointerMode(false); });
      setTimeout(function () { applyPointerMode(false); }, 500);
    }
    if (scene) {
      scene.addEventListener('enter-vr', function () { applyPointerMode(true); });
      scene.addEventListener('exit-vr', function () { applyPointerMode(false); });
    }

    // Only show a styled Enter VR button if the browser actually reports
    // immersive-vr support. Fully virtual only — we never check/request
    // immersive-ar (§3, §13: no AR/passthrough).
    if (navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
        if (supported && enterBtn) {
          enterBtn.hidden = false;
          enterBtn.addEventListener('click', function () {
            scene.enterVR();
          });
        }
      }).catch(function () {
        // no-op — stay in 2D silently
      });
    }

    // Gaze-fuse (dwell-to-select) is disabled everywhere, on every device
    // (Sebastian: nothing should open just from looking at it — selection must
    // be an explicit action). Phone/tablet select via tap-anywhere, desktop
    // via click, Quest/Vision Pro via trigger/pinch — all fire the same
    // generic `click`, none of them a dwell. Left intentionally not re-enabled
    // here; the cursor is authored fuse:false in index.html.

    if (localStorage.getItem('a11yMode') === '1') {
      document.body.classList.add('accessible');
    }

    // "← Back to site" is a plain link in the DOM overlay — always present.
  });

  // A `window.VR_REDUCED_MOTION` global was published here and read by nothing
  // — every component queries matchMedia itself at load. Removed rather than
  // wired up; for forcing the setting in testing, use index.html's
  // ?reducedMotion=1 override, which those per-component reads do see.
})();
