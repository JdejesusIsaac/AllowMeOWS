# Sprint 4.0.2 — Plan: Observability foundation

> Workstream-by-workstream execution plan for the Sprint 4.0.2 deliverables.
> Reads research-4.0.2.md as the prerequisite. Sequences W0-W6 such that
> the sprint is exit-ready within one working day if W0 is preceded by
> account provisioning.

## 1. Goals

- Every MCP tool call emits a span with `tool_name`, `role`, `family_id`
  (trace attribute, not metric label), `success`, and `duration_ms`.
- Both audit log streams (AllowMe + OWS) are forwarded to Axiom within
  30 seconds of write.
- Sentry captures every uncaught exception and 5xx response with
  Tier-1 redaction enforced by `beforeSend`.
- `/health` returns deep health (master key + OWS vault + recent tx
  outcome + policy engine engagement signal).
- Basic dashboard exists in Axiom showing tool calls, latencies, errors,
  and per-family activity over 24h / 7d windows.

## 2. Non-goals

- Alerting rules (deferred per research §5.5; needs a week of observed
  data to set thresholds).
- SLO definition (same — deferred).
- Self-hosted backend (rejected per research §6.1).
- Per-family rate limiting (separate concern, not observability).
- Migration of historical audit logs into Axiom (we ship the data
  plane; backfilling is its own decision and probably should never
  happen — historical logs stay on disk).

## 3. Workstreams

### W0 — Pre-sprint provisioning (30 min, before sprint kickoff)

Three accounts:

1. **Axiom** — create org `allowme`, dataset `mcp-events`, generate
   ingest token. Stored in Railway env `AXIOM_INGEST_TOKEN`. Dataset
   retention: 30 days (free tier default).
2. **Sentry** — create org `allowme`, project `allowme-mcp` (Node
   platform). DSN stored in Railway env `SENTRY_DSN`. Environment
   tag: `production` / `staging` from `NODE_ENV`.
3. **Vector** — no account needed; binary downloads from vector.dev.
   Decision in W2 between sidecar process vs in-process tail.

**Exit criteria:** all three env vars set in Railway. Test ingest
request against Axiom OTLP endpoint returns 200. Sentry DSN validates
via `npx @sentry/wizard` or curl.

### W1 — OTel auto-instrumentation on Express (2 hours)

Add `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node`
+ `@opentelemetry/exporter-trace-otlp-http` as dependencies.

Bootstrap file: `src/observability/otel.ts`.

```typescript
// src/observability/otel.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "allowme-mcp",
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? "development",
  }),
  traceExporter: new OTLPTraceExporter({
    url: "https://api.axiom.co/v1/traces",
    headers: {
      Authorization: `Bearer ${process.env.AXIOM_INGEST_TOKEN}`,
      "X-Axiom-Dataset": "mcp-events",
    },
  }),
  instrumentations: [getNodeAutoInstrumentations({
    "@opentelemetry/instrumentation-fs": { enabled: false }, // too noisy
    "@opentelemetry/instrumentation-http": { enabled: true },
    "@opentelemetry/instrumentation-express": { enabled: true },
  })],
});

if (process.env.AXIOM_INGEST_TOKEN) {
  sdk.start();
}
```

Imported as the first line of `app/server.ts` (must be before any other
import that creates spans).

**Manual span wrapping** for MCP tool calls in `src/middleware/tool-runner.ts`
(or wherever the tool dispatch happens):

```typescript
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("allowme-mcp-tools");

export async function runTool(name: string, role: Role, familyId: string, fn: () => Promise<unknown>) {
  return tracer.startActiveSpan(`tool.${name}`, async (span) => {
    span.setAttribute("tool.name", name);
    span.setAttribute("tool.role", role);
    span.setAttribute("tool.family_id", familyId); // trace attribute only
    try {
      const result = await fn();
      span.setAttribute("tool.success", true);
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (err) {
      span.setAttribute("tool.success", false);
      span.setStatus({ code: 2, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
```

**Exit criteria:** local test of `check-progress` shows a span in Axiom
within 60 seconds. Span attributes include `tool.name`, `tool.role`,
`tool.family_id`. No `tool.family_id` appears as a metric label
(spot-check by querying metrics dimensions).

