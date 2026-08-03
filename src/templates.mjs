/**
 * Every block type the site can render, and the page templates that arrange
 * them. This module is the ONLY place markup is produced — the build and the
 * CMS preview both import it, so a preview cannot drift from the real page.
 *
 * Convention: a renderer takes (document, block, ctx) and returns one node.
 * ctx carries { urlFor, entryUrl, asset, t, people, partners } — everything a
 * block might need to link out or resolve an image.
 */

/* ── tiny DOM helpers ───────────────────────────────────────────────── */

const el = (document, tag, opts = {}) => {
  const node = document.createElement(tag);
  if (opts.class) node.setAttribute('class', opts.class);
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.html != null) node.innerHTML = opts.html;
  for (const [k, v] of Object.entries(opts.attrs || {})) {
    if (v != null && v !== false) node.setAttribute(k, String(v));
  }
  return node;
};

/** Newlines in authored copy become real line breaks, not collapsed space. */
const multiline = (document, node, value) => {
  const parts = String(value ?? '').split('\n');
  parts.forEach((part, i) => {
    if (i) node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode(part));
  });
  return node;
};

const clamp = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** An <img> for a photo entry, honouring focal point and lazy loading. */
const photo = (document, entry, { alt = '', lazy = true, className } = {}) => {
  if (!entry) return null;
  const src = typeof entry === 'string' ? entry : entry.image;
  if (!src) return null;
  const img = el(document, 'img', {
    class: className,
    attrs: {
      src,
      alt,
      loading: lazy ? 'lazy' : 'eager',
      decoding: 'async',
      ...(entry.width ? { width: entry.width, height: entry.height } : {}),
    },
  });
  const x = clamp(entry.positionX, 0, 100, null);
  const y = clamp(entry.positionY, 0, 100, null);
  if (x != null || y != null) img.setAttribute('style', `object-position:${x ?? 50}% ${y ?? 50}%`);
  return img;
};

/** The datum line: a tick, a label, and a rule running off to the right. */
const datum = (document, label) => {
  if (!label) return null;
  const wrap = el(document, 'div', { class: 'datum' });
  const text = el(document, 'span', { class: 'datum-label' });
  // "01 — Research" renders the number in the accent colour.
  const m = String(label).match(/^(\S+)\s+—\s+(.*)$/);
  if (m) {
    text.appendChild(el(document, 'b', { text: m[1] }));
    text.appendChild(document.createTextNode(' — ' + m[2]));
  } else {
    text.textContent = label;
  }
  wrap.appendChild(text);
  return wrap;
};

const wrapIn = (document, node, { tight = false } = {}) => {
  const w = el(document, 'div', { class: tight ? 'wrap-tight' : 'wrap' });
  w.appendChild(node);
  return w;
};

/** A band is one full-width horizontal slab with a tone. */
const band = (document, block, inner, extraClass = '') => {
  const tone = block.tone || 'paper';
  const classes = ['band'];
  if (block.compact) classes.push('band-tight');
  if (tone === 'deep') classes.push('is-dark');
  if (tone === 'ink') classes.push('is-ink');
  if (tone === 'sand') classes.push('is-sand');
  if (extraClass) classes.push(extraClass);
  const section = el(document, 'section', { class: classes.join(' ') });
  section.appendChild(wrapIn(document, inner, { tight: !!block.tight }));
  return section;
};

/** Heading + lede pair used at the top of most blocks. */
const headOf = (document, block, ctx) => {
  if (!block.title && !block.lede && !block.label) return null;
  const head = el(document, 'div', { class: block.lede && block.title ? 'head head-split' : 'head' });
  const left = el(document, 'div');
  const d = datum(document, block.label);
  if (d) left.appendChild(d);
  if (block.title) {
    const h = el(document, 'h2', { class: 'display ' + (block.titleSize || 'd-lg') });
    multiline(document, h, block.title);
    h.setAttribute('data-i18n', ctx.t('title'));
    left.appendChild(h);
  }
  head.appendChild(left);
  if (block.lede) {
    const p = el(document, 'p', { class: 'lede', text: block.lede, attrs: { 'data-i18n': ctx.t('lede') } });
    head.appendChild(p);
  }
  return head;
};

const linkAttrs = (href) =>
  /^https?:/.test(href) ? { href, target: '_blank', rel: 'noopener' } : { href };

