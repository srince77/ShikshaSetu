/**
 * App-level helpers around the store-independent @shikshasetu/generation
 * scene layer: build one scene (content + actions) from an outline, and
 * persist it.
 */

import {
  applyOutlineFallbacks,
  buildCompleteScene,
  buildLanguageText,
  generateSceneActions,
  generateSceneContent,
  type AICallFn,
  type AgentInfo,
  type ImageMapping,
  type PdfImage,
  type GeneratedSceneContent,
  type SceneGenerationContext,
  type SceneOutline,
} from '@shikshasetu/generation';
import type { Action, Scene } from '@/lib/contracts/scene';
import type { CompleteSceneContent } from '@shikshasetu/generation';
import { insertScene } from './document-store';

export type GeneratedScene = Scene<Action, CompleteSceneContent>;

/** Persist a package-built scene through the document store. */
export async function createSceneWithActions(
  outline: SceneOutline,
  content: GeneratedSceneContent,
  actions: Action[],
  stageId: string,
): Promise<string | null> {
  const scene = buildCompleteScene(outline, content, actions, stageId);
  if (!scene) return null;
  await insertScene(stageId, scene as GeneratedScene);
  return scene.id;
}

/** Generate both halves (content, then actions) and assemble one complete scene. */
export async function buildSceneFromOutline(
  outline: SceneOutline,
  aiCall: AICallFn,
  stageId: string,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
  visionEnabled?: boolean,
  ctx?: SceneGenerationContext,
  agents?: AgentInfo[],
  onPhaseChange?: (phase: 'content' | 'actions') => void,
  userProfile?: string,
  languageDirective?: string,
): Promise<GeneratedScene | null> {
  const safeOutline = applyOutlineFallbacks(outline, true);
  const langText = buildLanguageText(languageDirective, safeOutline.languageNote);

  onPhaseChange?.('content');
  const content = await generateSceneContent(safeOutline, aiCall, {
    assignedImages,
    imageMapping,
    visionEnabled,
    agents,
    languageDirective: langText,
  });
  if (!content) return null;

  onPhaseChange?.('actions');
  const actions = await generateSceneActions(safeOutline, content, aiCall, {
    ctx,
    agents,
    userProfile,
    languageDirective: langText,
  });

  return buildCompleteScene(safeOutline, content, actions, stageId) as GeneratedScene | null;
}
