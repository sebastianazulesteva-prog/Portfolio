/* ═══ hub-panel.js ═══
   The glass "index card" — the compact tile used in every constellation
   (projects, experience, the home name/tagline furniture, photo-cloud tiles
   later). Glass frame + cover-fit hero image come from glass-material.js
   (shared, so the same look/feather is used everywhere). Text uses
   aframe-troika-text (real Playfair/Syne font files) so type stays crisp and
   on-brand at any distance.

   This is deliberately a compact "glance" card now, not the full detail view:
   selecting one doesn't jump straight into a project room. Per Sebastian's
   command-zone direction, it opens the focus stage (focus-stage.js) — the
   card is "pulled" toward the viewer, enlarged, with its full detail (blurb/
   tags for a project, bullets for a role) — and *that* view is what offers
   "Enter the room →". Every card is selectable this way (assign `.detail`
   right after creation — see index.html); a card with no `.detail` (e.g. the
   static home title furniture) just isn't clickable.

   Usage:
     text card:  <a-entity hub-panel="title: Projects; subtitle: turn to explore"></a-entity>
     image card: <a-entity hub-panel="title: Bastón; image: /images/baston-hero.jpg;
                                       subtitle: 3D Printing · Design"></a-entity>
     (then, right after creation: el.components['hub-panel'].detail = { type: 'project', data: item };)
*/

