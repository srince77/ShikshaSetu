/**
 * Shared types for orchestration: whiteboard action ledger, agent turn
 * summaries, the fixed-classroom agent config, and the request/event shapes
 * the director graph and session runner operate on.
 *
 * The reference implementation's request/state types (`StatelessChatRequest`
 * etc.) live inside a much larger chat-widget/Pi-director type system that
 * isn't part of this port. These are a trimmed, self-contained equivalent
 * covering exactly what the director graph and its prompt builders read:
 * course/scene state, whiteboard state, and per-turn agent output.
 */

import type { Action, GeneratedAgentConfig, Scene, Stage, StageMode } from '@/lib/contracts/scene';
import type { CompleteSceneContent } from '@shikshasetu/generation';

/**
 * A single whiteboard action performed by an agent, recorded in the ledger.
 */
export interface WhiteboardActionRecord {
  actionName:
    | 'wb_draw_text'
    | 'wb_draw_shape'
    | 'wb_draw_chart'
    | 'wb_draw_latex'
    | 'wb_draw_table'
    | 'wb_draw_line'
    | 'wb_draw_code'
    | 'wb_edit_code'
    | 'wb_clear'
    | 'wb_delete'
    | 'wb_open'
    | 'wb_close';
  agentId: string;
  agentName: string;
  params: Record<string, unknown>;
}

/**
 * Summary of an agent's turn in the current round.
 */
export interface AgentTurnSummary {
  agentId: string;
  agentName: string;
  contentPreview: string;
  actionCount: number;
  whiteboardActions: WhiteboardActionRecord[];
  actionWarnings?: Array<{
    actionName?: string;
    reason: 'unknown_action' | 'invalid_params' | 'raw_structured_fallback';
    message: string;
  }>;
}

// ==================== Agent config ====================

// Action types available to agents (canonical source for role-based mapping)
export const WHITEBOARD_ACTIONS = [
  'wb_open',
  'wb_close',
  'wb_draw_text',
  'wb_draw_shape',
  'wb_draw_chart',
  'wb_draw_latex',
  'wb_draw_table',
  'wb_draw_line',
  'wb_draw_code',
  'wb_edit_code',
  'wb_clear',
  'wb_delete',
];

export const SLIDE_ACTIONS = ['spotlight', 'laser', 'play_video'];

/**
 * Maps agent roles to their allowed action sets.
 * Teachers get slide + whiteboard control; others get whiteboard only.
 */
export const ROLE_ACTIONS: Record<string, string[]> = {
  teacher: [...SLIDE_ACTIONS, ...WHITEBOARD_ACTIONS],
  assistant: [...WHITEBOARD_ACTIONS],
  student: [...WHITEBOARD_ACTIONS],
};

/** Get the default allowed actions for a role, falling back to whiteboard-only. */
export function getActionsForRole(role: string): string[] {
  return ROLE_ACTIONS[role] || [...WHITEBOARD_ACTIONS];
}

/**
 * A single agent in the (fixed, 2-3 agent) classroom roster. Extends the
 * DSL's persisted `GeneratedAgentConfig` with the session-scoped
 * `allowedActions` list, which is a runtime concept, not part of the
 * document schema.
 */
export interface AgentConfig extends GeneratedAgentConfig {
  allowedActions: string[];
}

// ==================== Request / store state ====================

export interface OrchestrationMessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface OrchestrationMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  parts?: OrchestrationMessagePart[];
  metadata?: { agentId?: string; senderName?: string; interrupted?: boolean };
}

export interface QuizResultsState {
  sceneId: string;
  answers: Record<string, string | string[]>;
  results: Array<{
    questionId: string;
    correct: boolean | null;
    status: 'correct' | 'incorrect';
    earned: number;
    aiComment?: string;
  }>;
}

/** A scene as the orchestration graph sees it: any of the four content kinds. */
export type OrchestrationScene = Scene<Action, CompleteSceneContent>;

export interface OrchestrationStoreState {
  stage: Stage | null;
  scenes: OrchestrationScene[];
  currentSceneId: string | null;
  mode: StageMode;
  whiteboardOpen: boolean;
  quizResults?: QuizResultsState;
}

export interface DirectorState {
  turnCount: number;
  agentResponses: AgentTurnSummary[];
  whiteboardLedger: WhiteboardActionRecord[];
}

export interface OrchestrationRequest {
  /** Conversation history (caller-maintained; session-runner sources this from the AgentSessionStore event log). */
  messages: OrchestrationMessage[];
  storeState: OrchestrationStoreState;
  config: {
    agentIds: string[];
    discussionTopic?: string;
    discussionPrompt?: string;
    triggerAgentId?: string;
    /** Request-scoped agent configs for the fixed classroom roster. */
    agentConfigs?: AgentConfig[];
  };
  userProfile?: { nickname?: string; bio?: string };
  /** Accumulated director state from the previous turn (this graph runs one round per call). */
  directorState?: DirectorState;
}

// ==================== Streamed events ====================

export type OrchestrationEvent =
  | { type: 'thinking'; data: { stage: 'director' } | { stage: 'agent_loading'; agentId: string } }
  | { type: 'cue_user'; data: { fromAgentId?: string } }
  | {
      type: 'agent_start';
      data: { messageId: string; agentId: string; agentName: string; agentAvatar?: string; agentColor?: string };
    }
  | { type: 'text_delta'; data: { content: string; messageId: string } }
  | {
      type: 'action';
      data: {
        actionId: string;
        actionName: string;
        params: Record<string, unknown>;
        agentId: string;
        messageId: string;
      };
    }
  | { type: 'agent_end'; data: { messageId: string; agentId: string } }
  | { type: 'error'; data: { message: string } }
  | {
      type: 'done';
      data: { totalActions: number; totalAgents: number; agentHadContent: boolean; directorState: DirectorState };
    };
