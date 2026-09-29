/**
 * Page text & versions — export, import and restore pages outside the CMS form.
 *
 * Each page is one file, content/pages/<slug>.json, and git keeps every save.
 * This screen reads and writes through GitHub's API with the token the CMS
 * already holds (Sveltia keeps it in local storage), so there is no second
 * sign-in, and every save or restore is an ordinary commit that deploys like
 * a CMS save — which also makes every restore undoable from the same lists.
 *
 * Before anything is written, text is checked the way the build checks it:
 * it must parse, carry the fields every page needs, link only to pages that
 * exist, and render with the site's own renderer. An old version can go stale
 * (a page it links to was deleted since), so restores are checked too.
 */

import { diffLines, summarise } from './diff.js';
import { connect, NotSignedIn, pagePath, slugOf, when, short, who, what } from './github.js';
import { checkText as checkPage, explainRenderFailure } from './page-check.js';

const BASE = new URL('.', import.meta.url).pathname.replace(/\/admin\/$/, '');
const { renderPage } = await import(`${BASE}/assets/templates.mjs`);

const $ = (id) => document.getElementById(id);
const els = {
  page: $('page'), fresh: $('new'), upload: $('upload'), download: $('download'),
  text: $('text'), check: $('check'), save: $('save'), status: $('status'), fileName: $('file-name'),
  versionsBox: $('versions-box'), versions: $('versions'), versionsMore: $('versions-more'), diff: $('diff'),
  deletedSection: $('deleted-section'), deleted: $('deleted'),
  siteSection: $('site-section'), siteSaves: $('site-saves'), siteMore: $('site-more'),
  sitePlan: $('site-plan'), siteStatus: $('site-status'),
};

/** Whole-site restore scope: what an editor changes in the CMS. site.json
 *  (domain and deployment) and i18n.json (developer-managed) stay as they are. */
const inSiteScope = (path) => (path.startsWith('content/pages/') && path.endsWith('.json')) || path === 'content/brand.json';
/** Files older pages may point at. Brought back if missing, never removed. */
const isMedia = (path) => path.startsWith('assets/photos/') || path.startsWith('assets/docs/');

/* ---------- state ---------- */

let client = null;        // see github.js
let repo = null;          // "owner/name"
let branch = 'main';
let pages = new Map();    // slug -> { sha }
let loadedSlug = null;    // the page the text came from, if any
let currentText = '';     // that page's text as it is on the site now
let restoring = null;     // { kind: 'version' | 'deleted', slug, sha, when, who }
let versionsPage = 1;
let savesPage = 1;

/* ---------- small helpers ---------- */

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children.filter((c) => c != null));
  return n;
};

const say = (box, text, tone = '', link = null) => {
  box.className = `status ${tone}`;
  box.textContent = text;
  // _top, so a link followed from inside the CMS panel leaves the panel.
  if (link) box.append(' ', el('a', { href: link.href, textContent: link.label, target: link.external ? '_blank' : '_top', rel: 'noopener' }));
};
const status = (...args) => say(els.status, ...args);

/** Inside the CMS's Versions panel, tell the CMS a save happened: its editor
 *  still holds the old text, and saving that would undo this. */
const notifyCms = () => {
  if (window.parent !== window) window.parent.postMessage({ type: 'aiwc-page-text-saved' }, location.origin);
};

const gh = (...args) => client.gh(...args);
const readFile = (...args) => client.readFile(...args);
const readBlob = (...args) => client.readBlob(...args);
const commitsFor = (...args) => client.commitsFor(...args);
const filesAt = (...args) => client.filesAt(...args);
const listPages = async () => { pages = await client.listPages(); };

/* ---------- checks (page-check.js, mirroring scripts/verify.mjs) ---------- */

const checkText = (text, known = new Set(pages.keys())) => checkPage(text, known, renderPage);

