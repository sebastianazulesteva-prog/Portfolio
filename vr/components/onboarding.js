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

   ── IN A HEADSET, NONE OF THAT APPLIES ──
   Sebastian, after the first Vision Pro session: *"when you clicked view in VR
   it still brought you over to the page that said it's an ask for permissions
   and all of this stuff. I think we should have it just jump straight into VR
   if you're on a VR headset."* He is right, and the gate was doubly wrong
   there: the disclaimer argues that a flat view is a compromise (to someone who
   is not in one), and the motion-permission paragraph describes an iOS dialog
   that will never appear. Then, having read all that, you had to find the small
   `Enter VR` pill at the bottom of the screen. Three steps to reach the thing
   the headset came for.

   So on a device that reports `immersive-vr`, the gate is replaced by ONE
   full-bleed tap target that enters immersive mode directly. Not the disclaimer
   with a different button — the disclaimer is addressed at flat viewers and is
   not shown at all.

   ── Why it can't be ZERO taps ──
   `requestSession('immersive-vr')` requires transient user activation, and an
   activation does not survive the navigation from the flat site's nav link — a
   click on /index.html cannot start a session on /vr. So one tap on arrival is
   the floor. What CAN be removed is everything else, which is what this does:
   the whole viewport is the target, and the tap goes straight to enterVR().

   `navigator.xr`'s `sessiongranted` event is also honoured. Browsers that can
   launch a page directly into immersive mode (Oculus Browser) fire it, and if
   Safari ever does, this becomes zero taps with no further work.

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

  // ── The headset path ──────────────────────────────────────────────────────
  // One tap, and it must be THE tap that starts the session: enterVR() has to
  // run inside the gesture with nothing awaited before it, for the same reason
  // the iOS motion prompt does (see the header).
  function headsetGate(gate, scene) {
    var card = gate.querySelector('.onboard-card');
    if (!card) return;
    gate.classList.add('onboard-headset');
    card.innerHTML =
      '<p class="onboard-eyebrow">Headset detected<span class="onboard-beta">Beta</span></p>' +
      '<h2 class="onboard-title" id="onboardTitle">Ready when you are.</h2>' +
      '<button class="onboard-enter" id="onboardEnter">Enter VR</button>' +
      '<p class="onboard-status" id="onboardStatus" aria-live="polite"></p>' +
      '<button class="onboard-secondary" id="onboardFlat">Browse in this window instead</button>';

    var status = document.getElementById('onboardStatus');
    var entered = false;

    function enter(e) {
      if (entered) return;
      if (e) { e.preventDefault(); e.stopPropagation(); }
      entered = true;
      var p;
      // Directly inside the gesture. A rejected session is not fatal — the flat
      // view behind this gate is a working fallback, so say so and step aside
      // rather than trapping the visitor behind a modal that failed.
      try { p = scene.enterVR(); } catch (err) { fail(err); return; }
      if (p && p.catch) p.catch(fail);
    }

    function fail(err) {
      entered = false;
      console.warn('[vr] enterVR failed', err);
      if (status) {
        status.textContent = 'Couldn’t start the headset session — the flat view still works.';
        status.classList.add('shown');
      }
    }

    // The whole scrim is the target, not just the pill: in a headset the pill is
    // a small thing to have to aim at, and there is nothing else on this screen
    // to hit by accident.
    gate.addEventListener('click', enter);
    var flat = document.getElementById('onboardFlat');
    if (flat) {
      flat.addEventListener('click', function (e) {
        e.stopPropagation();   // must not read as "enter VR"
        dismissGate(gate);
      });
    }
    scene.addEventListener('enter-vr', function () { dismissGate(gate); });
  }

  function dismissGate(gate) {
    sessionStorage.setItem(KEY, '1');
    gate.classList.add('dismissed');
    // Removed, not just hidden: a full-screen scrim left in the DOM keeps
    // swallowing clicks meant for the scene even at opacity 0.
    setTimeout(function () { if (gate.parentNode) gate.parentNode.removeChild(gate); }, 420);
  }

  ready(function () {
    var gate = document.getElementById('onboardGate');
    if (!gate) return;

    // Already acknowledged this session — take the whole thing out of the DOM so
    // it can't intercept a pointer event.
    if (sessionStorage.getItem(KEY) === '1') { gate.parentNode.removeChild(gate); return; }

    var scene = document.querySelector('a-scene');

    // Held back until we know which gate this is. isSessionSupported resolves
    // in a frame or two, and showing the flat-view disclaimer to a headset for
    // those frames — then swapping it — is worse than a beat of nothing.
    gate.classList.add('onboard-deciding');
    function decided() { gate.classList.remove('onboard-deciding'); }

    // Some browsers can launch straight into immersive mode; if this fires there
    // is nothing to ask and nothing to tap.
    if (navigator.xr && navigator.xr.addEventListener) {
      navigator.xr.addEventListener('sessiongranted', function () {
        console.info('[vr] sessiongranted — entering immersive directly');
        if (scene) { try { scene.enterVR(); } catch (e) { /* fall through to the gate */ } }
        dismissGate(gate);
      });
    }

    // ?forcexr=1 / ?forcexr=0 pins which gate appears, so both can be checked on
    // a desktop that answers isSessionSupported() one way and never the other.
    // Same family as ?reducedMotion=1 and ?xrdebug=1 — a dev flag, not a
    // feature; entering VR from the forced gate still needs real WebXR.
    var forced = /[?&]forcexr=([01])/.exec(location.search);
    if (forced) {
      decided();
      if (forced[1] === '1') headsetGate(gate, scene); else flatGate(gate);
      return;
    }

    if (scene && navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-vr').then(function (ok) {
        decided();
        if (ok) { headsetGate(gate, scene); return; }
        flatGate(gate);
      }).catch(function () { decided(); flatGate(gate); });
    } else {
      decided();
      flatGate(gate);
    }
  });

  // ── The flat-view path — unchanged behaviour, just moved into a function ───
  function flatGate(gate) {
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

    function dismiss() { dismissGate(gate); }

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
    // Headset-side there is no keyboard, so the "Browse in this window instead"
    // button is that escape hatch there.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && gate.parentNode) dismiss();
    });
  }
})();
