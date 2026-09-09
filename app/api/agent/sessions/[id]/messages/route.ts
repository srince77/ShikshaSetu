/** POST /api/agent/sessions/[id]/messages — post a user message { message }. */
import { getAgentSessionStore } from '@/lib/persistence/agent-session-store-provider';
import { jsonError, parseJsonBody, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

const MESSAGE_MAX_LENGTH = 20_000;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { message?: unknown } | null;
  if (typeof body !== 'object' || body === null || typeof body.message !== 'string' || body.message.trim() === '') {
    return jsonError('message is required', 400);
  }
  if (body.message.length > MESSAGE_MAX_LENGTH) {
    return jsonError(`message exceeds the ${MESSAGE_MAX_LENGTH} character limit`, 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    const store = getAgentSessionStore();
    const session = await store.getSession(id);
    if (!session || session.ownerId !== ownerId) return jsonError('not found', 404);
    const result = await store.postUserMessage(id, body.message as string);
    return Response.json(result);
  });
}
