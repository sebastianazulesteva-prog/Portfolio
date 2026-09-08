> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# VR Spec — iPhone / Phone Fallback Addendum

> **For Claude Code.** iPhone Safari has **no WebXR support at all** (no `immersive-vr`, no
> `immersive-ar` — a long-standing Apple/WebKit limitation with no announced fix; this applies to
> every iOS browser, since they all run on WebKit). This is not a bug to work around — design for
> it. This addendum makes the "phone fallback" mentioned elsewhere in the spec concrete. Applies
> to iPhone and, more broadly, any phone/tablet without a WebXR session (Android without a
> headset too).

## What happens on iPhone

1. `navigator.xr` is unsupported → no "Enter VR" button ever renders (per base spec). The scene
   loads directly as a flat 3D view — no dead end, no error.
2. **Gyroscope look-around ("magic window"):** use A-Frame's built-in `look-controls`, which
   already supports device-orientation-based looking on mobile out of the box. Tilting/turning
   the phone turns the camera through the dusk dome and constellations.
3. **iOS permission gate (mandatory, cannot be skipped or auto-granted):** iOS requires an
   explicit tap before releasing gyroscope/motion data to any webpage
   (`DeviceOrientationEvent.requestPermission()`, must be triggered by a real user gesture).
   Use A-Frame's built-in **`device-orientation-permission-ui`** component for this — style its
   prompt/button to match the site (dark bg, `--text`, Syne font) rather than leaving default
   styling. Show it once, clearly, before the scene starts responding to tilt.

## Interaction on phone (no controller, no hands — must add explicitly)

4. **Tap-to-select:** a centered reticle/cursor; tapping anywhere on the screen fires the same
   generic WebXR-style `select` event used by Quest/Vision Pro/desktop (same code path — just
   triggered by a `touchend` instead of pinch/trigger/click). This is how phone users open panels,
   enter project rooms, and pick photos in the cloud.
5. **On-screen controls (DOM overlay, thin + minimal, matching site style):**
   - **Left / right turn buttons** — gyroscope alone isn't enough; people can't always physically
     spin around holding a phone. Buttons perform the same snap-turn as controllers elsewhere.
   - **Recenter button** — resets forward orientation to center on the home panel.
   - Keep these small, semi-transparent, bottom-of-screen, never covering panel content.
6. Everything must share the same underlying interaction system as Quest/Vision Pro/desktop
   (reach-and-respond wake states, generic `select`) — phone just supplies different *sources* for
   the look-direction and the select trigger, per the base spec's device table.

## Guardrails

- Do not attempt any WebXR polyfill or Cardboard-style hack for iOS — that ecosystem is no longer
  viable; build the 2D/gyro fallback properly instead, since it's the real experience the majority
  of phone visitors will get.
- Respect `prefers-reduced-motion`: keep gyro look (it's user-driven, not autoplay motion) but
  disable any decorative drift/particles as elsewhere in the spec.
- Test on an actual iPhone in Safari, not just desktop devtools' mobile emulation — the permission
  prompt and gyro behavior only appear on a real device.
