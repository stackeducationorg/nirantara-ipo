const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&#8377;': '₹',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m] ?? m);
}

/** InvestorGain returns HTML fragments inside JSON cells; this reduces one to plain text. */
export function stripHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  return decodeEntities(
    String(input)
      .replace(/<br\s*\/?>/gi, ' | ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** First number in a string, tolerating ₹, commas, %, and surrounding text. */
export function toNumber(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (!input) return null;
  const match = String(input).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

export function toInt(input: unknown): number | null {
  const n = toNumber(input);
  return n === null ? null : Math.round(n);
}

/**
 * Parses a price cell into a band. Accepts "138", "136-138", "₹136 to ₹138".
 * Returns the same value for min and max when the issue is fixed-price.
 */
export function parsePriceBand(input: unknown): { min: number | null; max: number | null; text: string } {
  const text = stripHtml(input);
  const nums = (text.replace(/,/g, '').match(/\d+(\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
  if (nums.length === 0) return { min: null, max: null, text };
  return { min: Math.min(...nums), max: Math.max(...nums), text };
}

/** Accepts "2026-08-24" or "2026-08-24T00:00:00.000Z" and returns "2026-08-24". */
export function toIsoDate(input: unknown): string | null {
  if (!input) return null;
  const s = String(input).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${m}-${d}`;
}

export function todayIso(): string {
  // Indian market dates — evaluate "today" in IST regardless of server timezone.
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIsoStr: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIsoStr}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** Extracts the `<a href>` slug and visible label out of an InvestorGain name cell. */
export function parseNameCell(cell: unknown): { name: string; slug: string | null } {
  const raw = String(cell ?? '');
  const href = raw.match(/href="([^"]+)"/)?.[1] ?? null;
  const title = raw.match(/title="([^"]+)"/)?.[1];
  const anchorText = raw.match(/<a[^>]*>([^<]+)<\/a>/)?.[1];
  const name = decodeEntities((title || anchorText || stripHtml(raw)).trim());
  const slug = href ? href.replace(/^\/+|\/+$/g, '') : null;
  return { name, slug };
}

/** Normalises a company name for fuzzy matching against registrar dropdown labels. */
export function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\b(LIMITED|LTD|PRIVATE|PVT|INDIA|IPO|SME|COMPANY|CO|THE|INC)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Token-overlap similarity in [0,1]. Used to map an IPO name to a registrar's own
 * company label, which is rarely an exact string match.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeCompanyName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeCompanyName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}
