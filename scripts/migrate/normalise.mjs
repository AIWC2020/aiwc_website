/**
 * Turn the raw WordPress dump into the canonical AIWC dataset:
 * people, partners, programmes, news, blog, publications.
 *
 * People profiles are a two-column <table> of label/value plus prose and
 * <h3>-delimited lists — consistent enough across all ~100 posts to parse.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const RAW = new URL('./aiwc-raw/', import.meta.url).pathname;
const OUT = new URL('./aiwc-data/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const read = (f) => JSON.parse(readFileSync(RAW + f, 'utf8'));
const posts = read('posts.json');
const categories = read('categories.json');
const media = read('media.json');

const decode = (s = '') =>
  s
    .replace(/&#0?38;|&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

const catById = new Map(categories.map((c) => [c.id, { ...c, name: decode(c.name) }]));
const mediaById = new Map(media.map((m) => [m.id, m]));
const mediaByPost = new Map();
for (const m of media) if (m.post) (mediaByPost.get(m.post) || mediaByPost.set(m.post, []).get(m.post)).push(m);

/* ---------- shared helpers ---------- */

const INSTITUTE_CATS = new Set(
  categories
    .filter((c) => !['news-events', 'aiwc-blog-waterwise', 'training-and-capacity-building',
      'research', 'research-aiwc-activities', 'education', 'outreach', 'our-work',
      'uncategorized', 'australian-partner-institutes', 'india-partner-institutes'].includes(c.slug))
    .map((c) => c.id)
);

const AUSTRALIAN = new Set(['western-sydney-university', 'university-of-melbourne', 'university-of-new-south-wales',
  'university-of-western-australia', 'university-of-wollongong', 'deakin-university', 'flinders-university',
  'griffith-university', 'qut-queensland-university-of-technology', 'australia-india-insitute',
  'south-australia-department-of-environment-and-water', 'individual-member-australia']);

const slugOf = (p) => p.slug;
const catSlugs = (p) => (p.categories || []).map((id) => catById.get(id)?.slug).filter(Boolean);

/**
 * Text of a node with paragraph breaks preserved.
 *
 * Elementor nests real content arbitrarily deep inside layout containers, so
 * this descends rather than reading direct children only — one post
 * (WATER TALKS 2025) puts every paragraph four containers down and would
 * otherwise come back empty. Descent stops at p/li/h so a paragraph is never
 * counted twice, and identical consecutive strings (Elementor duplicates
 * headings into wrappers) are collapsed.
 */
function blocksOf(node) {
  const out = [];
  const walk = (parent) => {
    for (const child of parent.children) {
      const tag = child.tagName?.toLowerCase();
      if (tag === 'p') {
        const t = decode(child.textContent);
        if (t) out.push({ kind: 'p', text: t });
      } else if (tag === 'ol' || tag === 'ul') {
        const items = [...child.querySelectorAll('li')].map((li) => decode(li.textContent)).filter(Boolean);
        if (items.length) out.push({ kind: 'list', items });
      } else if (/^h[1-6]$/.test(tag || '')) {
        const t = decode(child.textContent);
        if (t) out.push({ kind: 'h', text: t });
      } else if (child.children.length) {
        walk(child);
      }
    }
  };
  walk(node);

  const deduped = [];
  for (const b of out) {
    const prev = deduped[deduped.length - 1];
    const same = prev && prev.kind === b.kind &&
      (b.kind === 'list' ? prev.items.join('|') === b.items.join('|') : prev.text === b.text);
    if (!same) deduped.push(b);
  }
  return deduped;
}

/* ---------- people ---------- */

const LABELS = [
  [/^name/i, 'name'],
  [/highest qualification/i, 'qualification'],
  [/^designation/i, 'designation'],
  [/^employer/i, 'employer'],
  [/contact details/i, 'contact'],
  [/home page link/i, 'homepage'],
  [/key areas of interest/i, 'interests'],
  [/research profile|google scholar|orcid|researchgate/i, 'profiles'],
];

