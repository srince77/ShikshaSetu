'use client';

/**
 * Rebuilt (not ported) from the reference implementation: keeps the same
 * phase state machine (not_started → answering → submitting → grading →
 * reviewing) and grading-flow shape, but the JSX is new — built on this
 * project's shadcn primitives (Card, Button, RadioGroup, Checkbox) and the
 * ShikshaSetu design system tokens instead of the source's hand-rolled
 * violet-gradient Tailwind markup.
 *
 * This phase has no persistence layer and no AI short-answer grading
 * endpoint yet (both belong to other agents' work), so state lives in memory
 * for the session and a short-answer question is marked "ungraded" rather
 * than faked as correct/incorrect — the review screen shows the learner's
 * own answer either way.
 */
import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, CheckCircle2, PieChart, RotateCcw, XCircle } from 'lucide-react';
import type { QuizQuestion } from '@/lib/contracts/scene';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const EASE_ENTRANCE = [0.16, 1, 0.3, 1] as const;

type Phase = 'not_started' | 'answering' | 'submitting' | 'grading' | 'reviewing';

interface QuestionResult {
  questionId: string;
  status: 'correct' | 'incorrect' | 'ungraded';
  earned: number;
}

interface QuizViewProps {
  readonly questions: QuizQuestion[];
}

/** Grade a single/multiple choice question against its answer key. */
function gradeChoiceQuestion(
  question: QuizQuestion,
  value: string | string[] | undefined,
): QuestionResult {
  const points = question.points ?? 1;
  const answer = question.answer ?? [];
  const given = Array.isArray(value) ? value : value ? [value] : [];
  const isCorrect =
    given.length === answer.length && answer.every((a) => given.includes(a));
  return {
    questionId: question.id,
    status: isCorrect ? 'correct' : 'incorrect',
    earned: isCorrect ? points : 0,
  };
}

function gradeQuestions(
  questions: QuizQuestion[],
  answers: Record<string, string | string[]>,
): QuestionResult[] {
  return questions.map((q) => {
    if (q.type === 'short_answer') {
      // No AI grading endpoint in this phase — mark ungraded rather than
      // guessing. The learner's own answer still shows on the review screen.
      const answered = !!(answers[q.id] as string | undefined)?.trim();
      return { questionId: q.id, status: 'ungraded', earned: answered ? (q.points ?? 1) * 0.5 : 0 };
    }
    return gradeChoiceQuestion(q, answers[q.id]);
  });
}

function QuizMathText({ text, className }: { text: string; className?: string }) {
  // Plain text for this phase — LaTeX-in-quiz rendering is not part of this
  // component's rebuild scope. Kept as its own component so that seam is a
  // one-line change later, not a JSX rewrite.
  return <span className={className}>{text}</span>;
}

function QuizCover({
  questionCount,
  totalPoints,
  onStart,
}: {
  questionCount: number;
  totalPoints: number;
  onStart: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-[var(--bg-canvas)] px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE_ENTRANCE }}
        className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-tile)] border border-[var(--border)] bg-[var(--bg-canvas)]"
      >
        <PieChart className="h-7 w-7 text-[var(--accent)]" strokeWidth={1.4} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: EASE_ENTRANCE }}
        className="flex flex-col items-center gap-1.5 text-center"
      >
        <h3 className="font-[var(--font-display)] text-[19px] font-semibold text-[var(--text-primary)]">
          Quick check
        </h3>
        <p className="max-w-[360px] text-sm text-[var(--text-secondary)]">
          {questionCount} question{questionCount === 1 ? '' : 's'} &middot; {totalPoints} point
          {totalPoints === 1 ? '' : 's'} total
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: EASE_ENTRANCE }}
      >
        <Button onClick={onStart} className="rounded-[var(--radius-pill)] px-6">
          Start quiz
        </Button>
      </motion.div>
    </div>
  );
}

function OptionRow({
  label,
  selected,
  isCorrectOpt,
  isWrong,
  isReview,
  onClick,
  disabled,
  indicator,
}: {
  label: string;
  selected: boolean;
  isCorrectOpt: boolean;
  isWrong: boolean;
  isReview: boolean;
  onClick: () => void;
  disabled?: boolean;
  indicator: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-[var(--radius-tile)] border px-4 py-3 text-left text-sm transition-colors',
        !isReview && !selected && 'border-[var(--border)] hover:border-[var(--border-accent)] hover:bg-[var(--bg-hover-accent)]',
        !isReview && selected && 'border-[var(--border-accent)] bg-[var(--bg-hover-accent)]',
        isReview && isCorrectOpt && 'border-success bg-success/8',
        isReview && isWrong && !isCorrectOpt && 'border-destructive bg-destructive/8',
        isReview && !isCorrectOpt && !selected && 'border-[var(--border)] opacity-60',
        disabled && !isReview && 'cursor-default',
      )}
    >
      {indicator}
      <span className="flex-1 text-[var(--text-primary)]">
        <QuizMathText text={label} />
      </span>
      {isReview && isCorrectOpt && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
      {isReview && isWrong && !isCorrectOpt && (
        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
      )}
    </button>
  );
}

