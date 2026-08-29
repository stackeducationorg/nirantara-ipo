import { logger } from '../util/logger.js';
import { nameSimilarity } from '../util/parse.js';
import { bigshare } from './bigshare.js';
import { cameo } from './cameo.js';
import { createBrowserAdapter } from './browserAdapter.js';
import { kfintech } from './kfintech.js';
import { maashitla } from './maashitla.js';
import { mufg } from './mufg.js';
import { browserProfiles } from './profiles.js';
import { purva } from './purva.js';
import { skyline } from './skyline.js';
import type { RegistrarAdapter, RegistrarCompany } from './types.js';

const log = logger('registrar');

// Every registrar below reaches its allotment data over plain HTTP. Only Cameo still needs a
// browser profile, and even that cannot be automated because it enforces an image captcha.
const httpAdapters: RegistrarAdapter[] = [bigshare, kfintech, mufg, maashitla, skyline, purva];
const httpKeys = new Set(httpAdapters.map((a) => a.key));

const adapters: RegistrarAdapter[] = [
  ...httpAdapters,
  ...browserProfiles()
    .filter((p) => !httpKeys.has(p.key))
    .map(createBrowserAdapter),
];

export const registrars = new Map<string, RegistrarAdapter>(adapters.map((a) => [a.key, a]));

export function getRegistrar(key: string | null | undefined): RegistrarAdapter | null {
  return key ? registrars.get(key) ?? null : null;
}

export function listRegistrars(): { key: string; name: string; driver: string }[] {
  return adapters.map((a) => ({ key: a.key, name: a.name, driver: a.driver }));
}

/** Maps a free-text registrar name (from an IPO detail page) onto an adapter key. */
export function matchRegistrarByName(name: string): RegistrarAdapter | null {
  const hay = name.toLowerCase();
  return adapters.find((a) => a.match.some((m) => hay.includes(m))) ?? null;
}

export interface RegistrarMatch {
  registrarKey: string;
  registrarName: string;
  companyCode: string;
  companyName: string;
  confidence: number;
}

const MIN_CONFIDENCE = 0.5;

const LIST_TTL_MS = 15 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

interface ListCacheEntry {
  at: number;
  items?: RegistrarCompany[];
  failed?: boolean;
}

const listCache = new Map<string, ListCacheEntry>();

/**
 * Company lists are fetched once per adapter and reused across every IPO being resolved.
 *
 * The negative cache matters as much as the positive one: an unreachable registrar (bad cert,
 * a browser profile whose selectors no longer match) otherwise burns its full timeout again for
 * every single IPO, turning one slow adapter into minutes of dead wait per sweep.
 */
async function cachedCompanies(adapter: RegistrarAdapter): Promise<RegistrarCompany[]> {
  const cached = listCache.get(adapter.key);
  if (cached) {
    const ttl = cached.failed ? FAILURE_COOLDOWN_MS : LIST_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.items ?? [];
  }

  try {
    const items = await adapter.listCompanies();
    listCache.set(adapter.key, { at: Date.now(), items });
    return items;
  } catch (err) {
    log.warn(
      `${adapter.key}: company list failed, skipping for ${FAILURE_COOLDOWN_MS / 60000}m — ${(err as Error).message.split('\n')[0]}`,
    );
    listCache.set(adapter.key, { at: Date.now(), failed: true, items: [] });
    return [];
  }
}

/** Clears the cache so the next resolve re-probes every registrar. */
export function resetRegistrarCache(): void {
  listCache.clear();
}

function bestCompany(ipoName: string, companies: RegistrarCompany[]) {
  let best: { company: RegistrarCompany; score: number } | null = null;
  for (const company of companies) {
    const score = nameSimilarity(ipoName, company.name);
    if (!best || score > best.score) best = { company, score };
  }
  return best;
}

/**
 * Finds which registrar is handling an issue by searching every registrar's own dropdown for
 * the company name. This is the only approach that yields the registrar's internal company
 * code, which every allotment lookup requires.
 *
 * HTTP adapters are searched first and short-circuit on a strong match, so the expensive
 * browser-driven registrars are only opened when the cheap ones do not have the issue.
 */
export async function resolveRegistrar(
  ipoName: string,
  preferredKey?: string | null,
): Promise<RegistrarMatch | null> {
  const ordered = [...adapters].sort((a, b) => {
    if (preferredKey) {
      if (a.key === preferredKey) return -1;
      if (b.key === preferredKey) return 1;
    }
    if (a.driver !== b.driver) return a.driver === 'http' ? -1 : 1;
    return 0;
  });

  let best: RegistrarMatch | null = null;

  for (const adapter of ordered) {
    const companies = await cachedCompanies(adapter);
    if (companies.length === 0) continue;

    const hit = bestCompany(ipoName, companies);
    if (!hit || hit.score < MIN_CONFIDENCE) continue;

    const match: RegistrarMatch = {
      registrarKey: adapter.key,
      registrarName: adapter.name,
      companyCode: hit.company.code,
      companyName: hit.company.name,
      confidence: hit.score,
    };
    if (!best || match.confidence > best.confidence) best = match;

    // A near-exact name match is conclusive; stop before spinning up a browser registrar.
    if (match.confidence >= 0.85) break;
  }

  if (best) {
    log.info(
      `"${ipoName}" -> ${best.registrarKey} #${best.companyCode} ("${best.companyName}", ${best.confidence.toFixed(2)})`,
    );
  }
  return best;
}
