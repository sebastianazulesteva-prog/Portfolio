> ⚠️ **SUPERSEDED IN PART — read [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md) FIRST.**
> That file is the current implementation reality (component map, dev tooling,
> and the debugging traps that produce silently-wrong results). This document
> remains valid as historical intent, but where it disagrees with the code or
> the guide, it is out of date.

# Spatial Portfolio — Build & Fix Notes

> Source: in-headset walkthrough recording (`RPReplay_Final1784824877.MP4`, ~4:09).
> Reference frames are in `./screenshots/`, named to match each issue below.
> This file is written to be dropped into the repo root (or `/docs`) and handed to Claude Code as the working spec.

---

## How to use this file (for Claude Code)

Each issue below is a self-contained work item with: a stable **ID**, **priority**, a plain-language **problem**, an **expected result** (acceptance criteria), a **reference screenshot**, and **where to look** hints. Work top-to-bottom by priority. When you pick up an issue:

1. Open the referenced screenshot in `./screenshots/` to see the exact on-screen state.
2. Locate the relevant view/component/system (hints are given; confirm against the actual tree — don't trust the guess blindly).
3. Make the change, then state which files you touched and how you verified it.
4. Check the item off in the tracking table at the bottom.

**Stack assumption (correct me if wrong):** visionOS app, SwiftUI for 2D windows + RealityKit for the volumetric/immersive scene, gestures via `SpatialTapGesture` / `DragGesture` with hand tracking, audio via `AudioPlaybackController` / `SpatialAudioComponent`. If the stack differs, map the concepts accordingly — the acceptance criteria are framework-agnostic.

**Vocabulary from the recording:**
- **Dome** = the main hub / home view the user returns to.
- **Project card** = a floating tile (thumbnail + title + subtitle) that opens a project.
- **Project room** = the immersive per-project space entered from a card.
- **Passthrough** = the real-world camera feed visible behind the app content.

---

## P0 — Blocking / breaks the experience

### ISSUE-01 · "Return to Dome" button does nothing
**Timestamp:** 00:21–00:27 · **Screenshot:** `screenshots/01_return_to_dome.jpg`

**Problem:** In a project detail view ("Algorithmic Modeling"), the large central **"← Return to dome"** button was tapped repeatedly and never navigated back to the hub.

**Expected result:**
- Tapping "Return to dome" reliably dismisses the current detail/project view and returns to the main dome hub, every time, from any project.
- Works with both eye-gaze + pinch and direct touch.

**Where to look:** the button's action closure and the navigation/router state that owns the current view. Common causes: the tap target is smaller than the visual pill (gaze lands on the label, not the hittable area); the action mutates a `@State` that isn't the source of truth; or an overlay is intercepting the tap. Verify the button's hit area matches its visual bounds and that the state change actually drives the scene transition.

---

### ISSUE-09 · Skybox/dome clips or disappears when the user stands
**Timestamp:** 03:08–03:20 · **Screenshot:** `screenshots/08_skybox_clip_standing.jpg`

**Problem:** Standing up shifts the dark environmental dome downward / clips it, exposing raw passthrough where the enclosed environment should be. Height/posture change breaks the skybox geometry. (In the frame you can see the dome's horizon line cutting across the view instead of fully enclosing.)

**Expected result:**
- The dome stays locked and fully enclosing regardless of user height or posture (seated ↔ standing).
- No passthrough leaks through the top/seam when the head moves vertically.

**Where to look:** the anchor the dome/skybox is attached to. If it's anchored to head/camera or a fixed floor-relative transform, standing pushes the geometry out of alignment. Prefer anchoring the dome to the world/room origin (or scale it large enough that vertical head travel can't reach the seam), and confirm the geometry has no open ceiling. Check near/far clipping too.

---

## P1 — Core interaction & layout

### ISSUE-02 · Title + hero shot not centered on entry
**Timestamp:** 00:30–00:38 · **Screenshot:** `screenshots/03_detail_view_layout.jpg`

**Problem:** When entering a project view, the primary title and hero image aren't spawned front-and-center. Content is scattered across the field of view; the user has to turn to find the main shot.

**Expected result:**
- On entering any project view, the **title** and **hero shot/primary image** spawn directly in front of the user's gaze/head-anchor, centered and at a comfortable reading distance.
- Secondary content arranges around that anchor, not in front of it.

**Where to look:** the placement logic that positions content on view-appear. Anchor the hero + title to the current head pose (captured once on entry, not continuously following) so it lands centered but doesn't jitter with the head.

---

### ISSUE-03 · Convert project list into a curved carousel with hand-drag
**Timestamp:** 00:39–00:55 · **Screenshot:** `screenshots/06_card_grid.jpg`

**Problem:** Project cards are laid out on a flat grid/plane (see reference). The desired layout is a curved/cylindrical carousel wrapping around the user, draggable by hand.

**Expected result:**
- Project cards are arranged on a **cylindrical arc** centered on the user (consistent radius, each card rotated to face inward toward the user).
- Hand gestures let the user **drag/push** cards smoothly along the curved axis (horizontal scroll around the cylinder), with momentum/inertia and gentle snapping.
- Cards remain legible (face the user) throughout the rotation.

**Where to look:** the container that lays out the cards. Replace flat X/Y positioning with polar placement: for card `i`, `angle = baseAngle + i * spacingAngle`, `position = (radius*sin(angle), y, -radius*cos(angle))`, and orient each card to look at the user. Drive `baseAngle` from a `DragGesture` translation mapped to rotation.

---

### ISSUE-08 · Card selection: kill the modal + heavy blur, tap goes straight into the room
**Timestamp:** 02:15–03:06 · **Screenshot:** `screenshots/07_card_selection_blur.jpg`

**Problem:** Tapping a thumbnail (e.g. "Poser Chess Set") opens a pop-up detail modal ("Enter the room →" / "Back") and aggressively blurs/darkens all surrounding cards. The selection feels disjointed and the blur is too heavy.

**Expected result:**
- Remove the pop-up detail/synopsis modal that appears on thumbnail tap.
- Add a persistent **"Enter the project room"** button to the bottom of **every** project card.
- A direct tap on a card (its thumbnail body) navigates **immediately** into that project room — no intermediate modal.
- Reduce the background treatment: keep surrounding cards **slightly** visible (light dim, no heavy blur) rather than blurring them out.

**Where to look:** the tap handler on the card and the modal presentation it triggers. Split behavior: thumbnail tap → navigate to room; add an explicit button in the card layout as a secondary/clear affordance. Remove the modal component and replace the full-strength blur/dim overlay with a low-opacity dim.

---

## P2 — Visual quality & assets

### ISSUE-07 · Remove lighting/color-grade filters from thumbnails
**Timestamp:** 01:48–02:08 · **Screenshot:** `screenshots/06_card_grid.jpg`

**Problem:** Thumbnails (e.g. "Poser Chess Set", "The Slip Door") render dark/tinted as if dynamic ambient lighting or a color grade is applied, degrading clarity.

**Expected result:**
- Project thumbnails display the **original raw image**, unlit and un-graded — a clean "window into the project."
- No ambient/dynamic lighting, tint, or filter darkens the image content.

**Where to look:** the material used for the card image. Use an **unlit/emissive** material (so scene lighting can't darken it) and remove any tint color, exposure, or post-process/grade applied to card textures. Confirm no environment IBL is multiplying into the thumbnail.

---

### ISSUE-04 · Fix the eye-gaze reveal effect on the portrait
**Timestamp:** 01:23–01:31 · **Screenshot:** `screenshots/04_eye_gaze_reveal.jpg`

**Problem:** The portrait headshot has a pixelated/mosaic reveal effect over the left side of the face that's meant to respond to gaze. It was frozen / non-responsive as the gaze moved across the image.

**Expected result:**
- The gaze-driven reveal (pixelation/mosaic → clear) updates dynamically as the user's gaze moves across the portrait.
- Effect follows gaze position smoothly, no frozen/stuck state.

**Where to look:** the shader/material driving the reveal and whatever feeds it a gaze/hover position. Note: visionOS does **not** expose raw eye-tracking coordinates to the app for privacy — gaze is only surfaced via system **hover effects**. If the effect needs a continuous gaze coordinate, it can't come from raw eye data; drive it from `HoverEffectComponent` state or a hover-based input instead, or redesign as a hover-triggered transition. Verify the shader parameter is actually being updated each frame (a static/one-shot binding would explain the "frozen" look).

---

### ISSUE-11 · Replace letter placeholders with real assets + build Photo Cloud
**Timestamp:** 03:36–03:59 · **Screenshot:** `screenshots/09_placeholder_letters.jpg`

**Problem:**
- Several cards show single-letter placeholders instead of images: **"S"** (Social Engineering via Predictive Algorithms), **"3"** (3D-Printed Glasses Frames), **"A"** (Algorithmic Modeling).
- The **Photo Cloud** feature named in the project spec isn't present in the space.

**Expected result:**
- Every card loads its real project render/photo asset; no letter fallbacks remain for projects that have art.
- The Photo Cloud component is built and integrated into the space per spec.

**Where to look:** the asset catalog / image-loading path for cards (the letter is likely a fallback when the named asset is missing or misnamed). Confirm the real assets exist and are referenced by the right keys. Photo Cloud is net-new — locate its spec before building; flag here if the spec isn't in the repo.

---

## P3 — Polish, audio & cleanup

### ISSUE-05 · Remove the floating "Recenter" and "Sound" buttons
**Timestamp:** 01:31–01:41 · **Screenshot:** `screenshots/05_recenter_sound_buttons.jpg`

**Problem:** Two persistent pill buttons ("Recenter", "Sound") float near the floor plane in every view and add clutter without value. (They appear in almost every reference frame.)

**Expected result:** The persistent bottom "Recenter" and "Sound" pills are removed entirely from all views.

**Where to look:** the shared bottom control bar / ornament rendered across views. Remove the component (or the two buttons within it). If "Recenter" is the only way to re-center, confirm the system recenter gesture covers it before deleting.

---

### ISSUE-06 · Mute ambient bird sounds
**Timestamp:** 01:41–01:44 · **Screenshot:** *(audio — no frame)*

**Problem:** Continuous background bird chirping plays throughout the experience.

**Expected result:** Background bird ambience is muted / removed. No looping nature SFX plays by default.

**Where to look:** the ambient audio player started on scene load (looping bird/nature track). Stop it from auto-playing, or remove the asset from the ambient bed.

---

### ISSUE-10 · Provide alternative UI selection sounds
**Timestamp:** 03:28–03:35 · **Screenshot:** *(audio — no frame)*

**Problem:** Hover/tap on cards plays a default UI chime the user wants to reconsider.

**Expected result:** A small set (3–4) of alternative selection/hover SFX are wired up behind an easy switch (config constant or enum) so a better one can be chosen. Current default remains functional until a pick is made.

**Where to look:** the UI feedback sound triggered on card hover/tap. Parameterize the sound source so swapping the clip is a one-line change; add the candidate clips to the audio assets.

---

## Priority-ordered tracking table

| Done | ID | Priority | Component | Change | Screenshot |
|---|---|---|---|---|---|
| ☑ | ISSUE-01 | P0 | Navigation | Fix broken "Return to Dome" button/handler | `01_return_to_dome.jpg` |
| ☑ | ISSUE-09 | P0 | Environment | Lock dome/skybox so it doesn't clip when standing | `08_skybox_clip_standing.jpg` |
| ☑ | ISSUE-02 | P1 | Layout | Spawn title + hero shot centered on gaze | `03_detail_view_layout.jpg` |
| ☑ | ISSUE-03 | P1 | UI structure | Curved carousel of cards + hand-drag | `06_card_grid.jpg` |
| ☑ | ISSUE-08 | P1 | Interaction | Remove modal + heavy blur; add "Enter room" btn; tap → room | `07_card_selection_blur.jpg` |
| ☑ | ISSUE-07 | P2 | Materials | Remove lighting/grade tint from thumbnails | `06_card_grid.jpg` |
| ☑ | ISSUE-04 | P2 | Shaders | Fix gaze/hover-driven portrait reveal | `04_eye_gaze_reveal.jpg` |
| ☑ | ISSUE-11 | P2 | Assets | Real images for card placeholders; build Photo Cloud | `09_placeholder_letters.jpg` |
| ☑ | ISSUE-05 | P3 | Spatial UI | Remove floating Recenter/Sound pills | `05_recenter_sound_buttons.jpg` |
| ☑ | ISSUE-06 | P3 | Audio | Mute ambient bird sounds | — |
| ☑ | ISSUE-10 | P3 | Audio | Add alternative UI selection sounds | — |

---

## Notes for the human (Sebastian)

- Priorities are my proposal (broken nav + passthrough leak first, then interaction/layout, then visual polish, then audio). Reorder if your demo deadline weights differently.
- ISSUE-11 depends on assets/spec that may not be in the repo (real renders + the Photo Cloud spec). Point Claude Code at those, or it'll flag them as blocked.
  - **RESOLVED / FLAG (2026-07-23):** Photo Cloud was NOT a stub — it's fully built and live (`vr/components/photo-cloud.js`): all 34 site images drift as a constellation directly *behind* the hub (per spec §9), focus-forward + caption on reach. It reads as "not present" only because you have to turn around 180° from the home panel to see it. Verified 34/34 tiles load real textures.
  - The 5 projects **with** photography (Bastón, Slip Door, Pendant, Time Collector, Poser Chess Set) already load their real hero image — no letter fallback. The 4 letter cards (HP's Reckoning `H`, Algorithmic Modeling `A`, 3D-Printed Glasses Frames `3`, Social Engineering `S`) have **no raster art anywhere in the repo** — those pages are an embedded PDF + a generic profile og:image, nothing project-specific. So they correctly fall back to the generated accent/initial panel. **To make them show real images, add a hero to `/images/` and reference it via an `image` override in `vr/projects.json`** (or add an `<img>` to the project's own page) — the card picks it up with no code change. Not fabricating art here per this note's guidance.
- The "Enter the room →" button already exists **inside the modal** (visible in `07_card_selection_blur.jpg`). ISSUE-08 is about promoting that action onto the card itself and deleting the modal — the logic likely already exists to reuse.