function SingleChoiceQuestion({
  question,
  value,
  onChange,
  disabled,
  result,
}: {
  question: QuizQuestion;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  result?: QuestionResult;
}) {
  const isReview = !!result;
  return (
    <RadioGroup value={value} onValueChange={onChange} disabled={disabled} className="gap-2">
      {question.options?.map((opt) => {
        const selected = value === opt.value;
        const isCorrectOpt = isReview && !!question.answer?.includes(opt.value);
        const isWrong = isReview && selected && result?.status === 'incorrect';
        return (
          <OptionRow
            key={opt.value}
            label={opt.label}
            selected={selected}
            isCorrectOpt={isCorrectOpt}
            isWrong={isWrong}
            isReview={isReview}
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            indicator={<RadioGroupItem value={opt.value} className="shrink-0" />}
          />
        );
      })}
    </RadioGroup>
  );
}

function MultipleChoiceQuestion({
  question,
  value,
  onChange,
  disabled,
  result,
}: {
  question: QuizQuestion;
  value?: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  result?: QuestionResult;
}) {
  const isReview = !!result;
  const selected = value ?? [];
  const toggle = (optValue: string) => {
    if (disabled) return;
    onChange(
      selected.includes(optValue)
        ? selected.filter((v) => v !== optValue)
        : [...selected, optValue],
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {!isReview && (
        <p className="text-xs text-[var(--text-tertiary)]">Select every answer that applies.</p>
      )}
      {question.options?.map((opt) => {
        const isSelected = selected.includes(opt.value);
        const isCorrectOpt = isReview && !!question.answer?.includes(opt.value);
        const isWrong = isReview && isSelected && !isCorrectOpt;
        return (
          <OptionRow
            key={opt.value}
            label={opt.label}
            selected={isSelected}
            isCorrectOpt={isCorrectOpt}
            isWrong={isWrong}
            isReview={isReview}
            disabled={disabled}
            onClick={() => toggle(opt.value)}
            indicator={
              <Checkbox
                checked={isSelected}
                className="shrink-0"
                onCheckedChange={() => toggle(opt.value)}
              />
            }
          />
        );
      })}
    </div>
  );
}

function ShortAnswerQuestion({
  value,
  onChange,
  disabled,
  result,
}: {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  result?: QuestionResult;
}) {
  const isReview = !!result;
  if (isReview) {
    return (
      <div className="rounded-[var(--radius-tile)] border border-[var(--border)] bg-[var(--bg-panel)] p-3 text-sm text-[var(--text-primary)]">
        <p className="mb-1 text-xs text-[var(--text-tertiary)]">Your answer</p>
        {value ? (
          <QuizMathText text={value} />
        ) : (
          <span className="italic text-[var(--text-faint)]">Not answered</span>
        )}
      </div>
    );
  }
  return (
    <Textarea
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="Type your answer..."
      className="min-h-[100px] resize-none rounded-[var(--radius-tile)]"
    />
  );
}

function QuestionCard({
  question,
  index,
  result,
  children,
}: {
  question: QuizQuestion;
  index: number;
  result?: QuestionResult;
  children: React.ReactNode;
}) {
  const isReview = !!result;
  const points = question.points ?? 1;
  const typeLabel =
    question.type === 'single'
      ? 'Single choice'
      : question.type === 'multiple'
        ? 'Multiple choice'
        : 'Short answer';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: EASE_ENTRANCE }}
    >
      <Card
        className={cn(
          'gap-3 rounded-[var(--radius-card)] border py-4 shadow-none ring-0',
          !isReview && 'border-[var(--border)]',
          isReview && result.status === 'correct' && 'border-success/40',
          isReview && result.status === 'incorrect' && 'border-destructive/40',
          isReview && result.status === 'ungraded' && 'border-[var(--border)]',
        )}
      >
        <CardHeader className="gap-2 px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-panel)] text-xs font-semibold text-[var(--text-secondary)]">
                {index + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium leading-relaxed text-[var(--text-primary)]">
                  <QuizMathText text={question.question} />
                </p>
                <p className="text-xs text-[var(--text-faint)]">
                  {typeLabel} &middot; {points} point{points === 1 ? '' : 's'}
                </p>
              </div>
            </div>
            {isReview && result.status === 'correct' && (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
            )}
            {isReview && result.status === 'incorrect' && (
              <XCircle className="h-5 w-5 shrink-0 text-destructive" />
            )}
          </div>
        </CardHeader>
        <CardContent className="px-5">
          {children}
          {isReview && question.analysis && (
            <div className="mt-3 rounded-[var(--radius-tile)] border border-[var(--border)] bg-[var(--bg-panel)] p-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">Explanation. </span>
              <QuizMathText text={question.analysis} />
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ScoreBanner({ score, total }: { score: number; total: number }) {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_ENTRANCE }}
      className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] px-5 py-4"
    >
      <div>
        <p className="text-xs font-medium text-[var(--text-tertiary)]">Score</p>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-semibold text-[var(--text-primary)]">{score}</span>
          <span className="text-sm text-[var(--text-faint)]">/ {total}</span>
        </div>
      </div>
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border)] text-sm font-semibold text-[var(--accent)]">
        {pct}%
      </div>
    </motion.div>
  );
}

