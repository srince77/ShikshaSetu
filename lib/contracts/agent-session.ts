// The seam between Agent A's persistence layer (lib/db/agent-session-store.ts,
// zero domain logic) and Agent B's session driver (lib/orchestration/session-runner.ts,
// zero SQL). Agent A implements this; Agent B only calls it.

export type AgentSessionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AgentSessionMeta {
  id: string;
  ownerId: string;
  prompt: string;
  title?: string;
  stageId: string;
  status: AgentSessionStatus;
  attempt: number;
  deliveredUserMessageSeq: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface AgentSessionStore {
  createSession(input: { ownerId: string; prompt: string; stageId: string }): Promise<AgentSessionMeta>;
  getSession(id: string): Promise<AgentSessionMeta | undefined>;
  listSessionsByOwner(ownerId: string): Promise<AgentSessionMeta[]>;
  appendEvent(sessionId: string, type: string, data: unknown): Promise<void>;
  readEventsAfter(sessionId: string, afterSeq: number): Promise<Array<{ seq: number; type: string; data: unknown }>>;
  claimNextSession(workerId: string, workerPid: number, opts: { leaseTtlMs: number; maxAttempts: number }): Promise<AgentSessionMeta | undefined>;
  heartbeat(sessionId: string, workerId: string): Promise<void>;
  finishSession(sessionId: string, workerId: string, status: AgentSessionStatus, error?: string): Promise<void>;
  postUserMessage(sessionId: string, message: string): Promise<{ delivery: 'steer' | 'queued' }>;
  requestCancel(sessionId: string): Promise<void>;
}
