/**
 * Structural checks over the built site. Fails the build rather than
 * shipping pages that are broken in ways a screenshot would not reveal:
 * dead internal links, missing images, empty blocks, absent metadata.
 *
 * Run after scripts/build.mjs.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import YAML from 'yaml';
import { buildRegistry, loadCollections, loadSite } from '../src/registry.mjs';
import { BLOCK_TYPES } from '../src/templates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const SITE = loadSite(ROOT);
const BASE = SITE.base;

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

if (!existsSync(OUT)) {
  console.error('_site/ does not exist — run `npm run build` first.');
  process.exit(1);
}

/* every built document */
// admin/ and editor/ are editing tools, not site pages — no chrome to check.
const SKIP_DIRS = new Set(['admin', 'assets', 'content']);
const docs = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (dir === OUT && SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry === 'index.html' || entry === '404.html') docs.push(full);
  }
};
walk(OUT);

const PAGES = buildRegistry(ROOT);
const { people, partners } = loadCollections(ROOT);
const expected = PAGES.length + people.length + partners.length;
const built = docs.filter((d) => d.endsWith('index.html')).length;
if (built !== expected * SITE.languages.length) {
  fail('build', `expected ${expected * SITE.languages.length} pages, found ${built}`);
}

/* ── per-document checks ────────────────────────────────────────────── */

