import { Router } from 'express';
import { request } from '../util/http.js';
import { logger } from '../util/logger.js';

const log = logger('media');

export const mediaRouter = Router();

/**
 * Upstream blocks hotlinked images by Referer, so the browser gets nothing when it requests a
 * logo directly. Proxying lets the server send the Referer the CDN expects, and keeps the
 * origin host out of the page.
 */
const ALLOWED_HOSTS = new Set(['www.chittorgarh.net', 'chittorgarh.net', 'www.investorgain.com']);

/** Small in-process cache — logos are static and the same handful repeat on every page load. */
const cache = new Map<string, { body: Buffer; type: string; at: number }>();
const CACHE_TTL_MS = 12 * 3600_000;
const MAX_ENTRIES = 300;

/**
 * Upstream logos are full-size PNGs (300KB+) for what renders as a 38px tile, which is a lot of
 * mobile data for decoration. sharp shrinks them to a webp thumbnail when available; the proxy
 * still works without it, just heavier, so a failed optional install is not fatal.
 */
type Resizer = (input: Buffer) => Promise<{ body: Buffer; type: string }>;

const resizer: Promise<Resizer | null> = import('sharp')
  .then(({ default: sharp }): Resizer => async (input) => ({
    body: await sharp(input).resize(96, 96, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
    type: 'image/webp',
  }))
  .catch(() => {
    log.warn('sharp not installed — serving logos at full size');
    return null;
  });

mediaRouter.get('/logo', async (req, res) => {
  const raw = String(req.query.u ?? '');
  if (!raw) {
    res.status(400).json({ error: 'Missing u' });
    return;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  // Host allowlist keeps this from becoming an open proxy / SSRF vector.
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    res.status(403).json({ error: 'Host not allowed' });
    return;
  }

  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.setHeader('Content-Type', hit.type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(hit.body);
    return;
  }

  try {
    const upstream = await request(key, {
      headers: { Referer: 'https://www.investorgain.com/', Accept: 'image/*' },
      timeoutMs: 12_000,
      retries: 1,
    });

    if (!upstream.ok) {
      res.status(404).end();
      return;
    }

    const upstreamType = upstream.headers.get('content-type') ?? 'image/png';
    if (!upstreamType.startsWith('image/')) {
      res.status(415).end();
      return;
    }

    const original = Buffer.from(await upstream.arrayBuffer());
    const shrink = await resizer;

    // A logo we cannot decode is still worth serving as-is rather than showing nothing.
    const { body, type } = shrink
      ? await shrink(original).catch(() => ({ body: original, type: upstreamType }))
      : { body: original, type: upstreamType };

    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(key, { body, type, at: Date.now() });

    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(body);
  } catch (err) {
    log.debug(`logo proxy failed for ${key}: ${(err as Error).message}`);
    res.status(404).end();
  }
});
