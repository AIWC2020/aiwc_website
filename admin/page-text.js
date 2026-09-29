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

let repo = null;          // "owner/name"
let branch = 'main';
let token = null;
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
  if (link) box.append(' ', el('a', { href: link.href, textContent: link.label, target: link.external ? '_blank' : '', rel: 'noopener' }));
};
const status = (...args) => say(els.status, ...args);

const when = (iso) => new Date(iso).toLocaleString(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});
const short = (sha) => sha.slice(0, 7);
const who = (c) => c.commit?.author?.name || c.author?.login || 'someone';
// CMS commit messages read: Update page “news”. Keep them readable as-is.
const what = (c) => c.commit.message.split('\n')[0];

/* ---------- GitHub ---------- */

const readToken = () => {
  try {
    const user = JSON.parse(localStorage.getItem('sveltia-cms.user') || 'null');
    return typeof user?.token === 'string' && user.token ? user.token : null;
  } catch {
    return null;
  }
};

class NotSignedIn extends Error {}

const gh = async (path, options = {}) => {
  if (!token) throw new NotSignedIn();
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw new NotSignedIn();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || `GitHub replied ${res.status}`), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
};

const fromBase64 = (b64) => {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const pagePath = (slug) => `content/pages/${slug}.json`;
const slugOf = (path) => path.replace(/^content\/pages\//, '').replace(/\.json$/, '');

const listPages = async () => {
  const items = await gh(`/repos/${repo}/contents/content/pages?ref=${encodeURIComponent(branch)}`);
  pages = new Map(items.filter((f) => f.type === 'file' && f.name.endsWith('.json')).map((f) => [slugOf(f.path), { sha: f.sha }]));
};

/** A file's text at a commit (or the branch). Files over 1 MB come back
 *  without content from this endpoint; the blob endpoint has no limit. */
const readFile = async (path, ref = branch) => {
  const file = await gh(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
  const b64 = file.content || (await gh(`/repos/${repo}/git/blobs/${file.sha}`)).content;
  return { text: fromBase64(b64), sha: file.sha };
};

const readBlob = async (sha) => fromBase64((await gh(`/repos/${repo}/git/blobs/${sha}`)).content);

const commitsFor = (path, page) =>
  gh(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=10&page=${page}`);

/** Every file in the repository at a commit, as Map(path -> { sha, mode }). */
const filesAt = async (commitSha) => {
  const commit = await gh(`/repos/${repo}/git/commits/${commitSha}`);
  const tree = await gh(`/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('The repository is too large to compare in one go.');
  return {
    treeSha: commit.tree.sha,
    files: new Map(tree.tree.filter((t) => t.type === 'blob').map((t) => [t.path, { sha: t.sha, mode: t.mode }])),
  };
};

/* ---------- checks (mirror scripts/verify.mjs and the build) ---------- */

/** Line and column for a JSON.parse failure, from the character position. */
const whereInText = (text, err) => {
  const pos = Number(String(err.message).match(/position (\d+)/)?.[1]);
  if (!Number.isFinite(pos)) return '';
  const before = text.slice(0, pos).split('\n');
  return ` (line ${before.length}, column ${before.at(-1).length + 1})`;
};

const explainRenderFailure = (err) => {
  const field = String(err?.message || err).match(/reading '([^']+)'/)?.[1];
  if (field === 'image') return 'A picture field is empty (null). Give it an image, or remove that picture field.';
  if (field) return `The field “${field}”, or the section that holds it, is empty but the page needs a value there.`;
  return 'The page could not be drawn. Check the section you changed last.';
};

/**
 * Returns { data, errors, warnings }. Errors block saving; warnings do not.
 * `known` is the set of page addresses that will exist once this is saved.
 */
const checkText = (text, known = new Set(pages.keys())) => {
  const errors = [];
  const warnings = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    errors.push(`The text is not valid JSON${whereInText(text, err)}. Look for a missing or extra comma, or a missing quote, near there.`);
    return { data: null, errors, warnings };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('The text must be one { … } page object.');
    return { data: null, errors, warnings };
  }

  if (typeof data.menuName !== 'string' || !data.menuName.trim()) errors.push('“menuName” is missing — the name shown in the menu.');
  if (typeof data.slug !== 'string' || !/^[a-z0-9-]+$/.test(data.slug)) {
    errors.push('“slug” (the page address) must use lower-case letters, numbers and hyphens only, e.g. "water-talks".');
  }
  if (!Number.isInteger(data.order) || data.order < 1) errors.push('“order” must be a whole number of 1 or more.');
  if (data.published !== undefined && typeof data.published !== 'boolean') errors.push('“published” must be true or false, without quotes.');
  if (data.blocks !== undefined && !Array.isArray(data.blocks)) errors.push('“blocks” must be a [ … ] list.');
  if (data.published === false) warnings.push('“published” is false, so this page will be saved but hidden from the site.');

  const targets = new Set([...known, data.slug]);
  for (const [, target] of JSON.stringify(data).matchAll(/"page":\s*"([^"]+)"/g)) {
    if (!targets.has(target)) errors.push(`It links to a page that does not exist: "${target}".`);
  }

  if (!errors.length) {
    try {
      const doc = document.implementation.createHTMLDocument('check');
      renderPage(doc, { template: 'standard', intro: {}, blocks: [], ...data }, {
        people: [], partners: [], index: 1, total: 1,
        urlFor: () => '#', entryUrl: () => '#', t: (k) => k,
      });
    } catch (err) {
      errors.push(`${explainRenderFailure(err)}\n  Technical detail: ${err?.message || err}`);
    }
  }
  return { data, errors, warnings };
};

