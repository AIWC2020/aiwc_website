/**
 * Browser-only behaviour: motion, gallery, search, lightbox, menu.
 *
 * Content and translation are baked in at build time (see hydrate.mjs), so
 * nothing here fetches copy or swaps languages — the language switcher is a
 * plain navigation now. Each built page carries only its own panel, so every
 * lookup below must tolerate its target being absent.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- motion ---------- */

function setupMotion() {
  document.body.classList.add('motion-ready');
  // Story cards are excluded: their pointer-tilt writes inline transforms,
  // and a transform transition would drag behind the pointer.
  const motionItems = [
    ...document.querySelectorAll(
      '.project-card, .process-step, .media-card, .video-card, .people-card, .metric, ' +
      '.pub-card, .tool-card, .portrait-card, .cms-block, .data-panel, .editorial-image, .photo-ribbon figure'
    )
  ];
  motionItems.forEach((item, index) => {
    item.classList.add('motion-item');
    item.style.setProperty('--motion-delay', (index % 4) * 65 + 'ms');
  });

  if (reduceMotion || !('IntersectionObserver' in window)) {
    motionItems.forEach((item) => item.classList.add('is-inview'));
  } else {
    const motionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-inview');
          motionObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -5% 0px' }
    );
    motionItems.forEach((item) => motionObserver.observe(item));
  }

  // Big numbers count up the first time they scroll into view. The suffix
  // split is what lets "10,000+" animate: the digits run 0→10,000 while the
  // "+" stays put. Anything that does not lead with a digit is left alone.
  const counters = [...document.querySelectorAll('.metric strong, .data-value, .image-data-overlay strong')];
  const animateCounter = (node) => {
    if (node.dataset.animated) return;
    node.dataset.animated = 'true';
    const match = node.textContent.trim().match(/^([\d][\d,]*)(.*)$/s);
    if (!match || reduceMotion) return;
    const end = Number(match[1].replace(/,/g, ''));
    const suffix = match[2];
    if (!Number.isFinite(end) || end === 0) return;
    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - started) / 1100, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = Math.round(end * eased).toLocaleString() + suffix;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (counters.length && !reduceMotion && 'IntersectionObserver' in window) {
    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.4 }
    );
    counters.forEach((counter) => counterObserver.observe(counter));
  }

  if (!reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.story-card').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const bounds = card.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width;
        const y = (event.clientY - bounds.top) / bounds.height;
        card.style.setProperty('--spot-x', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--spot-y', (y * 100).toFixed(1) + '%');
        card.style.transform = `perspective(1000px) rotateX(${((0.5 - y) * 3.5).toFixed(2)}deg) rotateY(${((x - 0.5) * 4.5).toFixed(2)}deg) translateY(-4px)`;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
        card.style.removeProperty('--spot-x');
        card.style.removeProperty('--spot-y');
      });
    });
  }

  const progressBar = document.getElementById('scroll-progress');
  if (progressBar) {
    let progressFrame = 0;
    const updateProgress = () => {
      progressFrame = 0;
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      const progress = distance > 0 ? Math.min(window.scrollY / distance, 1) : 0;
      progressBar.style.transform = `scaleX(${progress})`;
    };
    window.addEventListener('scroll', () => {
      if (!progressFrame) progressFrame = requestAnimationFrame(updateProgress);
    }, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
  }
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

function showReveals(root) {
  root.querySelectorAll('.reveal').forEach((element, index) => {
    window.setTimeout(() => element.classList.add('is-visible'), Math.min(index * 90, 420) + 60);
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

function setupDisclosureGroups() {
  const groups = discGroups();
  groups.forEach((group) => {
    const toggle = group.querySelector('.disc-toggle');
    if (!toggle) return;
    setGroupOpen(group, false);
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
  const banners = [...body.querySelectorAll(':scope > [data-section-anchor]')];
  if (banners.length < 2) return;
  const mode = panel.getAttribute('data-section-nav');

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
  if (!menuButton) return;
  menuButton.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
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
  const link = document.querySelector('.nav-tab[data-tab="' + CSS.escape(hash) + '"]');
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
  setupMotion();
  setupMenu();
  setupLanguageSwitcher();
  setupMediaSearch();
  setupArchive();
  setupPublications();
  setupLightbox();
  showReveals(document);
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

      let previewed = shown;
      if (!g.open) {
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
