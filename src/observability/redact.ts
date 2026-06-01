/**
 * Sprint 4.0.2 — single-source-of-truth PII redactor (contract C8 consolidation).
 *
 * This module is the only place in the codebase where redaction regexes
 * live. Three independent surfaces import from here:
 *
 *   1. `src/engine/state.ts` audit-walk (`redactTokens`)
 *   2. `src/observability/sentry.ts` `beforeSend` (`redactSensitive`)
 *   3. Audit-log forwarder shape check / Vector transform (offline review)
 *
 * Two distinct entry points are exported on purpose:
 *
 *   - `redactTokens(input)` — legacy audit-walk shape from Sprint 4.0.1 W9.
 *     Replaces `ows_key_…` tokens with the literal `ows_key_***` so that
 *     pre-existing tests at `tests/token-redaction.test.ts` (AM45) still
 *     assert against the same output. Single pattern, no other Tier-1
 *     coverage.
 *
 *   - `redactSensitive(input)` — Sprint 4.0.2 multi-pattern Tier-1
 *     redactor used by Sentry `beforeSend` and any other surface that
 *     leaves the process. Covers all four Tier-1 patterns documented in
 *     the contract: `ows_key_…`, `SETUP-XXXX-XXXX`, private-key hex,
 *     `OWS_PASSPHRASE=…`. Replacements are bracketed (`[REDACTED_*]`) so
 *     a reviewer scanning Sentry's UI can see at a glance that
 *     redaction fired.
 *
 * Tier-2 content (child names, family names, wallet addresses, tx
 * amounts) is deliberately NOT redacted here — see `docs/PRIVACY.md` and
 * contract C9. Strings containing only Tier-2 content pass through
 * unchanged.
 *
 * 100% branch coverage gate is enforced by `vitest.config.ts`
 * `coverageThreshold` (contract C11 / OB-COV-1). The module is kept
 * deliberately tiny so 100% is achievable and load-bearing.
 */

/**
 * OWS API token: `ows_key_` followed by 64 lower-case hex characters.
 * Pre-existing Sprint 4.0.1 regex. Kept in this module as the canonical
 * source; `state.ts` re-exports for backward compat.
 */
export const OWS_TOKEN_REGEX = /ows_key_[a-f0-9]{64}/gi;

/**
 * Tier-1 patterns for `redactSensitive`. Each entry is independent —
 * the redactor walks the list and applies every match. Order is not
 * semantically significant; patterns are designed to be non-overlapping.
 *
 * Pattern definitions match plan-4.0.2.md §W4 verbatim:
 *
 *   - `ows_key`     — broader than `OWS_TOKEN_REGEX` so a partially-
 *                     formatted or non-hex token (e.g. base64url, future
 *                     SDK revision) still gets caught at the Sentry boundary.
 *   - `setup_code`  — SETUP-XXXX-XXXX invite codes (4 alnum + 4 alnum).
 *   - `private_key` — bare 0x-prefixed 64-hex strings. Will match any
 *                     32-byte hex blob; some addresses-of-hashes will
 *                     get redacted too, which is acceptable false-positive
 *                     behavior at the security boundary.
 *   - `passphrase`  — `OWS_PASSPHRASE=...` env-style strings. Captures the
 *                     value up to the next whitespace or comma.
 */
const TIER_1_PATTERNS: ReadonlyArray<{
  name: string;
  regex: RegExp;
  replacement: string;
}> = [
  {
    name: "ows_key",
    regex: /\bows_key_[a-zA-Z0-9_-]+/g,
    replacement: "[REDACTED_OWS_KEY]",
  },
  {
    name: "setup_code",
    regex: /\bSETUP-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g,
    replacement: "[REDACTED_SETUP_CODE]",
  },
  {
    name: "private_key",
    regex: /\b0x[a-fA-F0-9]{64}\b/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    name: "passphrase",
    regex: /\bOWS_PASSPHRASE\s*[=:]\s*[^,\s]+/gi,
    replacement: "OWS_PASSPHRASE=[REDACTED]",
  },
];

/**
 * Apply every Tier-1 pattern to a string. Returns the redacted form.
 *
 * Pure function — input is not mutated. If no pattern matches, the
 * input is returned unchanged (Tier-2 content passes through; this is
 * the documented privacy commitment, see contract C9).
 */
export function redactString(input: string): string {
  let out = input;
  for (const pattern of TIER_1_PATTERNS) {
    out = out.replace(pattern.regex, pattern.replacement);
  }
  return out;
}

/**
 * Recursively redact every string inside an arbitrary JSON-shaped value.
 *
 *   - strings  → `redactString` applied
 *   - arrays   → recurse, return new array
 *   - objects  → recurse, return new object (own enumerable keys only)
 *   - other    → returned as-is (numbers, booleans, null, undefined,
 *                Date, etc.)
 *
 * This is the entry point used by Sentry `beforeSend`. Sentry events are
 * arbitrary JSON-shaped payloads (message, extra, tags, breadcrumbs,
 * exception values, …) so the recursive walk is required.
 */
export function redactObject<T>(input: T): T {
  return walk(input) as T;
}

/**
 * Alias for `redactObject` — exported under the contract-specified name
 * so `beforeSend(event) { return redactSensitive(event); }` reads
 * cleanly. The split between `redactObject` and `redactSensitive` is
 * documentary: `redactObject` describes the mechanism, `redactSensitive`
 * describes the security boundary.
 */
export function redactSensitive<T>(input: T): T {
  return redactObject(input);
}

function walk(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(walk);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v);
    }
    return out;
  }
  return value;
}

/**
 * Sprint 4.0.1 W9 legacy redactor — replaces `ows_key_…` tokens with
 * the literal `ows_key_***`. Preserved verbatim from `src/engine/state.ts`
 * so the AM45 / AM47 audit-walk tests pass without modification (C15
 * regression bar). State manager re-imports this name; the regex lives
 * here so the single-source-of-truth invariant holds.
 *
 * Note: this is intentionally separate from `redactSensitive`. The
 * audit-log walk runs on every `addAuditEntry` call (hot path) and only
 * has to defend against `ows_key_…` leakage from caller-supplied
 * `details` objects. `redactSensitive` runs at the Sentry boundary and
 * has to defend against the full Tier-1 surface.
 */
export function redactTokens(input: unknown): unknown {
  if (typeof input === "string") {
    return input.replace(OWS_TOKEN_REGEX, "ows_key_***");
  }
  if (Array.isArray(input)) {
    return input.map(redactTokens);
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = redactTokens(v);
    }
    return out;
  }
  return input;
}
