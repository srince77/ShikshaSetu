/**
 * PostgreSQL backend for durable agent sessions — lifecycle, lease/attempt
 * coordination, and the append-only event log, against the tables
 * `db/migrations/0003_agent_session_store.sql` already created
 * (`agent_sessions`, `agent_session_events`; the entry-tree and
 * owner-projection companion tables in that migration are not used by this
 * store — see the note at the bottom of this file).
 *
 * Implements `AgentSessionStore` from the frozen `lib/contracts/agent-session.ts`
 * exactly: this is the seam `lib/orchestration/session-runner.ts` calls
 * through, never SQL directly. Everything here is persistence/lifecycle —
 * what a session *does* each turn belongs to that runner, not this store.
 */
import { randomUUID } from 'node:crypto';

import type {
  AgentSessionMeta,
  AgentSessionStatus,
  AgentSessionStore,
} from '@/lib/contracts/agent-session';
import type { Queryable, WithTransaction } from './pg-types';

interface SessionRow extends Record<string, unknown> {
  id: string;
  owner_id: string;
  prompt: string;
  title: string | null;
  stage_id: string;
  status: AgentSessionStatus;
  attempt: number;
  delivered_user_message_seq: number;
  lease_worker_id: string | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const SESSION_COLUMNS = `id, owner_id, prompt, title, stage_id, status, attempt,
  delivered_user_message_seq, lease_worker_id, error, created_at, updated_at`;

function epoch(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function sessionMeta(row: SessionRow): AgentSessionMeta {
  return {
    id: row.id,
    ownerId: row.owner_id,
    prompt: row.prompt,
    ...(row.title ? { title: row.title } : {}),
    stageId: row.stage_id,
    status: row.status,
    attempt: Number(row.attempt),
    deliveredUserMessageSeq: Number(row.delivered_user_message_seq),
    createdAt: epoch(row.created_at),
    updatedAt: epoch(row.updated_at),
    ...(row.error ? { error: row.error } : {}),
  };
}

function encodeJson(value: unknown): string {
  const encoded = JSON.stringify(value === undefined ? null : value);
  if (encoded === undefined) throw new TypeError('event data is not JSON-serializable');
  return encoded;
}

function decodeJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

export interface PgAgentSessionStoreOptions {
  withTransaction: WithTransaction;
  /** Test seams; production callers use the defaults. */
  createId?: () => string;
  now?: () => number;
}

/**
 * A lease-fenced write (`heartbeat`, `finishSession`) targeted a session this
 * worker no longer holds the lease on — reclaimed by another worker, or
 * never claimed by this one. The caller (the session runner) must stop
 * working the session rather than silently continue past the fence.
 */
export class AgentSessionLeaseLostError extends Error {
  override readonly name = 'AgentSessionLeaseLostError';
  constructor(
    readonly sessionId: string,
    readonly workerId: string,
  ) {
    super(`session ${JSON.stringify(sessionId)} lease was not held by worker ${JSON.stringify(workerId)}`);
  }
}

export class PgAgentSessionStore implements AgentSessionStore {
  private readonly queryable: Queryable;
  private readonly transactionHook: WithTransaction;
  private readonly createId: () => string;
  private readonly clock: () => number;

  constructor(queryable: Queryable, options: PgAgentSessionStoreOptions) {
    if (typeof options?.withTransaction !== 'function') {
      throw new Error(
        'withTransaction is required and must pin a fresh connection and transaction for every call',
      );
    }
    this.queryable = queryable;
    this.transactionHook = options.withTransaction;
    this.createId = options.createId ?? randomUUID;
    this.clock = options.now ?? Date.now;
  }

  private transaction<T>(body: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.transactionHook(body);
  }

  private async loadSession(
    queryable: Queryable,
    sessionId: string,
    lock = false,
  ): Promise<SessionRow | undefined> {
    const result = await queryable.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM agent_sessions
       WHERE id = $1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
      [sessionId],
    );
    return result.rows[0];
  }

  async createSession(input: {
    ownerId: string;
    prompt: string;
    stageId: string;
  }): Promise<AgentSessionMeta> {
    const id = this.createId();
    const result = await this.queryable.query<SessionRow>(
      `INSERT INTO agent_sessions (id, owner_id, prompt, stage_id, status, attempt)
       VALUES ($1, $2, $3, $4, 'queued', 0)
       RETURNING ${SESSION_COLUMNS}`,
      [id, input.ownerId, input.prompt, input.stageId],
    );
    return sessionMeta(result.rows[0]!);
  }

  async getSession(id: string): Promise<AgentSessionMeta | undefined> {
    const row = await this.loadSession(this.queryable, id);
    return row ? sessionMeta(row) : undefined;
  }

  async listSessionsByOwner(ownerId: string): Promise<AgentSessionMeta[]> {
    const result = await this.queryable.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM agent_sessions
       WHERE owner_id = $1 AND deleted_at IS NULL
       ORDER BY created_at, id`,
      [ownerId],
    );
    return result.rows.map(sessionMeta);
  }

  /**
   * Append one event under the session's row lock, so the per-session `seq`
   * assignment is race-free without a separate sequence object: the lock
   * serializes concurrent appenders, and `MAX(seq)+1` is computed and
   * inserted inside the same transaction that holds it.
   */
  async appendEvent(sessionId: string, type: string, data: unknown): Promise<void> {
    await this.transaction(async (tx) => {
      const session = await this.loadSession(tx, sessionId, true);
      if (!session) throw new Error(`unknown session ${JSON.stringify(sessionId)}`);
      await tx.query(
        `INSERT INTO agent_session_events (session_id, seq, ts, attempt, type, data)
         SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, $4, $5::jsonb
           FROM agent_session_events WHERE session_id = $1`,
        [sessionId, this.clock(), Number(session.attempt), type, encodeJson(data)],
      );
    });
  }

  async readEventsAfter(
    sessionId: string,
    afterSeq: number,
  ): Promise<Array<{ seq: number; type: string; data: unknown }>> {
    const result = await this.queryable.query<{ seq: number; type: string; data: unknown }>(
      `SELECT e.seq, e.type, e.data
         FROM agent_session_events e
         INNER JOIN agent_sessions s ON s.id = e.session_id
        WHERE e.session_id = $1 AND e.seq > $2 AND s.deleted_at IS NULL
        ORDER BY e.seq ASC`,
      [sessionId, afterSeq],
    );
    return result.rows.map((row) => ({ seq: Number(row.seq), type: row.type, data: decodeJson(row.data) }));
  }

  /**
   * Settle a cancel-requested candidate the claim scan just encountered,
   * mirroring what an explicit cancel does mid-run: terminal `cancelled`,
   * attempt reset, cancel request cleared, and a `session_end` event so the
   * transcript shows the terminal transition even though no lease holder
   * ever ran this attempt.
   */
  private async settleCancelledAtClaim(tx: Queryable, sessionId: string, attempt: number): Promise<void> {
    const now = this.clock();
    const result = await tx.query<{ id: string }>(
      `UPDATE agent_sessions
          SET status = 'cancelled', attempt = 0, error = NULL,
              lease_worker_id = NULL, lease_worker_pid = NULL, lease_heartbeat_at = NULL,
              cancel_requested_at = NULL, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL AND cancel_requested_at IS NOT NULL
      RETURNING id`,
      [sessionId],
    );
    if (result.rows.length === 0) return;
    await tx.query(
      `INSERT INTO agent_session_events (session_id, seq, ts, attempt, type, data)
       SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, 'session_end', $4::jsonb
         FROM agent_session_events WHERE session_id = $1`,
      [sessionId, now, attempt, encodeJson({ status: 'cancelled' })],
    );
  }

  /**
   * Scan optimistically, then lock and recheck one candidate — the second
   * check is the authority; candidate snapshots are stale as soon as read.
   *
   * Attempt charging is per takeover: a queued claim or the takeover of an
   * abandoned (non-null, stale) lease consumes one attempt; the takeover of
   * a cleanly-released (null) lease consumes none. A candidate with a
   * pending cancel request is never leased — it is settled as `cancelled`
   * and skipped, so a restart can never resurrect a session the user
   * already cancelled.
   */
  async claimNextSession(
    workerId: string,
    workerPid: number,
    opts: { leaseTtlMs: number; maxAttempts: number },
  ): Promise<AgentSessionMeta | undefined> {
    const staleBefore = this.clock() - opts.leaseTtlMs;
    const candidates = await this.queryable.query<{ id: string }>(
      `SELECT id FROM agent_sessions
        WHERE deleted_at IS NULL
          AND (status = 'queued' OR
               (status = 'running'
                AND (lease_heartbeat_at IS NULL OR lease_heartbeat_at < $1)
                AND (lease_worker_id IS NULL OR lease_worker_id <> $2)))
          AND (attempt < $3 OR status = 'running')
        ORDER BY created_at LIMIT 5`,
      [staleBefore, workerId, opts.maxAttempts + 1],
    );

    for (const candidate of candidates.rows) {
      const claimed = await this.transaction(async (tx) => {
        const locked = await tx.query<{
          status: string;
          attempt: number;
          cancel_requested_at: number | string | Date | null;
        }>(
          `SELECT status, attempt, cancel_requested_at FROM agent_sessions
            WHERE id = $1 AND deleted_at IS NULL
              AND (status = 'queued' OR
                   (status = 'running'
                    AND (lease_heartbeat_at IS NULL OR lease_heartbeat_at < $2)
                    AND (lease_worker_id IS NULL OR lease_worker_id <> $3)))
              AND (attempt < $4 OR status = 'running')
          FOR UPDATE`,
          [candidate.id, staleBefore, workerId, opts.maxAttempts + 1],
        );
        const previous = locked.rows[0];
        if (!previous) return undefined;
        if (previous.cancel_requested_at !== null && previous.cancel_requested_at !== undefined) {
          await this.settleCancelledAtClaim(tx, candidate.id, Number(previous.attempt));
          return undefined;
        }
        // Every SET expression reads the locked pre-update row, so
        // lease_worker_id here still identifies the prior holder.
        const updated = await tx.query<SessionRow>(
          `UPDATE agent_sessions
              SET status = 'running',
                  attempt = attempt + CASE
                    WHEN status = 'queued'
                      OR (status = 'running' AND lease_worker_id IS NOT NULL) THEN 1
                    ELSE 0
                  END,
                  lease_worker_id = $2, lease_worker_pid = $3, lease_heartbeat_at = $4,
                  error = NULL, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL
          RETURNING ${SESSION_COLUMNS}`,
          [candidate.id, workerId, workerPid, this.clock()],
        );
        const row = updated.rows[0];
        return row ? sessionMeta(row) : undefined;
      });
      if (claimed) return claimed;
    }
    return undefined;
  }

  /** Throws {@link AgentSessionLeaseLostError} when this worker no longer holds the lease. */
  async heartbeat(sessionId: string, workerId: string): Promise<void> {
    const result = await this.queryable.query<{ id: string }>(
      `UPDATE agent_sessions
          SET lease_heartbeat_at = $3, updated_at = now()
        WHERE id = $1 AND lease_worker_id = $2 AND deleted_at IS NULL
      RETURNING id`,
      [sessionId, workerId, this.clock()],
    );
    if (result.rows.length === 0) throw new AgentSessionLeaseLostError(sessionId, workerId);
  }

  /**
   * Terminal write, fenced to the calling worker's active lease. Releases
   * the lease and, on a clean `succeeded`, resets the consecutive-failure
   * counter (a `failed`/`cancelled` ending preserves it so
   * {@link claimNextSession}'s `maxAttempts` gate stays meaningful across
   * retries). Throws {@link AgentSessionLeaseLostError} if the lease was
   * reclaimed by another worker in the meantime.
   */
  async finishSession(
    sessionId: string,
    workerId: string,
    status: AgentSessionStatus,
    error?: string,
  ): Promise<void> {
    const result = await this.queryable.query<{ id: string }>(
      `UPDATE agent_sessions
          SET status = $3, error = $4,
              attempt = CASE WHEN $3 = 'succeeded' THEN 0 ELSE attempt END,
              lease_worker_id = NULL, lease_worker_pid = NULL, lease_heartbeat_at = NULL,
              updated_at = now()
        WHERE id = $1 AND lease_worker_id = $2 AND deleted_at IS NULL
      RETURNING id`,
      [sessionId, workerId, status, error ?? null],
    );
    if (result.rows.length === 0) throw new AgentSessionLeaseLostError(sessionId, workerId);
  }

  /**
   * Post a user message. Delivered as `'steer'` into a live run, or
   * `'queued'` when the session is not currently running — in which case a
   * terminal session (`succeeded`/`failed`/`cancelled`) is revived: requeued
   * with its attempt counter reset (an attended retry, unlike the
   * unattended retries {@link claimNextSession} performs) and any pending
   * cancel request cleared.
   */
  async postUserMessage(
    sessionId: string,
    message: string,
  ): Promise<{ delivery: 'steer' | 'queued' }> {
    return this.transaction(async (tx) => {
      const session = await this.loadSession(tx, sessionId, true);
      if (!session) throw new Error(`unknown session ${JSON.stringify(sessionId)}`);
      const delivery: 'steer' | 'queued' = session.status === 'running' ? 'steer' : 'queued';

      await tx.query(
        `INSERT INTO agent_session_events (session_id, seq, ts, attempt, type, data)
         SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, 'user_message', $4::jsonb
           FROM agent_session_events WHERE session_id = $1`,
        [sessionId, this.clock(), Number(session.attempt), encodeJson({ text: message, delivery })],
      );

      if (delivery === 'queued' && session.status !== 'queued') {
        await tx.query(
          `UPDATE agent_sessions
              SET status = 'queued', attempt = 0, error = NULL, cancel_requested_at = NULL,
                  updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL`,
          [sessionId],
        );
      }
      return { delivery };
    });
  }

  async requestCancel(sessionId: string): Promise<void> {
    await this.queryable.query(
      `UPDATE agent_sessions
          SET cancel_requested_at = $2, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL AND cancel_requested_at IS NULL`,
      [sessionId, this.clock()],
    );
  }
}

/**
 * NOTE on scope: `db/migrations/0003_agent_session_store.sql` also
 * provisions `agent_session_entries` (the append-only replay/resume entry
 * tree), `agent_owner_session_event_counters` / `agent_owner_session_events`
 * (a sparse per-owner navigation projection), and `agent_session_urls` (a
 * per-session trusted-URL allowlist). The frozen `AgentSessionStore`
 * interface in `lib/contracts/agent-session.ts` exposes none of these, and
 * the session runner is specified to call only through that interface, not
 * SQL — so this store intentionally does not implement them; see the final
 * report for this as a flagged contract gap rather than a silent omission.
 * Those tables remain unused until the contract grows a seam for them.
 */
