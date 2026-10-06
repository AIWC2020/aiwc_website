/**
 * Browser-only behaviour: menu, directories, gallery, search, lightbox.
 *
 * Content and translation are baked in at build time (see hydrate.mjs), so
 * nothing here fetches copy or swaps languages — the language switcher is a
 * plain navigation now. Each built page carries only its own panel, so every
 * lookup below must tolerate its target being absent.
 */

/* ---------- motion ----------
 * Light and arrival-only. Blocks float up as they scroll into view and the
 * partnership figures count up once; everything else is CSS (see the motion
 * block in index.html). With reduced motion requested nothing is hidden or
 * animated: blocks are simply there and the figures show their final values. */

const REVEAL =
  '.story-card, .process-step, .metric, .partner-country, .section-head, .explore-head, ' +
  '.split > *, .cms-block-callout, .tool-card, .home-statement';

function countUp(node) {
  if (!node || node.dataset.counted) return;
  node.dataset.counted = '1';
  const match = node.textContent.trim().match(/^(\d[\d,]*)(.*)$/s);
  if (!match) return;
  const end = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(end) || end < 2) return;
  const started = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - started) / 1300, 1);
    node.textContent = Math.round(end * (1 - Math.pow(1 - progress, 3))).toLocaleString() + match[2];
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupMotion() {
  if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target;
        node.classList.add('is-in');
        if (node.matches('.metric')) countUp(node.querySelector('strong'));
        node.querySelectorAll('.metric strong').forEach(countUp);
        observer.unobserve(node);
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
  );
  document.querySelectorAll(REVEAL).forEach((node, index) => {
    node.style.setProperty('--d', (index % 4) * 90 + 'ms');
    node.classList.add('will-reveal');
    observer.observe(node);
  });
}

/**
 * Apply the CMS text-size percentages.
 *
 * The percentage is carried on the element as data-cms-text-scale, so this
 * needs no content lookup — it just resolves the designed size (a clamp(), so
 * viewport-dependent) and scales it. The build deliberately ships these
 * unsized: the value can only be computed where CSS is actually resolved,
 * which is why it re-runs on resize.
 */
function refreshTextScales() {
  document.querySelectorAll('[data-cms-text-scale]').forEach((node) => {
    const percentage = Number(node.dataset.cmsTextScale) || 0;
    if (!percentage || percentage === 100) return;
    node.style.fontSize = '';
    const baseline = Number.parseFloat(getComputedStyle(node).fontSize);
    if (Number.isFinite(baseline)) node.style.fontSize = (baseline * percentage) / 100 + 'px';
  });
}

/* ---------- image archive + publications ---------- */
/* Grids, filter buttons and counts are prerendered by the build; this only
 * wires behaviour onto them. */

function wireFilters({ filterWrap, grid, itemSel, categoryAttr, count, noun }) {
  if (!filterWrap || !grid) return;
  filterWrap.querySelectorAll('.archive-filter').forEach((filter) => {
    filter.addEventListener('click', () => {
      const category = filter.textContent.trim();
      filterWrap
        .querySelectorAll('.archive-filter')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === filter)));
      let visible = 0;
      grid.querySelectorAll(itemSel).forEach((item) => {
        const match = category === 'All' || item.getAttribute(categoryAttr) === category;
        item.hidden = !match;
        if (match) visible++;
      });
      if (count) count.textContent = `${visible} ${visible === 1 ? noun[0] : noun[1]}`;
    });
  });
}

function setupArchive() {
  const grid = document.getElementById('gallery-grid');
  wireFilters({
    filterWrap: document.getElementById('archive-filters'),
    grid,
    itemSel: '.gallery-item',
    categoryAttr: 'data-category',
    count: document.getElementById('gallery-count'),
    noun: ['archived image', 'archived images']
  });
  // The old runtime appended pixel dimensions to each label once the image
  // loaded; keep that touch.
  grid?.querySelectorAll('.gallery-item img').forEach((image) => {
    const label = image.parentElement.querySelector('span');
    const annotate = () => {
      if (label && image.naturalWidth && image.naturalHeight) {
        label.textContent =
          image.parentElement.getAttribute('data-category') +
          ' · ' + image.naturalWidth + '×' + image.naturalHeight;
      }
    };
    if (image.complete) annotate();
    else image.addEventListener('load', annotate);
  });
}

