/**
 * Page + block renderers.
 *
 * Every page on the site is rendered from its content/pages/<id>.json by these
 * functions at build time. The markup they emit is byte-compatible with what
 * the old hand-authored panels / runtime renderers produced — same classes,
 * same ids, same attributes — so the existing stylesheet and the migrated
 * pages' #panel-<id> CSS keep working untouched.
 *
 * Translation: any string that was translated under the old system carries its
 * legacy key in the block's `i18n` map (written by scripts/migrate.mjs); the
 * renderer re-emits it as data-i18n. Strings without a legacy key get a
 * generated `page.<slug>.b<n>.<path>` key, which makes them translatable the
 * moment the translation provider is restored (phase 3) while changing
 * nothing today.
 *
 * Isomorphic rule: take `document`, touch no globals — the same code must run
 * under linkedom at build time and, if ever needed, in a browser.
 */

/* ---------- generic helpers ---------- */

const el = (document, tag, opts = {}) => {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.key) node.setAttribute('data-i18n', opts.key);
  return node;
};

/** Text with \n rendered as <br> (hero title, image labels). */
const multiline = (document, node, value) => {
  node.textContent = '';
  String(value ?? '').split('\n').forEach((line, i) => {
    if (i > 0) node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode(line));
  });
  return node;
};

/* Mirror of layout-model.js (the runtime's MarviLayout) — the maths the CMS
 * layout controls are defined by. Kept in sync by hand; it is 12 lines. */
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
export const photoLayout = (data = {}) => {
  const zoom = clamp(data.zoom, 50, 200, 100);
  return {
    x: clamp(data.positionX, 0, 100, 50),
    y: clamp(data.positionY, 0, 100, 50),
    scale: zoom / 100,
    fit: data.fit && data.fit !== 'auto' ? data.fit : 'cover'
  };
};
export const textLayout = (data = {}) => ({
  width: clamp(data.textWidth, 30, 100, 100),
  offsetX: clamp(data.textOffsetX, -30, 30, 0),
  offsetY: clamp(data.textOffsetY, -30, 30, 0)
});

/** Photo entry ({image, zoom, positionX, positionY, fit, alt}) → <img>. */
const photo = (document, entry = {}, { alt, lazy = true, className } = {}) => {
  const img = el(document, 'img', { class: className });
  if (entry.image) img.src = entry.image;
  img.alt = alt ?? entry.alt ?? '';
  if (lazy) img.setAttribute('loading', 'lazy');
  const layout = photoLayout(entry);
  if (layout.x !== 50 || layout.y !== 50) img.style.objectPosition = `${layout.x}% ${layout.y}%`;
  if (layout.scale !== 1) img.style.scale = String(layout.scale);
  if (entry.fit && entry.fit !== 'auto') img.style.objectFit = layout.fit;
  return img;
};

/* Titles carry no initial anyone would recognise, so a monogram for
 * "Dr Vanita Yadav" should read VY rather than DV. */
const NAME_TITLE = /^(dr|prof|professor|mr|mrs|ms|miss|a\/prof|assoc|associate|sir|em|emeritus)\.?$/i;

const initials = (name = '') =>
  name
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !NAME_TITLE.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '\u00b7';

/**
 * A researcher's portrait, or a monogram when nobody has uploaded one yet.
 *
 * The slot is always filled. The directory is a grid of equal cards, so a card
 * that quietly loses its picture re-flows the row around a hole no reader can
 * see — and an <img> with no src draws a broken box. A monogram reads as
 * "no photo yet", which is the truth, and keeps the grid intact.
 */
const portraitImage = (document, person = {}, { lazy = true } = {}) => {
  if (person.photo?.image) {
    return photo(document, person.photo, { alt: 'Portrait of ' + person.name, lazy });
  }
  const mark = el(document, 'span', { class: 'portrait-monogram', text: initials(person.name) });
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', person.name ? person.name + ' — no portrait yet' : 'No portrait yet');
  return mark;
};

/** The intro sizing/placement controls, applied to a head root at build time. */
const applyTextControls = (root, intro = {}) => {
  const scale = (sel, value) => {
    const node = root.querySelector(sel);
    if (node) node.setAttribute('data-cms-text-scale', String(clamp(value, 0, 200, 100)));
  };
  scale('.eyebrow', intro.eyebrowSize);
  scale('h1', intro.titleSize);
  scale('.lede', intro.ledeSize);
  if (['left', 'center', 'right'].includes(intro.textAlign)) {
    root.setAttribute('data-text-align', intro.textAlign);
  }
  if (['top', 'middle', 'bottom'].includes(intro.textPosition)) {
    root.setAttribute('data-text-position', intro.textPosition);
  }
  const layout = textLayout(intro);
  root.style.setProperty('--cms-text-width', layout.width + '%');
  root.style.setProperty('--cms-text-offset-x', layout.offsetX + '%');
  root.style.setProperty('--cms-text-offset-y', layout.offsetY + '%');
};

/** The page-head cover photo custom properties (mirror of applyHeroLayout). */
const applyCoverControls = (root, entry = {}) => {
  if (!entry.image) return;
  const layout = photoLayout(entry);
  root.style.setProperty('--cover', `url("${String(entry.image).replaceAll('"', '%22')}")`);
  root.style.setProperty('--cms-photo-position', `${layout.x}% ${layout.y}%`);
  root.style.setProperty('--cms-photo-scale', String(layout.scale));
  root.style.setProperty('--cms-photo-fit', layout.fit);
};

const ytId = (url) => {
  const m =
    String(url || '').match(/[?&]v=([^&]+)/) || String(url || '').match(/youtu\.be\/([^?&]+)/);
  return m ? m[1] : '';
};

/* ---------- block renderers ---------- */
/* Each takes (document, block, ctx) where ctx = { urlFor(pageId), t(path) }.
 * t(path) resolves the data-i18n key: legacy (block.i18n) or generated. */

const pageLink = (document, ctx, { label, page, primary, key }) => {
  const a = el(document, 'a', { class: 'button' + (primary ? ' primary' : '') });
  a.setAttribute('data-open', page);           // i18n slot + old-link compatibility
  a.setAttribute('href', ctx.urlFor(page));
  a.textContent = (label || '') + ' ';
  if (key) a.setAttribute('data-i18n', key);
  a.appendChild(el(document, 'span', { text: '↗' }));
  return a;
};

const proseColumn = (document, col, ctx, side) => {
  const wrap = el(document, 'div', { class: 'prose' });
  if (col.logo && col.logo.image) {
    const logo = el(document, 'img', { class: 'app-logo' });
    logo.src = col.logo.image;
    logo.alt = col.logo.alt || '';
    logo.setAttribute('loading', 'lazy');
    logo.setAttribute('width', '78');
    logo.setAttribute('height', '78');
    wrap.appendChild(logo);
  }
  if (col.lead) {
    wrap.appendChild(el(document, 'p', { class: 'large', text: col.lead, key: ctx.t(`${side}.lead`) }));
  }
  // Editors write lists the way they read them — one paragraph per line,
  // each starting with a bullet character. Rendered literally that is a run
  // of paragraphs each opening with a stray "•", which is what several pages
  // were showing. Consecutive bulleted lines become one real list; the
  // marker is drawn by CSS, so it is never part of the text.
  const paragraphs = col.paragraphs || [];
  const BULLET = /^\s*[•·▪◦‣]\s+|^\s*[-–—]\s+/;
  let list = null;
  paragraphs.forEach((text, i) => {
    const key = ctx.t(`${side}.paragraphs.${i}`);
    if (BULLET.test(text)) {
      if (!list) {
        list = el(document, 'ul', { class: 'prose-list' });
        wrap.appendChild(list);
      }
      list.appendChild(el(document, 'li', { text: text.replace(BULLET, ''), key }));
      return;
    }
    list = null;
    wrap.appendChild(el(document, 'p', { text, key }));
  });
  if (Array.isArray(col.features) && col.features.length) {
    const list = el(document, 'div', { class: 'feature-list' });
    col.features.forEach((f, i) => {
      const item = el(document, 'div', { class: 'feature-item' });
      item.appendChild(el(document, 'span', { text: f.number || String(i + 1).padStart(2, '0') }));
      const body = el(document, 'div');
      body.appendChild(el(document, 'strong', { text: f.title, key: ctx.t(`${side}.features.${i}.title`) }));
      if (f.text) body.appendChild(el(document, 'small', { text: f.text, key: ctx.t(`${side}.features.${i}.text`) }));
      item.appendChild(body);
      list.appendChild(item);
    });
    wrap.appendChild(list);
  }
  if (Array.isArray(col.actions) && col.actions.length) {
    const actions = el(document, 'div', { class: 'hero-actions' });
    col.actions.forEach((a) => actions.appendChild(pageLink(document, ctx, a)));
    wrap.appendChild(actions);
  }
  return wrap;
};

