/**
 * Build content/pages/*.json — the narrative layer.
 *
 * Substance is AIWC's own copy, lifted from aiwc.org.au unchanged. What is
 * new is the ORDER: the old site was a menu, this one is an argument —
 * shared problem → shared premise → evidence of scale → the four programmes
 * → the people → the moment → the invitation.
 *
 * Long lists (publications, programme write-ups, article bodies) are pulled
 * from the extracted dataset rather than retyped, so nothing drifts.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';

const HERE = new URL('./', import.meta.url).pathname;
const REPO = join(HERE, 'aiwc-repo');
const OUT = join(REPO, 'content/pages');
mkdirSync(OUT, { recursive: true });

const articles = JSON.parse(readFileSync(join(HERE, 'aiwc-data/articles.json'), 'utf8'));
const rawPages = JSON.parse(readFileSync(join(HERE, 'aiwc-raw/pages.json'), 'utf8'));
const byslug = (s) => articles.find((a) => a.slug === s);

const decode = (s = '') =>
  s.replace(/&#0?38;|&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”').replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—').replace(/&nbsp;|&#160;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

/** Paragraph strings out of an extracted article, headings kept as markers. */
const bodyOf = (slug, { skipHeadings = false } = {}) => {
  const a = byslug(slug);
  if (!a) return [];
  const out = [];
  for (const b of a.blocks) {
    if (b.kind === 'p') out.push(b.text);
    else if (b.kind === 'h' && !skipHeadings) out.push({ kind: 'h', text: b.text });
    else if (b.kind === 'list') out.push({ kind: 'list', items: b.items });
  }
  return out;
};

/** Paragraph strings out of one of the original WordPress pages. */
const pageParas = (slug, minLen = 60) => {
  const p = rawPages.find((x) => x.slug === slug);
  if (!p) return [];
  const { document } = parseHTML(`<div id="r">${p.content.rendered}</div>`);
  const seen = new Set();
  return [...document.querySelectorAll('p, li')]
    .map((n) => decode(n.textContent))
    .filter((t) => t.length >= minLen && !seen.has(t) && seen.add(t));
};

const photo = (name, x = 50, y = 50) => ({ image: `/assets/photos/${name}`, positionX: x, positionY: y });

const write = (slug, data) => {
  writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(data, null, 2) + '\n');
};

/* ═══════════════════════════════════════════════════════════════════════
   01 — OVERVIEW
   The argument in one page: the shared condition, the premise, the scale,
   the work, the people, the moment, the invitation.
   ═════════════════════════════════════════════════════════════════════ */