### W2 — AllowMe audit log forwarder (90 min)

The AllowMe audit log lives at `data/families/<id>/audit-log.json` as
an append-only JSON array. Vector cannot tail "JSON array" — it tails
JSONL. Two options:

**Option 2A:** Change the audit log format from JSON array to JSONL.
Breaking change to existing on-disk logs but the cleaner fix.

**Option 2B:** Write a Node-side tail process that reads new entries
from JSON arrays and re-emits as JSONL to a side-channel file at
`data/families/<id>/audit-stream.jsonl`. No format change but adds a
process.

**Decision: Option 2A.** Change the audit-log writer in
`src/audit/log.ts` to append JSONL. Migrate existing files via a
one-shot script at boot (`scripts/migrate-audit-logs.ts` — converts
JSON-array files to JSONL). Old format is preserved as `.bak` for one
release cycle.

Vector config:

```toml
# vector.toml — runs as sidecar
[sources.allowme_audit]
type = "file"
include = ["/app/data/families/*/audit-log.jsonl"]
read_from = "end"
ignore_older_secs = 86400

[transforms.parse_audit]
type = "remap"
inputs = ["allowme_audit"]
source = '''
. = parse_json!(.message)
.source = "allowme"
.family_id = parse_regex!(.file, r'families/(?P<id>[^/]+)/').id
'''

[sinks.axiom_audit]
type = "http"
inputs = ["parse_audit"]
uri = "https://api.axiom.co/v1/datasets/audit-logs/ingest"
encoding.codec = "json"
auth.strategy = "bearer"
auth.token = "${AXIOM_INGEST_TOKEN}"
```

**Exit criteria:** write a test audit entry; query Axiom audit-logs
dataset; entry appears within 30s with `source: "allowme"` and the
correct `family_id`.

### W3 — OWS audit log forwarder (45 min)

OWS audit log is already JSONL at
`~/.ows/families/<id>/.ows/logs/audit.jsonl`. Same Vector pattern as
W2, different source path:

```toml
[sources.ows_audit]
type = "file"
include = ["/root/.ows/families/*/.ows/logs/audit.jsonl"]
read_from = "end"
ignore_older_secs = 86400

[transforms.parse_ows_audit]
type = "remap"
inputs = ["ows_audit"]
source = '''
. = parse_json!(.message)
.source = "ows"
.family_id = parse_regex!(.file, r'families/(?P<id>[^/]+)/').id
'''

# Same sink as W2
```

The OWS audit log is uniquely valuable: Sprint 4.0.1 makes it the first
durable record of policy engagement. Every `policy_evaluated` entry
includes the policy version (Sprint 3.0.6), the decision, and the
reason. This is the ground truth for "did the policy actually fire."

**Exit criteria:** trigger a transfer via `distribute-allowance`; both
the AllowMe `distribute_allowance` entry AND the OWS `policy_evaluated`
+ `broadcast_transaction` entries appear in Axiom audit-logs dataset
within 30s.

### W4 — Sentry SDK + beforeSend redaction (90 min)

**Framing correction:** Sprint 4.0.1's W9 shipped the audit-walk
`redactTokens` (in `src/engine/state.ts`) and the CI grep gate, but the
Sentry `beforeSend` stub (Sprint 4.0.1 DEL11) was deferred and does NOT
exist in the codebase. W4 is net-new Sentry SDK integration that
consolidates the existing `redactTokens` into the new single-source-of-
truth redactor. Do not waste time looking for a stub.

Three pieces:

1. **Install:** `@sentry/node` + `@sentry/profiling-node` (optional).
2. **Init at boot,** before any other code, in `src/observability/sentry.ts`:

```typescript
import * as Sentry from "@sentry/node";
import { redactSensitive } from "./redact";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.npm_package_version,
    tracesSampleRate: 0, // metrics go via OTel, not Sentry
    beforeSend(event) {
      try {
        return redactSensitive(event);
      } catch (err) {
        // Fail closed: if redaction throws, drop the event.
        // A missing error report is better than a leaked token.
        console.error("[sentry] beforeSend redaction failed; dropping event", err);
        return null;
      }
    },
  });
}
```

