/**
 * Writes public/sitemap.xml from the live IPO list.
 *
 * Wired as `prebuild`, so every deploy ships a sitemap that matches the IPOs that actually
 * exist. The file is gitignored: a committed sitemap goes stale the moment a new issue opens,
 * and a stale sitemap is worse than none because Google keeps recrawling URLs you removed.
 *
 * The API being down must not break a deploy. If the fetch fails we still write the static
 * routes and exit 0 — a smaller sitemap is a far better outcome than a failed build.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = process.env.SITE_ORIGIN || 'https://www.nirantara.cloud';
const API = process.env.VITE_API_BASE || 'https://api.nirantara.cloud/api';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sitemap.xml');

/** Routes that exist regardless of what the API says. */
const STATIC_ROUTES = [
  { path: '/', changefreq: 'hourly', priority: '1.0' },
  { path: '/gmp', changefreq: 'hourly', priority: '0.9' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/disclaimer', changefreq: 'yearly', priority: '0.3' },
];

/** A live issue changes all day; one that listed years ago does not. */
function cadenceFor(status) {
  switch (status) {
    case 'open':
    case 'allotment':
      return { changefreq: 'hourly', priority: '0.9' };
    case 'upcoming':
      return { changefreq: 'daily', priority: '0.8' };
    default:
      return { changefreq: 'monthly', priority: '0.5' };
  }
}

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[c]};`);

function urlEntry({ path, changefreq, priority, lastmod }) {
  return [
    '  <url>',
    `    <loc>${escapeXml(SITE + path)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n');
}

async function fetchIpos() {
  const res = await fetch(`${API}/ipos`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`GET /ipos returned ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('expected an array of IPOs');
  return body;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  let ipoEntries = [];

  try {
    const ipos = await fetchIpos();
    ipoEntries = ipos
      .filter((ipo) => ipo && ipo.id)
      .map((ipo) => ({ path: `/ipo/${ipo.id}`, lastmod: today, ...cadenceFor(ipo.status) }));
    console.log(`sitemap: ${ipoEntries.length} IPO pages from ${API}`);
  } catch (err) {
    console.warn(`sitemap: could not reach the API (${err.message}) — writing static routes only`);
  }

  const entries = [...STATIC_ROUTES.map((r) => ({ ...r, lastmod: today })), ...ipoEntries];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(urlEntry),
    '</urlset>',
    '',
  ].join('\n');

  await writeFile(OUT, xml);
  console.log(`sitemap: wrote ${entries.length} URLs to public/sitemap.xml`);
}

main().catch((err) => {
  // Still refuse to fail the build; write nothing and let the deploy continue.
  console.error(`sitemap: unexpected failure — ${err.message}`);
  process.exit(0);
});