write('home', {
  menuName: 'Overview',
  slug: 'home',
  order: 1,
  published: true,
  template: 'home',
  intro: {
    eyebrow: 'Australia India Water Centre · Established 2020',
    title: 'Two countries.\nOne water problem.',
    lede: 'Water is a global resource that matters to everyone and everything we do. More than ever, we need to understand and work together on water issues and challenges, now and in the future — and those issues need to be addressed with collective concerns, experiences, learnings and efforts.',
  },
  actions: [
    { label: 'How we work', page: 'work', primary: true },
    { label: 'Meet the researchers', page: 'people' },
  ],
  blocks: [
    {
      type: 'statement',
      tone: 'paper',
      label: 'The premise',
      quote: 'Water management is not just a technical challenge.',
      cite: 'AIWC vision — the Centre acts as a catalyst for Australian and Indian partners to break down silos, think differently, and facilitate sustainable water futures through bilateral partnerships and transdisciplinary approaches.',
    },
    {
      type: 'measures',
      tone: 'ink',
      label: '01 — The partnership in numbers',
      title: 'A network, not a project.',
      lede: 'Leading Australian and Indian institutions, government agencies and water businesses came together to form the Australia India Water Centre. Five years on, this is its shape.',
      items: [
        { value: '33', label: 'Partner institutions across two countries' },
        { value: '108', label: 'Researchers with published profiles' },
        { value: '49', label: 'Based in Australia', side: 'au' },
        { value: '59', label: 'Based in India', side: 'in' },
        { value: '10,000+', label: 'Villages reached by the MARVI groundwater programme' },
      ],
    },
    {
      type: 'cols',
      tone: 'paper',
      side: true,
      label: '02 — Why a joint centre',
      title: 'The same problems,\nfrom opposite ends\nof one ocean.',
      columns: [
        {
          label: 'Shared conditions',
          body: [
            'Australia and India’s water issues and challenges share many common elements, including natural extremes of floods and droughts, increasing competition for water between urban, peri-urban and rural sectors and increased threats to water security from climate change. There are also pressures due to the over-exploitation and water quality degradation of surface and groundwater resources.',
          ],
        },
        {
          label: 'Why it matters to both',
          body: [
            'Although India has a much larger population than Australia, the Gross Domestic Product of both countries heavily relies on access to fresh water. Therefore, effective surface and groundwater management plays a critical role in food production, sustaining livelihoods, human well-being, and socio-economic development.',
            'Both countries are going through increasing urbanisation, which has added to the complexity of managing stormwater, provision of sanitation services, surface and groundwater pollution and the demands for drinking water and other uses. Further, India is currently undergoing a rapid socio-economic transformation with changing demographics and the need to sustain the farming sector; for this, water availability of the required quality and quantity will be critical. As such, both countries can partner for mutual benefits and learn significantly from each other’s experiences and strengths.',
          ],
        },
      ],
    },
    {
      type: 'programmes',
      tone: 'sand',
      label: '03 — What we do',
      title: 'Four programmes, one agenda.',
      lede: 'AIWC’s key activities are structured into four distinct areas. Each has two or more programme leaders, who meet six times a year to plan, design and oversee activities across partners and stakeholders.',
      items: [
        { number: '01', title: 'Research', text: 'Transdisciplinary projects on groundwater, springs, coastal reservoirs and water security — run jointly across Australian and Indian institutions.', page: 'research', photo: photo('page-our-work-0.jpg'), alt: 'Field researchers sampling water', cta: 'Research programme' },
        { number: '02', title: 'Education', text: 'A Master’s specialisation in Sustainable Water Futures, built around transdisciplinary approaches, policy, agriculture and catchment management.', page: 'education', photo: photo('page-our-work-1.jpg'), alt: 'Students in a teaching session', cta: 'Education programme' },
        { number: '03', title: 'Training & capacity building', text: 'MARVI, Young Water Professionals, dam safety and village groundwater cooperatives — training that moves practice, not just knowledge.', page: 'training', photo: photo('page-our-work-2.jpg'), alt: 'Training participants at a field site', cta: 'Training programme' },
        { number: '04', title: 'Outreach', text: 'Workshops, webinars and technical exchange that carry the work to policy-makers, practitioners and communities in both countries.', page: 'outreach', photo: photo('page-our-work-3.jpg'), alt: 'Workshop participants in discussion', cta: 'Outreach programme' },
      ],
    },
    {
      type: 'cards',
      tone: 'paper',
      label: '04 — The people',
      title: 'Expertise that crosses disciplines,\nnot just borders.',
      lede: 'AIWC partners bring engineering, ecology, social science, law and agriculture to the same table — which is what makes it a genuinely transdisciplinary group rather than a network of hydrologists.',
      columns: 2,
      items: [
        { number: '108', title: 'Researchers across 27 institutions', text: 'Every profile carries their qualifications, areas of interest, current projects and key publications — searchable by country and institution.', page: 'people', cta: 'Browse the directory' },
        { number: '33', title: 'Partner institutions', text: 'Universities, national research institutes, government agencies and water businesses in Australia and India.', page: 'partners', cta: 'See the partners' },
      ],
    },
    {
      type: 'timeline',
      tone: 'deep',
      label: '05 — The journey',
      title: 'Five years, and the next five.',
      items: [
        { year: '2020', title: 'The Centre launches', text: 'AIWC is launched on 6 November 2020 — the first collaborative centre of its kind — led by Western Sydney University in Australia and IIT Guwahati in India, with 24 partners across the two countries.' },
        { year: '2021', title: 'WaterWise begins', text: 'On World Environment Day, core members initiate WaterWise: a virtual water dialogue where participants are contributors rather than passive receivers of knowledge.' },
        { year: '2022', title: 'Technical exchange with government', text: 'Four workshops with the Australia India Institute under the Joint Working Group convened by DAWE and the Ministry of Jal Shakti — groundwater, soil and water, wastewater reuse, and water informatics.' },
        { year: '2024–25', title: 'Training at scale', text: 'Forty Young Water Professionals trained from India’s central and state water departments; a second cohort of fifteen Indian Dam Safety Officers completes a two-week programme across NSW.' },
        { year: '2025', title: 'AIWC@5 and the 2030 agenda', text: 'Around 80 delegates gather at the Whitlam Institute for the Partners Forum and International Symposium; the AIWC Five-Year Report launches and five breakout sessions set the 2030 agenda.' },
      ],
    },
    {
      type: 'logoWall',
      tone: 'paper',
      label: '06 — Our partners',
      title: 'Who is in the room.',
      lede: 'Universities, national institutes, government departments and water businesses — eleven partners in Australia, twenty-two in India.',
    },
    {
      type: 'callout',
      tone: 'paper',
      label: 'Work with us',
      title: 'AIWC is looking for partners for the 2030 agenda.',
      text: 'Climate-resilient agriculture, groundwater security, PFAS and water quality, digital water tools, joint degree programmes and micro-credentials — the priorities set by partners at AIWC@5. If your institution works in any of them, we would like to hear from you.',
      actions: [
        { label: 'Contact the Centre', page: 'contact', primary: true },
        { label: 'Read the AIWC@5 outcomes', page: 'aiwc5' },
      ],
    },
  ],
});

