// Stage / Scene / SceneContent: the universal lesson-skeleton contract. `Scene.content` is a
// discriminated union of content kinds; interactive and PBL content compose in via `Scene`'s generic.
import type { Slide } from './slides.js';
import type { Action } from './action.js';

/** All scene kinds owned by the contract. */
export type SceneType = 'slide' | 'quiz' | 'interactive' | 'pbl';

/** Frozen set of every valid {@link SceneType}, for cheap membership checks. */
export const SCENE_TYPES = [
  'slide',
  'quiz',
  'interactive',
  'pbl',
] as const satisfies readonly SceneType[];

// Compile-time check that every SceneType appears in SCENE_TYPES.
type _SceneTypesExhaustive = [SceneType] extends [(typeof SCENE_TYPES)[number]] ? true : never;
const _sceneTypesExhaustive: _SceneTypesExhaustive = true;
void _sceneTypesExhaustive;

/** Narrow an unknown value to a valid {@link SceneType}. Pure, no runtime deps. */
export function isSceneType(value: unknown): value is SceneType {
  return typeof value === 'string' && (SCENE_TYPES as readonly string[]).includes(value);
}

/** Lifecycle / interaction mode a {@link Stage} can be operated in. */
export type StageMode = 'autonomous' | 'playback' | 'edit';

// A whiteboard slide: a Slide minus the fields that only make sense on a primary canvas.
export type Whiteboard = Omit<Slide, 'theme' | 'turningMode' | 'sectionTag' | 'type'>;

export interface VideoManifestEntry {
  type: 'video';
  prompt: string;
  aspectRatio?: string;
}

export type VideoManifest = Record<string, VideoManifestEntry>;

// Provider-neutral vocal identity for an agent, as a 3-layer recipe; kept in the document, not device-local storage.
export interface VoiceDesign {
  identity: string; // gender / age / role
  texture: string; // pitch / vocal quality
  delivery: string; // emotion / pace
}

// A concrete TTS voice binding; `providerId` is open, readers treat an unknown one as "no bound voice".
export interface AgentVoiceConfig {
  providerId: string;
  modelId?: string; // model the voice was selected or enrolled for, when model-bound
  voiceId: string;
}

// Generated agent config for generated-roster classrooms (preset classrooms carry `agentIds` instead).
// Note: the voice fields are additive for this codebase's tolerant validators, but a strict
// schema-validating consumer pinned to an older `stage.schema.json` (additionalProperties: false)
// rejects documents carrying them.
export interface GeneratedAgentConfig {
  id: string;
  name: string;
  role: string;
  persona: string;
  avatar: string;
  color: string;
  priority: number;
  voiceConfig?: AgentVoiceConfig;
  voiceDesign?: VoiceDesign;
}

/** Multi-agent discussion configuration for a single scene. */
export interface MultiAgentConfig {
  enabled: boolean;
  agentIds: string[];
  directorPrompt?: string;
}

/** Represents the entire classroom/course. */
export interface Stage {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  languageDirective?: string;
  style?: string;
  whiteboard?: Whiteboard[];
  videoManifest?: VideoManifest; // generated video requests keyed by the mediaRef used by PPTVideoElement
  agentIds?: string[]; // agent IDs selected when this classroom was created
  generatedAgentConfigs?: GeneratedAgentConfig[];
  interactiveMode?: boolean; // absent on legacy classrooms, imports, and regular-mode generations
  taskEngineMode?: boolean; // distinct from interactiveMode: task-engine classrooms are interactive, not vice versa
}

/**
 * `schemaVersion` tags the on-disk shape of this content so future schema
 * changes can ship behind a migration step. Optional for backward
 * compatibility; legacy/pre-versioning data lacks the field.
 */
export interface SlideContent {
  type: 'slide';
  schemaVersion?: number;
  canvas: Slide;
}

export interface QuizOption {
  label: string;
  value: string; // selection key, e.g. "A", "B", "C", "D"
}

export interface QuizQuestion {
  id: string;
  type: 'single' | 'multiple' | 'short_answer';
  question: string;
  options?: QuizOption[];
  answer?: string[]; // correct values, e.g. ["A"] or ["A","C"]; undefined for text questions
  analysis?: string; // explanation shown after grading
  commentPrompt?: string; // grading guidance for text questions
  hasAnswer?: boolean;
  points?: number; // default 1
}

export interface QuizContent {
  type: 'quiz';
  questions: QuizQuestion[];
}

/** The universal scene-content subset used by {@link Scene}'s compatibility default. */
export type SceneContent = SlideContent | QuizContent;

/** Fields of a {@link Scene} independent of the `type`/`content` binding. */
export interface SceneCore<TAction = Action> {
  id: string;
  stageId: string; // parent stage id, for data integrity checks
  title: string;
  order: number;
  actions?: TAction[];
  whiteboards?: Slide[];
  multiAgent?: MultiAgentConfig;
  createdAt?: number;
  updatedAt?: number;
}

// A single page/scene. The `type` discriminant is bound to `content` (slide-typed carries
// SlideContent, etc) via a distributive conditional over TContent, so each union member ties
// its own `type` to its shape. Skeleton-only consumers can opt out of actions with `Scene<never, ...>`.
export type Scene<
  TAction = Action,
  TContent extends { type: SceneType } = SlideContent | QuizContent,
> = TContent extends unknown
  ? SceneCore<TAction> & { type: TContent['type']; content: TContent }
  : never;

/** Narrow a candidate to {@link SlideContent}, including consumer-specialized content unions. */
export function isSlideContent<T extends { type: SceneType }>(
  content: T,
): content is T & SlideContent {
  return content.type === 'slide';
}

/** Narrow a candidate to {@link QuizContent}, including consumer-specialized content unions. */
export function isQuizContent<T extends { type: SceneType }>(
  content: T,
): content is T & QuizContent {
  return content.type === 'quiz';
}
