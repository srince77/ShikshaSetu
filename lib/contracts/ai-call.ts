/**
 * The sole seam between the generation pipeline (packages/generation) and
 * any LLM backend. Agent B implements this against Bedrock; nothing else in
 * the generation package should know Bedrock exists.
 */
export type AICallFn = (
  systemPrompt: string,
  userPrompt: string,
  images?: Array<{ id: string; src: string }>,
) => Promise<string>;