const splitColumn = (document, col = {}, ctx, side) => {
  if (col.kind === 'dataPanel') {
    const wrap = el(document, 'div', { class: 'image-data-panel reveal' });
    wrap.appendChild(photo(document, col.photo));
    const overlay = el(document, 'div', { class: 'image-data-overlay' });
    overlay.appendChild(el(document, 'strong', { text: col.stat }));
    overlay.appendChild(el(document, 'span', { text: col.caption, key: ctx.t(`${side}.caption`) }));
    wrap.appendChild(overlay);
    return wrap;
  }
  if (col.kind === 'image') {
    const wrap = el(document, 'div', { class: (col.look || 'app-shot') + ' reveal' });
    wrap.appendChild(photo(document, col.photo));
    return wrap;
  }
  return proseColumn(document, col, ctx, side);
};

const BLOCKS = {
  split(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'split' });
    wrap.appendChild(splitColumn(document, block.left, ctx, 'left'));
    wrap.appendChild(splitColumn(document, block.right, ctx, 'right'));
    return wrap;
  },

  cards(document, block, ctx) {
    const grid = el(document, 'div', { class: 'grid-3' });
    (block.items || []).forEach((item, i) => {
      const card = el(document, 'article', { class: 'project-card' });
      card.appendChild(el(document, 'span', { class: 'card-number', text: item.number || String(i + 1).padStart(2, '0') }));
      card.appendChild(el(document, 'h3', { text: item.title, key: ctx.t(`items.${i}.title`) }));
      if (item.text) card.appendChild(el(document, 'p', { text: item.text, key: ctx.t(`items.${i}.text`) }));
      grid.appendChild(card);
    });
    return grid;
  },

  imagePair(document, block, ctx) {
    const wrap = el(document, 'div', {
      class: block.look === 'screens' ? 'app-screen-strip' : 'editorial-images'
    });
    (block.items || []).forEach((item, i) => {
      const figure = el(document, 'figure', {
        class: block.look === 'screens' ? undefined : 'editorial-image'
      });
      figure.appendChild(photo(document, item.photo));
      if (item.caption) {
        figure.appendChild(
          el(document, 'figcaption', { class: 'image-note', text: item.caption, key: ctx.t(`items.${i}.caption`) })
        );
      }
      wrap.appendChild(figure);
    });
    return wrap;
  },

  photoRibbon(document, block) {
    const wrap = el(document, 'div', { class: 'photo-ribbon' });
    (block.items || []).forEach((item) => {
      const figure = el(document, 'figure');
      figure.appendChild(photo(document, item.photo));
      wrap.appendChild(figure);
    });
    return wrap;
  },

  banner(document, block, ctx) {
    // A banner with no heading has nothing to fill a dark slab with — it was
    // rendering as a large empty panel holding one small label. Those become
    // a quiet rule-and-label marker instead, which is all the content is.
    if (!(block.title || '').trim()) {
      if (!block.eyebrow && !block.lede) return null;
      const marker = el(document, 'div', { class: 'section-marker' });
      // A marker still begins a section — its label is the eyebrow. Without
      // this, a page whose first section is introduced by a label rather than
      // a heading has only one boundary and cannot be divided at all.
      if (block.eyebrow) {
        marker.setAttribute('id', 's-' + (slugish(block.eyebrow) || 'section'));
        marker.setAttribute('data-section-anchor', '');
        marker.setAttribute('data-tab-label', block.tabLabel || block.eyebrow);
        marker.appendChild(el(document, 'p', { class: 'eyebrow', text: block.eyebrow, key: ctx.t('eyebrow') }));
      }
      if (block.lede) marker.appendChild(el(document, 'p', { class: 'lede', text: block.lede, key: ctx.t('lede') }));
      return marker;
    }

    const wrap = el(document, 'div', { class: 'section-head' });
    // A titled banner is an addressable section boundary: it gets a stable
    // anchor id, and the in-page navigation (jump links or tabs — see
    // setupSectionNav in app.mjs) is built from exactly these. Banners with
    // no title are visual interludes and never split a section.
    const title = (block.title || '').trim();
    if (title) {
      const anchor = 's-' + title.toLowerCase().normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      wrap.setAttribute('id', anchor);
      wrap.setAttribute('data-section-anchor', '');
      if (block.tabLabel) wrap.setAttribute('data-tab-label', block.tabLabel);
    }
    if (block.eyebrow) {
      const eyebrow = el(document, 'p', { class: 'eyebrow', text: block.eyebrow, key: ctx.t('eyebrow') });
      if (block.accent) eyebrow.style.color = block.accent;
      wrap.appendChild(eyebrow);
    }
    wrap.appendChild(el(document, 'h2', { text: block.title, key: ctx.t('title') }));
    if (block.lede) wrap.appendChild(el(document, 'p', { class: 'lede', text: block.lede, key: ctx.t('lede') }));
    return wrap;
  },

  statement(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'home-statement' });
    const grid = el(document, 'div', { class: 'statement-grid' });
    grid.appendChild(el(document, 'p', { class: 'meta', text: block.label, key: ctx.t('label') }));
    grid.appendChild(el(document, 'blockquote', { text: block.quote, key: ctx.t('quote') }));
    wrap.appendChild(grid);
    // Two of these blocks carry a quote and no numbers, and were drawing the
    // metric row anyway — a tall empty band under the quote. With nothing to
    // put in it the block is simply a pull-quote.
    const metrics = block.metrics || [];
    if (metrics.length) {
      const row = el(document, 'div', { class: 'metric-row' });
      metrics.forEach((m, i) => {
        const metric = el(document, 'div', { class: 'metric' });
        metric.appendChild(el(document, 'strong', { text: m.value }));
        metric.appendChild(el(document, 'span', { text: m.label, key: ctx.t(`metrics.${i}.label`) }));
        row.appendChild(metric);
      });
      wrap.appendChild(row);
    } else {
      wrap.classList.add('home-statement--quote');
    }
    return wrap;
  },

  storyCards(document, block, ctx) {
    const section = el(document, 'section', { class: 'home-explore' });
    // The id is derived from the block's own title. It used to be the constant
    // 'explore-title', and the home page renders two of these blocks — so the
    // document carried a duplicate id and both sections' aria-labelledby
    // resolved to the first heading.
    const headingId = 'explore-' + (slugish(block.title) || 'section');
    section.setAttribute('aria-labelledby', headingId);
    // A titled card section is a section boundary too, not just a banner —
    // otherwise a page whose structure comes from these blocks has nothing
    // for the in-page navigation to divide it at.
    const cardsLabel = (block.title || '').trim() || (block.eyebrow || '').trim();
    if (cardsLabel) {
      section.setAttribute('id', 's-' + (slugish(cardsLabel) || 'cards'));
      section.setAttribute('data-section-anchor', '');
      section.setAttribute('data-tab-label', block.tabLabel || cardsLabel);
    }
    const head = el(document, 'header', { class: 'explore-head' });
    const headText = el(document, 'div');
    headText.appendChild(el(document, 'p', { class: 'eyebrow', text: block.eyebrow, key: ctx.t('eyebrow') }));
    const h2 = el(document, 'h2', { text: block.title, key: ctx.t('title') });
    h2.id = headingId;
    headText.appendChild(h2);
    head.appendChild(headText);
    head.appendChild(el(document, 'p', { text: block.lede, key: ctx.t('lede') }));
    section.appendChild(head);
    const grid = el(document, 'div', { class: 'story-grid' });
    (block.items || []).forEach((item, i) => {
      const card = el(document, 'a', { class: 'story-card' });
      card.setAttribute('data-open', item.page);
      card.setAttribute('href', ctx.urlFor(item.page));
      card.appendChild(photo(document, item.photo));
      const copy = el(document, 'span', { class: 'story-copy' });
      copy.appendChild(el(document, 'span', { class: 'meta', text: item.label, key: ctx.t(`items.${i}.label`) }));
      copy.appendChild(el(document, 'strong', { text: item.title, key: ctx.t(`items.${i}.title`) }));
      const arrow = el(document, 'i', { text: '↗' });
      arrow.setAttribute('aria-hidden', 'true');
      copy.appendChild(arrow);
      card.appendChild(copy);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    return section;
  },

  steps(document, block, ctx) {
    const wrap = el(document, 'div', { class: 'process' });
    (block.items || []).forEach((item, i) => {
      const step = el(document, 'div', { class: 'process-step' });
      step.appendChild(el(document, 'h3', { text: item.title, key: ctx.t(`items.${i}.title`) }));
      if (item.text) step.appendChild(el(document, 'p', { text: item.text, key: ctx.t(`items.${i}.text`) }));
      wrap.appendChild(step);
    });
    return wrap;
  },

  framedShot(document, block) {
    const frame = el(document, 'div', { class: 'game-frame' });
    const dots = el(document, 'div', { class: 'game-dots' });
    for (let i = 0; i < 3; i++) dots.appendChild(el(document, 'span'));
    frame.appendChild(dots);
    frame.appendChild(photo(document, block.photo, { lazy: false }));
    return frame;
  },

  mediaStories(document, block) {
    const frag = el(document, 'div', { class: 'media-stories-wrap' });
    const bar = el(document, 'div', { class: 'filter-bar' });
    const n = (block.items || []).length;
    const count = el(document, 'span', { class: 'filter-label', text: `${n} selected ${n === 1 ? 'story' : 'stories'}` });
    count.id = 'media-count';
    bar.appendChild(count);
    const search = el(document, 'input', { class: 'search' });
    search.id = 'media-search';
    search.setAttribute('type', 'search');
    search.setAttribute('placeholder', 'Search stories or publishers…');
    search.setAttribute('aria-label', 'Search media stories');
    bar.appendChild(search);
    frag.appendChild(bar);

    const grid = el(document, 'div', { class: 'media-grid' });
    grid.id = 'media-grid';
    (block.items || []).forEach((item) => {
      const a = el(document, 'a', { class: 'media-card' });
      a.href = item.url || '#';
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      a.setAttribute(
        'data-search',
        [item.meta, item.title, item.description].filter(Boolean).join(' ').toLowerCase()
      );
      a.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      a.appendChild(el(document, 'h3', { text: item.title }));
      if (item.description) a.appendChild(el(document, 'p', { text: item.description }));
      a.appendChild(el(document, 'span', { class: 'read', text: 'Read story ↗' }));
      grid.appendChild(a);
    });
    frag.appendChild(grid);
    return frag;
  },

  filmGrid(document, block) {
    const grid = el(document, 'div', { class: 'video-grid' });
    (block.items || []).forEach((item) => {
      const a = el(document, 'a', { class: 'video-card' });
      a.href = item.url || '#';
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      const wrap = el(document, 'div', { class: 'video-image' });
      const id = ytId(item.url);
      const img = el(document, 'img');
      img.setAttribute('loading', 'lazy');
      if (id) img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      img.alt = item.title ? item.title + ' video thumbnail' : '';
      const play = el(document, 'span', { class: 'play' });
      play.setAttribute('aria-hidden', 'true');
      wrap.append(img, play);
      a.appendChild(wrap);
      a.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      a.appendChild(el(document, 'h3', { text: item.title }));
      grid.appendChild(a);
    });
    return grid;
  },

  photoArchive(document, block) {
    const frag = el(document, 'div', { class: 'photo-archive-wrap' });
    const items = block.items || [];
    const tools = el(document, 'div', { class: 'archive-tools' });
    const count = el(document, 'span', {
      class: 'filter-label',
      text: `${items.length} archived ${items.length === 1 ? 'image' : 'images'}`
    });
    count.id = 'gallery-count';
    tools.appendChild(count);
    const filters = el(document, 'div', { class: 'archive-filters' });
    filters.id = 'archive-filters';
    filters.setAttribute('aria-label', 'Filter the image archive');
    ['All', ...new Set(items.map((i) => i.category).filter(Boolean))].forEach((category) => {
      const filter = el(document, 'button', { class: 'archive-filter', text: category });
      filter.setAttribute('type', 'button');
      filter.setAttribute('aria-pressed', String(category === 'All'));
      filters.appendChild(filter);
    });
    tools.appendChild(filters);
    frag.appendChild(tools);

    const grid = el(document, 'div', { class: 'gallery-grid' });
    grid.id = 'gallery-grid';
    grid.setAttribute('aria-live', 'polite');
    items.forEach((item, index) => {
      const button = el(document, 'button', { class: 'gallery-item' });
      button.setAttribute('type', 'button');
      button.setAttribute('data-category', item.category || '');
      button.setAttribute('data-index', String(index));
      button.setAttribute('data-title', item.title || '');
      button.setAttribute('aria-label', 'Open ' + (item.title || 'image'));
      const img = photo(document, item, { alt: item.title || '' });
      img.setAttribute('decoding', 'async');
      button.appendChild(img);
      button.appendChild(el(document, 'span', { text: item.category }));
      grid.appendChild(button);
    });
    frag.appendChild(grid);
    return frag;
  },

  /**
   * One section of the publications page — a heading, a count and its list.
   * `kind` groups sections for the page-level filter, which app.mjs builds
   * client-side from whatever sections are actually present (the CMS preview
   * shows the content; the filter is behaviour, not content). The old model
   * put a filter bar inside every list block, which duplicated ids as soon
   * as a page held two of them.
   */
  publicationList(document, block) {
    const items = block.items || [];
    const kind = block.kind || '';
    const heading = block.heading || kind;
    const section = heading
      ? discGroup(document, {
          id: kind ? 'pub-' + slugish(kind) : '',
          title: heading,
          count: items.length,
          noun: ['publication', 'publications']
        })
      : el(document, 'section', { class: 'disc-group' });
    section.classList.add('pub-section');
    if (kind) section.setAttribute('data-kind', kind);

    const grid = el(document, 'div', { class: 'pub-grid' });
    items.forEach((item) => {
      const card = el(document, 'article', { class: 'pub-card' });
      if (item.kind) card.setAttribute('data-kind', item.kind);
      // These records have no date field, but every one of the 77 citations
      // names its year in the text. The latest year mentioned is the
      // publication year in every case here; a citation that also cites a
      // study period would need a real field instead of this.
      const year = pubYear(item);
      if (year) card.setAttribute('data-year', String(year));
      card.setAttribute('data-title', (item.title || '').toLowerCase());
      card.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      card.appendChild(el(document, 'h3', { text: item.title }));
      if (item.description) card.appendChild(el(document, 'p', { text: item.description }));
      const links = el(document, 'span', { class: 'pub-links' });
      (item.editions || []).forEach((edition) => {
        if (!edition || !edition.url) return;
        const link = el(document, 'a', { text: (edition.label || 'Download') + ' ↗' });
        link.href = edition.url;
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
        link.setAttribute('aria-label', [item.title, edition.label].filter(Boolean).join(' — '));
        links.appendChild(link);
      });
      if (links.childNodes.length) card.appendChild(links);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    return section;
  },

  toolList(document, block, ctx) {
    const grid = el(document, 'div', { class: 'tool-grid' });
    grid.id = 'tool-grid';
    (block.items || []).forEach((item) => {
      const card = el(document, 'article', { class: 'tool-card reveal' });
      const shot = el(document, 'div', { class: 'tool-shot' });
      shot.appendChild(photo(document, item.photo || {}, { alt: item.name ? item.name + ' screenshot' : '' }));
      card.appendChild(shot);
      const copy = el(document, 'div', { class: 'tool-copy' });
      copy.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      copy.appendChild(el(document, 'h3', { text: item.name }));
      if (item.description) copy.appendChild(el(document, 'p', { text: item.description }));
      // An external URL wins; otherwise link to the target page.
      const action = el(document, 'a', { class: 'button primary' });
      action.textContent = (item.linkLabel || 'Open') + ' ';
      if (item.url) {
        action.href = item.url;
        action.setAttribute('target', '_blank');
        action.setAttribute('rel', 'noopener');
      } else {
        action.setAttribute('data-open', item.target || 'home');
        action.href = ctx.urlFor(item.target || 'home');
      }
      action.appendChild(el(document, 'span', { text: '↗' }));
      copy.appendChild(action);
      card.appendChild(copy);
      grid.appendChild(card);
    });
    return grid;
  },

  partnerList(document, block) {
    const grid = el(document, 'div', { class: 'people-grid' });
    (block.items || []).forEach((item) => {
      const card = el(document, 'article', { class: 'people-card' });
      card.appendChild(el(document, 'span', { class: 'meta', text: item.meta }));
      const h3 = el(document, 'h3');
      if (item.url) {
        const a = el(document, 'a', { text: (item.name || '') + ' ↗' });
        a.href = item.url;
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
        h3.appendChild(a);
      } else {
        h3.textContent = item.name || '';
      }
      card.appendChild(h3);
      grid.appendChild(card);
    });
    return grid;
  },

  portraitBand(document, block) {
    const band = el(document, 'div', { class: 'portrait-band' });
    (block.items || []).forEach((item) => {
      if (!item || !item.image) return;
      const card = el(document, item.url ? 'a' : 'article', { class: 'portrait-card' });
      if (item.url) {
        card.href = item.url;
        card.setAttribute('target', '_blank');
        card.setAttribute('rel', 'noopener');
      }
      const details = [item.name, item.title, item.affiliation].filter(Boolean).join(', ');
      card.setAttribute('aria-label', details + (item.url ? ' — open profile' : ''));
      card.appendChild(
        photo(document, item, { alt: item.name ? 'Portrait of ' + item.name : 'MARVI team member portrait' })
      );
      const info = el(document, 'span', { class: 'portrait-card-info' });
      info.appendChild(el(document, 'strong', { text: item.name || 'MARVI team member' }));
      if (item.title) info.appendChild(el(document, 'span', { text: item.title }));
      if (item.affiliation) info.appendChild(el(document, 'small', { text: item.affiliation }));
      card.appendChild(info);
      band.appendChild(card);
    });
    return band;
  },

  sourceNote(document, block) {
    const p = el(document, 'p');
    if (block.style) p.setAttribute('style', block.style);
    (block.parts || []).forEach((part) => {
      if (part.link) {
        const a = el(document, 'a', { text: part.link.label });
        a.href = part.link.url || '#';
        if (part.link.download) a.setAttribute('download', '');
        if (part.link.external) {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        }
        p.appendChild(a);
      } else {
        p.appendChild(document.createTextNode(part.text || ''));
      }
    });
    return p;
  },

  video(document, block) {
    return BLOCKS.filmGrid(document, { items: [block] });
  },

  embed(document, block) {
    if (!/^https?:\/\/\S+$/i.test(String(block.url || ''))) return null;
    const wrap = el(document, 'section', { class: 'cms-block cms-block-embed' });
    const frame = el(document, 'iframe');
    frame.src = block.url;
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('title', block.title || 'Embedded content');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('style', 'width:100%;aspect-ratio:16/9;border:0;border-radius:12px');
    wrap.appendChild(frame);
    return wrap;
  },

  /* --- the CMS "flexible section" types, markup-identical to the old
   *     renderFlexibleSections so their existing CSS applies --- */

  text(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-text' });
    cmsCopy(document, section, block);
    return section;
  },

  imageText(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-imageText' });
    section.setAttribute('data-photo-side', block.photoSide || 'left');
    cmsPhoto(document, section, block.photo || {});
    cmsCopy(document, section, block);
    return section;
  },

  gallery(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-gallery' });
    if (block.heading) section.appendChild(el(document, 'h2', { text: block.heading }));
    const gallery = el(document, 'div', { class: 'cms-block-gallery' });
    (block.photos || []).forEach((entry) => {
      const figure = el(document, 'figure');
      figure.appendChild(photo(document, entry, { alt: '' }));
      gallery.appendChild(figure);
    });
    section.appendChild(gallery);
    return section;
  },

  callout(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-callout' });
    section.setAttribute('data-tone', block.tone || 'blue');
    if (block.heading) section.appendChild(el(document, 'h2', { text: block.heading }));
    cmsParagraphs(document, section, block.body);
    return section;
  },

  button(document, block) {
    const section = el(document, 'section', { class: 'cms-block cms-block-button' });
    if (block.heading) section.appendChild(el(document, 'h2', { text: block.heading }));
    const link = el(document, 'a', { class: 'button primary', text: (block.label || 'Learn more') + ' ↗' });
    link.href = block.url || '#';
    section.appendChild(link);
    return section;
  },

  /**
   * The whole researcher collection as a portrait band, each tile linking to
   * that person's own page. MARVI authors its eight people inline in the
   * block; AIWC has 108 as records, so this reads them from ctx instead —
   * same markup, same CSS, different source.
   */
  portraitDirectory(document, block, ctx) {
    const wrap = el(document, 'div');
    // The researchers live in this block, so the page holds everything on it.
    const people = block.items || ctx.people || [];

    if (block.filters !== false) {
      const bar = el(document, 'div', { class: 'filter-bar' });
      bar.setAttribute('data-people-filters', '');
      const chip = (label, value, count, pressed) => {
        const b = el(document, 'button', { class: 'filter-chip' });
        b.setAttribute('type', 'button');
        b.setAttribute('data-filter', value);
        b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        b.appendChild(el(document, 'span', { text: label }));
        if (count != null) b.appendChild(el(document, 'span', { class: 'filter-n', text: String(count) }));
        return b;
      };
      // The chips travel together as one item, or the bar tries to space five
      // separate children across a row that cannot hold them and the search
      // field is the one that collapses.
      const chips = el(document, 'div', { class: 'filter-chips' });
      chips.appendChild(chip('All', 'all', people.length, true));
      chips.appendChild(chip('Australia', 'country:Australia', people.filter((p) => p.country === 'Australia').length));
      chips.appendChild(chip('India', 'country:India', people.filter((p) => p.country === 'India').length));
      bar.appendChild(chips);

      const field = el(document, 'div', { class: 'filter-field' });
      const input = el(document, 'input');
      input.setAttribute('type', 'search');
      input.setAttribute('placeholder', 'Search name, role or interest');
      input.setAttribute('aria-label', 'Search researchers');
      input.setAttribute('data-people-search', '');
      field.appendChild(input);

      // 27 institutions is too many for chips without the filter bar
      // outweighing the directory, so institution is a select.
      const groups = new Map();
      people.forEach((p) => {
        if (p.institute) groups.set(p.institute, (groups.get(p.institute) || 0) + 1);
      });
      const select = el(document, 'select');
      select.setAttribute('aria-label', 'Filter by institution');
      select.setAttribute('data-people-inst', '');
      const all = el(document, 'option', { text: `All institutions (${groups.size})` });
      all.value = '';
      select.appendChild(all);
      [...groups.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .forEach(([name, count]) => {
          const option = el(document, 'option', { text: `${name} (${count})` });
          option.value = name;
          select.appendChild(option);
        });
      field.appendChild(select);
      bar.appendChild(field);
      bar.appendChild(sortControl(document, 'people', [
        ['shuffle', 'Shuffled'],
        ['name', 'Name A–Z'],
        ['country', 'Country'],
        ['institute', 'Institution']
      ]));
      wrap.appendChild(bar);

      const count = el(document, 'p', {
        class: 'filter-label meta',
        text: `Showing all ${people.length} researchers`,
      });
      count.setAttribute('data-people-count', '');
      wrap.appendChild(count);
    }

    const portrait = (person) => {
      const card = el(document, 'a', { class: 'portrait-card' });
      card.href = ctx.entryUrl ? ctx.entryUrl('people', person.slug) : '#';
      card.setAttribute('data-country', person.country || '');
      card.setAttribute('data-inst', person.institute || '');
      card.setAttribute('data-name', (person.name || '').toLowerCase());
      card.setAttribute(
        'data-search',
        [person.name, person.designation, person.institute, person.interests].filter(Boolean).join(' ').toLowerCase()
      );
      card.setAttribute('aria-label', [person.name, person.designation, person.institute].filter(Boolean).join(', '));
      card.appendChild(portraitImage(document, person));
      const info = el(document, 'span', { class: 'portrait-card-info' });
      info.appendChild(el(document, 'strong', { text: person.name }));
      if (person.designation) info.appendChild(el(document, 'span', { text: person.designation }));
      if (person.institute) info.appendChild(el(document, 'small', { text: person.institute }));
      card.appendChild(info);
      return card;
    };

    // 108 portraits are split into collapsible country groups, so the page
    // opens as a short index rather than a wall of faces.
    // One group per country. The static order within each is stable, so the
    // file stays reviewable and a crawler sees something deterministic;
    // app.mjs shuffles each group separately on load.
    groupByCountry(people).forEach(([country, members]) => {
      wrap.appendChild(directoryGroup(document, {
        country, members, gridClass: 'portrait-band', gridAttr: 'data-people-grid',
        kind: 'people', noun: ['researcher', 'researchers'], renderCard: portrait
      }));
    });

    const empty = el(document, 'p', { class: 'prose', text: 'No researchers match that filter.' });
    empty.setAttribute('data-people-empty', '');
    empty.setAttribute('hidden', '');
    wrap.appendChild(empty);
    return wrap;
  },

  /**
   * The partner collection. When the block shows every country it becomes a
   * filtered directory of collapsible country groups, matching researchers
   * and publications; pinned to one country it stays a plain grid, which is
   * how the home page uses it.
   */
  partnerDirectory(document, block, ctx) {
    const all = block.items || ctx.partners || [];
    const byCountry = block.country ? all.filter((p) => p.country === block.country) : all;
    // A showcase can carry a sample; the directory always carries everyone.
    const limit = Number(block.limit) > 0 ? Number(block.limit) : 0;
    const list = limit && block.layout !== 'directory' ? byCountry.slice(0, limit) : byCountry;

    /**
     * A partner card is the institution's name and where it is — the two
     * things every one of the 33 records actually has.
     *
     * It used to carry the summary and a logo, and both were uneven: 7 of 33
     * have a summary, so the grid ran ragged; and all 10 logo files in the
     * repository are Australian, so every Indian institution was showing a
     * generic site photograph dressed as its mark. In a centre built on two
     * countries being equal partners, that asymmetry is worse than having no
     * pictures at all. The summary and the logo both still appear on the
     * institution's own page, where there is room to be uneven honestly.
     */
    const partnerCard = (partner) => {
      const card = el(document, 'a', { class: 'partner-card' });
      card.href = ctx.entryUrl ? ctx.entryUrl('partners', partner.slug) : '#';
      card.setAttribute('data-country', partner.country || '');
      card.setAttribute('data-name', (partner.name || '').toLowerCase());
      card.setAttribute(
        'data-search',
        [partner.name, partner.instituteName, partner.summary].filter(Boolean).join(' ').toLowerCase()
      );
      card.appendChild(el(document, 'span', { class: 'meta', text: partner.country }));
      card.appendChild(el(document, 'h3', { text: partner.name }));
      card.appendChild(el(document, 'span', { class: 'partner-go', text: '↗' }));
      return card;
    };

    // The full directory — chips, search, collapsible country groups — is
    // opt-in. It belongs on the partners page, where the job is "find an
    // institution". Everywhere else, and on the home page in particular, the
    // block is a showcase and a plain grid is the right answer: a search box
    // on a homepage asks the reader to work before they have a question.
    const groups = groupByCountry(list);
    if (block.layout !== 'directory' || block.country || groups.length < 2) {
      const grid = el(document, 'div', { class: 'people-grid' });
      list.forEach((partner) => grid.appendChild(partnerCard(partner)));
      return grid;
    }

    const wrap = el(document, 'div');
    const bar = el(document, 'div', { class: 'filter-bar' });
    bar.setAttribute('data-partner-filters', '');
    const chip = (label, value, count, pressed) => {
      const b = el(document, 'button', { class: 'filter-chip' });
      b.setAttribute('type', 'button');
      b.setAttribute('data-filter', value);
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      b.appendChild(el(document, 'span', { text: label }));
      b.appendChild(el(document, 'span', { class: 'filter-n', text: String(count) }));
      return b;
    };
    const chips = el(document, 'div', { class: 'filter-chips' });
    chips.appendChild(chip('All', 'all', list.length, true));
    groups.forEach(([country, members]) => chips.appendChild(chip(country, 'country:' + country, members.length)));
    bar.appendChild(chips);

    const field = el(document, 'div', { class: 'filter-field' });
    const input = el(document, 'input');
    input.setAttribute('type', 'search');
    input.setAttribute('placeholder', 'Search institutions');
    input.setAttribute('aria-label', 'Search partner institutions');
    input.setAttribute('data-partner-search', '');
    field.appendChild(input);
    bar.appendChild(field);
    bar.appendChild(sortControl(document, 'partners', [
      ['shuffle', 'Shuffled'],
      ['name', 'Name A–Z'],
      ['country', 'Country']
    ]));
    wrap.appendChild(bar);

    const count = el(document, 'p', { class: 'filter-label meta', text: `Showing all ${list.length} institutions` });
    count.setAttribute('data-partner-count', '');
    wrap.appendChild(count);

    groups.forEach(([country, members]) => {
      wrap.appendChild(directoryGroup(document, {
        country, members, gridClass: 'partner-grid', gridAttr: 'data-partner-grid',
        kind: 'partners', noun: ['institution', 'institutions'], renderCard: partnerCard
      }));
    });

    const empty = el(document, 'p', { class: 'prose', text: 'No institutions match that filter.' });
    empty.setAttribute('data-partner-empty', '');
    empty.setAttribute('hidden', '');
    wrap.appendChild(empty);
    return wrap;
  },

};

const cmsParagraphs = (document, root, value) => {
  String(value || '').split(/\n\s*\n/).filter(Boolean).forEach((paragraph) => {
    root.appendChild(el(document, 'p', { text: paragraph.trim() }));
  });
};
const cmsCopy = (document, section, block) => {
  const copy = el(document, 'div', { class: 'cms-block-copy' });
  copy.setAttribute('data-align', block.align || 'left');
  if (block.eyebrow) copy.appendChild(el(document, 'p', { class: 'eyebrow', text: block.eyebrow }));
  if (block.heading) copy.appendChild(el(document, 'h2', { text: block.heading }));
  cmsParagraphs(document, copy, block.body);
  section.appendChild(copy);
};
const cmsPhoto = (document, section, entry) => {
  const frame = el(document, 'div', { class: 'cms-block-photo' });
  frame.appendChild(photo(document, entry, { alt: '' }));
  section.appendChild(frame);
};

export const BLOCK_TYPES = Object.keys(BLOCKS);

/* The "flexible section" types render appended after the section body inside
 * a .cms-sections wrapper — that is where their CSS expects them. */
const FLEX_TYPES = new Set(['text', 'imageText', 'gallery', 'callout', 'button', 'embed']);

/**
 * A collapsible category: a heading that is also a disclosure button, its
 * count, and the content it holds. Publications, researchers and partner
 * institutions all use this, so the three long directories behave the same
 * way — app.mjs collapses every group on load and wires the toggles.
 *
 * Without JS the button is inert and the content stays visible, so nothing
 * is ever locked away from a reader (or a crawler) that cannot run scripts.
 */
/** The latest four-digit year anywhere in a publication record. */
const pubYear = (item) => {
  const found = JSON.stringify(item || {}).match(/\b(?:19|20)\d{2}\b/g);
  return found ? Math.max(...found.map(Number)) : 0;
};

const slugish = (value) =>
  String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Group records by country, with the Centre's two partners first and any
 * other country after them alphabetically. Records with no country fall
 * into a trailing group rather than disappearing.
 */
const groupByCountry = (records) => {
  const groups = new Map();
  records.forEach((record) => {
    const key = record.country || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  const rank = (name) => (name === 'Australia' ? 0 : name === 'India' ? 1 : name === 'Other' ? 3 : 2);
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
};

/**
 * The control that opens a directory. A long list shows one row and this
 * button; pressing it reveals the rest. Rendered here rather than injected,
 * so a reader without JavaScript sees the full list and a button that says
 * so — app.mjs is what collapses the list, never what fills it.
 */
/**
 * One country's slice of a directory: a heading, a grid, and the button that
 * opens it. The two countries stay visibly separate — this is a bilateral
 * centre and the split is the point — while each one shuffles independently,
 * so neither the Australian nor the Indian list has a permanent first name.
 */
const directoryGroup = (document, { country, members, gridClass, gridAttr, kind, noun, renderCard }) => {
  const section = el(document, 'section', { class: 'dir-group' });
  section.setAttribute('data-dir-group', country);
  const head = el(document, 'header', { class: 'dir-head' });
  head.appendChild(el(document, 'h2', { text: country }));
  const tally = el(document, 'span', {
    class: 'filter-label dir-count',
    text: `${members.length} ${members.length === 1 ? noun[0] : noun[1]}`
  });
  tally.setAttribute('data-group-count', '');
  tally.setAttribute('data-noun', noun.join('|'));
  head.appendChild(tally);
  section.appendChild(head);

  const grid = el(document, 'div', { class: gridClass });
  grid.setAttribute(gridAttr, '');
  members.forEach((record) => grid.appendChild(renderCard(record)));
  section.appendChild(grid);
  section.appendChild(revealButton(document, members.length, noun, kind));
  return section;
};

const revealButton = (document, count, noun, kind) => {
  const wrap = el(document, 'div', { class: 'reveal-row' });
  const button = el(document, 'button', {
    class: 'reveal-all',
    text: `Show all ${count} ${count === 1 ? noun[0] : noun[1]}`
  });
  button.setAttribute('type', 'button');
  button.setAttribute('data-reveal', kind);
  button.setAttribute('data-noun', noun.join('|'));
  button.setAttribute('hidden', '');
  wrap.appendChild(button);
  return wrap;
};

/** A sort order the reader can change. Shuffled is the default. */
const sortControl = (document, kind, options) => {
  const field = el(document, 'div', { class: 'sort-field' });
  const id = `sort-${kind}`;
  const label = el(document, 'label', { class: 'filter-label', text: 'Sort' });
  label.setAttribute('for', id);
  const select = el(document, 'select');
  select.id = id;
  select.setAttribute('data-sort', kind);
  options.forEach(([value, text]) => {
    const option = el(document, 'option', { text });
    option.value = value;
    select.appendChild(option);
  });
  field.appendChild(label);
  field.appendChild(select);
  return field;
};

const discGroup = (document, { id, title, count, noun }) => {
  const section = el(document, 'section', { class: 'disc-group' });
  if (id) section.setAttribute('id', id);
  section.setAttribute('data-group', title);
  const head = el(document, 'header', { class: 'disc-head' });
  const heading = el(document, 'h2');
  const toggle = el(document, 'button', { class: 'disc-toggle', text: title });
  toggle.setAttribute('type', 'button');
  heading.appendChild(toggle);
  head.appendChild(heading);
  const tally = el(document, 'span', {
    class: 'filter-label disc-count',
    text: `${count} ${count === 1 ? noun[0] : noun[1]}`
  });
  tally.setAttribute('data-group-count', '');
  tally.setAttribute('data-noun', noun.join('|'));
  head.appendChild(tally);
  section.appendChild(head);
  return section;
};

/* ---------- page renderers ---------- */

/**
 * The animated water field shown when the home page has no header photo.
 *
 * Two families of streams — one entering from the left for Australia, one
 * from the right for India — converge on a confluence and leave the frame as
 * a single braided flow: the site's own thesis drawn as a picture. Everything
 * is stroke work on the ink background, so it stays quiet behind the display
 * text.
 *
 * All motion is CSS (dash drift, offset-path dots, a breathing contour), so
 * the chrome's prefers-reduced-motion rule silences the whole thing and the
 * static line drawing remains. `pathLength="1000"` normalises every pulse
 * path, letting one keyframe rule pace all of them.
 */
const flowPath = (side, i) =>
  side === 'L'
    ? `M -60 ${150 + i * 46} C ${260 + i * 14} ${170 + i * 40}, ${520 - i * 8} ${300 + i * 26}, 700 ${418 + i * 22} ` +
      `C 790 ${480 + i * 14}, 842 ${520 + i * 8}, 868 ${552 + i * 5} ` +
      `C 930 ${620 + i * 6}, 1010 ${720 + i * 9}, ${1085 + i * 16} 940`
    : `M 1500 ${70 + i * 40} C ${1280 - i * 10} ${120 + i * 34}, 1120 ${210 + i * 28}, 1000 ${330 + i * 20} ` +
      `C 930 ${400 + i * 12}, 892 ${480 + i * 8}, 874 ${556 + i * 4} ` +
      `C 920 ${640 + i * 7}, 990 ${750 + i * 10}, ${1060 + i * 14} 940`;

const flowFieldSvg = () => {
  const leftStyle = [
    ['#3E948B', 1.6, 0.5], ['#8A96D8', 1.2, 0.38], ['#2E8078', 2, 0.55],
    ['#CFE6E1', 1, 0.3], ['url(#flow-blend)', 2.2, 0.6], ['#2E8078', 1.3, 0.35]
  ];
  const rightStyle = [
    ['#BC5A24', 1.8, 0.5], ['#D08A5B', 1.2, 0.35], ['#3E948B', 1.8, 0.5],
    ['#8A96D8', 1.1, 0.3], ['#CFE6E1', 1, 0.32], ['#2E8078', 1.6, 0.45]
  ];
  const line = (d, [stroke, width, opacity]) =>
    `<path class="flow-line" d="${d}" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`;
  const pulse = (d, dur) =>
    `<path class="flow-line flow-pulse" d="${d}" pathLength="1000" stroke-dasharray="16 984" ` +
    `stroke="#EAF6F3" stroke-width="1.6" opacity=".5" style="--dur:${dur}s"/>`;
  const dot = (side, i, r, fill, dur, delay) =>
    `<circle class="flow-dot" r="${r}" fill="${fill}" ` +
    `style="offset-path: path('${flowPath(side, i)}'); --dur:${dur}s; --delay:${delay}s"/>`;

  return (
    `<svg class="flow-field" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">` +
    `<defs><linearGradient id="flow-blend" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="#2E8078"/><stop offset=".55" stop-color="#3E948B"/><stop offset="1" stop-color="#BC5A24"/>` +
    `</linearGradient></defs>` +
    `<ellipse class="flow-contour" cx="870" cy="560" rx="430" ry="250" transform="rotate(-14 870 560)" fill="none" stroke="rgba(255,255,255,.03)"/>` +
    `<ellipse class="flow-contour" cx="870" cy="560" rx="320" ry="180" transform="rotate(-14 870 560)" fill="none" stroke="rgba(255,255,255,.04)" style="animation-delay:-4s"/>` +
    `<ellipse class="flow-contour" cx="870" cy="560" rx="220" ry="120" transform="rotate(-14 870 560)" fill="none" stroke="rgba(255,255,255,.05)" style="animation-delay:-9s"/>` +
    `<path class="flow-line" d="${flowPath('L', 2)}" stroke="#2E8078" stroke-width="40" opacity=".05"/>` +
    `<path class="flow-line" d="${flowPath('R', 2)}" stroke="#BC5A24" stroke-width="34" opacity=".04"/>` +
    leftStyle.map((style, i) => line(flowPath('L', i), style)).join('') +
    rightStyle.map((style, i) => line(flowPath('R', i), style)).join('') +
    pulse(flowPath('L', 0), 26) + pulse(flowPath('L', 4), 34) +
    pulse(flowPath('R', 0), 30) + pulse(flowPath('R', 2), 38) +
    dot('L', 1, 2.6, '#EAF4F2', 30, -3) + dot('L', 3, 2.2, '#CFE6E1', 40, -15) +
    dot('L', 4, 3, '#EAF4F2', 36, -11) + dot('R', 1, 2.4, '#EBA173', 32, -7) +
    dot('R', 3, 2, '#EAF4F2', 44, -19) + dot('R', 4, 2.8, '#EBA173', 38, -25) +
    `</svg>` +
    `<span class="flow-label flow-label--au" aria-hidden="true">Australia</span>` +
    `<span class="flow-label flow-label--in" aria-hidden="true">India</span>`
  );
};

/**
 * The brand mark: the confluence, reduced to a glyph. Two streams — teal
 * from the left, copper from the right, the same pair as the hero artwork —
 * meet and continue as one line. The container around it is the editable
 * part: content/brand.json picks a shape in the CMS, and every option keeps
 * identical line work, so the mark changes clothes without changing meaning.
 *
 * Two variants: 'chrome' is sized by CSS and drawn for the dark rail;
 * 'favicon' is a standalone file with its own light/dark styling, because a
 * browser tab is the one place the site's background colour doesn't reach.
 */
export const BRAND_SHAPES = ['drop', 'circle', 'squircle', 'pebble'];

export const brandMarkSvg = (shape = 'drop', variant = 'chrome') => {
  const container = {
    circle: '<circle cx="24" cy="24" r="21.5"/>',
    squircle: '<rect x="4.5" y="4.5" width="39" height="39" rx="13.5"/>',
    pebble: '<path d="M25.5 4.5 C35.5 5.5 44 13 43 24.5 C42 35.5 34.5 43.5 23 43.5 C12 43.5 4.5 35 5 23.5 C5.5 12.5 15.5 3.5 25.5 4.5 Z"/>',
    drop: '<path d="M24 3.5 C24 3.5 8.5 20.5 8.5 30 A15.5 15.5 0 0 0 39.5 30 C39.5 20.5 24 3.5 24 3.5 Z"/>'
  }[BRAND_SHAPES.includes(shape) ? shape : 'drop'];

  // The droplet narrows towards its apex, so its streams start closer in.
  const wide = shape !== 'drop';
  const left = wide
    ? 'M14.5 15.5 C19 19.5, 21.8 23.5, 23.9 27.5'
    : 'M17.5 18 C21 21.5, 22.8 24.5, 23.9 28';
  const right = wide
    ? 'M33.5 13.5 C29 18.5, 26 23, 24.1 27.5'
    : 'M30.5 16.5 C27.5 20.5, 25.5 24, 24.1 28';
  const merged = wide
    ? 'M24 27 C23.6 31, 24.3 34.5, 24 38.5'
    : 'M24 27.5 C23.6 31, 24.3 34, 24 38';

  const favicon = variant === 'favicon';
  const frame = favicon ? 'var(--frame)' : 'rgba(255,255,255,.55)';
  const flow = favicon ? 'var(--flow)' : '#EAF4F2';
  const faviconStyle = favicon
    ? '<style>:root{--frame:#0A1A24;--flow:#0A1A24}@media(prefers-color-scheme:dark){:root{--frame:rgba(255,255,255,.75);--flow:#EAF4F2}}</style>'
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"${favicon ? ' width="48" height="48"' : ''} fill="none" aria-hidden="true" focusable="false">` +
    faviconStyle +
    `<g stroke="${frame}" stroke-width="1.6">${container}</g>` +
    `<g stroke-width="2.4" stroke-linecap="round">` +
    `<path d="${left}" stroke="#7FB8AE"/>` +
    `<path d="${right}" stroke="#D08A5B"/>` +
    `<path d="${merged}" stroke="${flow}"/>` +
    `</g></svg>`;
};

const standardHead = (document, page, { index, total }) => {
  const head = el(document, 'header', { class: 'page-head' });
  head.appendChild(el(document, 'span', {
    class: 'section-index',
    text: String(index).padStart(2, '0') + ' / ' + String(total).padStart(2, '0')
  }));
  const inner = el(document, 'div');
  const intro = page.intro || {};
  if (intro.eyebrow != null) inner.appendChild(el(document, 'p', { class: 'eyebrow', text: intro.eyebrow }));
  inner.appendChild(el(document, 'h1', { text: intro.title || page.menuName }));
  if (intro.lede != null) inner.appendChild(el(document, 'p', { class: 'lede', text: intro.lede }));
  head.appendChild(inner);
  applyTextControls(head, intro);
  applyCoverControls(head, page.heroImage);
  return head;
};

const homeHero = (document, page, ctx) => {
  const hero = page.hero || {};
  const intro = page.intro || {};
  const t = (path) => hero.i18n?.[path];

  const wrap = el(document, 'div', { class: 'home-hero' });
  const copy = el(document, 'div', { class: 'hero-copy' });
  const inner = el(document, 'div', { class: 'hero-copy-inner' });
  inner.appendChild(el(document, 'p', { class: 'eyebrow', text: intro.eyebrow }));
  inner.appendChild(multiline(document, el(document, 'h1'), intro.title));
  inner.appendChild(el(document, 'p', { class: 'lede', text: intro.lede }));
  const actions = el(document, 'div', { class: 'hero-actions' });
  (hero.actions || []).forEach((a) => actions.appendChild(pageLink(document, ctx, a)));
  inner.appendChild(actions);
  copy.appendChild(inner);
  applyTextControls(copy, intro);
  wrap.appendChild(copy);

  // A photo makes the classic photographic hero; no photo brings up the
  // animated confluence artwork instead. The CMS's "Header photo" field is
  // the switch, so editors can move between the two without a deploy.
  const stage = el(document, 'div', { class: 'hero-image-stage' });
  if (hero.stageAlt) stage.setAttribute('aria-label', hero.stageAlt);
  if (page.heroImage?.image) {
    stage.appendChild(photo(document, page.heroImage, { alt: hero.imageAlt || '', lazy: false, className: 'hero-image-main' }));
    if (hero.label) {
      stage.appendChild(multiline(document, el(document, 'div', { class: 'hero-image-label', key: t('label') }), hero.label));
    }
    if (hero.caption) {
      stage.appendChild(multiline(document, el(document, 'div', { class: 'hero-image-caption', key: t('caption') }), hero.caption));
    }
  } else {
    stage.className = 'hero-image-stage hero-flow-stage';
    if (!hero.stageAlt) stage.setAttribute('aria-hidden', 'true');
    stage.innerHTML = flowFieldSvg();
  }
  const index = el(document, 'div', { class: 'hero-image-index', text: '↓' });
  index.setAttribute('aria-hidden', 'true');
  stage.appendChild(index);
  wrap.appendChild(stage);
  return wrap;
};

/**
 * Render one page into a <section class="panel"> element.
 * ctx: { index, total, urlFor(pageId) }
 */
export function renderPage(document, page, ctx) {
  const section = el(document, 'section', { class: 'panel' });
  section.id = 'panel-' + page.slug;
  section.setAttribute('data-panel', page.slug);
  section.setAttribute('role', 'tabpanel');
  section.setAttribute('tabindex', '0');

  // Collection data and entryUrl are forwarded so the directory blocks can
  // reach the researcher and partner records; everything else is MARVI's
  // original per-block context.
  const blockCtx = (block, i) => ({
    urlFor: ctx.urlFor,
    entryUrl: ctx.entryUrl,
    people: ctx.people,
    partners: ctx.partners,
    t: (path) => block.i18n?.[path] || `page.${page.slug}.b${i}.${path}`
  });

  const core = [];
  const flex = [];
  (page.blocks || []).forEach((block, i) => {
    const render = BLOCKS[block?.type];
    if (!render) return;
    const node = render(document, block, blockCtx(block, i));
    if (!node) return;
    (FLEX_TYPES.has(block.type) ? flex : core).push(node);
  });

  // The page's in-page navigation mode ("jump" | "tabs" | "collapse"), chosen
  // in the CMS. Set before the home branch returns, or the home template can
  // never opt in — app.mjs reads this attribute to decide what to build.
  if (page.sectionNav && page.sectionNav !== 'none') {
    section.setAttribute('data-section-nav', page.sectionNav);
    // The opening content becomes its own first tab, named here. 'off' leaves
    // it loose above the tabs, which is right when it is a single line of
    // scene-setting rather than a section in its own right.
    if (page.introTab) section.setAttribute('data-intro-tab', page.introTab);
    // Collapsible pages can open with everything shut rather than the first
    // section showing.
    if (page.startCollapsed) section.setAttribute('data-start-collapsed', '');
  }

  if (page.template === 'home') {
    section.appendChild(homeHero(document, page, ctx));
    core.forEach((n) => section.appendChild(n));
    if (flex.length) section.appendChild(flexWrap(document, flex));
    return section;
  }

  const wrap = el(document, 'div', { class: 'content-wrap' });
  wrap.appendChild(standardHead(document, page, ctx));
  const body = el(document, 'div', { class: 'section-body' });
  core.forEach((n) => body.appendChild(n));
  wrap.appendChild(body);
  if (flex.length) wrap.appendChild(flexWrap(document, flex));
  section.appendChild(wrap);
  return section;
}

const flexWrap = (document, nodes) => {
  const wrap = el(document, 'div', { class: 'cms-sections' });
  nodes.forEach((n) => wrap.appendChild(n));
  return wrap;
};

/* ---------- collection detail pages ---------- */

/**
 * AIWC has content MARVI does not: 108 researchers and 33 partner
 * institutions, each with enough substance to deserve its own address.
 * These render at /people/<slug>/ and /partners/<slug>/ using the same
 * classes as the authored pages, so they inherit the stylesheet rather than
 * introducing a second visual language.
 */

const backLink = (document, label, href) => {
  const p = el(document, 'p', { class: 'eyebrow' });
  const a = el(document, 'a', { text: '← ' + label });
  a.href = href;
  p.appendChild(a);
  return p;
};

/** A labelled fact list — institution, qualification, contact, profiles. */
const factList = (document, rows) => {
  const dl = el(document, 'dl', { class: 'fact-list' });
  rows.filter(([, value]) => value).forEach(([label, value, href]) => {
    const wrap = el(document, 'div');
    wrap.appendChild(el(document, 'dt', { class: 'meta', text: label }));
    const dd = el(document, 'dd');
    if (href) {
      const a = el(document, 'a', { text: value });
      a.href = href;
      if (/^https?:/.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
      }
      dd.appendChild(a);
    } else {
      dd.textContent = value;
    }
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  });
  return dl;
};

const trim = (url, max = 44) =>
  url.replace(/^https?:\/\/(www\.)?/, '').slice(0, max) + (url.length > max + 12 ? '…' : '');

/** One researcher. */
export function renderPerson(document, person, ctx) {
  const section = el(document, 'section', { class: 'panel' });
  section.id = 'panel-person';
  section.setAttribute('data-panel', 'people/' + person.slug);

  const wrap = el(document, 'div', { class: 'content-wrap' });

  const head = el(document, 'header', { class: 'page-head' });
  const inner = el(document, 'div');
  inner.appendChild(backLink(
    document,
    person.country === 'Australia' ? 'Our people in Australia' : 'Our people in India',
    ctx.urlFor('people')
  ));
  inner.appendChild(el(document, 'h1', { text: person.name }));
  const sub = [person.designation, person.institute].filter(Boolean).join(' · ');
  if (sub) inner.appendChild(el(document, 'p', { class: 'lede', text: sub }));
  head.appendChild(inner);
  wrap.appendChild(head);

  const body = el(document, 'div', { class: 'section-body' });
  const grid = el(document, 'div', { class: 'split profile-split' });

  /* left: portrait + facts */
  const aside = el(document, 'div', { class: 'split-col' });
  const shot = el(document, 'figure', { class: 'profile-portrait' });
  shot.appendChild(portraitImage(document, person, { lazy: false }));
  aside.appendChild(shot);
  aside.appendChild(factList(document, [
    ['Institution', person.institute],
    ['Country', person.country],
    ['Qualification', person.qualification],
    ['Email', person.email, person.email ? 'mailto:' + person.email : null],
    ['Staff page', person.homepage ? trim(person.homepage) : null, person.homepage],
    ...(person.profiles || []).map((url) => [
      /scholar/.test(url) ? 'Google Scholar' : /orcid/.test(url) ? 'ORCID'
        : /researchgate/.test(url) ? 'ResearchGate' : 'Research profile',
      trim(url),
      url,
    ]),
  ]));
  grid.appendChild(aside);

  /* right: interests, biography, then each authored section */
  const main = el(document, 'div', { class: 'split-col' });
  const prose = el(document, 'div', { class: 'prose' });
  if (person.interests) {
    prose.appendChild(el(document, 'h2', { text: 'Areas of interest' }));
    prose.appendChild(el(document, 'p', { class: 'large', text: person.interests }));
  }
  if (person.bio?.length) {
    prose.appendChild(el(document, 'h2', { text: 'Biography' }));
    person.bio.forEach((p) => prose.appendChild(el(document, 'p', { text: p })));
  }
  main.appendChild(prose);

  (person.sections || []).forEach((sec) => {
    const list = el(document, 'div', { class: 'pub-list' });
    list.appendChild(el(document, 'h2', { text: sec.title }));
    sec.items.forEach((item) => {
      const card = el(document, 'article', { class: 'pub-card' });
      card.appendChild(el(document, 'p', { text: item }));
      list.appendChild(card);
    });
    main.appendChild(list);
  });
  grid.appendChild(main);

  body.appendChild(grid);
  wrap.appendChild(body);
  section.appendChild(wrap);
  return section;
}

/** One partner institution, with the researchers based there. */
export function renderPartner(document, partner, ctx) {
  const section = el(document, 'section', { class: 'panel' });
  section.id = 'panel-partner';
  section.setAttribute('data-panel', 'partners/' + partner.slug);

  const wrap = el(document, 'div', { class: 'content-wrap' });

  const head = el(document, 'header', { class: 'page-head' });
  const inner = el(document, 'div');
  inner.appendChild(backLink(document, 'All partners', ctx.urlFor('partners')));
  inner.appendChild(el(document, 'h1', { text: partner.name }));
  inner.appendChild(el(document, 'p', { class: 'lede', text: partner.country + ' · Partner institution' }));
  head.appendChild(inner);
  wrap.appendChild(head);

  const body = el(document, 'div', { class: 'section-body' });

  const top = el(document, 'div', { class: 'split' });
  const aside = el(document, 'div', { class: 'split-col' });
  const logo = el(document, 'figure', { class: 'partner-logo' });
  const img = photo(document, partner.logo || {}, { alt: partner.name, lazy: false });
  if (img) logo.appendChild(img);
  aside.appendChild(logo);
  top.appendChild(aside);

  const main = el(document, 'div', { class: 'split-col' });
  const prose = el(document, 'div', { class: 'prose' });
  (partner.body || []).forEach((p) => prose.appendChild(el(document, 'p', { text: p })));
  main.appendChild(prose);
  (partner.sections || []).forEach((sec) => {
    const list = el(document, 'div', { class: 'pub-list' });
    list.appendChild(el(document, 'h2', { text: sec.title }));
    sec.items.forEach((item) => {
      const card = el(document, 'article', { class: 'pub-card' });
      card.appendChild(el(document, 'p', { text: item }));
      list.appendChild(card);
    });
    main.appendChild(list);
  });
  top.appendChild(main);
  body.appendChild(top);

  const here = (ctx.people || []).filter((p) => p.institute === partner.instituteName);
  if (here.length) {
    body.appendChild(el(document, 'h2', { text: 'Researchers at ' + partner.name }));
    const band = el(document, 'div', { class: 'portrait-band' });
    here.forEach((person) => {
      const card = el(document, 'a', { class: 'portrait-card' });
      card.href = ctx.entryUrl('people', person.slug);
      card.appendChild(portraitImage(document, person));
      const info = el(document, 'span', { class: 'portrait-card-info' });
      info.appendChild(el(document, 'strong', { text: person.name }));
      if (person.designation) info.appendChild(el(document, 'span', { text: person.designation }));
      card.appendChild(info);
      band.appendChild(card);
    });
    body.appendChild(band);
  }

  wrap.appendChild(body);
  section.appendChild(wrap);
  return section;
}
