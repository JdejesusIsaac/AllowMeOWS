# Sprint 4.0.2 — Research: Observability foundation

> Pre-sprint analysis for the AllowMe observability layer. Establishes
> the problem, the operability gaps, the tool selection rationale, and
> the open questions resolved before plan-4.2.md commits to specific
> workstreams.

## 1. Problem statement

AllowMe today is operable by exactly one engineer — Juan — because every
diagnostic question requires hands-on access to the Railway container.
The four operability gaps that make this true:

### 1.1 No metrics

There are no counters, histograms, or gauges on MCP tool calls. Questions
like "how many `distribute-allowance` calls succeeded last week," "what's
the p95 latency on `verify-achievement`," or "are we trending toward
the Sprint 4.1 concurrency ceiling" cannot be answered without
hand-grepping logs.

### 1.2 No log aggregation

Two append-only logs exist on disk and stay there:

- AllowMe per-family audit log: `data/families/<id>/audit-log.json`
- OWS per-family audit log: `~/.ows/families/<id>/.ows/logs/audit.jsonl`
  (newly meaningful after Sprint 4.0.1 — actually captures policy
  evaluation events)

Both are rotated by the filesystem if they grow without bound. Neither
is queryable, neither is alertable, neither survives a Railway container
restart unless the volume is persisted (which it is, but the lookup
story is still ssh + jq).

### 1.3 No error reporting

Express errors are caught by the default error handler and surfaced as
HTTP 500. No stack trace exits the process to anywhere durable. If a
tool handler throws at 2 AM on a Saturday, Juan finds out when a user
opens a ticket Monday morning.

Sprint 4.0.1's W9 shipped the audit-walk `redactTokens` (in
`src/engine/state.ts`) and the CI grep gate; the Sentry `beforeSend`
stub (Sprint 4.0.1 DEL11) was **deferred and does not exist in the
codebase**. Sprint 4.0.2 W4 is therefore net-new Sentry SDK integration
\u2014 not stub promotion \u2014 and consolidates the existing `redactTokens`
into a new single-source-of-truth redactor at
`src/observability/redact.ts` shared by Sentry `beforeSend`, the audit-
log walk, and the audit-log forwarder shape check.

### 1.4 No deep health check

`/health` returns `{status: "ok", version: "0.3.0", transport: "http",
tools: 12, uptime: <seconds>}`. This proves the Node process is alive
and the route is mounted. It does NOT prove:

- The master key resolved.
- The OWS vault is readable.
- Recent transactions are succeeding.
- The Sprint 4.0.1 policy engine is engaging.
- Postgres (post-Sprint 4.4) is reachable.

Railway's healthcheck flips green on this endpoint regardless of whether
the system is actually functional.

## 2. Why this sprint comes second

Three downstream sprints depend on Sprint 4.0.2 having shipped:

- **Sprint 4.3 (off-chain ledger):** introduces a `LedgerEntry` schema
  and a new `settle-balance` tool. Cannot ship safely without metrics
  on settlement success rate, pending balance distribution, and ledger
  divergence detection.
- **Sprint 4.4 (Postgres migration):** dual-write phase requires real-
  time visibility into mismatches between JSON and Postgres reads. Both
  the alerting and the dashboard need an aggregator behind them.
- **Cross-cutting:** if any of the above introduces a regression, the
  rollback decision (program plan §9) needs sub-minute signal, not
  next-business-day signal.

The half-day-to-one-day estimate from the program plan stands.
Observability is intentionally a small sprint because the goal is
infrastructure, not features.

## 3. Architecture analysis

### 3.1 What instrumentation captures (post-Sprint 4.2)

The full event stream becomes:

```
MCP tool call
    ↓
[OTel span] tool.name, role, family_id, success/failure, duration_ms
    ↓
tool handler runs
    ↓
[on signing] WalletDistributor.transferUSDC
    ↓
[OTel span] tx.amount, tx.from, tx.to, tx.chainId
    ↓
[OWS audit log] policy_evaluated entry → Vector tail → Axiom
    ↓
[OWS audit log] broadcast_transaction entry → Vector tail → Axiom
    ↓
[AllowMe audit log] distribute/release/settle entry → Vector tail → Axiom
    ↓
[Sentry] only on error path (uncaught throw, 5xx response)
```

