/**
 * One-time migration: aiwc.org.au (WordPress) → content/people/*.json and
 * content/partners/*.json for the new site. Substance is AIWC's own words,
 * copied across unchanged; only structure is new.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const HERE = new URL('./', import.meta.url).pathname;
const REPO = join(HERE, 'aiwc-repo');
const ASSETS = join(HERE, 'aiwc-assets');

const people = JSON.parse(readFileSync(join(HERE, 'aiwc-data/people.json'), 'utf8'));
const partners = JSON.parse(readFileSync(join(HERE, 'aiwc-data/partners.json'), 'utf8'));

mkdirSync(join(REPO, 'content/people'), { recursive: true });
mkdirSync(join(REPO, 'content/partners'), { recursive: true });
mkdirSync(join(REPO, 'assets/people'), { recursive: true });
mkdirSync(join(REPO, 'assets/logos'), { recursive: true });
mkdirSync(join(REPO, 'assets/photos'), { recursive: true });

/* ── copy assets ────────────────────────────────────────────────────── */

for (const dir of ['people', 'logos', 'photos']) {
  cpSync(join(ASSETS, dir), join(REPO, 'assets', dir), { recursive: true });
}

const assetIndex = {};
for (const dir of ['people', 'logos', 'photos']) {
  for (const f of readdirSync(join(ASSETS, dir))) {
    assetIndex[`${dir}/${f.replace(extname(f), '')}`] = `/assets/${dir}/${f}`;
  }
}
const findAsset = (dir, name) => assetIndex[`${dir}/${name}`] || null;

/* ── people ─────────────────────────────────────────────────────────── */

// One person's portrait URL is shared with another's, so the download
// de-duplicated it. Map every person back to whichever file actually landed.
const photoByUrl = new Map();
for (const p of people) {
  if (!p.photo) continue;
  if (!photoByUrl.has(p.photo)) photoByUrl.set(p.photo, findAsset('people', p.slug));
}

const sortKey = (name) => name.replace(/^(Distinguished\s+)?(Dr|Prof|Professor|A\/Prof|Associate Professor|Mr|Ms|Mrs)\.?\s+/i, '').trim();

let peopleWritten = 0;
for (const p of people) {
  const local = findAsset('people', p.slug) || photoByUrl.get(p.photo);
  const record = {
    slug: p.slug,
    name: p.name,
    sortName: sortKey(p.name),
    designation: p.designation,
    institute: p.institute,
    instituteSlug: p.instituteSlug,
    country: p.country,
    qualification: p.qualification,
    interests: p.interests,
    email: p.email,
    homepage: p.homepage,
    profiles: p.profiles,
    photo: local ? { image: local, positionX: 50, positionY: 22 } : null,
    bio: p.bio,
    sections: p.sections,
    source: p.url,
  };
  writeFileSync(join(REPO, 'content/people', `${p.slug}.json`), JSON.stringify(record, null, 2) + '\n');
  peopleWritten++;
}

/* ── partners ───────────────────────────────────────────────────────── */

/**
 * The full partner roll comes from the logo wall on the old home page (33
 * institutions, in that order); ten of them additionally have a written
 * profile as a post. `logoIndex` is the position of that institution's logo
 * among the home page images, which is how the asset was named.
 */