/* ═══════════════════════════════════════════════════════════════════════
   02 — ABOUT
   ═════════════════════════════════════════════════════════════════════ */

write('about', {
  menuName: 'About',
  slug: 'about',
  order: 2,
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'About the Centre',
    title: 'A partnership for\nsustainable water futures.',
    lede: 'A joint initiative of institutions, government agencies and water businesses from Australia and India.',
  },
  blocks: [
    {
      type: 'prose',
      tone: 'paper',
      label: 'Context',
      title: 'Why the Centre exists.',
      body: [
        'Australia and India’s water issues and challenges share many common elements, including natural extremes of floods and droughts, increasing competition for water between urban, peri-urban and rural sectors and increased threats to water security from climate change. There are also pressures due to the over-exploitation and water quality degradation of surface and groundwater resources.',
        'Although India has a much larger population than Australia, the Gross Domestic Product of both countries heavily relies on access to fresh water. Therefore, effective surface and groundwater management plays a critical role in food production, sustaining livelihoods, human well-being, and socio-economic development.',
        'Both countries are going through increasing urbanisation, which has added to the complexity of managing stormwater, provision of sanitation services, surface and groundwater pollution and the demands for drinking water and other uses. Further, India is currently undergoing a rapid socio-economic transformation with changing demographics and the need to sustain the farming sector; for this, water availability of the required quality and quantity will be critical. As such, both countries can partner for mutual benefits and learn significantly from each other’s experiences and strengths.',
        'The Australia India Water Centre (AIWC) was established by a consortium of Australian and Indian universities, research institutions, government agencies and water businesses to promote cooperation and collaboration in water research, education, training and capacity building and outreach. The Centre provides a platform for long-term partnerships and dialogue between Australian and Indian water researchers, policy-makers, industry partners and non-governmental organisations to work together for a common goal.',
      ],
    },
    {
      type: 'statement',
      tone: 'deep',
      label: 'Our vision',
      quote: 'Water management is not just a technical challenge.',
      cite: 'The AIWC is to act as a catalyst for the Australian and Indian partners to break down silos, think differently and facilitate sustainable water futures through bilateral partnerships and transdisciplinary approaches.',
    },
    {
      type: 'cols',
      tone: 'paper',
      label: 'Centre focus',
      title: 'Six things the Centre set out to do.',
      columns: [
        {
          body: [
            { kind: 'list', items: [
              'Develop tools and techniques for improving the management of surface and groundwater resources (including springs, stormwater, wetlands, lakes and coastal reservoirs), water policy and governance and resilience and adaptation to climate change;',
              'Establish joint educational programs in ‘sustainable water futures’ at the postgraduate level;',
              'Conduct capacity-building and training programs for young water professionals, policy-makers, and industry personnel through short courses, workshops, conferences and webinars;',
            ] },
          ],
        },
        {
          body: [
            { kind: 'list', items: [
              'Promote transdisciplinary research, socio-economic and cultural aspects, woman empowerment, citizen science and community engagement in water resources management;',
              'Establish Australia India Water Knowledge Platform — a ‘one-stop shop’ for easy access and sharing of water knowledge, tools and expertise from both Australia and India; and',
              'Support the water expertise of the Centre partners for international engagement, networking and people-to-people contacts.',
            ] },
          ],
        },
      ],
    },
    {
      type: 'prose',
      tone: 'sand',
      label: 'Governance',
      title: 'How the Centre is run.',
      body: [
        'AIWC’s key activities are structured into four distinct areas: Research, Education, Training, and Outreach. Each program has two or more leaders to support the initiatives. The Program Leaders meet six times a year to discuss the facilitation and seamless execution of various activities spanning programs, partners, and stakeholders. Further they strategically plan design and oversee activities to ensure tangible outcomes in alignment with the Centre’s mission.',
        { kind: 'h', text: 'Programme leader positions' },
        { kind: 'list', items: [
          'Distinguished Professor Basant Maheshwari — Committee Chair',
          'Dr Dharma Hagare — Country Coordinator, Australia',
          'Prof. Subashisa Dutta — Country Coordinator, India',
          'Associate Professor Shu-Qing Yang — Program Leader, Research',
          'Associate Professor Sumit Sen — Program Leader, Research',
          'Dr Jason Reynolds — Program Leader, Education',
          'Dr Vijaya Lakshmi — Program Leader, Education',
          'Dr Pankaj Kumar — Program Leader, Training',
          'Professor Pushpa Tuppad — Program Leader, Training',
          'Professor Shiva Prasad — Program Leader, Engagement and Outreach',
        ] },
      ],
    },
    {
      type: 'cols',
      tone: 'paper',
      label: 'Principles and reach',
      columns: [
        {
          title: 'Guiding principles',
          body: [
            { kind: 'list', items: [
              'Equal partnership between Australia and India;',
              'A transdisciplinary approach to water research, innovation, education, training and capacity building;',
              'Support for all partners for their growth and benefits; and',
              'Promote transparency and trust in the operation of AIWC, ensuring long-lasting collaboration and legacy.',
            ] },
          ],
        },
        {
          title: 'Who the work is for',
          body: [
            { kind: 'list', items: [
              'Government policy-makers',
              'Water professionals working in government agencies',
              'Researchers involved in transdisciplinary research',
              'Water educators, consultants, practitioners and NGOs',
              'Prospective training participants',
              'Prospective undergraduate and postgraduate students',
              'Water businesses, community and media',
            ] },
          ],
        },
      ],
    },
    {
      type: 'callout',
      tone: 'paper',
      accent: 'sand',
      title: 'Read the work itself.',
      text: 'The four programmes, the researchers behind them, and everything the Centre has published.',
      actions: [
        { label: 'Our work', page: 'work', primary: true },
        { label: 'Our people', page: 'people' },
        { label: 'Publications', page: 'publications' },
      ],
    },
  ],
});

