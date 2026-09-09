/**
 * Structural validators for the slide DSL contract: object shape, required
 * fields, known discriminants, and the scene `type` <-> `content` binding.
 * A zero-dependency structural subset of the shipped JSON Schema
 * (`@shikshasetu/dsl/schema/*`), which additionally checks value shape.
 */
import { isActionType } from './action.js';
import type { ActionType } from './action.js';
import { isWidgetType } from './interactive.js';
import { isPBLProject } from './pbl.js';
import { isSceneType } from './stage.js';
import { isIsoTimestamp, isRuntimeSessionStatus } from './runtime.js';
import { isWellFormedDslVersion } from './version.js';

export interface ValidationIssue {
  /** JSON-pointer-ish path to the offending value, e.g. `/actions/0/elementId`. */
  path: string;
  message: string;
}

export type ValidationResult = { valid: true } | { valid: false; errors: ValidationIssue[] };

/** Runtime kind of a required field, checked with `typeof` / `Array.isArray`. */
type FieldKind = 'string' | 'number' | 'boolean' | 'object' | 'array';

/** Required fields beyond `ActionBase` (`id`) per action variant, with runtime kind.
 * Kept in lockstep with the generated `action.schema.json` by a test. */
const ACTION_REQUIRED_FIELDS: Record<ActionType, Readonly<Record<string, FieldKind>>> = {
  spotlight: { elementId: 'string' },
  laser: { elementId: 'string' },
  play_video: { elementId: 'string' },
  speech: { text: 'string' },
  wb_open: {},
  wb_draw_text: { content: 'string', x: 'number', y: 'number' },
  wb_draw_shape: { shape: 'string', x: 'number', y: 'number', width: 'number', height: 'number' },
  wb_draw_chart: {
    chartType: 'string',
    x: 'number',
    y: 'number',
    width: 'number',
    height: 'number',
    data: 'object',
  },
  wb_draw_latex: { latex: 'string', x: 'number', y: 'number' },
  wb_draw_table: { x: 'number', y: 'number', width: 'number', height: 'number', data: 'array' },
  wb_draw_line: { startX: 'number', startY: 'number', endX: 'number', endY: 'number' },
  wb_draw_code: { language: 'string', code: 'string', x: 'number', y: 'number' },
  wb_edit_code: { elementId: 'string', operation: 'string' },
  wb_clear: {},
  wb_delete: { elementId: 'string' },
  wb_close: {},
  discussion: { topic: 'string' },
  widget_highlight: { target: 'string' },
  widget_setState: { state: 'object' },
  widget_annotation: { target: 'string' },
  widget_reveal: { target: 'string' },
};

function matchesKind(value: unknown, kind: FieldKind): boolean {
  if (kind === 'array') return Array.isArray(value);
  if (kind === 'object') return isObject(value);
  return typeof value === kind;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function reqString(
  o: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationIssue[],
): void {
  if (typeof o[key] !== 'string')
    errors.push({ path: `${path}/${key}`, message: `expected string \`${key}\`` });
}

function reqNumber(
  o: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationIssue[],
): void {
  if (typeof o[key] !== 'number')
    errors.push({ path: `${path}/${key}`, message: `expected number \`${key}\`` });
}

function done(errors: ValidationIssue[]): ValidationResult {
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Check root-level envelope fields against their declared runtime kinds.
 * Required mode also rejects an empty string (an empty `id`/`learnerKey`
 * passes `typeof` but is useless as an identity key); optional mode only
 * checks `typeof` when the field is present.
 */
function checkFields(
  doc: Record<string, unknown>,
  fields: Readonly<Record<string, FieldKind>>,
  opts: { optional?: boolean },
  errors: ValidationIssue[],
): void {
  for (const [field, kind] of Object.entries(fields)) {
    const value = doc[field];
    if (opts.optional) {
      if (value !== undefined && !matchesKind(value, kind)) {
        errors.push({ path: `/${field}`, message: `expected ${kind} \`${field}\`` });
      }
      continue;
    }
    if (!matchesKind(value, kind)) {
      errors.push({ path: `/${field}`, message: `expected ${kind} \`${field}\`` });
      continue;
    }
    if (kind === 'string' && value === '') {
      errors.push({ path: `/${field}`, message: `expected non-empty string \`${field}\`` });
    }
  }
}

function checkAction(doc: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isObject(doc)) {
    errors.push({ path: path || '/', message: 'action must be an object' });
    return;
  }
  reqString(doc, 'id', path, errors);
  if (!isActionType(doc.type)) {
    errors.push({
      path: `${path}/type`,
      message: `unknown action type: ${JSON.stringify(doc.type)}`,
    });
    return; // can't check variant fields without a known type
  }
  for (const [field, kind] of Object.entries(ACTION_REQUIRED_FIELDS[doc.type])) {
    const value = doc[field];
    if (value === undefined) {
      errors.push({
        path: `${path}/${field}`,
        message: `${doc.type} action requires \`${field}\``,
      });
    } else if (!matchesKind(value, kind)) {
      errors.push({
        path: `${path}/${field}`,
        message: `${doc.type} action field \`${field}\` must be ${kind}`,
      });
    }
  }
}

function checkInteractiveContent(doc: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isObject(doc)) {
    errors.push({ path: path || '/', message: 'interactive content must be an object' });
    return;
  }
  if (doc.type !== 'interactive') {
    errors.push({ path: `${path}/type`, message: 'expected `interactive` content type' });
  }
  if (typeof doc.html !== 'string' && typeof doc.url !== 'string') {
    errors.push({
      path: path || '/',
      message: 'interactive content requires `html` or `url` as a string',
    });
  }
  if (doc.url !== undefined && typeof doc.url !== 'string') {
    errors.push({ path: `${path}/url`, message: '`url` must be a string when present' });
  }
  if (doc.html !== undefined && typeof doc.html !== 'string') {
    errors.push({ path: `${path}/html`, message: '`html` must be a string when present' });
  }
  if (doc.widgetType !== undefined && !isWidgetType(doc.widgetType)) {
    errors.push({
      path: `${path}/widgetType`,
      message: `unknown widget type: ${JSON.stringify(doc.widgetType)}`,
    });
  }
  if (doc.widgetConfig !== undefined) {
    if (!isObject(doc.widgetConfig)) {
      errors.push({
        path: `${path}/widgetConfig`,
        message: '`widgetConfig` must be an object when present',
      });
    } else if (!isWidgetType(doc.widgetConfig.type)) {
      errors.push({
        path: `${path}/widgetConfig/type`,
        message: `unknown widget config type: ${JSON.stringify(doc.widgetConfig.type)}`,
      });
    }
  }
}

