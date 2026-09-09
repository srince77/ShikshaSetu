/**
 * /api/agent/sessions — lifecycle CRUD only (create/list). Turn-by-turn
 * orchestration is `lib/orchestration/session-runner.ts`'s job; this route
 * only ever calls the persistence-level `AgentSessionStore`.
 */
import { randomBytes } from 'node:crypto';

import { getAgentSessionStore } from '@/lib/persistence/agent-session-store-provider';
import { jsonError, parseJsonBody, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

const PROMPT_MAX_LENGTH = 20_000;

function createStageId(): string {
  return `stage-${randomBytes(9).toString('base64url')}`;
}

// GET /api/agent/sessions — list the caller's own sessions.
export async function GET(req: Request): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const sessions = await getAgentSessionStore().listSessionsByOwner(ownerId);
    return Response.json({ sessions });
  });
}

// POST /api/agent/sessions — create a session { prompt, stageId? }.
export async function POST(req: Request): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { prompt?: unknown; stageId?: unknown } | null;
  if (typeof body !== 'object' || body === null || typeof body.prompt !== 'string' || body.prompt.trim() === '') {
    return jsonError('prompt is required', 400);
  }
  if (body.prompt.length > PROMPT_MAX_LENGTH) {
    return jsonError(`prompt exceeds the ${PROMPT_MAX_LENGTH} character limit`, 400);
  }
  if (body.stageId !== undefined && typeof body.stageId !== 'string') {
    return jsonError('stageId must be a string when present', 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const session = await getAgentSessionStore().createSession({
      ownerId,
      prompt: body.prompt as string,
      stageId: (body.stageId as string | undefined) ?? createStageId(),
    });
    return Response.json({ session }, { status: 201 });
  });
}
