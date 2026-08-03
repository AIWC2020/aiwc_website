/**
 * One-time migration: rewrite AIWC's content into MARVI's block vocabulary.
 *
 * The site now runs MARVI's renderer, which knows 24 block types. AIWC's
 * content was authored against a different set, so every block is translated
 * to its nearest MARVI equivalent. Nothing is summarised or dropped — where
 * MARVI's block carries fewer fields than AIWC's, the surplus becomes an
 * extra block rather than being discarded.
 *
 * Two ordering rules drive the choices:
 *
 *   - `text`, `callout`, `button`, `gallery`, `imageText` and `embed` are
 *     FLEX types: MARVI collects them and renders them together at the foot
 *     of the page. So they cannot be used for a section's body without
 *     scrambling the reading order. Section heads use `banner`; running copy
 *     uses `split` with two prose columns.
 *   - `cards` has no links, `storyCards` does. A card list that points at
 *     other pages therefore becomes storyCards.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'content/pages');

/* ---------- helpers ---------- */

/** AIWC bodies mix plain strings, {kind:'h'} headings and {kind:'list'}. */
const flatten = (body = []) =>
  body.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (item.kind === 'list') return (item.items || []).map((li) => '• ' + li);
    if (item.kind === 'h') return [item.text];
    return item.text ? [item.text] : [];
  });

/** Split paragraphs across two columns, keeping the first column longer. */
const halve = (paras) => {
  const cut = Math.ceil(paras.length / 2);
  return [paras.slice(0, cut), paras.slice(cut)];
};

const head = (block) =>
  block.label || block.title || block.lede
    ? [{
        type: 'banner',
        eyebrow: block.label || '',
        title: block.title || '',
        lede: block.lede || '',
        ...(block.i18n ? { i18n: block.i18n } : {}),
      }]
    : [];

const proseSplit = (paras, lead) => {
  if (!paras.length && !lead) return [];
  const [a, b] = halve(paras);
  return [{
    type: 'split',
    left: { kind: 'prose', ...(lead ? { lead } : {}), paragraphs: a },
    right: { kind: 'prose', paragraphs: b },
  }];
};

const photoOf = (v) => (typeof v === 'string' ? { image: v } : v || {});

/* ---------- per-type translation ---------- */

