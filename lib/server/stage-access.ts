/**
 * Server-side document ownership, visibility, and tombstone resolution.
 *
 * `stage_meta` is the tenant companion table beside the tenant-agnostic
 * document store: it records who owns a course, whether it is public, when
 * it was published, whether generation completed, and (via `deletedAt`) the
 * tombstone. This module is the single resolver viewer-facing routes
 * (`/api/stage-meta/[stageId]`, publish/unpublish, generation-complete) go
 * through.
 */
import { getPool } from '@/db/client';

/** The minimal query surface this module needs; keeps it pool-agnostic for tests. */
export interface StageAccessQueryable {
  query<TRow extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: TRow[] }>;
}

export interface StageAccess {
  stageId: string;
  ownerId: string;
  name: string;
  isPublic: boolean;
  publishedAt: number | null;
  generationComplete: boolean;
  source: 'document';
  deletedAt: Date | null;
}

interface RawAccessRow extends Record<string, unknown> {
  meta_owner_id: string | null;
  meta_is_public: boolean | null;
  meta_published_at: string | number | null;
  meta_generation_complete: boolean | null;
  meta_deleted_at: Date | string | null;
  document_name: string | null;
}

const ACCESS_SQL = `
  SELECT m.owner_id            AS meta_owner_id,
         m.is_public           AS meta_is_public,
         m.published_at        AS meta_published_at,
         m.generation_complete AS meta_generation_complete,
         m.deleted_at          AS meta_deleted_at,
         d.name                AS document_name
    FROM (SELECT $1::text AS stage_id) k
    LEFT JOIN stage_meta      m ON m.stage_id = k.stage_id
    LEFT JOIN document_stages d ON d.id       = k.stage_id
`;

function toEpochMillis(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Reject an id PostgreSQL cannot bind as `text`.
 *
 * A `%00` or lone-surrogate segment in the URL would make `WHERE stage_id =
 * $1` throw at the driver, turning a request that should be a clean 404
 * into a logged 500. Such an id can provably never match a stored row, so
 * classifying it as "no such course" is exact, not defensive rounding.
 */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
function isQueryableStageId(stageId: string): boolean {
  return !stageId.includes('\u0000') && !LONE_SURROGATE.test(stageId);
}

/** The stage-meta query surface, backed by the shared connection pool. */
export async function getStageAccessDb(): Promise<StageAccessQueryable> {
  return getPool() as unknown as StageAccessQueryable;
}

/**
 * Resolve a course's ownership/visibility WITHOUT applying the tombstone.
 *
 * For the delete path (which must find the row it is about to tombstone,
 * and be idempotent when it is already tombstoned) and for offline tooling.
 * Product read gates want {@link resolveStageAccess}.
 */
export async function readStageAccessIncludingDeleted(
  stageId: string,
  queryable?: StageAccessQueryable,
): Promise<StageAccess | null> {
  if (!isQueryableStageId(stageId)) return null;
  const db = queryable ?? (await getStageAccessDb());
  const result = await db.query<RawAccessRow>(ACCESS_SQL, [stageId]);
  const row = result.rows[0];
  if (!row || row.meta_owner_id === null || row.document_name === null) return null;

  return {
    stageId,
    ownerId: row.meta_owner_id,
    name: row.document_name,
    isPublic: row.meta_is_public === true,
    publishedAt: toEpochMillis(row.meta_published_at),
    generationComplete: row.meta_generation_complete === true,
    source: 'document',
    deletedAt: toDate(row.meta_deleted_at),
  };
}

/**
 * Resolve a course's ownership/visibility for a product read gate.
 *
 * `null` means "no such course, as far as this caller is concerned" —
 * absent, or tombstoned. Callers must not distinguish the two: a deleted
 * course that answered 410 would still confirm the id existed, and the
 * whole point of the tombstone is that a deleted course is gone from the
 * product's point of view while its rows stay on disk.
 */
export async function resolveStageAccess(
  stageId: string,
  queryable?: StageAccessQueryable,
): Promise<StageAccess | null> {
  const access = await readStageAccessIncludingDeleted(stageId, queryable);
  if (!access || access.deletedAt !== null) return null;
  return access;
}