/* ═══════════════════════════════════════════════════════════════════════
   03 — OUR WORK (hub) and its four children
   ═════════════════════════════════════════════════════════════════════ */

write('work', {
  menuName: 'Our work',
  slug: 'work',
  order: 3,
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Our work',
    title: 'Research, education,\ntraining, outreach.',
    lede: 'AIWC’s key activities are structured into four distinct areas, each led by two or more programme leaders drawn from partner institutions in both countries.',
  },
  blocks: [
    {
      type: 'programmes',
      tone: 'paper',
      items: [
        { number: '01', title: 'Research', text: 'Transdisciplinary projects on groundwater management, spring recharge, coastal reservoirs and water security, run jointly across Australian and Indian institutions.', page: 'research', photo: photo('page-our-work-0.jpg'), cta: 'Research' },
        { number: '02', title: 'Education', text: 'A Master’s program specialising in Sustainable Water Futures — transdisciplinary approaches, policy and governance, agriculture and catchment management.', page: 'education', photo: photo('page-our-work-1.jpg'), cta: 'Education' },
        { number: '03', title: 'Training & capacity building', text: 'Five programmes: MARVI, Young Water Professionals, DRIP II, dam safety and risk management, and village groundwater cooperatives.', page: 'training', photo: photo('page-our-work-2.jpg'), cta: 'Training' },
        { number: '04', title: 'Outreach', text: 'The Australia India Technical Exchange Program workshop series, webinars and public dialogue with policy-makers and practitioners.', page: 'outreach', photo: photo('page-our-work-3.jpg'), cta: 'Outreach' },
      ],
    },
  ],
});

