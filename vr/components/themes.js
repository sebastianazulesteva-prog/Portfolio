/* ═══ themes.js ═══
   Project room palettes (§6/§7 of VR_BUILD_SPEC.md) — pulled directly from
   each project's own page :root custom properties, not invented. Keyed by
   the `theme` field set in projects.json (see mergeProjectsWithManifest in
   data-loader.js). Falls back to a neutral dark theme for anything unmapped.

   Each theme: { sky, horizon, accent, panel, ink } — sky/horizon repaint the
   dome (see dome.js's setTheme), accent tints panel rims/lines, panel/ink
   are for any 2D-ish surfaces later.
*/

(function () {
  window.VRThemes = {
    pendant: { // Graduation Pendant — bright silver gallery (pendant.html --bg/--bg-panel/--ink)
      sky: '#3a3a38', horizon: '#f7f6f3', accent: '#d8c9a0', panel: '#f7f6f3', ink: '#161513'
    },
    slipdoor: { // The Slip Door — clean automotive/accessible (slipdoor.html --vwblue/--gold/--ink)
      sky: '#0d1b20', horizon: '#0091c8', accent: '#cdeffa', panel: '#141414', ink: '#e3f6fc'
    },
    baston: { // Bastón — warm personal craft (baston.html --pink/--pink-deep/--cream)
      sky: '#1c0e16', horizon: '#b8066c', accent: '#e30887', panel: '#221018', ink: '#f4efe9'
    },
    timecollector: { // Time Collector — warm brass/marble/timekeeping (timecollector.html --brass/--copper/--ink)
      sky: '#1a1408', horizon: '#a15c3e', accent: '#b8863b', panel: '#1a1408', ink: '#f6e3bd'
    },
    chess: { // Poser Chess Set — stark monochrome (chess.html --bg/--white)
      sky: '#000000', horizon: '#0e0e0e', accent: '#f7f5f0', panel: '#0e0e0e', ink: '#f7f5f0'
    },
    // Shared by the four PDF write-up pages (glasses, HP's Reckoning,
    // Algorithmic Modeling, Social Engineering) — checked their real :root
    // tokens directly and all four are identical (--bg/--bg-panel/--white),
    // matching VR_BUILD_SPEC.md §6's "Glasses / essays: signature dark" row.
    // A warm parchment accent (not reused from any other theme) keeps them
    // feeling distinct from the base dome without inventing new brand color.
    signatureDark: {
      sky: '#050505', horizon: '#111111', accent: '#c9c0ac', panel: '#111111', ink: '#e8e8e8'
    },
    _default: {
      sky: '#050505', horizon: '#3a2418', accent: '#b8863b', panel: '#161514', ink: '#f5f5f0'
    }
  };

  window.VRThemes.get = function (key) {
    return window.VRThemes[key] || window.VRThemes._default;
  };
})();
