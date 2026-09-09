/** POST /api/stage-meta/[stageId]/unpublish — owner-only: make a course private. */
import { getPool } from '@/db/client';
import { jsonError, withOwnerId } from '@/lib/persistence/http';
import { readStageMeta, setStagePublished } from '@/lib/persistence/stage-meta';

export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

export async function POST(req: Request, { params }: Params): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const { stageId } = await params;
    const pool = getPool();
    const meta = await readStageMeta(pool, stageId);
    if (!meta || meta.ownerId !== ownerId || meta.deletedAt !== null) {
      return jsonError('not found', 404);
    }
    await setStagePublished(pool, stageId, false, null);
    return Response.json({ isPublic: false, publishedAt: null });
  });
}
