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

import { connect, NotSignedIn, pagePath, when, who, what, short } from './github.js';
import { checkText } from './page-check.js';

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

// Everything the preview adds: layout corrections, the empty and failed
// states, the version picker and the logo preview. A file, not an inline
// string: the admin's Content-Security-Policy only allows stylesheets from
// this site ('self'), and the CMS turns an inline string into a blob: URL,
// which the policy blocks — so inline preview styles never applied.
CMS.registerPreviewStyle(`${BASE}/admin/preview.css`);

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
const drawPreview = (el, render, data, emptyMessage) => {
  let node = null;
  let failure = null;
  try {
    const doc = document.implementation.createHTMLDocument('preview');
    node = render(doc, data);
  } catch (err) {
    // A half-typed entry should show a message, not a blank pane.
    console.warn('[preview] render failed:', err);
    failure = err;
  }
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
};

const paneFor = (render, emptyMessage) => ({ entry, getAsset }) => {
  const data = toData(entry, getAsset);
  return h('div', {
    className: 'cms-preview-root',
    ref: (el) => {
      if (!el) return;
      el.textContent = '';
      drawPreview(el, render, data, emptyMessage);
    },
  });
};

/* ---------- Logo & site settings → Logo ---------- */

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

const renderPageData = (doc, data) =>
  renderPage(doc, {
    ...data,
    slug: data.slug || 'preview',
    menuName: data.menuName || 'Untitled page',
    template: data.template || 'standard',
    intro: data.intro || {},
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
  }, previewCtx);

/* ---------- Pages: version picker above the preview ---------- */

/**
 * A "Version" dropdown at the top of every page's preview. Picking an earlier
 * save draws that version with the site's own renderer, so the editor sees
 * exactly what it looked like, and "Restore this version" puts it back.
 *
 * The CMS's History panel lists saves but cannot open or restore them. This
 * reads them from GitHub with the CMS's own session (github.js). A restore is
 * a commit like any save, so it shows up in the same dropdown and can be
 * undone; the CMS is then reloaded, because its editor still holds the old
 * text and saving that would silently undo the restore.
 */

let client = null;
connect(BASE).then((c) => { client = c; redrawPagePane(); }).catch(() => {});

/** The page file open in the editor, from the CMS route (#/collections/pages/entries/<slug>).
 *  Not data.slug: that is the field being edited, which may not be saved yet. */
const editedSlug = () => location.hash.match(/^#\/collections\/pages\/entries\/([a-z0-9-]+)/)?.[1] ?? null;

const versionStates = new Map(); // slug -> { list, error, selected, old, busy, note }
let pagePane = null;             // { el, live } — the pane on screen, and the editor's current data

// A restore reloads the CMS; this carries its deploy through the reload.
const PENDING_KEY = 'aiwc-restore-pending';

const versionState = (slug) => {
  if (!client) return null;
  let state = versionStates.get(slug);
  // Not signed in yet (the CMS may still be restoring its session): try again.
  if (state?.retryAt && Date.now() >= state.retryAt) {
    versionStates.delete(slug);
    state = null;
  }
  if (!state) {
    state = { list: null, error: null, selected: '', old: null, busy: false, note: null };
    versionStates.set(slug, state);
    loadVersionList(slug, state);
    followPendingRestore(slug, state);
  }
  return state;
};

const loadVersionList = async (slug, state) => {
  try {
    // A save that deleted the file has no version to show.
    state.list = (await client.commitsFor(pagePath(slug), 1, 30)).filter((c) => !/^Delete page/.test(what(c)));
  } catch (err) {
    state.list = [];
    if (err instanceof NotSignedIn) {
      // No GitHub call was made; retry shortly rather than showing nothing for good.
      state.retryAt = Date.now() + 3000;
      setTimeout(redrawPagePane, 3100);
    } else {
      state.error = err.message;
    }
  }
  redrawPagePane();
};

const followPendingRestore = async (slug, state) => {
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { /* storage blocked */ }
  if (pending?.slug !== slug) return;
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* storage blocked */ }
  state.note = { tone: 'info', text: `Restored the version from ${pending.when}. The site is updating — usually 1–2 minutes…` };
  redrawPagePane();
  const result = await client.deployResult(pending.sha);
  state.note = !result ? null
    : result.ok ? { tone: 'good', text: `Restored the version from ${pending.when} — it is live.` }
      : { tone: 'bad', text: 'Restored, but the site could not update, so the live page did not change.', link: result.url };
  redrawPagePane();
};

const pickVersion = async (slug, state, sha) => {
  state.selected = sha;
  state.old = null;
  state.note = null;
  if (!sha) { redrawPagePane(); return; }
  state.busy = true;
  redrawPagePane();
  try {
    const { text } = await client.readFile(pagePath(slug), sha);
    const commit = state.list.find((c) => c.sha === sha);
    if (state.selected !== sha) return; // another version was picked meanwhile
    state.old = { text, data: rebaseImages(JSON.parse(text)), commit, when: when(commit.commit.author.date), who: who(commit) };
  } catch (err) {
    state.note = { tone: 'bad', text: `Could not open that version: ${err.message}` };
  } finally {
    state.busy = false;
    redrawPagePane();
  }
};

