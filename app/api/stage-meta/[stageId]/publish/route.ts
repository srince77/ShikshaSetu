/** POST /api/stage-meta/[stageId]/publish — owner-only: make a course public. */
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
    // Foreign or absent: identical 404, no existence oracle.
    if (!meta || meta.ownerId !== ownerId || meta.deletedAt !== null) {
      return jsonError('not found', 404);
    }
    const publishedAt = Date.now();
    await setStagePublished(pool, stageId, true, publishedAt);
    return Response.json({ isPublic: true, publishedAt });
  });
}