write('research', {
  menuName: 'Research',
  slug: 'research',
  order: 4,
  parent: 'work',
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Our work · Research',
    title: 'Research activities',
    lede: 'Joint projects run across Australian and Indian institutions, several of them funded under India’s Scheme for Promotion of Academic and Research Collaboration (SPARC).',
  },
  blocks: [
    {
      type: 'pubList',
      tone: 'paper',
      label: 'Current and recent projects',
      items: (byslug('research-activities')?.blocks || [])
        .filter((b) => b.kind === 'list')
        .flatMap((b) => b.items)
        .map((text) => {
          const m = text.match(/(https?:\/\/\S+)/);
          return m ? { text: text.replace(m[1], '').trim(), href: m[1] } : { text };
        }),
    },
    {
      type: 'cards',
      tone: 'sand',
      label: 'Where research sits',
      title: 'Research is one of four programmes.',
      columns: 3,
      items: [
        { number: '02', title: 'Education', text: 'The Master’s specialisation in Sustainable Water Futures.', page: 'education', cta: 'Education' },
        { number: '03', title: 'Training', text: 'MARVI, YWP, DRIP II, dam safety and village groundwater cooperatives.', page: 'training', cta: 'Training' },
        { number: '04', title: 'Outreach', text: 'Technical exchange workshops and public dialogue.', page: 'outreach', cta: 'Outreach' },
      ],
    },
    {
      type: 'callout',
      tone: 'paper',
      title: 'Looking for a research collaborator?',
      text: 'One hundred and eight researchers across 27 institutions, with their areas of interest, current projects and key publications on record.',
      actions: [{ label: 'Search the directory', page: 'people', primary: true }],
    },
  ],
});

write('education', {
  menuName: 'Education',
  slug: 'education',
  order: 5,
  parent: 'work',
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Our work · Education',
    title: 'Master’s Program in\nSustainable Water Futures',
    lede: 'A comprehensive and transdisciplinary education that equips participants with the knowledge, skills, and expertise to address the complex challenges of water sustainability.',
  },
  blocks: [
    {
      type: 'prose',
      tone: 'paper',
      label: 'The programme',
      body: bodyOf('masters-program-in-sustainable-water-futures'),
    },
    {
      type: 'callout',
      tone: 'paper',
      accent: 'sand',
      title: 'Interested in the programme?',
      text: 'Education is led by Dr Jason Reynolds (Western Sydney University) and Dr Vijaya Lakshmi (JNTU Hyderabad). Get in touch with the Centre for current intake details.',
      actions: [{ label: 'Contact the Centre', page: 'contact', primary: true }],
    },
  ],
});

/* Training: five programmes, each given its full write-up rather than a stub. */
const TRAINING = [
  ['managing-groundwater-use-and-sustaining-aquifer-recharge-through-village-level-interventions-marvi', 'Managing Aquifer Recharge and Sustaining Groundwater Use through Village-level Interventions (MARVI)'],
  ['the-young-water-professionals-program-ywp', 'The Young Water Professionals Program (YWP)'],
  ['dam-rehabilitation-improvement-project-drip-ii', 'Dam Rehabilitation Improvement Project (DRIP II)'],
  ['training-program-on-dam-safety-and-risk-management-in-australia', 'Training Program on Dam Safety and Risk Management in Australia'],
  ['village-groundwater-cooperatives-vgcs', 'Village Groundwater Cooperatives (VGCs)'],
];

write('training', {
  menuName: 'Training',
  slug: 'training',
  order: 6,
  parent: 'work',
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Our work · Training & capacity building',
    title: 'Training that moves practice,\nnot just knowledge.',
    lede: 'Five programmes, from village-level groundwater monitoring in Rajasthan and Gujarat to dam safety training for India’s Central Water Commission officers in New South Wales.',
  },
  blocks: [
    {
      type: 'cards',
      tone: 'sand',
      compact: true,
      columns: 3,
      items: TRAINING.map(([slug, title], i) => ({
        number: String(i + 1).padStart(2, '0'),
        title: title.replace(/\s*\(.*\)$/, ''),
        text: (byslug(slug)?.blocks.find((b) => b.kind === 'p')?.text || '').slice(0, 130).replace(/\s+\S*$/, '') + '…',
        href: '#' + slug,
        cta: 'Read',
      })),
    },
    ...TRAINING.map(([slug, title], i) => ({
      type: 'prose',
      tone: i % 2 ? 'sand' : 'paper',
      label: `${String(i + 1).padStart(2, '0')} — Programme`,
      title,
      anchor: slug,
      body: bodyOf(slug),
    })),
    {
      type: 'callout',
      tone: 'paper',
      title: 'Training is expanding under the 2030 agenda.',
      text: 'Partners at AIWC@5 recommended expanding the Young Water Professionals model, developing micro-credentials, and building shared training modules across IITs, ICAR institutes, Australian universities and State Agricultural Universities.',
      actions: [
        { label: 'AIWC@5 outcomes', page: 'aiwc5', primary: true },
        { label: 'Contact the Centre', page: 'contact' },
      ],
    },
  ],
});