const localPath = (href) => {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean.startsWith('/')) return null;
  const rel = BASE && clean.startsWith(BASE + '/') ? clean.slice(BASE.length) : clean;
  return join(OUT, rel.replace(/^\//, ''));
};

let checkedLinks = 0;
let checkedImages = 0;

for (const file of docs) {
  const rel = file.replace(OUT, '') || '/';
  const { document } = parseHTML(readFileSync(file, 'utf8'));

  /* metadata */
  const title = document.querySelector('title')?.textContent.trim();
  if (!title) fail(rel, 'missing <title>');
  if (!document.querySelector('meta[name="description"]')?.getAttribute('content')) {
    fail(rel, 'missing meta description');
  }
  if (!file.endsWith('404.html') && !document.querySelector('link[rel="canonical"]')) {
    fail(rel, 'missing canonical link');
  }

  /* the behaviour script is on every page — without it the filters, menus,
     search and groups all stop working while the page still looks fine */
  if (!file.endsWith('404.html') && !document.querySelector('script[type="module"][src$="/assets/app.mjs"]')) {
    fail(rel, 'the page does not load /assets/app.mjs, so filters, menus and search would not work');
  }

  /* exactly one h1, and it is not empty */
  const h1s = document.querySelectorAll('h1');
  if (h1s.length !== 1) fail(rel, `expected 1 <h1>, found ${h1s.length}`);
  else if (!h1s[0].textContent.trim()) fail(rel, 'empty <h1>');

  /* navigation present and pointing somewhere real: the logo is home, and
     every other published page is reachable from the header menu */
  const navSlugs = new Set(
    [...document.querySelectorAll('[data-site-nav] a[data-tab]')].map((a) => a.getAttribute('data-tab'))
  );
  if (PAGES[0] && document.querySelector('.brand[href]')) navSlugs.add(PAGES[0].slug);
  const missing = PAGES.filter((p) => !navSlugs.has(p.slug)).map((p) => p.slug);
  if (missing.length) {
    fail(rel, `header navigation does not list: ${missing.join(', ')} — add them in the CMS under Logo & site settings → Header menu`);
  }

  /* internal links resolve to a built file */
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || /^(https?:|mailto:|tel:|#)/.test(href)) continue;
    checkedLinks++;
    const target = localPath(href);
    if (!target) { fail(rel, `relative link not rebased: ${href}`); continue; }
    if (!existsSync(join(target, 'index.html')) && !existsSync(target)) {
      fail(rel, `dead internal link: ${href}`);
    }
  }

  /* every image points at a file that exists */
  for (const img of document.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (/^(https?:|data:)/.test(src)) continue;
    checkedImages++;
    const target = localPath(src);
    if (!target || !existsSync(target)) fail(rel, `missing image: ${src}`);
    if (img.getAttribute('alt') === null) fail(rel, `image without alt attribute: ${src}`);
  }

  /* no block rendered itself empty */
  for (const band of document.querySelectorAll('main .band')) {
    if (!band.textContent.trim() && !band.querySelector('img')) {
      fail(rel, 'a band rendered with no content');
    }
  }
}

/* ── header menu and card links that jump to a section ────────────────
   A section address that no longer exists (a heading was renamed) still
   lands on the right page, just at the top — so this warns, it does not
   stop the site publishing. */

const sectionLinks = [];
const navFile = join(ROOT, 'content/navigation.json');
if (existsSync(navFile)) {
  for (const tab of JSON.parse(readFileSync(navFile, 'utf8')).tabs || []) {
    for (const item of tab.items || []) if (item.page && item.section) sectionLinks.push([`Header menu → ${tab.label} → ${item.label}`, item.page, item.section]);
  }
}
for (const page of PAGES) {
  (page.blocks || []).forEach((block) => {
    if (block.type !== 'storyCards') return;
    (block.items || []).forEach((item) => {
      if (item.page && item.section && !item.url) sectionLinks.push([`${page.slug} → card “${item.title}”`, item.page, item.section]);
    });
  });
}
const staleSections = [];
for (const [where, slug, section] of sectionLinks) {
  const page = PAGES.find((p) => p.slug === slug);
  if (!page) continue;
  const file = join(OUT, slug === PAGES[0].slug ? '' : slug, 'index.html');
  if (existsSync(file) && !readFileSync(file, 'utf8').includes(`id="${String(section).replace(/^#/, '')}"`)) {
    staleSections.push(`${where}: no section “${section}” on ${slug}`);
  }
}

/* ── content-level checks ───────────────────────────────────────────── */

const thin = [];
const noPortrait = [];
for (const p of people) {
  if (!p.name) fail(`people/${p.slug}`, 'missing name');
  if (!p.institute) fail(`people/${p.slug}`, 'missing institution');
  // A profile with no portrait now renders a monogram rather than a hole, so
  // it is publishable. Blocking the entire site over one missing photo was a
  // cure far worse than the disease — it froze every page for two weeks in
  // August. Nobody *means* to publish a profile without a picture, so it is
  // still named on every run.
  if (!p.photo?.image) noPortrait.push(p.slug);
  // Some researchers left the biography fields blank on aiwc.org.au. That is
  // upstream data, not a build fault — surface it so it can be chased, but
  // do not block a release on it.
  if (!p.bio?.length && !p.sections?.length && !p.interests) thin.push(p.slug);
}
for (const p of partners) {
  if (!p.logo?.image) fail(`partners/${p.slug}`, 'missing logo');
  if (!p.country) fail(`partners/${p.slug}`, 'missing country');
}

/* internal write-ups must never reach the published site */
for (const dir of ['reports', 'scripts', 'src', 'editor']) {
  if (existsSync(join(OUT, dir))) fail('build', `${dir}/ was copied into _site — it must not ship`);
}

/* the generated CMS config is complete and points at this repo */
const builtCms = join(OUT, 'admin/config.yml');
if (existsSync(builtCms)) {
  const raw = readFileSync(builtCms, 'utf8');
  const left = raw.match(/\{\{[A-Z_]+\}\}/g);
  if (left) fail('_site/admin/config.yml', `unresolved placeholders: ${[...new Set(left)].join(', ')}`);
  try {
    const built = YAML.parse(raw);
    if (!built.backend?.repo) fail('_site/admin/config.yml', 'backend.repo is empty');
    // The media path the CMS writes must match the path the site serves,
    // or uploads 404 after a base-path change.
    if (built.public_folder !== `${BASE}/assets/photos`) {
      fail('_site/admin/config.yml', `public_folder is "${built.public_folder}", expected "${BASE}/assets/photos"`);
    }
  } catch (err) {
    fail('_site/admin/config.yml', `is not valid YAML: ${err.message}`);
  }
}

/* preview styles load as files. The CMS turns an inline style string into a
   blob: URL, which the admin's Content-Security-Policy (style-src 'self')
   blocks without any visible error — the logo preview and the version
   picker shipped unstyled that way. */
const previewJs = join(OUT, 'admin/preview.js');
if (existsSync(previewJs)) {
  const js = readFileSync(previewJs, 'utf8');
  if (/raw:\s*true/.test(js)) {
    fail('admin/preview.js', 'registers an inline preview style ({ raw: true }); the admin CSP blocks it — put the CSS in admin/preview.css');
  }
  for (const [, href] of js.matchAll(/registerPreviewStyle\(`\$\{BASE\}\/([^`]+)`/g)) {
    if (!existsSync(join(OUT, href))) fail('admin/preview.js', `preview stylesheet ${href} is not in the built site`);
  }
}

/* the CMS can edit every block the renderer can draw, and vice versa */
const cmsPath = join(ROOT, 'admin/config.yml');
if (existsSync(cmsPath)) {
  let cms;
  try {
    cms = YAML.parse(readFileSync(cmsPath, 'utf8'));
  } catch (err) {
    fail('admin/config.yml', `is not valid YAML: ${err.message}`);
  }
  if (cms) {
    const pagesCollection = cms.collections?.find((c) => c.name === 'pages');
    const editable = new Set(
      (pagesCollection?.fields?.find((f) => f.name === 'blocks')?.types || []).map((t) => t.name)
    );
    for (const type of BLOCK_TYPES) {
      if (!editable.has(type)) fail('admin/config.yml', `block type "${type}" has no CMS editor`);
    }
    for (const type of editable) {
      if (!BLOCK_TYPES.includes(type)) fail('admin/config.yml', `CMS offers "${type}" but the site cannot render it`);
    }
    // A block type used by real content but absent from the CMS is the worst
    // case: an editor opening that page would silently drop it on save.
    const used = new Set(PAGES.flatMap((p) => (p.blocks || []).map((b) => b.type)));
    for (const type of used) {
      if (!editable.has(type)) fail('content', `block type "${type}" is in use but not editable in the CMS`);
    }

    // Anything this file refuses to publish without must be required in the
    // CMS too. Otherwise the editor is told a field is optional, saves without
    // it, and the build then rejects the whole site — every page stops
    // deploying until someone thinks to read the Actions log. That is exactly
    // what one empty profile did on 2026-08-18: the portrait was optional
    // here and mandatory above, and five content commits sat unpublished for
    // two weeks while the CMS reported every save as successful.
    const requiredInCms = {
      portraitDirectory: ['name', 'institute'],
      partnerDirectory: ['name', 'country', 'logo'],
    };
    const blockTypes = pagesCollection?.fields?.find((f) => f.name === 'blocks')?.types || [];
    for (const [block, names] of Object.entries(requiredInCms)) {
      const itemFields = blockTypes.find((t) => t.name === block)?.fields?.find((f) => f.name === 'items')?.fields;
      if (!itemFields) {
        fail('admin/config.yml', `${block} has no "items" list, so its fields cannot be checked`);
        continue;
      }
      for (const name of names) {
        const field = itemFields.find((f) => f.name === name);
        if (!field) {
          fail('admin/config.yml', `${block}.${name} has no CMS field, but the build requires it`);
          continue;
        }
        if (field.required === false) {
          fail('admin/config.yml', `${block}.${name} is optional in the CMS but mandatory in this file`);
        }
        // Requiring the wrapper object is not enough — an empty object still
        // satisfies it. The image inside is the thing the build actually reads.
        const image = field.fields?.find((f) => f.name === 'image');
        if (image?.required === false) {
          fail('admin/config.yml', `${block}.${name}.image is optional in the CMS but mandatory in this file`);
        }
      }
    }
  }
}

/* every page referenced by an action or card actually exists */
const slugs = new Set(PAGES.map((p) => p.slug));
for (const page of PAGES) {
  const refs = JSON.stringify(page).matchAll(/"page":\s*"([^"]+)"/g);
  for (const [, target] of refs) {
    if (!slugs.has(target)) fail(`content/pages/${page.slug}.json`, `links to unknown page "${target}"`);
  }
}

/* ── report ─────────────────────────────────────────────────────────── */

console.log(
  `Checked ${docs.length} documents, ${checkedLinks} internal links, ${checkedImages} images, ` +
    `${people.length} profiles, ${partners.length} partners.`
);

if (thin.length) {
  console.warn(
    `\n${thin.length} profile${thin.length > 1 ? 's have' : ' has'} no biography on aiwc.org.au ` +
      `(name, role and portrait only): ${thin.join(', ')}`
  );
}

if (noPortrait.length) {
  console.warn(
    `\n${noPortrait.length} profile${noPortrait.length > 1 ? 's have' : ' has'} no portrait ` +
      `(shown as initials until one is uploaded): ${noPortrait.join(', ')}`
  );
}

if (staleSections.length) {
  console.warn(`\n${staleSections.length} link${staleSections.length > 1 ? 's jump' : ' jumps'} to a section that does not exist (the page still opens, at the top):`);
  for (const line of staleSections) console.warn('  ! ' + line);
}

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''}:`);
  for (const p of problems.slice(0, 40)) console.error('  ✗ ' + p);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  process.exit(1);
}
console.log('All checks passed.');
