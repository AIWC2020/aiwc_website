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

export function loadCollections(root) {
  const people = readJSONDir(join(root, 'content/people'))
    .map((p) => ({ ...p, slug: p.slug || p.id }))
    .sort((a, b) => (a.sortName || a.name).localeCompare(b.sortName || b.name));

  const partners = readJSONDir(join(root, 'content/partners'))
    .map((p) => ({ ...p, slug: p.slug || p.id }))
    .sort((a, b) => (a.country || '').localeCompare(b.country || '') || a.name.localeCompare(b.name));

  return { people, partners };
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

/** URL path for a page in a language. The first page owns the root. */
export const urlFor = (lang, page, pages, base = '') => {
  const home = pages ? pages[0] : null;
  const slug = home && page.slug === home.slug ? '' : page.slug + '/';
  return base + (lang === 'en' ? '/' + slug : '/' + lang + '/' + slug);
};

/** URL path for a collection entry (person, partner). */
export const urlForEntry = (lang, kind, slug, base = '') =>
  base + (lang === 'en' ? `/${kind}/${slug}/` : `/${lang}/${kind}/${slug}/`);
