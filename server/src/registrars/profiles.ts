import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import type { BrowserProfile } from './browserAdapter.js';

const log = logger('registrar');

/**
 * Selector profiles for registrars that still need a real browser.
 *
 * Everything else now has a dedicated HTTP adapter — see `index.ts`. Cameo is the only
 * registrar left here, and it cannot actually be automated: its form enforces an image
 * captcha (`txt_phy_captcha`) that a browser can type into but not read. The profile is kept
 * so the registrar is still recognised and reported as unsupported rather than unknown.
 *
 * Override any field without touching this file by dropping a `registrar-profiles.json` into
 * DATA_DIR, keyed by registrar. `npm run registrartest -w server` exercises the HTTP adapters
 * against the live sites.
 */
const DEFAULTS: Record<string, BrowserProfile> = {
};

function loadOverrides(): Record<string, Partial<BrowserProfile>> {
  const file = path.join(config.dataDir, 'registrar-profiles.json');
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Partial<BrowserProfile>>;
    log.info(`applied selector overrides for: ${Object.keys(parsed).join(', ') || 'nothing'}`);
    return parsed;
  } catch (err) {
    log.warn(`ignoring malformed registrar-profiles.json: ${(err as Error).message}`);
    return {};
  }
}

export function browserProfiles(): BrowserProfile[] {
  const overrides = loadOverrides();
  return Object.values(DEFAULTS).map((base) => ({ ...base, ...(overrides[base.key] ?? {}) }));
}
