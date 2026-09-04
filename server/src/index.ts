import os from 'node:os';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { db } from './db/index.js';
import { startJobs, runAllotmentWatch, runIpoSync } from './jobs/index.js';
import { closeBrowser } from './registrars/browser.js';
import { allotmentRouter } from './routes/allotment.js';
import { applicationsRouter } from './routes/applications.js';
import { hideIpo, listHiddenIpos, unhideIpo } from './services/ipoStore.js';
import { broadcast } from './services/notify.js';
import { appVersionRouter } from './routes/appVersion.js';
import { authRouter } from './routes/auth.js';
import { iposRouter } from './routes/ipos.js';
import { mediaRouter } from './routes/media.js';
import { notificationsRouter, watchlistRouter } from './routes/notifications.js';
import { pansRouter } from './routes/pans.js';
import { logger } from './util/logger.js';

const log = logger('server');
const app = express();

// Behind a reverse proxy this is what makes req.ip the real client, which the auth
// rate limiter depends on.
app.set('trust proxy', 1);

app.use(
  helmet({
    // The API serves JSON and proxied images, never HTML, so the default CSP is unnecessary
    // and crossOriginResourcePolicy would block the web app from loading logo thumbnails.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(compression());
app.use(
  cors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  const ipos = db.prepare('SELECT COUNT(*) AS n FROM ipos').get() as { n: number };
  res.json({ ok: true, ipos: ipos.n, time: new Date().toISOString() });
});

app.use('/api/app', appVersionRouter);
app.use('/api/auth', authRouter);
app.use('/api/ipos', iposRouter);
app.use('/api/media', mediaRouter);
app.use('/api/pans', pansRouter);
app.use('/api/allotment', allotmentRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/watchlist', watchlistRouter);

/** Shared secret guard for the admin routes. 404 rather than 401, so their existence is not advertised. */
function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (!config.adminToken || req.header('x-admin-token') !== config.adminToken) {
    res.status(404).json({ error: 'Not found' });
    return false;
  }
  return true;
}

/**
 * Issues kept out of every list. Keyed on the upstream ig_id, so a hide survives the row
 * being re-synced from InvestorGain rather than quietly reappearing a few hours later.
 */
app.get('/api/admin/hidden', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(listHiddenIpos());
});

app.post('/api/admin/hidden/:igId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const igId = Number(req.params.igId);
  if (!Number.isInteger(igId)) {
    res.status(400).json({ error: 'igId must be a number' });
    return;
  }
  hideIpo(igId, typeof req.body?.name === 'string' ? req.body.name : undefined);
  res.json({ ok: true, hidden: listHiddenIpos() });
});

app.delete('/api/admin/hidden/:igId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const removed = unhideIpo(Number(req.params.igId));
  res.json({ ok: removed, hidden: listHiddenIpos() });
});

/**
 * One message to every user, in-app and by push.
 *
 * Declared above the `/api/admin/:job` catch-all, which would otherwise match this path.
 *
 * This is the only route in the API that writes to every account at once and it cannot be
 * recalled, so it is deliberately awkward: `dryRun: true` reports the reach without sending,
 * and `dedupeKey` makes a retry after a timeout safe instead of doubling the blast.
 */
app.post('/api/admin/broadcast', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { title, body, data, dedupeKey, dryRun } = (req.body ?? {}) as {
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
    dedupeKey?: string;
    dryRun?: boolean;
  };

  if (typeof title !== 'string' || title.trim().length === 0 || title.length > 100) {
    res.status(400).json({ error: 'title is required (1-100 characters)' });
    return;
  }
  if (typeof body !== 'string' || body.trim().length === 0 || body.length > 500) {
    res.status(400).json({ error: 'body is required (1-500 characters)' });
    return;
  }

  try {
    const result = await broadcast({
      title: title.trim(),
      body: body.trim(),
      data,
      dedupeKey: typeof dedupeKey === 'string' ? dedupeKey : undefined,
      dryRun: dryRun === true,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error(`broadcast failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Manual job triggers for an external scheduler. Guarded by a shared secret so they cannot be
 * used to hammer the registrars from the open internet; disabled entirely when unset.
 */
app.post('/api/admin/:job', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const jobs: Record<string, () => Promise<void>> = {
    sync: runIpoSync,
    'watch-allotments': runAllotmentWatch,
  };
  const job = jobs[req.params.job];
  if (!job) {
    res.status(404).json({ error: 'Unknown job' });
    return;
  }

  await job();
  res.json({ ok: true });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error(`unhandled: ${err.message}`, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

/** Every non-internal IPv4 address, so the console shows the URL other devices should use. */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((ifaces) => ifaces ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// Binding 0.0.0.0 rather than the default is what lets phones on the same Wi-Fi reach the API.
const server = app.listen(config.port, '0.0.0.0', () => {
  log.info(`API listening on http://localhost:${config.port}`);
  for (const address of lanAddresses()) {
    log.info(`            also on http://${address}:${config.port}`);
  }
  startJobs();
});

/**
 * The port has to stay fixed — the mobile app and any built APK point at it — so a clash is a
 * real failure rather than something to auto-shift away from. Node's default here is an
 * unhandled 'error' event and a raw stack trace, which says nothing about how to recover.
 */
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error(
      `port ${config.port} is already in use — another copy of the API is still running.\n` +
        `  Find it:  npx kill-port ${config.port}\n` +
        `  Windows:  netstat -ano | findstr :${config.port}   then   taskkill /PID <pid> /F\n` +
        `  Or run this one on a different port:  PORT=4001 npm run dev -w server`,
    );
  } else if (err.code === 'EACCES') {
    log.error(`not allowed to bind port ${config.port}. Ports below 1024 need elevated rights.`);
  } else {
    log.error(`server failed to start: ${err.message}`);
  }
  process.exit(1);
});

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`);
  server.close();
  await closeBrowser();
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
