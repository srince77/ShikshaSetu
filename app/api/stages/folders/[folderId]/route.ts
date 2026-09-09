/** /api/stages/folders/[folderId] — rename or delete an owned folder. */
import { getOwnerScopedDocumentStore } from '@/lib/persistence/document-store-provider';
import { jsonError, parseJsonBody, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

const NAME_MAX_LENGTH = 120;

type Params = { params: Promise<{ folderId: string }> };

// PATCH /api/stages/folders/[folderId] — rename { name }.
export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const rawName = (parsed.body as { name?: unknown } | null)?.name;
  if (typeof rawName !== 'string' || rawName.trim() === '') {
    return jsonError('name is required', 400);
  }
  const name = rawName.trim();
  if (name.length > NAME_MAX_LENGTH) {
    return jsonError(`name exceeds the ${NAME_MAX_LENGTH} character limit`, 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const { folderId } = await params;
    const store = getOwnerScopedDocumentStore(ownerId);
    const folder = await store.renameFolder(folderId, name);
    if (!folder) return jsonError('not found', 404);
    return Response.json({ folder });
  });
}

// DELETE /api/stages/folders/[folderId]?mode=ungroup|remove (default ungroup).
export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  const url = new URL(req.url);
  const modeParam = url.searchParams.get('mode') ?? 'ungroup';
  if (modeParam !== 'ungroup' && modeParam !== 'remove') {
    return jsonError('mode must be `ungroup` or `remove`', 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const { folderId } = await params;
    const store = getOwnerScopedDocumentStore(ownerId);
    const result = await store.deleteFolder(folderId, modeParam);
    if (!result) return jsonError('not found', 404);
    if (modeParam === 'remove') {
      for (const stageId of result.removedStageIds) {
        await store.deleteDocument(stageId);
      }
    }
    return Response.json({ ok: true, removedStageIds: result.removedStageIds });
  });
}
