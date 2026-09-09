/**
 * POST /api/stage-meta/[stageId]/generation-complete — owner-only: mark the
 * server-side mirror of a course's generation-complete flag. Monotonic; the
 * store never clears it back to false.
 */
import { getPool } from '@/db/client';
import { jsonError, withOwnerId } from '@/lib/persistence/http';
import { markStageGenerationComplete, readStageMeta } from '@/lib/persistence/stage-meta';

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
    await markStageGenerationComplete(pool, stageId);
    return Response.json({ generationComplete: true });
  });
}
