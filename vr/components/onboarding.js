/* ═══ onboarding.js ═══
   The arrival gate: the "built for VR" disclaimer, and the explanation that has
   to come BEFORE iOS's motion-sensor prompt. (VR_AI_BUILD_GUIDE.md §9.7.)

   ── Why a gate and not another hint pill ──
   Two separate asks from Sebastian land in the same place:

   1. "A huge disclaimer that this is built to be viewed in VR, and porting to a
      non-VR view can really mess with the experience." The scene is composed
      for a headset. The flat port is a fallback, and on a portrait phone it is
      a heavily cropped one (~42° of horizontal field against a hub composed
      across ±1.6 m — see §9.4, where the phone recomposition was deliberately
      retired in favour of saying so out loud). A visitor who is not told this
      reads the crop as broken work.
   2. "For the requesting of access to motion data, let's be sure to fully
      explain why, and that it will ask so they should say yes." Tilt-to-look on
      iOS depends on DeviceOrientationEvent.requestPermission(), and a
      permissions dialog that arrives with no context gets declined. A-Frame's
      own device-orientation-permission-ui shows a generic modal instead, which
      is why it is turned off in the markup and this file takes over.

   Both are things to say once, up front, in a form the visitor must acknowledge
   — so: one panel, one button.

   ── Why the request must happen in the button handler ──
   iOS only honours requestPermission() from inside a real user gesture, and
   only in a secure context (hence .tools/vr-phone.sh serving HTTPS — see §5).
   Calling it on load, or after an await, silently rejects. So the call sits
   directly in the click handler, before anything async.

   Shown once per session (sessionStorage), matching how the ambient-audio
   choice is remembered — a mid-session reload shouldn't re-gate the scene.
*/

(function () {
  var KEY = 'vrOnboardingSeen';

  var IOS_MOTION = typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var gate = document.getElementById('onboardGate');
    if (!gate) return;

    // Already acknowledged this session — take the whole thing out of the DOM so
    // it can't intercept a pointer event.
    if (sessionStorage.getItem(KEY) === '1') { gate.parentNode.removeChild(gate); return; }

    var motionBlock = document.getElementById('onboardMotion');
    // The motion paragraph is authored in the markup but only true on iOS.
    // Everywhere else there is no prompt to warn about, and promising one that
    // never arrives is its own kind of broken (the same reasoning as hud.js not
    // promising VR on devices that can't enter it).
    if (motionBlock && !IOS_MOTION) motionBlock.parentNode.removeChild(motionBlock);

    var btn = document.getElementById('onboardEnter');
    var status = document.getElementById('onboardStatus');

    // The label has to describe what the tap ACTUALLY does next, per Sebastian:
    // on iOS the next thing on screen is the system motion prompt, not the
    // dome, so "Enter the dome" is a small lie about the immediate outcome.
    // Everywhere else nothing is requested and the tap really does just enter —
    // so this is set here rather than authored in the markup, which carries the
    // non-iOS wording as its default.
    if (btn && IOS_MOTION) btn.textContent = 'Grant permission to enter the dome';

    function dismiss() {
      sessionStorage.setItem(KEY, '1');
      gate.classList.add('dismissed');
      // Removed, not just hidden: a full-screen scrim left in the DOM keeps
      // swallowing clicks meant for the scene even at opacity 0.
      setTimeout(function () { if (gate.parentNode) gate.parentNode.removeChild(gate); }, 420);
    }

    if (btn) {
      btn.addEventListener('click', function () {
        if (!IOS_MOTION) { dismiss(); return; }

        // Directly inside the gesture — see the header. No await, no setTimeout,
        // nothing between the tap and this call.
        var p;
        try { p = DeviceOrientationEvent.requestPermission(); } catch (err) { dismiss(); return; }

        if (!p || !p.then) { dismiss(); return; }
        p.then(function (state) {
          // Declined is not an error and must not block entry: drag-to-look
          // still works, you just don't get tilt.
          if (state !== 'granted' && status) {
            status.textContent = 'No problem — you can still look around by dragging.';
            status.classList.add('shown');
            setTimeout(dismiss, 1400);
            return;
          }
          dismiss();
        }).catch(function () { dismiss(); });
      });
    }

    // Escape dismisses too, for desktop keyboard users. Not the only way in —
    // the button is the affordance — but a modal you can't escape is hostile.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && gate.parentNode) dismiss();
    });
  });
})();