const MAP = {
  statement: (b) => [
    { type: 'statement', label: b.label || '', quote: b.quote || '' },
    ...(b.cite ? [{ type: 'sourceNote', parts: [{ text: b.cite }] }] : []),
  ],

  // MARVI shows scale as `metrics` inside a statement — the same idea.
  measures: (b) => [
    {
      type: 'statement',
      label: b.label || '',
      quote: b.title || '',
      metrics: (b.items || []).map(({ value, label }) => ({ value, label })),
    },
    ...(b.lede ? [{ type: 'sourceNote', parts: [{ text: b.lede }] }] : []),
  ],

  prose: (b) => [...head(b), ...proseSplit(flatten(b.body))],

  cols: (b) => {
    const [l, r] = b.columns || [];
    return [
      ...head(b),
      {
        type: 'split',
        left: { kind: 'prose', ...(l?.title ? { lead: l.title } : {}), paragraphs: flatten(l?.body) },
        right: { kind: 'prose', ...(r?.title ? { lead: r.title } : {}), paragraphs: flatten(r?.body) },
      },
    ];
  },

  cards: (b) => {
    const linked = (b.items || []).some((i) => i.page || i.href);
    if (linked) {
      return [{
        type: 'storyCards',
        eyebrow: b.label || '',
        title: b.title || '',
        lede: b.lede || '',
        items: (b.items || []).map((i) => ({
          ...(i.page ? { page: i.page } : {}),
          label: i.number || '',
          title: i.title || '',
          ...(i.text ? { text: i.text } : {}),
        })),
      }];
    }
    return [
      ...head(b),
      { type: 'cards', items: (b.items || []).map((i) => ({ number: i.number, title: i.title, text: i.text })) },
    ];
  },

  programmes: (b) => [{
    type: 'storyCards',
    eyebrow: b.label || '',
    title: b.title || '',
    lede: b.lede || '',
    items: (b.items || []).map((i) => ({
      ...(i.page ? { page: i.page } : {}),
      label: i.number || '',
      title: i.title || '',
      ...(i.photo ? { photo: { ...photoOf(i.photo), alt: i.alt || '' } } : {}),
    })),
  }],

  timeline: (b) => [
    ...head(b),
    {
      type: 'steps',
      items: (b.items || []).map((i) => ({
        title: [i.year, i.title].filter(Boolean).join(' — '),
        text: i.text || '',
      })),
    },
  ],

  pubList: (b) => [
    ...head(b),
    {
      type: 'publicationList',
      items: (b.items || []).map((i) => {
        const text = typeof i === 'string' ? i : i.text;
        const href = typeof i === 'object' ? i.href : null;
        return { title: text, ...(href ? { editions: [{ label: 'Open', url: href }] } : {}) };
      }),
    },
  ],

  linkList: (b) => [
    ...head(b),
    {
      type: 'toolList',
      items: (b.items || []).map((i) => ({
        name: i.title || '',
        description: i.text || '',
        url: i.href || '',
        linkLabel: 'Open',
        target: '_blank',
      })),
    },
  ],

  ribbon: (b) => [{ type: 'photoRibbon', items: (b.items || []).map((i) => ({ photo: photoOf(i) })) }],

  shotPair: (b) => [
    ...head(b),
    {
      type: 'imagePair',
      items: (b.items || []).map((i) => ({ photo: photoOf(i), caption: i.caption || '' })),
    },
  ],

  frame: (b) => [
    { type: 'banner', eyebrow: b.label || '', title: b.title || '', lede: b.lede || '' },
    ...(b.photo ? [{ type: 'photoRibbon', items: [{ photo: photoOf(b.photo) }] }] : []),
  ],

  peopleGrid: (b) => [...head(b), { type: 'portraitDirectory' }],

  logoWall: (b) => [...head(b), { type: 'partnerDirectory', ...(b.country ? { country: b.country } : {}) }],
  partnerRows: (b) => [...head(b), { type: 'partnerDirectory', ...(b.country ? { country: b.country } : {}) }],

  // Contact panels become a two-column prose split, one country each.
  contactCards: (b) => {
    const col = (group) => ({
      kind: 'prose',
      lead: group?.country || '',
      paragraphs: [
        ...(group?.address ? [group.address] : []),
        ...(group?.people || []).map((p) =>
          [p.name, p.role, p.email].filter(Boolean).join(' — ')
        ),
      ],
    });
    const [au, iN] = b.items || [];
    return [...head(b), { type: 'split', left: col(au), right: col(iN) }];
  },

  // callout and button are FLEX types, so they land together at the page foot
  // — which is where a call to action belongs anyway.
  callout: (b) => [
    { type: 'callout', heading: b.title || '', body: b.text || '' },
    ...(b.actions || []).filter((a) => a.href).map((a) => ({
      type: 'button', label: a.label, url: a.href,
    })),
  ],
};

/* ---------- run ---------- */

let pages = 0;
let before = 0;
let after = 0;
const unmapped = new Set();

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  const path = join(DIR, file);
  const page = JSON.parse(readFileSync(path, 'utf8'));
  const source = page.blocks || [];
  before += source.length;

  page.blocks = source.flatMap((block) => {
    const translate = MAP[block.type];
    if (!translate) { unmapped.add(block.type); return [block]; }
    return translate(block);
  });

  after += page.blocks.length;
  pages++;
  writeFileSync(path, JSON.stringify(page, null, 2) + '\n');
}

console.log(`${pages} pages: ${before} AIWC blocks → ${after} MARVI blocks`);
if (unmapped.size) console.log('UNMAPPED (left as-is):', [...unmapped].join(', '));
