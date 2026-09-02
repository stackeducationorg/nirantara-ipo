import { config } from '../config.js';
import { logger } from './logger.js';

const log = logger('captcha-solver');

/**
 * Optional automatic captcha solving via a third-party solving service.
 *
 * Some registrars (Bigshare, Cameo) gate their *public, unauthenticated* allotment lookup
 * behind an image captcha — a lookup any person can run for any PAN with no login. Solving it
 * through a service API is how comparable apps automate the same public self-service check, so
 * the user's own allotments resolve without them typing a code.
 *
 * This is entirely opt-in. With no CAPTCHA_SOLVER_API_KEY set, `solveEnabled()` is false and
 * the app falls back to showing the challenge to the user. The provider is 2captcha-compatible
 * (2captcha, anti-captcha-style `in.php`/`res.php`), configurable so the operator can point it
 * at whichever service they hold an account with.
 */
export function solveEnabled(): boolean {
  return Boolean(config.captcha.solverApiKey);
}

interface SolveResult {
  ok: boolean;
  answer?: string;
  error?: string;
}

/**
 * Sends a base64 image captcha to the solving service and returns the text.
 * `image` may be a raw base64 string or a data: URI — the prefix is stripped.
 */
export async function solveImageCaptcha(image: string): Promise<SolveResult> {
  const key = config.captcha.solverApiKey;
  if (!key) return { ok: false, error: 'no solver configured' };

  const base64 = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const base = config.captcha.solverUrl.replace(/\/$/, '');

  try {
    // Submit. The 2captcha protocol answers "OK|<id>" on success, "ERROR_..." otherwise.
    const submit = await fetch(`${base}/in.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key, method: 'base64', body: base64, json: '0' }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const submitText = (await submit.text()).trim();
    if (!submitText.startsWith('OK|')) {
      return { ok: false, error: `submit rejected: ${submitText.slice(0, 60)}` };
    }
    const id = submitText.slice(3);

    // Poll for the answer. These services take a few seconds; give it up to ~40s.
    const started = Date.now();
    while (Date.now() - started < 40_000) {
      await new Promise((r) => setTimeout(r, 5_000));
      const poll = await fetch(
        `${base}/res.php?${new URLSearchParams({ key, action: 'get', id, json: '0' })}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const pollText = (await poll.text()).trim();
      if (pollText === 'CAPCHA_NOT_READY') continue;
      if (pollText.startsWith('OK|')) return { ok: true, answer: pollText.slice(3) };
      return { ok: false, error: `solve failed: ${pollText.slice(0, 60)}` };
    }
    return { ok: false, error: 'solver timed out' };
  } catch (err) {
    log.warn(`solver error: ${(err as Error).message.split('\n')[0]}`);
    return { ok: false, error: (err as Error).message.slice(0, 80) };
  }
}
