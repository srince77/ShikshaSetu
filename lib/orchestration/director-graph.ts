/**
 * Director Graph — LangGraph StateGraph for Multi-Agent Orchestration
 *
 * Single-round graph topology:
 *
 *   START → director ──(end)──→ END
 *              │
 *              └─(next)→ agent_generate ──→ END
 *
 * Each request runs at most one director→agent cycle. The caller (session-runner)
 * serializes multiple requests to drive multi-agent discussions. There is no
 * maxTurns cap — the topology is the bound.
 *
 * The director node adapts its strategy based on agent count:
 *   - Single agent: pure code logic (no LLM). Dispatches the agent on
 *     turn 0, then cues the user on subsequent turns.
 *   - Multi agent: LLM-based decision (with a code fast-path for the turn-0
 *     trigger agent).
 *
 * Uses LangGraph's custom stream mode: each node pushes OrchestrationEvent
 * chunks via config.writer(), which session-runner forwards into the
 * AgentSessionStore event log.
 */

import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { LanguageModel } from 'ai';

import { AISdkLangGraphAdapter } from './ai-sdk-adapter';
import { buildStructuredPrompt } from './prompt-builder';
import { summarizeConversation } from './summarizers/conversation-summary';
import { convertMessagesToOpenAI } from './summarizers/message-converter';
import { buildDirectorPrompt, parseDirectorDecision } from './director-prompt';
import { getEffectiveActions } from './tool-schemas';
import {
  parseStructuredChunk,
  createParserState,
  finalizeParser,
} from './structured-output-parser';
import type {
  AgentConfig,
  AgentTurnSummary,
  OrchestrationEvent,
  OrchestrationRequest,
  WhiteboardActionRecord,
} from './types';

// ==================== State Definition ====================

/**
 * LangGraph state annotation for the orchestration graph
 */
const OrchestratorState = Annotation.Root({
  // Input (set once at graph entry)
  messages: Annotation<OrchestrationRequest['messages']>,
  storeState: Annotation<OrchestrationRequest['storeState']>,
  availableAgentIds: Annotation<string[]>,
  languageModel: Annotation<LanguageModel>,
  discussionContext: Annotation<{ topic: string; prompt?: string } | null>,
  triggerAgentId: Annotation<string | null>,
  userProfile: Annotation<{ nickname?: string; bio?: string } | null>,
  /** Request-scoped agent configs — this platform's fixed 2-3 agent classroom roster. */
  agentConfigOverrides: Annotation<Record<string, AgentConfig>>,

  // Mutable (updated by nodes)
  currentAgentId: Annotation<string | null>,
  turnCount: Annotation<number>,
  agentResponses: Annotation<AgentTurnSummary[]>({
    reducer: (prev, update) => [...prev, ...update],
    default: () => [],
  }),
  whiteboardLedger: Annotation<WhiteboardActionRecord[]>({
    reducer: (prev, update) => [...prev, ...update],
    default: () => [],
  }),
  shouldEnd: Annotation<boolean>,
  totalActions: Annotation<number>,
});

type OrchestratorStateType = typeof OrchestratorState.State;

/**
 * Look up an agent config from the request-scoped roster. Unlike the
 * reference implementation, there is no global mutable agent registry here —
 * this platform's classroom has a fixed 2-3 agent roster supplied on every
 * request (session-runner owns building it).
 */
function resolveAgent(state: OrchestratorStateType, agentId: string): AgentConfig | undefined {
  return state.agentConfigOverrides[agentId];
}

// ==================== Director Node ====================

/**
 * Unified director: decides which agent speaks next.
 *
 * Strategy varies by agent count:
 *   Single agent — pure code logic, zero LLM calls:
 *     turn 0: dispatch the sole agent
 *     turn 1+: cue user to speak (keeps session active for follow-ups)
 *
 *   Multi agent — LLM-based with code fast-paths:
 *     turn 0 + triggerAgentId: dispatch trigger agent (skip LLM)
 *     otherwise: LLM decides next agent / USER / END
 */
