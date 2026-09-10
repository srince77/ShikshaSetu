'use client';

/**
 * The classroom playback surface: renders the current scene (slide or quiz)
 * from the course store and drives it with PlaybackEngine/ActionEngine. Built
 * against the frozen DSL contract and (for this phase) the hand-authored
 * fixture course — swappable for a real course fetch without reshaping this
 * component.
 */
import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Pause, Play, RotateCcw } from 'lucide-react';
import type { Stage, Scene } from '@shikshasetu/dsl';
import { isQuizContent, isSlideContent } from '@shikshasetu/dsl';
import { SlideCanvas } from '@shikshasetu/renderer';
import { useCourseStore } from '@/lib/store/course';
import { useCanvasStore } from '@/lib/store/canvas';
import { usePlaybackEngine } from '@/lib/playback/use-playback-engine';
import { QuizView } from '@/components/scene-renderers/quiz-view';
import { Button } from '@/components/ui/button';

const EASE_ENTRANCE = [0.16, 1, 0.3, 1] as const;

export function ClassroomView({ course }: { course: { stage: Stage; scenes: Scene[] } }) {
  const loadCourse = useCourseStore((s) => s.loadCourse);
  const scenes = useCourseStore((s) => s.scenes);
  const stage = useCourseStore((s) => s.stage);
  const effects = useCanvasStore((s) => s.effects);

  useEffect(() => {
    loadCourse(course);
    // Loaded once per course identity; the store is the source of truth after this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.stage.id]);

  const { engine, mode, currentSceneId, captionText, discussionTrigger, completed } =
    usePlaybackEngine(scenes);

  const currentIndex = useMemo(
    () => Math.max(0, scenes.findIndex((s) => s.id === currentSceneId)),
    [scenes, currentSceneId],
  );
  const currentScene = scenes[currentIndex];

  if (!stage || scenes.length === 0 || !currentScene) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--bg-canvas)] text-sm text-[var(--text-tertiary)]">
        Loading course...
      </div>
    );
  }

  const isPlaying = mode === 'playing';
  const isQuiz = currentScene.type === 'quiz' && isQuizContent(currentScene.content);
  const isSlide = currentScene.type === 'slide' && isSlideContent(currentScene.content);

  return (
    <div className="flex h-screen w-full flex-col bg-[var(--bg-canvas)]">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-hover)]"
          >
            <ArrowLeft className="h-4 w-4 text-[var(--text-primary)]" strokeWidth={1.6} />
          </Link>
          <div className="flex flex-col">
            <span className="font-[var(--font-display)] text-[15px] font-semibold text-[var(--text-primary)]">
              {stage.name}
            </span>
            <span className="text-xs text-[var(--text-tertiary)]">
              Scene {currentIndex + 1} of {scenes.length} &middot; {currentScene.title}
            </span>
          </div>
        </div>
        <div className="h-1 w-32 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--border)]">
          <div
            className="h-full rounded-[var(--radius-pill)] bg-[var(--accent)] transition-[width] duration-500"
            style={{ width: `${((currentIndex + 1) / scenes.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Main content */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentScene.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: EASE_ENTRANCE }}
            className="flex h-full w-full max-w-4xl items-center justify-center"
          >
            {isSlide && (
              <div className="aspect-video w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
                <SlideCanvas slide={currentScene.content.canvas} effects={effects} />
              </div>
            )}
            {isQuiz && (
              <div className="h-full w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
                <QuizView questions={currentScene.content.questions} />
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Discussion interruption card */}
        <AnimatePresence>
          {discussionTrigger && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.4, ease: EASE_ENTRANCE }}
              className="absolute bottom-6 left-1/2 flex w-[min(420px,90%)] -translate-x-1/2 flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-canvas)] p-4 shadow-[var(--shadow-lg)]"
            >
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {discussionTrigger.question}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => engine?.skipDiscussion()}>
                  Skip
                </Button>
                <Button size="sm" onClick={() => engine?.confirmDiscussion()}>
                  Join discussion
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Caption + controls */}
      <div className="flex shrink-0 flex-col gap-3 border-t border-[var(--border)] px-5 py-4">
        {captionText && (
          <p className="mx-auto max-w-2xl text-center text-sm leading-relaxed text-[var(--text-secondary)]">
            {captionText}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => engine?.stop()}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="Restart"
          >
            <RotateCcw className="h-4 w-4 text-[var(--text-tertiary)]" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (completed || mode === 'idle') {
                engine?.start();
              } else if (isPlaying) {
                engine?.pause();
              } else if (mode === 'paused') {
                engine?.resume();
              }
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-transform hover:scale-[1.06]"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" strokeWidth={2} fill="currentColor" />
            ) : (
              <Play className="ml-0.5 h-4 w-4" strokeWidth={2} fill="currentColor" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
