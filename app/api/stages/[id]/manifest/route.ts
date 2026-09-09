/** GET /api/stages/[id]/manifest — the trigger-maintained freshness manifest. */
import { getOwnerScopedDocumentStore } from '@/lib/persistence/document-store-provider';
import { jsonError, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    const store = getOwnerScopedDocumentStore(ownerId);
    const manifest = await store.readFreshnessManifest(id);
    if (!manifest) return jsonError('not found', 404);
    return Response.json(manifest);
  });
}
