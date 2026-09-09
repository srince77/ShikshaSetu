/** Shared, memoized `AgentSessionStore` instance over the connection pool. */
import { getPool } from '@/db/client';
import { PgAgentSessionStore } from '@/lib/db/agent-session-store';
import { nodePostgresTransaction } from '@/lib/db/pg-types';
import type { AgentSessionStore } from '@/lib/contracts/agent-session';

let store: AgentSessionStore | undefined;

export function getAgentSessionStore(): AgentSessionStore {
  store ??= new PgAgentSessionStore(getPool(), {
    withTransaction: nodePostgresTransaction(getPool()),
  });
  return store;
}
