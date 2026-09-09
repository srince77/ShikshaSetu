/** /api/stages/folders — list and create the caller's course folders. */
import { randomBytes } from 'node:crypto';

import { DocumentFolderLimitError } from '@/lib/db/document-store';
import { getOwnerScopedDocumentStore } from '@/lib/persistence/document-store-provider';
import { jsonError, parseJsonBody, withOwnerId } from '@/lib/persistence/http';

export const runtime = 'nodejs';

const NAME_MAX_LENGTH = 120;

function createFolderId(): string {
  return `folder-${randomBytes(9).toString('base64url')}`;
}

export async function GET(req: Request): Promise<Response> {
  return withOwnerId(req, async (ownerId) => {
    const store = getOwnerScopedDocumentStore(ownerId);
    const folders = await store.listFolders();
    return Response.json({ folders });
  });
}

export async function POST(req: Request): Promise<Response> {
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
    const store = getOwnerScopedDocumentStore(ownerId);
    try {
      const { folder, reused } = await store.createFolder(createFolderId(), name);
      return Response.json({ folder, reused }, { status: reused ? 200 : 201 });
    } catch (error) {
      if (error instanceof DocumentFolderLimitError) {
        return jsonError(`folder limit reached (${error.limit})`, 409);
      }
      throw error;
    }
  });
}
