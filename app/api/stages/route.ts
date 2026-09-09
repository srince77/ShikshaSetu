/**
 * /api/stages — the caller's course-document index and create face.
 *
 * Every handler is owner-scoped: the owner resolves from the verified
 * session (`withOwnerId`) and is never a request parameter, and all reads
 * and writes go through the owner-bound document store, so a stage created
 * here is visible only to its creator.
 */
import { randomBytes } from 'node:crypto';

import { getOwnerScopedDocumentStore } from '@/lib/persistence/document-store-provider';
import { jsonError, parseJsonBody, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

const NAME_MAX_LENGTH = 200;

function createStageId(): string {
  return `stage-${randomBytes(9).toString('base64url')}`;
}

// GET /api/stages[?folderId=...] — list stages owned by the caller.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const folderId = url.searchParams.get('folderId') ?? undefined;
  return withOwnerId(req, async (ownerId) => {
    const store = getOwnerScopedDocumentStore(ownerId);
    const stages = await store.listDocuments(folderId);
    return Response.json({ stages });
  });
}

// POST /api/stages — create a stage shell { name, description? }.
export async function POST(req: Request): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (typeof body !== 'object' || body === null) {
    return jsonError('request body must be a JSON object', 400);
  }
  const { name, description } = body as { name?: unknown; description?: unknown };
  if (typeof name !== 'string' || name.trim() === '') {
    return jsonError('name is required', 400);
  }
  const trimmedName = name.trim();
  if (trimmedName.length > NAME_MAX_LENGTH) {
    return jsonError(`name exceeds the ${NAME_MAX_LENGTH} character limit`, 400);
  }
  if (description !== undefined && typeof description !== 'string') {
    return jsonError('description must be a string when present', 400);
  }
  const trimmedDescription = description?.trim();

  return withOwnerId(req, async (ownerId) => {
    const id = createStageId();
    const now = Date.now();
    const store = getOwnerScopedDocumentStore(ownerId);
    await store.saveDocument({
      stage: {
        id,
        name: trimmedName,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        createdAt: now,
        updatedAt: now,
      },
      scenes: [],
    });
    return Response.json(
      {
        stage: {
          id,
          name: trimmedName,
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          createdAt: now,
          updatedAt: now,
          sceneCount: 0,
        },
      },
      { status: 201 },
    );
  });
}
