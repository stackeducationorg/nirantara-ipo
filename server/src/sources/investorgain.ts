import { config } from '../config.js';
import { getJson } from '../util/http.js';
import { logger } from '../util/logger.js';
import { parseNameCell, parsePriceBand, stripHtml, toInt, toIsoDate, toNumber } from '../util/parse.js';

const log = logger('investorgain');

interface ReportResponse {
  msg: number;
  reportTableData?: Record<string, unknown>[];
  totalPages?: number;
  currentTime?: string;
}

/** Indian financial year label for a given calendar month/year, e.g. Aug 2026 -> "2026-27". */
function financialYear(year: number, month: number): string {
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function reportUrl(reportId: number, page: number, year: number, month: number): string {
  const fy = financialYear(year, month);
  return `${config.investorgain.apiBase}/report/data-read/${reportId}/${page}/${month}/${year}/${fy}/0/all?search=`;
}

async function fetchReport(reportId: number, year: number, month: number): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = reportUrl(reportId, page, year, month);
    const json = await getJson<ReportResponse>(url, {
      headers: { Referer: `${config.investorgain.siteBase}/`, Accept: 'application/json' },
    });
    // msg === 1 means success; anything else is an empty/invalid window, not a hard failure.
    if (json.msg !== 1 || !Array.isArray(json.reportTableData)) {
      log.debug(`report ${reportId} ${year}-${month} page ${page} returned no data`);
      break;
    }
    rows.push(...json.reportTableData);
    totalPages = json.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages && page <= 20);

  return rows;
}

/** Reads a cell by any of several candidate keys, since report schemas differ in casing. */
function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
}

export interface IgIpo {
  igId: number;
  name: string;
  slug: string | null;
  category: string;
  exchange: string | null;
  priceText: string;
  priceMin: number | null;
  priceMax: number | null;
  lotSize: number | null;
  issueSize: string | null;
  openDate: string | null;
  closeDate: string | null;
  boaDate: string | null;
  listingDate: string | null;
  statusText: string | null;
  gmp: number | null;
  gmpPercent: number | null;
  subscriptionText: string | null;
  rating: number | null;
  raw: Record<string, unknown>;
}

