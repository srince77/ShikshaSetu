/**
 * Topic-to-course generation pipeline: resolve the Bedrock model once, build
 * an `aiCall` closure around `callLLM`, generate scene outlines, then loop
 * outlines generating content + actions and persisting each finished scene.
 *
 * Trimmed from the reference implementation: a single Bedrock model (no
 * per-stage `MODEL_ROUTES`), no web-search research phase, and no
 * media/TTS post-phases — those are out of scope for v1. The reference's
 * `generatedScenes`/`totalScenes` step-progress shape is preserved so a
 * caller (the job runner) can report the same granularity.
 */

import { nanoid } from 'nanoid';
import { getModel } from '@/lib/ai/providers';
import { callLLM } from '@/lib/ai/llm';
import {
  applyOutlineFallbacks,
  buildCompleteScene,
  generateSceneActions,
  generateSceneContent,
  generateSceneOutlinesFromRequirements,
  PBLGenerationError,
  withGenerationRetry,
  type AICallFn,
  type AgentInfo,
} from '@shikshasetu/generation';
import type { Stage } from '@/lib/contracts/scene';
import {
  createStageRow,
  insertScene,
  markGenerationComplete,
  saveOutlines,
} from './document-store';

export type ClassroomGenerationStep =
  | 'initializing'
  | 'generating_outlines'
  | 'generating_scenes'
  | 'persisting'
  | 'completed';

export interface ClassroomGenerationProgress {
  step: ClassroomGenerationStep;
  progress: number;
  message: string;
  scenesGenerated: number;
  totalScenes?: number;
}

export interface GenerateClassroomInput {
  requirement: string;
  pdfContent?: { text: string };
  ownerId: string;
}

export interface GenerateClassroomResult {
  id: string;
  stage: Stage;
  scenesCount: number;
  createdAt: string;
}

/**
 * This platform's classroom has a fixed 2-3 agent roster (not an arbitrary
 * user-configurable one, per the orchestration design) — the same fixed
 * teacher/assistant pair backs the speech/action generation prompts here.
 */
export const DEFAULT_CLASSROOM_AGENTS: AgentInfo[] = [
  {
    id: 'teacher-1',
    name: 'Teacher',
    role: 'teacher',
    persona:
      'A warm, clear, encouraging lead teacher who explains concepts step by step and checks understanding often.',
  },
  {
    id: 'assistant-1',
    name: 'Assistant',
    role: 'assistant',
    persona:
      'A supportive teaching assistant who fills gaps, rephrases tricky points more simply, and offers quick examples.',
  },
];

function containPBLGenerationError(error: unknown, sceneTitle: string): null {
  if (!(error instanceof PBLGenerationError)) throw error;
  console.warn(`[ClassroomGeneration] PBL generation failed for scene "${sceneTitle}": ${error.message}`);
  return null;
}

/**
 * Generate a complete classroom (course outline through fully-generated,
 * persisted scenes) from a free-form topic/requirement.
 */
