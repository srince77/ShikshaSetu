/**
 * Timing spec — the single source of truth for playback timing. Pure:
 * depends on nothing (no React/DOM), so it stays interpretable outside a
 * browser (e.g. a future video exporter) if one is ever built against it.
 */

// ==================== Effect / scene timing ====================

/** Duration (ms) a fire-and-forget effect (spotlight/laser) stays before auto-clearing. */
export const EFFECT_AUTO_CLEAR_MS = 5000;

/** Delay (ms) before a discussion trigger shows its ProactiveCard (lets prior speech finish). */
export const DISCUSSION_TRIGGER_DELAY_MS = 3000;

/**
 * Duration (ms) the ProactiveCard counts down in playback mode before it
 * auto-skips and playback continues.
 */
export const DISCUSSION_AUTO_SKIP_MS = 5000;

/** Safety cap (ms) on how long playback waits for a video to finish. */
export const MAX_VIDEO_WAIT_MS = 5 * 60 * 1000;

// ==================== Whiteboard / widget action durations ====================
//
// The blocking "visual duration" of each synchronous action — how long the
// engine awaits before advancing to the next action.

/** wb_open — open animation (slow spring). */
export const WB_OPEN_MS = 2000;

/** wb_draw_* (text/shape/chart/latex/table/line) — element fade-in. */
export const WB_DRAW_MS = 800;

/** wb_edit_code — line-level edit animation. */
export const WB_EDIT_MS = 600;

/** wb_delete — element removal. */
export const WB_DELETE_MS = 300;

/** wb_close — close animation (ease-out tween). */
export const WB_CLOSE_MS = 700;

/** widget_* interactions (highlight/setState/annotation/reveal). */
export const WIDGET_MS = 300;

/** wb_draw_code — typing animation: base 800ms + 50ms/line, capped at 3000ms. */
export function wbDrawCodeMs(lineCount: number): number {
  return Math.min(800 + lineCount * 50, 3000);
}

/** wb_clear — clear animation: base 380ms + 55ms/element, capped at 1400ms. */
export function wbClearMs(elementCount: number): number {
  return Math.min(380 + elementCount * 55, 1400);
}

// ==================== No-audio narration estimate ====================

/**
 * Characters counted as CJK for the reading-timer heuristic: CJK Unified
 * Ideographs (+ Ext-A), Hiragana, Katakana, Hangul Syllables. ShikshaSetu's
 * own content is English/Hindi, but imported/mixed-language slide text can
 * still carry CJK characters, so the heuristic is kept general.
 */
const CJK_REGEX = /[一-鿿㐀-䶿぀-ヿ가-힯]/g;

/** Text is treated as CJK when this fraction of its characters are CJK. */
const CJK_RATIO_THRESHOLD = 0.3;

/** Minimum estimated reading time (ms), regardless of length. */
const MIN_READING_MS = 2000;

/** CJK narration pace: ms per character (one char ≈ one word). */
const CJK_MS_PER_CHAR = 150;

/** Non-CJK narration pace: ms per word (≈250 WPM). */
const NON_CJK_MS_PER_WORD = 240;

export interface SpeechEstimateOptions {
  /** Playback speed multiplier; the estimate is divided by it. Default 1. */
  speed?: number;
}

/**
 * Estimate how long narration takes to "speak" when no pre-generated audio is
 * available (TTS disabled). Deterministic.
 *
 * - CJK text (>30% CJK chars): ~150ms/char.
 * - Non-CJK text (English/Hindi included): ~240ms/word (≈250 WPM).
 * - Floored at 2000ms, then divided by playback speed.
 */
export function estimateSpeechDurationMs(text: string, opts?: SpeechEstimateOptions): number {
  const speed = opts?.speed ?? 1;
  const cjkCount = (text.match(CJK_REGEX) || []).length;
  const isCJK = cjkCount > text.length * CJK_RATIO_THRESHOLD;
  const rawMs = isCJK
    ? Math.max(MIN_READING_MS, text.length * CJK_MS_PER_CHAR)
    : Math.max(MIN_READING_MS, text.split(/\s+/).filter(Boolean).length * NON_CJK_MS_PER_WORD);
  return rawMs / speed;
}