const restoreVersion = async (slug, state) => {
  const { old } = state;
  state.busy = true;
  state.note = { tone: 'info', text: 'Checking that version…' };
  redrawPagePane();
  try {
    // The same checks as any save: an old version may link to a page deleted since.
    const pages = await client.listPages();
    const { data, errors } = checkText(old.text, new Set(pages.keys()), renderPage);
    if (errors.length) {
      state.note = { tone: 'bad', text: `This version can’t be restored as it is — the site would not build:\n• ${errors.join('\n• ')}` };
      return;
    }
    if (data.slug !== slug) {
      state.note = { tone: 'bad', text: `This version has a different page address (“${data.slug}”), so restoring it here would not match the page. Use the “Restore & import” button instead.` };
      return;
    }
    const ok = confirm(`Restore “${data.menuName}” to the version from ${old.when}?\n\n` +
      'It goes live in 1–2 minutes. The version on the site now stays in the list, so this can be undone.\n\n' +
      'Any unsaved changes in the editor will be discarded.');
    if (!ok) { state.note = null; return; }
    // Exactly the old bytes, so the restored file is that version, not a reformat of it.
    const res = await client.writePage(slug, old.text,
      `Restore page “${slug}” to the version of ${old.when} (${short(old.commit.sha)})`, pages.get(slug)?.sha);
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ slug, sha: res.commit.sha, when: old.when })); } catch { /* storage blocked */ }
    state.note = { tone: 'good', text: 'Restored. Reloading the editor so it shows the restored version…' };
    redrawPagePane();
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    state.note = err.status === 409 || err.status === 422
      ? { tone: 'bad', text: 'Not restored — the page was saved by someone else just now. Reload the editor and try again.' }
      : { tone: 'bad', text: `Not restored: ${err.message}` };
  } finally {
    state.busy = false;
    redrawPagePane();
  }
};

const versionBar = (d, slug, state) => {
  const make = (tag, props = {}, ...children) => {
    const n = Object.assign(d.createElement(tag), props);
    n.append(...children.filter(Boolean));
    return n;
  };
  const bar = make('div', { className: 'version-bar' });
  const select = make('select', { disabled: !state.list || state.busy });
  select.setAttribute('aria-label', 'Version');
  select.append(make('option', { value: '', textContent: 'Current — what you are editing' }));
  (state.list || []).forEach((c, i) => select.append(make('option', {
    value: c.sha,
    textContent: `${when(c.commit.author.date)} — ${who(c)}${i === 0 ? ' (on the site now)' : ''}`,
  })));
  select.value = state.selected;
  select.addEventListener('change', () => pickVersion(slug, state, select.value));
  bar.append(make('label', {}, make('span', { textContent: 'Version' }), select));
  if (!state.list) bar.append(make('span', { className: 'version-hint', textContent: 'Loading versions…' }));
  if (state.error) bar.append(make('span', { className: 'version-hint', textContent: `Versions unavailable: ${state.error}` }));

  if (state.selected && state.old) {
    const live = state.list[0]?.sha === state.selected;
    const back = make('button', { type: 'button', className: 'version-secondary', textContent: 'Back to current' });
    back.addEventListener('click', () => pickVersion(slug, state, ''));
    const restore = live ? null : make('button', { type: 'button', className: 'version-primary', textContent: 'Restore this version', disabled: state.busy });
    restore?.addEventListener('click', () => restoreVersion(slug, state));
    bar.append(make('div', { className: 'version-note' },
      make('span', { textContent: live
        ? `Showing the version on the site now (${state.old.when}, ${state.old.who}) — without your unsaved edits.`
        : `Previewing the version from ${state.old.when} by ${state.old.who}. This is not on the site.` }),
      restore, back));
  } else if (state.selected && state.busy) {
    bar.append(make('span', { className: 'version-hint', textContent: 'Opening that version…' }));
  }
  if (state.note) {
    const note = make('div', { className: `version-status ${state.note.tone}`, textContent: state.note.text });
    if (state.note.link) note.append(' ', make('a', { href: state.note.link, target: '_blank', rel: 'noopener', textContent: 'See what went wrong' }));
    bar.append(note);
  }
  return bar;
};

const redrawPagePane = () => {
  if (!pagePane?.el?.isConnected) return;
  const { el, live } = pagePane;
  el.textContent = '';
  const slug = editedSlug();
  const state = slug ? versionState(slug) : null;
  if (state) el.appendChild(versionBar(el.ownerDocument, slug, state));
  const content = el.ownerDocument.createElement('div');
  el.appendChild(content);
  drawPreview(content, renderPageData, state?.selected && state.old ? state.old.data : live,
    'Preview unavailable — add a page title to start.');
};

CMS.registerPreviewTemplate('pages', ({ entry, getAsset }) => {
  const live = toData(entry, getAsset);
  return h('div', {
    className: 'cms-preview-root',
    ref: (el) => {
      if (!el) return;
      pagePane = { el, live };
      redrawPagePane();
    },
  });
});

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
