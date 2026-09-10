'use client';

/**
 * Home page — rebuilt from the "Paper White" hero mockup
 * (design-refs/Main-html/Main.dc.html). Submitting the prompt (or a chip)
 * calls the real generation pipeline (/api/generate-classroom), polls the
 * job, and lands on the real generated course at /classroom/[id]. The
 * sidebar's "Continue" entry still points at the hand-authored fixture
 * course as a known-good fallback.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, Loader2, Menu, Mic, Search, Sparkles, User, X } from 'lucide-react';

type CourseSummary = { id: string; name: string; sceneCount: number };

type GenerationJob = {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  message?: string;
  stageId?: string;
  error?: string;
};

const POLL_INTERVAL_MS = 2500;

const EASE_ENTRANCE = [0.16, 1, 0.3, 1] as const;
const WORDS = ['Learn', 'Understand', 'Build', 'Liberate'];

const CHIPS = [
  { icon: Sparkles, label: 'Explain a topic simply' },
  { icon: Search, label: 'Quiz me before an exam' },
];

function BridgeMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ opacity: 0.9 }}>
      <path d="M16,64 A34,34 0 0 1 84,64 L72,64 A22,22 0 0 0 28,64 Z" fill="var(--accent)" />
      <rect x="13" y="64" width="6" height="18" fill="var(--accent)" />
      <rect x="81" y="64" width="6" height="18" fill="var(--accent)" />
      <circle cx="50" cy="18" r="5" fill="var(--accent)" />
    </svg>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<string>('Starting...');
  const [genError, setGenError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    fetch('/api/stages')
      .then((res) => (res.ok ? res.json() : { stages: [] }))
      .then((data) => setCourses(data.stages ?? []))
      .catch(() => setCourses([]));
  }, [sidebarOpen]);

  useEffect(() => {
    const timer = setInterval(() => {
      setFading(true);
      const fadeTimer = setTimeout(() => {
        setWordIndex((i) => (i + 1) % WORDS.length);
        setFading(false);
      }, 320);
      return () => clearTimeout(fadeTimer);
    }, 2600);
    return () => clearInterval(timer);
  }, []);

  const generateCourse = async (topic: string) => {
    const requirement = topic.trim();
    if (!requirement || generating) return;
    setGenerating(true);
    setGenError(null);
    setGenStatus('Starting...');
    try {
      const submitRes = await fetch('/api/generate-classroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement }),
      });
      if (!submitRes.ok) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(body.error || 'Could not start generation');
      }
      const { jobId } = await submitRes.json();

      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const pollRes = await fetch(`/api/generate-classroom/${jobId}`);
        if (!pollRes.ok) throw new Error('Lost track of the generation job');
        const job: GenerationJob = await pollRes.json();

        if (job.status === 'succeeded' && job.stageId) {
          router.push(`/classroom/${job.stageId}`);
          return;
        }
        if (job.status === 'failed') {
          throw new Error(job.error || 'Generation failed');
        }
        setGenStatus(job.message || job.status);
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Something went wrong');
      setGenerating(false);
    }
  };

  return (
    <main className="relative h-screen w-full overflow-hidden bg-[var(--bg-canvas)]">
      {/* Hero */}
      <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-6 px-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.04, ease: EASE_ENTRANCE }}
          className="flex flex-col items-center gap-1.5"
        >
          <div className="text-xl font-medium text-[var(--text-secondary)]">Welcome to</div>
          <div className="flex items-center gap-2.5">
            <BridgeMark />
            <div className="flex items-baseline gap-2.5 font-[var(--font-display)] text-[42px] font-semibold leading-none text-[var(--text-primary)] sm:text-[52px]">
              <span>Shiksha</span>
              <span className="font-[var(--font-ui)] font-medium text-[var(--text-secondary)]">
                सेतु
              </span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.14, ease: EASE_ENTRANCE }}
          className="flex items-baseline gap-2 text-xl font-medium text-[var(--text-secondary)] sm:text-2xl"
        >
          <span>Let&apos;s</span>
          <motion.span
            key={wordIndex}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: fading ? 0 : 1, y: fading ? 8 : 0 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
            className="font-semibold text-[var(--accent)]"
          >
            {WORDS[wordIndex]}.
          </motion.span>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.24, ease: EASE_ENTRANCE }}
          className="max-w-[480px] text-center text-base text-[var(--text-tertiary)]"
        >
          Your AI classroom, a teacher, a TA and a few peers, all in one place.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.34, ease: EASE_ENTRANCE }}
          className="mt-2 flex flex-col items-center gap-4"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              generateCourse(prompt);
            }}
            className="flex w-[min(680px,88vw)] items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--bg-canvas)] py-2 pl-5 pr-2 shadow-[var(--shadow-xs),var(--shadow-lg)]"
          >
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-hover)]"
              aria-label="Search"
            >
              <Search className="h-[17px] w-[17px] text-[var(--text-tertiary)]" strokeWidth={1.5} />
            </button>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              type="text"
              disabled={generating}
              placeholder="Ask anything, or start a new lesson..."
              className="flex-1 border-none bg-transparent py-1.5 text-[15px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-placeholder)] disabled:opacity-50"
            />
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-hover)]"
              aria-label="Voice input"
            >
              <Mic className="h-[17px] w-[17px] text-[var(--text-tertiary)]" strokeWidth={1.5} />
            </button>
            <button
              type="submit"
              disabled={generating}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-transform hover:scale-[1.06] disabled:opacity-60"
              aria-label="Send"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={1.8} />
              )}
            </button>
          </form>

          {generating && (
            <p className="text-[13px] text-[var(--text-tertiary)]">{genStatus}</p>
          )}
          {genError && (
            <p className="text-[13px] text-[var(--color-destructive)]">{genError}</p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {CHIPS.map((chip, i) => (
              <motion.button
                key={chip.label}
                type="button"
                disabled={generating}
                onClick={() => generateCourse(chip.label)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 1 + i * 0.18, ease: EASE_ENTRANCE }}
                className="flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--bg-canvas)] px-4 py-2 text-[13px] text-[var(--text-label)] transition-colors hover:border-[var(--border-accent)] hover:bg-[var(--bg-hover-accent)] disabled:opacity-50"
              >
                <chip.icon className="h-[15px] w-[15px] text-[var(--accent)]" strokeWidth={1.4} />
                {chip.label}
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Top bar */}
      <button
        type="button"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        className="absolute left-5 top-4 z-40 flex h-11 w-11 items-center justify-center rounded-full transition-opacity"
        style={{ opacity: sidebarOpen ? 0.9 : 0.32 }}
      >
        {sidebarOpen ? (
          <X className="h-[19px] w-[19px] text-[var(--text-primary)]" strokeWidth={1.6} />
        ) : (
          <Menu className="h-[19px] w-[19px] text-[var(--text-primary)]" strokeWidth={1.6} />
        )}
      </button>

      <div className="absolute right-6 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-panel)]">
        <User className="h-[17px] w-[17px] text-[var(--text-secondary)]" strokeWidth={1.6} />
      </div>

      {/* Scrim */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 z-20 bg-[var(--overlay-scrim)]"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.div
        animate={{ x: sidebarOpen ? 0 : '-104%' }}
        transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        className="absolute bottom-0 left-0 top-0 z-30 flex w-80 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)] px-4.5 pb-5 pt-[84px]"
      >
        <div className="flex items-center justify-between px-1.5 pb-4">
          <span className="font-[var(--font-display)] text-[17px] font-semibold text-[var(--text-primary)]">
            Recent Courses
          </span>
        </div>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {courses === null && (
            <p className="px-1.5 py-2 text-[13px] text-[var(--text-tertiary)]">Loading...</p>
          )}
          {courses?.length === 0 && (
            <p className="px-1.5 py-2 text-[13px] text-[var(--text-tertiary)]">
              No courses yet, generate one from the home screen.
            </p>
          )}
          {courses?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/classroom/${c.id}`)}
              className="flex items-center gap-3.5 rounded-[var(--radius-card)] border border-transparent p-3.5 text-left transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-canvas)]"
            >
              <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[var(--radius-tile)] border border-[var(--border)] bg-[var(--bg-canvas)]">
                <Sparkles className="h-[17px] w-[17px] text-[var(--accent)]" strokeWidth={1.4} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                  {c.name}
                </div>
                <div className="text-[11.5px] text-[var(--text-tertiary)]">
                  {c.sceneCount} {c.sceneCount === 1 ? 'scene' : 'scenes'}
                </div>
              </div>
            </button>
          ))}
        </div>
      </motion.div>
    </main>
  );
}