export function QuizView({ questions }: QuizViewProps) {
  const [phase, setPhase] = useState<Phase>('not_started');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [results, setResults] = useState<QuestionResult[]>([]);

  const totalPoints = useMemo(
    () => questions.reduce((sum, q) => sum + (q.points ?? 1), 0),
    [questions],
  );

  const allAnswered = useMemo(
    () =>
      questions.every((q) => {
        const a = answers[q.id];
        if (!a) return false;
        return Array.isArray(a) ? a.length > 0 : a.trim().length > 0;
      }),
    [questions, answers],
  );

  const handleSetAnswer = useCallback((questionId: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    setPhase('submitting');
    // Choice grading is instant; the brief timeout keeps the submitting →
    // grading transition visible rather than flashing past it.
    setTimeout(() => setPhase('grading'), 250);
  }, []);

  const handleRetry = useCallback(() => {
    setPhase('not_started');
    setAnswers({});
    setResults([]);
  }, []);

  // Grading phase: local grading only (no AI short-answer endpoint yet).
  useMemo(() => {
    if (phase !== 'grading') return;
    const graded = gradeQuestions(questions, answers);
    setResults(graded);
    setPhase('reviewing');
    // Intentionally not a useEffect: grading is synchronous/local for now,
    // so deriving it inline avoids an extra render pass. Swap to useEffect
    // when short-answer grading becomes an async API call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const earnedScore = useMemo(() => results.reduce((sum, r) => sum + r.earned, 0), [results]);
  const resultMap = useMemo(() => {
    const map: Record<string, QuestionResult> = {};
    results.forEach((r) => (map[r.questionId] = r));
    return map;
  }, [results]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-canvas)]">
      <AnimatePresence mode="wait">
        {phase === 'not_started' && (
          <motion.div
            key="cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_ENTRANCE }}
            className="flex-1"
          >
            <QuizCover
              questionCount={questions.length}
              totalPoints={totalPoints}
              onStart={() => setPhase('answering')}
            />
          </motion.div>
        )}

        {phase === 'answering' && (
          <motion.div
            key="answering"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_ENTRANCE }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-3">
              <div className="flex items-center gap-2">
                <PieChart className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.4} />
                <span className="text-sm font-medium text-[var(--text-primary)]">Answering</span>
                <span className="text-xs text-[var(--text-faint)]">
                  {
                    Object.keys(answers).filter((k) => {
                      const a = answers[k];
                      return Array.isArray(a) ? a.length > 0 : !!a?.trim();
                    }).length
                  }{' '}
                  / {questions.length}
                </span>
              </div>
              <Button
                size="sm"
                disabled={!allAnswered}
                onClick={handleSubmit}
                className="rounded-[var(--radius-pill)]"
              >
                Submit answers
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4">
                {questions.map((q, i) => (
                  <QuestionCard key={q.id} question={q} index={i}>
                    {q.type === 'single' && (
                      <SingleChoiceQuestion
                        question={q}
                        value={answers[q.id] as string | undefined}
                        onChange={(v) => handleSetAnswer(q.id, v)}
                      />
                    )}
                    {q.type === 'multiple' && (
                      <MultipleChoiceQuestion
                        question={q}
                        value={answers[q.id] as string[] | undefined}
                        onChange={(v) => handleSetAnswer(q.id, v)}
                      />
                    )}
                    {q.type === 'short_answer' && (
                      <ShortAnswerQuestion
                        value={answers[q.id] as string | undefined}
                        onChange={(v) => handleSetAnswer(q.id, v)}
                      />
                    )}
                  </QuestionCard>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {(phase === 'submitting' || phase === 'grading') && (
          <motion.div
            key="grading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_ENTRANCE }}
            className="flex flex-1 flex-col items-center justify-center gap-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)]">
              <Check className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Grading your answers</p>
          </motion.div>
        )}

        {phase === 'reviewing' && (
          <motion.div
            key="reviewing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_ENTRANCE }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  Quiz report
                </span>
              </div>
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                Retry
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4">
                <ScoreBanner score={earnedScore} total={totalPoints} />
                {questions.map((q, i) => {
                  const r = resultMap[q.id];
                  return (
                    <QuestionCard key={q.id} question={q} index={i} result={r}>
                      {q.type === 'single' && (
                        <SingleChoiceQuestion
                          question={q}
                          value={answers[q.id] as string | undefined}
                          onChange={() => {}}
                          disabled
                          result={r}
                        />
                      )}
                      {q.type === 'multiple' && (
                        <MultipleChoiceQuestion
                          question={q}
                          value={answers[q.id] as string[] | undefined}
                          onChange={() => {}}
                          disabled
                          result={r}
                        />
                      )}
                      {q.type === 'short_answer' && (
                        <ShortAnswerQuestion
                          value={answers[q.id] as string | undefined}
                          onChange={() => {}}
                          disabled
                          result={r}
                        />
                      )}
                    </QuestionCard>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
