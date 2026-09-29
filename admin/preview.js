/**
 * Live preview for the CMS — renders the entry you are editing with the exact
 * same renderer the published site uses.
 *
 * This works because src/templates.mjs is isomorphic: it takes a `document`
 * and touches no globals, so the build imports it under linkedom and this
 * file imports it in the browser. One renderer means the preview cannot drift
 * from the real page.
 *
 * The base path is derived from this file's own URL rather than hard-coded,
 * so the preview keeps working if a CNAME later moves the site to a domain
 * root and `base` becomes empty.
 *
 * Loaded as a module by admin/index.html. `window.h` is Decap's hyperscript
 * (Decap 3 exposes `h`, not `React`).
 */

const BASE = new URL('.', import.meta.url).pathname.replace(/\/admin\/$/, '');

const { renderPage, renderPerson, renderPartner, brandMarkSvg } = await import(`${BASE}/assets/templates.mjs`);

// Researchers and partners now live inside the block being edited, so the
// preview gets them for free. The published index is still read as a
// fallback for a page that references them from elsewhere.
const collections = await fetch(`${BASE}/assets/collections.json`)
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);

const PEOPLE = collections?.people ?? [];
const PARTNERS = collections?.partners ?? [];

const { CMS, h } = window;

/* ---------- styles ---------- */

// The site's own CSS, published by the build. Loading it verbatim is what
// makes the preview look like the site rather than an approximation.
CMS.registerPreviewStyle(`${BASE}/assets/site.css`);

// Preview-only corrections: the site's layout offsets content by a fixed rail
// that does not exist inside the preview iframe.
CMS.registerPreviewStyle(
  `
  html, body { margin: 0; background: var(--paper, #FAF7F2); }
  .cms-preview-root { display: block; }
  .cms-preview-root main { margin-left: 0; }
  .cms-preview-root .panel { min-height: 0; }
  .cms-preview-root .home-hero { min-height: 60svh; }
  .cms-preview-root .panel:not(#panel-home) .page-head {
    min-height: 38svh; padding: 90px max(4vw, 32px) 48px;
  }
  .cms-preview-root .content-wrap { width: min(920px, calc(100% - 40px)); }
  .cms-preview-root .motion-item { opacity: 1 !important; transform: none !important; }
  .cms-preview-root .wrap,
  .cms-preview-root .wrap-tight { width: min(1000px, calc(100% - 44px)); }
  /* Reveals never fire without the site's IntersectionObserver. */
  .cms-preview-root .reveal { opacity: 1 !important; transform: none !important; }
  .cms-preview-empty {
    padding: 44px; font: 400 .95rem/1.6 system-ui, sans-serif; color: #5C6B72;
  }
  .cms-preview-empty p { margin: 0 0 .75em; max-width: 60ch; }
  .brand-preview { padding: 32px; font: 400 .9rem/1.5 system-ui, sans-serif; color: #5C6B72; }
  .brand-preview h3 { margin: 24px 0 8px; font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; color: #1F2A30; }
  .brand-preview .bp-bar { display: flex; align-items: center; gap: 14px; padding: 18px 22px; background: #0A1A24; color: #fff; border-radius: 8px; width: max-content; }
  .brand-preview .bp-bar .brand-word { color: #fff; }
  .brand-preview .bp-tabs { display: flex; gap: 12px; }
  .brand-preview .bp-tab { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; font-size: .8rem; }
  .brand-preview .bp-tab.light { background: #F1F3F4; color: #1F2A30; }
  .brand-preview .bp-tab.dark { background: #202124; color: #E8EAED; }
  .brand-preview .bp-fav { position: relative; width: 16px; height: 16px; flex: 0 0 16px; }
  .brand-preview .bp-fav svg, .brand-preview .bp-fav img { width: 100%; height: 100%; display: block; object-fit: contain; }
  .brand-preview .bp-note { margin-top: 20px; max-width: 60ch; }
  .cms-preview-empty .cms-preview-title { font-weight: 600; color: #1F2A30; }
  .cms-preview-empty .cms-preview-warn { color: #9A3412; }
  .cms-preview-empty summary { cursor: pointer; font-size: .85rem; }
  .cms-preview-empty code { display: block; margin-top: .5em; font-size: .8rem; white-space: pre-wrap; }
  `,
  { raw: true }
);

