// Download every image the new site needs: people portraits, partner logos,
// page photography. Files land under aiwc-assets/ mirroring a flat namespace.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const HERE = new URL('./', import.meta.url).pathname;
const OUT = HERE + 'aiwc-assets/';
mkdirSync(OUT + 'people', { recursive: true });
mkdirSync(OUT + 'logos', { recursive: true });
mkdirSync(OUT + 'photos', { recursive: true });

const people = JSON.parse(readFileSync(HERE + 'aiwc-data/people.json', 'utf8'));
const partners = JSON.parse(readFileSync(HERE + 'aiwc-data/partners.json', 'utf8'));
const articles = JSON.parse(readFileSync(HERE + 'aiwc-data/articles.json', 'utf8'));
const pages = JSON.parse(readFileSync(HERE + 'aiwc-raw/pages.json', 'utf8'));

const jobs = [];
const seen = new Set();
const add = (url, dir, name) => {
  if (!url || seen.has(url)) return;
  seen.add(url);
  const ext = (extname(new URL(url).pathname) || '.jpg').toLowerCase();
  jobs.push({ url, path: `${OUT}${dir}/${name}${ext}` });
};

for (const p of people) add(p.photo, 'people', p.slug);
for (const p of partners) {
  add(p.featured, 'logos', p.slug);
  p.images.forEach((src, i) => add(src, 'logos', `${p.slug}-${i}`));
}
for (const a of articles) {
  add(a.featured, 'photos', a.slug);
  a.images.slice(0, 6).forEach((src, i) => add(src, 'photos', `${a.slug}-${i}`));
}
// Everything referenced by the top-level pages (partner logo walls, hero art).
for (const page of pages) {
  const html = page.content?.rendered || '';
  const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  srcs.forEach((src, i) => add(src, 'photos', `page-${page.slug}-${i}`));
}

console.log('to download:', jobs.length);

let ok = 0, skip = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const job of jobs) {
  if (existsSync(job.path) && statSync(job.path).size > 0) { skip++; continue; }
  let saved = false;
  for (let t = 0; t < 3 && !saved; t++) {
    try {
      const res = await fetch(job.url, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) break;
      writeFileSync(job.path, Buffer.from(await res.arrayBuffer()));
      saved = true;
    } catch { await sleep(1200); }
  }
  saved ? ok++ : fail++;
  process.stdout.write(`\rok=${ok} skip=${skip} fail=${fail}   `);
}
console.log(`\ndone: ${ok} downloaded, ${skip} cached, ${fail} failed`);