function checkPBLContent(doc: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isObject(doc)) {
    errors.push({ path: path || '/', message: 'pbl content must be an object' });
    return;
  }
  if (doc.type !== 'pbl') {
    errors.push({ path: `${path}/type`, message: 'expected `pbl` content type' });
  }
  if (doc.projectV2 !== undefined && !isPBLProject(doc.projectV2)) {
    errors.push({
      path: `${path}/projectV2`,
      message: '`projectV2` must be a structurally valid PBL project when present',
    });
  }
  if (doc.projectConfig !== undefined && !isObject(doc.projectConfig)) {
    errors.push({
      path: `${path}/projectConfig`,
      message: '`projectConfig` must be an object when present',
    });
  }
}

function checkScene(doc: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isObject(doc)) {
    errors.push({ path: path || '/', message: 'scene must be an object' });
    return;
  }
  reqString(doc, 'id', path, errors);
  reqString(doc, 'stageId', path, errors);
  reqString(doc, 'title', path, errors);
  reqNumber(doc, 'order', path, errors);

  const t = doc.type;
  if (!isSceneType(t)) {
    errors.push({
      path: `${path}/type`,
      message: `unknown scene type: ${JSON.stringify(t)}`,
    });
  }

  const content = doc.content;
  if (!isObject(content)) {
    errors.push({ path: `${path}/content`, message: 'scene `content` must be an object' });
  } else if (isSceneType(t)) {
    if (content.type !== t) {
      errors.push({
        path: `${path}/content/type`,
        message: `content type ${JSON.stringify(content.type)} does not match scene type ${JSON.stringify(t)}`,
      });
    } else if (t === 'slide' && !isObject(content.canvas)) {
      errors.push({
        path: `${path}/content/canvas`,
        message: 'slide content requires an object `canvas`',
      });
    } else if (t === 'quiz' && !Array.isArray(content.questions)) {
      errors.push({
        path: `${path}/content/questions`,
        message: 'quiz content requires a `questions` array',
      });
    } else if (t === 'interactive') {
      checkInteractiveContent(content, `${path}/content`, errors);
    } else if (t === 'pbl') {
      checkPBLContent(content, `${path}/content`, errors);
    }
  }

  if (doc.actions !== undefined) {
    if (!Array.isArray(doc.actions)) {
      errors.push({ path: `${path}/actions`, message: '`actions` must be an array' });
    } else {
      doc.actions.forEach((a, i) => checkAction(a, `${path}/actions/${i}`, errors));
    }
  }
}

/** Validate a {@link Stage} aggregate (course metadata; scenes are separate). */
export function validateStage(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isObject(doc))
    return { valid: false, errors: [{ path: '/', message: 'stage must be an object' }] };
  reqString(doc, 'id', '', errors);
  reqString(doc, 'name', '', errors);
  reqNumber(doc, 'createdAt', '', errors);
  reqNumber(doc, 'updatedAt', '', errors);
  return done(errors);
}

/** Validate a {@link Scene} aggregate, including its nested content + actions. */
export function validateScene(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  checkScene(doc, '', errors);
  return done(errors);
}

/** Validate a standalone interactive content payload. */
export function validateInteractiveContent(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  checkInteractiveContent(doc, '', errors);
  return done(errors);
}

/** Validate a standalone current or legacy PBL content payload. */
export function validatePBLContent(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  checkPBLContent(doc, '', errors);
  return done(errors);
}