(function () {
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  AFRAME.registerComponent('hub-panel', {
    schema: {
      title: { type: 'string' },
      subtitle: { type: 'string', default: '' },
      width: { type: 'number', default: 1 },
      height: { type: 'number', default: 0.6 },
      accent: { type: 'color', default: '#b8863b' },
      image: { type: 'string', default: '' },
      imagetone: { type: 'number', default: 0 }, // 0..1 highlight-rolloff for a glary hero (item 5)
      placeholder: { type: 'boolean', default: false }, // draw a generated accent graphic when there's no hero (item 6)
      hasroom: { type: 'boolean', default: false }, // a project card: tap goes straight into its room + shows a persistent Enter button (ISSUE-08)
      // ROUGH DRAFT — the "writing card" variant for the PDF write-up
      // projects (HP's Reckoning, Algorithmic Modeling, 3D-Printed Glasses
      // Frames, Social Engineering, Apple's Medical Licensure) that have NO
      // photography anywhere in the repo (BUILD_NOTES ISSUE-11). Instead of a
      // generated single-letter placeholder standing in for a missing photo,
      // the piece's own TITLE fills the space a hero image would — the title
      // effectively becomes the "cover". Meant to run at roughly half the
      // height of a normal photo card; not yet wired into the live
      // constellation layout, this is for review in the dev harness first
      // (?card=paper&id=<stem>).
      paperTitle: { type: 'boolean', default: false },
      // A plain text-only card (Experience) has no image, no "Enter the
      // room" button, nothing visibly signalling it's clickable — the whole
      // card IS the click target (see `detail`/_onClick below) but nothing
      // hinted that. Same canvas-drawn glyph as ui-button's arrow badge
      // (not a re-drawn lookalike — see window.VRArrowGlyph), same rest/
      // hover rotation, but with no backing pad of its own since the card
      // it sits on is already the whole hit target.
      arrowHint: { type: 'boolean', default: false }
    },

    init: function () {
      var w = this.data.width, h = this.data.height;
      var a11y = document.body.classList.contains('accessible');
      var hasImage = !!this.data.image;
      // A placeholder-flagged card with no real image still gets the image-card
      // layout (hero area + caption bar), just with a generated graphic — so it
      // sits consistently beside the photo-backed cards instead of as bare text.
      // paperTitle cards skip this path entirely — see the branch below.
      var hasPlaceholder = !this.data.paperTitle && !hasImage && this.data.placeholder;
      var hasVisual = !this.data.paperTitle && (hasImage || hasPlaceholder);
      var pad = Math.min(w, h) * 0.06;
      var captionFrac = hasVisual ? 0.24 : 0;
      var radius = Math.min(0.05, Math.min(w, h) * 0.09);

      // `detail`, set by the caller right after creation (see index.html's
      // onPlaced), carries the full { type, data } payload the focus stage
      // needs. NOT initialized here to null: the component object exists
      // synchronously the moment setAttribute() runs, but this init() itself
      // fires later/async (on the entity's own 'loaded') — since onPlaced
      // sets .detail synchronously right after creation, an assignment here
      // would silently clobber it. Leaving it simply undefined until then is
      // just as falsy for the click-handler check below.

      // ── Glass frame ──
      // captionFrac is passed as 0 for image cards: the photo is full bleed on
      // top of this, so the shader's darkened caption band would sit UNDER the
      // image where it can't be seen, and any part that did show would be
      // exactly the "contrast over the image" Sebastian asked to remove. The
      // glass still provides the border, rim glow and hover response around
      // the photo's rounded edge.
      this.material = VRGlass.makeCardMaterial(w, h, radius, this.data.accent, hasVisual ? 0 : captionFrac);
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.material);
      this.el.setObject3D('panel-mesh', this.mesh);

      this._hover = 0;
      this._hoverTarget = 0;
      this._dim = 0;
      this._dimTarget = 0;
      // Text children are tracked here (with their base opacity) so they fade
      // together with the glass/image when the card is dimmed behind a focused
      // one — otherwise the caption text stayed at full brightness over a
      // receded card, which read as floating, disconnected labels.
      this._textEls = [];

      // ── Hero image (cover-fit) or generated placeholder, FULL BLEED ──
      // The image is the card: edge to edge, no inset, no glass showing
      // around it, and no feather melting it into the frame. Per Sebastian —
      // "the image should fill the entire card… we should just see the image
      // (no contrast/things over)". It carries the card's own corner radius so
      // it follows the rounded silhouette instead of poking square corners out
      // (see uImgCorner in glass-material.js).
      //
      // The caption is now an overlay on top of the photo rather than a band
      // of glass beneath it, so captionFrac is only used to position text —
      // it is NOT passed to the glass shader as a darkened bar any more.
      if (hasVisual) {
        var imgW = w;
        var imgH = h;
        var imgY = 0;
        var feather = 0;

        // tone 0: thumbnails show the ORIGINAL raw image — a clean window into
        // the project, unlit and un-graded (ISSUE-07). The highlight-rolloff +
        // vignette grade (imagetone, added for the blown-out pendant hero) read
        // as "dynamic lighting / a colour filter darkening the thumbnail" in
        // the walkthrough, so it's no longer applied to the glance cards. (The
        // material was already unlit — a ShaderMaterial, no scene light or IBL
        // touches it — so this removes the only thing that dimmed the image.)
        this.imgMesh = hasImage
          // 1024, not null. This passed NO size cap, so every glance card
          // uploaded its hero at native resolution — chess-hero at 5712×4284 is
          // ~130 MB of texture on its own, and there are a dozen of these. A
          // card this size at command-zone distance resolves nothing past 1024.
          ? VRGlass.makeFeatheredImage(this.data.image, imgW, imgH, feather, 1024, 0, radius)
          : VRGlass.makePlaceholderImage(imgW, imgH, this.data.accent, this.data.title, feather, radius);
        this.imgMesh.position.set(0, imgY, 0.006);
        this.el.setObject3D('panel-image', this.imgMesh);
      }

      // ── Caption, floating ABOVE the card, centered text, or the paper-title card ──
      if (this.data.paperTitle) {
        // ROUGH DRAFT — see the schema comment above. The title stands in for
        // the missing hero image: big, centred, filling most of the card's
        // (compact, ~half-height) area. Tags sit below it in the small label
        // size, same accent-coloured treatment as every other card's tags.
        // No "Enter the room" button — at half height there's no clean place
        // to put one without recreating the exact footprint problem the
        // floating-caption cards just needed a bigger gapM to fix, and the
        // card is already tap-to-enter via hasroom (see the click handler
        // below), same as every other project tile.
        var paperPad = pad * 1.3;
        var paperMaxW = w - paperPad * 2;
        // The size cap below assumed roughly 2 wrapped lines. A title that
        // wraps to 3 ("Social Engineering via Predictive Algorithms",
        // "Apple's Medical Licensure for Apple Watch") is taller than that
        // guess and measured 6% PAST the card's top edge — caught by reading
        // troika's real blockBounds after creation, not by eye. Rather than
        // predicting line count up front, shrink-and-remeasure against the
        // available height, same pattern as the bio card's auto-fit.
        var paperTitleSize = Math.min(VRType.title() * 1.35, h * 0.32, paperMaxW * 0.16);
        var titleAnchorY = h * 0.1;
        // Checked against the REAL edges (card top, and where the tags line
        // starts), not a symmetric fraction of h — a first pass used a flat
        // 0.86h guess that doesn't account for the anchor's own offset from
        // centre, and one title (3 wrapped lines) still overflowed the top
        // by 7.6mm after that version's shrink pass converged.
        var titleTopLimit = h / 2 - h * 0.02;
        var titleBottomLimit = -h * 0.22; // clears the tags anchor at -h*0.3
        // Needs an emissive floor, same reasoning as CAPTION_LIT below: this
        // scene's key rack is dim and warm, so a plain white MeshStandardMaterial
        // sinks to a muddy brown against the card's own accent-tinted fill —
        // exactly the "hard to read" the photo-card captions solved the same
        // way. Without this the title relies entirely on rack light it isn't
        // guaranteed to get standing on the card's own surface.
        var paperTitle = this._text({
          value: this.data.title, align: 'center', anchor: 'center', baseline: 'center',
          color: '#ffffff', font: VRFonts.title(), fontSize: paperTitleSize,
          maxWidth: paperMaxW, lineHeight: 1.1
        }, 0, titleAnchorY, undefined, { emissive: true });
        this.el.appendChild(paperTitle);

        var shrinkTries = 0;
        (function shrinkToFit() {
          var m = paperTitle.components['troika-text'] && paperTitle.components['troika-text'].troikaTextMesh;
          var bb = m && m.textRenderInfo && m.textRenderInfo.blockBounds;
          if (!bb) { if (++shrinkTries < 60) setTimeout(shrinkToFit, 40); return; }
          var topOverflow = (titleAnchorY + bb[3]) - titleTopLimit;
          var bottomOverflow = titleBottomLimit - (titleAnchorY + bb[1]);
          var worstOverflow = Math.max(topOverflow, bottomOverflow);
          if (worstOverflow > 0.0005 && shrinkTries < 10) {
            shrinkTries++;
            var measuredH = bb[3] - bb[1];
            var availH = measuredH - worstOverflow * 2; // shrink both edges' worth
            paperTitleSize *= Math.sqrt(Math.max(0.3, availH / measuredH));
            paperTitle.setAttribute('troika-text', 'fontSize', paperTitleSize);
            setTimeout(shrinkToFit, 40);
          }
        })();

        if (this.data.subtitle) {
          // Sized up from the other cards' plain 'label' tags (same exception
          // class as ui-button's arrow-CTA bump: still a scale of the existing
          // size, not a new 4th size) — this line stands in for the whole
          // "subtitle row" other cards have room for, so it reads as thin at
          // the bare label size on its own under a title this large.
          var paperTags = this._text({
            value: this.data.subtitle, align: 'center', anchor: 'center', baseline: 'center',
            color: this.data.accent, fillOpacity: 0.85, font: VRFonts.body(),
            fontSize: VRType.label() * 1.3, maxWidth: paperMaxW, letterSpacing: 0.02
          }, 0, -h * 0.3, undefined, { emissive: true });
          this.el.appendChild(paperTags);
        }
      } else if (hasVisual) {
        // Above the card entirely, not over the photo. Sitting on the image
        // was unsolvable for light heroes: white text over the near-white
        // Slip Door hero was effectively invisible, and the only fixes were a
        // scrim or an outline — both of which are "something over the image",
        // which is exactly what was asked to be removed. Floating it clear of
        // the card keeps the photo 100% untouched AND keeps the type readable
        // on every project regardless of how bright its hero is.
        //
        // Same treatment as the home title (name-scatter-3d.js): no backdrop
        // plate, white, emissive so it holds a brightness floor against the
        // dark dome rather than relying on the rack.
        var CAPTION_Z = 0.02;
        var CAPTION_LIT = { emissive: true };
        var titleSize = VRType.title();
        var tagSize = VRType.label();
        var capGap = 0.026;   // card top edge -> nearest caption line
        var stackGap = 0.012; // tags -> title

        // Stacked UPWARD from the card's top edge: tags nearest the card,
        // title above them so it reads as the dominant outer line.
        //
        // baseline:'bottom' for both, so each y IS the block's bottom edge and
        // the stack grows away from the card. A first pass anchored from the
        // top and spaced the title by a multiple of the TAG size — the title
        // then overlapped the tags, because its own wrapped height is larger
        // than that gap (and larger still for two-line titles like "Apple's
        // Medical Licensure for Apple Watch"). The title's offset has to come
        // from the TAGS' measured height, which is what the reflow below does.
        var tags = null;
        if (this.data.subtitle) {
          tags = this._text({
            value: this.data.subtitle, align: 'left', anchor: 'left', baseline: 'bottom',
            color: '#ffffff', fillOpacity: 0.75, font: VRFonts.body(),
            fontSize: tagSize, maxWidth: w, letterSpacing: 0.02
          }, -w / 2, h / 2 + capGap, CAPTION_Z, CAPTION_LIT);
          this.el.appendChild(tags);
        }

        var title = this._text({
          value: this.data.title, align: 'left', anchor: 'left', baseline: 'bottom',
          color: '#ffffff', font: VRFonts.title(),
          fontSize: titleSize, maxWidth: w
        }, -w / 2, h / 2 + capGap, CAPTION_Z, CAPTION_LIT);
        this.el.appendChild(title);

        // Lift the title clear of the tags once their real wrapped height is
        // known. Same blockBounds polling technique as the text-card path
        // below, since troika measures asynchronously.
        if (tags) {
          var capAttempts = 0;
          (function liftTitle() {
            var m = tags.components['troika-text'] && tags.components['troika-text'].troikaTextMesh;
            if (m && m.textRenderInfo && m.textRenderInfo.blockBounds) {
              var bb = m.textRenderInfo.blockBounds;
              title.object3D.position.y = h / 2 + capGap + (bb[3] - bb[1]) + stackGap;
              return;
            }
            if (++capAttempts > 60) return;
            setTimeout(liftTitle, 50);
          })();
        }
      } else if (this.data.subtitle) {
        // Text-only cards with a subtitle (e.g. Experience: company name +
        // role/date) can't use a fixed title→subtitle gap — some company
        // names ("Virtual Human Interaction Lab (VHIL)") wrap to 2-3 lines
        // at this fontSize/width and would run straight into a subtitle
        // parked at a fixed offset (confirmed: a 3-line title measures
        // 0.207m tall here, taller than the fixed gap assumed a 1-line
        // title). Anchoring the title from its TOP edge and measuring its
        // real wrapped height (same troika blockBounds technique as
        // name-scatter-3d.js) means the subtitle always lands just below
        // it, regardless of how many lines the title wraps to.
        var titleTopY = h * 0.42;
        // Needs the same emissive floor as CAPTION_LIT / the paper-title card:
        // without it this text is lit only by the dim, warm key rack and
        // sinks toward muddy grey-brown regardless of the '#f5f5f0' it's
        // given — confirmed on the Experience cards, where the company name
        // and role/date line were both reading as barely-visible dark text.
        var titleFontSize = VRType.title();
        var tTitle = this._text({
          value: this.data.title, align: 'center', anchor: 'center', baseline: 'top',
          color: '#f5f5f0', font: VRFonts.title(),
          fontSize: titleFontSize, maxWidth: w - pad * 2, lineHeight: 1.15
        }, 0, titleTopY, undefined, { emissive: true });
        this.el.appendChild(tTitle);

        // The role · location · dates line, sized WELL up from the bare label
        // size, per Sebastian. This is the substance of an Experience card —
        // what the job actually was — but at plain VRType.label() with
        // fillOpacity 0.6 it read as throwaway fine print next to the company
        // name, and at the glance tile's distance it was the first thing to
        // become unreadable. Opacity comes up with it: 0.6 was tuned for a
        // deliberately-quiet metadata line, which this is not.
        var subFontSize = VRType.label() * 1.55;
        var tSub = this._text({
          value: this.data.subtitle, align: 'center', anchor: 'center', baseline: 'top',
          color: '#f5f5f0', fillOpacity: 0.92, font: VRFonts.body(),
          fontSize: subFontSize, maxWidth: w - pad * 2, lineHeight: 1.3
        }, 0, -h, undefined, { emissive: true }); // placed off-card until measured, to avoid a flash of overlap
        this.el.appendChild(tSub);

        var gap = 0.028;
        // Bottom edge the subtitle must stay inside. The arrowHint badge sits
        // in the bottom-right corner, so stop short of it rather than running
        // the last line underneath it.
        var subBottomLimit = -h / 2 + (this.data.arrowHint ? Math.min(w, h) * 0.16 : pad);
        // The title gets a HEIGHT BUDGET rather than the whole card. Without
        // one, a company name that wraps to 4 lines ("Stanford University -
        // Comparative Medicine") consumed everything above the bottom edge and
        // the subtitle was the only thing that could give — measured at 0.0034 m
        // of font size, i.e. 3.4 mm tall text, after eight consecutive 0.72x
        // shrinks (VR_TEST_REPORT G7 saw the a11y-mode variant of this as an
        // 18 mm overflow). Budget = the band from the title's top anchor down to
        // where the subtitle needs at least two of its own lines.
        var MIN_SUB = VRType.label() * 0.95;   // never shrink below a legible label
        var titleBudget = (titleTopY - subBottomLimit) - (MIN_SUB * 1.3 * 2 + gap);
        var TITLE_FLOOR = VRType.title() * 0.7;
        function heightOfEl(entity) {
          var m = entity.components['troika-text'] && entity.components['troika-text'].troikaTextMesh;
          var bb = m && m.textRenderInfo && m.textRenderInfo.blockBounds;
          return bb ? bb[3] - bb[1] : null;
        }
        // troika keeps the OLD blockBounds readable after a fontSize change
        // (VR_AI_BUILD_GUIDE §3.2), so every step below waits for the measured
        // height to actually CHANGE rather than for it to merely exist. The
        // previous version measured the title once, placed the subtitle against
        // that stale value, and never looked again — which is how the a11y-mode
        // card ended up 102 mm past its own bottom edge with no shrink applied
        // at all: the title re-laid out bigger after the check had passed.
        function afterChange(entity, prevH, cb) {
          var tries = 0;
          (function poll() {
            var now = heightOfEl(entity);
            if (now != null && (prevH == null || Math.abs(now - prevH) > 1e-6)) return cb(now);
            if (++tries > 60) return cb(now);
            setTimeout(poll, 40);
          })();
        }
        var titleShrinks = 0, subShrinks = 0;
        var cardTitle = this.data.title;
        (function fitTextCard() {
          var titleH = heightOfEl(tTitle);
          if (titleH == null) return afterChange(tTitle, null, function () { fitTextCard(); });

          // 1. Title first: shrink it into its budget, so the subtitle always
          //    has a predictable band to live in.
          if (titleH > titleBudget && titleFontSize > TITLE_FLOOR && titleShrinks < 6) {
            titleShrinks++;
            titleFontSize = Math.max(TITLE_FLOOR,
              titleFontSize * Math.max(0.86, Math.sqrt(Math.max(0.25, titleBudget / titleH))));
            tTitle.setAttribute('troika-text', 'fontSize', titleFontSize);
            return afterChange(tTitle, titleH, function () { fitTextCard(); });
          }

          // 2. Then the subtitle, hung off the title's REAL wrapped height, so
          //    it lands just below however many lines the title took.
          var topY = titleTopY - titleH - gap;
          tSub.object3D.position.y = topY;
          var subH = heightOfEl(tSub);
          if (subH == null) return afterChange(tSub, null, function () { fitTextCard(); });

          if ((topY - subH) < subBottomLimit) {
            // The 1.55x bump above is a TARGET, not a guarantee. Shrink back
            // only as far as needed, so short-titled cards keep the full bump —
            // but never below MIN_SUB: unreadable text that fits is not a fit.
            var availH = topY - subBottomLimit;
            if (subFontSize > MIN_SUB && subShrinks < 8) {
              subShrinks++;
              subFontSize = Math.max(MIN_SUB,
                subFontSize * Math.max(0.8, Math.sqrt(Math.max(0.2, availH / subH))));
              tSub.setAttribute('troika-text', 'fontSize', subFontSize);
              return afterChange(tSub, subH, function () { fitTextCard(); });
            }
            // Out of room with both sizes at their floors: say so. Content is
            // scraped from the live site, so this is the signal that a card
            // needs to be taller or a company name shortened — not something
            // to absorb silently by rendering 3 mm type.
            console.warn('[vr] hub-panel: "' + cardTitle + '" text exceeds its card by',
              (subBottomLimit - (topY - subH)).toFixed(3), 'm at the minimum legible sizes');
          }
        })();
      } else {
        var tTitleOnly = this._text({
          value: this.data.title, align: 'center', anchor: 'center', baseline: 'center',
          color: '#f5f5f0', font: VRFonts.title(),
          fontSize: VRType.title(), maxWidth: w - pad * 2, lineHeight: 1.15
        }, 0, 0, undefined, { emissive: true });
        this.el.appendChild(tTitleOnly);
      }

      // ── Arrow hint (Experience cards) — see the schema comment. Bottom
      // right corner, same rest/hover rotation as ui-button's badge, but no
      // backing pad: the whole card is the hit target, this is only ever a
      // visual cue that clicking it opens the full detail (focus-stage.js),
      // never a link out of VR (there's no click path anywhere that opens
      // companyHref — the badge should not read as "visit the website").
      if (this.data.arrowHint && window.VRArrowGlyph) {
        var hintR = Math.min(w, h) * 0.11;
        var hintInset = Math.min(w, h) * 0.09;
        var hintBadge = document.createElement('a-entity');
        hintBadge.setAttribute('position', { x: w / 2 - hintInset - hintR, y: -h / 2 + hintInset + hintR, z: 0.016 });
        hintBadge.setAttribute('rotation', { x: 0, y: 0, z: VRArrowGlyph.restDeg });
        this.el.appendChild(hintBadge);
        var hintMat = new THREE.MeshBasicMaterial({
          map: VRArrowGlyph.texture(), transparent: true, color: '#f5f5f0', opacity: 0.85
        });
        var hintMesh = new THREE.Mesh(new THREE.PlaneGeometry(hintR * 1.5, hintR * 1.5), hintMat);
        hintMesh.position.z = 0.004;
        hintBadge.setObject3D('hint-glyph', hintMesh);
        this._hintBadgeEl = hintBadge;
      }

      // ── Selectable ──
      // Project cards (hasroom) go STRAIGHT into their room on a body tap — no
      // intermediate pop-up detail modal (ISSUE-08). Experience cards (no room
      // to enter) still pull closer into the focus stage, which is where their
      // full bullet list lives. Cards with no payload (static furniture) just
      // wake on hover but aren't clickable.
      this.el.classList.add('clickable');
      this._onClick = function () {
        if (!this.detail) return;
        // A writing piece has no themed room — the reader replaces it (see the
        // paperTitle branch below). The card body used to fall through to
        // VRProjectRoom.enter() with the rest of the projects, so tapping the
        // biggest target on a paper card took you into an empty themed room
        // instead of the piece, while the card's own 'Read the piece' button
        // went to the reader. Same card, two destinations.
        if (this.data.paperTitle) window.VRPdfReader.open(this.detail.data);
        // Rooms sealed (window.VR_ROOMS, see index.html): a photo card's body
        // tap pulls it into the focus stage instead of entering — the same
        // thing an Experience card does, and the detail view is the useful
        // half of what the room offered anyway. The explicit CTA below is what
        // reports the rooms as coming soon; a body tap that popped a notice
        // would make the biggest target on the card do nothing but nag.
        else if (this.detail.type === 'project' && window.VR_ROOMS === false) window.VRFocusStage.open(this.detail, this.el);
        else if (this.detail.type === 'project') window.VRProjectRoom.enter(this.detail.data);
        // An EXPERIENCE card turns over instead of opening the focus stage
        // (card-flip.js): the card is the record and the bullets are its
        // reverse, so a separate panel appearing next to it was the wrong
        // gesture. Guarded on both the component being loaded AND the card
        // having been given a spec, so a card without one still reaches the
        // focus stage rather than becoming un-openable.
        else if (this.detail.type === 'experience' && window.VRCardFlip &&
                 window.VRCardFlip.toggle(this.el)) return;
        else window.VRFocusStage.open(this.detail, this.el);
      }.bind(this);
      this.el.addEventListener('click', this._onClick);

      // Persistent "Enter the room" button on every project card (ISSUE-08) —
      // a clear, always-visible affordance in addition to the body tap, rather
      // than an action hidden behind a modal. Its own tap enters the room and
      // is stopped from bubbling so the card handler doesn't also fire.
      if (this.data.paperTitle) {
        // Writing pieces get a READ action instead of a room — these are PDFs,
        // and per Sebastian they replace the themed project room entirely
        // (pdf-reader.js transports you to a dark reading space). Two controls:
        // a long primary rectangle to read, and a small square to copy the PDF
        // link, matching the shapes he asked for.
        var readH = 0.10;
        var copyW = 0.26; // ui-button's clamped minimum width — the "small box"
        var gapBetween = 0.03;
        var totalW = Math.min(0.72, w);
        var readW = Math.max(0.26, totalW - copyW - gapBetween);
        var rowY = -h / 2 - readH / 2 - 0.022;

        var readBtn = document.createElement('a-entity');
        readBtn.setAttribute('ui-button', {
          label: 'Read the piece', width: readW, height: readH,
          // labelColor override: solid's usual dark-on-accent label reads fine
          // as "a real control" here too, but per Sebastian every text on this
          // card — title, tags, both button labels and the arrow — should
          // read as white, matching 'Link' (ghost) instead of contrasting
          // against it.
          accent: this.data.accent, variant: 'solid', arrow: true, labelColor: '#f5f5f0'
        });
        readBtn.setAttribute('position', { x: -(totalW / 2) + readW / 2, y: rowY, z: 0.01 });
        readBtn.addEventListener('click', function (evt) {
          if (evt && evt.stopPropagation) evt.stopPropagation();
          if (this.detail) window.VRPdfReader.open(this.detail.data);
        }.bind(this));
        this.el.appendChild(readBtn);

        var copyBtn = document.createElement('a-entity');
        copyBtn.setAttribute('ui-button', {
          label: '⧉ Link', width: copyW, height: readH,
          accent: this.data.accent, variant: 'ghost'
        });
        copyBtn.setAttribute('position', { x: (totalW / 2) - copyW / 2, y: rowY, z: 0.01 });
        copyBtn.addEventListener('click', function (evt) {
          if (evt && evt.stopPropagation) evt.stopPropagation();
          this._copyPdfLink(copyBtn);
        }.bind(this));
        this.el.appendChild(copyBtn);

      } else if (this.data.hasroom) {
        var enterBtn = document.createElement('a-entity');
        // Width tracks the card but never below ui-button's clamped minimum;
        // the glance tiles are only 0.72 wide, so this deliberately lets the
        // button run the full card width rather than insetting by pad.
        var enterH = 0.10;
        enterBtn.setAttribute('ui-button', { label: 'Enter the project room', width: Math.max(0.26, Math.min(0.66, w - pad * 2)), height: enterH, accent: this.data.accent, variant: 'solid', arrow: true });
        // Sits clear below the card, offset by its own half-height plus a gap
        // — derived, so changing enterH can't leave it overlapping the card.
        enterBtn.setAttribute('position', { x: 0, y: -h / 2 - enterH / 2 - 0.022, z: 0.01 });
        enterBtn.addEventListener('click', function (evt) {
          if (evt && evt.stopPropagation) evt.stopPropagation();
          // Sealed door: say so, don't fail silently (index.html's VR_ROOMS).
          if (window.VR_ROOMS === false) return window.VRNotice.comingSoonRooms();
          if (this.detail) window.VRProjectRoom.enter(this.detail.data);
        }.bind(this));
        this.el.appendChild(enterBtn);
      }
      this._onEnter = this.wake.bind(this, true);
      this._onLeave = this.wake.bind(this, false);
      this.el.addEventListener('mouseenter', this._onEnter);
      this.el.addEventListener('mouseleave', this._onLeave);

      // Tiny idle drift, disabled under reduced-motion (§4, §8).
      if (!reducedMotion) {
        var basePos = this.el.object3D.position;
        this.el.setAttribute('animation__drift', {
          property: 'position', dir: 'alternate',
          dur: 4000 + Math.random() * 2000, easing: 'easeInOutQuad', loop: true,
          to: basePos.x + ' ' + (basePos.y + 0.022) + ' ' + basePos.z
        });
      }
    },

    // Small helper to create a positioned troika-text child. Records it (with
    // its base opacity) so the dim lerp can fade it with the rest of the card.
    // Copy the piece's PDF URL, with the button itself reporting the outcome —
    // there's no status bar in here to put a toast in.
    //
    // navigator.clipboard is not reliably available inside an immersive WebXR
    // session (no transient activation, and some browsers gate it on document
    // focus the headless XR compositor doesn't grant), so this deliberately
    // does NOT assume success: it awaits the promise and shows "Copied" or
    // falls back to displaying the URL so it can at least be read aloud/typed.
    _copyPdfLink: function (btnEl) {
      var d = this.detail && this.detail.data;
      var pdf = d && d.pdf;
      function say(msg) {
        btnEl.setAttribute('ui-button', 'label', msg);
        setTimeout(function () { btnEl.setAttribute('ui-button', 'label', '⧉ Link'); }, 2200);
      }
      if (!pdf) return say('No PDF');
      var url = new URL(pdf, location.origin).href;
      if (!navigator.clipboard || !navigator.clipboard.writeText) return say('Copy N/A');
      navigator.clipboard.writeText(url).then(function () { say('✓ Copied'); })
        .catch(function () { say('Copy blocked'); });
    },

    _text: function (attrs, x, y, z, litOpts) {
      var t = document.createElement('a-entity');
      t.setAttribute('troika-text', attrs);
      t.setAttribute('position', { x: x, y: y, z: z != null ? z : 0.012 });
      this._textEls.push({ el: t, base: attrs.fillOpacity != null ? attrs.fillOpacity : 1 });
      // Every card's text — captions, tags, titles, experience roles — is lit
      // by the shared key-light rack rather than troika's default unlit flat
      // material. One call point here covers every hub-panel instance.
      VRGlass.lightTroikaText(t, attrs.color, litOpts);
      return t;
    },

    // Unmistakable, not subtle (VR_BUGFIX_NOTES.md item 3) — a firmer scale
    // pop (was 1.03, easy to miss) plus the shader's own brighten (uHover).
    wake: function (on) {
      // A card that is turned over, or mid-turn, is being READ — not hovered
      // (card-flip.js). This matters because wake() drives an animation on
      // SCALE and the flip drives scale too, so they fight:
      //
      //   In a headset a pinch is one event burst — xr-select.js emits
      //   mouseenter, click, then mouseleave within a few frames. The click
      //   starts the flip; the mouseleave that lands immediately after would
      //   setAttribute a FRESH scale animation to '1 1 1', which A-Frame starts
      //   un-paused, and it drags the card back to its glance size while the
      //   flip is still flying it toward the reader.
      //
      //   The same thing happens on desktop, just less obviously: the card
      //   grows and flies at you, so the pointer falls off it and mouseleave
      //   fires a beat later.
      if (this.el.__flipped || this.el.__flipTween) return;
      this._hoverTarget = on ? 1 : 0;
      this.el.setAttribute('animation__hover', {
        property: 'scale', dur: 160, easing: 'easeInOutQuad',
        to: on ? '1.07 1.07 1.07' : '1 1 1'
      });
      // Same untilt as ui-button's arrow badge (rotate(-45deg) -> rotate(0deg)
      // on hover) — see the arrowHint schema comment.
      if (this._hintBadgeEl) {
        this._hintBadgeEl.setAttribute('animation__hint', {
          property: 'rotation', dur: 260, easing: 'easeInOutQuad',
          to: '0 0 ' + (on ? VRArrowGlyph.hoverDeg : VRArrowGlyph.restDeg)
        });
      }
    },

    // Recedes GENTLY into the background while another card is focused in the
    // stage — a light dim that keeps surrounding cards clearly visible, not the
    // heavy near-black wash the earlier selection modal applied (ISSUE-08).
    // 0.5 (not full 1.0) so the uDim shader effect only partway darkens/fades.
    dim: function (on) {
      this._dimTarget = on ? 0.5 : 0;
    },

    tick: function (time, delta) {
      var k = Math.min(1, (delta || 16) / 140);
      if (Math.abs(this._hover - this._hoverTarget) >= 0.001) {
        this._hover += (this._hoverTarget - this._hover) * k;
        this.material.uniforms.uHover.value = this._hover;
      }
      if (this._dimTarget != null && Math.abs(this._dim - this._dimTarget) >= 0.001) {
        this._dim += (this._dimTarget - this._dim) * k;
        this.material.uniforms.uDim.value = this._dim;
        if (this.imgMesh) this.imgMesh.material.uniforms.uDim.value = this._dim;
        // Fade the caption/label text along with the glass (down to ~30% at
        // full dim) so a receded card reads as one unit, not bright text
        // hovering over a dim panel.
        for (var t = 0; t < this._textEls.length; t++) {
          var te = this._textEls[t];
          te.el.setAttribute('troika-text', 'fillOpacity', te.base * (1 - this._dim * 0.7));
        }
      }
    },

    remove: function () {
      this.el.removeObject3D('panel-mesh');
      if (this.imgMesh) this.el.removeObject3D('panel-image');
      this.el.removeEventListener('click', this._onClick);
      this.el.removeEventListener('mouseenter', this._onEnter);
      this.el.removeEventListener('mouseleave', this._onLeave);
    }
  });
})();