/**
 * Publications are grouped into .pub-section blocks (Journal articles,
 * Conference papers, …), each carrying data-kind. The filter bar is built
 * here rather than in the template: it is pure behaviour, it can only be
 * correct once the real sections exist, and building it client-side means
 * a no-JS visitor simply sees every section — nothing breaks.
 */
/**
 * Collapsible categories, shared by publications, researchers and partner
 * institutions. Every .disc-group closes on load — its count still says what
 * it holds — so a long directory opens as a short index. Collapsing here
 * rather than in the markup means no-JS readers get everything expanded.
 */
const discGroups = () => [...document.querySelectorAll('.disc-group')];

function setGroupOpen(group, open) {
  const toggle = group.querySelector('.disc-toggle');
  if (!toggle) return;
  // Everything except the header row is the disclosure's content.
  [...group.children].forEach((child) => {
    if (!child.classList.contains('disc-head')) child.hidden = !open;
  });
  toggle.setAttribute('aria-expanded', String(open));
  group.classList.toggle('is-open', open);
}

// A category small enough to read without scrolling has nothing to gain from
// being shut — closing it just adds a click. Only the long ones fold.
const OPEN_UNDER = 12;

function setupDisclosureGroups() {
  const groups = discGroups();
  groups.forEach((group) => {
    const toggle = group.querySelector('.disc-toggle');
    if (!toggle) return;
    const items = group.querySelectorAll('.pub-card, .portrait-card, .partner-card').length;
    setGroupOpen(group, items > 0 && items < OPEN_UNDER);
    toggle.addEventListener('click', () => {
      setGroupOpen(group, toggle.getAttribute('aria-expanded') !== 'true');
    });
  });
  // A shared link straight to a category arrives with it open.
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    const holder = target && groups.find((group) => group.contains(target));
    if (holder) setGroupOpen(holder, true);
  }
}

/** Re-label a group's count as filtering changes what it holds. */
function retallyGroup(group, visible) {
  const tally = group.querySelector('[data-group-count]');
  if (!tally) return;
  const [one, many] = (tally.dataset.noun || 'item|items').split('|');
  tally.textContent = `${visible} ${visible === 1 ? one : many}`;
}

