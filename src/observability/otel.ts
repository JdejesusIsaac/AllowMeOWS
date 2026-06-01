/**
 * Sprint 4.0.2 W1 — OpenTelemetry SDK bootstrap (contract C1, C2, C12).
 *
 * Initializes the Node OTel SDK with the OTLP-HTTP trace exporter and
 * the standard auto-instrumentations (HTTP + Express), pointed at the
 * Axiom OTLP ingest endpoint (research §4.0.1 + §4.3 → direct export,
 * no collector at AllowMe scale).
 *
 * Designed to be the FIRST import in `app/server.ts` (and `src/index.ts`
 * if MCP-over-stdio is ever instrumented) so spans are captured from
 * the moment the process starts.
 *
 * Initialization is conditional on `AXIOM_INGEST_TOKEN` being set. When
 * the env var is absent, the SDK does not start — `sdkStarted` stays
 * `false` and downstream tests (OB5) can assert that no exporter
 * leaked into the process. This is also the local-dev path: developers
 * run without OTel by default.
 *
 * The module exports `sdkStarted` (boolean status flag) and `getTracer`
 * (the canonical accessor used by `src/middleware/tool-runner.ts`).
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { trace, type Tracer } from "@opentelemetry/api";

const SERVICE_NAME = "allowme-mcp";
const TRACER_NAME = "allowme-mcp-tools";

let _sdk: NodeSDK | null = null;
let _started = false;

export interface OtelStartOptions {
  /** Override the token source — used by tests. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Override the OTLP endpoint — defaults to Axiom traces. */
  endpoint?: string;
}

/**
 * Build the Axiom OTLP trace exporter from env. Returns null if the
 * required env var is absent (caller should skip SDK init).
 */
function buildExporter(env: NodeJS.ProcessEnv, endpoint?: string): OTLPTraceExporter | null {
  const token = env.AXIOM_INGEST_TOKEN;
  if (!token) return null;
  return new OTLPTraceExporter({
    url: endpoint ?? "https://api.axiom.co/v1/traces",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Axiom-Dataset": env.AXIOM_DATASET ?? "mcp-events",
    },
  });
}

/**
 * Start the OTel SDK if env is configured. Idempotent — safe to call
 * multiple times. Returns the started status so callers can branch.
 */
export function startOtel(opts: OtelStartOptions = {}): boolean {
  if (_started) return true;
  const env = opts.env ?? process.env;
  const exporter = buildExporter(env, opts.endpoint);
  if (!exporter) {
    // No env → no init. Matches OB5 (test: SDK not started when env absent).
    return false;
  }

  _sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: env.npm_package_version ?? "unknown",
      "deployment.environment": env.NODE_ENV ?? "development",
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // FS instrumentation is too noisy for this workload (every
        // file-read on every audit-log append) — research §3.4.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-express": { enabled: true },
      }),
    ],
  });

  _sdk.start();
  _started = true;
  return true;
}

/** Status flag exported for OB5. */
export function isStarted(): boolean {
  return _started;
}

/** Public canonical name lookup — used by tests + the runner. */
export const OTEL_SERVICE_NAME = SERVICE_NAME;
export const OTEL_TRACER_NAME = TRACER_NAME;

/**
 * Get the AllowMe MCP tools tracer. Returns a real tracer when the SDK
 * has started; otherwise returns the API's no-op tracer, which silently
 * swallows spans. This keeps `runTool` callable in any environment —
 * tests, local dev, and production — without conditional branching at
 * every call site.
 */
export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Cardinality-control surface — contract C12 / SC8.
 *
 * The four allowed metric labels for AllowMe instruments. `family_id`
 * is deliberately NOT in this set; it appears only as a trace/span
 * attribute and as an audit-log body field. Research §3.3 explains
 * why: at 5k families the metric-label cardinality budget for free-
 * tier aggregators (typically 10k unique time series) is exhausted by
 * a single `family_id`-labeled counter.
 *
 * Any new metric instrument MUST declare its labels from this list
 * (test OB7 enforces).
 */
export const ALLOWED_METRIC_LABELS: ReadonlyArray<string> = Object.freeze([
  "tool_name",
  "role",
  "success",
  "chain_id",
]);

/**
 * Test-only reset hook.
 */
export function _resetOtelForTests(): void {
  _started = false;
  _sdk = null;
}
