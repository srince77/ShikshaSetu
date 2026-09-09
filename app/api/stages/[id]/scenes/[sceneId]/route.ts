/**
 * /api/stages/[id]/scenes/[sceneId] — read, upsert, or delete one scene of
 * an owned course.
 */
import { DocumentNotFoundError, DocumentVersionError } from '@/lib/db/document-store';
import type { Scene } from '@/lib/contracts/scene';
import { getOwnerScopedDocumentStore } from '@/lib/persistence/document-store-provider';
import { jsonError, parseJsonBody, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; sceneId: string }> };

// GET /api/stages/[id]/scenes/[sceneId]
export async function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const { id, sceneId } = await params;
    const store = getOwnerScopedDocumentStore(ownerId);
    const scene = await store.getScene(id, sceneId);
    if (!scene) return jsonError('not found', 404);
    return Response.json(scene);
  });
}

// PUT /api/stages/[id]/scenes/[sceneId] — upsert.
export async function PUT(req: Request, { params }: Params): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { id?: unknown; stageId?: unknown } | null;
  if (typeof body !== 'object' || body === null || typeof body.id !== 'string' || typeof body.stageId !== 'string') {
    return jsonError('request body must be a scene with `id` and `stageId`', 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const { id, sceneId } = await params;
    if (body.id !== sceneId || body.stageId !== id) {
      return jsonError('scene id/stageId does not match the requested path', 400);
    }
    const store = getOwnerScopedDocumentStore(ownerId);
    try {
      await store.putScene(id, parsed.body as Scene);
    } catch (error) {
      if (error instanceof DocumentNotFoundError) return jsonError('not found', 404);
      if (error instanceof DocumentVersionError) {
        return jsonError('document was written by a newer client; reload before saving', 400);
      }
      if (error instanceof Error) return jsonError('invalid scene', 400);
      throw error;
    }
    return Response.json({ success: true });
  });
}

// DELETE /api/stages/[id]/scenes/[sceneId]
export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const { id, sceneId } = await params;
    const store = getOwnerScopedDocumentStore(ownerId);
    try {
      await store.deleteScene(id, sceneId);
    } catch (error) {
      if (error instanceof DocumentVersionError) {
        return jsonError('document was written by a newer client; reload before saving', 400);
      }
      throw error;
    }
    return Response.json({ ok: true });
  });
}
