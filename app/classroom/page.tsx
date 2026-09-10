import type { Scene, Stage } from '@shikshasetu/dsl';
import { resolveOwnerId } from '@/lib/contracts/owner';
import { ClassroomView } from '@/components/classroom/classroom-view';
import fixtureCourse from '@/lib/contracts/fixtures/sample-course.json';

// The sign-in gate reads an env var at request time; without this, Next
// would prerender the page once at build time (before SESSION_DEV_BYPASS is
// necessarily set) and serve that same static result to every request.
export const dynamic = 'force-dynamic';

/**
 * No real generation pipeline or auth exists yet (other agents are building
 * both in parallel), so this route plays the hand-authored fixture course and
 * gates on `resolveOwnerId` — the same frozen seam a real session will use
 * once it lands, instead of a bespoke dev-only check.
 */
export default function ClassroomPage() {
  let ownerId: string;
  try {
    ownerId = resolveOwnerId();
  } catch {
    return (
      <main className="flex h-screen w-full items-center justify-center bg-[var(--bg-canvas)] px-6 text-center">
        <div className="flex max-w-sm flex-col items-center gap-2">
          <p className="text-sm font-medium text-[var(--text-primary)]">Sign-in required</p>
          <p className="text-sm text-[var(--text-tertiary)]">
            Classroom playback needs a session. Set <code>SESSION_DEV_BYPASS=true</code> to preview
            this page before real auth lands.
          </p>
        </div>
      </main>
    );
  }

  void ownerId; // not yet used server-side — the fixture is public in this phase

  const course = fixtureCourse as unknown as { stage: Stage; scenes: Scene[] };
  return <ClassroomView course={course} />;
}
