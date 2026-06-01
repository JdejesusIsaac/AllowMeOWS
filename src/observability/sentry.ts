/**
 * Sprint 4.0.2 W4 — Sentry SDK initialization with fail-closed
 * `beforeSend` redaction.
 *
 * Framing correction (contract §7.5): Sprint 4.0.1 DEL11 (Sentry
 * `beforeSend` stub) was deferred and does NOT exist in the codebase.
 * This module is net-new integration, not stub promotion. The
 * `redactSensitive` function it wires to is imported from
 * `src/observability/redact.ts` — the single source of truth used by
 * Sentry, the audit-walk, and any other surface that leaves the
 * process boundary.
 *
 * Initialization is conditional on `SENTRY_DSN` being present in the
 * environment. Local dev runs without the env var and the module is a
 * no-op; production deploys with the env var set get the full event
 * capture pipeline.
 *
 * The `beforeSend` callback is fail-closed (contract C10 / plan D3):
 * if `redactSensitive` throws synchronously, the event is dropped. A
 * missing error report is recoverable (OTel spans still flow); a
 * leaked token in Sentry's UI is not.
 */

import { redactSensitive } from "./redact.js";

/**
 * Sentry `beforeSend` callback contract — accepts a Sentry event,
 * returns the event to send or `null` to drop.
 *
 * Types are defined locally (rather than imported from `@sentry/node`)
 * so this module type-checks in environments where the dep isn't
 * installed (e.g. CI without npm install, or local dev where Sentry is
 * intentionally omitted). At runtime, `initSentry()` dynamic-imports
 * the real SDK; if the dep is present, the structural shapes match.
 */
export type SentryEventLike = Record<string, unknown>;
export type SentryHintLike = Record<string, unknown>;

/** Subset of Sentry.NodeOptions we actually configure. */
export interface SentryConfig {
  dsn: string;
  environment: string;
  release: string | undefined;
  tracesSampleRate: number;
  beforeSend: (event: SentryEventLike, hint: SentryHintLike) => SentryEventLike | null;
}

/**
 * The `beforeSend` callback wired into `Sentry.init`. Exported so unit
 * tests can call it directly without bootstrapping the full Sentry
 * pipeline (contract C7 isolation test surface).
 *
 * Behavior:
 *   1. Try `redactSensitive(event)` — returns a new event with every
 *      string field walked.
 *   2. On success, return the redacted event.
 *   3. On synchronous throw, log to stderr and return null (drop the
 *      event). Production traffic continues; the breadcrumb is sacrificed
 *      to prevent a possible token leak.
 *
 * Crucially, the redacted event is what Sentry transmits — the
 * pre-redaction form never leaves the process.
 */
export function beforeSend(
  event: SentryEventLike,
  _hint: SentryHintLike,
): SentryEventLike | null {
  try {
    return redactSensitive(event) as SentryEventLike;
  } catch (err) {
    // Fail closed (contract C10). console.error is the only side-effect
    // — visible in container logs so the operator notices.
    console.error("[sentry] beforeSend redaction failed; dropping event", err);
    return null;
  }
}

/**
 * Returns the Sentry init configuration without actually calling
 * `Sentry.init`. Exposed so unit tests can verify the config shape
 * (especially the `beforeSend` wiring) without monkeypatching the
 * Sentry module's global state.
 *
 * Production code calls `initSentry()` (below) which delegates here
 * and then invokes `Sentry.init`.
 */
export function buildSentryConfig(env: NodeJS.ProcessEnv = process.env): SentryConfig | null {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return null;

  return {
    dsn,
    environment: env.NODE_ENV ?? "development",
    release: env.npm_package_version,
    // Metrics + traces flow via OpenTelemetry → Axiom (plan D2 + research
    // §3.2). Sentry is errors-only. Sampling 0 keeps the free-tier
    // event budget reserved for real exceptions.
    tracesSampleRate: 0,
    beforeSend,
  };
}

/**
 * Initialize Sentry if `SENTRY_DSN` is set. Idempotent — re-calling is
 * a no-op once the SDK has initialized. Designed to be the first
 * import in `app/server.ts` after `resolveMasterKey`, so the error
 * boundary is established before any tool handler can throw.
 *
 * Returns the Sentry namespace (for callers that want to add tags /
 * context) or `null` if init was skipped.
 */
interface SentryRuntime {
  // `init` accepts the real SDK's `NodeOptions`, which is a superset of
  // our `SentryConfig`. Typed as `unknown` here so the dynamic-import
  // bridge doesn't lock the local type to a specific Sentry version.
  init: (config: unknown) => void;
  captureException?: (err: unknown) => string;
}

let _initialized = false;
let _sentryRef: SentryRuntime | null = null;

export async function initSentry(): Promise<SentryRuntime | null> {
  if (_initialized) return _sentryRef;
  const config = buildSentryConfig();
  if (!config) {
    _initialized = true;
    return null;
  }
  try {
    // Dynamic import keeps `@sentry/node` an optional dep at module-
    // load time. Production has it installed; local dev / CI runs that
    // omit it fall through to the catch. The `unknown` cast bridges our
    // structural `SentryConfig` to the real `NodeOptions` surface.
    const mod = (await import("@sentry/node").catch(() => ({}))) as unknown as
      | (SentryRuntime & { default?: SentryRuntime })
      | Record<string, never>;
    const Sentry: SentryRuntime = (mod.default ?? (mod as SentryRuntime));
    if (typeof Sentry.init !== "function") {
      throw new Error("@sentry/node export shape unexpected (no init)");
    }
    Sentry.init(config as unknown);
    _sentryRef = Sentry;
    _initialized = true;
    return Sentry;
  } catch (err) {
    // Import failure (dep not installed in local dev) is non-fatal.
    // Production has the dep; local dev gets a one-line warning.
    console.error("[sentry] @sentry/node not available — skipping init", err);
    _initialized = true;
    return null;
  }
}

/**
 * Test-only reset hook. Allows tests to clear the module's
 * initialization latch between cases.
 */
export function _resetSentryForTests(): void {
  _initialized = false;
  _sentryRef = null;
}
