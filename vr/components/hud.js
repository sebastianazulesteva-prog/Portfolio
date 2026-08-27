/* ═══ hud.js ═══
   The 2D HUD + comfort controls + ambient audio wiring (build directive
   items 13/14/15 + VR_IPHONE_FALLBACK_ADDENDUM.md §5):

   • Turn ‹ › + recenter ⌖ buttons — the phone/desktop fallback's locomotion,
     since there's no controller to snap-turn with. Turn rotates the rig in
     fixed steps; recenter resets position + orientation to face the home
     panel. Also mirrored as a small camera-locked pair inside the scene so
     they're reachable in VR from the hub, a room, or the cloud.
   • Ambient birdsong — starts muted (autoplay policy + the directive's quiet
     default), fades in quietly on the FIRST user gesture, and the ♪ button
     toggles it any time. Choice is remembered for the session.
   • Onboarding hint — fades out after the first interaction.

   Plain DOM wiring (like fallback.js), not an A-Frame component — it mostly
   drives the overlay; it reaches into the rig/scene only for turn/recenter.
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TURN_DEG = 30;
  var AMBIENT_VOLUME = 0.22; // low, per "loop it at low volume"

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    var rig = document.querySelector('#rig');
    var scene = document.querySelector('a-scene');

    // ── Arrival veil ── fade the dark wash away once the scene is up, so the
    // dome eases in. Wait for the scene's 'loaded' (assets/renderer ready) so
    // the fade reveals a painted dome, not a blank frame.
    var veil = document.getElementById('arrivalVeil');
    function dismissVeil() {
      if (!veil) return;
      if (reducedMotion) { veil.parentNode && veil.parentNode.removeChild(veil); return; }
      requestAnimationFrame(function () { veil.classList.add('gone'); });
      // Matches the 0.6s CSS fade (item 10) — was 1400ms for the old 1.2s fade.
      setTimeout(function () { veil.parentNode && veil.parentNode.removeChild(veil); }, 700);
    }
    if (veil) {
      if (scene && scene.hasLoaded) setTimeout(dismissVeil, 100);
      else if (scene) scene.addEventListener('loaded', function () { setTimeout(dismissVeil, 100); });
      else dismissVeil();
      // Safety net: never let the veil get stuck if 'loaded' doesn't fire.
      setTimeout(dismissVeil, 4000);
    }
    // One flag governs every sound in the scene (index.html). While it's off:
    // the clip is never fetched or played, VRSound.enabled stays false so
    // sfx.js's cues are silent too, and the ♪ button is removed from the HUD
    // rather than left as a control that does nothing.
    var AUDIO_ON = !!window.VR_AUDIO;
    var audio = AUDIO_ON ? document.getElementById('ambientAudio') : null;
    var muteBtn = document.getElementById('muteBtn');
    if (!AUDIO_ON && muteBtn) {
      muteBtn.parentNode && muteBtn.parentNode.removeChild(muteBtn);
      muteBtn = null;
    }
    if (AUDIO_ON && audio) { audio.preload = 'auto'; audio.load(); }
    var hint = document.getElementById('onboardHint');

    // ── Comfort locomotion ──
    function turn(dir) {
      if (!rig) return;
      var r = rig.getAttribute('rotation');
      rig.setAttribute('rotation', { x: r.x, y: r.y + dir * TURN_DEG, z: r.z });
    }
    function recenter() {
      if (!rig) return;
      rig.setAttribute('rotation', { x: 0, y: 0, z: 0 });
      rig.setAttribute('position', { x: 0, y: 0, z: 0 });
    }
    var tl = document.getElementById('turnLeftBtn');
    var tr = document.getElementById('turnRightBtn');
    var rc = document.getElementById('recenterBtn');
    if (tl) tl.addEventListener('click', function () { turn(-1); });
    if (tr) tr.addEventListener('click', function () { turn(1); });
    if (rc) rc.addEventListener('click', recenter);

    // ── Ambient audio ──
    // States: 'off' (user turned it off, or hasn't gestured yet) / 'on'.
    // sessionStorage remembers an explicit off so a mid-session reload doesn't
    // re-start sound the visitor chose to silence.
    var userChoice = sessionStorage.getItem('vrAmbientChoice'); // 'on' | 'off' | null
    var playing = false;

    // Shared sound-on flag the one-shot UI cues (sfx.js) follow. It is NOT the
    // same thing as "the birdsong is playing":
    //   • cues stay silent until the first user gesture (autoplay policy), and
    //   • they turn on with that gesture unless the visitor has explicitly
    //     chosen silence with the ♪ toggle.
    // They used to be flipped on ONLY by startAudio(), i.e. only for a visitor
    // who turned the ambience on — and since the ambience is off by default,
    // that meant nobody who never touched ♪ ever heard a hover or select cue
    // (VR_TEST_REPORT G2's second half; the ♪ button was itself 87% covered by
    // A-Frame's Enter-VR button at the time, so in practice this was everyone).
    // The two are separate concerns now: ♪ owns the ambience, an explicit ♪-off
    // also means "quiet, please" and silences the cues, but the quiet default
    // no longer implies a mute.
    window.VRSound = window.VRSound || { enabled: false };

    function setMuteButton(on) {
      if (!muteBtn) return;
      muteBtn.classList.toggle('muted', !on);
      muteBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      muteBtn.textContent = on ? '♪' : '♪̸'; // slashed note when off (falls back to plain note if the combining char doesn't render)
      muteBtn.title = on ? 'Ambient sound: on' : 'Ambient sound: off';
    }
    function startAudio() {
      if (!AUDIO_ON || !audio || playing) return;
      audio.volume = AMBIENT_VOLUME;
      var p = audio.play();
      if (p && p.catch) p.catch(function () { /* autoplay still blocked — stays silent, button reflects off */ });
      playing = true;
      window.VRSound.enabled = true;
      setMuteButton(true);
    }
    function stopAudio() {
      if (!audio) return;
      audio.pause();
      playing = false;
      setMuteButton(false);
      // Deliberately does NOT clear window.VRSound.enabled — see the note
      // above. Only an explicit ♪-off does that (toggleAudio below).
    }
    function toggleAudio() {
      if (playing) {
        stopAudio();
        sessionStorage.setItem('vrAmbientChoice', 'off');
        window.VRSound.enabled = false; // explicit "silence" covers the UI cues too
      } else {
        startAudio();
        sessionStorage.setItem('vrAmbientChoice', 'on');
      }
    }
    if (muteBtn) muteBtn.addEventListener('click', toggleAudio);
    setMuteButton(false);

    // First user gesture: fade the onboarding hint out. Ambient birdsong now
    // stays OFF by default (ISSUE-06 — the looping nature SFX read as
    // intrusive); it only starts if the visitor explicitly turned it on this
    // session (the DOM HUD ♪ button, remembered as 'on'). Any of these events
    // counts as the gesture that unlocks audio playback.
    var firstGestureDone = false;
    function firstGesture() {
      if (firstGestureDone) return;
      firstGestureDone = true;
      // The gesture is what unlocks audio playback at all, so it's also what
      // enables the UI cues — unless this visitor already asked for silence,
      // or all audio is switched off at the source.
      if (AUDIO_ON && userChoice !== 'off') window.VRSound.enabled = true;
      if (AUDIO_ON && userChoice === 'on') startAudio();
      fadeHint();
      if (nudge) nudge.classList.add('dismissed');
      ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (evt) {
        window.removeEventListener(evt, firstGesture, true);
      });
    }
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (evt) {
      window.addEventListener(evt, firstGesture, true);
    });
    // Entering VR is itself a gesture (the Enter-VR tap) — make sure sound +
    // hint respond even if the pointer events don't bubble the same way in a
    // headset browser.
    if (scene) scene.addEventListener('enter-vr', firstGesture);

    // ── Onboarding hint ──
    var hintFaded = false;
    function fadeHint() {
      if (hintFaded || !hint) return;
      hintFaded = true;
      hint.classList.add('hidden');
      setTimeout(function () { if (hint && hint.parentNode) hint.parentNode.removeChild(hint); }, reducedMotion ? 0 : 900);
    }

    // The copy authored in index.html is the desktop/VR wording. On a touch
    // device it's wrong in three ways: "Click" isn't what you do, tilt-to-look
    // (the gyro magic window, the nicest thing about the phone view) is never
    // mentioned, and the VR sentence promises a mode iOS cannot enter at all —
    // no iOS browser supports WebXR, since they all run on WebKit. Rewrite it
    // to match what the visitor actually has.
    var TOUCH = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    function tailorHint() {
      if (!hint) return;
      // The VR clause is APPENDED where WebXR exists rather than authored into
      // the markup for everyone: on desktop without a headset (and on all of
      // iOS, which is WebKit-only) it promised a mode the visitor can't enter,
      // and it was the sentence that pushed this pill to two lines across the
      // bio card (VR_TEST_REPORT A5).
      // Both wordings now name the MOVEMENT control too (§9.5): there is a
      // joystick bottom-left on touch and WASD on desktop, and a control
      // nobody is told about is a control nobody uses. The desktop copy is
      // authored in index.html; only the touch rewrite lives here.
      var base = TOUCH
        ? 'Tap a panel to open it — drag or tilt to look, joystick to move.'
        : hint.textContent.trim();
      function set(text) { if (hint && hint.parentNode && !hintFaded) hint.textContent = text; }
      set(base);
      if (navigator.xr && navigator.xr.isSessionSupported) {
        navigator.xr.isSessionSupported('immersive-vr').then(function (ok) {
          if (ok) set(base + ' In VR, point and pinch.');
        }).catch(function () { /* keep base */ });
      }
    }
    tailorHint();

    // The landscape nudge was removed (see index.html) — Sebastian: "let's not
    // ask people to turn the phone sideways." Nothing to wire up here anymore.

    // The in-scene camera-locked "⌖ Recenter" / "♪ Sound" pills that used to
    // float near the floor in VR were removed (ISSUE-05): they read as
    // persistent clutter in every view. Recenter is still covered by the
    // headset's own system recenter gesture (and the DOM HUD's ⌖ button in the
    // 2D/phone view); ambient sound now defaults to off (ISSUE-06) and is
    // toggled from the DOM HUD's ♪ button, so nothing essential was lost.

    window.VRHud = {
      recenter: recenter,
      turn: turn
    };
  });
})();