export async function generateClassroom(
  input: GenerateClassroomInput,
  options: {
    onProgress?: (progress: ClassroomGenerationProgress) => Promise<void> | void;
  } = {},
): Promise<GenerateClassroomResult> {
  const { requirement, pdfContent, ownerId } = input;

  await options.onProgress?.({
    step: 'initializing',
    progress: 5,
    message: 'Initializing classroom generation',
    scenesGenerated: 0,
  });

  // Single Bedrock model, resolved once, shared by every stage of the pipeline.
  const languageModel = getModel();

  const aiCall: AICallFn = async (systemPrompt, userPrompt) => {
    const result = await callLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: 8192,
      },
      'generate-classroom',
    );
    return result.text;
  };

  await options.onProgress?.({
    step: 'generating_outlines',
    progress: 15,
    message: 'Generating scene outlines',
    scenesGenerated: 0,
  });

  const outlinesResult = await generateSceneOutlinesFromRequirements(
    { requirement },
    pdfContent?.text,
    undefined,
    aiCall,
    {},
  );

  if (!outlinesResult.success || !outlinesResult.data) {
    throw new Error(outlinesResult.error || 'Failed to generate scene outlines');
  }

  const { languageDirective, courseTitle, outlines } = outlinesResult.data;

  await options.onProgress?.({
    step: 'generating_outlines',
    progress: 30,
    message: `Generated ${outlines.length} scene outlines`,
    scenesGenerated: 0,
    totalScenes: outlines.length,
  });

  const stageId = nanoid(10);
  const stage: Stage = {
    id: stageId,
    name: courseTitle || outlines[0]?.title || requirement.slice(0, 50),
    languageDirective,
    agentIds: DEFAULT_CLASSROOM_AGENTS.map((a) => a.id),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await createStageRow(stage, ownerId);
  await saveOutlines(stageId, outlines);

  let generatedScenes = 0;

  for (const [index, outline] of outlines.entries()) {
    const safeOutline = applyOutlineFallbacks(outline, true);
    const progressStart = 30 + Math.floor((index / Math.max(outlines.length, 1)) * 60);

    await options.onProgress?.({
      step: 'generating_scenes',
      progress: Math.max(progressStart, 31),
      message: `Generating scene ${index + 1}/${outlines.length}: ${safeOutline.title}`,
      scenesGenerated: generatedScenes,
      totalScenes: outlines.length,
    });

    const reportSceneRetry = async (
      phase: 'content' | 'actions',
      event: { attempt: number; maxAttempts: number; reason: string },
    ) => {
      const nextAttempt = Math.min(event.attempt + 1, event.maxAttempts);
      await options.onProgress?.({
        step: 'generating_scenes',
        progress: Math.max(progressStart, 31),
        message: `Retrying scene ${index + 1}/${outlines.length} ${phase} (${nextAttempt}/${event.maxAttempts}): ${safeOutline.title}`,
        scenesGenerated: generatedScenes,
        totalScenes: outlines.length,
      });
    };

    const content = await (async () => {
      try {
        return await withGenerationRetry(
          () =>
            generateSceneContent(safeOutline, aiCall, {
              agents: DEFAULT_CLASSROOM_AGENTS,
              languageDirective,
            }),
          {
            label: `scene ${index + 1}/${outlines.length} content`,
            shouldRetryResult: (result) => result === null,
            onRetry: (event) => reportSceneRetry('content', event),
          },
        );
      } catch (error) {
        return containPBLGenerationError(error, safeOutline.title);
      }
    })();

    if (!content) {
      console.warn(`[ClassroomGeneration] Skipping scene "${safeOutline.title}" — content generation failed`);
      continue;
    }

    const actions = await withGenerationRetry(
      () =>
        generateSceneActions(safeOutline, content, aiCall, {
          agents: DEFAULT_CLASSROOM_AGENTS,
          languageDirective,
        }),
      {
        label: `scene ${index + 1}/${outlines.length} actions`,
        onRetry: (event) => reportSceneRetry('actions', event),
      },
    );

    const scene = buildCompleteScene(safeOutline, content, actions, stageId);
    if (!scene) {
      console.warn(`[ClassroomGeneration] Skipping scene "${safeOutline.title}" — scene assembly failed`);
      continue;
    }

    await insertScene(stageId, scene);
    generatedScenes += 1;

    const progressEnd = 30 + Math.floor(((index + 1) / Math.max(outlines.length, 1)) * 60);
    await options.onProgress?.({
      step: 'generating_scenes',
      progress: Math.min(progressEnd, 90),
      message: `Generated ${generatedScenes}/${outlines.length} scenes`,
      scenesGenerated: generatedScenes,
      totalScenes: outlines.length,
    });
  }

  if (generatedScenes === 0) {
    throw new Error('No scenes were generated');
  }

  await options.onProgress?.({
    step: 'persisting',
    progress: 95,
    message: 'Finalizing classroom',
    scenesGenerated: generatedScenes,
    totalScenes: outlines.length,
  });

  await markGenerationComplete(stageId);

  await options.onProgress?.({
    step: 'completed',
    progress: 100,
    message: 'Classroom generation completed',
    scenesGenerated: generatedScenes,
    totalScenes: outlines.length,
  });

  return {
    id: stageId,
    stage,
    scenesCount: generatedScenes,
    createdAt: new Date().toISOString(),
  };
}
