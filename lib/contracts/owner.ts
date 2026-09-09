/**
 * Resolves the identity a request is acting as. Agent A's real session
 * verification supplies `authenticatedOwnerId`; every route downstream
 * treats the returned string as an opaque, already-correct owner id, it
 * never re-derives identity itself.
 *
 * SESSION_DEV_BYPASS lets Agents B and C build against a real ownerId shape
 * before Agent A's auth lands, without either of them reimplementing auth.
 */
export function resolveOwnerId(authenticatedOwnerId?: string): string {
  if (authenticatedOwnerId) return authenticatedOwnerId;
  if (process.env.SESSION_DEV_BYPASS === 'true') return 'dev:local';
  throw new Error('no authenticated owner and SESSION_DEV_BYPASS is not set');
}
