/* ═══ sfx.js ═══
   One-shot UI sound cues (VR_POLISH_STANDARDS.md §4):
     • hover  → on the SAME event that triggers the hover scale/brighten
                (mouseenter on a .clickable).
     • select → on the SAME event that triggers the open/select
                (click on a .clickable).

   Uses the generic bubbled A-Frame events, so it covers every interactive
   thing — hub cards, focus-stage + room + bio buttons, photo-cloud tiles —
   without per-component wiring. Cues are gated on window.VRSound.enabled,
   which hud.js turns on at the FIRST USER GESTURE (autoplay policy) rather
   than when the birdsong ambience starts. The two were the same flag, which
   meant a visitor who never turned the ambience on — the default — got no UI
   sound at all. An explicit ♪-off still silences these cues as well.

   ── Selectable cue schemes (ISSUE-10) ──────────────────────────────────────
   The hover/select feel is now a set of interchangeable "schemes." Audition a
   different one by changing ONE line — the SFX_SCHEME constant below — or at
   runtime from the console: `VRSfx.set('marimba')`. 'glass' plays the shipped
   audio files (assets/ui-hover, assets/ui-select); the other three synthesize
   their cues with the Web Audio API, so every option is functional with no
   extra asset files. To add a file-based candidate, drop clips into assets/ and
   add a `filePair('my-hover','my-select')` entry to SCHEMES.
*/

(function () {
  // ↓↓↓ ONE-LINE SWITCH — pick the active cue scheme ↓↓↓
  var SFX_SCHEME = 'glass'; // 'glass' | 'sine' | 'blip' | 'marimba'

  // ── File-based cues (the shipped default) ──
  function supportsOgg() {
    var a = document.createElement('audio');
    return !!(a.canPlayType && a.canPlayType('audio/ogg'));
  }
  var EXT = supportsOgg() ? '.ogg' : '.mp3';

  // A tiny round-robin pool per cue so rapid retriggers (sweeping the reticle
  // across cards) overlap cleanly instead of cutting each other off.
  //
  // The pool is built on the FIRST cue, not at load. It used to be eager, and
  // because `new Audio(src)` with preload='auto' fetches straight away, the
  // SCHEMES table below downloaded all seven clips on every page load — even
  // with the audio kill switch off, which is exactly what that switch promises
  // won't happen. Once the clips stopped being deployed (see the kill switch in
  // index.html) those became seven 404s in the console of a silent build.
  // playHover/playSelect are gated on enabled(), so while VR_AUDIO is false
  // this function is never called and nothing is ever requested. Cost of the
  // laziness: the very first hover cue may lag by one small fetch (3-8 KB).
  function makePool(base, volume, n) {
    var nodes = null;
    var idx = 0;
    return function () {
      if (!nodes) {
        nodes = [];
        for (var i = 0; i < n; i++) {
          var node = new Audio('assets/' + base + EXT);
          node.volume = volume;
          node.preload = 'auto';
          nodes.push(node);
        }
      }
      var a = nodes[idx];
      idx = (idx + 1) % n;
      try { a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    };
  }
  function filePair(hoverBase, selectBase) {
    return { hover: makePool(hoverBase, 0.18, 4), select: makePool(selectBase, 0.32, 3) };
  }

  // ── Synthesized cues (Web Audio) — no asset files needed ──
  var actx = null;
  function ctx() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (actx && actx.state === 'suspended') actx.resume(); // the first-gesture unlock also resumes this
    return actx;
  }
  // A short percussive tone with a fast attack + exponential decay envelope;
  // `freq2` glides the pitch for a two-note feel in one call.
  function tone(freq, dur, type, gain, freq2) {
    var c = ctx(); if (!c) return;
    var t0 = c.currentTime;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function synth(hoverSpec, selectSpec) {
    return {
      hover: function () { tone.apply(null, hoverSpec); },
      select: function () { tone.apply(null, selectSpec); }
    };
  }

  // The set (1 file-based default + 3 synthesized alternatives).
  var SCHEMES = {
    glass:   filePair('ui-hover', 'ui-select'),
    sine:    synth([880, 0.06, 'sine', 0.08],       [523.25, 0.11, 'sine', 0.12, 783.99]),
    blip:    synth([1200, 0.035, 'square', 0.05],   [600, 0.09, 'square', 0.09, 900]),
    marimba: synth([1046.5, 0.08, 'triangle', 0.09],[659.25, 0.12, 'triangle', 0.12, 987.77])
  };

  var active = SCHEMES[SFX_SCHEME] || SCHEMES.glass;

  // Both cues respect the shared sound on/off + first-gesture unlock in one
  // place, so individual schemes don't each re-check it.
  // window.VR_AUDIO is checked here as well as in hud.js, so a cue can never
  // sound just because something else set VRSound.enabled by hand.
  function enabled() { return !!(window.VR_AUDIO && window.VRSound && window.VRSound.enabled); }
  function playHover() { if (enabled()) active.hover(); }
  function playSelect() { if (enabled()) active.select(); }

  // Runtime auditioning helper — flip schemes live without an edit/reload.
  window.VRSfx = {
    schemes: Object.keys(SCHEMES),
    get: function () { return SFX_SCHEME; },
    set: function (name) { if (SCHEMES[name]) { SFX_SCHEME = name; active = SCHEMES[name]; } return SFX_SCHEME; }
  };

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  onReady(function () {
    var scene = document.querySelector('a-scene');
    if (!scene) return;
    // A-Frame's cursor emits these (bubbling) on the intersected .clickable —
    // mouseenter for hover, click for select.
    scene.addEventListener('mouseenter', playHover);
    scene.addEventListener('click', playSelect);
  });
})();
