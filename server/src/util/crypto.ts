import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';

/** Encrypts a PAN for storage. Output layout: iv(12) | authTag(16) | ciphertext, base64. */
export function encryptPan(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, config.encryptionKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptPan(stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const decipher = crypto.createDecipheriv(ALGO, config.encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/**
 * Deterministic hash used only for uniqueness checks — encryption uses a random IV, so two
 * rows holding the same PAN produce different ciphertext and cannot be compared directly.
 */
export function hashPan(pan: string): string {
  return crypto.createHmac('sha256', config.encryptionKey).update(pan.toUpperCase()).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const SCRYPT_KEYLEN = 64;
// N=16384 is the interactive-login baseline; raising it slows every sign-in linearly.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Password hashing via scrypt, which ships with Node — no native build step, and memory-hard
 * against GPU cracking. Format: scrypt$N$r$p$salt$hash.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });

  // Constant-time compare so a wrong password cannot be narrowed down by timing.
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/** Human-friendly sync key (e.g. NRTH-4F2A-9K1D-XQ7B) used to pair a second device. */
export function generateSyncKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const group = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `NRTH-${group()}-${group()}-${group()}`;
}
