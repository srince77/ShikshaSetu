/**
 * Constructs an owner-bound document store over the shared connection pool.
 * Cheap enough to build fresh per request — the pool itself is the only
 * thing actually shared (`db/client.ts` memoizes it).
 */
import { getPool } from '@/db/client';
import { validateScene, validateStage } from '@/lib/contracts/scene';
import type {
  DocumentFolderStore,
  DocumentStore,
  StageFreshnessManifestStore,
} from '@/lib/db/document-store';
import { createOwnerBoundDocumentStore } from './owner-bound-document-store';

export function getOwnerScopedDocumentStore(
  ownerId: string,
): DocumentStore & DocumentFolderStore & StageFreshnessManifestStore {
  return createOwnerBoundDocumentStore({
    pool: getPool(),
    ownerId,
    validateScene: (scene) => validateScene(scene),
    validateStage: (stage) => validateStage(stage),
  });
}
