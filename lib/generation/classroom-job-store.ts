/**
 * DB-tracked classroom generation jobs.
 *
 * Vercel serverless functions have execution timeouts a full topic-to-course
 * generation run can exceed, so classroom generation is submit + poll: a job
 * row is created immediately, the actual work runs in the background (see
 * classroom-job-runner.ts), and the client polls this row for progress.
 *
 * This is a DB row, not the reference implementation's filesystem-backed job
 * store — a serverless function's local disk is not guaranteed to be visible
 * to the invocation that later polls it.
 */

import { nanoid } from 'nanoid';
import { getPool } from '@/db/client';
import type { ClassroomGenerationStep } from './classroom-generation';

export type ClassroomJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ClassroomJob {
  id: string;
  ownerId: string;
  stageId?: string;
  status: ClassroomJobStatus;
  step?: ClassroomGenerationStep;
  progress: number;
  message?: string;
  scenesGenerated: number;
  totalScenes?: number;
  result?: { id: string; scenesCount: number; createdAt: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface ClassroomJobRow {
  id: string;
  owner_id: string;
  stage_id: string | null;
  status: ClassroomJobStatus;
  step: string | null;
  progress: number;
  message: string | null;
  scenes_generated: number;
  total_scenes: number | null;
  result: ClassroomJob['result'] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: ClassroomJobRow): ClassroomJob {
  return {
    id: row.id,
    ownerId: row.owner_id,
    stageId: row.stage_id ?? undefined,
    status: row.status,
    step: (row.step ?? undefined) as ClassroomGenerationStep | undefined,
    progress: row.progress,
    message: row.message ?? undefined,
    scenesGenerated: row.scenes_generated,
    totalScenes: row.total_scenes ?? undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Create a queued job row and return its id. */
export async function createClassroomJob(ownerId: string): Promise<ClassroomJob> {
  const pool = getPool();
  const id = nanoid();
  const result = await pool.query<ClassroomJobRow>(
    `INSERT INTO classroom_jobs (id, owner_id, status)
     VALUES ($1, $2, 'queued')
     RETURNING *`,
    [id, ownerId],
  );
  return fromRow(result.rows[0]);
}

export async function getClassroomJob(id: string): Promise<ClassroomJob | undefined> {
  const pool = getPool();
  const result = await pool.query<ClassroomJobRow>('SELECT * FROM classroom_jobs WHERE id = $1', [
    id,
  ]);
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}

export async function updateClassroomJobProgress(
  id: string,
  update: {
    status?: ClassroomJobStatus;
    step?: ClassroomGenerationStep;
    progress?: number;
    message?: string;
    scenesGenerated?: number;
    totalScenes?: number;
  },
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE classroom_jobs SET
       status = COALESCE($2, status),
       step = COALESCE($3, step),
       progress = COALESCE($4, progress),
       message = COALESCE($5, message),
       scenes_generated = COALESCE($6, scenes_generated),
       total_scenes = COALESCE($7, total_scenes),
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      update.status ?? null,
      update.step ?? null,
      update.progress ?? null,
      update.message ?? null,
      update.scenesGenerated ?? null,
      update.totalScenes ?? null,
    ],
  );
}

export async function completeClassroomJob(
  id: string,
  result: NonNullable<ClassroomJob['result']>,
  stageId: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE classroom_jobs SET
       status = 'succeeded',
       step = 'completed',
       progress = 100,
       stage_id = $2,
       result = $3,
       updated_at = now()
     WHERE id = $1`,
    [id, stageId, JSON.stringify(result)],
  );
}

export async function failClassroomJob(id: string, error: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE classroom_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
    [id, error],
  );
}
