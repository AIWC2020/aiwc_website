/**
 * One-time migration: move content/people/ and content/partners/ inside the
 * pages that display them, so a page file holds everything on that page and
 * the CMS needs a single collection.
 *
 * The detail pages at /people/<slug>/ and /partners/<slug>/ keep working —
 * the build reads the records back out of the pages (see loadCollections in
 * src/registry.mjs) rather than from their own directories.
 */
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const fold = (dir, pageFile, blockType, sort) => {
  const from = join(ROOT, 'content', dir);
  if (!existsSync(from)) return 0;

  const items = readdirSync(from)
    .filter((f) => f.endsWith('.json'))
    .map((f) => read(join(from, f)))
    .sort(sort);

  const pagePath = join(ROOT, 'content/pages', pageFile);
  const page = read(pagePath);
  const block = (page.blocks || []).find((b) => b.type === blockType);
  if (!block) throw new Error(`${pageFile} has no ${blockType} block to fold into`);
  block.items = items;

  writeFileSync(pagePath, JSON.stringify(page, null, 2) + '\n');
  rmSync(from, { recursive: true });
  return items.length;
};

const people = fold('people', 'people.json', 'portraitDirectory',
  (a, b) => (a.sortName || a.name).localeCompare(b.sortName || b.name));
const partners = fold('partners', 'partners.json', 'partnerDirectory',
  (a, b) => (a.country || '').localeCompare(b.country || '') || a.name.localeCompare(b.name));

console.log(`folded ${people} researchers into content/pages/people.json`);
console.log(`folded ${partners} partners into content/pages/partners.json`);