const ROLL = [
  // Australia — logoIndex 1..11
  ['australia-india-institute', 'Australia India Institute', 'Australia', 1, 'australia-india-insitute'],
  ['deakin-university', 'Deakin University', 'Australia', 2, 'deakin-university'],
  ['flinders-university', 'Flinders University', 'Australia', 3, 'flinders-university'],
  ['griffith-university', 'Griffith University', 'Australia', 4, 'griffith-university'],
  ['queensland-university-of-technology', 'QUT Queensland University of Technology', 'Australia', 5, 'qut-queensland-university-of-technology'],
  ['department-for-environment-and-water-south-australia', 'Department for Environment and Water, South Australia', 'Australia', 6, 'south-australia-department-of-environment-and-water'],
  ['university-of-melbourne', 'University of Melbourne', 'Australia', 7, 'university-of-melbourne'],
  ['university-of-new-south-wales', 'University of New South Wales', 'Australia', 8, 'university-of-new-south-wales'],
  ['university-of-western-australia', 'University of Western Australia', 'Australia', 9, 'university-of-western-australia'],
  ['university-of-wollongong', 'University of Wollongong', 'Australia', 10, 'university-of-wollongong'],
  ['western-sydney-university', 'Western Sydney University', 'Australia', 11, 'western-sydney-university'],
  // India — logoIndex 12..33
  ['university-of-agricultural-sciences-bangalore', 'University of Agricultural Sciences, Bangalore', 'India', 12, 'university-of-agricultural-sciences-bangalore'],
  ['national-institute-of-technology-karnataka', 'National Institute of Technology Karnataka', 'India', 13, 'national-institute-of-technology-karnataka'],
  ['sardar-vallabhbhai-national-institute-of-technology', 'Sardar Vallabhbhai National Institute of Technology, Surat', 'India', 14, 'sardar-vallabhbhai-national-institute-of-technology'],
  ['maharana-pratap-university-of-agriculture-and-technology', 'Maharana Pratap University of Agriculture and Technology, Udaipur', 'India', 15, 'maharana-pratap-university-of-agriculture-and-technology-udaipur-rajasthan-india'],
  ['national-institute-of-hydrology', 'National Institute of Hydrology, Roorkee', 'India', 16, 'national-institute-of-hydrology'],
  ['jawaharlal-nehru-technological-university-hyderabad', 'Jawaharlal Nehru Technological University, Hyderabad', 'India', 17, 'jawaharlal-nehru-technological-university-hyderabad'],
  ['jss-science-and-technology-university-mysuru', 'JSS Science and Technology University, Mysuru', 'India', 18, 'jss-science-and-technology-university-mysuru'],
  ['indian-institute-of-technology-guwahati', 'Indian Institute of Technology Guwahati', 'India', 19, 'indian-institute-of-technology-guwahati'],
  ['institute-of-rural-management-anand', 'Institute of Rural Management Anand', 'India', 20, 'institute-of-rural-management-anand'],
  ['indian-institute-of-technology-kharagpur', 'Indian Institute of Technology Kharagpur', 'India', 21, 'indian-institute-of-technology-kharagpur'],
  ['indian-institute-of-technology-roorkee', 'Indian Institute of Technology Roorkee', 'India', 22, 'indian-institute-of-technology-roorkee-india'],
  ['indian-institute-of-information-technology-dharwad', 'Indian Institute of Information Technology Dharwad', 'India', 23, 'indian-institute-of-information-technology-dharwad'],
  ['indian-institute-of-science-bangalore', 'Indian Institute of Science, Bangalore', 'India', 24, 'indian-institute-of-science-bangalore-india'],
  ['banaras-hindu-university', 'Banaras Hindu University', 'India', 25, 'banaras-hindu-university'],
  ['g-b-pant-university-of-agriculture-and-technology', 'G. B. Pant University of Agriculture & Technology, Pantnagar', 'India', 26, 'g-b-university-of-agriculture-technology-pantnagar-india'],
  ['water-resources-department-maharashtra', 'Water Resources Department, Maharashtra', 'India', 27, 'water-resources-department-maharashtra'],
  ['indian-institute-of-technology-madras', 'Indian Institute of Technology Madras', 'India', 28, 'indian-institute-of-technology-madras'],
  ['institute-of-land-and-disaster-management', 'Institute of Land and Disaster Management', 'India', 29, 'institute-of-land-and-disaster-management'],
  ['public-health-engineering-department', 'Public Health Engineering Department (PHED)', 'India', 30, null],
  ['centre-for-water-and-sanitation', 'Centre for Water and Sanitation (CWS)', 'India', 31, null],
  ['indian-council-of-agricultural-research', 'Indian Council of Agricultural Research (ICAR)', 'India', 32, null],
  ['indian-institute-of-technology-bhu-varanasi', 'Indian Institute of Technology (BHU) Varanasi', 'India', 33, 'indian-institute-of-technology-bhu-varanasi'],
];

// Written profiles, keyed by the slug the post used.
const PROFILE_BY_SLUG = {
  'deakin-university': 'deakin-university',
  'flinders-university': 'flinders-university',
  'griffith-university': 'griffith-university',
  'queensland-university-of-technology': 'queensland-university-of-technology',
  'university-of-melbourne': 'the-university-of-melbourne',
  'university-of-western-australia': 'the-university-of-western-australia',
  'university-of-wollongong': 'university-of-wollongong',
  'university-of-new-south-wales': 'unsw-global-water-institute',
  'western-sydney-university': 'western-sydney-university',
  'department-for-environment-and-water-south-australia': 'department-for-environment-and-water-government-of-south-australia',
};

const partnerBySlug = new Map(partners.map((p) => [p.slug, p]));

let partnersWritten = 0;
for (const [slug, name, country, logoIndex, instituteCat] of ROLL) {
  const profile = PROFILE_BY_SLUG[slug] ? partnerBySlug.get(PROFILE_BY_SLUG[slug]) : null;

  const body = [];
  const sections = [];
  let current = null;
  for (const b of profile?.blocks || []) {
    if (b.kind === 'h') { current = { title: b.text, items: [] }; sections.push(current); }
    else if (b.kind === 'list') (current ? current.items : body).push(...b.items);
    else if (b.kind === 'p') (current ? current.items : body).push(b.text);
  }

  // Match the researcher records to this institution by the WordPress
  // category name, so the profile page can list its own people.
  const instituteName = people.find((p) => p.instituteSlug === instituteCat)?.institute || name;

  const record = {
    slug,
    name,
    country,
    instituteName,
    logo: findAsset('logos', slug) ? { image: findAsset('logos', slug) } : { image: findAsset('photos', `page-home-${logoIndex}`) },
    // Some partner entries on aiwc.org.au are still placeholders ("Details
    // will be updated."). Keep them in the body — they are the institution's
    // own copy — but do not promote one to the directory summary.
    summary: body[0] && !/details? will be updated|coming soon|to be (updated|added)/i.test(body[0])
      ? body[0].slice(0, 190).replace(/\s+\S*$/, '') + (body[0].length > 190 ? '…' : '')
      : '',
    body,
    sections: sections.filter((s) => s.items.length),
    source: profile?.url || null,
  };
  writeFileSync(join(REPO, 'content/partners', `${slug}.json`), JSON.stringify(record, null, 2) + '\n');
  partnersWritten++;
}

console.log(`people:   ${peopleWritten}`);
console.log(`partners: ${partnersWritten}`);
console.log(`no photo: ${people.filter((p) => !findAsset('people', p.slug) && !photoByUrl.get(p.photo)).map((p) => p.slug).join(', ') || 'none'}`);
console.log(`no logo:  ${ROLL.filter(([s, , , i]) => !findAsset('logos', s) && !findAsset('photos', `page-home-${i}`)).map(([s]) => s).join(', ') || 'none'}`);
