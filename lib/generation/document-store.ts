/**
 * Minimal persistence for generated course documents (stages/scenes/outlines).
 *
 * There is no frozen `lib/contracts/*` interface for this yet (unlike
 * `AgentSessionStore`) — the document-store schema in `db/migrations/0001_*`
 * already exists, so this writes directly against it rather than blocking
 * classroom generation on a contract that hasn't landed. If/when a proper
 * document-store contract and `lib/db/*` implementation appear, this file
 * should be replaced by a call through that interface instead.
 */

import type { Action, Scene, Stage } from '@/lib/contracts/scene';
import type { CompleteSceneContent } from '@shikshasetu/generation';
import { getPool } from '@/db/client';

export type PersistableScene = Scene<Action, CompleteSceneContent>;

/** Create the stage row (the course/classroom document itself). */
export async function createStageRow(stage: Stage, ownerId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO document_stages (id, name, description, interactive_mode, task_engine_mode, created_at, updated_at, owner_id, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       interactive_mode = EXCLUDED.interactive_mode,
       task_engine_mode = EXCLUDED.task_engine_mode,
       updated_at = EXCLUDED.updated_at,
       data = EXCLUDED.data`,
    [
      stage.id,
      stage.name,
      stage.description ?? null,
      stage.interactiveMode ?? null,
      stage.taskEngineMode ?? null,
      stage.createdAt,
      stage.updatedAt,
      ownerId,
      JSON.stringify(stage),
    ],
  );

  await pool.query(
    `INSERT INTO stage_meta (stage_id, owner_id, is_public, generation_complete)
     VALUES ($1, $2, false, false)
     ON CONFLICT (stage_id) DO NOTHING`,
    [stage.id, ownerId],
  );
}

/** Persist the thin outline map for a stage (before per-scene content exists). */
export async function saveOutlines(stageId: string, outlines: unknown): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO document_outlines (stage_id, data)
     VALUES ($1, $2)
     ON CONFLICT (stage_id) DO UPDATE SET data = EXCLUDED.data`,
    [stageId, JSON.stringify(outlines)],
  );
}

/** Persist one fully-generated scene. */
export async function insertScene(stageId: string, scene: PersistableScene): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO document_scenes (stage_id, id, scene_order, data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stage_id, id) DO UPDATE SET scene_order = EXCLUDED.scene_order, data = EXCLUDED.data`,
    [stageId, scene.id, scene.order, JSON.stringify(scene)],
  );
}

/** Update the stage document, e.g. to attach a video manifest or agent roster after scenes exist. */
export async function updateStageData(stage: Stage): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE document_stages SET name = $2, description = $3, updated_at = $4, data = $5 WHERE id = $1`,
    [stage.id, stage.name, stage.description ?? null, stage.updatedAt, JSON.stringify(stage)],
  );
}

/** Mark a stage's generation as finished so readers know its scene list is complete. */
export async function markGenerationComplete(stageId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE stage_meta SET generation_complete = true WHERE stage_id = $1`, [
    stageId,
  ]);
}

/** Read one stage document by id. */
export async function getStage(stageId: string): Promise<Stage | undefined> {
  const pool = getPool();
  const result = await pool.query<{ data: Stage }>(
    'SELECT data FROM document_stages WHERE id = $1',
    [stageId],
  );
  return result.rows[0]?.data;
}

/** Read every generated scene for a stage, in playback order. */
export async function listScenes(stageId: string): Promise<PersistableScene[]> {
  const pool = getPool();
  const result = await pool.query<{ data: PersistableScene }>(
    'SELECT data FROM document_scenes WHERE stage_id = $1 ORDER BY scene_order',
    [stageId],
  );
  return result.rows.map((row) => row.data);
}
