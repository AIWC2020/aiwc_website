/**
 * Static site build: content/ → _site/, one real document per URL.
 *
 * index.html is the chrome template only — head, CSS, header, footer. The
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
import { renderPage, renderPerson, renderPartner, brandMarkSvg, BRAND_SHAPES } from '../src/templates.mjs';
import { buildRegistry, buildNav, loadCollections, loadNavConfig, loadSite, navParentOf, urlFor, urlForEntry } from '../src/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');

const SITE = loadSite(ROOT);
// The brand mark's container shape, editable in the CMS (Logo & site settings → Logo).
const BRAND_FILE = join(ROOT, 'content/brand.json');
const BRAND_RAW = existsSync(BRAND_FILE) ? JSON.parse(readFileSync(BRAND_FILE, 'utf8')) : {};
const BRAND_SHAPE = BRAND_SHAPES.includes(BRAND_RAW.shape) ? BRAND_RAW.shape : 'drop';
// An uploaded logo replaces the drawn mark everywhere it appears. Stored with
// the public_folder path the CMS writes, so it is rebased like any image.
const BRAND_LOGO = typeof BRAND_RAW.logo === 'string' && BRAND_RAW.logo.trim() ? BRAND_RAW.logo.trim() : null;
const BASE = SITE.base;
const SITE_URL = SITE.url.replace(/\/$/, '');
const LANGS = SITE.languages;

const template = readFileSync(join(ROOT, 'index.html'), 'utf8');
const PAGES = buildRegistry(ROOT);
const { people, partners } = loadCollections(ROOT);
/* ── counts that appear in prose ─────────────────────────────────────────
 *
 * "One hundred and eight water researchers" was typed by hand, so the 109th
 * researcher would quietly make the headline a lie while the counter beside
 * it — which is computed — disagreed with it on the same screen.
 *
 * Only these tokens are substituted, never bare digits. "Launched with 24
 * partners" is a fact about 2020 and must not follow the partner list around,
 * and a researcher's own publication count is theirs, not ours. A number is
 * only derived if somebody marked it derived.
 *
 * The two senses of "institution" are deliberately not one token: 33 partner
 * institutions and the 27 institutions our researchers actually belong to are
 * different figures, and naming them apart is what stops them being confused.
 */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Spelled-out form for headline prose. Falls back to digits past 999. */
const inWords = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  const rest = n % 100;
  return ONES[Math.floor(n / 100)] + ' hundred' + (rest ? ' and ' + inWords(rest) : '');
};

const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const COUNTS = {
  researchers: people.length,
  partnerInstitutions: partners.length,
  researcherInstitutions: new Set(people.map((p) => p.institute).filter(Boolean)).size,
  researchersInAustralia: people.filter((p) => p.country === 'Australia').length,
  researchersInIndia: people.filter((p) => p.country === 'India').length,
};

/* Each count offers three forms: digits, words, and words for the start of a
 * sentence — so an author never has to reach for the raw number. */
const TOKENS = {};
for (const [name, value] of Object.entries(COUNTS)) {
  TOKENS[name] = String(value);
  TOKENS[name + 'InWords'] = inWords(value);
  TOKENS[upperFirst(name) + 'InWords'] = upperFirst(inWords(value));
}

const unknownTokens = new Set();
const fillCounts = (value) => {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (whole, name) => {
      if (name in TOKENS) return TOKENS[name];
      unknownTokens.add(name);
      return whole;
    });
  }
  if (Array.isArray(value)) return value.map(fillCounts);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillCounts(v)]));
  }
  return value;
};

for (let i = 0; i < PAGES.length; i++) PAGES[i] = fillCounts(PAGES[i]);
SITE.description = fillCounts(SITE.description);

// A misspelled token renders literally on the page, so name it rather than
// letting {{researcher}} reach a reader. Not fatal: one wrong word is not a
// reason to stop publishing the site.
if (unknownTokens.size) {
  console.warn(
    `Unknown count token${unknownTokens.size > 1 ? 's' : ''} left as written: ` +
      `${[...unknownTokens].map((t) => `{{${t}}}`).join(', ')}. ` +
      `Available: ${Object.keys(TOKENS).map((t) => `{{${t}}}`).join(', ')}`
  );
}

