/**
 * PostgreSQL DocumentStore — persists a course (a `Stage` + its `Scene`s + an
 * app-owned outline snapshot) against the tables `db/migrations/0001_document_store.sql`
 * already created (`document_folders`, `document_stages`, `document_scenes`,
 * `document_outlines`, and their revision-tracking companions).
 *
 * Full stage and scene values live in JSONB so the DSL can evolve without a
 * schema migration; the stage's version-independent picker metadata and each
 * scene's order are duplicated in ordinary columns so `listDocuments` never
 * needs to decode content, and ordered reads never depend on JSON operators.
 *
 * This module is tenant-agnostic: `ownerId` scoping, tombstoning, and
 * publish state live in `stage_meta` (`lib/persistence/stage-meta.ts`) and
 * are enforced by `lib/persistence/owner-bound-document-store.ts`, not here.
 */
import {
  DSL_VERSION,
  DSL_VERSION_KEY,
  dslVersionOf,
  migrate,
  needsMigration,
  validateScene,
  validateStage,
} from '@/lib/contracts/scene';
import type { Scene, Stage } from '@/lib/contracts/scene';
import { assertJsonValue, isLosslessJsonString } from './json-value';
import type { Queryable, WithTransaction } from './pg-types';

/**
 * The minimal scene shape this store depends on: `stageId` + `id` are the
 * compound row key, `order` is the presentation order. The DSL `Scene`
 * satisfies it; everything else rides along opaquely.
 */
export interface SceneLike {
  id: string;
  stageId: string;
  order: number;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: { path: string; message: string }[] };

export type SceneValidator = (scene: unknown) => ValidationResult;
export type StageValidator = (stage: unknown) => ValidationResult;