const report = ({ errors, warnings }, okText) => {
  if (errors.length) {
    status(`Can’t be saved yet — fix ${errors.length === 1 ? 'this' : 'these'} first:\n• ${errors.join('\n• ')}`, 'bad');
    return false;
  }
  status(warnings.length ? `${okText}\n• ${warnings.join('\n• ')}` : okText, warnings.length ? 'warn' : 'good');
  return true;
};

/* ---------- live preview (as in the CMS editor) ---------- */

// Image paths are stored site-relative; prefix the base path the way the
// CMS preview does, so a site served under a sub-path still shows them.
const rebaseImages = (node) => {
  if (Array.isArray(node)) return node.map(rebaseImages);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [
    k,
    k === 'image' && typeof v === 'string' && v.startsWith('/') && !v.startsWith(`${BASE}/`) ? BASE + v : rebaseImages(v),
  ]));
};

/**
 * Draws the editor's text into the preview frame with the site's renderer and
 * stylesheet — the same pair the CMS preview uses — keeping the scroll
 * position, so typing does not jump the preview back to the top.
 */
const drawVisual = () => {
  const frame = $('visual');
  const doc = frame.contentDocument;
  if (!doc) return;
  if (!doc.getElementById('site-css')) {
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>');
    doc.close();
    for (const [id, href] of [['site-css', `${BASE}/assets/site.css`], ['fixes-css', `${BASE}/admin/preview-fixes.css`]]) {
      doc.head.append(Object.assign(doc.createElement('link'), { id, rel: 'stylesheet', href }));
    }
    const own = doc.createElement('style');
    own.textContent = '.preview-message{padding:32px;font:400 15px/1.6 system-ui,sans-serif;color:#5C6B72;white-space:pre-line}.preview-message strong{color:#B42318}';
    doc.head.append(own);
  }
  const scroll = doc.scrollingElement?.scrollTop || 0;
  const body = doc.body;
  body.textContent = '';
  const message = (title, detail) => {
    const box = doc.createElement('div');
    box.className = 'preview-message';
    box.append(Object.assign(doc.createElement('strong'), { textContent: title }), `\n${detail}`);
    body.append(box);
  };

  const text = els.text.value.trim();
  if (!text) { message('Nothing to preview yet', 'Pick a page, start a new one, or upload a file.'); return; }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    message('Preview paused — the text is not valid JSON', 'Press Check to see the line with the problem.');
    return;
  }
  try {
    const scratch = document.implementation.createHTMLDocument('preview');
    const node = renderPage(scratch, {
      template: 'standard', intro: {}, blocks: [], ...rebaseImages(data),
      slug: data.slug || 'preview', menuName: data.menuName || 'Untitled page',
    }, { people: [], partners: [], index: 1, total: 1, urlFor: () => '#', entryUrl: () => '#', t: (k) => k });
    const root = doc.createElement('div');
    root.className = 'cms-preview-root';
    root.append(doc.importNode(node, true));
    body.append(root);
    if (doc.scrollingElement) doc.scrollingElement.scrollTop = scroll;
  } catch (err) {
    message('Preview unavailable', `${explainRenderFailure(err)}\nPress Check for details.`);
  }
};

let visualTimer = 0;
const drawVisualSoon = () => { clearTimeout(visualTimer); visualTimer = setTimeout(drawVisual, 250); };

/* ---------- editor ---------- */

const setText = (text, label, viewing = false) => {
  els.text.value = text.endsWith('\n') ? text : `${text}\n`;
  els.fileName.textContent = label;
  els.fileName.classList.toggle('viewing', viewing);
  els.save.textContent = viewing ? 'Restore this version' : 'Save to site';
  drawVisual();
};

const clearRestore = () => {
  restoring = null;
  els.diff.textContent = '';
  els.save.textContent = 'Save to site';
  els.fileName.classList.remove('viewing');
  markCurrentVersion(null);
};

