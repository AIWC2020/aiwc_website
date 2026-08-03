// Pull every page, post, category and media item from aiwc.org.au's WP REST API.
// The host drops long-lived connections, so each request is retried and paged small.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const BASE = 'https://aiwc.org.au/wp-json/wp/v2';
const OUT = new URL('./aiwc-raw/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (res.ok) return { body: await res.json(), headers: res.headers };
      if (res.status === 400) return { body: [], headers: res.headers }; // past last page
    } catch (err) {
      if (i === tries - 1) throw err;
    }
    await sleep(1500 * (i + 1));
  }
  return { body: [], headers: new Headers() };
}

async function all(type, fields, perPage = 20) {
  const out = [];
  for (let page = 1; page <= 60; page++) {
    const { body, headers } = await get(`${BASE}/${type}?per_page=${perPage}&page=${page}&_fields=${fields}`);
    if (!Array.isArray(body) || body.length === 0) break;
    out.push(...body);
    process.stdout.write(`\r${type}: ${out.length}   `);
    if (page >= Number(headers.get('x-wp-totalpages') || 1)) break;
    await sleep(300);
  }
  console.log();
  return out;
}

const jobs = [
  ['pages', 'id,slug,title,content,excerpt,link,date,featured_media'],
  ['posts', 'id,slug,title,content,excerpt,link,date,categories,featured_media'],
  ['categories', 'id,slug,name,count,description,parent', 100],
  ['media', 'id,slug,title,source_url,alt_text,media_details,post'],
];

for (const [name, fields, perPage] of jobs) {
  const file = `${OUT}${name}.json`;
  if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).length > 0) {
    console.log(`${name}: cached (${JSON.parse(readFileSync(file, 'utf8')).length})`);
    continue;
  }
  const data = await all(name, fields, perPage);
  writeFileSync(file, JSON.stringify(data, null, 2));
}
console.log('done');