async function directorNode(
  state: OrchestratorStateType,
  config: LangGraphRunnableConfig,
): Promise<Partial<OrchestratorStateType>> {
  const rawWrite = config.writer as (chunk: OrchestrationEvent) => void;
  const write = (chunk: OrchestrationEvent) => {
    try {
      rawWrite(chunk);
    } catch {
      /* consumer closed after abort */
    }
  };
  const isSingleAgent = state.availableAgentIds.length <= 1;

  // ── Single agent: code-only director ──
  if (isSingleAgent) {
    const agentId = state.availableAgentIds[0] || 'default-1';

    if (state.turnCount === 0) {
      // First turn: dispatch the agent
      write({ type: 'thinking', data: { stage: 'agent_loading', agentId } });
      return { currentAgentId: agentId, shouldEnd: false };
    }

    // Agent already responded: cue user for follow-up
    write({ type: 'cue_user', data: { fromAgentId: agentId } });
    return { shouldEnd: true };
  }

  // ── Multi agent: fast-path for first turn with trigger ──
  if (state.turnCount === 0 && state.triggerAgentId) {
    const triggerId = state.triggerAgentId;
    if (state.availableAgentIds.includes(triggerId)) {
      write({
        type: 'thinking',
        data: { stage: 'agent_loading', agentId: triggerId },
      });
      return { currentAgentId: triggerId, shouldEnd: false };
    }
  }

  // ── Multi agent: LLM-based decision ──
  const agents: AgentConfig[] = state.availableAgentIds
    .map((id) => resolveAgent(state, id))
    .filter((a): a is AgentConfig => a != null);

  if (agents.length === 0) {
    return { shouldEnd: true };
  }

  write({ type: 'thinking', data: { stage: 'director' } });

  const openaiMessages = convertMessagesToOpenAI(state.messages);
  const conversationSummary = summarizeConversation(openaiMessages);

  const prompt = buildDirectorPrompt(
    agents,
    conversationSummary,
    state.agentResponses,
    state.turnCount,
    state.discussionContext,
    state.triggerAgentId,
    state.whiteboardLedger,
    state.userProfile || undefined,
    state.storeState.whiteboardOpen,
  );

  const adapter = new AISdkLangGraphAdapter(state.languageModel);

  try {
    const result = await adapter._generate(
      [new SystemMessage(prompt), new HumanMessage('Decide which agent should speak next.')],
      { signal: config.signal } as Record<string, unknown>,
    );

    const content = result.generations[0]?.text || '';
    const decision = parseDirectorDecision(content);

    if (decision.shouldEnd || !decision.nextAgentId) {
      return { shouldEnd: true };
    }

    if (decision.nextAgentId === 'USER') {
      write({
        type: 'cue_user',
        data: { fromAgentId: state.currentAgentId || undefined },
      });
      return { shouldEnd: true };
    }

    const agentExists = agents.some((a) => a.id === decision.nextAgentId);
    if (!agentExists) {
      return { shouldEnd: true };
    }

    write({
      type: 'thinking',
      data: { stage: 'agent_loading', agentId: decision.nextAgentId },
    });

    return {
      currentAgentId: decision.nextAgentId,
      shouldEnd: false,
    };
  } catch (error) {
    console.error('[DirectorGraph] director decision failed:', error);
    return { shouldEnd: true };
  }
}

function directorCondition(state: OrchestratorStateType): 'agent_generate' | typeof END {
  return state.shouldEnd ? END : 'agent_generate';
}

// ==================== Agent Generate Node ====================

/**
 * Run generation for one agent. Streams agent_start, text_delta,
 * action, and agent_end events via config.writer().
 */
