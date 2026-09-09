import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from './auth.js';
import { getStoredSummary, summaryHeadline } from '../services/allotment.js';
import { forceCheck } from '../jobs/allotmentWatcher.js';
import { ensureRegistrar } from '../services/allotment.js';
import { getRegistrar } from '../registrars/index.js';
import { CaptchaRequiredError } from '../registrars/types.js';
import { BSE_ROUTED_REGISTRARS } from '../sources/bse.js';
import { getIpo } from '../services/ipoStore.js';
import { logger } from '../util/logger.js';
import { todayIso } from '../util/parse.js';

const log = logger('api');

export const allotmentRouter = Router();
allotmentRouter.use(requireAuth);

/** Every IPO this account has results for, newest allotment date first. */
allotmentRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.boa_date, i.logo_url, i.category,
              COUNT(*)                                              AS total,
              SUM(CASE WHEN r.status = 'allotted' THEN 1 ELSE 0 END) AS allotted,
              SUM(COALESCE(r.allotted_qty, 0))                       AS shares,
              SUM(COALESCE(r.amount, 0))                             AS amount,
              MAX(r.checked_at)                                      AS checked_at
       FROM allotment_results r
       JOIN ipos i ON i.id = r.ipo_id
       WHERE r.account_id = ?
       GROUP BY i.id
       ORDER BY i.boa_date DESC`,
    )
    .all(req.accountId!) as Record<string, unknown>[];

  res.json(
    rows.map((r) => ({
      ipoId: r.id,
      ipoName: r.name,
      boaDate: r.boa_date,
      logoUrl: r.logo_url,
      category: r.category,
      totalAccounts: Number(r.total),
      allottedAccounts: Number(r.allotted),
      totalShares: Number(r.shares),
      totalAmount: Number(r.amount),
      checkedAt: r.checked_at,
    })),
  );
});

/** Last stored result for one IPO — instant, no registrar call. */
allotmentRouter.get('/:ipoId', (req, res) => {
  const summary = getStoredSummary(req.accountId!, req.params.ipoId);
  if (!summary) {
    const ipo = getIpo(req.params.ipoId);
    if (!ipo) {
      res.status(404).json({ error: 'IPO not found' });
      return;
    }
    res.json({ ipoId: ipo.id, ipoName: ipo.name, checked: false, results: [] });
    return;
  }
  res.json({ ...summary, checked: true, headline: summaryHeadline(summary) });
});

/**
 * Runs a live check of every saved PAN against the registrar. This is the "check now" button;
 * the background watcher does the same sweep automatically once results are published.
 */
allotmentRouter.post('/:ipoId/check', async (req, res) => {
  const ipo = getIpo(req.params.ipoId);
  if (!ipo) {
    res.status(404).json({ error: 'IPO not found' });
    return;
  }

  if (ipo.boa_date && todayIso() < ipo.boa_date) {
    res.status(409).json({
      error: `Allotment for ${ipo.name} is scheduled for ${ipo.boa_date}. We will check it automatically and notify you.`,
      boaDate: ipo.boa_date,
    });
    return;
  }

  const { panId, captchaToken, captchaAnswer } = (req.body ?? {}) as {
    panId?: string;
    captchaToken?: string;
    captchaAnswer?: string;
  };

  try {
    const summary = await forceCheck(req.accountId!, ipo.id, {
      panId,
      captcha: captchaToken && captchaAnswer ? { token: captchaToken, answer: captchaAnswer } : null,
    });
    res.json({ ...summary, checked: true, headline: summaryHeadline(summary) });
  } catch (err) {
    // 428 Precondition Required: the request was well formed, but the registrar will not
    // answer until a human reads its challenge. The image travels with the response so the
    // client can prompt immediately rather than making a second round trip for it.
    if (err instanceof CaptchaRequiredError) {
      res.status(428).json({
        error: err.message,
        needsCaptcha: true,
        captcha: err.challenge,
        registrar: ipo.registrar_key,
      });
      return;
    }
    log.error(`manual check failed: ${(err as Error).message}`);
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * Whether this IPO's registrar will demand a captcha, so the UI can warn before the user
 * presses check — and a fresh challenge to show if it will.
 */
allotmentRouter.get('/:ipoId/captcha', async (req, res) => {
  const ipo = getIpo(req.params.ipoId);
  if (!ipo) {
    res.status(404).json({ error: 'IPO not found' });
    return;
  }

  try {
    const withRegistrar = await ensureRegistrar(ipo);
    const adapter = getRegistrar(withRegistrar.registrar_key);
    // A BSE-routed registrar never prompts: its lookup runs on BSE with no captcha, so report
    // no challenge even though the registrar's own endpoint is gated.
    const routedToBse = adapter ? BSE_ROUTED_REGISTRARS.has(adapter.key) : false;
    if (!adapter?.needsCaptcha || routedToBse || !adapter.newCaptcha) {
      res.json({ needsCaptcha: false });
      return;
    }
    res.json({ needsCaptcha: true, registrar: adapter.name, captcha: await adapter.newCaptcha() });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