/** Shows what saving the editor's text would change on the live page. */
const showDiff = (fromText, toText, heading) => {
  els.diff.textContent = '';
  const { added, removed, hunks } = summarise(diffLines(fromText, toText));
  if (!added && !removed) {
    els.diff.append(el('div', { className: 'sum', textContent: `${heading}: identical to the page on the site now.` }));
    return;
  }
  els.diff.append(el('div', { className: 'sum', textContent: `${heading}: ${added} line(s) will be added and ${removed} removed. Green = what comes back, red = what goes.` }));
  const pre = el('pre');
  hunks.forEach((hunk, i) => {
    if (i) pre.append(el('span', { className: 'gap', textContent: '  …' }));
    hunk.forEach((o) => pre.append(el('span', {
      className: o.op === 'same' ? '' : o.op,
      textContent: `${o.op === 'add' ? '+ ' : o.op === 'del' ? '− ' : '  '}${o.text}`,
    })));
  });
  els.diff.append(pre);
};

const TEMPLATE = {
  menuName: 'New page', slug: 'new-page', order: 99, published: false, template: 'standard',
  intro: {
    eyebrow: 'Section label', title: 'Main page title', lede: 'One or two sentences introducing the page.',
    eyebrowSize: 100, titleSize: 70, ledeSize: 100, textAlign: 'left', textPosition: 'bottom',
    textWidth: 100, textOffsetX: 0, textOffsetY: 0,
  },
  heroImage: null,
  menuImage: null,
  sectionNav: 'tabs',
  introTab: 'Overview',
  blocks: [
    { type: 'banner', eyebrow: 'Small label', title: 'Heading of the second tab', tabLabel: 'Second tab', lede: '', accent: '' },
    {
      type: 'split',
      left: { kind: 'prose', lead: '', paragraphs: ['First paragraph.', '• A bullet point'], stat: '', caption: '' },
      right: { kind: 'prose', lead: '', paragraphs: ['Right-hand column.'], stat: '', caption: '' },
    },
  ],
};

const loadSelected = async () => {
  const slug = els.page.value;
  clearRestore();
  if (!slug) { els.versionsBox.hidden = true; return; }
  status('Loading…');
  try {
    const { text, sha } = await readFile(pagePath(slug));
    pages.set(slug, { sha });
    loadedSlug = slug;
    currentText = text;
    setText(text, `Editing ${pagePath(slug)} — the version on the site now`);
    status('');
    versionsPage = 1;
    els.versions.textContent = '';
    await loadVersions();
  } catch (err) {
    handle(err);
  }
};

/* ---------- versions of one page ---------- */

const markCurrentVersion = (sha) => {
  els.versions.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('current', tr.dataset.sha === sha));
};

const loadVersions = async () => {
  const slug = loadedSlug;
  els.versionsBox.hidden = false;
  const commits = await commitsFor(pagePath(slug), versionsPage);
  if (slug !== loadedSlug) return; // another page was picked meanwhile
  let table = els.versions.querySelector('table');
  if (!table) els.versions.append((table = el('table')));
  commits.forEach((c, i) => {
    const latest = versionsPage === 1 && i === 0;
    const deletedHere = /^Delete page/.test(what(c));
    const tr = el('tr', {},
      el('td', { className: 'when', textContent: when(c.commit.author.date) }),
      el('td', {}, `${what(c)} — ${who(c)}`, latest ? el('span', { className: 'tag', textContent: 'on the site now' }) : null),
      el('td', { className: 'act' }, latest || deletedHere ? null
        : el('button', { className: 'small', type: 'button', textContent: 'View', onclick: () => viewVersion(slug, c) })),
    );
    tr.dataset.sha = c.sha;
    table.append(tr);
  });
  els.versionsMore.hidden = commits.length < 10;
};

