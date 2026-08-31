import type { NextFunction, Request, Response } from 'express';

/**
 * In-memory response cache for endpoints whose output is identical for every user.
 *
 * The dashboard, the IPO list and the GMP board are the same bytes for all 100,000 users, yet
 * without this each request re-runs the same SQLite queries and re-serialises the same JSON.
 * At a few thousand concurrent readers that is pure waste; cached, the database is barely
 * touched and the hot path is a Map lookup.
 *
 * A short TTL rather than explicit invalidation on sync: the underlying data changes only when
 * a cron job runs (every few minutes), so a 30-second window is never meaningfully stale and
 * needs no coordination with the writers.
 */
interface Entry {
  body: string;
  expires: number;
}

const store = new Map<string, Entry>();

// Bounded so a flood of distinct query strings cannot grow the map without limit. The hot
// endpoints have a tiny key space (a handful of URLs), so this is only a safety valve.
const MAX_ENTRIES = 2000;

/**
 * Caches the JSON body of a GET response, keyed by its full URL, for `ttlSeconds`.
 * Apply only to routes that do not vary by user — never to anything behind requireAuth.
 */
export function cacheGet(ttlSeconds: number) {
  const ttlMs = ttlSeconds * 1000;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    const key = req.originalUrl;
    const hit = store.get(key);
    const now = Date.now();

    if (hit && hit.expires > now) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Cache', 'HIT');
      res.send(hit.body);
      return;
    }

    // Wrap res.json so the route stays oblivious to caching — it just returns data as usual.
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      // Only a success is worth caching; an error should be retried, not pinned for 30s.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
        store.set(key, { body: JSON.stringify(body), expires: now + ttlMs });
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

/** Drops everything cached. Called after a sync so fresh data is not held back by a stale window. */
export function clearResponseCache(): void {
  store.clear();
}
