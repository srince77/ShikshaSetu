/**
 * Session runner: the domain-logic driver for what an agent session does
 * each turn.
 *
 * Zero SQL here — persistence goes entirely through the `AgentSessionStore`
 * interface from `lib/contracts/agent-session.ts` (implemented elsewhere,
 * against real Postgres). This file only:
 *   1. Reconstructs the conversation + prior director state from the
 *      session's append-only event log.
 *   2. Resolves the fixed classroom roster and course/scene state for the
 *      session's stage.
 *   3. Runs one director -> agent_generate round through the LangGraph
 *      orchestration graph (director-graph.ts), forwarding every streamed
 *      event into the event log as it happens.
 *   4. Persists the updated director state so the next turn (the next
 *      claimed run of this session, after a `postUserMessage`) picks up
 *      where this one left off.
 *
 * Note on scope: there is no frozen contract yet for the live
 * playback/whiteboard state a running classroom carries (unlike
 * `AgentSessionStore`, and `lib/playback/*` is another agent's ownership) —
 * `resolveDefaultClassroomState` below is a reasonable stand-in (stage +
 * every generated scene, most-recent scene as "current", whiteboard
 * closed) that should be replaced by a real read once that contract exists.
 */

import type { LanguageModel } from 'ai';
import type { AgentSessionMeta, AgentSessionStore } from '@/lib/contracts/agent-session';
import type { AgentInfo } from '@shikshasetu/generation';
import { getModel } from '@/lib/ai/providers';
import { getStage, listScenes } from '@/lib/generation/document-store';
import { DEFAULT_CLASSROOM_AGENTS } from '@/lib/generation/classroom-generation';
import { createOrchestrationGraph, buildInitialState } from './director-graph';
import { getActionsForRole } from './types';
import type {
  AgentConfig,
  DirectorState,
  OrchestrationEvent,
  OrchestrationMessage,
  OrchestrationRequest,
  OrchestrationScene,
  OrchestrationStoreState,
  WhiteboardActionRecord,
} from './types';

// ==================== Fixed classroom roster ====================

const AVATAR_BY_ROLE: Record<string, string> = {
  teacher: '🧑‍🏫',
  assistant: '🧑‍💼',
  student: '🧑‍🎓',
};
const COLOR_BY_ROLE: Record<string, string> = {
  teacher: '#4f46e5',
  assistant: '#0ea5e9',
  student: '#10b981',
};
const PRIORITY_BY_ROLE: Record<string, number> = { teacher: 10, assistant: 7, student: 5 };

function toAgentConfig(agent: AgentInfo): AgentConfig {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    persona: agent.persona || '',
    avatar: AVATAR_BY_ROLE[agent.role] || '🙂',
    color: COLOR_BY_ROLE[agent.role] || '#666666',
    priority: PRIORITY_BY_ROLE[agent.role] ?? 5,
    allowedActions: getActionsForRole(agent.role),
  };
}

/**
 * Resolve the fixed 2-agent roster and the course/scene state a session's
 * stage currently has. Every scene generated so far is included; the most
 * recently created one is treated as "current" absent a real playback
 * position signal.
 */
async function resolveDefaultClassroomState(
  stageId: string,
): Promise<{ agentConfigs: AgentConfig[]; storeState: OrchestrationStoreState }> {
  const [stage, scenes] = await Promise.all([getStage(stageId), listScenes(stageId)]);
  const agentConfigs = DEFAULT_CLASSROOM_AGENTS.map(toAgentConfig);

  const storeState: OrchestrationStoreState = {
    stage: stage ?? null,
    scenes: scenes as OrchestrationScene[],
    currentSceneId: scenes.at(-1)?.id ?? null,
    mode: 'autonomous',
    whiteboardOpen: false,
  };

  return { agentConfigs, storeState };
}

// ==================== Event log <-> graph state ====================

interface StoredEvent {
  seq: number;
  type: string;
  data: unknown;
}

/** Rebuild the message history and last-persisted director state from the event log. */
function reconstructFromEvents(events: StoredEvent[]): {
  messages: OrchestrationMessage[];
  directorState?: DirectorState;
} {
  const agentTurns = new Map<string, { agentId: string; agentName: string; text: string }>();
  const order: Array<{ kind: 'user'; content: string } | { kind: 'agent'; messageId: string }> = [];
  let directorState: DirectorState | undefined;

  for (const event of events) {
    switch (event.type) {
      case 'user_message': {
        const data = event.data as { content: string };
        order.push({ kind: 'user', content: data.content });
        break;
      }
      case 'agent_start': {
        const data = event.data as { messageId: string; agentId: string; agentName: string };
        agentTurns.set(data.messageId, { agentId: data.agentId, agentName: data.agentName, text: '' });
        order.push({ kind: 'agent', messageId: data.messageId });
        break;
      }
      case 'text_delta': {
        const data = event.data as { messageId: string; content: string };
        const turn = agentTurns.get(data.messageId);
        if (turn) turn.text += data.content;
        break;
      }
      case 'director_state':
        directorState = event.data as DirectorState;
        break;
      default:
        break;
    }
  }

  const messages: OrchestrationMessage[] = [];
  for (const item of order) {
    if (item.kind === 'user') {
      messages.push({ role: 'user', parts: [{ type: 'text', text: item.content }] });
      continue;
    }
    const turn = agentTurns.get(item.messageId);
    if (!turn || !turn.text) continue;
    messages.push({
      role: 'assistant',
      parts: [{ type: 'text', text: turn.text }],
      metadata: { agentId: turn.agentId, senderName: turn.agentName },
    });
  }

  return { messages, directorState };
}