// Built after substitution, or the lookup would hand back the unfilled copies.
const pageById = new Map(PAGES.map((p) => [p.slug, p]));
// The header menu, as editors set it in the CMS (content/navigation.json).
const NAV = buildNav(PAGES, loadNavConfig(ROOT, SITE));


const href = (lang, page) => urlFor(lang, page, PAGES, BASE);
const entryHref = (lang, kind, slug) => urlForEntry(lang, kind, slug, BASE);

/**
 * MARVI's renderers expect { index, total, urlFor } and build their own
 * per-block `t`. AIWC's two collection blocks additionally need the people
 * and partner records and a way to link to their pages, so the context is
 * MARVI's plus those three.
 */
/** The breadcrumb for a page nested under a header entry. */
const parentLink = (lang, page) => {
  const parent = navParentOf(NAV, page.slug);
  return parent ? { label: parent.menuName, href: href(lang, parent) } : null;
};

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
 * Build the shell once: header navigation, language switch, footer links.
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

  /* header navigation, from the CMS Header menu (content/navigation.json) */
  const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const itemLink = (item, className) => {
    const a = document.createElement('a');
    if (className) a.className = className;
    if (item.url) {
      a.setAttribute('href', item.url);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      a.setAttribute('data-external', '');
    } else {
      a.setAttribute('href', href(lang, item.page) + (item.section ? '#' + item.section : ''));
      a.setAttribute('data-tab', item.page.slug);
      if (item.page.slug === activeSlug && !item.section) a.setAttribute('aria-current', 'page');
    }
    a.textContent = item.label;
    return a;
  };
  // The highlighted tab sits in the brand row on wide screens and at the foot
  // of the menu on phones, so it is drawn into both lists; the main bar
  // carries every other tab.
  const lists = [
    ...[...document.querySelectorAll('[data-site-actions]')].map((list) => ({ list, filter: (tab) => tab.button, suffix: '' })),
    ...[...document.querySelectorAll('[data-site-nav]')].map((list) => ({ list, filter: () => true, suffix: '-m' })),
  ];
  for (const { list, filter, suffix } of lists) {
    list.textContent = '';
    NAV.filter(filter).forEach((tab) => {
      const li = document.createElement('li');
      const current = tab.page.slug === activeSlug || tab.items.some((i) => i.page?.slug === activeSlug);
      li.className = 'nav-item' + (tab.button ? ' nav-item--cta' : '') + (tab.items.length ? ' has-menu' : '') + (current ? ' is-current' : '');
      li.appendChild(itemLink({ label: tab.label, page: tab.page }, tab.button ? 'nav-cta' : 'nav-link'));
      if (tab.items.length) {
        const menuId = 'menu-' + tab.page.slug + (tab.button ? suffix : '');
        const more = document.createElement('button');
        more.className = 'nav-more';
        more.setAttribute('type', 'button');
        more.setAttribute('aria-expanded', 'false');
        more.setAttribute('aria-controls', menuId);
        more.setAttribute('aria-label', 'More in ' + tab.label);
        more.innerHTML = CHEVRON;
        li.appendChild(more);
        const menu = document.createElement('ul');
        menu.className = 'nav-menu';
        menu.id = menuId;
        tab.items.forEach((item) => {
          const entry = document.createElement('li');
          entry.appendChild(itemLink(item));
          menu.appendChild(entry);
        });
        li.appendChild(menu);
      }
      list.appendChild(li);
    });
  }

  /* brand marks link home */
  document.querySelectorAll('[data-open="home"]').forEach((n) => {
    n.setAttribute('href', href(lang, PAGES[0]));
  });

  /* the brand mark — the uploaded logo, or the drawn confluence glyph in
     the shape content/brand.json picked when there is none. */
  const markHtml = () => (BRAND_LOGO
    ? `<img src="${logoSrc()}" alt="">`
    : brandMarkSvg(BRAND_SHAPE, 'chrome'));
  document.querySelectorAll('.brand-mark').forEach((n) => {
    n.innerHTML = markHtml();
  });

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
    for (const { page, label } of NAV) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.setAttribute('href', href(lang, page));
      a.textContent = label;
      li.appendChild(a);
      footerNav.appendChild(li);
    }
  }

  document.getElementById('content').appendChild(panel);
  // app.mjs needs the base path to fetch the search index.
  document.body.setAttribute('data-base', BASE);

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
  // A preview copy of the site (content/site.json "noindex": true) must not
  // compete with aiwc.org.au in search results.
  if (SITE.noindex) meta('name', 'robots', 'noindex, nofollow');
  link('canonical', canonical);
  const icon = document.createElement('link');
  icon.setAttribute('rel', 'icon');
  if (existsSync(join(ROOT, 'assets/brand/aiwc-river.png'))) {
    icon.setAttribute('href', `${BASE}/assets/brand/aiwc-river.png`);
  } else if (BRAND_LOGO) {
    icon.setAttribute('href', logoSrc());
  } else {
    icon.setAttribute('type', 'image/svg+xml');
    icon.setAttribute('href', `${BASE}/assets/brand-mark.svg`);
  }
  head.appendChild(icon);
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

