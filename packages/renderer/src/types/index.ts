// The slide object model is the canonical contract from @shikshasetu/dsl. The renderer
// no longer vendors its own copy; it re-exports the DSL types here so the public
// `@shikshasetu/renderer/types` surface stays intact.
export * from '@shikshasetu/dsl';
export * from './effects';