write('outreach', {
  menuName: 'Outreach',
  slug: 'outreach',
  order: 7,
  parent: 'work',
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Our work · Outreach',
    title: 'Carrying the work\nbeyond the Centre.',
    lede: 'Workshops, webinars and technical exchange that put researchers, policy-makers and practitioners from both countries in the same room.',
  },
  blocks: [
    {
      type: 'prose',
      tone: 'paper',
      label: 'Australia India Technical Exchange Program',
      title: 'Water and Food Security workshop series',
      body: bodyOf('australia-india-technical-exchange-program-in-water-and-food-securitys-workshop-series'),
    },
    {
      type: 'cards',
      tone: 'sand',
      label: 'Also part of outreach',
      columns: 3,
      items: [
        { number: '01', title: 'News & events', text: 'The AIWC@5 International Symposium, WATER TALKS 2025 and the webinar series.', page: 'news', cta: 'What’s on' },
        { number: '02', title: 'WaterWise', text: 'The Centre’s blog for sustainable water futures — a dialogue, not a broadcast.', page: 'waterwise', cta: 'Read the blog' },
        { number: '03', title: 'Resources', text: 'Recorded webinars and seminar series, including Dams for Life.', page: 'resources', cta: 'Resources' },
      ],
    },
  ],
});

/* ═══════════════════════════════════════════════════════════════════════
   04 — PEOPLE, PARTNERS
   ═════════════════════════════════════════════════════════════════════ */

write('people', {
  menuName: 'Our people',
  slug: 'people',
  order: 8,
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Our people',
    title: 'One hundred and eight\nwater researchers.',
    lede: 'Engineering, ecology, social science, law and agriculture — filter by country or institution, and open any profile for areas of interest, current projects and key publications.',
  },
  blocks: [{ type: 'peopleGrid', tone: 'paper' }],
});

write('partners', {
  menuName: 'Our partners',
  slug: 'partners',
  order: 9,
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Our partners',
    title: 'Thirty-three institutions,\ntwo countries.',
    lede: 'Universities, national research institutes, government departments and water businesses — the consortium that established the Centre and sustains it.',
  },
  blocks: [
    { type: 'partnerRows', tone: 'paper', country: 'Australia', label: '01 — Australia', title: 'Partners in Australia' },
    { type: 'partnerRows', tone: 'sand', country: 'India', label: '02 — India', title: 'Partners in India' },
    {
      type: 'callout',
      tone: 'paper',
      title: 'Become a partner institution.',
      text: 'AIWC is built on equal partnership between Australia and India, with support for all partners for their growth and benefits. If your institution works on water, we would like to talk.',
      actions: [{ label: 'Contact the Centre', page: 'contact', primary: true }],
    },
  ],
});

/* ═══════════════════════════════════════════════════════════════════════
   05 — PUBLICATIONS, RESOURCES
   ═════════════════════════════════════════════════════════════════════ */

const splitRef = (text) => {
  const m = text.match(/(https?:\/\/\S+?)(?:[.,;)]\s*)?$/);
  return m ? { text: text.slice(0, m.index).trim(), href: m[1] } : { text };
};

write('publications', {
  menuName: 'Publications',
  slug: 'publications',
  order: 10,
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Publications',
    title: 'What the partnership\nhas published.',
    lede: 'Journal articles, conference papers and book chapters from AIWC partners across both countries.',
  },
  blocks: [
    { type: 'pubList', tone: 'paper', label: '01 — Journal articles', title: 'Journal articles', items: pageParas('journal-articles').map(splitRef) },
    { type: 'pubList', tone: 'sand', label: '02 — Conference papers', title: 'Conference papers', items: pageParas('conference-papers').map(splitRef) },
    { type: 'pubList', tone: 'paper', label: '03 — Books & chapters', title: 'Books and chapters', items: pageParas('books-chapters').map(splitRef) },
  ],
});

write('resources', {
  menuName: 'Resources',
  slug: 'resources',
  order: 11,
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Resources',
    title: 'Dams for Life',
    lede: 'Managing their safety and risks for sustainable water futures — a seminar series on dam safety and rehabilitation in India, and what Australia’s experience can contribute.',
  },
  blocks: [
    { type: 'prose', tone: 'paper', label: 'Background', body: pageParas('resources', 200) },
    {
      type: 'linkList',
      tone: 'sand',
      label: 'Webinar series',
      title: 'Recorded sessions',
      items: [
        { title: 'Webinar 1: Operating and Managing Dams', text: 'Introduction by Professor Basant Maheshwari and Dr Joop Stoutjesdijk, with Mr Manoj Kumar, Mr Madhava and WaterNSW.', href: 'https://www.youtube.com/@australiaindiawatercentre-9628' },
        { title: 'Webinar 2: Managing Flood Risks, Gender Equality, Diversity and Social Inclusion (GEDSI)', text: 'Introduction by the World Bank and Professor Basant Maheshwari (WSU), with the Chief Inspector of NSW State Emergency Service, Dr Suzette Mitchell, Dr Rani and Ms Sani.', href: 'https://www.youtube.com/@australiaindiawatercentre-9628' },
      ],
    },
    {
      type: 'callout',
      tone: 'paper',
      accent: 'ochre',
      title: 'Every session is on the AIWC channel.',
      text: 'Recordings of the webinar series, WATER TALKS and the technical exchange workshops.',
      actions: [{ label: 'Subscribe on YouTube', href: 'https://www.youtube.com/@australiaindiawatercentre-9628', primary: true }],
    },
  ],
});

