# ShikshaSetu

An AI-powered personalised learning platform: describe a topic or upload
study material, and get a full interactive lesson back, an AI teacher that
explains it, an AI TA that answers doubts, AI peers that debate it, quizzes,
interactive activities, and voice narration in Hindi and other Indian
languages.

## Status

Early build. See `docs/` (coming soon) for architecture notes.

## Stack

- Next.js, TypeScript, Tailwind CSS, shadcn/ui, Framer Motion
- Node.js backend, PostgreSQL (Neon) with pgvector
- AWS Bedrock for LLM inference
- Bhashini/AI4Bharat for Hindi/Indic voice, with an AWS Polly/Transcribe fallback

## Development

```bash
pnpm install
cp .env.example .env.local   # fill in your own credentials
pnpm dev
```

## Project layout

- `app/` — Next.js App Router pages and API routes
- `lib/` — core business logic (auth, db, ai, generation, orchestration, playback, ...)
- `components/` — React UI
- `packages/` — internal workspace packages (data contract, generation pipeline, PPTX export)
- `db/migrations/` — SQL schema migrations
- `design-refs/` — visual reference material for UI design
