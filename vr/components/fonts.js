/* ═══ fonts.js ═══
   Shared font file URLs for aframe-troika-text (§1 of VR_DESIGN_RESOURCES.md).
   Troika needs real font files (.ttf/.otf/.woff — not .woff2), so these are
   pulled from Fontsource's npm packages via jsDelivr, the same three families
   the flat site uses: Playfair Display (headlines), Syne (UI/body), and
   Atkinson Hyperlegible (a11y mode). Swap VRFonts.title/body when
   document.body.classList.contains('accessible') is true.
*/

(function () {
  var BASE = 'https://cdn.jsdelivr.net/npm/@fontsource';

  window.VRFonts = {
    playfair: BASE + '/playfair-display@5.3.0/files/playfair-display-latin-700-normal.woff',
    // Italic variant — only used by the home hub's surname line
    // (name-scatter-3d.js), matching the flat site's `.word.second { font-
    // style: italic }` treatment on "Esteva".
    playfairItalic: BASE + '/playfair-display@5.3.0/files/playfair-display-latin-400-italic.woff',
    syneBold: BASE + '/syne@5.3.0/files/syne-latin-700-normal.woff',
    syneRegular: BASE + '/syne@5.3.0/files/syne-latin-400-normal.woff',
    atkinsonBold: BASE + '/atkinson-hyperlegible@5.3.0/files/atkinson-hyperlegible-latin-700-normal.woff',
    atkinsonRegular: BASE + '/atkinson-hyperlegible@5.3.0/files/atkinson-hyperlegible-latin-400-normal.woff',

    // ── Per-project title faces (Sebastian, 2026-09-11: "different pages use
    // different text styles for projects, can we have that reflected in
    // project rooms") ──
    // Only the TITLE face varies, and only because that is the only thing that
    // actually varies on the flat site. Read off each page's own `.hero-title`
    // rule rather than its :root, which is what makes this faithful instead of
    // decorative — three of the five pages set `font-family:var(--serif)`
    // (Playfair, already the default here), so only two rooms change:
    //
    //   baston / pendant / chess   var(--serif)   Playfair Display 700
    //   timecollector              var(--script)  Fredericka the Great
    //   slipdoor                   (none set)     Poppins 900, -0.02em
    //
    // slipdoor declares no family at all on .hero-title, so it inherits the
    // body stack — Poppins — at weight 900. That absence IS its style: it is
    // the one project page with no display face, and the room should read that
    // way too rather than borrowing a serif it never had.
    fredericka: BASE + '/fredericka-the-great@5.3.0/files/fredericka-the-great-latin-400-normal.woff',
    poppinsBlack: BASE + '/poppins@5.3.0/files/poppins-latin-900-normal.woff',

    isA11y: function () { return document.body.classList.contains('accessible'); },
    title: function () { return this.isA11y() ? this.atkinsonBold : this.playfair; },

    // Resolve a theme's `titleFont` key (themes.js) to a file. Accessible mode
    // wins over the project's own face for the same reason it overrides
    // everywhere else — and it matters MORE here, because Fredericka the Great
    // is a rough decorative display face, which is exactly the kind of type
    // a11y mode exists to replace. An unknown or absent key falls back to
    // Playfair, so a new theme with no `titleFont` behaves as before.
    titleFor: function (key) {
      if (this.isA11y()) return this.atkinsonBold;
      return ({ serif: this.playfair, script: this.fredericka,
                sans: this.poppinsBlack })[key] || this.playfair;
    },
    body: function () { return this.isA11y() ? this.atkinsonRegular : this.syneRegular; },
    bodyBold: function () { return this.isA11y() ? this.atkinsonBold : this.syneBold; }
  };

  // ── The strict 3-size type scale (VR_POLISH_STANDARDS.md §5) ──
  // Exactly three in-scene text sizes used ANYWHERE — title (Playfair),
  // body (Syne), label/tag (Syne, smaller) — plus ONE documented exception,
  // `display`, used only by the hero name on the home panel (Sebastian's
  // explicit "make the name big" request). Any further hierarchy comes from
  // weight/colour/opacity/spacing and physical distance, never a fourth size.
  // a11yMode scales all sizes up together, keeping the same 3-tier ratios.
  var A11Y_MULT = 1.25;
  function m() { return document.body.classList.contains('accessible') ? A11Y_MULT : 1; }
  window.VRType = {
    title: function () { return 0.052 * m(); },
    body: function () { return 0.028 * m(); },
    label: function () { return 0.022 * m(); },
    // Hero name only — the single documented size exception, sized to nearly
    // fill the home top card's width. Its own gentle a11y bump (not the shared
    // ×1.25) so the accessible-mode name doesn't overflow the card edges.
    display: function () { return document.body.classList.contains('accessible') ? 0.214 : 0.21; },

    // Card GEOMETRY must scale by the same factor as the type, or accessible
    // mode is self-defeating: card sizes are authored in metres, so at ×1.25
    // type the content no longer fits — one experience card overflowed its own
    // edge by 18 mm, and the bio card's auto-fitter (whose job is making text
    // fit its card) responded by shrinking type 11.8%, netting about +4% where
    // there is the most text to read (VR_TEST_REPORT G7). Scaling width and
    // height by exactly the type multiplier keeps "it fit before" true.
    // GAPS are deliberately NOT scaled: they are empty space, and the projects
    // row gap (0.42) was sized for the caption + button footprint (~0.31 m),
    // which even at ×1.25 (~0.39 m) still clears it.
    cardMult: function () { return m(); }
  };
})();