The two audit-log files are sources of truth on disk; the aggregator is
where they become queryable. Vector (or the aggregator's native agent)
tails both files and ships entries within 30 seconds.

### 3.2 Three independent observability surfaces

| Surface | Purpose | Tool | Volume |
|---|---|---|---|
| **Metrics** | "Is the system healthy? Where is it slow?" | OTel + Axiom (or OTel-compatible backend) | Per-call counter, per-call histogram, sampled traces |
| **Logs** | "What happened to this family/this transfer?" | Vector + Axiom | Two audit streams, both 100% ingested |
| **Errors** | "What broke and who needs to know?" | Sentry | Sparse — only error path |

The three are deliberately decoupled. A degraded aggregator does not
take down Sentry, and a Sentry outage does not affect metrics ingestion.

### 3.3 Cardinality budget

The cardinality concern at AllowMe's scale is `family_id` as a label.
At ~5k families, putting `family_id` on every metric label exceeds the
free-tier limits of most aggregators (typically ≤10k unique time
series).

Decision (see §5.2): `family_id` is a log/trace field, NOT a metric
label. Metrics are labeled by `tool_name`, `role`, `success`, `chain_id`.
For per-family breakdowns, query the log stream — that's what the
aggregator is for.

### 3.4 PII surface

Audit logs and traces contain:

- Wallet addresses (public; not PII)
- Child names (PII — the parent's choice)
- Family names (PII — same)
- Transaction amounts (sensitive but not strictly PII)
- Tool input args (variable — could contain child names in
  `verify-achievement` descriptions)

No SSNs, no real-world identity, no payment info. The aggregator gets
the kid's first name and how much they earned. That's the privacy floor
to design around — not zero data, but also not unrelated data.

## 4. Tool selection

### 4.0.1 Aggregator candidates

| Tool | Free tier | Per-month cost @ AllowMe scale | OTel support | Log ingestion |
|---|---|---|---|---|
| **Axiom** | 0.5 TB/mo | ~$25 at 5k families (est) | Native | Native (no schema needed) |
| **Better Stack** | 1 GB/mo | ~$30 at 5k families | Via OTel collector | Native |
| **Datadog** | 14-day trial | $15-25 per host + $0.10/GB ingestion | Native | Native |
| **Grafana Cloud** | 50 GB logs/mo | Free at AllowMe scale | Native | Loki |
| **Honeycomb** | 20 GB events/mo | ~$30 at 5k families | Native | Limited |

Two finalists: Axiom and Grafana Cloud (free).

Axiom wins on:

- Native event-shaped ingestion (audit log JSON maps cleanly without a
  schema; Grafana Loki forces a label-based model).
- Better defaults for low-volume teams.
- The team behind Axiom built it for exactly this kind of "events
  matter more than time-series" workload.

Grafana Cloud wins on:

- Strictly free at AllowMe scale (50 GB log floor is well above need).
- More tenured tooling ecosystem.

**Decision: Axiom**, with Grafana Cloud as the documented escape hatch
if Axiom pricing changes or the project outgrows the 0.5 TB free
allowance. Switching is straightforward: replace the Vector sink
endpoint and the OTel exporter URL. Same data, different destination.

### 4.0.2 Error reporter — Sentry

Sentry is uncontroversial at this scale. Free tier (5k events/month)
will cover AllowMe's error rate by an order of magnitude. The
beforeSend redaction was already stubbed in Sprint 4.0.1 W9.1.

### 4.3 OTel collector vs direct export

Two patterns:

**Pattern A — direct export:** Node OTel SDK exports directly to Axiom's
OTLP endpoint over HTTPS.

**Pattern B — collector sidecar:** Node OTel SDK exports to a local
OpenTelemetry Collector, which then ships to Axiom. Adds a process.

At AllowMe's scale, Pattern A is correct. The collector buys you
back-pressure handling, multi-destination fan-out, and protocol
translation — none of which AllowMe needs. **Decision: direct export.**

### 4.4 Log shipper — Vector

For tailing the two on-disk audit logs, Vector beats Axiom's native
agent on:

- Speed of config iteration (TOML, ~20 lines for both sources + sink).
- Local-only operation (no daemon if not desired; runs as a one-shot
  on file rotation).
- Same shipper works against any sink in §4.0.1 if migration ever
  happens.

**Decision: Vector**, running as a Railway sidecar process or as a
background tail inside the main Node process via a `child_process.spawn`.
Both options are evaluated in W2.

## 5. Open questions resolved

### 5.1 Q1: What's the volume budget?

**Status:** Estimated, verified post-deploy.

At ~500 families (pilot):
- Tool calls: ~10k/day (rough; check-progress dominates)
- Audit log entries (AllowMe + OWS combined): ~30k/day
- Sentry events: ~10/day expected (errors are rare)
- Estimated daily volume: ~5 MB

At 5k families:
- Linear scaling: ~50 MB/day
- Annual: ~18 GB
- Well within Axiom 0.5 TB free tier

The volume budget is not a constraint at any scale this program targets.

### 5.2 Q2: Do we label metrics with `family_id`?

**Status:** Resolved. No.

Cardinality explosion (§3.3). `family_id` lives in logs and traces; for
per-family questions, query the log stream. Metrics labels are limited
to `tool_name`, `role`, `success`, `chain_id`.

### 5.3 Q3: What's the PII redaction policy?

**Status:** Resolved. Two-tier.

- **Tier 1 (always redact):** `ows_key_…` tokens (from Sprint 4.0.1),
  `setup_codes` (SETUP-XXXX-XXXX), `master_key` raw bytes, any private
  key hex. Mandatory; CI-gated.
- **Tier 2 (keep, but documented):** child names, family names, wallet
  addresses, transaction amounts. The privacy commitment is in the
  Sprint 4.0.2 deliverable docs — "we collect these for operability;
  the parent's data control includes them."

The two tiers are distinct because Tier 1 is a security boundary and
Tier 2 is a transparency commitment. Mixing them creates a security-by-
obscurity false reassurance.

### 5.4 Q4: Does Sentry get the same redaction as OTel/audit?

**Status:** Resolved. Yes, plus Sentry-specific scrubbing.

The Sprint 4.0.1 W9.1 stub becomes the real `beforeSend` redactor. All
three surfaces use the same redaction function imported from
`src/observability/redact.ts`. The single source of truth makes audit
easy: one regex pattern, one allowlist, one test suite.

### 5.5 Q5: Where do alerting rules live?

**Status:** Deferred — out of scope for 4.2.

This sprint ships the data plane (instrumentation + forwarding +
errors + health). The alerting policy (paging, escalation, SLOs)
needs a week of observed data to set thresholds intelligently. Sprint
4.0.2 produces the dashboard; alerting rules are a follow-up.

## 6. Alternatives considered

### 6.1 Alt A: Self-hosted (Prometheus + Loki + Grafana)

Rejected. Operability for a one-engineer team gets worse, not better,
if the observability stack itself needs to be operated. Self-hosting is
correct at >100k families; not at 5k.

### 6.2 Alt B: Cloud-native (CloudWatch + Datadog)

Rejected. AllowMe runs on Railway, not AWS. CloudWatch is out of band.
Datadog is the "everything in one place" pitch but priced for
enterprises.

### 6.3 Alt C: Skip log forwarding, only ship metrics

Rejected. The OWS audit log is uniquely valuable post-Sprint 4.0.1 —
it's the only durable record that policy evaluation actually fired.
Losing it to the local container is the exact problem this sprint
solves.

### 6.4 Alt D: Skip Sentry, just log errors to Axiom

Considered. Sentry's value over "just log errors" is:

- Stack trace formatting + source map resolution.
- Deduplication (one error type, N events, one alert).
- The redaction layer (which we'd need to build anyway).
- Mobile + dev tooling: Sentry's UI is the right error-investigation
  interface.

At Sentry's free tier (5k events/mo), the cost is zero. Keep Sentry.

## 7. Threat model

### 7.1 What gets better

- **Token leak detection:** Sprint 4.0.1 W9 plus Sprint 4.2's CI-gated
  redaction makes a token leak a build-failure event, not a silent
  discovery.
- **Anomaly detection:** unusual signing patterns (e.g., a sudden
  spike in `transferUSDC` calls from one family) become visible
  in Axiom dashboards.
- **Compromised-family detection:** the audit log forwarding means
  even a deleted local file leaves an immutable record in the
  aggregator.

### 7.2 What doesn't change

- **Aggregator compromise:** if an attacker gets Axiom credentials,
  they get read access to historical events. Mitigation: API key
  rotation policy in `data/.axiom-key`, mode 0o600, rotated quarterly.
- **OTel SDK trust:** the OTel SDK has a long supply chain; if any
  dependency is compromised, instrumentation could be tampered with.
  Mitigation: pin versions; review updates.

### 7.3 New threat: aggregator log exfiltration

The aggregator becomes a third-party holding family-level data. The
Sprint 4.0.2 deliverable docs need a privacy section explaining what
goes there and why. The parent's existing data-control story includes
Axiom-stored events.

## 8. References

- [OpenTelemetry Node SDK](https://opentelemetry.io/docs/instrumentation/js/)
- [Axiom OTel ingestion](https://axiom.co/docs/send-data/opentelemetry)
- [Sentry Node integration](https://docs.sentry.io/platforms/javascript/guides/node/)
- [Vector file source](https://vector.dev/docs/reference/configuration/sources/file/)
- [Sprint 4.0.1 W9.1 — Sentry beforeSend redaction stub](../sprint-4.0.1/plan-4.0.1.md)
- [Sprint 4.4 (upcoming) — dual-write phase requires alerts](../program-overview.md)

## 9. Status

- Research: complete.
- Plan: see plan-4.2.md.
- Tests: see test-4.2.md.
- Code: not started.
- Open questions: all resolved (§5).
- Approval to proceed: pending Generator/Evaluator pass on plan-4.2.md.