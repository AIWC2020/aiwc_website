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

const { renderPage, renderPerson, renderPartner } = await import(`${BASE}/assets/templates.mjs`);

// peopleGrid, logoWall and partnerRows render from a whole collection, which
// the CMS never hands to a preview. The build publishes a trimmed index.
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
  .cms-preview-root .hero { min-height: 60vh; }
  .cms-preview-root .wrap,
  .cms-preview-root .wrap-tight { width: min(1000px, calc(100% - 44px)); }
  /* Reveals never fire without the site's IntersectionObserver. */
  .cms-preview-root .reveal { opacity: 1 !important; transform: none !important; }
  .cms-preview-empty {
    padding: 44px; font: 400 .95rem/1.6 system-ui, sans-serif; color: #5C6B72;
  }
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

const toData = (entry, getAsset) => {
  const raw = entry.getIn(['data']);
  const data = raw && typeof raw.toJS === 'function' ? raw.toJS() : raw || {};
  return resolveAssets(getAsset, data);
};

/** Everything a renderer asks of its context. Links are inert in a preview. */
const previewCtx = {
  people: PEOPLE,
  partners: PARTNERS,
  urlFor: () => '#',
  entryUrl: () => '#',
  t: (key) => key,
};

/**
 * Renders `node` into a Decap preview pane. Draws into a detached document so
 * rendering cannot touch the preview DOM, then imports the result across.
 */
const paneFor = (render, emptyMessage) => ({ entry, getAsset }) => {
  let node = null;
  try {
    const doc = document.implementation.createHTMLDocument('preview');
    node = render(doc, toData(entry, getAsset));
  } catch (err) {
    // A half-typed entry should show a message, not a blank pane.
    console.warn('[preview] render failed:', err);
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
      const msg = el.ownerDocument.createElement('p');
      msg.className = 'cms-preview-empty';
      msg.textContent = emptyMessage;
      el.appendChild(msg);
    },
  });
};

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
