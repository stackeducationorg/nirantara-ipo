import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { refreshStatuses, syncIpos, syncSubscriptions } from '../services/ipoStore.js';
import { clearResponseCache } from '../util/cache.js';
import { watchAllotments } from './allotmentWatcher.js';
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
  clearResponseCache();
  await runGmpAlerts(gmpChanges);
});

export const runGmpSync = serialise('gmp-sync', async () => {
  const { gmpChanges } = await syncIpos();
  clearResponseCache();
  await runGmpAlerts(gmpChanges);
});

export const runAllotmentWatch = serialise('allotment-watch', watchAllotments);
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
