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

app.use('/api/auth', authRouter);
app.use('/api/ipos', iposRouter);
app.use('/api/media', mediaRouter);
app.use('/api/pans', pansRouter);
app.use('/api/allotment', allotmentRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/watchlist', watchlistRouter);

/**
 * Manual job triggers for an external scheduler. Guarded by a shared secret so they cannot be
 * used to hammer the registrars from the open internet; disabled entirely when unset.
 */
app.post('/api/admin/:job', async (req, res) => {
  if (!config.adminToken || req.header('x-admin-token') !== config.adminToken) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

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
