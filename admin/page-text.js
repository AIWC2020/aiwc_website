/**
 * Page text — export and import a page as its JSON file, outside the CMS form.
 *
 * Each page is one file, content/pages/<slug>.json. This screen reads and
 * writes those files through GitHub's API with the token the CMS already
 * holds (Sveltia keeps it in local storage), so there is no second sign-in and
 * a save here is an ordinary commit that deploys like any CMS save.
 *
 * Before anything is written, the text is checked the way the build checks
 * it: it must parse, carry the fields every page needs, link only to pages
 * that exist, and render with the site's own renderer. A page that fails any
 * of those would stop the whole site deploying, so it is refused here.
 */

const BASE = new URL('.', import.meta.url).pathname.replace(/\/admin\/$/, '');
const { renderPage } = await import(`${BASE}/assets/templates.mjs`);

const $ = (id) => document.getElementById(id);
const els = {
  page: $('page'), fresh: $('new'), upload: $('upload'), download: $('download'),
  text: $('text'), check: $('check'), save: $('save'), status: $('status'), fileName: $('file-name'),
};

/* ---------- state ---------- */

let repo = null;          // "owner/name"
let branch = 'main';
let token = null;
let pages = new Map();    // slug -> { sha, path }
let loadedSlug = null;    // the page the text came from, if any

/* ---------- status line ---------- */

const say = (text, tone = '', link = null) => {
  els.status.className = tone;
  els.status.textContent = text;
  if (link) {
    els.status.append(' ');
    const a = document.createElement('a');
    a.href = link.href;
    a.textContent = link.label;
    if (link.external) { a.target = '_blank'; a.rel = 'noopener'; }
    els.status.append(a);
  }
};

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

const listPages = async () => {
  const items = await gh(`/repos/${repo}/contents/content/pages?ref=${encodeURIComponent(branch)}`);
  pages = new Map(
    items
      .filter((f) => f.type === 'file' && f.name.endsWith('.json'))
      .map((f) => [f.name.replace(/\.json$/, ''), { sha: f.sha, path: f.path }])
  );
};

const readPage = async (slug) => {
  const file = await gh(`/repos/${repo}/contents/${pagePath(slug)}?ref=${encodeURIComponent(branch)}`);
  // Files over 1 MB come back without content; the blob endpoint has no limit.
  const b64 = file.content || (await gh(`/repos/${repo}/git/blobs/${file.sha}`)).content;
  return { text: fromBase64(b64), sha: file.sha };
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
 */
const checkText = (text) => {
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

  const known = new Set([...pages.keys(), data.slug]);
  for (const [, target] of JSON.stringify(data).matchAll(/"page":\s*"([^"]+)"/g)) {
    if (!known.has(target)) errors.push(`It links to a page that does not exist: "${target}".`);
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
    say(`Can’t be saved yet — fix ${errors.length === 1 ? 'this' : 'these'} first:\n• ${errors.join('\n• ')}`, 'bad');
    return false;
  }
  say(warnings.length ? `${okText}\n• ${warnings.join('\n• ')}` : okText, warnings.length ? 'warn' : 'good');
  return true;
};

/* ---------- actions ---------- */

const setText = (text, label) => {
  els.text.value = text.endsWith('\n') ? text : `${text}\n`;
  els.fileName.textContent = label;
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
  if (!slug) return;
  say('Loading…');
  try {
    const { text, sha } = await readPage(slug);
    pages.set(slug, { ...pages.get(slug), sha });
    loadedSlug = slug;
    setText(text, `Editing ${pagePath(slug)}`);
    say('');
  } catch (err) {
    handle(err);
  }
};

const download = () => {
  const { data } = checkText(els.text.value);
  const name = `${data?.slug || loadedSlug || 'page'}.json`;
  const url = URL.createObjectURL(new Blob([els.text.value], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
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
  setText(text, `Uploaded ${file.name} — not saved yet`);
  const result = checkText(text);
  if (result.data?.slug && pages.has(result.data.slug)) {
    result.warnings.unshift(`A page with the address "${result.data.slug}" already exists — saving will replace it with this file.`);
  }
  report(result, 'File loaded and checked. Press “Save to site” to publish it.');
};

/** Follows the deploy for a commit so a failed build is never silent. */
const watchDeploy = async (commitSha, slug, published) => {
  const live = `${BASE}/${slug}/`;
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    let run;
    try {
      run = (await gh(`/repos/${repo}/actions/runs?head_sha=${commitSha}&per_page=1`)).workflow_runs?.[0];
    } catch {
      return; // no permission to read Actions; the saved message stands
    }
    if (run?.status === 'completed') {
      if (run.conclusion === 'success') {
        say(published === false ? 'Saved and the site has updated. The page is hidden (published: false).' : 'Saved — the page is live.', 'good',
          published === false ? null : { href: live, label: `Open ${live}`, external: true });
      } else {
        say('Saved, but the site could not update. Nothing on the live site changed.', 'bad',
          { href: run.html_url, label: 'See what went wrong', external: true });
      }
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
  if (existing && target === loadedSlug) {
    question = `Publish your changes to “${data.menuName}” (/${target}/)?`;
  } else if (existing) {
    question = `A page with the address "${target}" already exists. Replace it with this text?`;
  } else {
    question = `Create a new page at /${target}/?` +
      (loadedSlug ? `\n\n“${loadedSlug}” is not changed — you changed the address, so this makes a copy.` : '');
  }
  if (!confirm(question)) return;

  els.save.disabled = true;
  say('Saving…');
  try {
    const body = {
      message: `${existing ? 'Update' : 'Create'} page “${target}” (page text editor)`,
      content: toBase64(`${JSON.stringify(data, null, 2)}\n`),
      branch,
      ...(existing ? { sha: existing.sha } : {}),
    };
    const res = await gh(`/repos/${repo}/contents/${pagePath(target)}`, { method: 'PUT', body: JSON.stringify(body) });
    pages.set(target, { sha: res.content.sha, path: res.content.path });
    loadedSlug = target;
    fillPicker(target);
    setText(`${JSON.stringify(data, null, 2)}\n`, `Editing ${pagePath(target)}`);
    say('Saved. The site is updating — this usually takes 1–2 minutes…');
    watchDeploy(res.commit.sha, target, data.published);
  } catch (err) {
    if (err.status === 409 || err.status === 422) {
      say('Not saved — this page was changed by someone else (or in the CMS) after you loaded it. Download your text to keep it, reload the page, and apply your change again.', 'bad');
    } else {
      handle(err);
    }
  } finally {
    els.save.disabled = false;
  }
};

const handle = (err) => {
  if (err instanceof NotSignedIn) {
    say('You are not signed in. Sign in to the content admin first, then come back to this screen.', 'bad', { href: './', label: 'Open the content admin' });
  } else {
    say(`Something went wrong: ${err.message}`, 'bad');
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
  setText(JSON.stringify(TEMPLATE, null, 2), 'New page from the template — change “slug”, “menuName” and “order”, then save');
  say('');
});
els.upload.addEventListener('change', () => { upload(els.upload.files[0]); els.upload.value = ''; });
els.download.addEventListener('click', download);
els.check.addEventListener('click', () => report(checkText(els.text.value), 'Looks good — this page can be saved.'));
els.save.addEventListener('click', save);
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