const report = ({ errors, warnings }, okText) => {
  if (errors.length) {
    status(`Can’t be saved yet — fix ${errors.length === 1 ? 'this' : 'these'} first:\n• ${errors.join('\n• ')}`, 'bad');
    return false;
  }
  status(warnings.length ? `${okText}\n• ${warnings.join('\n• ')}` : okText, warnings.length ? 'warn' : 'good');
  return true;
};

/* ---------- editor ---------- */

const setText = (text, label, viewing = false) => {
  els.text.value = text.endsWith('\n') ? text : `${text}\n`;
  els.fileName.textContent = label;
  els.fileName.classList.toggle('viewing', viewing);
  els.save.textContent = viewing ? 'Restore this version' : 'Save to site';
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
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    let run;
    try {
      run = (await gh(`/repos/${repo}/actions/runs?head_sha=${commitSha}&per_page=1`)).workflow_runs?.[0];
    } catch {
      return; // no permission to read Actions; the saved message stands
    }
    if (run?.status === 'completed') {
      if (run.conclusion === 'success') say(box, success, 'good', successLink);
      else say(box, 'Saved, but the site could not update, so nothing on the live site changed.', 'bad', { href: run.html_url, label: 'See what went wrong', external: true });
      return;
    }
  }
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
    const res = await gh(`/repos/${repo}/contents/${pagePath(target)}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: toBase64(text), branch, ...(existing ? { sha: existing.sha } : {}) }),
    });
    pages.set(target, { sha: res.content.sha });
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
els.text.addEventListener('keydown', (e) => {
  // Tab indents instead of leaving the box, as in any text editor.
  if (e.key !== 'Tab' || e.shiftKey) return;
  e.preventDefault();
  els.text.setRangeText('  ', els.text.selectionStart, els.text.selectionEnd, 'end');
});

try {
  const site = await fetch(`${BASE}/content/site.json`).then((r) => r.json());
  repo = site.cms?.repo;
  branch = site.cms?.branch || 'main';
  token = readToken();
  await listPages();
  fillPicker();
} catch (err) {
  els.page.textContent = '';
  els.page.append(new Option('Pages unavailable', ''));
  handle(err);
}