function setupPublications() {
  const allSections = discGroups().filter((s) => s.classList.contains('pub-section'));
  const setOpen = setGroupOpen;
  const sections = allSections.filter((section) => section.dataset.kind);
  if (sections.length < 2) return;

  const total = sections.reduce((sum, s) => sum + s.querySelectorAll('.pub-card').length, 0);
  const bar = document.createElement('div');
  bar.className = 'archive-tools pub-filter-bar';
  const count = document.createElement('span');
  count.className = 'filter-label';
  const chips = document.createElement('div');
  chips.className = 'archive-filters';
  chips.setAttribute('aria-label', 'Show one kind of publication');

  const describe = (n) => `${n} ${n === 1 ? 'publication' : 'publications'}`;
  count.textContent = describe(total);

  /* Order. A bibliography's natural order is newest first, which is also the
     one order the markup cannot ship in — the records carry no date field,
     so the year is read out of each citation at build time. Anything without
     a year sorts last rather than as year zero. */
  const sortField = document.createElement('div');
  sortField.className = 'sort-field';
  const sortLabel = document.createElement('label');
  sortLabel.className = 'filter-label';
  sortLabel.textContent = 'Sort';
  sortLabel.setAttribute('for', 'sort-publications');
  const sortSelect = document.createElement('select');
  sortSelect.id = 'sort-publications';
  [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['title', 'Title A–Z'], ['shuffle', 'Shuffled']]
    .forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      sortSelect.appendChild(option);
    });
  sortField.appendChild(sortLabel);
  sortField.appendChild(sortSelect);

  const original = new Map(sections.map((s) => [s, [...s.querySelectorAll('.pub-card')]]));
  const shuffled = new Map(
    sections.map((s) => {
      const cards = original.get(s).slice();
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      return [s, cards];
    })
  );
  const yearOf = (card) => Number(card.dataset.year) || 0;
  const applySort = () => {
    const mode = sortSelect.value;
    sections.forEach((section) => {
      const grid = section.querySelector('.pub-grid');
      if (!grid) return;
      let cards = original.get(section).slice();
      if (mode === 'shuffle') cards = shuffled.get(section);
      else if (mode === 'title') cards.sort((a, b) => (a.dataset.title || '').localeCompare(b.dataset.title || ''));
      else {
        // A missing year should not masquerade as 0 and pile up at one end.
        cards.sort((a, b) => {
          const ya = yearOf(a), yb = yearOf(b);
          if (!ya && !yb) return 0;
          if (!ya) return 1;
          if (!yb) return -1;
          return mode === 'newest' ? yb - ya : ya - yb;
        });
      }
      cards.forEach((card) => grid.appendChild(card));
    });
  };
  sortSelect.addEventListener('change', applySort);
  applySort();

  const select = (kind, chip) => {
    chips.querySelectorAll('.archive-filter')
      .forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
    let visible = 0;
    sections.forEach((section) => {
      const match = kind === 'All' || section.dataset.kind === kind;
      section.hidden = !match;
      if (match) visible += section.querySelectorAll('.pub-card').length;
      // Asking for one kind is asking to read it — open it on arrival.
      if (match && kind !== 'All') setOpen(section, true);
    });
    count.textContent = describe(visible);
  };

  ['All', ...sections.map((s) => s.dataset.kind)].forEach((kind, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'archive-filter';
    chip.textContent = kind;
    if (kind !== 'All') {
      const n = document.createElement('span');
      n.className = 'filter-n';
      n.textContent = String(sections[i - 1].querySelectorAll('.pub-card').length);
      chip.appendChild(n);
    }
    chip.setAttribute('aria-pressed', String(kind === 'All'));
    chip.addEventListener('click', () => select(kind, chip));
    chips.appendChild(chip);
  });

  bar.appendChild(count);
  bar.appendChild(chips);
  bar.appendChild(sortField);
  sections[0].parentElement.insertBefore(bar, sections[0]);
}

function setupLightbox() {
  const grid = document.getElementById('gallery-grid');
  const lightbox = document.getElementById('lightbox');
  if (!grid || !lightbox) return;
  const lightboxImage = document.getElementById('lightbox-image');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxClose = document.getElementById('lightbox-close');

  const closeLightbox = () => {
    lightbox.hidden = true;
    lightboxImage.removeAttribute('src');
  };
  grid.addEventListener('click', (event) => {
    const button = event.target.closest('.gallery-item');
    if (!button) return;
    const img = button.querySelector('img');
    const title = button.getAttribute('data-title') || img.alt;
    const category = button.getAttribute('data-category') || '';
    lightboxImage.src = img.src;
    lightboxImage.alt = title;
    lightboxCaption.textContent = category + ' · ' + title;
    lightboxImage.onload = () => {
      lightboxCaption.textContent =
        category + ' · ' + lightboxImage.naturalWidth + '×' + lightboxImage.naturalHeight;
    };
    lightbox.hidden = false;
    lightboxClose.focus();
  });
  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });
}

/* ---------- media search ---------- */

function setupMediaSearch() {
  const search = document.getElementById('media-search');
  const count = document.getElementById('media-count');
  if (!search) return;
  const cards = [...document.querySelectorAll('.media-card')];
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const match =
        !query ||
        card.textContent.toLowerCase().includes(query) ||
        (card.dataset.search || '').includes(query);
      card.hidden = !match;
      if (match) visible++;
    });
    if (count) count.textContent = visible + (visible === 1 ? ' story' : ' stories');
  });
}