const actionRow = (document, actions = [], ctx, className = 'hero-actions') => {
  if (!actions.length) return null;
  const row = el(document, 'div', { class: className });
  actions.forEach((a, i) => {
    const href = a.page ? ctx.urlFor(a.page) : a.href || '#';
    const link = el(document, 'a', {
      class: 'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost'),
      attrs: { ...linkAttrs(href), ...(a.page ? { 'data-open': a.page } : {}) },
    });
    link.appendChild(el(document, 'span', { text: a.label, attrs: { 'data-i18n': ctx.t(`actions.${i}.label`) } }));
    link.appendChild(el(document, 'span', { class: 'arrow', text: '→' }));
    row.appendChild(link);
  });
  return row;
};

/** Paragraph run with optional lists, from the `body` array shape. */
const proseBody = (document, body = [], ctx, keyPrefix = 'body') => {
  const holder = el(document, 'div', { class: 'prose' });
  body.forEach((item, i) => {
    if (typeof item === 'string') {
      holder.appendChild(el(document, 'p', { text: item, attrs: { 'data-i18n': ctx.t(`${keyPrefix}.${i}`) } }));
      return;
    }
    if (item.kind === 'list' || Array.isArray(item.items)) {
      const list = el(document, 'ul', { class: 'refs' });
      (item.items || []).forEach((li, j) => {
        list.appendChild(el(document, 'li', { text: li, attrs: { 'data-i18n': ctx.t(`${keyPrefix}.${i}.items.${j}`) } }));
      });
      holder.appendChild(list);
      return;
    }
    if (item.kind === 'h') {
      holder.appendChild(el(document, 'h3', {
        class: 'display d-sm',
        text: item.text,
        attrs: { 'data-i18n': ctx.t(`${keyPrefix}.${i}`), style: 'margin:1.5em 0 .55em' },
      }));
      return;
    }
    holder.appendChild(el(document, 'p', { text: item.text, attrs: { 'data-i18n': ctx.t(`${keyPrefix}.${i}`) } }));
  });
  return holder;
};

/* ── blocks ─────────────────────────────────────────────────────────── */

