/**
 * Canvas/playback UI state: the fire-and-forget visual effects
 * (spotlight/laser), whiteboard open/clearing flags, and which video element
 * is currently playing. Read by the classroom UI, written by ActionEngine and
 * PlaybackEngine. A lean, purpose-built subset of the reference app's much
 * larger canvas store (which also owns the freeform-canvas authoring
 * selection/zoom state) — extended in the canvas-editor port phase.
 */
import { create } from 'zustand';
import type { SlideEffects } from '@shikshasetu/renderer/types';

export interface SpotlightOptions {
  dimness?: number;
}

export interface LaserOptions {
  color?: string;
  duration?: number;
}

interface CanvasState {
  effects: SlideEffects;
  playingVideoElementId: string;
  whiteboardOpen: boolean;
  whiteboardClearing: boolean;

  setSpotlight: (elementId: string, options?: SpotlightOptions) => void;
  setLaser: (elementId: string, options?: LaserOptions) => void;
  clearAllEffects: () => void;

  playVideo: (elementId: string) => void;
  pauseVideo: () => void;

  setWhiteboardOpen: (open: boolean) => void;
  setWhiteboardClearing: (clearing: boolean) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  effects: {},
  playingVideoElementId: '',
  whiteboardOpen: false,
  whiteboardClearing: false,

  setSpotlight: (elementId, options = {}) =>
    set((state) => ({
      effects: { ...state.effects, spotlight: { elementId, dimness: options.dimness } },
    })),

  setLaser: (elementId, options = {}) =>
    set((state) => ({
      effects: {
        ...state.effects,
        laser: { elementId, color: options.color, duration: options.duration },
      },
    })),

  clearAllEffects: () => set({ effects: {} }),

  playVideo: (elementId) => set({ playingVideoElementId: elementId }),
  pauseVideo: () => set({ playingVideoElementId: '' }),

  setWhiteboardOpen: (open) => set({ whiteboardOpen: open }),
  setWhiteboardClearing: (clearing) => set({ whiteboardClearing: clearing }),
}));
