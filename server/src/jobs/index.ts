import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { refreshStatuses, syncIpos, syncSubscriptions } from '../services/ipoStore.js';
import { syncNseSymbols } from '../services/nseSymbols.js';
import { clearResponseCache } from '../util/cache.js';
import { watchAllotments } from './allotmentWatcher.js';
import { resolveRegistrars } from './registrarResolver.js';
import { runGmpAlerts, runLifecycleAlerts } from './lifecycle.js';

const log = logger('jobs');

/** Prevents a slow run (browser registrars especially) from overlapping with the next tick. */
function serialise(name: string, task: () => Promise<void>) {
  let running = false;
  return async () => {
    if (running) {
      log.warn(`${name} is still running — skipping this tick`);
      return;
    }
    running = true;
    const started = Date.now();
    try {
      await task();
      log.debug(`${name} finished in ${Date.now() - started}ms`);
    } catch (err) {
      log.error(`${name} failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
}

export const runIpoSync = serialise('ipo-sync', async () => {
  const { gmpChanges } = await syncIpos();
  refreshStatuses();
  await syncSubscriptions().catch((err) => log.warn(`subscription sync failed: ${err.message}`));
  // Best-effort: NSE being unreachable must not cost us the IPO sync that just succeeded.
  await syncNseSymbols().catch((err) => log.warn(`NSE symbol sync failed: ${err.message}`));
  // Straight after the sync, while every newly ingested issue is still inside its registrar's
  // dropdown window. Left until allotment day this mapping is often no longer obtainable.
  await resolveRegistrars().catch((err) => log.warn(`registrar resolve failed: ${err.message}`));
  clearResponseCache();
  await runGmpAlerts(gmpChanges);
});

export const runGmpSync = serialise('gmp-sync', async () => {
  const { gmpChanges } = await syncIpos();
  clearResponseCache();
  await runGmpAlerts(gmpChanges);
});

export const runAllotmentWatch = serialise('allotment-watch', watchAllotments);
export const runRegistrarResolve = serialise('registrar-resolve', resolveRegistrars);
export const runLifecycle = serialise('lifecycle', runLifecycleAlerts);

export function startJobs(): void {
  if (!config.enableJobs) {
    log.warn('background jobs disabled (ENABLE_JOBS=false)');
    return;
  }

  cron.schedule(config.ipoSyncCron, runIpoSync);
  cron.schedule(config.gmpSyncCron, runGmpSync);
  cron.schedule(config.allotmentPollCron, runAllotmentWatch);
  cron.schedule(config.lifecycleCron, runLifecycle);

  log.info(
    `scheduled — ipo:"${config.ipoSyncCron}" gmp:"${config.gmpSyncCron}" ` +
      `allotment:"${config.allotmentPollCron}" lifecycle:"${config.lifecycleCron}"`,
  );

  // Warm the database on boot so a fresh install is not empty until the first cron tick.
  void runIpoSync().then(() => runLifecycle());
}
