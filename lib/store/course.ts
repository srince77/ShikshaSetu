/**
 * The current course being played/edited: `{ stage, scenes, currentSceneId }`.
 * This is the client-side home for the frozen DSL contract's data — seeded
 * from `lib/contracts/fixtures/sample-course.json` during this phase (no real
 * generation pipeline/persistence exists yet), swapped for a real fetch at
 * integration time without reshaping callers.
 *
 * Deliberately lean: the reference app's equivalent store also owns
 * scene/element authoring CRUD and server persistence. Those land with the
 * canvas-editor port; this phase only needs read access plus the whiteboard
 * mutations ActionEngine performs during playback.
 */
import { create } from 'zustand';
import type { Scene, Stage, StageMode } from '@shikshasetu/dsl';

export interface CourseState {
  stage: Stage | null;
  scenes: Scene[];
  currentSceneId: string | null;
  mode: StageMode;

  loadCourse: (course: { stage: Stage; scenes: Scene[] }) => void;
  setCurrentSceneId: (sceneId: string | null) => void;
}

export const useCourseStore = create<CourseState>((set) => ({
  stage: null,
  scenes: [],
  currentSceneId: null,
  mode: 'playback',

  loadCourse: (course) =>
    set({
      stage: course.stage,
      scenes: course.scenes,
      currentSceneId: course.scenes[0]?.id ?? null,
    }),

  setCurrentSceneId: (sceneId) => set({ currentSceneId: sceneId }),
}));

/** Look up a scene by id in the currently loaded course. */
export function getScene(sceneId: string): Scene | undefined {
  return useCourseStore.getState().scenes.find((scene) => scene.id === sceneId);
}
