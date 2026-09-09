// The app-level contract for course/scene/action data. Every package that
// reads or writes course content imports from here, not directly from
// @shikshasetu/dsl, so the DSL package can change without touching every
// call site.
export * from '@shikshasetu/dsl';
