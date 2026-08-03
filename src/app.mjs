/**
 * Everything the built site does in the browser. It is deliberately small:
 * pages are real documents with real links, so this only adds the mobile
 * drawer, the researcher filter and the scroll reveal. Nothing here is
 * required to read the site.
 */

/* ── mobile navigation drawer ───────────────────────────────────────── */

const body = document.body;
const rail = document.getElementById('rail');
const toggle = document.querySelector('[data-nav-toggle]');
const scrim = document.querySelector('[data-nav-close]');

const setNav = (open) => {
  body.classList.toggle('nav-open', open);
  toggle?.setAttribute('aria-expanded', String(open));
  if (scrim) scrim.hidden = !open;
};

toggle?.addEventListener('click', () => setNav(!body.classList.contains('nav-open')));
scrim?.addEventListener('click', () => setNav(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && body.classList.contains('nav-open')) {
    setNav(false);
    toggle?.focus();
  }
});
// Keep the active item in view when the rail is taller than the viewport.
rail?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });

/* ── language switch ────────────────────────────────────────────────── */

const langSelect = document.getElementById('lang-select');
langSelect?.addEventListener('change', () => {
  const base = langSelect.getAttribute('data-lang-base') || '';
  const root = langSelect.getAttribute('data-site-base') || '';
  const lang = langSelect.value;
  location.href = root + (lang === 'en' ? '/' : '/' + lang + '/') + base;
});

/* ── researcher filter ──────────────────────────────────────────────── */

const filters = document.querySelector('[data-people-filters]');
const grid = document.querySelector('[data-people-grid]');
const empty = document.querySelector('[data-people-empty]');
const counter = document.querySelector('[data-people-count]');
const search = document.querySelector('[data-people-search]');
const instSelect = document.querySelector('[data-people-inst]');

if (filters && grid) {
  const cards = [...grid.children];
  // Country, institution and free text compose: each narrows the last.
  const state = { country: '', inst: '', query: '' };

  const apply = () => {
    let shown = 0;
    for (const card of cards) {
      const match =
        (!state.country || card.dataset.country === state.country) &&
        (!state.inst || card.dataset.inst === state.inst) &&
        (!state.query || (card.dataset.search || '').includes(state.query));
      card.hidden = !match;
      if (match) shown++;
    }
    if (empty) empty.hidden = shown > 0;
    if (counter) {
      const scope = [state.country, state.inst].filter(Boolean).join(' \u00b7 ');
      counter.textContent =
        shown === cards.length
          ? `Showing all ${cards.length} researchers`
          : `${shown} of ${cards.length} researchers${scope ? ' \u2014 ' + scope : ''}`;
    }
  };

  filters.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    for (const c of filters.querySelectorAll('[data-filter]')) {
      c.setAttribute('aria-pressed', String(c === chip));
    }
    const value = chip.dataset.filter;
    state.country = value.startsWith('country:') ? value.slice(8) : '';
    apply();
  });

  search?.addEventListener('input', () => {
    state.query = search.value.trim().toLowerCase();
    apply();
  });

  instSelect?.addEventListener('change', () => {
    state.inst = instSelect.value;
    apply();
  });

  // Honour an institution arriving in the hash, so a partner page can link
  // straight to the researchers based there.
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash && instSelect) {
    const slugify = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const option = [...instSelect.options].find(
      (o) => o.value && (o.value === fromHash || slugify(o.value).includes(slugify(fromHash)))
    );
    if (option) {
      instSelect.value = option.value;
      state.inst = option.value;
      apply();
      grid.scrollIntoView({ block: 'start' });
    }
  }
}

/* ── scroll reveal ──────────────────────────────────────────────────── */

const reveals = document.querySelectorAll('.reveal');
if (reveals.length && !matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
  );
  reveals.forEach((node) => io.observe(node));
} else {
  reveals.forEach((node) => node.classList.add('in'));
}