/** Validate a single {@link Action}, including its variant-required fields. */
export function validateAction(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  checkAction(doc, '', errors);
  return done(errors);
}

/** Required envelope fields of a runtime session, with their runtime kinds. */
const RUNTIME_SESSION_REQUIRED_FIELDS: Readonly<Record<string, FieldKind>> = {
  id: 'string',
  kind: 'string',
  stageId: 'string',
  learnerKey: 'string',
  status: 'string',
  createdAt: 'string',
  updatedAt: 'string',
};

/** Validate a runtime session envelope. Payloads live on records, so this is a
 * pure envelope check; `kind` is an open string by design. */
export function validateRuntimeSession(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isObject(doc)) {
    return { valid: false, errors: [{ path: '/', message: 'runtime session must be an object' }] };
  }
  checkFields(doc, RUNTIME_SESSION_REQUIRED_FIELDS, {}, errors);
  if (typeof doc.status === 'string' && !isRuntimeSessionStatus(doc.status)) {
    errors.push({
      path: '/status',
      message: `unknown session status: ${JSON.stringify(doc.status)}`,
    });
  }
  // Refine only a present non-empty string to ISO format; empty/wrong-typed already
  // reported by the required-field table above, so it isn't double-reported here.
  if (typeof doc.createdAt === 'string' && doc.createdAt !== '' && !isIsoTimestamp(doc.createdAt)) {
    errors.push({ path: '/createdAt', message: 'expected ISO 8601 `createdAt`' });
  }
  if (typeof doc.updatedAt === 'string' && doc.updatedAt !== '' && !isIsoTimestamp(doc.updatedAt)) {
    errors.push({ path: '/updatedAt', message: 'expected ISO 8601 `updatedAt`' });
  }
  // Required: sessions are always stamped at write time, so an absent stamp is a bug,
  // not legacy data. A present stamp must be well-formed `x.y.z` (migrateRuntime throws otherwise).
  if (doc.runtimeDslVersion === undefined) {
    errors.push({
      path: '/runtimeDslVersion',
      message: 'missing `runtimeDslVersion`; runtime sessions are stamped at write time',
    });
  } else if (typeof doc.runtimeDslVersion !== 'string') {
    errors.push({ path: '/runtimeDslVersion', message: 'expected string `runtimeDslVersion`' });
  } else if (!isWellFormedDslVersion(doc.runtimeDslVersion)) {
    errors.push({
      path: '/runtimeDslVersion',
      message: 'malformed `runtimeDslVersion`: expected x.y.z',
    });
  }
  // A session versions on `runtimeDslVersion`, never the document line's `dslVersion`;
  // a stray sibling stamp is evidence of a misrouted migration, so reject it here.
  if (doc.dslVersion !== undefined) {
    errors.push({
      path: '/dslVersion',
      message:
        'unexpected document-line `dslVersion` on a runtime session; sessions version on `runtimeDslVersion`',
    });
  }
  return done(errors);
}

/** Required envelope fields of a runtime record, with their runtime kinds. */
const RUNTIME_RECORD_REQUIRED_FIELDS: Readonly<Record<string, FieldKind>> = {
  id: 'string',
  sessionId: 'string',
  seq: 'number',
  createdAt: 'string',
};

/** Optional anchor fields of a runtime record, with their runtime kinds. */
const RUNTIME_RECORD_OPTIONAL_FIELDS: Readonly<Record<string, FieldKind>> = {
  sceneId: 'string',
  actionIndex: 'number',
  subAnchor: 'string',
};

/** Validate a runtime record envelope. The payload is app-owned and checked
 * only for presence; per-kind payload validators are injected at the store boundary. */
export function validateRuntimeRecord(doc: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  if (!isObject(doc)) {
    return { valid: false, errors: [{ path: '/', message: 'runtime record must be an object' }] };
  }
  checkFields(doc, RUNTIME_RECORD_REQUIRED_FIELDS, {}, errors);
  checkFields(doc, RUNTIME_RECORD_OPTIONAL_FIELDS, { optional: true }, errors);

  // seq is the sole replay ordering key: narrow to a non-negative integer so a
  // malformed value (NaN/Infinity/negative/fractional all pass typeof 'number') can't corrupt replay order.
  if (typeof doc.seq === 'number' && !(Number.isInteger(doc.seq) && doc.seq >= 0)) {
    errors.push({ path: '/seq', message: 'expected non-negative integer `seq`' });
  }
  if (
    typeof doc.actionIndex === 'number' &&
    !(Number.isInteger(doc.actionIndex) && doc.actionIndex >= 0)
  ) {
    errors.push({ path: '/actionIndex', message: 'expected non-negative integer `actionIndex`' });
  }

  if (typeof doc.createdAt === 'string' && doc.createdAt !== '' && !isIsoTimestamp(doc.createdAt)) {
    errors.push({ path: '/createdAt', message: 'expected ISO 8601 `createdAt`' });
  }

  // Reject an explicit `{ payload: undefined }`, not just a missing key; `null` stays legal.
  if (doc.payload === undefined) {
    errors.push({ path: '/payload', message: 'expected `payload`' });
  }
  return done(errors);
}
