// Everything the QA entry reports passes through here: JSON only, depth / length limited, secrets redacted.
import type { QaJson } from './types';

/** Keys whose values are never shown (purchase tokens, JWTs, auth, keys, passwords …). */
const SECRET_KEY = /token|jwt|secret|passw|signature|auth|api_?key|private_?key|service_?key|session_?key|cookie|credential/i;
/** A JWT-looking value, wherever it sits. */
const JWT_VALUE = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/;
const MAX_DEPTH = 4;
const MAX_ITEMS = 20;
const MAX_STRING = 160;

const redactedValue = (value: unknown): QaJson =>
  Array.isArray(value) ? `[redacted ×${value.length}]` : '[redacted]';

export function toQaJson(value: unknown, depth = 0): QaJson {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (JWT_VALUE.test(value)) return '[redacted]';
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return null; // functions, symbols
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[array ×${value.length}]` : '[object]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => toQaJson(item, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`…+${value.length - MAX_ITEMS}`);
    return items;
  }
  if (value instanceof Error) return { error: value.name, message: toQaJson(value.message, depth + 1) };
  const out: Record<string, QaJson> = {};
  let count = 0;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (count++ >= MAX_ITEMS) {
      out['…'] = `+${Object.keys(value as object).length - MAX_ITEMS} keys`;
      break;
    }
    out[key] = SECRET_KEY.test(key) ? redactedValue(item) : toQaJson(item, depth + 1);
  }
  return out;
}

/** A plain string for the header / diagnostics (never a JWT, never a page of text). */
export const safeText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const json = toQaJson(typeof value === 'string' ? value : String(value));
  return typeof json === 'string' ? json : null;
};
