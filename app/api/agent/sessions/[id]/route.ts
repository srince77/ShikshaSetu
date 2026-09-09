/**
 * GET /api/agent/sessions/[id] — one owned session's lifecycle state.
 * A foreign-owned or never-existed id answers the identical 404.
 */
import { getAgentSessionStore } from '@/lib/persistence/agent-session-store-provider';
import { jsonError, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    const session = await getAgentSessionStore().getSession(id);
    if (!session || session.ownerId !== ownerId) return jsonError('not found', 404);
    return Response.json({ session });
  });
}
