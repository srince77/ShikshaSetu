'use client';

/**
 * React binding for PlaybackEngine + ActionEngine: owns their lifecycle for a
 * given scene list and mirrors the bits of engine state a classroom view
 * needs to render (mode, current scene, the caption text of whatever speech
 * action is playing).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Scene } from '@shikshasetu/dsl';
import { ActionEngine } from '@/lib/action/engine';
import { PlaybackEngine } from './engine';
import { createAudioPlayer } from './audio-player';
import { useCourseStore } from '@/lib/store/course';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import type { EngineMode, TriggerEvent } from './types';

export interface UsePlaybackEngineResult {
  engine: PlaybackEngine | null;
  mode: EngineMode;
  currentSceneId: string | null;
  captionText: string | null;
  discussionTrigger: TriggerEvent | null;
  completed: boolean;
}

export function usePlaybackEngine(scenes: Scene[]): UsePlaybackEngineResult {
  const [mode, setMode] = useState<EngineMode>('idle');
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(scenes[0]?.id ?? null);
  const [captionText, setCaptionText] = useState<string | null>(null);
  const [discussionTrigger, setDiscussionTrigger] = useState<TriggerEvent | null>(null);
  const [completed, setCompleted] = useState(false);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const actionEngineRef = useRef<ActionEngine | null>(null);

  // Scenes are fixture/DSL data, not expected to change identity on every
  // render; re-created only if the caller passes a genuinely new list.
  const sceneKey = useMemo(() => scenes.map((s) => s.id).join(','), [scenes]);

  useEffect(() => {
    const audioPlayer = createAudioPlayer();
    // widget_* actions reach the on-screen interactive iframe (if any) through
    // the same store InteractiveIframeHost registers its postMessage callback
    // into, keyed by the engine's current scene rather than a fixed id.
    const actionEngine = new ActionEngine(useCourseStore, audioPlayer, (type, payload) =>
      useWidgetIframeStore.getState().getSendMessage()?.(type, payload),
    );
    const engine = new PlaybackEngine(scenes, actionEngine, audioPlayer, {
      onModeChange: setMode,
      onSceneChange: setCurrentSceneId,
      onSpeechStart: setCaptionText,
      onSpeechEnd: () => setCaptionText(null),
      onProactiveShow: setDiscussionTrigger,
      onProactiveHide: () => setDiscussionTrigger(null),
      onComplete: () => setCompleted(true),
    });
    actionEngineRef.current = actionEngine;
    engineRef.current = engine;
    setCompleted(false);

    return () => {
      engine.stop();
      actionEngine.dispose();
      engineRef.current = null;
      actionEngineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey]);

  return {
    engine: engineRef.current,
    mode,
    currentSceneId,
    captionText,
    discussionTrigger,
    completed,
  };
}