3. **Redactor at `src/observability/redact.ts`** (shared with W2/W3
   sinks — single source of truth):

```typescript
const PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  { name: "ows_key", regex: /\bows_key_[a-zA-Z0-9_-]+/g, replacement: "[REDACTED_OWS_KEY]" },
  { name: "setup_code", regex: /\bSETUP-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, replacement: "[REDACTED_SETUP_CODE]" },
  { name: "private_key", regex: /\b0x[a-fA-F0-9]{64}\b/g, replacement: "[REDACTED_PRIVATE_KEY]" },
  { name: "passphrase", regex: /\bOWS_PASSPHRASE[^,\s]*[=:][^,\s]+/gi, replacement: "OWS_PASSPHRASE=[REDACTED]" },
];

export function redactString(s: string): string {
  let out = s;
  for (const p of PATTERNS) {
    out = out.replace(p.regex, p.replacement);
  }
  return out;
}

export function redactObject<T>(o: T): T {
  return JSON.parse(redactString(JSON.stringify(o)));
}

export function redactSensitive(event: unknown): unknown {
  return redactObject(event);
}
```

CI gate: a snapshot test verifies that an event containing each pattern
is correctly redacted. Snapshot lives at
`tests/observability/redact.snap.ts`.

**Exit criteria:** throw a deliberate error containing an `ows_key_…`
token; Sentry receives the event; the dashboard shows the redacted
form. CI snapshot test passes.

### W5 — `/health` enrichment (60 min)

Current `/health` (in `app/server.ts`):

```typescript
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "0.3.0",
    transport: "http",
    tools: TOOL_REGISTRY.length,
    uptime: Math.floor(process.uptime()),
  });
});
```

New `/health`:

```typescript
app.get("/health", async (_req, res) => {
  const checks: Record<string, { status: "ok" | "fail"; detail?: string; latencyMs?: number }> = {};

  // 1. Master key resolution
  checks.masterKey = await timed(() => MasterKey.resolve().then(() => ({ status: "ok" as const })));

  // 2. OWS vault readable (smoke read of root vault dir)
  checks.owsVault = await timed(async () => {
    const fs = await import("fs/promises");
    await fs.access(os.homedir() + "/.ows", fs.constants.R_OK);
    return { status: "ok" as const };
  });

  // 3. Recent tx outcome (post-Sprint 4.0.1, read last 10 from audit)
  checks.recentTx = await readRecentTxOutcome(); // returns {ok: N, fail: M, status}

  // 4. Policy engagement signal (post-Sprint 4.0.1)
  checks.policyEngagement = await readPolicyEvaluationCount({ windowMinutes: 60 });

  // 5. Postgres reachable (post-Sprint 4.4 — stub for now)
  // checks.postgres = await pingPostgres();

  const overall = Object.values(checks).every(c => c.status === "ok") ? "ok" : "degraded";

  res.status(overall === "ok" ? 200 : 503).json({
    status: overall,
    version: process.env.npm_package_version,
    transport: "http",
    tools: TOOL_REGISTRY.length,
    uptime: Math.floor(process.uptime()),
    checks,
  });
});

async function timed<T extends { status: "ok" | "fail" }>(fn: () => Promise<T>): Promise<T & { latencyMs: number }> {
  const start = Date.now();
  try {
    const result = await fn();
    return { ...result, latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "fail", detail: (err as Error).message, latencyMs: Date.now() - start } as T & { latencyMs: number };
  }
}
```

The endpoint now returns 503 if any deep check fails. Railway's
healthcheck will flip red if the master key disappears or the OWS vault
becomes unreadable — exactly the failures that today go undetected.

**Exit criteria:** simulate master key absence (rename the key file
temporarily); `/health` returns 503 with `checks.masterKey.status =
"fail"`.

### W6 — Basic dashboards in Axiom (60 min)

Three saved queries, two dashboards:

**Queries:**

1. `tool_calls_24h` — count of tool calls grouped by `tool.name`,
   over 24h, stacked area.
