import type { CapabilityJsonValue } from "../mock-core/capability-control-plane-types.js";
import type { PilibalaJsonValue } from "../catalog/semantic-action-types.js";

export const CAPABILITY_REDACTED = "[REDACTED]";

export function redactSemanticValue(value: unknown, key = ""): CapabilityJsonValue {
  if (key.length === 0) {
    return redactPilibalaSemanticValue(value) as CapabilityJsonValue;
  }
  const wrapped = redactPilibalaSemanticValue({ [key]: value });
  if (typeof wrapped !== "object" || wrapped === null || Array.isArray(wrapped)) {
    return CAPABILITY_REDACTED;
  }
  const object = wrapped as { readonly [entryKey: string]: PilibalaJsonValue };
  return (object[key] ?? CAPABILITY_REDACTED) as CapabilityJsonValue;
}

const PILIBALA_SENSITIVE_KEY =
  /(?:authorization(?:[-_]?code)?|cookie|credentials?|passwords?|passwd|private.?key|secrets?|token|api.?key|connection.?string)(?:[-_]?(?:value|header|prod(?:uction)?|dev(?:elopment)?|test|staging|primary|secondary))*$/i;
const PILIBALA_SECRET_VALUE =
  /(?:\bBearer\s+(?!(?:tokens?|authentication|authorization|credentials?|schemes?|flows?)[.,;:!?]?(?:\s|$))[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|pk|pcgw|ghp|github_pat)_[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/gi;
const PILIBALA_SECRET_QUERY =
  /([?&](?:code|key|secret|state|token|api[_-]?key|access[_-]?token)=)[^&#\s]+/gi;
const PILIBALA_PILIBALA_SECRET_QUERY_DETECT =
  /[?&](?:code|key|secret|state|token|api[_-]?key|access[_-]?token)=[^&#\s]+/i;

const PILIBALA_MAX_DEPTH = 16;
const PILIBALA_MAX_NODES = 10_000;
const PILIBALA_MAX_ARRAY_ITEMS = 512;
const PILIBALA_MAX_OBJECT_KEYS = 512;
const PILIBALA_MAX_STRING_LENGTH = 200_000;

export const PILIBALA_SEMANTIC_REDACTED = "[REDACTED]";
export const PILIBALA_SEMANTIC_TRUNCATED = "[TRUNCATED]";

export interface PilibalaSemanticValueSafety {
  readonly containsProtectedData: boolean;
  readonly withinBounds: boolean;
}

export function inspectPilibalaSemanticValue(
  value: unknown,
): PilibalaSemanticValueSafety {
  return inspectValueSafety(value, true);
}

/** Validate transport bounds without inspecting credential content. */
export function isPilibalaSemanticValueWithinBounds(value: unknown): boolean {
  return inspectValueSafety(value, false).withinBounds;
}

function inspectValueSafety(
  value: unknown,
  detectCredentials: boolean,
): PilibalaSemanticValueSafety {
  const state = { nodes: 0, protected: false, withinBounds: true, detectCredentials };
  inspect(value, "", 0, state, new Set<object>());
  return Object.freeze({
    containsProtectedData: state.protected,
    withinBounds: state.withinBounds,
  });
}

export function redactPilibalaSemanticValue(
  value: unknown,
): PilibalaJsonValue {
  const state = { nodes: 0 };
  return redact(value, "", 0, state, new Set<object>());
}

function inspect(
  value: unknown,
  key: string,
  depth: number,
  state: {
    nodes: number;
    protected: boolean;
    withinBounds: boolean;
    detectCredentials: boolean;
  },
  ancestors: Set<object>,
): void {
  state.nodes += 1;
  if (state.nodes > PILIBALA_MAX_NODES || depth > PILIBALA_MAX_DEPTH) {
    state.withinBounds = false;
    return;
  }
  if (state.detectCredentials && PILIBALA_SENSITIVE_KEY.test(key)) {
    state.protected = true;
  }
  if (typeof value === "string") {
    if (value.length > PILIBALA_MAX_STRING_LENGTH) state.withinBounds = false;
    PILIBALA_SECRET_VALUE.lastIndex = 0;
    if (
      state.detectCredentials &&
      (PILIBALA_SECRET_VALUE.test(value) || PILIBALA_PILIBALA_SECRET_QUERY_DETECT.test(value))
    ) {
      state.protected = true;
    }
    PILIBALA_SECRET_VALUE.lastIndex = 0;
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > PILIBALA_MAX_ARRAY_ITEMS) state.withinBounds = false;
    if (ancestors.has(value)) {
      state.withinBounds = false;
      return;
    }
    ancestors.add(value);
    for (const child of value.slice(0, PILIBALA_MAX_ARRAY_ITEMS)) {
      inspect(child, "", depth + 1, state, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value)) {
      state.withinBounds = false;
      return;
    }
    const entries = Object.entries(value);
    if (entries.length > PILIBALA_MAX_OBJECT_KEYS) state.withinBounds = false;
    ancestors.add(value);
    for (const [childKey, child] of entries.slice(0, PILIBALA_MAX_OBJECT_KEYS)) {
      inspect(child, childKey, depth + 1, state, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (
    value !== null &&
    typeof value !== "number" &&
    typeof value !== "boolean" &&
    typeof value !== "undefined"
  ) {
    state.withinBounds = false;
  }
}

function redact(
  value: unknown,
  key: string,
  depth: number,
  state: { nodes: number },
  ancestors: Set<object>,
): PilibalaJsonValue {
  state.nodes += 1;
  if (state.nodes > PILIBALA_MAX_NODES || depth > PILIBALA_MAX_DEPTH) {
    return PILIBALA_SEMANTIC_TRUNCATED;
  }
  if (PILIBALA_SENSITIVE_KEY.test(key)) return PILIBALA_SEMANTIC_REDACTED;
  if (typeof value === "string") {
    PILIBALA_SECRET_VALUE.lastIndex = 0;
    const redacted = value
      .replace(PILIBALA_SECRET_VALUE, PILIBALA_SEMANTIC_REDACTED)
      .replace(PILIBALA_SECRET_QUERY, `$1${PILIBALA_SEMANTIC_REDACTED}`);
    PILIBALA_SECRET_VALUE.lastIndex = 0;
    return redacted.length <= PILIBALA_MAX_STRING_LENGTH
      ? redacted
      : `${redacted.slice(0, PILIBALA_MAX_STRING_LENGTH)}${PILIBALA_SEMANTIC_TRUNCATED}`;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return PILIBALA_SEMANTIC_TRUNCATED;
    ancestors.add(value);
    const result = value
      .slice(0, PILIBALA_MAX_ARRAY_ITEMS)
      .map((child) => redact(child, "", depth + 1, state, ancestors));
    ancestors.delete(value);
    if (value.length > PILIBALA_MAX_ARRAY_ITEMS) {
      result.push(PILIBALA_SEMANTIC_TRUNCATED);
    }
    return result;
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value)) return PILIBALA_SEMANTIC_TRUNCATED;
    ancestors.add(value);
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, PILIBALA_MAX_OBJECT_KEYS)
      .map(
        ([childKey, child]) =>
          [
            childKey,
            redact(child, childKey, depth + 1, state, ancestors),
          ] as const,
      );
    ancestors.delete(value);
    const result: Record<string, PilibalaJsonValue> =
      Object.fromEntries(entries);
    if (Object.keys(value).length > PILIBALA_MAX_OBJECT_KEYS) {
      result.__pilibala_truncated__ = PILIBALA_SEMANTIC_TRUNCATED;
    }
    return result;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  return PILIBALA_SEMANTIC_TRUNCATED;
}
