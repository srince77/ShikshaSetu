/**
 * /api/stages/[id] — read, rename, save, and delete one owned course document.
 *
 * Ownership is enforced by the store itself, not by a pre-check: every read
 * and write goes through the owner-bound document store, so a foreign or
 * missing id answers the identical 404, and a write into a foreign document
 * is refused inside the store's own transaction.
 *
 * - GET    returns the whole document (stage + scenes + outline).
 * - PATCH  renames the course ({ name }).
 * - PUT    saves a whole document ({ stage, scenes, outline? }); the server
 *          bumps `stage.updatedAt` so the freshness signal reflects the write.
 * - DELETE removes the course and its cascading child rows.
 */
import {
  DocumentNotFoundError,
  DocumentVersionError,
  type MaicDocument,
} from '@/lib/db/document-store';
import { getOwnerScopedDocumentStore } from '@/lib/persistence/document-store-provider';
import { jsonError, parseJsonBody, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

const NAME_MAX_LENGTH = 200;

type Params = { params: Promise<{ id: string }> };

function mapSaveError(error: unknown): Response {
  if (error instanceof DocumentNotFoundError) return jsonError('not found', 404);
  if (error instanceof DocumentVersionError) {
    return jsonError('document was written by a newer client; reload before saving', 400);
  }
  if (error instanceof Error) return jsonError('invalid stage document', 400);
  throw error;
}

// GET /api/stages/[id]
export async function GET(req: Request, { params }: Params): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    const store = getOwnerScopedDocumentStore(ownerId);
    const document = await store.loadDocument(id);
    if (!document) return jsonError('not found', 404);
    return Response.json(document);
  });
}

// PATCH /api/stages/[id] — rename { name }.
export async function PATCH(req: Request, { params }: Params): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const rawName = (parsed.body as { name?: unknown } | null)?.name;
  if (typeof rawName !== 'string' || rawName.trim() === '') {
    return jsonError('name must be a non-empty string', 400);
  }
  const name = rawName.trim();
  if (name.length > NAME_MAX_LENGTH) {
    return jsonError(`name exceeds the ${NAME_MAX_LENGTH} character limit`, 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    const store = getOwnerScopedDocumentStore(ownerId);
    const document = await store.loadDocument(id);
    if (!document) return jsonError('not found', 404);
    try {
      await store.saveDocument({ ...document, stage: { ...document.stage, name, updatedAt: Date.now() } });
    } catch (error) {
      return mapSaveError(error);
    }
    return Response.json({ success: true, name });
  });
}

// PUT /api/stages/[id] — save a whole document.
export async function PUT(req: Request, { params }: Params): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const candidate = parsed.body as { stage?: { id?: unknown }; scenes?: unknown } | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.stage !== 'object' ||
    candidate.stage === null ||
    typeof candidate.stage.id !== 'string' ||
    !Array.isArray(candidate.scenes)
  ) {
    return jsonError('request body must be a stage document with `stage` and `scenes`', 400);
  }

  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    if (candidate.stage!.id !== id) {
      return jsonError('document stage id does not match the requested stage', 400);
    }
    const store = getOwnerScopedDocumentStore(ownerId);
    // Existence-gated: PUT updates a course that exists; it must not
    // resurrect a deleted one or mint a course under a client-chosen id.
    const existing = await store.loadDocument(id);
    if (!existing) return jsonError('not found', 404);
    try {
      const doc = parsed.body as MaicDocument;
      await store.saveDocument({ ...doc, stage: { ...doc.stage, updatedAt: Date.now() } });
    } catch (error) {
      return mapSaveError(error);
    }
    return Response.json({ success: true });
  });
}

// DELETE /api/stages/[id]
export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const { id } = await params;
    const store = getOwnerScopedDocumentStore(ownerId);
    await store.deleteDocument(id);
    return Response.json({ ok: true });
  });
}