/* ═══════════════════════════════════════════════════════════════════════
   06 — NEWS, WATERWISE, AIWC@5, CONTACT
   ═════════════════════════════════════════════════════════════════════ */

write('news', {
  menuName: 'News & events',
  slug: 'news',
  order: 12,
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'News & events',
    title: 'What is happening\nat the Centre.',
    lede: 'Symposia, webinars and the WATER TALKS series — open to researchers, policy-makers, practitioners and students across Australia, India and the Asia Pacific.',
  },
  blocks: [
    {
      type: 'prose',
      tone: 'paper',
      label: 'Symposium',
      title: 'AIWC@5 International Symposium',
      body: [
        'Water Futures and Climate Resilience — bold ideas, real solutions, resilient futures. Two days, 18 and 19 November 2025, across Australia, India and the Asia Pacific, for researchers, policymakers, practitioners and students.',
        'As global water and climate challenges reach critical levels, it’s time to act together. The AIWC@5 Symposium is your gateway to shaping sustainable water futures through bold thinking, deep collaboration, and actionable innovation.',
        { kind: 'h', text: 'Join leading voices from across the region to' },
        { kind: 'list', items: [
          'Exchange cutting-edge research',
          'Spotlight real-world case studies',
          'Showcase community-driven innovation',
          'Drive policy and digital transformation',
        ] },
        { kind: 'h', text: 'Focus areas' },
        { kind: 'list', items: [
          'Climate Adaptation & Resilience',
          'River & Groundwater Sustainability',
          'Agricultural Water Management',
          'Urban Water Transitions',
          'Digital Tools & Policy Innovation',
        ] },
        'The symposium is a catalyst for change. Be part of a growing movement driving inclusive, climate-resilient water solutions across the Asia Pacific.',
      ],
    },
    {
      type: 'linkList',
      tone: 'sand',
      label: 'Symposium documents',
      items: [
        { title: 'Programme and themes', text: 'The full symposium flyer.', href: 'https://aiwc.org.au/wp-content/uploads/2025/08/FLYER-International-Symposium-General.pdf' },
        { title: 'The venue', text: 'Venue details for the 2025 symposium.', href: 'https://aiwc.org.au/wp-content/uploads/2025/08/Symposium-Venue-2025.pdf' },
      ],
    },
    {
      type: 'prose',
      tone: 'paper',
      label: 'Webinar series',
      title: 'WATER TALKS 2025',
      body: bodyOf('webinar-series-water-talks-2025').slice(0, 14),
    },
    {
      type: 'callout',
      tone: 'paper',
      title: 'Read what came out of AIWC@5.',
      text: 'Five thematic breakout sessions set the Centre’s agenda to 2030 — research and innovation, training and education, policy partnerships, global positioning, and funding.',
      actions: [{ label: 'AIWC@5 outcomes', page: 'aiwc5', primary: true }],
    },
  ],
});

const blogPosts = [
  'waterwise-the-aiwc-blog-for-sustainable-water-futures',
  'dams-safety-and-rehabilitation',
  'rejuvenation-of-the-springs-in-the-himalayan-region-evaluation-of-options-and-strategies-mr-neeraj-pant-phd-candidate',
];

write('waterwise', {
  menuName: 'WaterWise',
  slug: 'waterwise',
  order: 13,
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'WaterWise',
    title: 'The AIWC blog for\n‘Sustainable Water Futures’.',
    lede: 'A virtual water dialogue where participants are not passive receivers of knowledge but active contributors — because water science communication should acknowledge different forms of knowledge and give equal status to everyone.',
  },
  blocks: blogPosts.map((slug, i) => ({
    type: 'prose',
    tone: i % 2 ? 'sand' : 'paper',
    label: `${String(i + 1).padStart(2, '0')} — ${byslug(slug)?.date || ''}`,
    title: byslug(slug)?.title || slug,
    body: bodyOf(slug),
  })),
});

