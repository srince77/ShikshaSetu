/**
 * Signed httpOnly session cookie -> user id, backed by the `auth_sessions`
 * table (migration 0005_auth.sql).
 *
 * Cookie shape: `${sessionRowId}.${rawToken}`. `rawToken` is 256 bits of
 * random entropy; the row stores only `HMAC-SHA256(SESSION_SECRET, rawToken)`,
 * never the token itself, so a database leak alone cannot mint a valid
 * cookie and a `SESSION_SECRET` rotation invalidates every outstanding
 * session at once. `sessionRowId` is not secret — it is just the lookup key.
 *
 * `resolveSession` is the one seam every route call through: it verifies the
 * cookie and resolves the real, opaque `ownerId` by calling `resolveOwnerId`
 * from the frozen `lib/contracts/owner.ts` with the authenticated user id.
 * When no valid cookie is present it falls through to that same function's
 * `SESSION_DEV_BYPASS` handling, so it throws under the same conditions
 * `resolveOwnerId` does.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { getPool } from '@/db/client';
import { resolveOwnerId } from '@/lib/contracts/owner';

export const SESSION_COOKIE_NAME = 'shikshasetu_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

function signToken(rawToken: string): string {
  return createHmac('sha256', sessionSecret()).update(rawToken).digest('hex');
}

export interface CreatedAuthSession {
  cookieValue: string;
  expiresAt: Date;
}

/** Mint a new session row for `userId` and the cookie value that names it. */
export async function createAuthSession(userId: string): Promise<CreatedAuthSession> {
  const id = randomUUID();
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = signToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getPool().query(
    `INSERT INTO auth_sessions (id, user_id, session_token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [id, userId, tokenHash, expiresAt],
  );
  return { cookieValue: `${id}.${rawToken}`, expiresAt };
}

function cookieAttributes(extra: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}; ${extra}`;
}

/** The `Set-Cookie` value for a freshly created session. */
export function sessionCookieHeader(session: CreatedAuthSession): string {
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}; ${cookieAttributes(
    `Expires=${session.expiresAt.toUTCString()}`,
  )}`;
}

/** The `Set-Cookie` value that clears the session cookie on logout. */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes('Max-Age=0')}`;
}

function readCookie(headers: Headers, name: string): string | undefined {
  const encoded = headers.get('cookie');
  if (!encoded) return undefined;
  for (const item of encoded.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseCookieValue(cookieValue: string): { id: string; rawToken: string } | undefined {
  const separator = cookieValue.indexOf('.');
  if (separator < 0) return undefined;
  const id = cookieValue.slice(0, separator);
  const rawToken = cookieValue.slice(separator + 1);
  if (!id || !rawToken) return undefined;
  return { id, rawToken };
}

/** Verify a raw cookie value against the store; returns the user id or undefined. */
async function verifySessionCookie(cookieValue: string): Promise<string | undefined> {
  const parsed = parseCookieValue(cookieValue);
  if (!parsed) return undefined;
  const expectedHash = Buffer.from(signToken(parsed.rawToken), 'hex');

  const result = await getPool().query<{ user_id: string; session_token_hash: string }>(
    `SELECT user_id, session_token_hash
       FROM auth_sessions
      WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [parsed.id],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const storedHash = Buffer.from(row.session_token_hash, 'hex');
  if (storedHash.length !== expectedHash.length || !timingSafeEqual(storedHash, expectedHash)) {
    return undefined;
  }
  return row.user_id;
}

/** Revoke the session named by a raw cookie value (logout). Idempotent. */
export async function revokeAuthSession(cookieValue: string | undefined): Promise<void> {
  const parsed = cookieValue ? parseCookieValue(cookieValue) : undefined;
  if (!parsed) return;
  await getPool().query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1`, [parsed.id]);
}

/**
 * Verify the session cookie on `req` and resolve the real, opaque ownerId.
 * Every route downstream treats the result exactly like `resolveOwnerId`'s
 * other callers do — it never re-derives identity itself.
 *
 * Throws when there is no valid session and `SESSION_DEV_BYPASS` is not set
 * (the same failure mode `resolveOwnerId` has); route handlers should catch
 * this and answer 401.
 */
export async function resolveSession(req: Pick<Request, 'headers'>): Promise<string> {
  const cookieValue = readCookie(req.headers, SESSION_COOKIE_NAME);
  const userId = cookieValue ? await verifySessionCookie(cookieValue) : undefined;
  return resolveOwnerId(userId ? `user:${userId}` : undefined);
}

/** Read the verified user id from a session cookie, without the dev-bypass fallback. */
export async function requireAuthenticatedUserId(
  req: Pick<Request, 'headers'>,
): Promise<string | undefined> {
  const cookieValue = readCookie(req.headers, SESSION_COOKIE_NAME);
  return cookieValue ? verifySessionCookie(cookieValue) : undefined;
}
