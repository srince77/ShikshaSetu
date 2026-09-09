import { Pool } from 'pg';

// Use Neon's pooled connection string (the `-pooler` host), not the direct
// one: node-postgres's Pool doesn't behave well under high-concurrency
// serverless invocation churn, Neon's pgbouncer-backed pooler does.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}
