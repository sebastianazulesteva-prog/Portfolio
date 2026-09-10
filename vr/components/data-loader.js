/* ═══ data-loader.js ═══
   Pulls everything the dome needs straight from the live site (§5 of
   VR_BUILD_SPEC.md) — nothing here is hand-duplicated content. Builds three
   datasets: bio (home panel text), projects, and experience. Falls back to
   vr/projects.json (enrichment only — model/theme/accent) if the live pages
   can't be reached or their markup has changed; never crashes the scene.

   Usage: VRData.load().then(function (data) {
     data.bio         -> { paragraphs: [{ text, linkHref, linkLabel }] }
     data.projects    -> [{ href, title, image, tags, featured, accent, model, theme }]
     data.experience  -> [{ company, companyHref, date, role, bullets }]
   })
*/

(function () {
  function textOf(el) { return el ? el.textContent.trim() : ''; }
  // Same as textOf, but drops descendants matching `selector` first — for
  // elements like .exp-company that wrap a purely decorative child (the
  // hover-only .exp-company-arrow "↗", CSS-rotated on :hover) inside the same
  // node whose text IS the real content. A plain textOf() bakes that glyph
  // into the scraped string, e.g. "Maker Nexus↗" as a literal company name.
  function textWithout(el, selector) {
    if (!el) return '';
    var clone = el.cloneNode(true);
    clone.querySelectorAll(selector).forEach(function (n) { n.remove(); });
    return clone.textContent.trim();
  }
  function rootHref(href) {
    if (!href) return href;
    return '/' + href.replace(/^\.?\//, '').replace(/^https?:\/\/[^/]+\//, '');
  }

  function parseBio(doc) {
    var paragraphs = Array.prototype.slice.call(doc.querySelectorAll('#about .about-text p')).map(function (p) {
      var link = p.querySelector('a');
      return {
        text: textOf(p),
        linkHref: link ? rootHref(link.getAttribute('href')) : null,
        linkLabel: link ? textOf(link) : null
      };
    });
    var stats = Array.prototype.slice.call(doc.querySelectorAll('#about .stat-row')).map(function (row) {
      return {
        label: textOf(row.querySelector('.stat-label')),
        value: textOf(row.querySelector('.stat-value'))
      };
    });
    // The flat site hides a fuller skills breakdown behind its "+ View more
    // skills" button (.skills-expand-panel). Same content, same source — the
    // VR bio card opens it as a panel to the right of the Skills row.
    var skillGroups = Array.prototype.slice.call(doc.querySelectorAll('#about .skills-expand-group')).map(function (g) {
      return {
        label: textOf(g.querySelector('.stat-label')),
        value: textOf(g.querySelector('.stat-value'))
      };
    });
    return { paragraphs: paragraphs, stats: stats, skillGroups: skillGroups };
  }

  function parseCard(card, featured) {
    var img = card.querySelector('img');
    var video = card.querySelector('video');
    var titleEl = card.querySelector('.work-card-title');
    var tagEl = card.querySelector('.work-card-tag');

    return {
      href: rootHref(card.getAttribute('href')),
      title: textOf(titleEl),
      // Root-resolved, not left relative — this page lives at /vr/, one
      // level below the image paths (which are relative to /index.html).
      image: img ? rootHref(img.getAttribute('src')) : null,
      alt: img ? (img.getAttribute('alt') || '') : (video ? (video.getAttribute('aria-label') || '') : ''),
      // The hero's own aspect, read off the card's width/height attributes —
      // present on every card, and on Slip Door's <video> too (1280x720, the
      // same 16:9 as the projects.json image override it falls back to). The
      // project room sizes its hero to this, and it has to come from here:
      // VRGlass.loadTexture deliberately does not cache, so probing the file
      // for its natural size would download and decode it twice and leave a
      // second Texture with no owner to dispose it. Heroes range from 3:4
      // (pendant) to 16:9 (slipdoor), and the room's shader COVER-fits — so
      // without a real aspect a portrait hero loses ~44% of its height, which
      // on the pendant means cropping the chain off it.
      imageW: Number((img || video || {}).getAttribute && (img || video).getAttribute('width')) || null,
      imageH: Number((img || video || {}).getAttribute && (img || video).getAttribute('height')) || null,
      // A card whose hero is a <video> rather than an <img> — Slip Door's is
      // the door actually sliding open, which is the entire point of the
      // project and the one thing a still cannot show. Every source is kept so
      // the room can hand the browser the same list the flat page does (webm
      // first, mp4 fallback) instead of guessing a codec.
      video: video ? {
        sources: Array.prototype.slice.call(video.querySelectorAll('source')).map(function (s) {
          return { src: rootHref(s.getAttribute('src')), type: s.getAttribute('type') || '' };
        })
      } : null,
      tags: textOf(tagEl).split('·').map(function (s) { return s.trim(); }).filter(Boolean),
      featured: featured
    };
  }

  // The "quick links" are real project / writing-sample pages listed in
  // #projects without a hero image (see index.html's .quick-link blocks) —
  // HP's Reckoning, Algorithmic Modeling, the glasses frames, etc. They're
  // still projects: one card (image-less → renders as a text card) and, later,
  // a room + link-line each. Parsed here so every href in #projects flows in.
  function parseQuickLink(a) {
    return {
      href: rootHref(a.getAttribute('href')),
      title: textOf(a.querySelector('.quick-link-title')),
      image: null,
      alt: '',
      tags: textOf(a.querySelector('.quick-link-tag')).split('·').map(function (s) { return s.trim(); }).filter(Boolean),
      featured: false
    };
  }

  function parseProjects(doc) {
    var section = doc.querySelector('#projects');
    if (!section) throw new Error('#projects section not found — site markup may have changed');
    var mainGrid = section.querySelector('.work-grid');
    var extraGrid = section.querySelector('.work-grid-extra');
    if (!mainGrid) throw new Error('.work-grid not found inside #projects');

    var featuredCards = Array.prototype.slice.call(mainGrid.querySelectorAll(':scope > a.work-card'));
    var extraCards = extraGrid ? Array.prototype.slice.call(extraGrid.querySelectorAll('a.work-card')) : [];
    var quickLinks = Array.prototype.slice.call(section.querySelectorAll('.quick-link'));

    return featuredCards.map(function (c) { return parseCard(c, true); })
      .concat(extraCards.map(function (c) { return parseCard(c, false); }))
      .concat(quickLinks.map(parseQuickLink));
  }

  // '/images/logos/<hostname>.png' for an absolute http(s) link, else null.
  // Parsed with URL rather than a regex so a link with a port, credentials or
  // an unusual scheme can't produce a path that half-resolves.
  function hostLogo(href) {
    if (!href) return null;
    try {
      var u = new URL(href, location.origin);
      if (!/^https?:$/.test(u.protocol) || !u.hostname) return null;
      return '/images/logos/' + u.hostname + '.png';
    } catch (e) { return null; }
  }

  function parseExperience(doc) {
    var items = Array.prototype.slice.call(doc.querySelectorAll('.exp-item'));
    if (!items.length) throw new Error('.exp-item not found — experience.html markup may have changed');
    return items.map(function (item) {
      var companyEl = item.querySelector('.exp-company');
      var bullets = Array.prototype.slice.call(item.querySelectorAll('.exp-bullets li')).map(textOf);
      var href = companyEl ? companyEl.getAttribute('href') : null;
      return {
        company: textWithout(companyEl, '.exp-company-arrow'),
        companyHref: href,
        // ── The company mark, DERIVED, never mapped ────────────────────────
        // Each job on experience.html already links to its own organisation, so
        // the organisation is already named on the page — by its hostname,
        // which is the one identifier that cannot drift the way a display name
        // can ("Stanford University - Comparative Medicine" vs "Stanford").
        // So the logo path is the hostname, and there is no table anywhere
        // saying which company gets which picture. Adding a job to the flat
        // page and dropping `<hostname>.png` into /images/logos is the whole
        // workflow; a missing file simply means no mark (hub-panel skips it).
        //
        // Four Stanford orgs therefore carry four identical copies of the
        // Stanford mark rather than sharing one through an alias table. That is
        // the deliberate trade: 4 × 9 KB against a hand-written map, in a
        // codebase whose rule 5 is that content is derived and never listed.
        // It is also what those four sites actually serve as their own icon.
        logo: hostLogo(href),
        date: textOf(item.querySelector('.exp-date')),
        role: textOf(item.querySelector('.exp-role')),
        bullets: bullets
      };
    });
  }

  // Pulls a short blurb + the project's own gallery images straight from its
  // own page — feeds the project room (§7), which wants to feel like a
  // themed surround world holding "the project's images", not just the one
  // card hero. Never blocks: any failure just leaves blurb/images empty.
  //
  // Image scoping: every project page also links to a couple of OTHER
  // projects at the bottom ("more like this") — those thumbnails are always
  // wrapped in an <a href="other-project.html">. A project's own gallery
  // images never are. So "any <img> not inside an <a>" reliably separates
  // real gallery photos from cross-links, without needing to match each
  // page's own one-off class names (hero-img-wrap, process-grid, img-slot,
  // collage-grid... — checked all five image-heavy project pages, no single
  // class name is shared by all of them, but the <a>-wrapping rule is).
  // ── Story stations ────────────────────────────────────────────────────────
  // The project room walks you round a circle, one station per phase of the
  // build. The GROUPING is derived from the page, never authored here: each
  // page already says which photos belong together, by putting them in one
  // container, and already names the phase, in the nearest section heading.
  // Measured across the five image-bearing pages:
  //
  //   pendant   4 x .img-slot, separately headed "Wax 3D Print",
  //             "Lost-Wax Casting", "Hand-Finishing" — a ready-made sequence
  //   slipdoor  .idea-imgs (2) under "Idea + Building", .result-gif-wrap (1)
  //             under "Result"
  //   baston    .hero-img-wrap (1), .process-grid (4), one loose
  //   timecoll. .frame (2), .process-grid (4)
  //   chess     .img-slot (2), "Ideation" (1), "Prototyping" .collage-grid (4)
  //
  // Hand-listing "these three go together" per project would be exactly the
  // content duplication the build guide's rule 5 forbids — and it would go
  // stale the first time a page is re-edited. This reads the page's own answer.
  // `.process-card` is listed alongside the grids on purpose, and closest()
  // resolves to the NEAREST ancestor, so a card beats the grid containing it.
  // That matters: on Bastón and Time Collector each image sits in its own
  // .process-card carrying its own .process-tag ("Rapid prototype & sketches",
  // "Sketching & Ideation"), so the card — not the grid — is the labelled unit.
  // Grouping by the grid instead produced one anonymous 4-image blob and threw
  // those captions away, which is the opposite of a narrative walk.
  var GROUP_SEL = '.process-card,.idea-imgs,.process-grid,.collage-grid,.img-grid,' +
                  '.photo-grid,.frame,.hero-img-wrap,.result-gif-wrap,.img-slot,figure';
  var SECTION_SEL = '.block,.step,.journey-step,section';
  // Checked INSIDE the group box first, then the enclosing section. The pages
  // label at both levels and the inner one is more specific: chess names a
  // phase per section ("Ideation", "Prototyping") while Bastón names a step per
  // card, and only looking at sections finds the first but not the second.
  var BOX_LABEL_SEL = '.process-tag,figcaption,h4,h3';
  var HEADING_SEL = '.block-label,.step-body h3,.journey-heading,h3,h2';

  // ── Station BODY copy ─────────────────────────────────────────────────────
  // Sebastian, on the rooms: *"add descriptive text pulled from existing web
  // page copy; expand over time."* A station already carries the page's phase
  // NAME; this is the page's phase PROSE, so a room reads as the project page
  // does rather than as a caption sheet.
  //
  // Same discipline as the label: found on the page, never typed here (rule 5),
  // and looked for from the most specific container outwards.
  //   1. a <p> inside the image's own box — the tightest possible scope
  //   2. the enclosing section's body paragraphs (chess/pendant `.step-body p`,
  //      slipdoor `.block-body p`), joined when a block has more than one
  //   3. nothing — and "nothing" is the honest answer for two of the five
  //      rooms. Bastón and Time Collector have `.process-card`s carrying a tag
  //      and an image and no prose at all, so their stations show a heading and
  //      a photograph. `expand over time` is exactly this: add a <p> to a
  //      process card on the flat page and it appears in the room on next load,
  //      with no change here.
  //
  // The alt text is deliberately NOT a fallback. It is a description of the
  // PICTURE written for someone who cannot see it, and in a room the visitor is
  // looking straight at the picture — so it lands as a redundant narration of
  // what is plainly in front of them, in the one place the page had nothing to
  // say. It is already the photo-cloud's caption, where the tile floats alone
  // and that job is the right one.
  var BODY_SEL = '.step-body p,.block-body p';
  // Two short paragraphs of a project page run past what a station can carry at
  // arm's length without becoming the thing you stand and read. Measured
  // against the real copy: the longest single source paragraph on the five
  // pages is slipdoor's 168 characters, and its block has two — so the cap only
  // ever bites on a join, which is the case where the second paragraph is the
  // expendable one.
  var BODY_MAX = 260;

  function trimTo(s, max) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    // Prefer a sentence end, then a word boundary — never a mid-word cut.
    var cut = s.slice(0, max);
    var stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    if (stop > max * 0.5) return cut.slice(0, stop + 1);
    return cut.replace(/[\s,;:]+\S*$/, '') + '…';
  }

  function bodyFor(box, sec) {
    var own = box && box.querySelector('p');
    if (own && textOf(own)) return trimTo(textOf(own), BODY_MAX);
    if (!sec) return '';
    var ps = Array.prototype.slice.call(sec.querySelectorAll(BODY_SEL)).map(textOf)
      .filter(function (s) { return !!s; });
    return ps.length ? trimTo(ps.join('  '), BODY_MAX) : '';
  }

  // A run short of target SPLITS its largest mosaic, in document order, so the
  // page's grouping is the starting point without being the ceiling. Adjacent
  // halves keep the same heading, which reads as one phase spanning two
  // positions rather than as a mislabel.
  //
  // TARGET 4 and MIN_SPLIT 4 are both measured choices, not guesses. At target
  // 5 the splitter ate every mosaic: the usable image counts are 3/2/5/5/7 (all
  // the photography these pages have, once the hero and the "more like this"
  // cross-links are excluded — verified that every <a>-wrapped image on all
  // five pages points at another project), so chasing 5 stations drove Bastón
  // and Time Collector to five stations of one image each, which is precisely
  // the mosaic idea deleted. Refusing to split anything under 4 keeps pairs
  // together, and 4 is reachable without doing so in most rooms.
  var STATION_TARGET = 4;
  var MIN_SPLIT = 4;

  function stationsFrom(imgEls) {
    if (!imgEls.length) return [];

    // 1. group by the nearest deliberate image container, in document order
    var groups = [];
    var byNode = [];   // parallel array of container nodes, for identity
    imgEls.forEach(function (img) {
      var box = img.closest(GROUP_SEL) || img.parentElement;
      var own = box.querySelector(BOX_LABEL_SEL);
      var sec = img.closest(SECTION_SEL);
      var head = sec && sec.querySelector(HEADING_SEL);
      var label = textOf(own) || (head ? textOf(head) : '');
      var body = bodyFor(box, sec);
      var i = byNode.indexOf(box);
      if (i === -1) {
        byNode.push(box);
        groups.push({ label: label, body: body, images: [] });
        i = groups.length - 1;
      }
      // First non-empty heading wins — a container spanning two sections keeps
      // the phase it starts in rather than flipping to the later one.
      if (!groups[i].label && label) groups[i].label = label;
      if (!groups[i].body && body) groups[i].body = body;
      groups[i].images.push({
        src: rootHref(img.getAttribute('src')),
        alt: (img.getAttribute('alt') || '').trim()
      });
    });

    // 2. split the largest mosaic until there are enough stations, or until
    //    everything is a single image and there is nothing left to split
    while (groups.length < STATION_TARGET) {
      var big = -1, bigN = MIN_SPLIT - 1;
      groups.forEach(function (g, i) { if (g.images.length > bigN) { bigN = g.images.length; big = i; } });
      if (big === -1) break;   // nothing large enough left to split without eating a mosaic
      var half = Math.ceil(groups[big].images.length / 2);
      var tail = groups[big].images.splice(half);
      // The body follows the label for the same reason: two halves of one
      // mosaic are one phase shown in two positions, not two phases.
      groups.splice(big + 1, 0, { label: groups[big].label, body: groups[big].body, images: tail });
    }

    return groups;
  }

  function fetchRoomContent(project) {
    return fetch(project.href, { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        // The essay/PDF write-up pages (glasses, HP's Reckoning, Algorithmic
        // Modeling, Social Engineering) use a plain h1+h2 template instead of
        // .hero-sub/.hero-caption — the h2 "Key topics: ..." line is their
        // closest equivalent to a blurb.
        var sub = doc.querySelector('.hero-sub') || doc.querySelector('.hero-caption') || doc.querySelector('h2');
        project.blurb = sub ? textOf(sub) : null;

        var seenSrc = {};
        var ownEls = Array.prototype.slice.call(doc.querySelectorAll('img'))
          .filter(function (img) { return !img.closest('a'); })
          .filter(function (img) {
            var src = rootHref(img.getAttribute('src'));
            if (!src || src === project.image || seenSrc[src]) return false;
            seenSrc[src] = true; return true;
          });
        var ownImages = ownEls.map(function (img) {
          return { src: rootHref(img.getAttribute('src')), alt: (img.getAttribute('alt') || '').trim() };
        });
        // No longer capped at 4 — the room walks you through ALL of a project's
        // photography now, grouped into stations (below).
        project.roomImages = ownImages;
        project.roomStations = stationsFrom(ownEls);
        project.pageImgs = imgsFromDoc(doc); // all images on this page, for the global catalog

        // The write-up projects (HP's Reckoning, Algorithmic Modeling,
        // 3D-Printed Glasses Frames, Social Engineering, Apple's Medical
        // Licensure) are a PDF embedded in an <iframe> plus a download link.
        // Scraped rather than hand-listed in projects.json for the same reason
        // as everything else here: the flat page stays the single source of
        // truth, so renaming a PDF can't silently break the VR reader.
        // Checked in the order the pages actually use: iframe/embed src first,
        // then any explicit .pdf link.
        var pdfEl = doc.querySelector('iframe[src$=".pdf"], embed[src$=".pdf"], object[data$=".pdf"]');
        var pdfHref = pdfEl && (pdfEl.getAttribute('src') || pdfEl.getAttribute('data'));
        if (!pdfHref) {
          var pdfLink = doc.querySelector('a[href$=".pdf"]');
          pdfHref = pdfLink && pdfLink.getAttribute('href');
        }
        project.pdf = pdfHref ? rootHref(pdfHref) : null;
        // The document's own name, for the station heading in the room — taken
        // from the page's link text rather than typed into a VR file (rule 5),
        // and stripped of the decorative ↗ the same way .exp-company is.
        // "Also See FEA Analysis" -> "FEA Analysis": the leading call-to-action
        // is addressed to a reader who is already ON the flat page, and in the
        // room it would read as an instruction rather than as a title.
        var pdfA = doc.querySelector('a[href$=".pdf"]');
        var pdfLabel = pdfA ? textWithout(pdfA, '.process-link-arrow, [aria-hidden="true"]') : '';
        project.pdfLabel = pdfLabel
          ? pdfLabel.replace(/^\s*(also\s+see|see|read|view|download)\s+/i, '').replace(/\s+↗\s*$/, '').trim()
          : null;
        return project;
      })
      .catch(function () { project.blurb = null; project.roomImages = []; project.pageImgs = []; project.pdf = null; return project; });
  }

  // Every content <img> on a page, filtered to /images/ (skipping icons/
  // favicons), as { src, alt }. Feeds the Photo Cloud (§9). Deduped globally
  // in load(), not here.
  function imgsFromDoc(doc) {
    if (!doc) return [];
    return Array.prototype.slice.call(doc.querySelectorAll('img')).map(function (img) {
      return { src: rootHref(img.getAttribute('src')), alt: (img.getAttribute('alt') || '').trim() };
    }).filter(function (im) {
      return im.src && /\/images\//.test(im.src) &&
        !/favicon|android-chrome|apple-touch|-16x16|-32x32|-192x192|-512x512/.test(im.src);
    });
  }

  // Merge per-page image lists into one deduped catalog, tagging each with the
  // project it belongs to — inferred from the filename's leading token
  // matching a project href stem (baston-parts.jpg → baston.html → "Bastón").
  // Contact photos and anything unmatched keep project: null (caption is just
  // the alt text then).
  //
  // `meta` is vr/images.json keyed by bare file name — a per-image `caption`
  // that replaces the alt in the cloud, and an `exclude` flag. Both are read
  // HERE rather than in photo-cloud.js so that anything else consuming the
  // catalog later gets the same labels and the same exclusions; a tile the
  // cloud is told to skip should not reappear in the next surface that reads
  // this list. The alt is still carried through untouched on `alt`.
  function buildImageCatalog(lists, projects, meta) {
    meta = meta || {};
    var byStem = {}, byHref = {};
    projects.forEach(function (p) {
      var stem = (p.href || '').replace(/^\//, '').split('.')[0].split('-')[0];
      if (stem) byStem[stem] = p.title;
      if (p.href) byHref[p.href] = p.title;
    });
    var seen = {}, out = [];
    lists.forEach(function (list) {
      (list || []).forEach(function (im) {
        if (!im.src || seen[im.src]) return;
        seen[im.src] = true;
        var file = im.src.split('/').pop();
        var m = meta[file] || {};
        if (m.exclude) return;
        // The project is inferred from the file name's leading token; `project`
        // in images.json is the escape hatch for the files that convention
        // misses (slide-1-sketch.png is Time Collector's), given as an href so
        // the title is still read off the live page rather than typed here.
        var stem = file.split('-')[0].split('.')[0];
        out.push({
          src: im.src, file: file, alt: im.alt,
          caption: m.caption || im.alt || '',
          project: (m.project && byHref[rootHref(m.project)]) || byStem[stem] || null
        });
      });
    });
    return out;
  }

  function mergeProjectsWithManifest(liveProjects, manifest) {
    var byHref = {};
    (manifest.projects || []).forEach(function (m) { byHref[rootHref(m.href)] = m; });
    return liveProjects.map(function (p) {
      var m = byHref[p.href];
      if (!m) return p;
      return Object.assign({}, p, {
        accent: m.accent || p.accent,
        model: m.model || null,
        theme: m.theme || null,
        // Image override for cards the flat page can't supply an <img> for
        // (Slip Door's hero is a <video>, so parseCard returns image:null).
        image: m.image || p.image,
        // Preserved through the merge: the manifest's `image` override exists
        // precisely BECAUSE this card is a video (Slip Door), so dropping the
        // video here would delete the thing the override was working around.
        video: p.video || null,
        // Highlight-rolloff strength for a glary hero (pendant on pure white).
        heroTone: m.heroTone || 0,
        manifestBlurb: m.blurb || null // manifest override, applied after the per-page blurb fetch resolves
      });
    }).filter(function (p) { return !p.hide; });
  }

  function loadManifest() {
    // no-store: unlike the versioned <script src="...?v=N"> component files,
    // this fetch has no cache-busting query param — without an explicit
    // no-store, browsers happily serve a stale cached copy indefinitely
    // (caught this in testing: edited the file on disk, the running page
    // kept serving an old version). projects.json is meant to reflect
    // Sebastian's edits on next load, not whenever the HTTP cache expires.
    return fetch('./projects.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .catch(function (err) { console.warn('[vr] projects.json unavailable:', err); return { projects: [] }; });
  }

  // The photo-cloud caption catalog (vr/images.json). Same no-store reasoning
  // as projects.json, and the same contract: enrichment over the scraped alt,
  // never a second copy of the content. Absent or malformed → every image keeps
  // its alt, which is the behaviour this file had before the catalog existed.
  function loadImageManifest() {
    return fetch('./images.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .catch(function (err) { console.warn('[vr] images.json unavailable:', err); return { images: {} }; });
  }

  function load() {
    return Promise.all([loadManifest(), loadImageManifest()]).then(function (manifests) {
      var manifest = manifests[0];
      var imageMeta = (manifests[1] && manifests[1].images) || {};
      return Promise.all([
        fetch('/index.html', { cache: 'no-store' }).then(function (r) { return r.text(); }),
        fetch('/experience.html', { cache: 'no-store' }).then(function (r) { return r.text(); }).catch(function () { return null; })
      ]).then(function (results) {
        var indexDoc = new DOMParser().parseFromString(results[0], 'text/html');
        var experienceDoc = results[1] ? new DOMParser().parseFromString(results[1], 'text/html') : null;
        var bio = parseBio(indexDoc);
        var projects = mergeProjectsWithManifest(parseProjects(indexDoc), manifest);
        var experience = experienceDoc ? parseExperience(experienceDoc) : [];

        return Promise.all(projects.map(fetchRoomContent)).then(function (withBlurbs) {
          withBlurbs.forEach(function (p) {
            if (p.manifestBlurb) p.blurb = p.manifestBlurb;
            delete p.manifestBlurb;
          });
          // Photo Cloud catalog: index + experience + every project page's
          // images, deduped and project-tagged.
          var imageLists = [imgsFromDoc(indexDoc), imgsFromDoc(experienceDoc)]
            .concat(withBlurbs.map(function (p) { return p.pageImgs || []; }));
          var images = buildImageCatalog(imageLists, withBlurbs, imageMeta);
          withBlurbs.forEach(function (p) { delete p.pageImgs; });
          return { bio: bio, projects: withBlurbs, experience: experience, images: images };
        });
      }).catch(function (err) {
        console.warn('[vr] live site parse failed, falling back to projects.json only:', err);
        return {
          bio: { paragraphs: [], stats: [] },
          projects: (manifest.projects || []).filter(function (p) { return !p.hide; }),
          experience: [],
          images: []
        };
      });
    });
  }

  window.VRData = { load: load };
})();
