/**
 * Shared payload guard for the JSONB-backed stores in `lib/db/*`.
 *
 * A JSON backend must narrow the accepted payload domain to exactly what
 * survives `JSON.stringify` / `JSON.parse` losslessly, or a write could
 * silently hand back different data on the next read. Two string exceptions
 * are enforced even though they are technically legal JSON, so every JSON
 * backend refuses the same inputs rather than one accepting what another
 * must reject: the NUL code point (U+0000), which Postgres jsonb cannot
 * store (error 22P05), and unpaired UTF-16 surrogates, which jsonb rejects
 * (22P02).
 */

interface NonJsonValue {
  pointer: string;
  reason: string;
}

function isPlainPrototype(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function isCanonicalIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

// In u-mode a surrogate pair is consumed as one astral code point, so this
// matches exactly the unpaired surrogates.
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

function definesToJson(value: object): boolean {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'toJSON');
    if (descriptor !== undefined) {
      if ('value' in descriptor) return typeof descriptor.value === 'function';
      return true;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

function findNonJsonString(value: string, pointer: string): NonJsonValue | undefined {
  if (value.includes('\u0000')) {
    return { pointer, reason: 'string contains the NUL code point (\\u0000)' };
  }
  if (LONE_SURROGATE.test(value)) {
    return { pointer, reason: 'string contains an unpaired UTF-16 surrogate' };
  }
  return undefined;
}

/**
 * True when `value` contains neither of the two string exceptions above. A
 * key that fails this predicate can never match a stored row, so treating it
 * as absent on a read/delete path is provably sound.
 */
export function isLosslessJsonString(value: string): boolean {
  return findNonJsonString(value, '') === undefined;
}

function findNonJsonValue(
  value: unknown,
  pointer: string,
  seen: Set<object>,
): NonJsonValue | undefined {
  if (value === null || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') {
    if (Object.is(value, -0)) {
      return { pointer, reason: 'negative zero (JSON serializes it as 0)' };
    }
    if (Number.isFinite(value)) return undefined;
    return { pointer, reason: `non-finite number ${String(value)}` };
  }
  if (typeof value === 'string') {
    return findNonJsonString(value, pointer);
  }
  if (typeof value !== 'object') {
    return { pointer, reason: `${typeof value} is not a JSON value` };
  }
  if (seen.has(value)) return { pointer, reason: 'circular reference' };
  if (definesToJson(value)) {
    return { pointer, reason: 'value defines toJSON (would serialize differently than validated)' };
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const arrayProto = Object.getPrototypeOf(value) as object | null;
      const objectProto =
        arrayProto === null ? null : (Object.getPrototypeOf(arrayProto) as object | null);
      if (objectProto === null || Object.getPrototypeOf(objectProto) !== null) {
        return {
          pointer,
          reason: 'array with a non-Array prototype (subclass/null-proto) does not survive JSON',
        };
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !isCanonicalIndex(key, value.length)) {
          return {
            pointer: `${pointer}/${String(key)}`,
            reason: 'array carries a non-index own property (dropped by JSON)',
          };
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && (descriptor.get || descriptor.set)) {
          return {
            pointer: `${pointer}/${key}`,
            reason: 'accessor property (its value can change between validation and JSON)',
          };
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return { pointer: `${pointer}/${index}`, reason: 'sparse array hole' };
        }
        const nested = findNonJsonValue(value[index], `${pointer}/${index}`, seen);
        if (nested) return nested;
      }
      return undefined;
    }
    if (!isPlainPrototype(value)) {
      return {
        pointer,
        reason: 'not a plain object (Map, Set, Date, class instances do not survive JSON)',
      };
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        return { pointer, reason: 'symbol-keyed own property (dropped by JSON)' };
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && !descriptor.enumerable) {
        return {
          pointer: `${pointer}/${key}`,
          reason: 'non-enumerable own property (dropped by JSON)',
        };
      }
      if (descriptor && (descriptor.get || descriptor.set)) {
        return {
          pointer: `${pointer}/${key}`,
          reason: 'accessor property (its value can change between validation and JSON)',
        };
      }
      const keyIssue = findNonJsonString(key, `${pointer}/${key}`);
      if (keyIssue) {
        return { pointer: keyIssue.pointer, reason: `object key: ${keyIssue.reason}` };
      }
      const member = (value as Record<string, unknown>)[key];
      if (member === undefined) {
        return { pointer: `${pointer}/${key}`, reason: 'undefined member (dropped by JSON)' };
      }
      const nested = findNonJsonValue(member, `${pointer}/${key}`, seen);
      if (nested) return nested;
    }
    return undefined;
  } finally {
    seen.delete(value);
  }
}

/** Throw unless `value` survives JSON serialization losslessly. */
export function assertJsonValue(value: unknown, label: string): void {
  const offender = findNonJsonValue(value, '', new Set());
  if (offender) {
    throw new Error(
      `${label} is not a plain JSON value at '${offender.pointer || '/'}': ${offender.reason}`,
    );
  }
}
