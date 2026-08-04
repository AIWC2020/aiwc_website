/**
 * Static site build: content/ → _site/, one real document per URL.
 *
 * index.html is the chrome template only — head, CSS, rail, footer. The
 * build renders every page and every collection entry from data through
 * src/templates.mjs, so there is exactly one rendering path and the CMS
 * preview can import the same module.
 *
 * Base path: a CNAME file means the site owns a domain root and URLs start
 * at "/". Without one this is a GitHub *project* page served under
 * /<repo>/, so every absolute URL is prefixed with content/site.json's
 * `base`. Getting this wrong is the classic Pages failure — a site that
 * works locally and 404s everything once published.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { renderPage, renderPerson, renderPartner } from '../src/templates.mjs';
import { buildRegistry, loadCollections, loadSite, navTree, urlFor, urlForEntry } from '../src/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');

const SITE = loadSite(ROOT);
const BASE = SITE.base;
const SITE_URL = SITE.url.replace(/\/$/, '');
const LANGS = SITE.languages;

const template = readFileSync(join(ROOT, 'index.html'), 'utf8');
const PAGES = buildRegistry(ROOT);
const { people, partners } = loadCollections(ROOT);
const pageById = new Map(PAGES.map((p) => [p.slug, p]));

const href = (lang, page) => urlFor(lang, page, PAGES, BASE);
const entryHref = (lang, kind, slug) => urlForEntry(lang, kind, slug, BASE);

/**
 * MARVI's renderers expect { index, total, urlFor } and build their own
 * per-block `t`. AIWC's two collection blocks additionally need the people
 * and partner records and a way to link to their pages, so the context is
 * MARVI's plus those three.
 */
const ctxFor = (lang, extra = {}) => ({
  people,
  partners,
  urlFor: (id) => href(lang, pageById.get(id) || PAGES[0]),
  entryUrl: (kind, slug) => entryHref(lang, kind, slug),
  t: (key) => key,
  ...extra,
});

/* ── chrome ─────────────────────────────────────────────────────────── */

/**
 * Build the shell once: rail navigation, language switch, footer links.
 * `activeSlug` marks the current page; `panel` is the rendered content.
 */
function composeDocument(lang, activeSlug, panel, { langBase = '' } = {}) {
  const { document } = parseHTML(template);

  // index.html carries the authored panels it was migrated from. They are
  // historical: every panel is rendered from content/ instead, so they are
  // stripped here. Leaving them in was how MARVI's own copy briefly appeared
  // on every AIWC page.
  document.querySelectorAll('[data-panel]').forEach((n) => n.remove());

  // Only external scripts are stripped — behaviour ships as /assets/app.mjs.
  document.querySelectorAll('script[src]').forEach((n) => n.remove());

  /* rail navigation, from the registry */
  for (const nav of document.querySelectorAll('.side-nav')) {
    nav.textContent = '';
    // MARVI's rail markup exactly: thumbnail, number, name, arrow. The
    // stylesheet targets these class names, so they are not negotiable.
    let top = 0;
    navTree(PAGES).forEach(({ page, depth }) => {
      const link = document.createElement('a');
      link.className = 'nav-tab' + (depth ? ' is-child' : '');
      link.setAttribute('href', href(lang, page));
      link.setAttribute('data-tab', page.slug);
      if (page.slug === activeSlug) link.setAttribute('aria-current', 'page');

      const thumb = document.createElement('img');
      thumb.className = 'nav-thumb';
      thumb.setAttribute('alt', '');
      thumb.setAttribute('aria-hidden', 'true');
      const menuImage = page.menuImage || page.heroImage;
      if (menuImage?.image) thumb.setAttribute('src', menuImage.image);

      const number = document.createElement('span');
      number.className = 'nav-number';
      number.textContent = depth ? '—' : String(++top).padStart(2, '0');

      const name = document.createElement('span');
      name.className = 'nav-name';
      name.textContent = page.menuName;

      const arrow = document.createElement('span');
      arrow.className = 'nav-arrow';
      arrow.textContent = '↗';

      link.append(thumb, number, name, arrow);
      nav.appendChild(link);
    });
  }

  /* brand marks link home */
  document.querySelectorAll('[data-open="home"]').forEach((n) => {
    n.setAttribute('href', href(lang, PAGES[0]));
  });

  /* The rail foot's institution count comes from the real partner records,
     so it can never drift from the site again (it shipped as "27" for a
     while after the partner list had grown to 33). */
  const foot = document.querySelector('.sidebar-foot');
  if (foot && foot.firstChild?.nodeType === 3 && partners.length) {
    foot.firstChild.textContent = `${partners.length} institutions`;
  }

  /* language switch — only meaningful once a second language exists */
  const select = document.getElementById('lang-select');
  if (select) {
    if (LANGS.length < 2) {
      select.closest('.lang-switch')?.remove();
    } else {
      select.setAttribute('data-lang-base', langBase);
      select.setAttribute('data-site-base', BASE);
      select.querySelectorAll('option').forEach((opt) => {
        if (!LANGS.includes(opt.value)) opt.remove();
        else if (opt.value === lang) opt.setAttribute('selected', 'selected');
        else opt.removeAttribute('selected');
      });
    }
  }

  /* footer links that point at real pages */
  const footerNav = document.querySelector('[data-footer-nav]');
  if (footerNav) {
    footerNav.textContent = '';
    for (const page of PAGES.filter((p) => !p.parent).slice(0, 6)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.setAttribute('href', href(lang, page));
      a.textContent = page.menuName;
      li.appendChild(a);
      footerNav.appendChild(li);
    }
  }

  document.getElementById('content').appendChild(panel);

  const app = document.createElement('script');
  app.setAttribute('type', 'module');
  app.setAttribute('src', BASE + '/assets/app.mjs');
  document.body.appendChild(app);

  return document;
}

