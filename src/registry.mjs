/**
 * What the site contains, and where every piece of it lives.
 *
 * Three collections, one shape each:
 *   content/pages/*.json     — the navigable pages, ordered by `order`
 *   content/people/*.json    — 108 researcher profiles  → /people/<slug>/
 *   content/partners/*.json  — partner institutions     → /partners/<slug>/
 *
 * Pages carry an optional `parent` (a page slug) which nests them under that
 * page in the rail; everything else is top level. Detail pages are not in the
 * rail at all — they are reached from their directory page.
 *
 * Shared by the build, the verifier and the CMS preview so none of them can
 * disagree about what exists.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const readJSONDir = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const id = f.replace(/\.json$/, '');
      try {
        return { id, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) };
      } catch (err) {
        throw new Error(`content/${dir.split('/').pop()}/${f} is not valid JSON: ${err.message}`);
      }
    });
};

export function loadSite(root) {
  const site = JSON.parse(readFileSync(join(root, 'content/site.json'), 'utf8'));
  // A CNAME means the site owns a domain root; without one it is a GitHub
  // project page and every URL has to carry the repo name.
  const cname = join(root, 'CNAME');
  const base = existsSync(cname) ? '' : (site.base || '').replace(/\/$/, '');
  return { ...site, base, languages: site.languages?.length ? site.languages : ['en'] };
}

export function buildRegistry(root) {
  const pages = readJSONDir(join(root, 'content/pages'))
    .map((data) => ({
      slug: data.slug || data.id,
      menuName: data.menuName || data.id,
      order: Number.isFinite(data.order) ? data.order : 500,
      published: data.published !== false,
      template: data.template || 'standard',
      parent: data.parent || null,
      ...data,
    }))
    .filter((p) => p.published);

  pages.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  return pages;
}

/**
 * Researchers and partners live inside the pages that display them, so a page
 * file is everything on that page and the CMS needs one collection. They are
 * read back out here so the build can still give each of them its own URL.
 *
 * Keyed off the block type rather than the page slug, so renaming or moving
 * the page does not break the detail pages.
 */
export function loadCollections(root) {
  const pages = buildRegistry(root);
  const itemsOf = (blockType) =>
    pages
      .flatMap((page) => page.blocks || [])
      .filter((block) => block.type === blockType)
      .flatMap((block) => block.items || [])
      .filter((entry) => entry && entry.slug);

  return {
    people: itemsOf('portraitDirectory'),
    partners: itemsOf('partnerDirectory'),
  };
}

/**
 * Rail order: top-level pages, each immediately followed by its children.
 * Children keep their own `order` among siblings.
 */
export function navTree(pages) {
  const tops = pages.filter((p) => !p.parent);
  const out = [];
  for (const top of tops) {
    out.push({ page: top, depth: 0 });
    for (const kid of pages.filter((p) => p.parent === top.slug)) out.push({ page: kid, depth: 1 });
  }
  return out;
}

/**
 * The header menu, as editors set it in the CMS (Logo & site settings →
 * Header menu, stored in content/navigation.json):
 *
 *   { tabs: [{ label, page, button?, items?: [{ label, page?, section?, url? }] }] }
 *
 * A tab opens its own page and, when it has items, a dropdown. An item opens
 * a page, a section of a page (`section` is the heading's anchor, e.g.
 * "s-how-the-centre-is-run"), or an outside address (`url`). The home page
 * is never a tab; the logo is its link.
 *
 * Returns tabs with `page` resolved to page records and every item carrying
 * either `page` (a record) or `url`. Items naming a page that does not exist
 * are dropped rather than rendered as dead links.
 */
export function loadNavConfig(root, site = {}) {
  const file = join(root, 'content/navigation.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  return { tabs: site.nav || [] };
}

export function buildNav(pages, navConfig = {}) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const placed = new Set(pages[0] ? [pages[0].slug] : []);
  const nav = [];
  for (const tab of navConfig.tabs || []) {
    const page = bySlug.get(tab.page);
    if (!page) continue;
    placed.add(page.slug);
    const items = [];
    for (const item of tab.items || []) {
      const url = typeof item.url === 'string' && /^https?:\/\//.test(item.url.trim()) ? item.url.trim() : null;
      const target = item.page ? bySlug.get(item.page) : null;
      if (!url && !target) continue;
      if (target) placed.add(target.slug);
      items.push({
        label: item.label || target?.menuName || url,
        page: url ? null : target,
        section: !url && item.section ? String(item.section).replace(/^#/, '') : null,
        url,
      });
    }
    nav.push({ label: tab.label || page.menuName, page, button: tab.button === true, items });
  }
  const unlisted = pages.filter((p) => !placed.has(p.slug));
  return unlisted.length ? placeUnlistedPages(nav, unlisted) : nav;
}

/**
 * Where a page goes when the Header menu does not mention it — typically a
 * page an editor has just created in the CMS.
 *
 * Before the header existed, every page appeared in the side rail on its
 * own, and the CMS has to keep working that way: a new page must never be
 * unreachable, and never stop the site publishing (`npm run verify` fails
 * the build when a published page is missing from the header).
 *
 * So: a page whose `parent` names a tab's page joins that tab's dropdown;
 * anything else joins the dropdown of the first tab, where an editor can see
 * it and move it in the Header menu.
 *
 * nav      — the tabs built from the Header menu, in order
 * unlisted — published pages not yet placed, in `order` order
 * returns  — the final nav array
 */
export function placeUnlistedPages(nav, unlisted) {
  const fallback = nav.find((tab) => !tab.button) || nav[0];
  for (const page of unlisted) {
    const home = nav.find((tab) => tab.page.slug === page.parent) || fallback;
    if (!home) continue;
    home.items.push({ label: page.menuName, page, section: null, url: null });
  }
  return nav;
}

/** The tab a page sits under (for its breadcrumb), or null for tab pages and home. */
export const navParentOf = (nav, slug) =>
  nav.find((tab) => tab.page.slug !== slug && tab.items.some((item) => item.page?.slug === slug))?.page || null;

/** URL path for a page in a language. The first page owns the root. */
export const urlFor = (lang, page, pages, base = '') => {
  const home = pages ? pages[0] : null;
  const slug = home && page.slug === home.slug ? '' : page.slug + '/';
  return base + (lang === 'en' ? '/' + slug : '/' + lang + '/' + slug);
};

/** URL path for a collection entry (person, partner). */
export const urlForEntry = (lang, kind, slug, base = '') =>
  base + (lang === 'en' ? `/${kind}/${slug}/` : `/${lang}/${kind}/${slug}/`);