write('aiwc5', {
  menuName: 'AIWC@5',
  slug: 'aiwc5',
  order: 14,
  published: true,
  template: 'standard',
  heroImage: photo('page-aiwc5-conference-0.jpg', 50, 45),
  intro: {
    eyebrow: 'AIWC@5 · 17–19 November 2025',
    title: 'Five years of\nAustralia–India water\ncollaboration.',
    lede: 'Western Sydney University hosted the AIWC@5 Partners Forum and International Symposium at the Whitlam Institute, marking five years of the Centre and its growing impact on water security, sustainable agriculture, and climate resilience.',
  },
  blocks: [
    {
      type: 'prose',
      tone: 'paper',
      label: 'The gathering',
      body: (() => {
        const paras = pageParas('aiwc5-conference', 80);
        return paras.slice(0, paras.findIndex((p) => /Strategic Directions/i.test(p)) + 1 || 8);
      })(),
    },
    {
      type: 'shotPair',
      tone: 'paper',
      compact: true,
      items: [
        { image: '/assets/photos/page-aiwc5-conference-1.jpg', ratio: 'ratio-wide', caption: 'AIWC@5 Partners Forum, Whitlam Institute, Western Sydney University.' },
        { image: '/assets/photos/page-aiwc5-conference-2.jpg', ratio: 'ratio-wide', caption: 'Around 80 delegates from India and Australia attended over three days.' },
      ],
    },
    {
      type: 'prose',
      tone: 'sand',
      label: 'Strategic directions',
      title: 'The 2030 agenda,\nset by the partners.',
      body: (() => {
        const paras = pageParas('aiwc5-conference', 80);
        const i = paras.findIndex((p) => /Strategic Directions/i.test(p));
        return i >= 0 ? paras.slice(i + 1) : paras.slice(8);
      })(),
    },
    {
      type: 'ribbon',
      items: [3, 4, 5, 6, 7].map((n) => ({ image: `/assets/photos/page-aiwc5-conference-${n}.jpg`, alt: 'AIWC@5 symposium' })),
    },
    {
      type: 'callout',
      tone: 'paper',
      title: 'The next five years start with partners.',
      text: 'Collectively, the AIWC@5 sessions generated a coherent set of actions that will guide the development of an AIWC 2030 Vision and Implementation Plan.',
      actions: [{ label: 'Talk to the Centre', page: 'contact', primary: true }],
    },
  ],
});

write('contact', {
  menuName: 'Contact',
  slug: 'contact',
  order: 15,
  published: true,
  template: 'standard',
  intro: {
    eyebrow: 'Contact',
    title: 'Get in touch.',
    lede: 'The Centre is co-led from Western Sydney University in Australia and IIT Guwahati in India.',
  },
  blocks: [
    {
      type: 'contactCards',
      tone: 'paper',
      items: [
        {
          country: 'Australia',
          address: 'Western Sydney University, Locked Bag 1797, Penrith NSW 2751',
          people: [
            { name: 'Distinguished Professor Basant Maheshwari', role: 'Director — AIWC, Western Sydney University', email: 'b.maheshwari@westernsydney.edu.au' },
            { name: 'A/Professor Dharma Hagare', role: 'AIWC Country Co-ordinator, Australia', email: 'D.Hagare@westernsydney.edu.au' },
            { name: 'Centre Manager', role: 'AIWC — Western Sydney University', email: 'aiwc@westernsydney.edu.au' },
          ],
        },
        {
          country: 'India',
          address: 'Indian Institute of Technology Guwahati, Guwahati 781039',
          people: [
            { name: 'Professor Parmeswar Iyer', role: 'Co-Director — AIWC; Director, IIT Guwahati', email: 'director@iitg.ac.in' },
            { name: 'Prof. Subashisa Datta', role: 'AIWC Country Co-ordinator, India', email: 'subashisa@iitg.ac.in' },
            { name: 'Prof. Suresh Kartha', role: 'Head, Centre for Sustainable Water Research', email: 'hocswr@iitg.ac.in' },
          ],
        },
      ],
    },
    {
      type: 'callout',
      tone: 'paper',
      accent: 'sand',
      title: 'Follow the work.',
      text: 'Webinars, symposium sessions and the WATER TALKS series are published on the Centre’s YouTube channel.',
      actions: [{ label: 'AIWC on YouTube', href: 'https://www.youtube.com/@australiaindiawatercentre-9628', primary: true }],
    },
  ],
});

console.log('pages written:', 15);
