/** GET /api/auth/me — the caller's own account, or 401 when signed out. */
import { requireAuthenticatedUserId } from '@/lib/auth/session';
import { findUserById } from '@/lib/auth/users';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const userId = await requireAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: 'not signed in' }, { status: 401 });
  const user = await findUserById(userId);
  if (!user) return Response.json({ error: 'not signed in' }, { status: 401 });
  return Response.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
}
