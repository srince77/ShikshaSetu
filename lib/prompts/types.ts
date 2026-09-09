/**
 * Simplified prompt system type definitions
 */

/**
 * Prompt template identifier.
 *
 * Trimmed to the agent/director prompts orchestration needs; the outline
 * and web-search prompt families live in packages/generation instead.
 */
export type PromptId =
  | 'agent-system'
  | 'agent-system-wb-teacher'
  | 'agent-system-wb-assistant'
  | 'agent-system-wb-student'
  | 'director';

/**
 * Snippet identifier
 */
export type SnippetId = 'speech-guidelines' | 'whiteboard-reference';

/**
 * Loaded prompt template
 */
export interface LoadedPrompt {
  id: PromptId;
  systemPrompt: string;
  userPromptTemplate: string;
}
