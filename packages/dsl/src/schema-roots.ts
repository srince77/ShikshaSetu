/**
 * Concrete, non-generic root for the JSON Schema codegen (JSON Schema has no
 * generics). Spelled out explicitly rather than as a generic composition
 * because the schema generator collapses a generic `Scene<Action, X>` into a
 * single object with an unbound `type`, whereas this union emits a
 * discriminated `anyOf` that preserves the `type` <-> `content` binding.
 * Intentionally NOT re-exported from `index.ts`.
 */
import type { Scene, SlideContent, QuizContent } from './stage.js';
import type { InteractiveContent } from './interactive.js';
import type { PBLContent } from './pbl.js';
import type { Action } from './action.js';

export type SerializedScene =
  | Scene<Action, SlideContent>
  | Scene<Action, QuizContent>
  | Scene<Action, InteractiveContent>
  | Scene<Action, PBLContent>;