/* ---------- in-page section navigation ---------- */

/**
 * Long pages opt into an "on this page" bar via data-section-nav on their
 * panel ("jump" or "tabs", chosen per page in the CMS). Sections are the
 * titled banner blocks; everything between one banner and the next belongs
 * to it. Content before the first banner is an intro and stays put.
 *
 * The static page is always the full sequential document — this only builds
 * on top. Tabs wrap each section in a real tabpanel so hidden content is one
 * subtree, arrow keys walk the tablist, and a deep link into a hidden
 * section activates its tab instead of scrolling to nothing.
 */
function setupSectionNav() {
  const panel = document.querySelector('.panel[data-section-nav]');
  if (!panel) return;
  // Standard pages nest their blocks in .section-body. The home template has
  // no such wrapper — its blocks are direct children of the panel — so the
  // panel itself is the container there.
  const body = panel.querySelector('.section-body') || panel;
  // Headings sit directly in the body, or one level down inside a coloured
  // background band (see toneBands in templates.mjs).
  const banners = [...body.querySelectorAll(':scope > [data-section-anchor], :scope > .tone-band > [data-section-anchor]')];
  if (banners.length < 2) return;
  // "tabs" hid every section but one behind a sticky bar, which is most of
  // what made long pages feel crowded. It now renders as jump links: the
  // whole page stays readable top to bottom, and the bar is just a contents
  // list. "collapse" is unchanged — it is an explicit editorial choice.
  const raw = panel.getAttribute('data-section-nav');
  const mode = raw === 'tabs' ? 'jump' : raw;

  // A section runs until the next banner — or until the trailing
  // .cms-sections wrapper, which holds page-level blocks (the closing
  // callout). That wrapper belongs to the page rather than to the last
  // section, so it must never be swept into one and hidden with it.
  const endsSection = (node, i) =>
    (i + 1 < banners.length && node === banners[i + 1]) ||
    node.classList.contains('cms-sections');

  const labelFor = (banner) => {
    if (banner.dataset.tabLabel) return banner.dataset.tabLabel;
    const title = (banner.querySelector('h2')?.textContent || '').trim();
    const acronym = title.match(/\(([^)]{2,14})\)\s*$/);
    if (acronym) return acronym[1];
    if (title.length <= 30) return title;
    return title.slice(0, 27).replace(/\s+\S*$/, '') + '…';
  };

  /* collapse: each banner becomes the header of a disclosure holding
     everything until the next banner. Nothing is removed — a long page just
     opens as a list of its sections, and the reader expands what they want.
     Several can be open at once, which is the difference from tabs. */
  if (mode === 'collapse') {
    banners.forEach((banner, i) => {
      const holder = document.createElement('div');
      holder.className = 'disc-body';
      holder.id = banner.id + '-body';
      const members = [];
      let next = banner.nextElementSibling;
      while (next && !endsSection(next, i)) {
        members.push(next);
        next = next.nextElementSibling;
      }
      if (!members.length) return;
      banner.insertAdjacentElement('afterend', holder);
      members.forEach((m) => holder.appendChild(m));

      const heading = banner.querySelector('h2');
      if (!heading) return;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'disc-toggle disc-toggle--banner';
      toggle.setAttribute('aria-controls', holder.id);
      while (heading.firstChild) toggle.appendChild(heading.firstChild);
      heading.appendChild(toggle);
      banner.classList.add('is-collapsible');

      const setOpen = (open) => {
        holder.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        banner.classList.toggle('is-open', open);
      };
      // The first section starts open so the page introduces itself, unless
      // the CMS asks for everything shut.
      setOpen(i === 0 && !panel.hasAttribute('data-start-collapsed'));
      toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
      // A link into this section arrives with it open.
      const hashId = location.hash.slice(1);
      if (hashId && (hashId === banner.id || holder.querySelector('#' + (window.CSS?.escape ? CSS.escape(hashId) : hashId)))) {
        setOpen(true);
      }
    });
    return;
  }

  const bar = document.createElement('nav');
  bar.className = 'section-nav';
  bar.setAttribute('aria-label', 'On this page');

  if (mode === 'jump') {
    const links = banners.map((banner) => {
      const link = document.createElement('a');
      link.className = 'section-nav-link';
      link.href = '#' + banner.id;
      link.textContent = labelFor(banner);
      bar.appendChild(link);
      return link;
    });
    body.insertBefore(bar, body.firstChild);
    if ('IntersectionObserver' in window) {
      const highlight = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const current = banners.indexOf(entry.target);
          links.forEach((link, i) => link.setAttribute('aria-current', i === current ? 'true' : 'false'));
        });
      }, { rootMargin: '-30% 0px -55% 0px' });
      banners.forEach((banner) => highlight.observe(banner));
    }
    return;
  }

  /* tabs: wrap [banner .. next banner) into tabpanels */
  bar.setAttribute('role', 'tablist');
  const panels = banners.map((banner, i) => {
    const holder = document.createElement('div');
    holder.className = 'section-tab-panel';
    holder.setAttribute('role', 'tabpanel');
    holder.id = banner.id + '-panel';
    const members = [banner];
    let next = banner.nextElementSibling;
    while (next && !endsSection(next, i)) {
      members.push(next);
      next = next.nextElementSibling;
    }
    body.insertBefore(holder, banner);
    members.forEach((m) => holder.appendChild(m));
    return holder;
  });

  /* Anything before the first section is the page's own opening. Left loose
     it sits above every tab and is read on the way to all of them, which is
     what kept Training long — its five programme cards say exactly what the
     five tabs say. Folded into a tab of its own, one thing shows at a time.
     The hero stays outside: it is the page's identity, not a section. */
  const introLabel = panel.dataset.introTab;
  if (introLabel !== 'off') {
    const intro = [];
    let node = body.firstElementChild;
    while (node && node !== panels[0]) {
      if (!node.classList.contains('home-hero') && !node.classList.contains('page-head')) intro.push(node);
      node = node.nextElementSibling;
    }
    if (intro.length) {
      const holder = document.createElement('div');
      holder.className = 'section-tab-panel';
      holder.setAttribute('role', 'tabpanel');
      holder.id = 'section-intro-panel';
      body.insertBefore(holder, intro[0]);
      intro.forEach((n) => holder.appendChild(n));
      panels.unshift(holder);
      banners.unshift(null); // keeps banners and panels index-aligned
    }
  }

  const tabs = panels.map((holder, i) => {
    const banner = banners[i];
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'section-nav-link';
    tab.id = (banner ? banner.id : 'section-intro') + '-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', holder.id);
    tab.textContent = banner ? labelFor(banner) : (introLabel || 'Overview');
    holder.setAttribute('aria-labelledby', tab.id);
    bar.appendChild(tab);
    return tab;
  });

  const show = (index, { scroll = true } = {}) => {
    panels.forEach((holder, i) => { holder.hidden = i !== index; });
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    if (scroll && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: 'start' });
  };

  tabs.forEach((tab, i) => tab.addEventListener('click', () => show(i)));
  bar.addEventListener('keydown', (event) => {
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const last = tabs.length - 1;
    const target = { ArrowRight: current + 1 > last ? 0 : current + 1, ArrowLeft: current - 1 < 0 ? last : current - 1, Home: 0, End: last }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    show(target);
    tabs[target].focus();
  });

  // The bar sits at the very top of the content — after the hero, before the
  // first panel — so the whole page is one choice away rather than something
  // you scroll into.
  bar.classList.add('section-nav--top');
  body.insertBefore(bar, panels[0]);

  let start = 0;
  const hashId = location.hash.slice(1);
  if (hashId) {
    const target = document.getElementById(hashId);
    const index = panels.findIndex((holder) => target && holder.contains(target));
    if (index > -1) start = index;
  }
  show(start, { scroll: false });
  if (start > 0) panels[start].scrollIntoView({ block: 'start' });
}

