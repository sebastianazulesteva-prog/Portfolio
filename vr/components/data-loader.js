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

  function parseExperience(doc) {
    var items = Array.prototype.slice.call(doc.querySelectorAll('.exp-item'));
    if (!items.length) throw new Error('.exp-item not found — experience.html markup may have changed');
    return items.map(function (item) {
      var companyEl = item.querySelector('.exp-company');
      var bullets = Array.prototype.slice.call(item.querySelectorAll('.exp-bullets li')).map(textOf);
      return {
        company: textWithout(companyEl, '.exp-company-arrow'),
        companyHref: companyEl ? companyEl.getAttribute('href') : null,
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
        var ownImages = Array.prototype.slice.call(doc.querySelectorAll('img'))
          .filter(function (img) { return !img.closest('a'); })
          .map(function (img) { return { src: rootHref(img.getAttribute('src')), alt: (img.getAttribute('alt') || '').trim() }; })
          .filter(function (im) {
            if (!im.src || im.src === project.image || seenSrc[im.src]) return false;
            seenSrc[im.src] = true; return true;
          });
        // { src, alt } now — the room shows a short caption under each image.
        project.roomImages = ownImages.slice(0, 4);
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
  function buildImageCatalog(lists, projects) {
    var byStem = {};
    projects.forEach(function (p) {
      var stem = (p.href || '').replace(/^\//, '').split('.')[0].split('-')[0];
      if (stem) byStem[stem] = p.title;
    });
    var seen = {}, out = [];
    lists.forEach(function (list) {
      (list || []).forEach(function (im) {
        if (!im.src || seen[im.src]) return;
        seen[im.src] = true;
        var file = im.src.split('/').pop();
        var stem = file.split('-')[0].split('.')[0];
        out.push({ src: im.src, alt: im.alt, project: byStem[stem] || null });
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

  function load() {
    return loadManifest().then(function (manifest) {
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
          var images = buildImageCatalog(imageLists, withBlurbs);
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