// Site-relative path of the uploaded logo, whether the CMS wrote it with or
// without the base path.
const logoSrc = () => (BRAND_LOGO.startsWith('http') || BRAND_LOGO.startsWith(`${BASE}/`) ? BRAND_LOGO : BASE + BRAND_LOGO);
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
      ctxFor(lang, { index: i + 1, total: PAGES.length, parent: parentLink(lang, page) })
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
// The favicon is the same confluence mark, carrying its own light/dark
// styling because the browser tab has no site background behind it.
write('assets/brand-mark.svg', brandMarkSvg(BRAND_SHAPE, 'favicon'));
cpSync(join(ROOT, 'src/templates.mjs'), join(OUT, 'assets/templates.mjs'));

// The CMS preview iframe needs the site's CSS as a standalone file.
const styles = [...parseHTML(template).document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
// url("/assets/…") in the stylesheet needs the base path here too, or the
// CMS preview draws the page without its river lines on a project page.
write('assets/site.css', BASE ? styles.replace(/url\(\s*(['"]?)(\/(?!\/)[^'")]+)\1\s*\)/g, (whole, q, path) =>
  path.startsWith(BASE + '/') ? whole : `url(${q}${BASE}${path}${q})`) : styles);

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
/* ── the search index ──────────────────────────────────────────────────
   One small JSON file the header search reads on first use: every page and
   its section headings, every researcher, partner and publication. */
const sectionId = (title) =>
  's-' + String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const searchEntries = [];
const plain = (v) => String(v || '').replace(/\s+/g, ' ').trim();
for (const page of PAGES) {
  const url = href('en', page);
  searchEntries.push({ k: 'Page', t: plain(page.intro?.title) || page.menuName, u: url, x: plain(page.intro?.lede).slice(0, 180) });
  (page.blocks || []).forEach((b) => {
    if (b.type === 'banner' && plain(b.title) && plain(b.title) !== '.') {
      searchEntries.push({ k: page.menuName, t: plain(b.title), u: url + '#' + sectionId(b.title), x: plain(b.lede || b.eyebrow).slice(0, 160) });
    }
    if (b.type === 'publicationList') {
      (b.items || []).forEach((item) => searchEntries.push({ k: 'Publication', t: plain(item.title).slice(0, 200), u: url, x: plain(item.meta) }));
    }
  });
}
for (const p of people) {
  searchEntries.push({ k: 'Researcher', t: p.name, u: entryHref('en', 'people', p.slug), x: [p.designation, p.institute].filter(Boolean).join(', '), s: plain(p.interests).slice(0, 240) });
}
for (const p of partners) {
  searchEntries.push({ k: 'Partner institution', t: p.name, u: entryHref('en', 'partners', p.slug), x: p.country || '' });
}
write('assets/search.json', JSON.stringify(searchEntries));

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
write(
  'robots.txt',
  SITE.noindex
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}${BASE}/sitemap.xml\n`
);

console.log(
  `Built ${count} documents into _site/ ` +
    `(${PAGES.length} pages + ${people.length} people + ${partners.length} partners × ${LANGS.length} language${LANGS.length > 1 ? 's' : ''})` +
    (BASE ? `\nBase path: ${BASE} — serving from ${SITE_URL}${BASE}/` : `\nServing from ${SITE_URL}/`)
);