/* ---------- chrome ---------- */

function setupMenu() {
  const menuButton = document.querySelector('.menu-toggle');
  if (menuButton) {
    menuButton.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.querySelector('.menu-toggle-text').textContent = open ? 'Close' : 'Menu';
    });
  }

  // Submenus open on hover for a mouse (CSS) and on the chevron button for
  // touch and keyboard. Only one is open at a time.
  const items = [...document.querySelectorAll('.nav-item.has-menu')];
  const close = (except) => items.forEach((item) => {
    if (item === except) return;
    item.classList.remove('is-open');
    item.querySelector('.nav-more')?.setAttribute('aria-expanded', 'false');
  });
  items.forEach((item) => {
    const more = item.querySelector('.nav-more');
    more?.addEventListener('click', () => {
      const open = !item.classList.contains('is-open');
      close(item);
      item.classList.toggle('is-open', open);
      more.setAttribute('aria-expanded', String(open));
    });
    item.addEventListener('focusout', (event) => {
      if (!item.contains(event.relatedTarget)) close();
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.nav-item.has-menu')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = items.find((item) => item.classList.contains('is-open'));
    if (open) {
      close();
      open.querySelector('.nav-more')?.focus();
    } else if (document.body.classList.contains('menu-open')) {
      menuButton?.click();
      menuButton?.focus();
    }
  });
}

/* ---------- site search ----------
 * The header's search button opens a panel over the page. The index
 * (assets/search.json: pages, sections, researchers, partners and
 * publications) is fetched the first time it opens, then every keystroke is a
 * local filter: all words must match, and title matches rank first. */
function setupSearch() {
  const panel = document.getElementById('search-panel');
  const toggle = document.querySelector('.search-toggle');
  if (!panel || !toggle) return;
  const input = panel.querySelector('#site-search');
  const results = panel.querySelector('#search-results');
  const base = document.body.dataset.base || '';
  let index = null;
  let lastFocus = null;

  const load = async () => {
    if (index) return index;
    try {
      const res = await fetch(base + '/assets/search.json');
      index = (await res.json()).map((e) => ({ ...e, hay: [e.t, e.x, e.s, e.k].filter(Boolean).join(' ').toLowerCase(), title: e.t.toLowerCase() }));
    } catch {
      index = [];
    }
    return index;
  };

  const hint = (text) => {
    results.textContent = '';
    const li = document.createElement('li');
    li.className = 'search-hint';
    li.textContent = text;
    results.appendChild(li);
  };

  const run = async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return hint('Type at least two letters — a topic, a researcher, an institution or a paper.');
    const words = q.split(/\s+/);
    const found = (await load())
      .filter((e) => words.every((w) => e.hay.includes(w)))
      .map((e) => ({ e, score: (e.title.startsWith(q) ? 3 : 0) + words.filter((w) => e.title.includes(w)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
    if (!found.length) return hint(`Nothing matches “${input.value.trim()}”. Try fewer or shorter words.`);
    results.textContent = '';
    for (const { e } of found) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = e.u;
      for (const [cls, text] of [['k', e.k], ['t', e.t], ['x', e.x]]) {
        if (!text) continue;
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        a.appendChild(span);
      }
      li.appendChild(a);
      results.appendChild(li);
    }
  };

  const open = () => {
    lastFocus = document.activeElement;
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
    input.focus();
    run();
  };
  const close = () => {
    panel.hidden = true;
    document.body.style.overflow = '';
    lastFocus?.focus();
  };

  toggle.addEventListener('click', open);
  panel.querySelector('.search-close').addEventListener('click', close);
  panel.addEventListener('click', (event) => { if (event.target === panel) close(); });
  input.addEventListener('input', run);
  // A result that only jumps within the current page leaves the panel open
  // over it; close on any click on a result.
  results.addEventListener('click', (event) => { if (event.target.closest('a')) close(); });
  document.addEventListener('keydown', (event) => {
    if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); close(); }
    const typing = /^(input|textarea|select)$/i.test(event.target.tagName || '') || event.target.isContentEditable;
    if (panel.hidden && event.key === '/' && !typing) { event.preventDefault(); open(); }
  });
}

// Each language is its own URL, so switching is a navigation rather than a
// re-render. data-lang-base is written by the build as the current page's
// path within its language, so the choice lands on the same page.
function setupLanguageSwitcher() {
  const select = document.getElementById('lang-select');
  if (!select) return;
  select.addEventListener('change', () => {
    const lang = select.value;
    const slugPath = select.getAttribute('data-lang-base') || '';
    window.location.href = lang === 'en' ? '/' + slugPath : '/' + lang + '/' + slugPath;
  });
}

/* ---------- boot ---------- */

// Before per-page URLs existed the site routed on #slug. Anyone arriving from
// an old bookmark or shared link lands on the home page with a stale fragment;
// send them to the real URL instead of silently showing the wrong section.
function redirectLegacyHash() {
  const hash = location.hash.slice(1);
  if (!hash) return false;
  const link = document.querySelector('[data-site-nav] a[data-tab="' + CSS.escape(hash) + '"]');
  const href = link && link.getAttribute('href');
  if (!href || href === location.pathname) return false;
  location.replace(href);
  return true;
}

if (!redirectLegacyHash()) {
  refreshTextScales();
  let scaleFrame = 0;
  window.addEventListener('resize', () => {
    if (scaleFrame) return;
    scaleFrame = requestAnimationFrame(() => {
      scaleFrame = 0;
      refreshTextScales();
    });
  });
  setupDisclosureGroups();
  setupSectionNav();
  setupMenu();
  setupSearch();
  setupMotion();
  setupLanguageSwitcher();
  setupMediaSearch();
  setupArchive();
  setupPublications();
  setupLightbox();
}

/* ── directories: shuffle, sort, and a one-row preview ────────────────
   People and Partners are long lists where order implies ranking. They are
   shuffled on load so nobody is permanently first, sorted by whatever the
   reader picks, and shown one row deep with a button that opens the rest.

   The markup arrives complete and in a stable order — this only reorders,
   hides and reveals, so a reader without JavaScript gets the whole list. */

function setupDirectory({ gridSel, filtersSel, searchSel, instSel, countSel, emptySel, kind, noun }) {
  const grids = [...document.querySelectorAll(gridSel)];
  if (!grids.length) return;

  const filters = document.querySelector(filtersSel);
  const search = searchSel && document.querySelector(searchSel);
  const instSelect = instSel && document.querySelector(instSel);
  const counter = countSel && document.querySelector(countSel);
  const empty = emptySel && document.querySelector(emptySel);
  const sortSelect = document.querySelector(`[data-sort="${kind}"]`);

  const state = { country: '', inst: '', query: '', sort: 'shuffle' };

  // Each country is its own list: its own shuffle, its own row, its own
  // button. Neither country's names sit permanently above the other's.
  const groups = grids.map((grid) => {
    const cards = [...grid.children];
    const shuffled = cards.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const section = grid.closest('.dir-group');
    return {
      grid, cards, shuffled, section,
      reveal: section?.querySelector(`[data-reveal="${kind}"]`) || null,
      tally: section?.querySelector('[data-group-count]') || null,
      open: false
    };
  });

  // Sorting the raw name files everyone with a doctorate under D. Titles are
  // dropped from the sort key only — the card still shows the full name.
  const plain = (card) =>
    (card.dataset.name || '').replace(/^((a\/)?prof|dr|mr|mrs|ms|miss|assoc\.?\s*prof)\.?\s+/i, '');
  const key = (card) => ({
    name: plain(card),
    country: (card.dataset.country || '') + ' ' + plain(card),
    institute: (card.dataset.inst || '') + ' ' + plain(card)
  });

  const matches = (card) =>
    (!state.country || card.dataset.country === state.country) &&
    (!state.inst || card.dataset.inst === state.inst) &&
    (!state.query || (card.dataset.search || '').includes(state.query));

  // "One row" is whatever the grid actually fits on its first line, so it is
  // read back from layout rather than assumed, and remeasured on resize.
  const firstRowCount = (g) => {
    const visible = g.cards.filter((c) => !c.hidden);
    if (!visible.length) return 0;
    const top = visible[0].offsetTop;
    return visible.filter((c) => c.offsetTop === top).length || visible.length;
  };

  const apply = () => {
    let total = 0, grand = 0;
    groups.forEach((g) => {
      const ordered = state.sort === 'shuffle'
        ? g.shuffled
        : g.cards.slice().sort((a, b) => key(a)[state.sort].localeCompare(key(b)[state.sort]));
      ordered.forEach((card) => g.grid.appendChild(card));

      let shown = 0;
      g.cards.forEach((card) => { const ok = matches(card); card.hidden = !ok; if (ok) shown++; });

      // The one-row preview is for browsing. Once someone filters or
      // searches they asked for those results, so every match is shown
      // rather than six of eighteen behind another click.
      const filtering = Boolean(state.country || state.inst || state.query);
      let previewed = shown;
      if (!g.open && !filtering) {
        const perRow = firstRowCount(g);
        let seen = 0;
        g.cards.forEach((card) => {
          if (card.hidden) return;
          seen++;
          if (seen > perRow) card.hidden = true;
        });
        previewed = Math.min(perRow, shown);
      }

      if (g.section) g.section.hidden = shown === 0;
      if (g.tally) {
        const [one, many] = (g.tally.dataset.noun || 'item|items').split('|');
        g.tally.textContent = `${shown} ${shown === 1 ? one : many}`;
      }
      if (g.reveal) {
        g.reveal.hidden = shown <= previewed && !g.open;
        g.reveal.textContent = g.open
          ? `Show fewer`
          : `Show all ${shown} ${shown === 1 ? noun[0] : noun[1]}`;
        g.reveal.setAttribute('aria-expanded', String(g.open));
      }
      total += shown;
      grand += g.cards.length;
    });

    if (empty) empty.hidden = total > 0;
    if (counter) {
      const scope = [state.country, state.inst].filter(Boolean).join(' · ');
      counter.textContent = total === grand
        ? `Showing all ${grand} ${noun[1]}`
        : `${total} of ${grand} ${noun[1]}${scope ? ' — ' + scope : ''}`;
    }
  };

  groups.forEach((g) => g.reveal?.addEventListener('click', () => { g.open = !g.open; apply(); }));
  filters?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    filters.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
    const value = chip.dataset.filter;
    state.country = value.startsWith('country:') ? value.slice(8) : '';
    apply();
  });
  search?.addEventListener('input', () => { state.query = search.value.trim().toLowerCase(); apply(); });
  instSelect?.addEventListener('change', () => { state.inst = instSelect.value; apply(); });
  sortSelect?.addEventListener('change', () => { state.sort = sortSelect.value; apply(); });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(apply, 150);
  });

  apply();
}

setupDirectory({
  gridSel: '[data-people-grid]', filtersSel: '[data-people-filters]',
  searchSel: '[data-people-search]', instSel: '[data-people-inst]',
  countSel: '[data-people-count]', emptySel: '[data-people-empty]',
  kind: 'people', noun: ['researcher', 'researchers']
});

setupDirectory({
  gridSel: '[data-partner-grid]', filtersSel: '[data-partner-filters]',
  searchSel: '[data-partner-search]',
  countSel: '[data-partner-count]', emptySel: '[data-partner-empty]',
  kind: 'partners', noun: ['institution', 'institutions']
});
