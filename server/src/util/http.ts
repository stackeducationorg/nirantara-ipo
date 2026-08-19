export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface FetchOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  retries?: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a timeout, a browser-ish UA, and exponential backoff on 5xx / network errors. */
export async function request(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 20_000, retries = 2, headers, ...rest } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...rest,
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-IN,en;q=0.9', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Only retry on server-side faults; 4xx is a real answer and retrying will not help.
      if (res.status >= 500 && attempt < retries) {
        lastErr = new HttpError(`HTTP ${res.status} from ${url}`, res.status);
        await sleep(500 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`request failed: ${url}`);
}

export async function getJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await request(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${url}`, res.status, text.slice(0, 400));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`Expected JSON from ${url}`, res.status, text.slice(0, 400));
  }
}

export async function getText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await request(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${url}`, res.status, text.slice(0, 400));
  return text;
}

export async function postJson<T>(url: string, body: unknown, opts: FetchOptions = {}): Promise<T> {
  return getJson<T>(url, {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...opts.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Runs tasks with bounded concurrency so we never hammer a registrar with N parallel PANs. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
