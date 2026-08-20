import { Router } from 'express';
import { config } from '../config.js';

/**
 * Tells the mobile app which versions are still allowed to run.
 *
 * Deliberately unauthenticated: a client that is too old to be trusted with the API is
 * exactly the client that needs this answer, and it may not be able to sign in at all.
 */
export const appVersionRouter = Router();

appVersionRouter.get('/version', (_req, res) => {
  res.json({
    /** Anything below this must update before it can be used. */
    minVersion: config.app.minVersion,
    /** The newest build available; used to offer an optional update. */
    latestVersion: config.app.latestVersion,
    downloadUrl: config.app.downloadUrl,
    message: config.app.updateMessage,
  });
});