/** A document write was rejected because its persisted DSL version is incompatible. */
export class DocumentVersionError extends Error {
  override readonly name = 'DocumentVersionError';
  constructor(
    readonly stageId: string,
    readonly kind: 'future' | 'not-current',
    readonly storedVersion: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** An incremental document write requires a parent document that does not exist. */
export class DocumentNotFoundError extends Error {
  override readonly name = 'DocumentNotFoundError';
  constructor(
    readonly stageId: string,
    message: string,
  ) {
    super(message);
  }
}

/** The portable, embedded form of a persisted course. */
export interface MaicDocument<TScene extends SceneLike = Scene, TStage extends Stage = Stage> {
  stage: TStage;
  scenes: TScene[];
  outline?: unknown;
  dslVersion?: string;
}

/** A lightweight per-document row for a course picker. */
export interface DocumentSummary {
  id: string;
  name: string;
  description?: string;
  interactiveMode?: boolean;
  taskEngineMode?: boolean;
  createdAt: number;
  updatedAt: number;
  sceneCount: number;
  folderId?: string;
}

/** A durable owner-scoped folder, including folders that currently have no documents. */
export interface DocumentFolder {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** Creating a folder would exceed the owner-scoped folder limit. */
export class DocumentFolderLimitError extends Error {
  override readonly name = 'DocumentFolderLimitError';
  constructor(readonly limit: number) {
    super(`document folder limit reached (${limit})`);
  }
}

export interface DocumentFolderStore {
  createFolder(
    folderId: string,
    name: string,
    limit?: number,
  ): Promise<{ folder: DocumentFolder; reused: boolean }>;
  listFolders(): Promise<DocumentFolder[]>;
  renameFolder(id: string, name: string): Promise<DocumentFolder | null>;
  deleteFolder(
    id: string,
    mode: 'ungroup' | 'remove',
  ): Promise<{ removedStageIds: string[] } | null>;
  moveDocumentToFolder(stageId: string, folderId: string): Promise<boolean>;
  setStageFolder(stageId: string, folderId: string | null): Promise<boolean>;
  listDocuments(folderId?: string): Promise<DocumentSummary[]>;
}

export interface DocumentStore<TScene extends SceneLike = Scene, TStage extends Stage = Stage> {
  saveDocument(doc: MaicDocument<TScene, TStage>): Promise<void>;
  loadDocument(stageId: string): Promise<MaicDocument<TScene, TStage> | null>;
  listDocuments(): Promise<DocumentSummary[]>;
  deleteDocument(stageId: string): Promise<void>;
  putStage(stageId: string, stage: TStage): Promise<void>;
  putScene(stageId: string, scene: TScene): Promise<void>;
  getScene(stageId: string, sceneId: string): Promise<TScene | null>;
  deleteScene(stageId: string, sceneId: string): Promise<void>;
}

export interface StageSceneManifest {
  id: string;
  order: number;
  rev: number;
}

export interface StageFreshnessManifest {
  rev: number;
  scenes: StageSceneManifest[];
}

export interface StageFreshnessManifestStore {
  readFreshnessManifest(stageId: string): Promise<StageFreshnessManifest | null>;
}

// --- aggregate <-> normalized-row adapter -----------------------------------

/** The stage (root) row: stage metadata plus the document's version stamp. */
type StageRow<TStage extends Stage = Stage> = TStage & { [DSL_VERSION_KEY]: string };

interface OutlineRow {
  stageId: string;
  outline: unknown;
}

interface DocumentRows<TScene extends SceneLike, TStage extends Stage = Stage> {
  stageRow: StageRow<TStage>;
  sceneRows: TScene[];
  outlineRow?: OutlineRow;
}

function splitDocument<TScene extends SceneLike, TStage extends Stage = Stage>(
  doc: MaicDocument<TScene, TStage>,
): DocumentRows<TScene, TStage> {
  const stageRow: StageRow<TStage> = { ...doc.stage, [DSL_VERSION_KEY]: DSL_VERSION };
  const rows: DocumentRows<TScene, TStage> = { stageRow, sceneRows: doc.scenes };
  if (doc.outline !== undefined) {
    rows.outlineRow = { stageId: doc.stage.id, outline: doc.outline };
  }
  return rows;
}

function reassembleDocument<TScene extends SceneLike, TStage extends Stage = Stage>(
  stageRow: StageRow<TStage>,
  sceneRows: TScene[],
  outlineRow?: OutlineRow,
): MaicDocument<TScene, TStage> {
  const { [DSL_VERSION_KEY]: dslVersion, ...stageFields } = stageRow;
  const stage = stageFields as unknown as TStage;
  const scenes = [...sceneRows].sort((a, b) => a.order - b.order);
  const doc: MaicDocument<TScene, TStage> = { stage, scenes, dslVersion };
  if (outlineRow) doc.outline = outlineRow.outline;
  return doc;
}

// --- store -------------------------------------------------------------------

export interface PgDocumentStoreOptions {
  withTransaction: WithTransaction;
  validateScene?: SceneValidator;
  validateStage?: StageValidator;
  /** Restrict writes, listings, and folders to this owner. Reads remain id-capable. */
  ownerId?: string;
}

const STAGE_REV_SQL = `
  SELECT rev
    FROM document_stage_revision
   WHERE stage_id = $1
`;

const SCENES_SQL = `
  SELECT s.id,
         s.scene_order,
         COALESCE(sr.rev, 0) AS rev
    FROM document_scenes s
    LEFT JOIN document_scene_revision sr
      ON sr.stage_id = s.stage_id
     AND sr.scene_id = s.id
   WHERE s.stage_id = $1
   ORDER BY s.scene_order ASC, s.id ASC
`;

/**
 * Read the freshness manifest for one stage: the stage's monotonic revision
 * plus every live scene's id/order/rev, maintained by the triggers in
 * `0001_document_store.sql`. Callers gate existence/visibility first (the
 * owner-bound store method does); this assumes the stage exists.
 */
export async function readStageFreshnessManifest(
  stageId: string,
  queryable: Queryable,
): Promise<StageFreshnessManifest> {
  const [stageRows, sceneRows] = await Promise.all([
    queryable.query<{ rev: number | string }>(STAGE_REV_SQL, [stageId]),
    queryable.query<{ id: string; scene_order: number | string; rev: number | string }>(
      SCENES_SQL,
      [stageId],
    ),
  ]);

  return {
    rev: stageRows.rows[0] === undefined ? 0 : Number(stageRows.rows[0].rev),
    scenes: sceneRows.rows.map((row) => ({
      id: row.id,
      order: Number(row.scene_order),
      rev: Number(row.rev),
    })),
  };
}

interface StoredJsonRow extends Record<string, unknown> {
  data: unknown;
}

interface StoredSceneRow extends StoredJsonRow {
  id: string;
}

interface SummaryRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string | null;
  interactive_mode: boolean | null;
  task_engine_mode: boolean | null;
  created_at: number | string;
  updated_at: number | string;
  scene_count: number | string;
  folder_id: string | null;
}

interface FolderRow extends Record<string, unknown> {
  id: string;
  name: string;
  folder_order: number | string;
  created_at: number | string;
  updated_at: number | string;
}

function assertValid(result: ValidationResult, label: string): void {
  if (result.valid) return;
  const detail = result.errors.map((error) => `${error.path || '/'}: ${error.message}`).join('; ');
  throw new Error(`invalid ${label}: ${detail}`);
}

function decodeJson<T>(value: unknown): T {
  if (typeof value === 'string' && /^[\s]*[{[]/.test(value)) {
    return JSON.parse(value) as T;
  }
  return value as T;
}

function isPlainObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encodeJson(value: unknown, label: string): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('value is not JSON-serializable');
    return encoded;
  } catch (error) {
    throw new Error(`${label} is not JSON-serializable`, { cause: error });
  }
}

function isFutureVersioned(versioned: unknown): boolean {
  if (typeof versioned !== 'object' || versioned === null) return false;
  return !needsMigration(versioned) && dslVersionOf(versioned) !== DSL_VERSION;
}

function migrateDocument<TScene extends SceneLike, TStage extends Stage>(
  doc: MaicDocument<TScene, TStage>,
): MaicDocument<TScene, TStage> {
  const { outline, ...core } = doc;
  const migrated = migrate(core) as MaicDocument<TScene, TStage>;
  return outline === undefined ? migrated : { ...migrated, outline };
}

function assertStorableScene(scene: SceneLike, stageId: string): void {
  const candidate = scene as { id: unknown; stageId: unknown; order: unknown };
  if (typeof candidate.id !== 'string') {
    throw new Error(`scene id must be a string, got ${JSON.stringify(candidate.id)}`);
  }
  if (candidate.stageId !== stageId) {
    throw new Error(
      `scene ${JSON.stringify(candidate.id)} has stageId ${JSON.stringify(candidate.stageId)} ` +
        `but belongs to document ${JSON.stringify(stageId)}`,
    );
  }
  if (typeof candidate.order !== 'number' || !Number.isFinite(candidate.order)) {
    throw new Error(
      `scene ${JSON.stringify(candidate.id)} order must be a finite number, got ` +
        JSON.stringify(candidate.order),
    );
  }
}

function isPgQueryableKey(value: string): boolean {
  return isLosslessJsonString(value);
}

export class PgDocumentStore<TScene extends SceneLike = Scene, TStage extends Stage = Stage>
  implements DocumentStore<TScene, TStage>, DocumentFolderStore, StageFreshnessManifestStore
{
  private readonly queryable: Queryable;
  private readonly transactionHook: WithTransaction;
  private readonly validateSceneFn: SceneValidator;
  private readonly validateStageFn: StageValidator;
  private readonly ownerId: string | null;
  private readonly options: PgDocumentStoreOptions;

  constructor(queryable: Queryable, options: PgDocumentStoreOptions) {
    if (typeof options?.withTransaction !== 'function') {
      throw new Error(
        'withTransaction is required and must pin a fresh connection and transaction for ' +
          'every call; reusing a shared client lets concurrent transactions interleave',
      );
    }
    this.queryable = queryable;
    this.transactionHook = options.withTransaction;
    this.validateSceneFn = options.validateScene ?? ((scene) => validateScene(scene));
    this.validateStageFn = options.validateStage ?? ((stage) => validateStage(stage));
    if (options.ownerId !== undefined && !isPgQueryableKey(options.ownerId)) {
      throw new Error('PgDocumentStore ownerId must be lossless JSON text');
    }
    this.ownerId = options.ownerId ?? null;
    this.options = options;
  }

  /** Bind document writes, listings, and folders to one trusted owner identity. */
  forOwner(ownerId: string): PgDocumentStore<TScene, TStage> {
    return new PgDocumentStore(this.queryable, { ...this.options, ownerId });
  }

  private scopePredicate(alias = '', ownerParameter = 1): string {
    const column = alias === '' ? 'owner_id' : `${alias}.owner_id`;
    return this.ownerId === null ? `${column} IS NULL` : `${column} = $${ownerParameter}`;
  }

  private scopeParams(stageId?: string): unknown[] {
    return this.ownerId === null
      ? stageId === undefined
        ? []
        : [stageId]
      : stageId === undefined
        ? [this.ownerId]
        : [stageId, this.ownerId];
  }

  private async transaction<T>(body: (queryable: Queryable) => Promise<T>): Promise<T> {
    return this.transactionHook(body);
  }

  private requireOwner(operation: string): string {
    if (this.ownerId === null) {
      throw new Error(`${operation} requires an owner-bound document store`);
    }
    return this.ownerId;
  }

  private async loadStage(
    queryable: Queryable,
    stageId: string,
    lock: 'share' | 'update' | false = false,
  ): Promise<StageRow<TStage> | undefined> {
    const suffix = lock === 'share' ? ' FOR SHARE' : lock === 'update' ? ' FOR UPDATE' : '';
    const result = await queryable.query<StoredJsonRow>(
      `SELECT data FROM document_stages WHERE id = $1${suffix}`,
      [stageId],
    );
    const storedRow = result.rows[0];
    if (!storedRow) return undefined;
    const decoded = decodeJson<unknown>(storedRow.data);
    if (!isPlainObject(decoded)) {
      throw new Error(
        `corrupt stored row for document ${JSON.stringify(stageId)}: data must be a plain object`,
      );
    }
    return decoded as StageRow<TStage>;
  }

  private async loadRows(
    queryable: Queryable,
    stageId: string,
    lock: 'share' | 'update' = 'share',
  ): Promise<
    { stageRow: StageRow<TStage>; sceneRows: TScene[]; outlineRow?: OutlineRow } | undefined
  > {
    const stageRow = await this.loadStage(queryable, stageId, lock);
    if (!stageRow) return undefined;
    const scenes = await queryable.query<StoredJsonRow>(
      `SELECT data FROM document_scenes WHERE stage_id = $1 ORDER BY scene_order ASC, id ASC`,
      [stageId],
    );
    const outline = await queryable.query<StoredJsonRow>(
      `SELECT data FROM document_outlines WHERE stage_id = $1`,
      [stageId],
    );
    const sceneRows = scenes.rows.map((row) => decodeJson<TScene>(row.data));
    const outlineRow = outline.rows[0]
      ? { stageId, outline: decodeJson<unknown>(outline.rows[0].data) }
      : undefined;
    return { stageRow, sceneRows, outlineRow };
  }

  private currentVersionError(
    operation: string,
    stageId: string,
    stageRow: StageRow<TStage>,
  ): DocumentVersionError {
    return new DocumentVersionError(
      stageId,
      'not-current',
      stageRow[DSL_VERSION_KEY],
      `cannot ${operation} document ${JSON.stringify(stageId)} at DSL version ` +
        `${JSON.stringify(dslVersionOf(stageRow))} — load and save it to bring it to ` +
        `${DSL_VERSION} first`,
    );
  }

  private validateForSave(
    doc: MaicDocument<TScene, TStage>,
  ): ReturnType<typeof splitDocument<TScene, TStage>> {
    assertValid(this.validateStageFn(doc.stage), `stage ${doc.stage.id}`);
    const stageId = doc.stage.id;
    const seen = new Set<string>();
    for (const scene of doc.scenes) {
      assertValid(this.validateSceneFn(scene), `scene ${scene.id}`);
      assertStorableScene(scene, stageId);
      if (seen.has(scene.id)) {
        throw new Error(`duplicate scene id ${JSON.stringify(scene.id)} in document ` + JSON.stringify(stageId));
      }
      seen.add(scene.id);
    }
    const rows = splitDocument(doc);
    assertJsonValue(rows.stageRow, `document stage ${JSON.stringify(stageId)}`);
    for (const scene of rows.sceneRows) {
      assertJsonValue(scene, `document scene ${JSON.stringify(scene.id)}`);
    }
    if (rows.outlineRow) {
      assertJsonValue(rows.outlineRow.outline, `document outline ${JSON.stringify(stageId)}`);
    }
    return rows;
  }

  private async persistStage(queryable: Queryable, stageRow: StageRow<TStage>): Promise<void> {
    const result = await queryable.query<{ id: string }>(
      `INSERT INTO document_stages
         (id, name, description, interactive_mode, task_engine_mode, created_at, updated_at,
          owner_id, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             interactive_mode = EXCLUDED.interactive_mode,
             task_engine_mode = EXCLUDED.task_engine_mode,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at,
             data = EXCLUDED.data
       WHERE document_stages.owner_id IS NOT DISTINCT FROM EXCLUDED.owner_id
       RETURNING id`,
      [
        stageRow.id,
        stageRow.name,
        stageRow.description ?? null,
        stageRow.interactiveMode ?? null,
        stageRow.taskEngineMode ?? null,
        stageRow.createdAt,
        stageRow.updatedAt,
        this.ownerId,
        encodeJson(stageRow, `document stage ${JSON.stringify(stageRow.id)}`),
      ],
    );
    if (result.rows.length === 0) {
      throw new DocumentNotFoundError(
        stageRow.id,
        `document ${JSON.stringify(stageRow.id)} belongs to another scope`,
      );
    }
  }

  async saveDocument(doc: MaicDocument<TScene, TStage>): Promise<void> {
    if (isFutureVersioned(doc)) {
      throw new DocumentVersionError(
        doc.stage.id,
        'future',
        doc.dslVersion,
        `refusing to save document ${JSON.stringify(doc.stage.id)} — it was written at DSL ` +
          `version ${JSON.stringify(dslVersionOf(doc))}, newer than this client's ${DSL_VERSION}`,
      );
    }
    const normalized = migrateDocument(doc);
    const { stageRow, sceneRows, outlineRow } = this.validateForSave(normalized);
    const stageId = stageRow.id;

    await this.transaction(async (queryable) => {
      const existingStage = await this.loadStage(queryable, stageId, 'update');
      if (existingStage && isFutureVersioned(existingStage)) {
        throw new DocumentVersionError(
          stageId,
          'future',
          existingStage[DSL_VERSION_KEY],
          `refusing to overwrite document ${JSON.stringify(stageId)} — the stored copy is at ` +
            `DSL version ${JSON.stringify(dslVersionOf(existingStage))}, newer than this ` +
            `client's ${DSL_VERSION}`,
        );
      }

      await this.persistStage(queryable, stageRow);
      const existingScenes = await queryable.query<StoredSceneRow>(
        `SELECT id, data FROM document_scenes WHERE stage_id = $1`,
        [stageId],
      );
      const incomingIds = new Set(sceneRows.map((scene) => scene.id));
      for (const scene of sceneRows) {
        await queryable.query(
          `INSERT INTO document_scenes (stage_id, id, scene_order, data)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (stage_id, id) DO UPDATE
             SET scene_order = EXCLUDED.scene_order, data = EXCLUDED.data`,
          [stageId, scene.id, scene.order, encodeJson(scene, `document scene ${JSON.stringify(scene.id)}`)],
        );
      }
      for (const scene of existingScenes.rows) {
        if (!incomingIds.has(scene.id)) {
          await queryable.query('DELETE FROM document_scenes WHERE stage_id = $1 AND id = $2', [
            stageId,
            scene.id,
          ]);
        }
      }

      if (outlineRow) {
        await queryable.query(
          `INSERT INTO document_outlines (stage_id, data)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (stage_id) DO UPDATE SET data = EXCLUDED.data`,
          [stageId, encodeJson(outlineRow.outline, `document outline ${JSON.stringify(stageId)}`)],
        );
      } else {
        await queryable.query('DELETE FROM document_outlines WHERE stage_id = $1', [stageId]);
      }
    });
  }

  async loadDocument(stageId: string): Promise<MaicDocument<TScene, TStage> | null> {
    if (!isPgQueryableKey(stageId)) return null;
    const rows = await this.transaction((queryable) => this.loadRows(queryable, stageId));
    if (!rows) return null;
    return migrateDocument(reassembleDocument(rows.stageRow, rows.sceneRows, rows.outlineRow));
  }

  async readFreshnessManifest(stageId: string): Promise<StageFreshnessManifest | null> {
    if (!isPgQueryableKey(stageId)) return null;
    return this.transaction(async (queryable) => {
      const scoped = await queryable.query<{ id: string }>(
        `SELECT id FROM document_stages WHERE id = $1 AND ${this.scopePredicate('', 2)}`,
        this.scopeParams(stageId),
      );
      if (scoped.rows.length === 0) return null;
      return readStageFreshnessManifest(stageId, queryable);
    });
  }

  async createFolder(
    folderId: string,
    name: string,
    limit = 50,
  ): Promise<{ folder: DocumentFolder; reused: boolean }> {
    const ownerId = this.requireOwner('createFolder');
    if (!isPgQueryableKey(folderId) || !isPgQueryableKey(name)) {
      throw new Error('folder id and name must be lossless JSON text');
    }
    const normalizedName = name.toLocaleLowerCase('en-US');
    return this.transaction(async (queryable) => {
      const existing = await queryable.query<FolderRow>(
        `SELECT id, name, folder_order, created_at, updated_at
           FROM document_folders
          WHERE owner_id = $1 AND normalized_name = $2
          LIMIT 1`,
        [ownerId, normalizedName],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        return {
          folder: {
            id: row.id,
            name: row.name,
            order: Number(row.folder_order),
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at),
          },
          reused: true,
        };
      }
      const count = await queryable.query<{ count: number | string }>(
        'SELECT COUNT(*)::text AS count FROM document_folders WHERE owner_id = $1',
        [ownerId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= limit) throw new DocumentFolderLimitError(limit);
      const now = Date.now();
      const maxOrder = await queryable.query<{ max: number | string | null }>(
        `SELECT MAX(folder_order)::text AS max FROM document_folders WHERE owner_id = $1`,
        [ownerId],
      );
      const order = Number(maxOrder.rows[0]?.max ?? -1) + 1;
      const inserted = await queryable.query<FolderRow>(
        `INSERT INTO document_folders (owner_id, id, name, normalized_name, folder_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (owner_id, normalized_name) DO UPDATE SET normalized_name = EXCLUDED.normalized_name
         RETURNING id, name, folder_order, created_at, updated_at`,
        [ownerId, folderId, name, normalizedName, order, now],
      );
      const row = inserted.rows[0]!;
      return {
        folder: {
          id: row.id,
          name: row.name,
          order: Number(row.folder_order),
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        },
        reused: row.id !== folderId,
      };
    });
  }

  async listFolders(): Promise<DocumentFolder[]> {
    const ownerId = this.requireOwner('listFolders');
    const result = await this.queryable.query<FolderRow>(
      `SELECT id, name, folder_order, created_at, updated_at
         FROM document_folders
        WHERE owner_id = $1
        ORDER BY folder_order ASC, id ASC`,
      [ownerId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      order: Number(row.folder_order),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  async renameFolder(id: string, name: string): Promise<DocumentFolder | null> {
    const ownerId = this.requireOwner('renameFolder');
    if (!isPgQueryableKey(id) || !isPgQueryableKey(name)) {
      throw new Error('folder id and name must be lossless JSON text');
    }
    const normalizedName = name.toLocaleLowerCase('en-US');
    const updated = await this.queryable.query<FolderRow>(
      `UPDATE document_folders
          SET name = $3, normalized_name = $4, updated_at = $5
        WHERE owner_id = $1 AND id = $2
        RETURNING id, name, folder_order, created_at, updated_at`,
      [ownerId, id, name, normalizedName, Date.now()],
    );
    const row = updated.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      order: Number(row.folder_order),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async deleteFolder(
    id: string,
    mode: 'ungroup' | 'remove',
  ): Promise<{ removedStageIds: string[] } | null> {
    const ownerId = this.requireOwner('deleteFolder');
    if (!isPgQueryableKey(id)) return null;
    return this.transaction(async (queryable) => {
      let removedStageIds: string[] = [];
      if (mode === 'remove') {
        const members = await queryable.query<{ id: string }>(
          `SELECT id FROM document_stages WHERE owner_id = $1 AND folder_id = $2 ORDER BY id ASC`,
          [ownerId, id],
        );
        removedStageIds = members.rows.map((row) => row.id);
      }
      await queryable.query(
        `UPDATE document_stages SET folder_id = NULL WHERE owner_id = $1 AND folder_id = $2`,
        [ownerId, id],
      );
      const deleted = await queryable.query<{ id: string }>(
        `DELETE FROM document_folders WHERE owner_id = $1 AND id = $2 RETURNING id`,
        [ownerId, id],
      );
      if (deleted.rows.length === 0) return null;
      return { removedStageIds };
    });
  }

  async moveDocumentToFolder(stageId: string, folderId: string): Promise<boolean> {
    return this.setStageFolder(stageId, folderId);
  }

  async setStageFolder(stageId: string, folderId: string | null): Promise<boolean> {
    const ownerId = this.requireOwner('setStageFolder');
    if (!isPgQueryableKey(stageId)) return false;
    if (folderId === null) {
      await this.queryable.query(
        `UPDATE document_stages SET folder_id = NULL WHERE id = $1 AND owner_id = $2`,
        [stageId, ownerId],
      );
      return true;
    }
    if (!isPgQueryableKey(folderId)) return false;
    const result = await this.queryable.query<{ id: string }>(
      `UPDATE document_stages AS stages
          SET folder_id = $2
        WHERE stages.id = $1
          AND stages.owner_id = $3
          AND EXISTS (
            SELECT 1 FROM document_folders AS folders
             WHERE folders.owner_id = $3 AND folders.id = $2
          )
      RETURNING stages.id`,
      [stageId, folderId, ownerId],
    );
    return result.rows.length === 1;
  }

  async listDocuments(folderId?: string): Promise<DocumentSummary[]> {
    if (folderId !== undefined && (!isPgQueryableKey(folderId) || this.ownerId === null)) return [];
    const folderFilter = folderId === undefined ? '' : ` AND stages.folder_id = $2`;
    const result = await this.queryable.query<SummaryRow>(
      `SELECT stages.id,
              stages.name,
              stages.description,
              stages.interactive_mode,
              stages.task_engine_mode,
              stages.created_at,
              stages.updated_at,
              stages.folder_id,
              COUNT(scenes.id)::text AS scene_count
         FROM document_stages AS stages
         LEFT JOIN document_scenes AS scenes ON scenes.stage_id = stages.id
        WHERE ${this.scopePredicate('stages')}${folderFilter}
        GROUP BY stages.id
        ORDER BY stages.id ASC`,
      folderId === undefined ? this.scopeParams() : [this.ownerId, folderId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      ...(row.description === null ? {} : { description: row.description }),
      ...(row.interactive_mode === null ? {} : { interactiveMode: row.interactive_mode }),
      ...(row.task_engine_mode === null ? {} : { taskEngineMode: row.task_engine_mode }),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      sceneCount: Number(row.scene_count),
      ...(row.folder_id === null ? {} : { folderId: row.folder_id }),
    }));
  }

  async deleteDocument(stageId: string): Promise<void> {
    if (!isPgQueryableKey(stageId)) return;
    await this.queryable.query(
      `DELETE FROM document_stages WHERE id = $1 AND ${this.scopePredicate('', 2)}`,
      this.scopeParams(stageId),
    );
  }

  async putStage(stageId: string, stage: TStage): Promise<void> {
    assertValid(this.validateStageFn(stage), `stage ${stage.id}`);
    if (stage.id !== stageId) {
      throw new Error(`stage ${JSON.stringify(stage.id)} does not belong to document ` + JSON.stringify(stageId));
    }
    const stageRow = { ...stage, [DSL_VERSION_KEY]: DSL_VERSION } as StageRow<TStage>;
    assertJsonValue(stageRow, `document stage ${JSON.stringify(stageId)}`);
    await this.transaction(async (queryable) => {
      const stored = await this.loadStage(queryable, stageId, 'update');
      if (!stored) {
        throw new DocumentNotFoundError(stageId, `cannot putStage into missing document ${JSON.stringify(stageId)}`);
      }
      if (dslVersionOf(stored) !== DSL_VERSION) {
        throw this.currentVersionError('putStage into', stageId, stored);
      }
      await this.persistStage(queryable, stageRow);
    });
  }

  async putScene(stageId: string, scene: TScene): Promise<void> {
    assertValid(this.validateSceneFn(scene), `scene ${scene.id}`);
    assertStorableScene(scene, stageId);
    assertJsonValue(scene, `document scene ${JSON.stringify(scene.id)}`);
    await this.transaction(async (queryable) => {
      const stored = await this.loadStage(queryable, stageId, 'update');
      if (!stored) {
        throw new DocumentNotFoundError(stageId, `cannot putScene into missing document ${JSON.stringify(stageId)}`);
      }
      if (dslVersionOf(stored) !== DSL_VERSION) {
        throw this.currentVersionError('putScene into', stageId, stored);
      }
      await queryable.query(
        `INSERT INTO document_scenes (stage_id, id, scene_order, data)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (stage_id, id) DO UPDATE
           SET scene_order = EXCLUDED.scene_order, data = EXCLUDED.data`,
        [stageId, scene.id, scene.order, encodeJson(scene, `document scene ${JSON.stringify(scene.id)}`)],
      );
    });
  }

  async getScene(stageId: string, sceneId: string): Promise<TScene | null> {
    if (!isPgQueryableKey(stageId) || !isPgQueryableKey(sceneId)) return null;
    return this.transaction(async (queryable) => {
      const stageRow = await this.loadStage(queryable, stageId, 'share');
      if (!stageRow) return null;
      if (!needsMigration(stageRow)) {
        const result = await queryable.query<StoredJsonRow>(
          `SELECT data FROM document_scenes WHERE stage_id = $1 AND id = $2`,
          [stageId, sceneId],
        );
        return result.rows[0] ? decodeJson<TScene>(result.rows[0].data) : null;
      }
      const scenes = await queryable.query<StoredJsonRow>(
        `SELECT data FROM document_scenes WHERE stage_id = $1 ORDER BY scene_order ASC, id ASC`,
        [stageId],
      );
      const outline = await queryable.query<StoredJsonRow>(
        'SELECT data FROM document_outlines WHERE stage_id = $1',
        [stageId],
      );
      const outlineRow = outline.rows[0]
        ? { stageId, outline: decodeJson<unknown>(outline.rows[0].data) }
        : undefined;
      const document = migrateDocument(
        reassembleDocument(stageRow, scenes.rows.map((row) => decodeJson<TScene>(row.data)), outlineRow),
      );
      return document.scenes.find((scene) => scene.id === sceneId) ?? null;
    });
  }

  async deleteScene(stageId: string, sceneId: string): Promise<void> {
    if (!isPgQueryableKey(stageId) || !isPgQueryableKey(sceneId)) return;
    await this.transaction(async (queryable) => {
      const stored = await this.loadStage(queryable, stageId, 'update');
      if (!stored) return;
      if (dslVersionOf(stored) !== DSL_VERSION) {
        throw this.currentVersionError('deleteScene from', stageId, stored);
      }
      await queryable.query('DELETE FROM document_scenes WHERE stage_id = $1 AND id = $2', [stageId, sceneId]);
    });
  }
}
