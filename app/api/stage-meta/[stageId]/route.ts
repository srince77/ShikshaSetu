/**
 * GET /api/stage-meta/[stageId] — the per-viewer facts a document does not
 * carry (`isOwner`, publish state, generation-complete).
 *
 * The document store returns a DOCUMENT: stage + scenes + outline, nothing
 * about who is asking. This sidecar carries tenancy so the client can fetch
 * both in parallel and decide read-only vs editable.
 *
 * `resolveStageAccess` answers `null` for a deleted course exactly as it
 * does for one that never existed, so a deleted course 404s here too — this
 * route is reachable without a session (any visitor may ask about any id),
 * so leaking `{isPublic: true}` for a tombstoned course would make it a
 * public oracle for "this course used to exist". `ownerId` itself is never
 * in the response — only the derived `isOwner` boolean.
 */
import { resolveSession } from '@/lib/auth/session';
import { resolveStageAccess } from '@/lib/server/stage-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ stageId: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { stageId } = await params;
  const access = await resolveStageAccess(stageId);
  if (!access) return Response.json({ error: 'not_found' }, { status: 404 });

  // An unauthenticated visitor can still ask about a public course; only
  // `isOwner` requires a resolved identity, and it defaults to false rather
  // than surfacing the 401 SESSION_DEV_BYPASS-less resolveSession() throws.
  let ownerId: string | undefined;
  try {
    ownerId = await resolveSession(req);
  } catch {
    ownerId = undefined;
  }

  return Response.json({
    isOwner: ownerId !== undefined && access.ownerId === ownerId,
    isPublic: access.isPublic,
    publishedAt: access.publishedAt,
    generationComplete: access.generationComplete,
    source: access.source,
  });
}
