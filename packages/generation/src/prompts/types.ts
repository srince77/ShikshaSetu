/**
 * Simplified prompt system type definitions
 */

/**
 * Prompt template identifier for generation-owned prompts.
 *
 * Trimmed to the MVP scope: slides, quiz, one interactive widget type
 * (simulation), and a simplified single-call PBL generator.
 */
export type PromptId =
  | 'requirements-to-outlines'
  | 'slide-content'
  | 'quiz-content'
  | 'simulation-content'
  | 'slide-actions'
  | 'quiz-actions'
  | 'interactive-actions'
  | 'pbl-actions'
  | 'pbl-content';

/** Snippets referenced by generation-owned prompt templates. */
export type SnippetId =
  | 'json-output-rules'
  | 'image-instructions'
  | 'video-instructions'
  | 'media-safety-guidelines'
  | 'slide-image-instructions'
  | 'slide-generated-image-instructions'
  | 'slide-video-instructions';

/** Loaded prompt template. */
export interface LoadedPrompt {
  id: PromptId;
  systemPrompt: string;
  userPromptTemplate: string;
}

export type PromptVariableDefaults = Partial<Record<PromptId, Readonly<Record<string, unknown>>>>;