/* ── URL rewriting ──────────────────────────────────────────────────── */

const isAbsolute = (v) => /^(https?:|data:|mailto:|tel:|#|\/\/)/.test(v);

/** Prefix every site-absolute path with the project base. */
const rebase = (document) => {
  if (!BASE) return;
  const fix = (node, attr) => {
    const v = node.getAttribute(attr);
    if (!v || isAbsolute(v) || v.startsWith(BASE + '/')) return;
    if (v.startsWith('/')) node.setAttribute(attr, BASE + v);
  };
  document.querySelectorAll('[src]').forEach((n) => fix(n, 'src'));
  document.querySelectorAll('link[href]').forEach((n) => fix(n, 'href'));
  document.querySelectorAll('a[href]').forEach((n) => fix(n, 'href'));

  // The cover photo is set as an inline custom property by the renderer, so
  // it is a url() inside a style attribute rather than an src — the loop
  // above never sees it, and it 404s on a project page.
  const rebaseCss = (css) =>
    css.replace(/url\(\s*(['"]?)(\/[^'")]+)\1\s*\)/g, (whole, q, path) =>
      path.startsWith(BASE + '/') ? whole : `url(${q}${BASE}${path}${q})`);
  document.querySelectorAll('[style]').forEach((n) => {
    const value = n.getAttribute('style');
    if (value && value.includes('url(')) n.setAttribute('style', rebaseCss(value));
  });
  document.querySelectorAll('style').forEach((n) => {
    if (n.textContent.includes('url(')) n.textContent = rebaseCss(n.textContent);
  });
};

/* ── head metadata ──────────────────────────────────────────────────── */

function applyHead(document, { lang, title, description, canonical, image, alternates = [] }) {
  const head = document.querySelector('head');
  document.querySelector('title').textContent = title;
  document.documentElement.setAttribute('lang', lang);

  head.querySelectorAll('meta[name="description"]').forEach((n) => n.remove());
  const meta = (attr, key, value) => {
    if (!value) return;
    const tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    tag.setAttribute('content', value);
    head.appendChild(tag);
  };
  const link = (rel, hrefValue, hreflang) => {
    const tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    tag.setAttribute('href', hrefValue);
    if (hreflang) tag.setAttribute('hreflang', hreflang);
    head.appendChild(tag);
  };

  meta('name', 'description', description);
  link('canonical', canonical);
  alternates.forEach(([l, url]) => link('alternate', url, l));

  meta('property', 'og:type', 'website');
  meta('property', 'og:site_name', SITE.name);
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  meta('property', 'og:url', canonical);
  meta('property', 'og:locale', lang);
  meta('property', 'og:image', image);
  meta('name', 'twitter:card', 'summary_large_image');
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', description);
  meta('name', 'twitter:image', image);
}

const absImage = (src) => (src ? (src.startsWith('http') ? src : SITE_URL + (src.startsWith(BASE) ? src : BASE + src)) : null);

/* ── run ────────────────────────────────────────────────────────────── */

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const write = (relPath, contents) => {
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
};

const emit = (relPath, document) => {
  rebase(document);
  write(join(relPath, 'index.html'), '<!DOCTYPE html>\n' + document.documentElement.outerHTML);
};

const urls = [];
let count = 0;

for (const lang of LANGS) {
  const ctx = ctxFor(lang);

  /* pages */
  for (const [i, page] of PAGES.entries()) {
    const panel = renderPage(
      parseHTML('<div></div>').document,
      page,
      ctxFor(lang, { index: i + 1, total: PAGES.length })
    );
    const isHome = page.slug === PAGES[0].slug;
    const rel = href(lang, page);
    const doc = composeDocument(lang, page.slug, panel, { langBase: isHome ? '' : page.slug + '/' });
    const description = page.intro?.lede || SITE.description;
    applyHead(doc, {
      lang,
      title: isHome ? `${SITE.name} — ${SITE.tagline}` : `${page.intro?.title?.replace(/\n/g, ' ') || page.menuName} — ${SITE.name}`,
      description,
      canonical: SITE_URL + rel,
      // Pages without a header photo (the home page runs the animated water
      // field instead) still need a share image for link unfurls.
      image: absImage(page.heroImage?.image) || absImage('/assets/photos/page-aiwc5-conference-0.jpg'),
      alternates: LANGS.length > 1 ? LANGS.map((l) => [l, SITE_URL + href(l, page)]) : [],
    });
    emit(rel.replace(BASE, '').replace(/^\//, ''), doc);
    urls.push(rel);
    count++;

    if (isHome && lang === 'en') {
      // 404 needs the same chrome; GitHub Pages serves it from the root.
      const notFound = composeDocument(
        lang, null,
        renderPage(parseHTML('<div></div>').document, page, ctxFor(lang, { index: 1, total: PAGES.length }))
      );
      applyHead(notFound, { lang, title: `Page not found — ${SITE.name}`, description: SITE.description, canonical: SITE_URL + rel });
      rebase(notFound);
      write('404.html', '<!DOCTYPE html>\n' + notFound.documentElement.outerHTML);
    }
  }

  /* researcher profiles */
  for (const person of people) {
    const panel = renderPerson(parseHTML('<div></div>').document, person, ctx);
    const rel = entryHref(lang, 'people', person.slug);
    const doc = composeDocument(lang, 'people', panel, { langBase: `people/${person.slug}/` });
    applyHead(doc, {
      lang,
      title: `${person.name} — ${SITE.name}`,
      description: person.interests || `${person.designation || 'Researcher'} at ${person.institute}, part of the Australia India Water Centre.`,
      canonical: SITE_URL + rel,
      image: absImage(person.photo?.image),
      alternates: LANGS.length > 1 ? LANGS.map((l) => [l, SITE_URL + entryHref(l, 'people', person.slug)]) : [],
    });
    emit(rel.replace(BASE, '').replace(/^\//, ''), doc);
    urls.push(rel);
    count++;
  }

  /* partner institutions */
  for (const partner of partners) {
    const panel = renderPartner(parseHTML('<div></div>').document, partner, ctx);
    const rel = entryHref(lang, 'partners', partner.slug);
    const doc = composeDocument(lang, 'partners', panel, { langBase: `partners/${partner.slug}/` });
    applyHead(doc, {
      lang,
      title: `${partner.name} — ${SITE.name}`,
      description: partner.summary || `${partner.name} is a partner institution of the Australia India Water Centre.`,
      canonical: SITE_URL + rel,
      image: absImage(partner.logo?.image),
      alternates: LANGS.length > 1 ? LANGS.map((l) => [l, SITE_URL + entryHref(l, 'partners', partner.slug)]) : [],
    });
    emit(rel.replace(BASE, '').replace(/^\//, ''), doc);
    urls.push(rel);
    count++;
  }
}

/* ── static passthrough ─────────────────────────────────────────────── */

for (const dir of ['assets', 'content', 'admin']) {
  if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(OUT, dir), { recursive: true });
}

/**
 * The CMS config is a template: repo, branch, auth backend and the media
 * public path are filled in from content/site.json so there is one place to
 * change them.
 *
 * `public_folder` matters more than it looks — it is the path written into
 * the JSON when an editor picks an image. Hard-coding the base there means
 * every upload breaks the day a CNAME moves the site to a domain root.
 *
 * An empty `authUrl` drops the `base_url` line entirely, which is what the
 * no-broker (access-token) setup needs.
 */
const cmsTemplatePath = join(OUT, 'admin/config.yml');
if (existsSync(cmsTemplatePath)) {
  const cms = SITE.cms || {};
  let config = readFileSync(cmsTemplatePath, 'utf8')
    .replace('# {{GENERATED}}', '# Generated by scripts/build.mjs — edit content/site.json, not this file.')
    .replaceAll('{{REPO}}', cms.repo || '')
    .replaceAll('{{BRANCH}}', cms.branch || 'main')
    .replaceAll('{{BASE}}', BASE);

  config = cms.authUrl
    ? config.replaceAll('{{AUTH_URL}}', cms.authUrl)
    : config.replace(/^\s*base_url:\s*"\{\{AUTH_URL\}\}"\s*$\n/m, '');

  const unresolved = config.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) throw new Error(`admin/config.yml has unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
  writeFileSync(cmsTemplatePath, config);
}
cpSync(join(ROOT, 'src/app.mjs'), join(OUT, 'assets/app.mjs'));
cpSync(join(ROOT, 'src/templates.mjs'), join(OUT, 'assets/templates.mjs'));

// The CMS preview iframe needs the site's CSS as a standalone file.
const styles = [...parseHTML(template).document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
write('assets/site.css', styles);

/**
 * A blank example of every list item the content uses, keyed by the path the
 * list sits at. The editor needs this: with an empty array there is nothing
 * to copy the shape from, so "add the first item" is otherwise impossible —
 * which meant a researcher with no biography could never be given one.
 *
 * Derived from the real content, so a new block type is covered the moment
 * one exists anywhere.
 */
const shapes = {};
const blank = (v) => {
  if (Array.isArray(v)) return [];
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'type' ? x : blank(x)]));
  }
  return typeof v === 'number' ? 0 : typeof v === 'boolean' ? false : '';
};
const learn = (value, path) => {
  if (Array.isArray(value)) {
    // Keyed by field name, and by type for blocks, so `blocks` can offer
    // every variant rather than whichever happened to be first.
    if (value.length) {
      const key = path[path.length - 1];
      if (!shapes[key]) shapes[key] = blank(value[0]);
      for (const item of value) {
        if (item && typeof item === 'object' && item.type) {
          shapes[`${key}:${item.type}`] ||= blank(item);
        }
      }
    }
    value.forEach((v, i) => learn(v, [...path, i]));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) learn(v, [...path, k]);
  }
};
for (const record of [...PAGES, ...people, ...partners]) learn(record, []);
write('assets/shapes.json', JSON.stringify(shapes));

// Blocks like peopleGrid and logoWall render from the whole collection, which
// the CMS does not hand to a preview — it only has the entry being edited.
// Publishing a trimmed index lets the preview draw them for real.
write(
  'assets/collections.json',
  JSON.stringify({
    base: BASE,
    people: people.map((p) => ({
      slug: p.slug, name: p.name, designation: p.designation,
      institute: p.institute, country: p.country, interests: p.interests, photo: p.photo,
    })),
    partners: partners.map((p) => ({
      slug: p.slug, name: p.name, country: p.country, summary: p.summary, logo: p.logo,
    })),
    pages: PAGES.map((p) => ({ slug: p.slug, menuName: p.menuName })),
  })
);

// The CMS preview fetches these at runtime; without them it loads but every
// entry renders empty.
for (const needed of ['content/pages', 'assets/collections.json', 'assets/shapes.json']) {
  if (!existsSync(join(OUT, needed))) throw new Error(`${needed} was not published — the CMS preview depends on it`);
}

if (existsSync(join(ROOT, 'CNAME'))) cpSync(join(ROOT, 'CNAME'), join(OUT, 'CNAME'));
write('.nojekyll', '');

write(
  'sitemap.xml',
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join('\n') +
    '\n</urlset>\n'
);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}${BASE}/sitemap.xml\n`);

console.log(
  `Built ${count} documents into _site/ ` +
    `(${PAGES.length} pages + ${people.length} people + ${partners.length} partners × ${LANGS.length} language${LANGS.length > 1 ? 's' : ''})` +
    (BASE ? `\nBase path: ${BASE} — serving from ${SITE_URL}${BASE}/` : `\nServing from ${SITE_URL}/`)
);
