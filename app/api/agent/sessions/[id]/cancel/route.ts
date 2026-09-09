/** POST /api/agent/sessions/[id]/cancel — request cancellation of an owned session. */
import { getAgentSessionStore } from '@/lib/persistence/agent-session-store-provider';
import { jsonError, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    const store = getAgentSessionStore();
    const session = await store.getSession(id);
    if (!session || session.ownerId !== ownerId) return jsonError('not found', 404);
    await store.requestCancel(id);
    return Response.json({ ok: true });
  });
}
