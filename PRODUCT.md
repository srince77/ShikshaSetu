# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS v4 with CSS-variable tokens, shadcn/Radix primitives, Framer Motion (`motion`). Monorepo with `packages/*` workspace packages (a DSL/contract package, plus PPTX export packages ported later). This was decided before this record was written, so it is carried here as evidence rather than a fresh answer to a stack question.

## Users

[Inferred, not interviewed: no live user was available to answer in this session, see note below.] Students and teachers in Indian classrooms (the product targets Smart Education, SIH problem statement 26205), using an AI classroom that pairs a generated lesson (slides, quizzes, whiteboard) with a small fixed roster of AI teacher/TA/peer agents, in English and Hindi.

## Product Purpose

ShikshaSetu ("Shiksha" = education, "सेतु" = bridge) is an AI classroom platform: a chat-driven agent builds a course (outline, then slides/quiz/whiteboard content) which plays back like a real lesson, narrated and annotated in real time, with the ability to interrupt and ask questions, scrub back through the lesson, and export the finished slides as a PPTX.

## Positioning

Not a slide generator and not a chatbot bolted onto slides. The product's mechanism is a small fixed classroom of agents (teacher, TA, peers) driving a synchronized, scrubbable, interruptible playback of a real lesson (slides + whiteboard + speech + quiz), authored through natural conversation, in Hindi or English.

## Operating Context

A learner opens or generates a course from the home screen, watches/listens to a scene play out (narration, spotlight/laser cues, whiteboard drawing), can pause and ask a question mid-playback, takes an inline quiz with AI-graded short answers, and can drop into a freeform canvas editor to hand-edit a slide. A teacher/course-author can edit the outline before generation and export the finished deck to PPTX.

## Capabilities and Constraints

- Frozen data contract (`lib/contracts/*`, backed by `@shikshasetu/dsl`): Stage → Scene (slide/quiz/interactive/pbl) → Action (21 discriminated action types: speech, spotlight, laser, `wb_*` whiteboard ops, `play_video`, `discussion`, `widget_*`).
- Auth and the real generation pipeline are being built in parallel by other workers; this surface is built and demoed against `SESSION_DEV_BYPASS=true` and a hand-authored fixture course.
- Two required languages: English and Hindi (Devanagari), paired fonts throughout, not just on the wordmark.
- Client-side PPTX export (`pptxgenjs`, `mathml2omml`) with no server round-trip.
- Single light "Paper White" surface only; no dark mode toggle is in scope.

## Brand Commitments

Name: **ShikshaSetu**, wordmark "Shiksha" (Source Serif 4) + "सेतु" (Hind), paired with a small arch-on-two-piers "bridge" mark. Indigo `#3D5AA6` is the sole accent color. Full visual system is authoritative and pre-finalized in `design-refs/shikshasetu-design-system.md` (colors, type scale, spacing, radius, shadow, motion, component recipes) with two mockups in `design-refs/Main-html/` and `design-refs/WarmBone-html/` — that document is the design authority for this project, this PRODUCT.md file exists only to satisfy the impeccable skill's own bookkeeping alongside it.

## Evidence on Hand

- `lib/contracts/fixtures/sample-course.json`: a validated sample course (a slide scene + a single-choice quiz scene) used as the real-shaped data every UI in this phase is built against.
- `design-refs/shikshasetu-design-system.md` and its two `.dc.html` mockups: the finalized visual system, extracted from a published design canvas.

## Product Principles

1. Flat, solid, light surfaces only — no gradients, glows, blobs, or dot-grids as decoration (Cool Fog's drifting dot-grid is a named, singular exception this product does not use).
2. One accent color (indigo), used only for brand marks and the primary/affirmative action, never as a background fill.
3. Motion animates in once and never loops; a screen that feels like it needs continuous motion needs a real interaction instead.
4. Build against the frozen contract and fixture data, not a guessed future API shape; swap in real data at integration time without reshaping the UI.
5. Hindi is a first-class, paired-font citizen everywhere text appears, not a translation bolted onto an English-first layout.

## Accessibility & Inclusion

No product-specific accessibility requirement was confirmed beyond the standard shadcn/Radix primitives' built-in keyboard and screen-reader behavior, kept intact by porting those primitives near-verbatim rather than hand-rolling replacements.
