/** GET /api/agent/sessions/[id]/events?after=N — the event log tail for one owned session. */
import { getAgentSessionStore } from '@/lib/persistence/agent-session-store-provider';
import { jsonError, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const url = new URL(req.url);
  const afterParam = url.searchParams.get('after') ?? '0';
  const after = Number(afterParam);
  if (!Number.isInteger(after) || after < 0) {
    return jsonError('`after` must be a non-negative integer', 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    const store = getAgentSessionStore();
    const session = await store.getSession(id);
    if (!session || session.ownerId !== ownerId) return jsonError('not found', 404);
    const events = await store.readEventsAfter(id, after);
    return Response.json({ events });
  });
}
