/**
 * Password hashing for v1 email + password auth. Argon2id (node-argon2's
 * default) with library defaults for cost parameters — this is a fresh,
 * low-traffic deployment, not a place that needs hand-tuned memory/time
 * costs, and argon2's defaults are already conservative.
 *
 * No email verification, no OAuth, no password reset flow in v1 — an
 * explicit product decision to keep auth simple, not a shortcut.
 */
import argon2 from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A hash from a different/older scheme, or a corrupt stored value, must
    // fail closed rather than throw past the login route.
    return false;
  }
}