function parsePerson(post) {
  const { document } = parseHTML(`<div id="r">${post.content?.rendered || ''}</div>`);
  const root = document.getElementById('r');

  const fields = {};
  const links = { email: null, phone: null, homepage: null, scholar: [] };

  const table = root.querySelector('table');
  if (table) {
    for (const row of table.querySelectorAll('tr')) {
      const cells = [...row.children];
      if (cells.length < 2) continue;
      const label = decode(cells[0].textContent);
      const valueCell = cells[cells.length - 1];
      const value = decode(valueCell.textContent);
      const key = LABELS.find(([re]) => re.test(label))?.[1];
      if (!key) continue;
      if (value && !fields[key]) fields[key] = value;
      for (const a of valueCell.querySelectorAll('a')) {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('mailto:')) links.email ||= href.replace('mailto:', '').trim();
        else if (key === 'homepage') links.homepage ||= href;
        else if (/scholar\.google|orcid|researchgate|scopus|publons|vidwan|linkedin/i.test(href)) links.scholar.push(href);
        else if (key === 'profiles') links.scholar.push(href);
      }
    }
    // Contact rows use rowspan, so the email/phone cells have no label of
    // their own and the row-pair walk above never sees them. Sweep the whole
    // table for anything that is unambiguously an address, a phone or a
    // research profile.
    for (const a of table.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('mailto:')) links.email ||= href.replace('mailto:', '').trim();
      else if (/scholar\.google|orcid|researchgate|scopus|publons|vidwan|linkedin|semanticscholar/i.test(href)) {
        links.scholar.push(href);
      }
    }
    if (!links.email) {
      const bare = decode(table.textContent).match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (bare) links.email = bare[0];
    }
    const phone = decode(table.textContent).match(/\+?\d[\d\s()\-]{8,}\d/);
    if (phone) links.phone = phone[0].trim();
    table.closest('figure')?.remove() ?? table.remove();
  }

  const body = blocksOf(root);
  const bio = [];
  const sections = [];
  let current = null;
  for (const b of body) {
    if (b.kind === 'h') {
      current = { title: b.text, items: [] };
      sections.push(current);
    } else if (b.kind === 'list') {
      if (current) current.items.push(...b.items);
      else bio.push(...b.items);
    } else if (b.kind === 'p') {
      if (current) current.items.push(b.text);
      else bio.push(b.text);
    }
  }

  const instCat = (post.categories || [])
    .map((id) => catById.get(id))
    .find((c) => c && INSTITUTE_CATS.has(c.id));

  const photo = post.featured_media ? mediaById.get(post.featured_media)?.source_url : null;

  return {
    slug: slugOf(post),
    name: fields.name || decode(post.title?.rendered),
    designation: fields.designation || '',
    employer: fields.employer || instCat?.name || '',
    qualification: fields.qualification || '',
    interests: fields.interests || '',
    institute: instCat?.name || '',
    instituteSlug: instCat?.slug || '',
    country: instCat && AUSTRALIAN.has(instCat.slug) ? 'Australia' : 'India',
    email: links.email,
    phone: links.phone,
    // aiwc.org.au has at least one profile field saved as "about:blank";
    // anything that is not a real URL is dropped rather than published.
    homepage: /^https?:\/\//.test(links.homepage || '') ? links.homepage : null,
    profiles: [...new Set(links.scholar)].filter((u) => /^https?:\/\//.test(u)),
    photo,
    bio,
    sections: sections.filter((s) => s.items.length),
    url: post.link,
  };
}

/* ---------- article-shaped posts (partners, programmes, news, blog) ---------- */

function parseArticle(post) {
  const { document } = parseHTML(`<div id="r">${post.content?.rendered || ''}</div>`);
  const root = document.getElementById('r');
  root.querySelectorAll('script,style,noscript').forEach((n) => n.remove());

  const images = [...new Set([...root.querySelectorAll('img')].map((i) => i.getAttribute('src')).filter(Boolean))];
  const linkList = [...root.querySelectorAll('a')]
    .map((a) => ({ label: decode(a.textContent), href: a.getAttribute('href') || '' }))
    .filter((l) => l.href && !l.href.startsWith('#') && l.label);

  const featured = post.featured_media ? mediaById.get(post.featured_media)?.source_url : null;

  return {
    slug: slugOf(post),
    title: decode(post.title?.rendered),
    date: (post.date || '').slice(0, 10),
    cats: catSlugs(post),
    blocks: blocksOf(root),
    images,
    links: linkList,
    featured,
    url: post.link,
  };
}

/* ---------- partition ---------- */

const isPartner = (p) => catSlugs(p).some((s) => s === 'australian-partner-institutes' || s === 'india-partner-institutes')
  && !catSlugs(p).some((s) => INSTITUTE_CATS.has(catById.get((p.categories || []).find((id) => catById.get(id)?.slug === s))?.id) && false);

const people = [];
const partners = [];
const articles = [];

for (const post of posts) {
  const slugs = catSlugs(post);
  const partnerish = slugs.includes('australian-partner-institutes') || slugs.includes('india-partner-institutes');
  const hasInstitute = (post.categories || []).some((id) => INSTITUTE_CATS.has(id));

  if (partnerish && !hasInstitute) partners.push(parseArticle(post));
  else if (hasInstitute) people.push(parsePerson(post));
  else articles.push(parseArticle(post));
}

people.sort((a, b) => a.name.replace(/^(Dr|Prof|Professor|A\/Prof|Mr|Ms|Mrs)\.?\s+/i, '')
  .localeCompare(b.name.replace(/^(Dr|Prof|Professor|A\/Prof|Mr|Ms|Mrs)\.?\s+/i, '')));

writeFileSync(OUT + 'people.json', JSON.stringify(people, null, 2));
writeFileSync(OUT + 'partners.json', JSON.stringify(partners, null, 2));
writeFileSync(OUT + 'articles.json', JSON.stringify(articles, null, 2));

console.log('people   ', people.length, '| AU', people.filter((p) => p.country === 'Australia').length, 'IN', people.filter((p) => p.country === 'India').length);
console.log('partners ', partners.length);
console.log('articles ', articles.length, '=>', [...new Set(articles.flatMap((a) => a.cats))].join(', '));
console.log('people missing bio:', people.filter((p) => !p.bio.length).map((p) => p.slug).join(', ') || 'none');
console.log('people missing photo:', people.filter((p) => !p.photo).length);