/* ---------- entry -> plain object ---------- */

/**
 * A freshly picked image is a blob-backed asset that does not exist at its
 * eventual repository path yet, so every nested `image` value has to be
 * resolved through getAsset before rendering.
 */
const resolveAssets = (getAsset, value, fieldName) => {
  if (Array.isArray(value)) return value.map((item) => resolveAssets(getAsset, item));
  if (!value || typeof value !== 'object') {
    if (fieldName === 'image' && typeof value === 'string' && value) {
      const asset = getAsset(value);
      return asset ? asset.toString() : value;
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => [key, resolveAssets(getAsset, val, key)])
  );
};

const rebaseImages = (node) => {
  if (Array.isArray(node)) return node.map(rebaseImages);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [
      k,
      k === 'image' && typeof v === 'string' && v.startsWith('/') && !v.startsWith(`${BASE}/`)
        ? BASE + v
        : rebaseImages(v),
    ]));
  }
  return node;
};

const toData = (entry, getAsset) => {
  const raw = entry.getIn(['data']);
  const data = raw && typeof raw.toJS === 'function' ? raw.toJS() : raw || {};
  return rebaseImages(resolveAssets(getAsset, data));
};

/**
 * Everything a renderer asks of its context. MARVI's renderPage wants
 * index/total for the section counter; the two AIWC directory blocks want
 * the collections and a way to link to their pages. Links are inert here.
 */
const previewCtx = {
  people: PEOPLE,
  partners: PARTNERS,
  index: 1,
  total: Math.max(1, (collections?.pages || []).length),
  urlFor: () => '#',
  entryUrl: () => '#',
  t: (key) => key,
};

/**
 * Turns a render error into something an editor can act on. The renderer is
 * the one the build uses, so an entry that fails here will usually fail the
 * deploy too — which the CMS otherwise reports as a successful save.
 */
const explainFailure = (err) => {
  const text = String(err?.message || err);
  const field = text.match(/reading '([^']+)'/)?.[1];
  if (field === 'image') {
    return 'A picture field (cover or menu image) is empty. Choose an image, or remove the picture field.';
  }
  if (field) {
    return `The field “${field}”, or the section that holds it, is empty but the page needs a value there. Fill it in, or remove that section.`;
  }
  return 'Something in this entry could not be drawn. Check the section you edited last.';
};

/**
 * Renders `node` into a Decap preview pane. Draws into a detached document so
 * rendering cannot touch the preview DOM, then imports the result across.
 */
const paneFor = (render, emptyMessage) => ({ entry, getAsset }) => {
  let node = null;
  let failure = null;
  try {
    const doc = document.implementation.createHTMLDocument('preview');
    node = render(doc, toData(entry, getAsset));
  } catch (err) {
    // A half-typed entry should show a message, not a blank pane.
    console.warn('[preview] render failed:', err);
    failure = err;
  }

  return h('div', {
    className: 'cms-preview-root',
    ref: (el) => {
      if (!el) return;
      el.textContent = '';
      if (node) {
        el.appendChild(el.ownerDocument.importNode(node, true));
        return;
      }
      const d = el.ownerDocument;
      const box = d.createElement('div');
      box.className = 'cms-preview-empty';
      const add = (tag, text, className) => {
        const item = d.createElement(tag);
        item.textContent = text;
        if (className) item.className = className;
        box.appendChild(item);
        return item;
      };
      if (!failure) {
        add('p', emptyMessage);
      } else {
        add('p', 'Preview unavailable', 'cms-preview-title');
        add('p', explainFailure(failure));
        add('p', 'Fix this before saving — saved like this, it will probably stop the live site from updating.', 'cms-preview-warn');
        const details = add('details', '');
        details.appendChild(Object.assign(d.createElement('summary'), { textContent: 'Technical detail' }));
        details.appendChild(Object.assign(d.createElement('code'), { textContent: String(failure?.message || failure) }));
      }
      el.appendChild(box);
    },
  });
};

/* ---------- Site → Brand mark ---------- */

