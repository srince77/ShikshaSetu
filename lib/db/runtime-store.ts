/**
 * PostgreSQL RuntimeStore — persists learner runtime sessions and their
 * append-only records against `runtime_sessions` / `runtime_records`
 * (`db/migrations/0002_runtime_store.sql`), partitioned by
 * `(stageId, learnerKey)`.
 *
 * Mirrors the document store's shape: sessions are looked up by id,
 * listings are always partition-scoped (there is no global listing), and
 * `mergeLearner` is the one deliberate cross-stage sweep — the
 * anonymous-learner-signs-in migration.
 */
import {
  RUNTIME_DSL_VERSION,
  isChatMessageSkeleton,
  isQuizAttemptSkeleton,
  migrateRuntime,
  needsRuntimeMigration,
  runtimeDslVersionOf,
  validateRuntimeRecord,
  validateRuntimeSession,
} from '@shikshasetu/dsl';
import type {
  RuntimePayload,
  RuntimeRecord,
  RuntimeRecordInit,
  RuntimeSession,
  RuntimeSessionStatus,
} from '@shikshasetu/dsl';
import { assertJsonValue, isLosslessJsonString } from './json-value';
import type { Queryable, WithTransaction } from './pg-types';

export type RuntimeSessionInit = Omit<RuntimeSession, 'runtimeDslVersion'>;

export type RuntimePayloadValidator = (
  payload: unknown,
) => { valid: true } | { valid: false; errors: { path: string; message: string }[] };

/** A compare-and-append precondition failed inside the store transaction. */
export class RuntimeAppendConflictError extends Error {
  override readonly name = 'RuntimeAppendConflictError';
  constructor(
    readonly sessionId: string,
    readonly expectedLastSeq: number | null,
    readonly actualLastSeq: number | null,
  ) {
    super(
      `session ${JSON.stringify(sessionId)} last seq changed from ${String(expectedLastSeq)} to ` +
        String(actualLastSeq),
    );
  }
}

export interface RuntimeTailOptions {
  expectedLastSeq?: number | null;
}

export interface RuntimeAppendOptions extends RuntimeTailOptions {
  sessionTransition?: {
    status: RuntimeSessionStatus;
    updatedAt: string;
  };
}

export interface RuntimeStore {
  createSession(init: RuntimeSessionInit): Promise<RuntimeSession>;
  getSession(sessionId: string): Promise<RuntimeSession | undefined>;
  listSessions(stageId: string, learnerKey: string): Promise<RuntimeSession[]>;
  setSessionStatus(
    sessionId: string,
    status: RuntimeSessionStatus,
    updatedAt: string,
    options?: RuntimeTailOptions,
  ): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  appendRecord<TPayload extends RuntimePayload>(
    init: RuntimeRecordInit<TPayload>,
    options?: RuntimeAppendOptions,
  ): Promise<RuntimeRecord<TPayload>>;
  listRecords(sessionId: string, opts?: { sceneId?: string }): Promise<RuntimeRecord[]>;
  mergeLearner(fromLearnerKey: string, toLearnerKey: string): Promise<number>;
  deleteLearnerRuntime(stageId: string, learnerKey: string): Promise<void>;
  deleteStageRuntime(stageId: string): Promise<void>;
  deleteAllRuntime(): Promise<void>;
}

export interface PgRuntimeStoreOptions {
  withTransaction: WithTransaction;
  /** Replaces the default chat / quizAttempt skeleton validator map. */
  payloadValidators?: Record<string, RuntimePayloadValidator>;
}

const DEFAULT_PAYLOAD_VALIDATORS: Record<string, RuntimePayloadValidator> = {
  chat: (payload) =>
    isChatMessageSkeleton(payload)
      ? { valid: true }
      : {
          valid: false,
          errors: [{ path: '/payload', message: 'chat payload must match ChatMessageSkeleton (role + content)' }],
        },
  quizAttempt: (payload) =>
    isQuizAttemptSkeleton(payload)
      ? { valid: true }
      : {
          valid: false,
          errors: [
            { path: '/payload', message: 'quizAttempt payload must match QuizAttemptSkeleton (phase + answers)' },
          ],
        },
};

interface StoredJsonRow extends Record<string, unknown> {
  data: unknown;
}

interface LastSeqRow extends Record<string, unknown> {
  last_seq: string | number;
}

function assertValid(
  result: { valid: true } | { valid: false; errors: { path: string; message: string }[] },
  label: string,
): void {
  if (result.valid) return;
  const detail = result.errors.map((error) => `${error.path || '/'}: ${error.message}`).join('; ');
  throw new Error(`invalid ${label}: ${detail}`);
}

function decodeJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
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

function isFutureRuntimeVersioned(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  return !needsRuntimeMigration(row) && runtimeDslVersionOf(row) !== RUNTIME_DSL_VERSION;
}

function futureSessionError(sessionId: string, row: RuntimeSession): Error {
  return new Error(
    `session ${JSON.stringify(sessionId)} was written at runtime DSL version ` +
      `${JSON.stringify(runtimeDslVersionOf(row))}, newer than this client's ${RUNTIME_DSL_VERSION}`,
  );
}

function migrateSession(row: RuntimeSession): RuntimeSession {
  return needsRuntimeMigration(row) ? (migrateRuntime(row) as RuntimeSession) : row;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function isPgQueryableKey(value: string): boolean {
  return isLosslessJsonString(value);
}

// 40001/40P01 are not reachable under the assumed READ COMMITTED isolation,
// but stay retryable in case a host injects a stricter isolation level.
function isRetryableAppendError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === '23505' || code === '40001' || code === '40P01';
}

export class PgRuntimeStore implements RuntimeStore {
  private readonly queryable: Queryable;
  private readonly transactionHook: WithTransaction;
  private readonly payloadValidators: Record<string, RuntimePayloadValidator>;

  constructor(queryable: Queryable, options: PgRuntimeStoreOptions) {
    if (typeof options?.withTransaction !== 'function') {
      throw new Error(
        'withTransaction is required and must pin a fresh connection and transaction for every call',
      );
    }
    this.queryable = queryable;
    this.transactionHook = options.withTransaction;
    this.payloadValidators = options.payloadValidators ?? DEFAULT_PAYLOAD_VALIDATORS;
  }

  private async transaction<T>(body: (queryable: Queryable) => Promise<T>): Promise<T> {
    return this.transactionHook(body);
  }

  private validatorFor(kind: string): RuntimePayloadValidator | undefined {
    return Object.hasOwn(this.payloadValidators, kind) ? this.payloadValidators[kind] : undefined;
  }

  private async loadSession(
    queryable: Queryable,
    sessionId: string,
    lock = false,
  ): Promise<RuntimeSession | undefined> {
    const result = await queryable.query<StoredJsonRow>(
      `SELECT data FROM runtime_sessions WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [sessionId],
    );
    const storedRow = result.rows[0];
    if (!storedRow) return undefined;
    const decoded = decodeJson<unknown>(storedRow.data);
    if (!isPlainObject(decoded)) {
      throw new Error(
        `corrupt stored row for session ${JSON.stringify(sessionId)}: data must be a plain object`,
      );
    }
    return decoded as RuntimeSession;
  }

  private async persistSession(queryable: Queryable, session: RuntimeSession): Promise<void> {
    await queryable.query(
      `UPDATE runtime_sessions
          SET stage_id = $2, learner_key = $3, kind = $4, status = $5,
              created_at = $6, updated_at = $7, data = $8::jsonb
        WHERE id = $1`,
      [
        session.id,
        session.stageId,
        session.learnerKey,
        session.kind,
        session.status,
        session.createdAt,
        session.updatedAt,
        encodeJson(session, `runtime session ${JSON.stringify(session.id)}`),
      ],
    );
  }

  async createSession(init: RuntimeSessionInit): Promise<RuntimeSession> {
    const stamped: RuntimeSession = { ...init, runtimeDslVersion: RUNTIME_DSL_VERSION };
    assertValid(validateRuntimeSession(stamped), `runtime session ${JSON.stringify(stamped.id)}`);
    assertJsonValue(stamped, `runtime session ${JSON.stringify(stamped.id)}`);

    try {
      await this.queryable.query(
        `INSERT INTO runtime_sessions (id, stage_id, learner_key, kind, status, created_at, updated_at, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          stamped.id,
          stamped.stageId,
          stamped.learnerKey,
          stamped.kind,
          stamped.status,
          stamped.createdAt,
          stamped.updatedAt,
          encodeJson(stamped, `runtime session ${JSON.stringify(stamped.id)}`),
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error(`session ${JSON.stringify(stamped.id)} already exists`, { cause: error });
      }
      throw error;
    }
    return stamped;
  }

  async getSession(sessionId: string): Promise<RuntimeSession | undefined> {
    if (!isPgQueryableKey(sessionId)) return undefined;
    const row = await this.loadSession(this.queryable, sessionId);
    if (!row) return undefined;
    const session = migrateSession(row);
    assertValid(validateRuntimeSession(session), `stored runtime session ${JSON.stringify(sessionId)}`);
    return session;
  }

