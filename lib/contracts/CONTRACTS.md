# Contracts

These files are frozen for the duration of parallel worker development.
Agents A, B, and C all import from here but don't edit these files directly,
if you hit a shape that doesn't fit, stop and report it rather than changing
the contract yourself, a change here affects all three of you at once.

- `owner.ts` — how a request's identity is resolved.
- `ai-call.ts` — the seam between the generation pipeline and any LLM backend.
- `agent-session.ts` — the split between session persistence (Agent A) and
  session domain logic (Agent B).
- `scene.ts` — re-exports the course/scene/action data contract from
  `@shikshasetu/dsl`.