/**
 * Shows the mark where the site actually uses it: the dark menu at full size,
 * the mobile bar, and a browser tab in both themes. Uses the same brandMarkSvg
 * as the build, so a shape change here is exactly what ships.
 */
CMS.registerPreviewTemplate('brand', ({ entry, getAsset }) => {
  const data = toData(entry, getAsset);
  const logo = typeof data.logo === 'string' && data.logo ? data.logo : null;

  return h('div', {
    className: 'brand-preview',
    ref: (el) => {
      if (!el) return;
      const d = el.ownerDocument;
      el.textContent = '';
      const make = (tag, className, text) => {
        const n = d.createElement(tag);
        if (className) n.className = className;
        if (text) n.textContent = text;
        return n;
      };
      const mark = (className, variant) => {
        const m = make('span', className);
        if (logo) {
          const img = make('img');
          img.src = logo;
          img.alt = '';
          m.appendChild(img);
        } else {
          m.innerHTML = brandMarkSvg(data.shape || 'drop', variant);
        }
        return m;
      };

      el.appendChild(make('h3', '', 'Menu'));
      const bar = make('div', 'bp-bar');
      bar.append(mark('brand-mark', 'chrome'), make('span', 'brand-word', 'AIWC'));
      el.appendChild(bar);

      el.appendChild(make('h3', '', 'Mobile bar'));
      const small = make('div', 'bp-bar');
      small.append(mark('brand-mark brand-mark--bar', 'chrome'), make('span', 'brand-word', 'AIWC'));
      el.appendChild(small);

      el.appendChild(make('h3', '', 'Browser tab'));
      const tabs = make('div', 'bp-tabs');
      for (const theme of ['light', 'dark']) {
        const tab = make('div', `bp-tab ${theme}`);
        const fav = mark('bp-fav', 'favicon');
        // The favicon SVG picks its colours with prefers-color-scheme, which
        // the preview cannot switch per tab; pin them to each tab's theme.
        const svg = fav.querySelector('svg');
        if (svg) {
          svg.querySelector('style')?.remove();
          const ink = theme === 'dark' ? '#EAF4F2' : '#0A1A24';
          svg.style.setProperty('--frame', ink);
          svg.style.setProperty('--flow', ink);
        }
        tab.append(fav, make('span', '', 'AIWC — Australia India…'));
        tabs.appendChild(tab);
      }
      el.appendChild(tabs);

      el.appendChild(make('p', 'bp-note', logo
        ? 'Using your uploaded logo. Remove the logo image to go back to the drawn mark.'
        : 'Using the drawn mark in the chosen shape. Upload a logo image to replace it.'));
    },
  });
});

/* ---------- the three collections ---------- */

CMS.registerPreviewTemplate(
  'pages',
  paneFor(
    (doc, data) =>
      renderPage(doc, {
        ...data,
        slug: data.slug || 'preview',
        menuName: data.menuName || 'Untitled page',
        template: data.template || 'standard',
        intro: data.intro || {},
        blocks: Array.isArray(data.blocks) ? data.blocks : [],
      }, previewCtx),
    'Preview unavailable — add a page title to start.'
  )
);

CMS.registerPreviewTemplate(
  'people',
  paneFor(
    (doc, data) =>
      renderPerson(doc, {
        ...data,
        slug: data.slug || 'preview',
        name: data.name || 'Unnamed researcher',
        country: data.country || 'Australia',
        profiles: Array.isArray(data.profiles) ? data.profiles : [],
        bio: Array.isArray(data.bio) ? data.bio : [],
        sections: Array.isArray(data.sections) ? data.sections : [],
      }, previewCtx),
    'Preview unavailable — add a name to start.'
  )
);

CMS.registerPreviewTemplate(
  'partners',
  paneFor(
    (doc, data) =>
      renderPartner(doc, {
        ...data,
        slug: data.slug || 'preview',
        name: data.name || 'Unnamed institution',
        country: data.country || 'Australia',
        body: Array.isArray(data.body) ? data.body : [],
        sections: Array.isArray(data.sections) ? data.sections : [],
      }, previewCtx),
    'Preview unavailable — add an institution name to start.'
  )
);