  async listSessions(stageId: string, learnerKey: string): Promise<RuntimeSession[]> {
    if (!isPgQueryableKey(stageId) || !isPgQueryableKey(learnerKey)) return [];
    const result = await this.queryable.query<StoredJsonRow>(
      `SELECT data FROM runtime_sessions WHERE stage_id = $1 AND learner_key = $2`,
      [stageId, learnerKey],
    );
    const sessions: RuntimeSession[] = [];
    for (const row of result.rows) {
      try {
        const session = migrateSession(decodeJson<RuntimeSession>(row.data));
        assertValid(validateRuntimeSession(session), `stored runtime session ${JSON.stringify(session.id)}`);
        sessions.push(session);
      } catch {
        // Listings omit corrupt rows; direct reads remain fail-loud.
      }
    }
    return sessions.sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
    );
  }

  async setSessionStatus(
    sessionId: string,
    status: RuntimeSessionStatus,
    updatedAt: string,
    options: RuntimeTailOptions = {},
  ): Promise<void> {
    const expectedLastSeq = options.expectedLastSeq;
    if (
      expectedLastSeq !== undefined &&
      expectedLastSeq !== null &&
      (!Number.isSafeInteger(expectedLastSeq) || expectedLastSeq < 0)
    ) {
      throw new Error('expectedLastSeq must be null or a non-negative integer');
    }
    if (!isPgQueryableKey(sessionId)) {
      throw new Error(`no session ${JSON.stringify(sessionId)}`);
    }
    await this.transaction(async (queryable) => {
      const row = await this.loadSession(queryable, sessionId, true);
      if (!row) throw new Error(`no session ${JSON.stringify(sessionId)}`);
      if (isFutureRuntimeVersioned(row)) throw futureSessionError(sessionId, row);
      const updated: RuntimeSession = { ...migrateSession(row), status, updatedAt };
      assertValid(validateRuntimeSession(updated), `runtime session ${JSON.stringify(sessionId)}`);
      if (expectedLastSeq !== undefined) {
        const last = await queryable.query<LastSeqRow>(
          `SELECT COALESCE(MAX(seq), -1)::text AS last_seq FROM runtime_records WHERE session_id = $1`,
          [sessionId],
        );
        const rawLastSeq = Number(last.rows[0]?.last_seq ?? -1);
        const actualLastSeq = rawLastSeq < 0 ? null : rawLastSeq;
        if (expectedLastSeq !== actualLastSeq) {
          throw new RuntimeAppendConflictError(sessionId, expectedLastSeq, actualLastSeq);
        }
      }
      await this.persistSession(queryable, updated);
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!isPgQueryableKey(sessionId)) return;
    await this.queryable.query('DELETE FROM runtime_sessions WHERE id = $1', [sessionId]);
  }

  async appendRecord<TPayload extends RuntimePayload>(
    init: RuntimeRecordInit<TPayload>,
    options: RuntimeAppendOptions = {},
  ): Promise<RuntimeRecord<TPayload>> {
    assertValid(validateRuntimeRecord({ ...init, seq: 0 }), `runtime record ${JSON.stringify(init.id)}`);
    assertJsonValue(init.payload, `runtime record ${JSON.stringify(init.id)} payload`);
    const expectedLastSeq = options.expectedLastSeq;
    if (
      expectedLastSeq !== undefined &&
      expectedLastSeq !== null &&
      (!Number.isSafeInteger(expectedLastSeq) || expectedLastSeq < 0)
    ) {
      throw new Error('expectedLastSeq must be null or a non-negative integer');
    }
    if (!isPgQueryableKey(init.sessionId)) {
      throw new Error(`no session ${JSON.stringify(init.sessionId)}`);
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.transaction(async (queryable) => {
          const row = await this.loadSession(queryable, init.sessionId, true);
          if (!row) throw new Error(`no session ${JSON.stringify(init.sessionId)}`);
          if (isFutureRuntimeVersioned(row)) throw futureSessionError(init.sessionId, row);

          let session = row;
          if (needsRuntimeMigration(row)) {
            session = migrateSession(row);
            await this.persistSession(queryable, session);
          }
          if (session.status !== 'active') {
            throw new Error(
              `cannot append to session ${JSON.stringify(init.sessionId)} with status ` +
                `'${session.status}' — records may only be appended to an active session`,
            );
          }
          const validator = this.validatorFor(session.kind);
          if (validator) {
            assertValid(validator(init.payload), `runtime record ${JSON.stringify(init.id)}`);
          }

          const last = await queryable.query<LastSeqRow>(
            `SELECT COALESCE(MAX(seq), -1)::text AS last_seq FROM runtime_records WHERE session_id = $1`,
            [init.sessionId],
          );
          const rawLastSeq = Number(last.rows[0]?.last_seq ?? -1);
          const actualLastSeq = rawLastSeq < 0 ? null : rawLastSeq;
          if (expectedLastSeq !== undefined && expectedLastSeq !== actualLastSeq) {
            throw new RuntimeAppendConflictError(init.sessionId, expectedLastSeq, actualLastSeq);
          }
          const seq = rawLastSeq + 1;
          const record: RuntimeRecord<TPayload> = { ...init, seq };
          assertValid(validateRuntimeRecord(record), `runtime record ${JSON.stringify(init.id)}`);
          const transition = options.sessionTransition;
          const updatedSession: RuntimeSession | undefined = transition
            ? { ...session, status: transition.status, updatedAt: transition.updatedAt }
            : undefined;
          if (updatedSession) {
            assertValid(validateRuntimeSession(updatedSession), `runtime session ${JSON.stringify(init.sessionId)}`);
          }
          const jsonRecord = { ...record } as Record<string, unknown>;
          for (const key of ['sceneId', 'actionIndex', 'subAnchor']) {
            if (jsonRecord[key] === undefined) delete jsonRecord[key];
          }
          assertJsonValue(jsonRecord, `runtime record ${JSON.stringify(record.id)}`);
          await queryable.query(
            `INSERT INTO runtime_records (id, session_id, seq, scene_id, created_at, data)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              record.id,
              record.sessionId,
              record.seq,
              record.sceneId ?? null,
              record.createdAt,
              encodeJson(record, `runtime record ${JSON.stringify(record.id)}`),
            ],
          );
          if (updatedSession) await this.persistSession(queryable, updatedSession);
          return record;
        });
      } catch (error) {
        if (!isRetryableAppendError(error) || attempt === 4) throw error;
      }
    }
    throw new Error('unreachable append retry state');
  }

  async listRecords(sessionId: string, opts?: { sceneId?: string }): Promise<RuntimeRecord[]> {
    if (!isPgQueryableKey(sessionId) || (opts?.sceneId !== undefined && !isPgQueryableKey(opts.sceneId))) {
      return [];
    }
    const params: unknown[] = [sessionId];
    let filter = '';
    if (opts?.sceneId !== undefined) {
      params.push(opts.sceneId);
      filter = ' AND scene_id = $2';
    }
    const result = await this.queryable.query<StoredJsonRow>(
      `SELECT data FROM runtime_records WHERE session_id = $1${filter} ORDER BY seq ASC`,
      params,
    );
    return result.rows.map((row) => decodeJson<RuntimeRecord>(row.data));
  }

  async mergeLearner(fromLearnerKey: string, toLearnerKey: string): Promise<number> {
    if (
      typeof fromLearnerKey !== 'string' ||
      fromLearnerKey === '' ||
      typeof toLearnerKey !== 'string' ||
      toLearnerKey === ''
    ) {
      throw new Error('learner keys must be non-empty strings');
    }
    assertJsonValue(toLearnerKey, 'target learner key');
    if (!isPgQueryableKey(fromLearnerKey)) return 0;
    if (fromLearnerKey === toLearnerKey) return 0;

    return this.transaction(async (queryable) => {
      const result = await queryable.query<StoredJsonRow>(
        `SELECT data FROM runtime_sessions WHERE learner_key = $1 FOR UPDATE`,
        [fromLearnerKey],
      );
      const updatedSessions = result.rows.map((row) => {
        const stored = decodeJson<RuntimeSession>(row.data);
        if (isFutureRuntimeVersioned(stored)) throw futureSessionError(stored.id, stored);
        const updated: RuntimeSession = { ...migrateSession(stored), learnerKey: toLearnerKey };
        assertValid(validateRuntimeSession(updated), `runtime session ${JSON.stringify(updated.id)}`);
        return updated;
      });
      for (const session of updatedSessions) await this.persistSession(queryable, session);
      return updatedSessions.length;
    });
  }

  async deleteLearnerRuntime(stageId: string, learnerKey: string): Promise<void> {
    if (!isPgQueryableKey(stageId) || !isPgQueryableKey(learnerKey)) return;
    await this.queryable.query('DELETE FROM runtime_sessions WHERE stage_id = $1 AND learner_key = $2', [
      stageId,
      learnerKey,
    ]);
  }

  async deleteStageRuntime(stageId: string): Promise<void> {
    if (!isPgQueryableKey(stageId)) return;
    await this.queryable.query('DELETE FROM runtime_sessions WHERE stage_id = $1', [stageId]);
  }

  async deleteAllRuntime(): Promise<void> {
    await this.queryable.query('DELETE FROM runtime_sessions');
  }
}
