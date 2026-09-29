/**
 * The checks a page must pass before it is saved from outside the CMS form —
 * the same things that would stop the build (scripts/verify.mjs) and so stop
 * the whole site deploying. Shared by page-text.js and the version picker in
 * preview.js, because an old version can go stale: a page it links to may
 * have been deleted since.
 */

/** Line and column for a JSON.parse failure, from the character position. */
const whereInText = (text, err) => {
  const pos = Number(String(err.message).match(/position (\d+)/)?.[1]);
  if (!Number.isFinite(pos)) return '';
  const before = text.slice(0, pos).split('\n');
  return ` (line ${before.length}, column ${before.at(-1).length + 1})`;
};

export const explainRenderFailure = (err) => {
  const field = String(err?.message || err).match(/reading '([^']+)'/)?.[1];
  if (field === 'image') return 'A picture field is empty (null). Give it an image, or remove that picture field.';
  if (field) return `The field “${field}”, or the section that holds it, is empty but the page needs a value there.`;
  return 'The page could not be drawn. Check the section you changed last.';
};

/**
 * Returns { data, errors, warnings }. Errors block saving; warnings do not.
 * `known` is the set of page addresses that will exist once this is saved;
 * `renderPage` is the site's renderer (assets/templates.mjs).
 */
export const checkText = (text, known, renderPage) => {
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