const BLOCKS = {
  /** A single large claim. The page's punctuation. */
  statement(document, block, ctx) {
    const holder = el(document, 'div', { class: 'statement reveal' });
    const d = datum(document, block.label);
    if (d) holder.appendChild(d);
    const quote = el(document, 'blockquote');
    multiline(document, quote, block.quote);
    quote.setAttribute('data-i18n', ctx.t('quote'));
    holder.appendChild(quote);
    if (block.cite) {
      holder.appendChild(el(document, 'cite', { text: block.cite, attrs: { 'data-i18n': ctx.t('cite') } }));
    }
    return band(document, block, holder);
  },

  /** The number strata — scale, stated plainly. */
  measures(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const grid = el(document, 'div', { class: 'measures reveal' });
    (block.items || []).forEach((item, i) => {
      const cell = el(document, 'div', { class: 'measure' + (item.side ? ' ' + item.side : '') });
      cell.appendChild(el(document, 'b', { text: item.value }));
      cell.appendChild(el(document, 'span', { text: item.label, attrs: { 'data-i18n': ctx.t(`items.${i}.label`) } }));
      grid.appendChild(cell);
    });
    holder.appendChild(grid);
    return band(document, block, holder);
  },

  /** Heading, lede and running copy. */
  prose(document, block, ctx) {
    const holder = el(document, 'div', { class: 'reveal' });
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    holder.appendChild(proseBody(document, block.body, ctx));
    return band(document, block, holder);
  },

  /** Two columns: a short left rail of copy against a longer right column. */
  cols(document, block, ctx) {
    const holder = el(document, 'div', { class: 'reveal' });
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const grid = el(document, 'div', { class: 'cols' + (block.side ? ' cols-side' : '') });
    (block.columns || []).forEach((col, i) => {
      const cell = el(document, 'div');
      if (col.label) cell.appendChild(datum(document, col.label));
      if (col.title) {
        const h = el(document, 'h3', { class: 'display d-md', text: col.title, attrs: { 'data-i18n': ctx.t(`columns.${i}.title`), style: 'margin-bottom:.6em' } });
        cell.appendChild(h);
      }
      cell.appendChild(proseBody(document, col.body, ctx, `columns.${i}.body`));
      grid.appendChild(cell);
    });
    holder.appendChild(grid);
    return band(document, block, holder);
  },

  /** Generic card grid — numbered, optionally linked. */
  cards(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const cols = block.columns === 2 ? 'grid-2' : block.columns === 4 ? 'grid-4' : 'grid-3';
    const grid = el(document, 'div', { class: `grid ${cols} reveal` });
    (block.items || []).forEach((item, i) => {
      const href = item.page ? ctx.urlFor(item.page) : item.href;
      const card = el(document, href ? 'a' : 'article', {
        class: 'card',
        attrs: href ? { ...linkAttrs(href), ...(item.page ? { 'data-open': item.page } : {}) } : {},
      });
      card.appendChild(el(document, 'span', { class: 'card-num', text: item.number || String(i + 1).padStart(2, '0') }));
      card.appendChild(el(document, 'h3', { text: item.title, attrs: { 'data-i18n': ctx.t(`items.${i}.title`) } }));
      if (item.text) card.appendChild(el(document, 'p', { text: item.text, attrs: { 'data-i18n': ctx.t(`items.${i}.text`) } }));
      if (href) {
        const go = el(document, 'span', { class: 'card-go' });
        go.appendChild(el(document, 'span', { text: item.cta || 'Read more', attrs: { 'data-i18n': ctx.t(`items.${i}.cta`) } }));
        go.appendChild(el(document, 'span', { class: 'arrow', text: '→' }));
        card.appendChild(go);
      }
      grid.appendChild(card);
    });
    holder.appendChild(grid);
    return band(document, block, holder);
  },

  /** Photo-led programme cards — the four pillars of the centre. */
  programmes(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const grid = el(document, 'div', { class: 'grid grid-2 reveal' });
    (block.items || []).forEach((item, i) => {
      const href = item.page ? ctx.urlFor(item.page) : item.href;
      const card = el(document, href ? 'a' : 'article', {
        class: 'prog',
        attrs: href ? { ...linkAttrs(href), ...(item.page ? { 'data-open': item.page } : {}) } : {},
      });
      const img = photo(document, item.photo, { alt: item.alt || '' });
      if (img) card.appendChild(img);
      card.appendChild(el(document, 'span', { class: 'card-num', text: item.number || String(i + 1).padStart(2, '0') }));
      card.appendChild(el(document, 'h3', { text: item.title, attrs: { 'data-i18n': ctx.t(`items.${i}.title`) } }));
      if (item.text) card.appendChild(el(document, 'p', { text: item.text, attrs: { 'data-i18n': ctx.t(`items.${i}.text`) } }));
      if (href) {
        const go = el(document, 'span', { class: 'card-go' });
        go.appendChild(el(document, 'span', { text: item.cta || 'Explore', attrs: { 'data-i18n': ctx.t(`items.${i}.cta`) } }));
        go.appendChild(el(document, 'span', { class: 'arrow', text: '→' }));
        card.appendChild(go);
      }
      grid.appendChild(card);
    });
    holder.appendChild(grid);
    return band(document, block, holder);
  },

  /**
   * The researcher directory. Filter chips are rendered as real buttons and
   * every card is a real link, so the page works with JavaScript disabled —
   * the chips simply do nothing until app.mjs wires them up.
   */
  peopleGrid(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);

    const people = ctx.people || [];
    const groups = new Map();
    for (const p of people) {
      if (!p.institute) continue;
      groups.set(p.institute, (groups.get(p.institute) || 0) + 1);
    }

    // Twenty-seven institutions is too many to show as chips without the
    // filter bar out-weighing the directory itself, so country stays as
    // chips (the choice most people make) and institution moves to a select.
    const bar = el(document, 'div', { class: 'directory-bar', attrs: { 'data-people-filters': '' } });

    const chips = el(document, 'div', { class: 'filters', attrs: { style: 'margin:0' } });
    const chip = (label, value, count, pressed) => {
      const b = el(document, 'button', {
        class: 'chip',
        attrs: { type: 'button', 'data-filter': value, 'aria-pressed': pressed ? 'true' : 'false' },
      });
      b.appendChild(el(document, 'span', { text: label }));
      if (count != null) b.appendChild(el(document, 'span', { class: 'n', text: count }));
      return b;
    };
    chips.appendChild(chip('All', 'all', people.length, true));
    chips.appendChild(chip('Australia', 'country:Australia', people.filter((p) => p.country === 'Australia').length));
    chips.appendChild(chip('India', 'country:India', people.filter((p) => p.country === 'India').length));
    bar.appendChild(chips);

    const controls = el(document, 'div', { class: 'directory-controls' });

    const search = el(document, 'div', { class: 'field' });
    search.appendChild(el(document, 'label', { class: 'sr-only', text: 'Search researchers', attrs: { for: 'people-search' } }));
    search.appendChild(el(document, 'input', {
      attrs: { id: 'people-search', type: 'search', placeholder: 'Search name, role or interest…', 'data-people-search': '', autocomplete: 'off' },
    }));
    controls.appendChild(search);

    const instField = el(document, 'div', { class: 'field' });
    instField.appendChild(el(document, 'label', { class: 'sr-only', text: 'Filter by institution', attrs: { for: 'people-inst' } }));
    const select = el(document, 'select', { attrs: { id: 'people-inst', 'data-people-inst': '' } });
    select.appendChild(el(document, 'option', { text: `All institutions (${groups.size})`, attrs: { value: '' } }));
    [...groups.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([name, count]) => select.appendChild(el(document, 'option', { text: `${name} (${count})`, attrs: { value: name } })));
    instField.appendChild(select);
    controls.appendChild(instField);

    bar.appendChild(controls);
    holder.appendChild(bar);
    holder.appendChild(el(document, 'p', { class: 'directory-count', attrs: { 'data-people-count': '' }, text: `Showing all ${people.length} researchers` }));

    const grid = el(document, 'div', { class: 'people-grid', attrs: { 'data-people-grid': '' } });
    for (const p of people) {
      const card = el(document, 'a', {
        class: 'person',
        attrs: {
          href: ctx.entryUrl('people', p.slug),
          'data-country': p.country,
          'data-inst': p.institute,
          // One lower-cased haystack so the search is a single substring
          // test per card rather than four field comparisons.
          'data-search': [p.name, p.designation, p.institute, p.interests].filter(Boolean).join(' ').toLowerCase(),
        },
      });
      const shot = el(document, 'div', { class: 'person-shot' });
      const img = photo(document, p.photo, { alt: p.name });
      if (img) shot.appendChild(img);
      shot.appendChild(el(document, 'span', { class: 'person-flag ' + (p.country === 'Australia' ? 'au' : 'in') }));
      card.appendChild(shot);
      const body = el(document, 'div', { class: 'person-body' });
      body.appendChild(el(document, 'span', { class: 'person-name', text: p.name }));
      if (p.designation) body.appendChild(el(document, 'span', { class: 'person-role', text: p.designation }));
      if (p.institute) body.appendChild(el(document, 'span', { class: 'person-inst', text: p.institute }));
      card.appendChild(body);
      grid.appendChild(card);
    }
    holder.appendChild(grid);

    const empty = el(document, 'p', {
      class: 'lede',
      text: 'No researchers match that filter.',
      attrs: { 'data-people-empty': '', hidden: '', style: 'margin-top:26px' },
    });
    holder.appendChild(empty);
    return band(document, block, holder);
  },

  /** Partner logos as a dense wall — scale at a glance. */
  logoWall(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const wall = el(document, 'div', { class: 'logo-wall reveal' });
    const list = block.country
      ? (ctx.partners || []).filter((p) => p.country === block.country)
      : ctx.partners || [];
    for (const p of list) {
      const cell = el(document, 'a', { class: 'logo-cell', attrs: { href: ctx.entryUrl('partners', p.slug), title: p.name } });
      const img = photo(document, p.logo, { alt: p.name });
      if (img) cell.appendChild(img);
      else cell.appendChild(el(document, 'span', { class: 'mono', text: p.short || p.name }));
      wall.appendChild(cell);
    }
    holder.appendChild(wall);
    return band(document, block, holder);
  },

  /** Partner list with logo, name and the first line of their description. */
  partnerRows(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const list = block.country
      ? (ctx.partners || []).filter((p) => p.country === block.country)
      : ctx.partners || [];
    const rows = el(document, 'div', { class: 'reveal' });
    for (const p of list) {
      const row = el(document, 'a', { class: 'partner-row', attrs: { href: ctx.entryUrl('partners', p.slug) } });
      const logo = el(document, 'div', { class: 'partner-logo' });
      const img = photo(document, p.logo, { alt: '' });
      if (img) logo.appendChild(img);
      row.appendChild(logo);
      const body = el(document, 'div');
      body.appendChild(el(document, 'h3', { text: p.name }));
      if (p.summary) body.appendChild(el(document, 'p', { text: p.summary }));
      row.appendChild(body);
      rows.appendChild(row);
    }
    holder.appendChild(rows);
    return band(document, block, holder);
  },

  /** Dated milestones. */
  timeline(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const list = el(document, 'div', { class: 'timeline reveal' });
    (block.items || []).forEach((item, i) => {
      const cell = el(document, 'div', { class: 'tl-item' });
      cell.appendChild(el(document, 'span', { class: 'tl-year', text: item.year }));
      cell.appendChild(el(document, 'h3', { text: item.title, attrs: { 'data-i18n': ctx.t(`items.${i}.title`) } }));
      if (item.text) cell.appendChild(el(document, 'p', { text: item.text, attrs: { 'data-i18n': ctx.t(`items.${i}.text`) } }));
      list.appendChild(cell);
    });
    holder.appendChild(list);
    return band(document, block, holder);
  },

  /** Numbered reference list — journal articles, conference papers, books. */
  pubList(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const list = el(document, 'div', { class: 'pub-list reveal' });
    (block.items || []).forEach((item, i) => {
      const row = el(document, 'div', { class: 'pub' });
      row.appendChild(el(document, 'span', { class: 'pub-n', text: String(i + 1).padStart(3, '0') }));
      const body = el(document, 'div');
      const text = typeof item === 'string' ? item : item.text;
      const href = typeof item === 'object' ? item.href : null;
      body.appendChild(document.createTextNode(text));
      if (href) {
        body.appendChild(document.createTextNode(' '));
        body.appendChild(el(document, 'a', { text: href.replace(/^https?:\/\//, ''), attrs: linkAttrs(href) }));
      }
      row.appendChild(body);
      list.appendChild(row);
    });
    holder.appendChild(list);
    return band(document, block, holder);
  },

  /** Full-bleed photograph carrying a heading. A breath between chapters. */
  frame(document, block, ctx) {
    const section = el(document, 'section', { class: 'frame' });
    const img = photo(document, block.photo, { alt: block.alt || '', lazy: false });
    if (img) section.appendChild(img);
    const inner = el(document, 'div');
    const d = datum(document, block.label);
    if (d) {
      d.setAttribute('style', 'color:rgba(255,255,255,.72)');
      inner.appendChild(d);
    }
    if (block.title) {
      const h = el(document, 'h2', { class: 'display ' + (block.titleSize || 'd-lg'), attrs: { 'data-i18n': ctx.t('title') } });
      multiline(document, h, block.title);
      inner.appendChild(h);
    }
    if (block.lede) {
      inner.appendChild(el(document, 'p', {
        class: 'lede',
        text: block.lede,
        attrs: { 'data-i18n': ctx.t('lede'), style: 'margin-top:18px;color:rgba(255,255,255,.82)' },
      }));
    }
    const actions = actionRow(document, block.actions, ctx);
    if (actions) inner.appendChild(actions);
    section.appendChild(wrapIn(document, inner));
    return section;
  },

  /** A strip of square photographs. */
  ribbon(document, block, ctx) {
    const strip = el(document, 'div', { class: 'ribbon' });
    (block.items || []).forEach((item) => {
      const fig = el(document, 'div', { class: 'shot' });
      const img = photo(document, item, { alt: item.alt || '' });
      if (img) fig.appendChild(img);
      strip.appendChild(fig);
    });
    const section = el(document, 'section', { class: 'band band-tight' + (block.tone === 'deep' ? ' is-dark' : '') });
    section.appendChild(strip);
    return section;
  },

  /** Two captioned photographs side by side. */
  shotPair(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const pair = el(document, 'div', { class: 'shot-pair reveal' });
    (block.items || []).forEach((item, i) => {
      const fig = el(document, 'figure');
      const shot = el(document, 'div', { class: 'shot ' + (item.ratio || 'ratio-wide') });
      const img = photo(document, item, { alt: item.alt || '' });
      if (img) shot.appendChild(img);
      fig.appendChild(shot);
      if (item.caption) {
        fig.appendChild(el(document, 'figcaption', { text: item.caption, attrs: { 'data-i18n': ctx.t(`items.${i}.caption`) } }));
      }
      pair.appendChild(fig);
    });
    holder.appendChild(pair);
    return band(document, block, holder);
  },

  /** A call to act, in a coloured slab. */
  callout(document, block, ctx) {
    const box = el(document, 'div', { class: 'callout reveal' + (block.accent ? ' tone-' + block.accent : '') });
    const d = datum(document, block.label);
    if (d) box.appendChild(d);
    if (block.title) box.appendChild(el(document, 'h3', { text: block.title, attrs: { 'data-i18n': ctx.t('title') } }));
    if (block.text) box.appendChild(el(document, 'p', { text: block.text, attrs: { 'data-i18n': ctx.t('text') } }));
    const actions = actionRow(document, block.actions, ctx, 'callout-actions');
    if (actions) box.appendChild(actions);
    return band(document, block, box);
  },

  /** Australia / India contact panels. */
  contactCards(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const grid = el(document, 'div', { class: 'grid grid-2 reveal' });
    (block.items || []).forEach((group, gi) => {
      const card = el(document, 'div', { class: 'contact-card ' + (group.country === 'Australia' ? 'au' : 'in') });
      card.appendChild(el(document, 'span', { class: 'flagline' }));
      card.appendChild(el(document, 'h3', { text: group.country }));
      if (group.address) {
        card.appendChild(el(document, 'p', {
          class: 'person-role',
          text: group.address,
          attrs: { style: 'margin-top:8px' },
        }));
      }
      (group.people || []).forEach((person, pi) => {
        const line = el(document, 'div', { class: 'person-line' });
        line.appendChild(el(document, 'b', { text: person.name }));
        if (person.role) {
          line.appendChild(el(document, 'span', { text: person.role, attrs: { 'data-i18n': ctx.t(`items.${gi}.people.${pi}.role`) } }));
        }
        if (person.email) {
          line.appendChild(el(document, 'a', { text: person.email, attrs: { href: 'mailto:' + person.email } }));
        }
        card.appendChild(line);
      });
      grid.appendChild(card);
    });
    holder.appendChild(grid);
    return band(document, block, holder);
  },

  /** A list of outbound links — videos, flyers, registration forms. */
  linkList(document, block, ctx) {
    const holder = el(document, 'div');
    const head = headOf(document, block, ctx);
    if (head) holder.appendChild(head);
    const list = el(document, 'div', { class: 'reveal' });
    (block.items || []).forEach((item, i) => {
      const row = el(document, 'a', { class: 'partner-row', attrs: linkAttrs(item.href) });
      row.setAttribute('style', 'grid-template-columns:52px minmax(0,1fr)');
      row.appendChild(el(document, 'span', { class: 'pub-n', text: String(i + 1).padStart(2, '0') }));
      const body = el(document, 'div');
      body.appendChild(el(document, 'h3', { text: item.title, attrs: { 'data-i18n': ctx.t(`items.${i}.title`) } }));
      if (item.text) body.appendChild(el(document, 'p', { text: item.text, attrs: { 'data-i18n': ctx.t(`items.${i}.text`) } }));
      row.appendChild(body);
      list.appendChild(row);
    });
    holder.appendChild(list);
    return band(document, block, holder);
  },
};

export const BLOCK_TYPES = Object.keys(BLOCKS);

/* ── page templates ─────────────────────────────────────────────────── */

/** The hero, used only by the home page. */
const homeHero = (document, page, ctx) => {
  const hero = el(document, 'header', { class: 'hero' });
  const art = photo(document, page.heroImage, { alt: page.heroAlt || '', lazy: false });
  if (art) {
    const holder = el(document, 'div', { class: 'hero-art' });
    holder.appendChild(art);
    hero.appendChild(holder);
    hero.appendChild(el(document, 'div', { class: 'hero-veil' }));
  }

  // Two flow fields meeting on a shared datum — the whole thesis, in SVG.
  // Australian streams arrive from above, Indian from below; they converge on
  // one line across the middle and leave together. Each is drawn twice: a
  // steady line, and a `pulse` copy that carries a travelling highlight.
  const auPath = (i) =>
    `M-40 ${118 + i * 40}C240 ${118 + i * 40} 320 ${332 + i * 7} 600 ${348 + i * 3.5}` +
    `S980 ${366 + i * 7} 1240 ${366 + i * 7}`;
  const inPath = (i) =>
    `M-40 ${628 - i * 40}C240 ${628 - i * 40} 320 ${372 - i * 7} 600 ${356 - i * 3.5}` +
    `S980 ${338 - i * 7} 1240 ${338 - i * 7}`;

  const streams = [0, 1, 2, 3, 4, 5];
  hero.appendChild(el(document, 'div', {
    class: 'confluence',
    attrs: { 'aria-hidden': 'true' },
    html:
      '<svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">' +
      streams.map((i) => `<path class="flow-au" d="${auPath(i)}" opacity="${(0.34 - i * 0.04).toFixed(2)}"/>`).join('') +
      streams.map((i) => `<path class="flow-in" d="${inPath(i)}" opacity="${(0.34 - i * 0.04).toFixed(2)}"/>`).join('') +
      streams.slice(0, 4).map((i) =>
        `<path class="flow-au pulse" d="${auPath(i)}" opacity="${(0.6 - i * 0.1).toFixed(2)}" style="animation-delay:${(i * 1.7).toFixed(1)}s"/>`
      ).join('') +
      streams.slice(0, 4).map((i) =>
        `<path class="flow-in pulse" d="${inPath(i)}" opacity="${(0.6 - i * 0.1).toFixed(2)}" style="animation-delay:${(i * 1.7 + 0.9).toFixed(1)}s"/>`
      ).join('') +
      '</svg>',
  }));

  const inner = el(document, 'div');
  const intro = page.intro || {};
  if (intro.eyebrow) {
    inner.appendChild(el(document, 'p', { class: 'eyebrow hero-eyebrow', text: intro.eyebrow, attrs: { 'data-i18n': 'home.eyebrow' } }));
  }
  const h1 = el(document, 'h1', { class: 'display d-xl', attrs: { 'data-i18n': 'home.title' } });
  multiline(document, h1, intro.title || '');
  inner.appendChild(h1);
  if (intro.lede) {
    inner.appendChild(el(document, 'p', { class: 'lede', text: intro.lede, attrs: { 'data-i18n': 'home.lede' } }));
  }
  const actions = actionRow(document, page.actions, ctx);
  if (actions) inner.appendChild(actions);
  hero.appendChild(wrapIn(document, inner));
  return hero;
};

/** The masthead for every page that is not the home page. */
const standardHead = (document, page, ctx) => {
  const head = el(document, 'header', { class: 'page-head' + (page.heroImage?.image ? ' has-art' : '') });
  const art = photo(document, page.heroImage, { alt: '', lazy: false });
  if (art) head.appendChild(art);
  const inner = el(document, 'div');
  const intro = page.intro || {};
  const index = el(document, 'p', { class: 'eyebrow index' });
  index.appendChild(el(document, 'span', { text: intro.eyebrow || page.menuName, attrs: { 'data-i18n': `${page.slug}.eyebrow` } }));
  inner.appendChild(index);
  const h1 = el(document, 'h1', { class: 'display d-lg', attrs: { 'data-i18n': `${page.slug}.title` } });
  multiline(document, h1, intro.title || page.menuName);
  inner.appendChild(h1);
  if (intro.lede) {
    inner.appendChild(el(document, 'p', { class: 'lede', text: intro.lede, attrs: { 'data-i18n': `${page.slug}.lede` } }));
  }
  const actions = actionRow(document, page.actions, ctx);
  if (actions) inner.appendChild(actions);
  head.appendChild(wrapIn(document, inner));
  return head;
};

/** Render one page (its head plus every block) into a <section>. */
export function renderPage(document, page, ctx) {
  const section = el(document, 'section', {
    class: 'panel',
    attrs: { id: 'panel-' + page.slug, 'data-panel': page.slug },
  });

  section.appendChild(page.template === 'home' ? homeHero(document, page, ctx) : standardHead(document, page, ctx));

  (page.blocks || []).forEach((block, i) => {
    const render = BLOCKS[block.type];
    if (!render) return;
    const scoped = {
      ...ctx,
      t: (key) => (block.i18n && block.i18n[key]) || `${page.slug}.b${i}.${key}`,
    };
    section.appendChild(render(document, block, scoped));
  });

  return section;
}

/* ── collection detail pages ────────────────────────────────────────── */

/** One researcher: portrait, contact rail, biography, projects, publications. */
export function renderPerson(document, person, ctx) {
  const section = el(document, 'section', {
    class: 'panel',
    attrs: { id: 'panel-person', 'data-panel': 'people/' + person.slug },
  });

  const head = el(document, 'header', { class: 'page-head' });
  const inner = el(document, 'div');
  const back = el(document, 'p', { class: 'eyebrow index' });
  back.appendChild(el(document, 'a', { text: '← ' + (person.country === 'Australia' ? 'Our people in Australia' : 'Our people in India'), attrs: { href: ctx.urlFor('people') } }));
  inner.appendChild(back);
  inner.appendChild(el(document, 'h1', { class: 'display d-lg', text: person.name }));
  if (person.designation) {
    inner.appendChild(el(document, 'p', { class: 'lede', text: [person.designation, person.institute].filter(Boolean).join(' · ') }));
  }
  head.appendChild(wrapIn(document, inner));
  section.appendChild(head);

  const body = el(document, 'div', { class: 'band' });
  const grid = el(document, 'div', { class: 'profile' });

  /* left rail: portrait + facts */
  const aside = el(document, 'div');
  const shot = el(document, 'div', { class: 'profile-shot' });
  const img = photo(document, person.photo, { alt: person.name, lazy: false });
  if (img) shot.appendChild(img);
  aside.appendChild(shot);

  const facts = el(document, 'dl', { class: 'profile-meta' });
  const fact = (label, value, href) => {
    if (!value) return;
    const row = el(document, 'div');
    row.appendChild(el(document, 'dt', { text: label }));
    const dd = el(document, 'dd');
    if (href) dd.appendChild(el(document, 'a', { text: value, attrs: linkAttrs(href) }));
    else dd.textContent = value;
    row.appendChild(dd);
    facts.appendChild(row);
  };
  fact('Institution', person.institute);
  fact('Country', person.country);
  fact('Qualification', person.qualification);
  fact('Email', person.email, person.email ? 'mailto:' + person.email : null);
  fact('Staff page', person.homepage ? person.homepage.replace(/^https?:\/\//, '').slice(0, 46) + (person.homepage.length > 54 ? '…' : '') : null, person.homepage);
  (person.profiles || []).forEach((url) => {
    const kind = /scholar/.test(url) ? 'Google Scholar' : /orcid/.test(url) ? 'ORCID' : /researchgate/.test(url) ? 'ResearchGate' : 'Research profile';
    fact(kind, url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40) + (url.length > 48 ? '…' : ''), url);
  });
  aside.appendChild(facts);
  grid.appendChild(aside);

  /* right column: interests, bio, then each authored section */
  const main = el(document, 'div');
  if (person.interests) {
    main.appendChild(datum(document, 'Areas of interest'));
    main.appendChild(el(document, 'p', { class: 'lede', text: person.interests, attrs: { style: 'margin-bottom:2.2em' } }));
  }
  if (person.bio?.length) {
    main.appendChild(datum(document, 'Biography'));
    const prose = el(document, 'div', { class: 'prose', attrs: { style: 'margin-bottom:2.2em' } });
    person.bio.forEach((p) => prose.appendChild(el(document, 'p', { text: p })));
    main.appendChild(prose);
  }
  (person.sections || []).forEach((sec) => {
    main.appendChild(datum(document, sec.title));
    const list = el(document, 'ul', { class: 'refs', attrs: { style: 'margin-bottom:2.2em' } });
    sec.items.forEach((item) => list.appendChild(el(document, 'li', { text: item })));
    main.appendChild(list);
  });
  grid.appendChild(main);

  body.appendChild(wrapIn(document, grid));
  section.appendChild(body);
  return section;
}

/** One partner institution: logo, description, projects. */
export function renderPartner(document, partner, ctx) {
  const section = el(document, 'section', {
    class: 'panel',
    attrs: { id: 'panel-partner', 'data-panel': 'partners/' + partner.slug },
  });

  const head = el(document, 'header', { class: 'page-head' });
  const inner = el(document, 'div');
  const back = el(document, 'p', { class: 'eyebrow index' });
  back.appendChild(el(document, 'a', { text: '← All partners', attrs: { href: ctx.urlFor('partners') } }));
  inner.appendChild(back);
  inner.appendChild(el(document, 'h1', { class: 'display d-lg', text: partner.name }));
  inner.appendChild(el(document, 'p', { class: 'lede', text: partner.country + ' · Partner institution' }));
  head.appendChild(wrapIn(document, inner));
  section.appendChild(head);

  const body = el(document, 'div', { class: 'band' });
  const grid = el(document, 'div', { class: 'profile' });

  const aside = el(document, 'div');
  const logo = el(document, 'div', { class: 'partner-logo', attrs: { style: 'aspect-ratio:3/2;padding:20px' } });
  const img = photo(document, partner.logo, { alt: partner.name, lazy: false });
  if (img) logo.appendChild(img);
  aside.appendChild(logo);

  const people = (ctx.people || []).filter((p) => p.institute === partner.name);
  if (people.length) {
    const facts = el(document, 'dl', { class: 'profile-meta' });
    const row = el(document, 'div');
    row.appendChild(el(document, 'dt', { text: 'Researchers' }));
    const dd = el(document, 'dd');
    dd.appendChild(el(document, 'a', { text: `${people.length} at this institution →`, attrs: { href: ctx.urlFor('people') + '#' + partner.slug } }));
    row.appendChild(dd);
    facts.appendChild(row);
    aside.appendChild(facts);
  }
  grid.appendChild(aside);

  const main = el(document, 'div');
  if (partner.body?.length) {
    const prose = el(document, 'div', { class: 'prose', attrs: { style: 'margin-bottom:2.2em' } });
    partner.body.forEach((p) => prose.appendChild(el(document, 'p', { text: p })));
    main.appendChild(prose);
  }
  (partner.sections || []).forEach((sec) => {
    main.appendChild(datum(document, sec.title));
    const list = el(document, 'ul', { class: 'refs', attrs: { style: 'margin-bottom:2.2em' } });
    sec.items.forEach((item) => list.appendChild(el(document, 'li', { text: item })));
    main.appendChild(list);
  });
  if (people.length) {
    main.appendChild(datum(document, 'People at ' + partner.name));
    const wall = el(document, 'div', { class: 'people-grid' });
    for (const p of people) {
      const card = el(document, 'a', { class: 'person', attrs: { href: ctx.entryUrl('people', p.slug) } });
      const shot = el(document, 'div', { class: 'person-shot' });
      const pi = photo(document, p.photo, { alt: p.name });
      if (pi) shot.appendChild(pi);
      card.appendChild(shot);
      const pb = el(document, 'div', { class: 'person-body' });
      pb.appendChild(el(document, 'span', { class: 'person-name', text: p.name }));
      if (p.designation) pb.appendChild(el(document, 'span', { class: 'person-role', text: p.designation }));
      card.appendChild(pb);
      wall.appendChild(card);
    }
    main.appendChild(wall);
  }
  grid.appendChild(main);

  body.appendChild(wrapIn(document, grid));
  section.appendChild(body);
  return section;
}