async function runAgentGeneration(
  state: OrchestratorStateType,
  agentId: string,
  config: LangGraphRunnableConfig,
): Promise<{
  contentPreview: string;
  actionCount: number;
  whiteboardActions: WhiteboardActionRecord[];
}> {
  const agentConfig = resolveAgent(state, agentId);
  if (!agentConfig) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const rawWrite = config.writer as (chunk: OrchestrationEvent) => void;
  const write = (chunk: OrchestrationEvent) => {
    try {
      rawWrite(chunk);
    } catch (e) {
      console.warn(`[DirectorGraph] write failed for ${agentId}:`, e);
    }
  };
  const messageId = `assistant-${agentId}-${Date.now()}`;

  write({
    type: 'agent_start',
    data: {
      messageId,
      agentId,
      agentName: agentConfig.name,
      agentAvatar: agentConfig.avatar,
      agentColor: agentConfig.color,
    },
  });

  // Compute effective actions: filter by scene type for defense-in-depth
  // e.g. spotlight/laser stripped for non-slide scenes even if in static allowedActions
  const currentScene = state.storeState.currentSceneId
    ? state.storeState.scenes.find((s) => s.id === state.storeState.currentSceneId)
    : undefined;
  const sceneType = currentScene?.type;
  const effectiveActions = getEffectiveActions(agentConfig.allowedActions, sceneType);

  const discussionContext = state.discussionContext || undefined;
  const systemPrompt = buildStructuredPrompt(
    agentConfig,
    state.storeState,
    discussionContext,
    state.whiteboardLedger,
    state.userProfile || undefined,
    state.agentResponses,
  );
  const openaiMessages = convertMessagesToOpenAI(state.messages, agentId);
  const adapter = new AISdkLangGraphAdapter(state.languageModel);

  const lcMessages = [
    new SystemMessage(systemPrompt),
    ...openaiMessages.map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    ),
  ];

  // Ensure the message list ends with a HumanMessage.
  const lastMsg = lcMessages[lcMessages.length - 1];
  if (!lcMessages.some((m) => m instanceof HumanMessage)) {
    lcMessages.push(new HumanMessage('Please begin.'));
  } else if (lastMsg instanceof AIMessage) {
    lcMessages.push(new HumanMessage("It's your turn to speak. Respond from your perspective."));
  }

  const parserState = createParserState();
  let fullText = '';
  let actionCount = 0;
  const whiteboardActions: WhiteboardActionRecord[] = [];

  try {
    for await (const chunk of adapter.streamGenerate(lcMessages, {
      signal: config.signal,
    })) {
      if (chunk.type === 'delta') {
        const parseResult = parseStructuredChunk(chunk.content, parserState);

        let emittedTextCount = 0;
        for (const entry of parseResult.ordered) {
          if (entry.type === 'text') {
            const rawText = parseResult.textChunks[entry.index];
            if (!rawText) continue;
            const text = rawText.replace(/^>+\s?/gm, '');
            if (!text) continue;
            fullText += text;
            write({
              type: 'text_delta',
              data: { content: text, messageId },
            });
            emittedTextCount++;
          } else if (entry.type === 'action') {
            const ac = parseResult.actions[entry.index];
            if (!ac) continue;
            if (!effectiveActions.includes(ac.actionName)) {
              continue;
            }
            actionCount++;
            if (ac.actionName.startsWith('wb_')) {
              whiteboardActions.push({
                actionName: ac.actionName as WhiteboardActionRecord['actionName'],
                agentId,
                agentName: agentConfig.name,
                params: ac.params,
              });
            }
            write({
              type: 'action',
              data: {
                actionId: ac.actionId,
                actionName: ac.actionName,
                params: ac.params,
                agentId,
                messageId,
              },
            });
          }
        }

        // Emit trailing partial text deltas not covered by ordered
        for (let i = emittedTextCount; i < parseResult.textChunks.length; i++) {
          const rawText = parseResult.textChunks[i];
          if (!rawText) continue;
          const text = rawText.replace(/^>+\s?/gm, '');
          if (!text) continue;
          fullText += text;
          write({
            type: 'text_delta',
            data: { content: text, messageId },
          });
        }
      }
    }

    // Finalize: emit any remaining content if the model didn't produce valid JSON
    const finalResult = finalizeParser(parserState);
    for (const entry of finalResult.ordered) {
      if (entry.type === 'text') {
        const rawText = finalResult.textChunks[entry.index];
        if (!rawText) continue;
        const text = rawText.replace(/^>+\s?/gm, '');
        if (!text) continue;
        fullText += text;
        write({
          type: 'text_delta',
          data: { content: text, messageId },
        });
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    console.error(`[DirectorGraph] generation failed for ${agentConfig.name}:`, error);
    write({
      type: 'error',
      data: { message: error instanceof Error ? error.message : String(error) },
    });
  }

  write({
    type: 'agent_end',
    data: { messageId, agentId },
  });

  return {
    contentPreview: fullText.slice(0, 300),
    actionCount,
    whiteboardActions,
  };
}

/**
 * Agent generate node — runs one agent, then loops back to director.
 */
async function agentGenerateNode(
  state: OrchestratorStateType,
  config: LangGraphRunnableConfig,
): Promise<Partial<OrchestratorStateType>> {
  const agentId = state.currentAgentId;
  if (!agentId) {
    return { shouldEnd: true };
  }

  const agentConfig = resolveAgent(state, agentId);
  const result = await runAgentGeneration(state, agentId, config);

  return {
    turnCount: state.turnCount + 1,
    totalActions: state.totalActions + result.actionCount,
    agentResponses: [
      {
        agentId,
        agentName: agentConfig?.name || agentId,
        contentPreview: result.contentPreview,
        actionCount: result.actionCount,
        whiteboardActions: result.whiteboardActions,
      },
    ],
    whiteboardLedger: result.whiteboardActions,
    currentAgentId: null,
  };
}

// ==================== Graph Construction ====================

/**
 * Create the orchestration LangGraph StateGraph.
 *
 * Topology:
 *   START → director ──(end)──→ END
 *              │
 *              └─(next)→ agent_generate ──→ END
 *
 * Single-round contract: each request runs at most one director→agent cycle.
 * Multi-agent discussions arise from the caller serializing requests; the
 * graph itself does not loop. There is no `maxTurns` — the topology itself
 * is the bound.
 */
export function createOrchestrationGraph() {
  const graph = new StateGraph(OrchestratorState)
    .addNode('director', directorNode)
    .addNode('agent_generate', agentGenerateNode)
    .addEdge(START, 'director')
    .addConditionalEdges('director', directorCondition, {
      agent_generate: 'agent_generate',
      [END]: END,
    })
    .addEdge('agent_generate', END);

  return graph.compile();
}

/**
 * Build initial state for the orchestration graph from an
 * OrchestrationRequest and a pre-resolved LanguageModel instance.
 */
export function buildInitialState(
  request: OrchestrationRequest,
  languageModel: LanguageModel,
): typeof OrchestratorState.State {
  const agentConfigOverrides: Record<string, AgentConfig> = {};
  for (const cfg of request.config.agentConfigs ?? []) {
    agentConfigOverrides[cfg.id] = cfg;
  }

  const discussionContext = request.config.discussionTopic
    ? {
        topic: request.config.discussionTopic,
        prompt: request.config.discussionPrompt,
      }
    : null;

  const incoming = request.directorState;
  const turnCount = incoming?.turnCount ?? 0;

  return {
    messages: request.messages,
    storeState: request.storeState,
    availableAgentIds: request.config.agentIds,
    languageModel,
    discussionContext,
    triggerAgentId: request.config.triggerAgentId || null,
    userProfile: request.userProfile || null,
    agentConfigOverrides,
    currentAgentId: null,
    turnCount,
    agentResponses: incoming?.agentResponses ?? [],
    whiteboardLedger: incoming?.whiteboardLedger ?? [],
    shouldEnd: false,
    totalActions: 0,
  };
}