// ==================== Turn driver ====================

export interface SessionRunnerDeps {
  store: AgentSessionStore;
  /** Defaults to a freshly resolved Bedrock model; inject to reuse one across turns/tests. */
  languageModel?: LanguageModel;
}

/**
 * Run exactly one director -> agent_generate round for a session, forwarding
 * every streamed event into the session's event log and persisting the
 * updated director state at the end.
 */
export async function runAgentSessionTurn(
  deps: SessionRunnerDeps,
  session: AgentSessionMeta,
): Promise<void> {
  const { store } = deps;
  const languageModel = deps.languageModel ?? getModel();

  const priorEvents = await store.readEventsAfter(session.id, 0);
  const { messages: priorMessages, directorState } = reconstructFromEvents(priorEvents);

  if (priorEvents.length === 0) {
    // Seed the log with the session's opening prompt as the first user turn.
    await store.appendEvent(session.id, 'user_message', { content: session.prompt });
  }

  const messages: OrchestrationMessage[] =
    priorMessages.length > 0
      ? priorMessages
      : [{ role: 'user', parts: [{ type: 'text', text: session.prompt }] }];

  const { agentConfigs, storeState } = await resolveDefaultClassroomState(session.stageId);

  const request: OrchestrationRequest = {
    messages,
    storeState,
    config: {
      agentIds: agentConfigs.map((a) => a.id),
      agentConfigs,
    },
    directorState,
  };

  const graph = createOrchestrationGraph();
  const initialState = buildInitialState(request, languageModel);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph's custom stream mode typing
  const stream = await graph.stream(initialState, { streamMode: 'custom' as any });

  let totalAgents = 0;
  let currentAgentId: string | null = null;
  let currentAgentName: string | null = null;
  let contentPreview = '';
  let agentActionCount = 0;
  const agentWbActions: WhiteboardActionRecord[] = [];

  for await (const chunk of stream) {
    const event = chunk as OrchestrationEvent;
    await store.appendEvent(session.id, event.type, event.data);

    if (event.type === 'agent_start') {
      totalAgents += 1;
      currentAgentId = event.data.agentId;
      currentAgentName = event.data.agentName;
      contentPreview = '';
      agentActionCount = 0;
      agentWbActions.length = 0;
    }
    if (event.type === 'text_delta' && contentPreview.length < 100) {
      contentPreview = (contentPreview + event.data.content).slice(0, 100);
    }
    if (event.type === 'action') {
      agentActionCount += 1;
      if (event.data.actionName.startsWith('wb_')) {
        agentWbActions.push({
          actionName: event.data.actionName as WhiteboardActionRecord['actionName'],
          agentId: event.data.agentId,
          agentName: currentAgentName || event.data.agentId,
          params: event.data.params,
        });
      }
    }
  }

  const prevResponses = directorState?.agentResponses ?? [];
  const prevLedger = directorState?.whiteboardLedger ?? [];
  const prevTurnCount = directorState?.turnCount ?? 0;

  const nextDirectorState: DirectorState =
    totalAgents > 0 && currentAgentId
      ? {
          turnCount: prevTurnCount + 1,
          agentResponses: [
            ...prevResponses,
            {
              agentId: currentAgentId,
              agentName: currentAgentName || currentAgentId,
              contentPreview,
              actionCount: agentActionCount,
              whiteboardActions: [...agentWbActions],
            },
          ],
          whiteboardLedger: [...prevLedger, ...agentWbActions],
        }
      : { turnCount: prevTurnCount, agentResponses: prevResponses, whiteboardLedger: prevLedger };

  await store.appendEvent(session.id, 'director_state', nextDirectorState);
}

// ==================== Worker loop ====================

/**
 * Claim the next queued session (if any) and run one turn to completion,
 * heartbeating for the duration so other workers don't steal the lease.
 * Returns false when there was nothing to claim.
 */
export async function claimAndRunNextSession(
  deps: SessionRunnerDeps,
  workerId: string,
  workerPid: number,
): Promise<boolean> {
  const session = await deps.store.claimNextSession(workerId, workerPid, {
    leaseTtlMs: 60_000,
    maxAttempts: 3,
  });
  if (!session) return false;

  const heartbeat = setInterval(() => {
    deps.store.heartbeat(session.id, workerId).catch((err) => {
      console.warn(`[SessionRunner] heartbeat failed for ${session.id}:`, err);
    });
  }, 15_000);

  try {
    await runAgentSessionTurn(deps, session);
    await deps.store.finishSession(session.id, workerId, 'succeeded');
  } catch (error) {
    console.error(`[SessionRunner] session ${session.id} failed:`, error);
    await deps.store.finishSession(
      session.id,
      workerId,
      'failed',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearInterval(heartbeat);
  }

  return true;
}
