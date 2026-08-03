/**
 * Exercises the researcher directory against the *built* page: loads
 * _site/people/index.html into a DOM, runs src/app.mjs against it, then
 * drives the real controls and asserts what stays visible.
 *
 * Catches the failures a screenshot cannot: a filter that matches nothing,
 * a search haystack that was never populated, a counter that lies.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, '_site/people/index.html');

if (!existsSync(PAGE)) {
  console.error('_site/people/index.html missing — run `npm run build` first.');
  process.exit(1);
}

const { window, document } = parseHTML(readFileSync(PAGE, 'utf8'));

// app.mjs is written against a browser; give it the globals it touches.
window.matchMedia = () => ({ matches: false, addEventListener() {} });
window.IntersectionObserver = class {
  observe(node) { node.classList.add('in'); }
  unobserve() {}
};
// MARVI's app.mjs reads computed font sizes to apply the per-block text
// scale. linkedom has no layout engine, so a stub is enough: the directory
// behaviour under test does not depend on the number.
const getComputedStyle = () => ({ fontSize: '16px' });
window.getComputedStyle = getComputedStyle;

Object.assign(globalThis, {
  window,
  document,
  getComputedStyle,
  requestAnimationFrame: (fn) => fn(),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  location: { hash: '', pathname: '/people/', href: '' },
  history: { replaceState() {} },
  matchMedia: window.matchMedia,
  IntersectionObserver: window.IntersectionObserver,
  CSS: { escape: (s) => s },
});
// linkedom elements have no scrollIntoView.
window.Element.prototype.scrollIntoView = function () {};

await import('../src/app.mjs');

/* ── drive it ───────────────────────────────────────────────────────── */

const grid = document.querySelector('[data-people-grid]');
const cards = [...grid.children];
const counter = document.querySelector('[data-people-count]');
const empty = document.querySelector('[data-people-empty]');
const search = document.querySelector('[data-people-search]');
const instSelect = document.querySelector('[data-people-inst]');
const chip = (v) => document.querySelector(`[data-filter="${v}"]`);

const visible = () => cards.filter((c) => !c.hasAttribute('hidden')).length;
const fire = (node, type) => node.dispatchEvent(new window.Event(type));

// linkedom exposes select.value as a getter only, so selecting is done the
// way a browser does it internally — by marking the option selected.
const selectInstitution = (value) => {
  for (const option of instSelect.options) {
    if (option.value === value) option.setAttribute('selected', '');
    else option.removeAttribute('selected');
  }
  fire(instSelect, 'change');
};

const failures = [];
const check = (label, actual, expected) => {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected;
  if (!ok) failures.push(`${label}: got ${JSON.stringify(actual)}`);
  console.log(`  ${ok ? '✓' : '✗'} ${label} → ${actual}`);
};

const TOTAL = cards.length;
const AU = cards.filter((c) => c.getAttribute('data-country') === 'Australia').length;
const IN = cards.filter((c) => c.getAttribute('data-country') === 'India').length;

console.log(`Directory: ${TOTAL} researchers (${AU} Australia, ${IN} India)\n`);

check('every card carries a search haystack', cards.filter((c) => c.getAttribute('data-search')).length, TOTAL);
check('every card carries a country', cards.filter((c) => c.getAttribute('data-country')).length, TOTAL);
check('every card links to a profile', cards.filter((c) => /\/people\/[^/]+\/$/.test(c.getAttribute('href') || '')).length, TOTAL);

check('initial state shows all', visible(), TOTAL);

chip('country:Australia').click();
check('filter Australia', visible(), AU);

chip('country:India').click();
check('filter India', visible(), IN);

chip('all').click();
check('back to all', visible(), TOTAL);

search.value = 'groundwater';
fire(search, 'input');
const gw = visible();
check('search "groundwater" narrows but matches', gw, (n) => n > 0 && n < TOTAL);

chip('country:Australia').click();
check('search + country compose', visible(), (n) => n > 0 && n <= gw);

search.value = '';
fire(search, 'input');
chip('all').click();

const firstInst = [...instSelect.options].find((o) => o.value)?.value;
const instCount = cards.filter((c) => c.getAttribute('data-inst') === firstInst).length;
selectInstitution(firstInst);
check(`institution "${firstInst}"`, visible(), instCount);
check('counter reports the filtered count', counter.textContent, (t) => t.includes(String(instCount)));

selectInstitution('');
search.value = 'zzzz-no-such-researcher';
fire(search, 'input');
check('no matches hides every card', visible(), 0);
check('no matches reveals the empty message', empty.hasAttribute('hidden'), false);

search.value = '';
fire(search, 'input');
check('clearing search restores all', visible(), TOTAL);
check('counter reports the full set', counter.textContent, (t) => t.includes(String(TOTAL)));

console.log();
if (failures.length) {
  console.error(`${failures.length} failure${failures.length > 1 ? 's' : ''}:`);
  failures.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('Directory behaviour OK.');