function mapRow(row: Record<string, unknown>): IgIpo | null {
  const igId = toInt(pick(row, '~id'));
  if (!igId) return null;

  const nameCell = pick(row, 'Name', 'IPO', '~ipo_name');
  const parsed = parseNameCell(nameCell);
  const name = (pick(row, '~ipo_name') as string) || parsed.name;
  if (!name) return null;

  const price = parsePriceBand(pick(row, 'Price (₹)', 'IPO Price'));
  const gmpCell = stripHtml(pick(row, 'GMP'));
  // "₹31 (22.46%) | 19 ↓ / 31 ↑" — the leading number is the premium in rupees.
  const gmp = gmpCell && gmpCell !== '-' ? toNumber(gmpCell) : null;

  // Rating is rendered as a run of 🔥 emoji; count them.
  const ratingCell = String(pick(row, 'Rating', '~Rating') ?? '');
  const ratingCount = (ratingCell.match(/&#128293;|🔥/g) ?? []).length;

  const slug =
    (pick(row, '~urlrewrite_folder_name', '~URLRewrite_Folder_Name') as string | undefined)?.replace(
      /^\/+|\/+$/g,
      '',
    ) ?? parsed.slug;

  return {
    igId,
    name: name.trim(),
    slug: slug ?? null,
    category: String(pick(row, '~IPO_Category') ?? 'IPO').trim() || 'IPO',
    exchange: stripHtml(pick(row, 'Exchange')) || null,
    priceText: price.text,
    priceMin: price.min,
    priceMax: price.max,
    lotSize: toInt(pick(row, 'Lot')),
    issueSize: stripHtml(pick(row, 'IPO Size')) || null,
    openDate: toIsoDate(pick(row, '~Srt_Open')),
    closeDate: toIsoDate(pick(row, '~Srt_Close')),
    boaDate: toIsoDate(pick(row, '~Srt_BoA_Dt')),
    listingDate: toIsoDate(pick(row, '~Str_Listing', '~Srt_Listing')),
    statusText: stripHtml(pick(row, 'Status')) || null,
    gmp,
    gmpPercent: toNumber(pick(row, '~gmp_percent_calc')),
    subscriptionText: stripHtml(pick(row, 'Sub')) || null,
    rating: ratingCount || null,
    raw: row,
  };
}

/** Merges rows for the same IPO, preferring fields that are actually populated. */
function merge(base: IgIpo, next: IgIpo): IgIpo {
  const out = { ...base };
  for (const key of Object.keys(next) as (keyof IgIpo)[]) {
    const value = next[key];
    const missing = out[key] === null || out[key] === undefined || out[key] === '';
    if (missing && value !== null && value !== undefined && value !== '') {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  out.raw = { ...base.raw, ...next.raw };
  return out;
}

/**
 * Pulls the GMP report and the IPO calendar for the current and previous month, then merges
 * them by InvestorGain id. Two months of overlap matters because an IPO that closed late last
 * month still has its allotment and listing ahead of it.
 */
export async function fetchIpoUniverse(now = new Date()): Promise<IgIpo[]> {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth() + 1;
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  const windows = [prev, { year, month }, next];
  const { gmp, calendar } = config.investorgain.reports;

  const batches = await Promise.allSettled(
    windows.flatMap((w) => [fetchReport(gmp, w.year, w.month), fetchReport(calendar, w.year, w.month)]),
  );

  const byId = new Map<number, IgIpo>();
  for (const batch of batches) {
    if (batch.status === 'rejected') {
      log.warn('report window failed', batch.reason instanceof Error ? batch.reason.message : batch.reason);
      continue;
    }
    for (const row of batch.value) {
      const ipo = mapRow(row);
      if (!ipo) continue;
      const existing = byId.get(ipo.igId);
      byId.set(ipo.igId, existing ? merge(existing, ipo) : ipo);
    }
  }

  log.info(`fetched ${byId.size} IPOs across ${windows.length} months`);
  return [...byId.values()];
}

export interface IgSubscription {
  igId: number;
  total: string | null;
  qib: string | null;
  nii: string | null;
  bhni: string | null;
  shni: string | null;
  rii: string | null;
  anchor: string | null;
}

/** Live bidding/subscription figures for issues that are currently open. */
export async function fetchSubscriptions(now = new Date()): Promise<IgSubscription[]> {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const rows = await fetchReport(
    config.investorgain.reports.subscription,
    ist.getUTCFullYear(),
    ist.getUTCMonth() + 1,
  );

  return rows.flatMap((row) => {
    const igId = toInt(pick(row, '~id'));
    if (!igId) return [];
    return [
      {
        igId,
        total: stripHtml(pick(row, 'Total')) || null,
        qib: stripHtml(pick(row, 'QIB')) || null,
        nii: stripHtml(pick(row, 'NII')) || null,
        bhni: stripHtml(pick(row, 'BHNI')) || null,
        shni: stripHtml(pick(row, 'SHNI')) || null,
        rii: stripHtml(pick(row, 'RII')) || null,
        anchor: stripHtml(pick(row, 'Anchor')) || null,
      },
    ];
  });
}

export interface IgLogo {
  id: number;
  slug: string;
  logoUrl: string | null;
}

/** id -> slug/logo map, used to give each IPO card an image. */
export async function fetchIpoDirectory(): Promise<IgLogo[]> {
  const json = await getJson<{ msg: number; lists?: Record<string, unknown>[] }>(
    `${config.investorgain.apiBase}/ipo/ipo-url-lists`,
    { headers: { Referer: `${config.investorgain.siteBase}/` } },
  );
  if (json.msg !== 1 || !Array.isArray(json.lists)) return [];

  return json.lists.flatMap((row) => {
    const id = toInt(row.id);
    if (!id) return [];
    const logo = row.logo_url ? String(row.logo_url) : null;
    return [
      {
        id,
        slug: String(row.urlrewrite_folder_name ?? ''),
        logoUrl: logo ? `https://www.chittorgarh.net/images/ipo/${logo}` : null,
      },
    ];
  });
}
