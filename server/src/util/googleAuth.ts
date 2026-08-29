import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';

/**
 * Verification of Google's ID token happens here rather than in the browser, because the
 * browser is the untrusted party: anything it sends can be forged. The library checks the
 * JWT signature against Google's rotating public keys, the issuer, the expiry, and — most
 * importantly — that the token was minted for *our* client id. Without the audience check,
 * a token issued to any other Google app would be accepted as a valid login here.
 */
const client = new OAuth2Client();

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export class GoogleAuthError extends Error {}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  // Any client we issue tokens for is acceptable; the check is that it is one of *ours*,
  // not that it is a specific one. Without the native ids listed, sign-ins from the app
  // fail verification even though the token is perfectly valid.
  const audience = [
    config.googleClientId,
    config.googleAndroidClientId,
    config.googleIosClientId,
  ].filter((v): v is string => Boolean(v));

  if (audience.length === 0) {
    throw new GoogleAuthError('Google sign-in is not configured on this server');
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (err) {
    // The message from the library can name the expected audience, so it is not passed on.
    throw new GoogleAuthError(`Google token rejected: ${(err as Error).message.slice(0, 120)}`);
  }

  if (!payload?.sub) throw new GoogleAuthError('Google token contained no user id');
  if (!payload.email) throw new GoogleAuthError('Google token contained no email address');

  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: payload.name?.trim() || null,
    picture: payload.picture ?? null,
  };
}