2. `tool_p95_24h` — p95 of `tool.duration_ms` grouped by `tool.name`,
   over 24h, line.
3. `error_rate_24h` — `tool.success = false` count over total, by
   `tool.name`.

**Dashboards:**

- `overview` — three panels (tool_calls_24h, tool_p95_24h,
  error_rate_24h), refresh every 60s.
- `policy_engagement` — query the audit-logs dataset for
  `event = "policy_evaluated"` over 24h, broken down by `decision`
  (allow/deny). This is the Sprint 4.0.1 success-criterion-as-dashboard.

Dashboards are saved as JSON in the repo at
`observability/dashboards/*.json` so they're version-controlled.

**Exit criteria:** all three queries return data after one hour of
production traffic; dashboards render; policy engagement panel shows
`decision: "allow"` count > 0.

## 4. Decisions

### D1: Aggregator → Axiom

**Decision:** Axiom (research §4.0.1).
**Rationale:** event-shaped ingestion, free tier covers AllowMe at 5k
families, OTel-native.
**Rejected alternatives:** Better Stack (limited free tier), Datadog
(priced for enterprise), Grafana Cloud (forced label-based log model),
Honeycomb (limited log ingestion).
**Escape hatch:** Vector sink + OTel exporter URL are both single-line
config changes if Axiom needs to be replaced.

### D2: Sampling rate

**Decision:** 100% of all spans, all audit log entries.
**Rationale:** AllowMe volume is well below aggregator limits (research
§5.1). Sampling buys back-pressure protection we don't need and loses
diagnostic fidelity we do need.
**Re-evaluate at:** 50k families or first month >25 GB ingestion.

### D3: Sentry beforeSend → mandatory redaction, fail-closed

**Decision:** if `beforeSend` redaction throws, drop the event.
**Rationale:** a missing error report is recoverable (we have OTel
spans). A leaked token in Sentry's UI is not.
**Trade-off accepted:** some debugging events will be silently lost
if the redactor has a bug. Mitigation: snapshot tests + CI gate.

### D4: Log shipper → Vector sidecar

**Decision:** Vector runs as a Railway sidecar process.
**Rationale:** clean process boundary; restarting Vector doesn't
restart the MCP server. Same Vector binary across W2 (AllowMe audit)
and W3 (OWS audit).
**Rejected:** in-process file tail (couples lifecycle of two
unrelated concerns); Axiom native agent (less portable to escape
hatch).

### D5: PII handling → two-tier

**Decision:** Tier 1 always-redact (tokens, codes, keys); Tier 2
documented-not-redacted (child names, family names, wallet addresses,
tx amounts). See research §5.3.
**Rationale:** mixing tiers creates false security; separating them
makes audit clean.
**Documented in:** `docs/PRIVACY.md` (deliverable of this sprint).

### D6: Retention

**Decision:** Axiom default (30 days metrics, 30 days audit logs).
**Rationale:** alerting decisions need at least a week; 30 days lets
us look at month-over-month trends. Sentry retention: 90 days
(default).
**Re-evaluate at:** first compliance review or first request for
quarterly trend analysis.

### D7: Audit log format change

**Decision:** AllowMe audit log moves from JSON array to JSONL.
**Rationale:** Vector tails JSONL natively; appending to a JSON
array requires re-reading the array each time, which is the
bottleneck Sprint 4.4 will fix at the database layer.
**Migration:** one-shot script at boot. Old files backed up to
`.bak` for one release.

### D8: Alerting deferred

**Decision:** Sprint 4.0.2 ships data plane only.
**Rationale:** alerting thresholds need observed-baseline data
(research §5.5). Sprint 4.0.2 produces the dashboard; alerting rules
are a follow-up.
**Tracking:** open issue in `docs/ROADMAP.md` titled "Alerting policy
post-4.0.2."

## 5. Success criteria

- **SC1:** every MCP tool call produces an OTel span in Axiom within
  60s of execution.
- **SC2:** AllowMe audit log entries appear in Axiom within 30s of
  write.
- **SC3:** OWS audit log entries appear in Axiom within 30s of
  write, with `policy_evaluated` events visible per family.