const viewVersion = async (slug, c) => {
  status('Loading that version…');
  try {
    const { text } = await readFile(pagePath(slug), c.sha);
    restoring = { kind: 'version', slug, sha: c.sha, when: when(c.commit.author.date), who: who(c) };
    setText(text, `Viewing the version from ${restoring.when} (${restoring.who}) — not on the site`, true);
    markCurrentVersion(c.sha);
    showDiff(currentText, els.text.value, 'Restoring this version');
    status('This is an older version. Press “Restore this version” to put it back on the site. The current version stays in the list, so you can switch back later.', 'warn');
  } catch (err) {
    handle(err);
  }
};

/* ---------- deleted pages ---------- */

const findDeleted = async () => {
  els.deleted.textContent = 'Looking through recent saves…';
  try {
    const commits = [
      ...(await gh(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=content/pages&per_page=50`)),
    ];
    // The list endpoint omits which files changed; fetch details a few at a time.
    const details = [];
    for (let i = 0; i < commits.length; i += 6) {
      details.push(...(await Promise.all(commits.slice(i, i + 6).map((c) => gh(`/repos/${repo}/commits/${c.sha}`)))));
    }
    const seen = new Map();
    for (const d of details) { // newest first, so the first sighting is the last deletion
      for (const f of d.files || []) {
        const gone = f.status === 'removed' ? f.filename : f.status === 'renamed' ? f.previous_filename : null;
        if (!gone || !gone.startsWith('content/pages/') || !gone.endsWith('.json')) continue;
        const slug = slugOf(gone);
        if (pages.has(slug) || seen.has(slug)) continue;
        seen.set(slug, { slug, path: gone, parent: d.parents[0].sha, when: when(d.commit.author.date), who: who(d) });
      }
    }
    els.deleted.textContent = '';
    if (!seen.size) {
      els.deleted.textContent = 'No deleted pages found in the last 50 saves.';
      return;
    }
    const table = el('table');
    for (const g of seen.values()) {
      table.append(el('tr', {},
        el('td', { className: 'when', textContent: g.when }),
        el('td', {}, `“${g.slug}” deleted by ${g.who}`),
        el('td', { className: 'act' }, el('button', { className: 'small', type: 'button', textContent: 'Restore', onclick: () => openDeleted(g) })),
      ));
    }
    els.deleted.append(table);
  } catch (err) {
    els.deleted.textContent = '';
    handle(err);
  }
};

const openDeleted = async (g) => {
  status('Loading the deleted page…');
  try {
    const { text } = await readFile(g.path, g.parent);
    loadedSlug = null;
    currentText = '';
    els.page.value = '';
    els.versionsBox.hidden = true;
    els.diff.textContent = '';
    restoring = { kind: 'deleted', slug: g.slug, when: g.when, who: g.who };
    setText(text, `Deleted page “${g.slug}” — its last text before ${g.when}. Not on the site yet.`, true);
    els.save.textContent = 'Bring this page back';
    report(checkText(text), 'Press “Bring this page back” to restore it to the site.');
    els.text.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    handle(err);
  }
};

/* ---------- saving one page ---------- */

/** Follows the deploy for a commit so a failed build is never silent. */
const watchDeploy = async (commitSha, box, success, successLink = null) => {
  const result = await client.deployResult(commitSha);
  if (!result) return; // cannot tell; the saved message stands
  if (result.ok) say(box, success, 'good', successLink);
  else say(box, 'Saved, but the site could not update, so nothing on the live site changed.', 'bad', { href: result.url, label: 'See what went wrong', external: true });
};

const save = async () => {
  const result = checkText(els.text.value);
  if (!report(result, 'Checked.')) return;
  const { data } = result;
  const target = data.slug;
  const existing = pages.get(target);

  let question;
  let message;
  if (restoring?.kind === 'version' && target === restoring.slug) {
    question = `Put “${data.menuName}” back to the version from ${restoring.when}?\n\nThe version on the site now stays in the list, so this can be undone.`;
    message = `Restore page “${target}” to the version of ${restoring.when} (${short(restoring.sha)})`;
  } else if (restoring?.kind === 'deleted' && target === restoring.slug && !existing) {
    question = `Bring back the deleted page “${data.menuName}” at /${target}/?`;
    message = `Restore deleted page “${target}”`;
  } else if (existing && target === loadedSlug) {
    question = `Publish your changes to “${data.menuName}” (/${target}/)?`;
  } else if (existing) {
    question = `A page with the address "${target}" already exists. Replace it with this text?`;
  } else {
    question = `Create a new page at /${target}/?` +
      (loadedSlug ? `\n\n“${loadedSlug}” is not changed — you changed the address, so this makes a copy.` : '');
  }
  if (!confirm(question)) return;
  message ||= `${existing ? 'Update' : 'Create'} page “${target}” (page text editor)`;

  els.save.disabled = true;
  status('Saving…');
  try {
    const text = `${JSON.stringify(data, null, 2)}\n`;
    const res = await client.writePage(target, text, message, existing?.sha);
    pages.set(target, { sha: res.content.sha });
    notifyCms();
    fillPicker(target);
    loadedSlug = target;
    currentText = text;
    clearRestore();
    setText(text, `Editing ${pagePath(target)} — the version on the site now`);
    versionsPage = 1;
    els.versions.textContent = '';
    loadVersions().catch(() => {});
    status('Saved. The site is updating — this usually takes 1–2 minutes…');
    const live = `${BASE}/${target}/`;
    watchDeploy(res.commit.sha, els.status,
      data.published === false ? 'Saved and the site has updated. The page is hidden (published: false).' : 'Saved — the page is live.',
      data.published === false ? null : { href: live, label: `Open ${live}`, external: true });
  } catch (err) {
    if (err.status === 409 || err.status === 422) {
      status('Not saved — this page was changed by someone else (or in the CMS) after you opened it. Download your text to keep it, pick the page again, and redo your change.', 'bad');
    } else {
      handle(err);
    }
  } finally {
    els.save.disabled = false;
  }
};

/* ---------- whole website ---------- */

const loadSaves = async () => {
  const commits = await gh(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=content&per_page=10&page=${savesPage}`);
  let table = els.siteSaves.querySelector('table');
  if (!table) els.siteSaves.append((table = el('table')));
  commits.forEach((c, i) => {
    const latest = savesPage === 1 && i === 0;
    table.append(el('tr', {},
      el('td', { className: 'when', textContent: when(c.commit.author.date) }),
      el('td', {}, `${what(c)} — ${who(c)}`, latest ? el('span', { className: 'tag', textContent: 'the site now' }) : null),
      el('td', { className: 'act' }, latest ? null
        : el('button', { className: 'small', type: 'button', textContent: 'Restore site to here', onclick: () => planSiteRestore(c) })),
    ));
  });
  els.siteMore.hidden = commits.length < 10;
};

/** Works out, and shows, exactly what restoring to commit `c` would change. */
const planSiteRestore = async (c) => {
  els.sitePlan.textContent = '';
  say(els.siteStatus, 'Comparing that save with the site now…');
  try {
    const head = (await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
    const [now, then] = await Promise.all([filesAt(head), filesAt(c.sha)]);

    const changes = [];   // { path, sha, mode } — sha null deletes
    const changed = [];
    const back = [];
    const removed = [];
    for (const [path, f] of then.files) {
      if (!inSiteScope(path)) continue;
      const cur = now.files.get(path);
      if (!cur) { back.push(path); changes.push({ path, sha: f.sha, mode: f.mode }); }
      else if (cur.sha !== f.sha) { changed.push(path); changes.push({ path, sha: f.sha, mode: f.mode }); }
    }
    for (const [path, f] of now.files) {
      if (inSiteScope(path) && !then.files.has(path)) { removed.push(path); changes.push({ path, sha: null, mode: f.mode }); }
    }
    const media = [...then.files].filter(([path]) => isMedia(path) && !now.files.has(path));
    media.forEach(([path, f]) => changes.push({ path, sha: f.sha, mode: f.mode }));

    if (!changes.length) {
      say(els.siteStatus, 'The site already matches that save — nothing to restore.', 'good');
      return;
    }

    // Check every page as it would be after the restore, links included.
    say(els.siteStatus, 'Checking the pages from that save…');
    const restoredSlugs = new Set([...then.files.keys()].filter((p) => p.startsWith('content/pages/') && p.endsWith('.json')).map(slugOf));
    const problems = [];
    for (const path of [...changed, ...back].filter((p) => p.startsWith('content/pages/'))) {
      const { errors } = checkText(await readBlob(then.files.get(path).sha), restoredSlugs);
      errors.forEach((e) => problems.push(`${slugOf(path)}: ${e}`));
    }

    const label = (p) => (p === 'content/brand.json' ? 'the logo setting' : `“${slugOf(p)}”`);
    const section = (title, list) => (list.length ? [el('strong', { textContent: title }), el('ul', {}, ...list.map((p) => el('li', { textContent: label(p) })))] : []);
    els.sitePlan.append(...[
      el('p', { textContent: `Restoring the whole site to how it was at ${when(c.commit.author.date)} (${what(c)} — ${who(c)}) will:` }),
      ...section('Change back', changed),
      ...section('Bring back (deleted since)', back),
      ...section('Remove (made after that save)', removed),
      media.length ? el('p', { textContent: `Also bring back ${media.length} photo(s) or document(s) those pages use.` }) : null,
    ].filter(Boolean));

    if (problems.length) {
      say(els.siteStatus, `That save can’t be restored as it is — the site would not build:\n• ${problems.join('\n• ')}\nRestore the affected pages one at a time instead, fixing them in the editor above.`, 'bad');
      return;
    }
    const go = el('button', { className: 'primary', type: 'button', textContent: 'Restore the whole site' });
    go.onclick = () => runSiteRestore(c, head, now.treeSha, changes, go);
    els.sitePlan.append(go);
    say(els.siteStatus, 'Checked — nothing changes until you press “Restore the whole site”. This is itself a save, so it can be undone from this list.', 'warn');
  } catch (err) {
    say(els.siteStatus, err instanceof NotSignedIn ? 'You are not signed in. Sign in to the content admin first.' : `Something went wrong: ${err.message}`, 'bad');
  }
};

/** One commit for the whole restore, so it deploys once and undoes in one step. */
const runSiteRestore = async (c, head, baseTree, changes, button) => {
  if (!confirm(`Restore the whole website to ${when(c.commit.author.date)}?`)) return;
  button.disabled = true;
  say(els.siteStatus, 'Restoring…');
  try {
    const tree = await gh(`/repos/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTree, tree: changes.map(({ path, sha, mode }) => ({ path, mode, type: 'blob', sha })) }),
    });
    const commit = await gh(`/repos/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `Restore the whole site to ${when(c.commit.author.date)} (${short(c.sha)})\n\nRestored from the page text screen: ${what(c)}`,
        tree: tree.sha,
        parents: [head],
      }),
    });
    // Not forced: if anyone saved since the comparison, this is refused.
    await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    notifyCms();
    els.sitePlan.textContent = '';
    say(els.siteStatus, 'Restored. The site is updating — this usually takes 1–2 minutes… Reload the content admin afterwards so it shows the restored pages.');
    await listPages();
    fillPicker();
    clearRestore();
    savesPage = 1;
    els.siteSaves.textContent = '';
    loadSaves().catch(() => {});
    watchDeploy(commit.sha, els.siteStatus, 'Restored — the whole site is live as it was. Reload the content admin to see the restored pages.', { href: `${BASE}/`, label: 'Open the site', external: true });
  } catch (err) {
    button.disabled = false;
    say(els.siteStatus, err.status === 422
      ? 'Not restored — someone saved a change while you were looking. Choose the save again to see the up-to-date comparison.'
      : `Not restored: ${err.message}`, 'bad');
  }
};

/* ---------- misc actions ---------- */

const download = () => {
  const { data } = checkText(els.text.value);
  const name = `${data?.slug || loadedSlug || 'page'}.json`;
  const url = URL.createObjectURL(new Blob([els.text.value], { type: 'application/json' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const upload = async (file) => {
  if (!file) return;
  const text = await file.text();
  loadedSlug = null;
  els.page.value = '';
  els.versionsBox.hidden = true;
  clearRestore();
  setText(text, `Uploaded ${file.name} — not saved yet`);
  const result = checkText(text);
  if (result.data?.slug && pages.has(result.data.slug)) {
    result.warnings.unshift(`A page with the address "${result.data.slug}" already exists — saving will replace it with this file.`);
  }
  report(result, 'File loaded and checked. Press “Save to site” to publish it.');
};

const handle = (err) => {
  if (err instanceof NotSignedIn) {
    status('You are not signed in. Sign in to the content admin first, then come back to this screen.', 'bad', { href: './', label: 'Open the content admin' });
  } else {
    status(`Something went wrong: ${err.message}`, 'bad');
  }
};

const fillPicker = (selected = '') => {
  els.page.textContent = '';
  els.page.append(new Option('Choose a page…', ''));
  [...pages.keys()].sort().forEach((slug) => els.page.append(new Option(slug, slug, false, slug === selected)));
};

/* ---------- boot ---------- */

els.page.addEventListener('change', loadSelected);
els.fresh.addEventListener('click', () => {
  loadedSlug = null;
  els.page.value = '';
  els.versionsBox.hidden = true;
  clearRestore();
  setText(JSON.stringify(TEMPLATE, null, 2), 'New page from the template — change “slug”, “menuName” and “order”, then save');
  status('');
});
els.upload.addEventListener('change', () => { upload(els.upload.files[0]); els.upload.value = ''; });
els.download.addEventListener('click', download);
els.check.addEventListener('click', () => report(checkText(els.text.value), 'Looks good — this page can be saved.'));
els.save.addEventListener('click', save);
els.versionsMore.addEventListener('click', () => { versionsPage++; loadVersions().catch(handle); });
els.siteMore.addEventListener('click', () => { savesPage++; loadSaves().catch(handle); });
els.deletedSection.addEventListener('toggle', () => { if (els.deletedSection.open) findDeleted(); });
els.siteSection.addEventListener('toggle', () => {
  if (els.siteSection.open && !els.siteSaves.textContent) loadSaves().catch((err) => say(els.siteStatus, `Could not load saves: ${err.message}`, 'bad'));
});
els.text.addEventListener('input', drawVisualSoon);
els.text.addEventListener('keydown', (e) => {
  // Tab indents instead of leaving the box, as in any text editor.
  if (e.key !== 'Tab' || e.shiftKey) return;
  e.preventDefault();
  els.text.setRangeText('  ', els.text.selectionStart, els.text.selectionEnd, 'end');
  drawVisualSoon();
});

try {
  client = await connect(BASE);
  ({ repo, branch } = client);
  await listPages();
  fillPicker();
  drawVisual();

  // Opened from the CMS: ?embed=1 inside its panel, ?page=<slug> from a page's edit screen.
  const params = new URLSearchParams(location.search);
  if (params.has('embed')) document.documentElement.classList.add('embed');
  const wanted = params.get('page');
  if (wanted && pages.has(wanted)) {
    els.page.value = wanted;
    await loadSelected();
  }
} catch (err) {
  els.page.textContent = '';
  els.page.append(new Option('Pages unavailable', ''));
  handle(err);
}
