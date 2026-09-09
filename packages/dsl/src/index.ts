/**
 * @shikshasetu/dsl: pure, dependency-free contract keystone for the ShikshaSetu SDK family.
 * Contains only the spec: types, JSON Schema artifacts, pure validators/type-guards,
 * pure `normalize*` defaulters, and version/migration helpers. Must never gain a
 * runtime dependency on React, pptx, echarts, etc.
 */
export * from './slides.js';
export * from './guards.js';
export * from './stage.js';
export * from './interactive.js';
export * from './pbl.js';
export * from './action.js';
export * from './validate.js';
export * from './normalize.js';
export * from './version.js';
export * from './storage.js';
export * from './asset-manifest.js';
export * from './slide-media-slots.js';
export * from './runtime.js';