- **SC4:** any uncaught exception or 5xx response triggers a Sentry
  event with Tier-1 redaction applied.
- **SC5:** CI snapshot test verifies no Tier-1 pattern survives
  `redactSensitive`.
- **SC6:** `/health` returns 503 if any of the four deep checks
  (master key, OWS vault, recent tx, policy engagement) fail.
- **SC7:** Axiom dashboards `overview` and `policy_engagement`
  render data after one hour of production traffic.
- **SC8:** `family_id` does NOT appear as a metric-cardinality
  dimension (only as a trace/log attribute).

## 6. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R1 | OTel SDK supply-chain compromise | Low | High | Version pin; monthly review |
| R2 | Vector sidecar consumes more memory than Railway plan allows | Medium | Low | Vector with `data_dir` on tmpfs limits buffer; Railway plan has 2GB headroom |
| R3 | Axiom outage during W6 dashboard verification | Low | Low | Manual span emission via curl proves ingestion; dashboards can wait |
| R4 | Audit log format migration breaks consumer | Low | Medium | One-shot migration runs at boot; `.bak` files preserve old format |
| R5 | Sentry beforeSend redactor has bugs that drop legitimate events | Medium | Low | Snapshot tests; first week post-deploy includes manual log review |
| R6 | `/health` deep checks add user-visible latency | Low | Low | Checks parallelized with `Promise.all`; total p95 budget 200ms |
| R7 | Cardinality explodes if a code path accidentally puts `family_id` on a metric | Medium | Medium | Lint rule + code review checklist + explicit test |
| R8 | Forwarded child names trigger a privacy concern post-launch | Low | High | `docs/PRIVACY.md` ships with sprint; parent data control docs updated |

## 7. Sequencing

The sprint is structured as 3 mergeable PRs:

- **PR1 (W0 + W1 + W2 + W3):** instrumentation + log forwarding. Self-
  contained. Tests: OB1-OB20.
- **PR2 (W4 + W5):** Sentry + deep health. Tests: OB21-OB35.
- **PR3 (W6):** dashboards. JSON files in repo. No code changes.

PR1 must merge first because PR2 and PR3 both reference its config.
PR2 and PR3 are independent and can land in either order.

## 8. Timeline

One working day, broken into morning + afternoon:

| Time | Workstream | Deliverable |
|------|-----------|------------|
| 09:00-09:30 | W0 | Three accounts provisioned, env vars set |
| 09:30-11:30 | W1 | OTel instrumentation merged, first span in Axiom |
| 11:30-13:00 | W2 | AllowMe audit log forwarding live |
| 14:00-14:45 | W3 | OWS audit log forwarding live |
| 14:45-16:15 | W4 | Sentry + redaction merged |
| 16:15-17:15 | W5 | Deep health check merged |
| 17:15-18:15 | W6 | Dashboards saved to repo |

Total: ~9 working hours. The 4-hour W4 budget is the load-bearing
estimate; if redaction snapshot tests reveal edge cases, this overruns
by half a day and W6 moves to day 2.

## 9. Rollback strategy

Each PR can be reverted independently:

- PR1 revert: removes OTel SDK init and Vector config. No data loss
  (audit logs continue writing locally). MCP server continues to run.
- PR2 revert: disables Sentry init and reverts `/health`. Sprint 4.0.1
  W9.1 stub is restored.
- PR3 revert: dashboards become unavailable but ingestion continues.

The lowest-risk component is the data plane (PR1). The highest-risk is
the redactor (PR2 W4) — if it has a bug, it drops Sentry events
silently. Mitigation: the first week post-deploy, review the Sentry
dashboard daily to confirm the event-count baseline is plausible.

## 10. Acceptance

Sprint 4.0.2 is complete when:

- All 8 success criteria pass (verified by test-4.0.2.md execution).
- All 3 PRs merged to main.
- `observability/dashboards/*.json` exists in repo.
- `docs/PRIVACY.md` exists and documents Tier-1 vs Tier-2 redaction.
- One full business day of production traffic has flowed through the
  dashboards without manual intervention.