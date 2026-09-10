import type { PromptId } from './types.js';

export type { LoadedPrompt, PromptId, SnippetId } from './types.js';
export {
  buildPrompt,
  interpolateVariables,
  loadPrompt,
  loadSnippet,
  processConditionalBlocks,
  processSnippets,
} from './loader.js';

export const PROMPT_IDS = {
  REQUIREMENTS_TO_OUTLINES: 'requirements-to-outlines',
  SLIDE_CONTENT: 'slide-content',
  QUIZ_CONTENT: 'quiz-content',
  SIMULATION_CONTENT: 'simulation-content',
  SLIDE_ACTIONS: 'slide-actions',
  QUIZ_ACTIONS: 'quiz-actions',
  INTERACTIVE_ACTIONS: 'interactive-actions',
  PBL_ACTIONS: 'pbl-actions',
  PBL_CONTENT: 'pbl-content',
} as const satisfies Record<string, PromptId>;
