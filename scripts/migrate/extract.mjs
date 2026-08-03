// Turn the Elementor HTML from aiwc.org.au into readable structured text,
// one .md-ish file per page/post, so every page can actually be read.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const RAW = new URL('./aiwc-raw/', import.meta.url).pathname;
const TXT = new URL('./aiwc-text/', import.meta.url).pathname;
mkdirSync(TXT, { recursive: true });

const decode = (s) =>
  s
    .replace(/&#0?38;|&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“')
    .replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function toText(html) {
  const { document } = parseHTML(`<div id="r">${html}</div>`);
  const root = document.getElementById('r');
  root.querySelectorAll('script,style,noscript').forEach((n) => n.remove());

  const out = [];
  const seen = new Set();
  const push = (line) => {
    const t = line.replace(/[ \t]+/g, ' ').trim();
    if (t) out.push(t);
  };

  const walk = (node) => {
    for (const child of node.children) {
      const tag = child.tagName?.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        push('\n' + '#'.repeat(Number(tag[1])) + ' ' + child.textContent);
        continue;
      }
      if (tag === 'p') {
        push(child.textContent);
        continue;
      }
      if (tag === 'li') {
        push('- ' + child.textContent);
        continue;
      }
      if (tag === 'img') {
        const src = child.getAttribute('src') || '';
        if (src && !seen.has(src)) {
          seen.add(src);
          push(`[IMG] ${src}${child.getAttribute('alt') ? ' | alt=' + child.getAttribute('alt') : ''}`);
        }
        continue;
      }
      if (tag === 'a') {
        const href = child.getAttribute('href') || '';
        const label = child.textContent.trim();
        if (label && href && !/^#/.test(href)) push(`[LINK] ${label} -> ${href}`);
        else if (label) push(label);
        continue;
      }
      if (tag === 'iframe') {
        push(`[IFRAME] ${child.getAttribute('src') || child.getAttribute('data-src') || ''}`);
        continue;
      }
      if (tag === 'br' || tag === 'hr') continue;
      if (child.children.length === 0) {
        push(child.textContent);
        continue;
      }
      walk(child);
    }
  };
  walk(root);

  // Collapse the runs of duplicate lines Elementor's nesting produces.
  const dedup = [];
  for (const line of out) if (dedup[dedup.length - 1] !== line) dedup.push(line);
  return decode(dedup.join('\n')).replace(/\n{3,}/g, '\n\n');
}

for (const kind of ['pages', 'posts']) {
  const file = `${RAW}${kind}.json`;
  if (!existsSync(file)) continue;
  const items = JSON.parse(readFileSync(file, 'utf8'));
  mkdirSync(`${TXT}${kind}`, { recursive: true });
  const index = [];
  for (const item of items) {
    const title = decode(item.title?.rendered || item.slug);
    const body = toText(item.content?.rendered || '');
    const head = `TITLE: ${title}\nURL: ${item.link}\nDATE: ${(item.date || '').slice(0, 10)}\nCATS: ${(item.categories || []).join(',')}\n\n`;
    writeFileSync(`${TXT}${kind}/${item.slug}.txt`, head + body);
    index.push({ slug: item.slug, title, date: (item.date || '').slice(0, 10), cats: item.categories || [], chars: body.length, url: item.link });
  }
  writeFileSync(`${TXT}${kind}-index.json`, JSON.stringify(index, null, 2));
  console.log(kind, items.length);
}
