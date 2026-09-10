/**
 * `lib/choreography` — the playback timing/cursor semantics shared by the
 * playback engine and (later) any offline interpreter of the same actions.
 * Pure: no React/DOM, only `@shikshasetu/dsl` types and plain functions.
 */
export * from './timing';
export * from './cursor';
