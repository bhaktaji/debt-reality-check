/**
 * store/pseudonym.js
 * Pseudonymised user IDs (F-13).
 *
 * A raw channel ID (a WhatsApp JID contains a phone number) is NEVER stored. Every row
 * is keyed by HMAC-SHA256(rawId, serverSecret). The raw value is discarded after the
 * hash is computed, and the secret lives only in the environment, never in the repo.
 *
 * Note: pseudonymised data generally remains personal data. These controls reduce
 * exposure and breach impact; they do not create an exemption.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret-change-me';

export class MissingSecretError extends Error {
  constructor() {
    super(
      'PSEUDONYM_SECRET is not set. Set it in .env (see .env.example). ' +
        'A predictable secret weakens the pseudonymisation, so this is refused in production.',
    );
    this.name = 'MissingSecretError';
  }
}

/**
 * Resolve the server secret from the environment.
 * In production a real secret is mandatory. Outside production a clearly-labelled
 * development fallback is allowed so the demo and tests can run.
 */
export function resolveSecret(env = process.env) {
  const secret = env.PSEUDONYM_SECRET || env.DRC_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (env.NODE_ENV === 'production') throw new MissingSecretError();
  return DEV_FALLBACK_SECRET;
}

/** HMAC-SHA256 of the raw channel id, hex encoded, truncated to 32 chars. */
export function pseudonymise(rawId, secret = resolveSecret()) {
  if (rawId === null || rawId === undefined || rawId === '') {
    throw new Error('pseudonymise() needs a non-empty raw id');
  }
  return createHmac('sha256', secret).update(String(rawId)).digest('hex').slice(0, 32);
}

/** Constant-time comparison of two pseudonyms (for equality checks). */
export function sameId(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Strip anything that could carry PII out of a free-text expense description.
 * Used when descriptions are stored at all (opt-in); by default they are dropped.
 */
export function minimiseDescription(text, maxLength = 40) {
  if (!text) return null;
  const cleaned = String(text)
    .toLowerCase()
    .replace(/[0-9₹]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

export default { pseudonymise, resolveSecret, sameId, minimiseDescription, MissingSecretError };
