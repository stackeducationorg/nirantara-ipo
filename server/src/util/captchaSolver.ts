import SolveCaptcha from 'solvecaptcha-javascript';
import { config } from '../config.js';
import { logger } from './logger.js';

const log = logger('captcha-solver');

/**
 * Optional automatic captcha solving via SolveCaptcha (solvecaptcha.com).
 *
 * Bigshare and Cameo gate their *public, unauthenticated* allotment lookup behind an image
 * captcha — a lookup any person can run for any PAN with no login. Answering that image
 * through a solving service is how comparable apps automate the same public self-service
 * check, so a user's own allotments resolve without them typing a code.
 *
 * Entirely opt-in: with no CAPTCHA_SOLVER_API_KEY set, `solveEnabled()` is false and the app
 * falls back to showing the challenge to the user. Uses the vendor's own client, so its exact
 * submit/poll protocol is handled for us.
 */
let solver: InstanceType<typeof SolveCaptcha.Solver> | null = null;

function client(): InstanceType<typeof SolveCaptcha.Solver> | null {
  if (!config.captcha.solverApiKey) return null;
  if (!solver) solver = new SolveCaptcha.Solver(config.captcha.solverApiKey);
  return solver;
}

export function solveEnabled(): boolean {
  return Boolean(config.captcha.solverApiKey);
}

interface SolveResult {
  ok: boolean;
  answer?: string;
  error?: string;
}

/**
 * Sends a base64 image captcha to the service and returns the recognised text.
 * `image` may be a raw base64 string or a data: URI — the prefix is stripped.
 */
export async function solveImageCaptcha(image: string): Promise<SolveResult> {
  const c = client();
  if (!c) return { ok: false, error: 'no solver configured' };

  const body = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;

  try {
    // The SDK submits to the service and polls until the workers return an answer.
    const res = await c.imageCaptcha({ body });
    const answer = typeof res === 'string' ? res : res?.data;
    if (!answer) return { ok: false, error: 'solver returned no text' };
    return { ok: true, answer: String(answer) };
  } catch (err) {
    log.warn(`solve failed: ${(err as Error).message.split('\n')[0].slice(0, 120)}`);
    return { ok: false, error: (err as Error).message.slice(0, 100) };
  }
}

/** Remaining balance on the solving account, for an admin/health check. Null if unconfigured. */
export async function solverBalance(): Promise<number | null> {
  const c = client();
  if (!c) return null;
  try {
    return await c.balance();
  } catch {
    return null;
  }
}
