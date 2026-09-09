/** PUT /api/stages/[id]/folder — file (or un-file) a course into a folder. */
import { getOwnerScopedDocumentStore } from '@/lib/persistence/document-store-provider';
import { jsonError, parseJsonBody, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { folderId?: unknown } | null;
  if (typeof body !== 'object' || body === null || (body.folderId !== null && typeof body.folderId !== 'string')) {
    return jsonError('folderId must be a string or null', 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    const store = getOwnerScopedDocumentStore(ownerId);
    const ok = await store.setStageFolder(id, body.folderId as string | null);
    if (!ok) return jsonError('not found', 404);
    return Response.json({ ok: true });
  });
}
