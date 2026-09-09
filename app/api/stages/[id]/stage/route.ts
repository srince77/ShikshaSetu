/**
 * PUT /api/stages/[id]/stage — replace the stage row of an existing,
 * already-current document without touching its scenes or outline.
 */
import { DocumentNotFoundError, DocumentVersionError } from '@/lib/db/document-store';
import type { Stage } from '@/lib/contracts/scene';
import { getOwnerScopedDocumentStore } from '@/lib/persistence/document-store-provider';
import { jsonError, parseJsonBody, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { id?: unknown } | null;
  if (typeof body !== 'object' || body === null || typeof body.id !== 'string') {
    return jsonError('request body must be a stage with an `id`', 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    if (body.id !== id) return jsonError('stage id does not match the requested stage', 400);
    const store = getOwnerScopedDocumentStore(ownerId);
    try {
      await store.putStage(id, parsed.body as Stage);
    } catch (error) {
      if (error instanceof DocumentNotFoundError) return jsonError('not found', 404);
      if (error instanceof DocumentVersionError) {
        return jsonError('document was written by a newer client; reload before saving', 400);
      }
      if (error instanceof Error) return jsonError('invalid stage', 400);
      throw error;
    }
    return Response.json({ success: true });
  });
}
