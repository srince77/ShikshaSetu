'use client';

/**
 * Plays back a real, generated course loaded from /api/stages/[id], as
 * opposed to /classroom (no id), which still plays the hand-authored
 * fixture. Separate route rather than replacing the fixture one so the
 * fixture stays available as a known-good reference during development.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Scene, Stage } from '@shikshasetu/dsl';
import { ClassroomView } from '@/components/classroom/classroom-view';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; course: { stage: Stage; scenes: Scene[] } };

export default function GeneratedClassroomPage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stages/${params.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Course not found' : 'Failed to load course');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', course: { stage: data.stage, scenes: data.scenes } });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: 'error', message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--bg-canvas)] text-sm text-[var(--text-tertiary)]">
        Loading course...
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--bg-canvas)] px-6 text-center text-sm text-[var(--text-tertiary)]">
        {state.message}
      </div>
    );
  }

  return <ClassroomView course={state.course} />;
}
