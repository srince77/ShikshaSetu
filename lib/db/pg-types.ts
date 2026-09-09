/**
 * The minimal PostgreSQL query surface every store in `lib/db/*` depends on,
 * kept driver-shaped but import-free so nothing here couples to `pg` beyond
 * structural typing.
 *
 * `withTransaction` must check out a fresh connection, open a transaction,
 * pin every query in `body` to that connection, then commit or roll back and
 * release it. READ COMMITTED isolation is assumed throughout. A shortcut
 * such as `(body) => body(sharedClient)` is unsafe: concurrent calls would
 * interleave inside one transaction.
 */
import type { Pool } from 'pg';

export interface QueryResult<TRow extends Record<string, unknown> = Record<string, unknown>> {
  rows: TRow[];
}

export interface Queryable {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<TRow>>;
}

export type WithTransaction = <T>(body: (queryable: Queryable) => Promise<T>) => Promise<T>;

/** Build a `WithTransaction` over a real node-postgres pool. */
export function nodePostgresTransaction(pool: Pool): WithTransaction {
  return async (body) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}
