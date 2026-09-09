/**
 * Small shared helpers for the `app/api/stages`, `app/api/stage-meta`, and
 * `app/api/agent/sessions` route handlers: uniform JSON error bodies, and
 * the one place a route decides "is anyone signed in at all". Ownership of
 * a *specific* resource ("is this yours") is a separate, later question —
 * see `lib/persistence/document-access.ts` — because a foreign-owned or
 * never-existed resource id must answer identically (no existence oracle).
 */
import { resolveSession } from '@/lib/auth/session';

export function jsonError(message: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error: message }, { status, headers });
}

export async function parseJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, response: jsonError('invalid JSON body', 400) };
  }
}

/**
 * Resolve the caller's ownerId from the session cookie (or
 * `SESSION_DEV_BYPASS`) and invoke `handler`. Answers 401 uniformly when no
 * session and no dev bypass is available.
 */
export async function withOwnerId(
  req: Pick<Request, 'headers'>,
  handler: (ownerId: string) => Promise<Response>,
): Promise<Response> {
  let ownerId: string;
  try {
    ownerId = await resolveSession(req);
  } catch {
    return jsonError('authentication required', 401);
  }
  return handler(ownerId);
}
