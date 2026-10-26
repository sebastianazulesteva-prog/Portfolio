/* ═══ MORE PROJECTS, FROM ONE SOURCE ═══
   Every project page ends with a "More Projects" strip. It used to be typed
   out by hand on each page, so a new project (Loading, RBV) appeared on none
   of them until someone edited all thirteen. He asked for it to "just show
   whatever projects they are not on", with no per-page code.

   So the strip is now derived from the one place projects are listed: the
   #projects grid on index.html (the same grid /vr scrapes). This script
   fetches index.html, reads its cards and quick links, drops the page you are
   on, and rebuilds the strip:

   - Order: anything tagged "Ongoing" first, then the home grid's own order
     (featured cards, then the More Projects drawer).
   - Cards: as many as the page already showed, so each page keeps its layout
     (4 on most, 5 on the writing samples). The rest become pills.
   - Pills: the remaining projects, then index's quick links, then any pill
     the page had that is not a project on index (The Dome, which index links
     from its nav rather than its grid).
   - Media: a card's <img> is reused; a <video> card shows its poster as a
     still when it has one (RBV), and otherwise plays the same muted loop
     (Slip Door).

   The hand-written strip stays in each page as the fallback: if the fetch
   fails (no JS, file://, offline), visitors see that instead. Each page
   styles .mini-card and .quick-link-mini itself, so this only writes markup.
   ES5 on purpose, like the rest of the site's scripts. */
(function () {
  var wrap = document.querySelector('.more-projects');
  if (!wrap || !window.fetch || !window.DOMParser) return;
  var grid = wrap.querySelector('.more-projects-grid');
  if (!grid) return;
  var pillRow = wrap.querySelector('.quick-links-row');

  function base(href) { return (href || '').split('#')[0].split('?')[0].split('/').pop(); }
  // Pages answers /rbv as well as /rbv.html, so "which page am I on" compares
  // names without the extension. On /rbv the page used to list itself.
  function key(href) { return base(href).replace(/\.html$/, '') || 'index'; }
  var here = key(location.pathname);
  var cardCount = grid.querySelectorAll('.mini-card').length || 4;
  var localPills = pillRow ? Array.prototype.slice.call(pillRow.querySelectorAll('a.quick-link-mini')) : [];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Drawn, not the U+2197 character: iOS renders that as a blue-box emoji.
  // Same markup as the static arrows in the pages themselves.
  var ARROW_SVG = '<svg class="arrow-glyph" width="0.95em" height="0.95em" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="vertical-align:-0.08em"><path d="M4 12 12 4M5.5 4H12v6.5"/></svg>';
  function arrow(cls) {
    var e = el('span', cls);
    e.innerHTML = ARROW_SVG;
    return e;
  }

  fetch('index.html', { credentials: 'same-origin' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var section = doc.querySelector('#projects');
      if (!section) return;

      var cards = Array.prototype.slice.call(section.querySelectorAll('a.work-card')).map(function (a, i) {
        var tag = (a.querySelector('.work-card-tag') || {}).textContent || '';
        return {
          href: base(a.getAttribute('href')),
          title: ((a.querySelector('.work-card-title') || {}).textContent || '').trim(),
          tag: tag.trim(),
          ongoing: /ongoing/i.test(tag),
          media: a.querySelector('img, video'),
          order: i
        };
      }).filter(function (p) { return p.href && key(p.href) !== here; });

      cards.sort(function (a, b) { return (b.ongoing - a.ongoing) || (a.order - b.order); });

      var quick = Array.prototype.slice.call(section.querySelectorAll('a.quick-link')).map(function (a) {
        return { href: base(a.getAttribute('href')), title: ((a.querySelector('.quick-link-title') || {}).textContent || '').trim() };
      }).filter(function (q) { return q.href && key(q.href) !== here; });

      if (!cards.length) return;

      // ── Cards ──
      var frag = document.createDocumentFragment();
      cards.slice(0, cardCount).forEach(function (p) {
        var a = el('a', 'mini-card');
        a.href = p.href;
        var m = p.media, media;
        if (m && m.tagName === 'VIDEO' && !m.getAttribute('poster')) {
          media = document.importNode(m, true);
          media.muted = true;
          media.removeAttribute('class');
        } else if (m) {
          media = el('img');
          media.src = m.tagName === 'VIDEO' ? m.getAttribute('poster') : m.getAttribute('src');
          media.alt = m.getAttribute('alt') || m.getAttribute('aria-label') || '';
          if (m.getAttribute('width')) media.width = +m.getAttribute('width');
          if (m.getAttribute('height')) media.height = +m.getAttribute('height');
          media.loading = 'lazy';
        }
        if (media) a.appendChild(media);
        a.appendChild(arrow('mini-card-arrow'));
        var info = el('div', 'mini-card-info');
        info.appendChild(el('p', 'mini-card-title', p.title));
        info.appendChild(el('span', 'mini-card-tag', p.tag));
        a.appendChild(info);
        frag.appendChild(a);
      });
      grid.innerHTML = '';
      grid.appendChild(frag);
      grid.querySelectorAll('video').forEach(function (v) {
        var pr = v.play && v.play(); if (pr && pr.catch) pr.catch(function () {});
      });

      // ── Pills ──
      var known = {};
      cards.forEach(function (p) { known[p.href] = 1; });
      quick.forEach(function (q) { known[q.href] = 1; });
      var pills = cards.slice(cardCount).map(function (p) { return { href: p.href, title: p.title }; })
        .concat(quick)
        .concat(localPills.filter(function (a) {
          var h = base(a.getAttribute('href'));
          return h && key(h) !== here && !known[h] && key(h) !== 'index';
        }).map(function (a) {
          return { href: base(a.getAttribute('href')), title: a.textContent.trim() };
        }));
      if (!pillRow) { pillRow = el('div', 'quick-links-row'); wrap.appendChild(pillRow); }
      pillRow.innerHTML = '';
      pills.forEach(function (q) {
        var a = el('a', 'quick-link-mini', q.title + ' ');
        a.href = q.href;
        a.appendChild(arrow(null));
        pillRow.appendChild(a);
      });
    })
    .catch(function () { /* keep the hand-written fallback */ });
})();
