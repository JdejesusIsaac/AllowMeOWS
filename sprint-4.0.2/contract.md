# Sprint 4.0.2 — Sprint Contract (Phase 1.5)

**Status:** Derived from existing `plan.md` + `research.md` + `test.md`. Pending user confirmation.
**Inputs:** [`research.md`](./research.md) (all open questions §5 resolved, no ⚠️ spike candidates remain), [`plan.md`](./plan.md) v1.0, [`test.md`](./test.md) v1.0.
**Sprint type:** Observability foundation — instrument the existing surface, forward existing logs, capture errors, deepen `/health`. No business-logic changes.
**Sprint class:** **Infrastructure with security-critical sub-component.** Most of the sprint is wiring (OTel SDK init, Vector config, dashboard JSON), but the `beforeSend` / audit-walk PII redactor is genuinely the security boundary of 4.2 — Tier-1 patterns (`ows_key_…`, `SETUP-…` codes, private-key hex, `OWS_PASSPHRASE=…`) flowing to a third-party aggregator is a security incident, not an operability bug. Rubric reflects this with Auth/Security at 30% (the floor for any sprint touching a credential redaction boundary) and a load-bearing 100%-coverage gate on `src/observability/redact.ts`.

---

## 1. Phase 0a — Problem framing (recorded inline)

**Problem statement.** AllowMe is operable by exactly one engineer (Juan) because every diagnostic question requires hands-on access to the Railway container. There are no metrics on MCP tool calls, no aggregation of the two on-disk audit logs (AllowMe per-family + OWS per-family), no error reporting, and `/health` proves only that the Node process is alive — it does not prove the master key resolved, the OWS vault is readable, recent transactions are succeeding, or the Sprint 4.0.1 policy engine is engaging.

**"What is" statement.** Today: `data/families/<id>/audit-log.json` and `~/.ows/families/<id>/.ows/logs/audit.jsonl` accumulate locally and stay there. Express errors are caught by the default handler and surfaced as HTTP 500 with no durable trace. `/health` returns `{status: "ok", version, transport, tools, uptime}` regardless of whether the master key resolved or the OWS vault is readable. Sprint 4.0.1's W9 shipped the audit-walk `redactTokens` in [`src/engine/state.ts`](../src/engine/state.ts) and a CI grep gate; the Sentry `beforeSend` stub (Sprint 4.0.1 DEL11) was deferred and **does not exist in the codebase**. Sprint 4.0.2 W4 is therefore net-new Sentry SDK integration, not stub promotion — and consolidates the existing `redactTokens` into the new single-source-of-truth redactor.

**Solution hypothesis.** Three independent observability surfaces, decoupled by design (research §3.2):
1. **Metrics + traces** via `@opentelemetry/sdk-node` exporting directly to Axiom OTLP (no collector — research §4.3).
2. **Logs** via Vector sidecar tailing both audit streams to the Axiom `audit-logs` dataset within 30s.
3. **Errors** via `@sentry/node` with `beforeSend` redaction wired to a single source of truth at `src/observability/redact.ts`, shared with the audit-log walk.

Plus: deepen `/health` to four real checks (master key, OWS vault, recent tx, policy engagement) returning 503 on degradation.

**Scope boundary.** Six observable outcomes, full stop:
1. Every MCP tool call emits an OTel span in Axiom within 60s (SC1).
2. AllowMe audit entries appear in Axiom within 30s of write (SC2).
3. OWS audit entries — including `policy_evaluated` — appear in Axiom within 30s of write (SC3).
4. Every uncaught exception / 5xx triggers a Sentry event with Tier-1 redaction applied (SC4 + SC5).
5. `/health` returns 503 if any of the four deep checks fail (SC6).
6. Two Axiom dashboards (`overview`, `policy_engagement`) render data after 1h of traffic (SC7).

Plus: `family_id` is NEVER a metric label (cardinality discipline, SC8).

Anything outside these seven outcomes is deferred (see plan §2 Non-goals).

---

## 2. Scope

**In scope.** Seven workstream clusters, locked:

1. **Pre-sprint provisioning (W0).** Axiom org + dataset + ingest token; Sentry org + project + DSN; Vector binary. Three Railway env vars set: `AXIOM_INGEST_TOKEN`, `SENTRY_DSN`, `NODE_ENV`.
2. **OTel auto-instrumentation (W1).** `src/observability/otel.ts` bootstraps `NodeSDK` with `@opentelemetry/auto-instrumentations-node` (HTTP + Express enabled, FS disabled). Manual span wrap in `src/middleware/tool-runner.ts` (`runTool`) for every MCP tool call: `tool.name`, `tool.role`, `tool.family_id` as **trace attributes only**. Imported as the first line of [`app/server.ts`](../app/server.ts).
3. **AllowMe audit log forwarding (W2).** Audit log moves from JSON-array to JSONL (D7). One-shot migration at boot writes `.bak` of legacy files. Vector sidecar tails `data/families/*/audit-log.jsonl` and ships to Axiom `audit-logs` dataset with `source: "allowme"` and `family_id` parsed from path.
4. **OWS audit log forwarding (W3).** Vector sidecar tails `~/.ows/families/*/.ows/logs/audit.jsonl` (already JSONL post-Sprint 4.0.1) and ships to the same Axiom dataset with `source: "ows"`.
5. **Sentry SDK + redaction (W4).** `src/observability/sentry.ts` initializes `@sentry/node` with `beforeSend` calling `src/observability/redact.ts`. **Fail-closed:** if redaction throws, drop the event (D3). The redactor is a single source of truth — same module imported by the AllowMe audit-log walk, the OWS audit-log forwarder shape check, and Sentry. Tier-1 patterns (mandatory): `ows_key_…` tokens, `SETUP-XXXX-XXXX` codes, raw private-key hex, `OWS_PASSPHRASE=…` env strings.
6. **Deep `/health` (W5).** Four checks parallelized via `Promise.all`: master key resolution, OWS vault readability, recent-tx outcome (last 10 from audit), policy engagement count (last 60 min). Returns 503 if any fails. Per-check `latencyMs` reported.
7. **Dashboards (W6).** Two Axiom dashboards (`overview`, `policy_engagement`), three saved queries (`tool_calls_24h`, `tool_p95_24h`, `error_rate_24h`). All saved as JSON in `observability/dashboards/*.json` and `observability/queries/*.json` so they're version-controlled.

**Out of scope (deliberate, with reason):**
- **Alerting rules / paging policy** — research §5.5 + plan D8: needs a week of observed-baseline data; ships in a follow-up.
- **SLO definition** — same reasoning as alerting.
- **Self-hosted backend (Prometheus + Loki + Grafana)** — research §6.1: rejected; operability gets worse for a one-engineer team.
- **Cloud-native (CloudWatch + Datadog)** — research §6.2: rejected; AllowMe runs on Railway.
- **Per-family rate limiting** — separate concern from observability.
- **Backfill of historical audit logs into Axiom** — plan §2: not happening; historical logs stay on disk.
- **Tier-2 PII redaction** (child names, family names, wallet addresses, tx amounts) — research §5.3 / plan D5: deliberate transparency commitment, NOT redacted; documented in `docs/PRIVACY.md`.
- **OTel collector sidecar** — research §4.3: rejected at AllowMe scale (direct export only).
- **Sampling** — plan D2: 100% spans, 100% audit log entries until 50k families or >25 GB/mo ingestion.

---

## 3. Deliverables

| ID | Deliverable | File(s) | Workstream |
|----|-------------|---------|------------|
| DEL1 | OTel SDK bootstrap (NodeSDK + OTLP-HTTP exporter + auto-instrumentations) imported as first line of `app/server.ts` | [`src/observability/otel.ts`](../src/observability/otel.ts), [`app/server.ts`](../app/server.ts) | W1 |
| DEL2 | `runTool(name, role, familyId, fn)` wrapper emitting span with `tool.name`, `tool.role`, `tool.family_id`, `tool.success` attributes; recordException on throw | [`src/middleware/tool-runner.ts`](../src/middleware/tool-runner.ts), all callsites in `app/tools/*.ts` | W1 |
| DEL3 | OTel unit tests (OB1–OB5) and family_id-not-a-metric-label tests (OB6–OB8) | [`tests/observability/otel.test.ts`](../tests/observability/otel.test.ts), [`tests/observability/cardinality.test.ts`](../tests/observability/cardinality.test.ts) | W1 |
| DEL4 | AllowMe audit log: JSON-array → JSONL writer change + one-shot migration script writing `.bak` | [`src/audit/log.ts`](../src/audit/log.ts), [`scripts/migrate-audit-logs.ts`](../scripts/migrate-audit-logs.ts) | W2 |
| DEL5 | Audit log forwarder tests (OB11–OB14) | [`tests/observability/audit-forwarder.test.ts`](../tests/observability/audit-forwarder.test.ts) | W2 |
| DEL6 | Vector sidecar config covering both audit streams (W2 + W3 sources, W4 sink) | `vector.toml` (repo root or `observability/vector.toml`) | W2 + W3 |
| DEL7 | OWS audit forwarder tests (OB15–OB18) | [`tests/observability/ows-forwarder.test.ts`](../tests/observability/ows-forwarder.test.ts) | W3 |
| DEL8 | Sentry SDK init with `beforeSend` redactor; fail-closed on redactor throw | [`src/observability/sentry.ts`](../src/observability/sentry.ts), [`app/server.ts`](../app/server.ts) | W4 |
| DEL9 | `redactString` / `redactObject` / `redactSensitive` — single source of truth, four Tier-1 patterns (`ows_key_…`, `SETUP-…`, private-key hex, `OWS_PASSPHRASE=…`); Tier-2 deliberately untouched | [`src/observability/redact.ts`](../src/observability/redact.ts) | W4 |
| DEL10 | Sentry + redaction tests (OB21–OB29) including snapshot tests for each Tier-1 pattern, fail-closed test, and Tier-2-survives-intact assertion | [`tests/observability/sentry.test.ts`](../tests/observability/sentry.test.ts), [`tests/observability/redact.test.ts`](../tests/observability/redact.test.ts) | W4 |
| DEL11 | CI coverage gate: `src/observability/redact.ts` at 100% branches/functions/lines | `vitest.config.ts` (or `package.json` `test:coverage` script + threshold) | W4 |
| DEL12 | `/health` enrichment: four parallel checks, per-check `latencyMs`, 503 on any failure | [`app/server.ts`](../app/server.ts), helper modules under `src/health/*.ts` | W5 |
| DEL13 | Deep-health tests (OB31–OB35) | [`tests/observability/health.test.ts`](../tests/observability/health.test.ts) | W5 |
| DEL14 | Two Axiom dashboards + three saved queries, all version-controlled JSON | `observability/dashboards/{overview,policy_engagement}.json`, `observability/queries/{tool_calls_24h,tool_p95_24h,error_rate_24h}.json` | W6 |
| DEL15 | Dashboard validation tests (OB36, OB37) | [`tests/observability/dashboards.test.ts`](../tests/observability/dashboards.test.ts) | W6 |
| DEL16 | Performance test: instrumentation overhead p95 < 5ms vs unwrapped baseline, **with explicit warmup phase (100 discarded calls) to amortize SDK init / JIT / V8 inline-caching costs out of measurement** | [`tests/observability/perf.test.ts`](../tests/observability/perf.test.ts) | W1 + perf gate |
| DEL16a | Bundled carry-over from Sprint 4.0.1 evaluator follow-up #4: AM-PERF-2 scrypt-counter assertion on the lazy-mint idempotency path (closes 4.1 contract cleanly so 4.2 PASS doesn't inherit open items) | [`tests/bench/distributor-bench.test.ts`](../tests/bench/distributor-bench.test.ts) | W0 or W1 |
| DEL17 | `docs/PRIVACY.md` documenting Tier-1 vs Tier-2 redaction policy and what Axiom receives | `docs/PRIVACY.md` | W4 + W6 |
| DEL18 | `progress.md` updated at every workstream checkpoint (W0 → W6) with "Failed Approaches" maintained per Harness v3 failure protocol | [`sprint-4.0.2/progress.md`](./progress.md) | continuous |

---

## 4. Verification criteria

Sixteen criteria, evaluator-verifiable from the deployed build + Axiom/Sentry observable state alone (no `progress.md` reads).

### Functionality (35% rubric weight — must all pass for Pass)

**C1 — Every MCP tool call produces a span (SC1).** A `check-progress` invocation through the deployed MCP server produces a span in the Axiom `mcp-events` dataset within 60s. The span name is `tool.check-progress`. Required attributes are present: `tool.name`, `tool.role`, `tool.family_id`, `tool.success`. Resource attributes include `service.name=allowme-mcp`. *Locked by `OB1`, `OB2`, `OB4`, `MV3`.*

**C2 — Tool failure path records exception.** A tool that throws produces a span with `tool.success=false`, `status.code=2` (ERROR), and an `exception` event. The thrown error is re-raised to the caller (the wrapper does not swallow). *Locked by `OB3`.*

**C3 — AllowMe audit log forwarding within 30s (SC2).** A new entry written to `data/families/<id>/audit-log.jsonl` appears in the Axiom `audit-logs` dataset within 30 seconds, tagged `source: "allowme"` and `family_id: "<id>"` parsed from path. *Locked by `OB13`, `OB14`, `MV3`.*

**C4 — Audit log migration is non-destructive (D7).** Running the one-shot migration on a legacy `audit-log.json` (JSON-array) produces:
1. `audit-log.jsonl` with one line per entry, in original order.
2. `audit-log.json.bak` preserving the original file byte-for-byte.

The migration is idempotent — running it twice does not double-migrate or corrupt either file. *Locked by `OB12`.*

**C5 — OWS audit log forwarding with `policy_evaluated` visible (SC3).** A successful `distribute-allowance` invocation (post-Sprint 4.0.1) produces, in the Axiom `audit-logs` dataset within 30s of the on-chain confirmation:
1. An entry with `source: "ows"`, `event: "policy_evaluated"`, `decision: "allow"`, with non-empty `reason` and `policy_version`.
2. An entry with `source: "ows"`, `event: "broadcast_transaction"`, with the on-chain `txHash`.
3. An entry with `source: "allowme"`, `event: "distribute_allowance"`.

All three reference the same `family_id`. *Locked by `OB15`, `OB17`, `OB18`, `MV3`.*

**C6 — `/health` returns 503 on deep-check failure (SC6).** When `/health` is hit:
- All four checks present: `masterKey`, `owsVault`, `recentTx`, `policyEngagement`.
- All four report `latencyMs`.
- If any of the four returns `status: "fail"`, the HTTP status is **503** and `body.status` is `"degraded"`.
- If all four are `"ok"`, the HTTP status is **200** and `body.status` is `"ok"`.

Verified specifically for the master-key-absent failure mode (rename the key file → `/health` returns 503 with `checks.masterKey.status="fail"`). *Locked by `OB31`, `OB32`, `OB33`, `OB35`, `MV1`.*

### Auth / Security (30% rubric weight — load-bearing redactor gate)

**C7 — End-to-end Sentry redaction: Tier-1 patterns never reach Sentry's transport (HARD-FAIL).** This is the deliverable Sprint 4.0.1 DEL11 deferred and that must not be allowed to vacuously satisfy again. Two verification surfaces, both required:

1. **Mocked-Sentry pipeline test.** With the Sentry SDK initialized and its transport replaced by an in-memory capture, a deliberate throw containing each of the four Tier-1 patterns produces a Sentry event in the capture. Inspecting the captured event payload (after `beforeSend` has run) shows **none of the four Tier-1 regex patterns match anywhere in the serialized event**. The capture observes what would have gone over the wire — not the pre-`beforeSend` form. *Locked by `OB21`, `OB22`, `OB23`, `OB24` (extended to assert against capture, not the input).*
2. **CI snapshot test on the redactor in isolation.** Same input shapes as C8, verifying the redactor's output independently of the Sentry pipeline. *Locked by `OB26`, `OB27`, `OB28`.*

Both must pass. Either alone is insufficient: (1) without (2) leaves the redactor untestable when the Sentry SDK is mocked away in other tests; (2) without (1) lets a `beforeSend` wiring bug ship undetected. *Verified end-to-end by `MV2`.*

**Why this is its own criterion:** Sprint 4.0.1 C8.4 (no token leaks to Sentry events) was vacuously satisfied because Sentry was not shipped. Sprint 4.0.2 ships Sentry. The vacuous-satisfaction loophole must close here, explicitly, with a hard-fail gate naming the failure mode.

**C8 — Tier-1 redaction snapshot — no pattern survives `redactSensitive` (HARD-FAIL).** A CI snapshot test exercises every Tier-1 pattern (`ows_key_[a-zA-Z0-9_-]+`, `SETUP-[A-Z0-9]{4}-[A-Z0-9]{4}`, `0x[a-fA-F0-9]{64}`, `OWS_PASSPHRASE=…`) embedded in:
1. A flat error message string.
2. A nested object with the pattern in a leaf value (at depth ≥ 2).
3. An env-style string with `OWS_PASSPHRASE=value`.

After `redactSensitive`, **none of the four Tier-1 regex patterns matches the output of any of the three inputs.** The replacement tokens (`[REDACTED_OWS_KEY]`, `[REDACTED_SETUP_CODE]`, `[REDACTED_PRIVATE_KEY]`, `OWS_PASSPHRASE=[REDACTED]`) are present where expected. *Locked by `OB23`, `OB24`, `OB26`, `OB27`, `OB28`.*

**Note on consolidation:** the existing `redactTokens` in [`src/engine/state.ts`](../src/engine/state.ts) (Sprint 4.0.1 audit-walk redaction) is folded into `src/observability/redact.ts` as the single source of truth. `state.ts` imports the canonical redactor; the per-file regex is removed. C8 verifies the consolidated module covers every pre-existing audit-walk test case plus the three new Tier-1 patterns.

**C9 — Tier-2 deliberately preserved.** Strings that contain only Tier-2 content (child names, family names, wallet addresses, transaction amounts) pass through `redactSensitive` byte-for-byte unchanged. This is the documented privacy policy in `docs/PRIVACY.md`. *Locked by `OB29` + `docs/PRIVACY.md` review.*

**C10 — `beforeSend` is fail-closed (D3).** When `redactSensitive` throws synchronously, the `beforeSend` callback returns `null` and the Sentry event is dropped. A console error is emitted so the failure is observable in container logs. *Locked by `OB25`.*

**C11 — Coverage gate on the redactor (HARD-FAIL — OB-COV-1).** `src/observability/redact.ts` reports **100% branch coverage, 100% function coverage, and 100% line coverage**. The Vitest config's `coverageThreshold` enforces this in CI; a drop below 100% on any of the three is a hard build failure. *Locked by `OB-COV-1`.*

**Why 100% strict and hard-fail (not 4.1's ≥85%):** the redactor IS the security boundary. The 4.1 precedent (≥85% on new modules) is correct for general functionality where uncovered branches are acceptable risk. The 4.2 redactor is different — any uncovered branch is a possible token-leak vector. 87%-coverage-and-everything-else-green is not an acceptable shipping condition.

Other new modules in `src/observability/*.ts` retain the ≥85% bar.

**C12 — `family_id` is NOT a metric label (HARD-FAIL — SC8 / cardinality assertion).** Across all OTel `Counter`, `Histogram`, and `UpDownCounter` instruments registered by the application, **no instrument's allowed-label set contains `family_id`**. The label set is restricted to the approved four: `tool_name`, `role`, `success`, `chain_id`. `family_id` appears only as a **trace/span attribute** and as a **log/audit body field**. Three required artifacts:

1. A unit test asserts the instrument label whitelist (no `family_id` in any metric's allowed-label set).
2. A CI-enforced lint rule or grep check (`.eslintrc.observability.js` per `OB6` or `npm run check:no-family-id-as-metric-label`) rejects any new code path that would add `family_id` to a metric instrument's labels.
3. Manual verification (`MV6`) confirms the Axiom metrics view does not expose `family_id` as a grouping dimension.

*Locked by `OB6`, `OB7`, `OB8`, `MV6`.*

**Why hard-fail:** cardinality is an irreversible architectural commitment. Once metrics labels include `family_id` and ingestion is running, you cannot retroactively scrub cardinality from a metrics provider without a migration. Cardinality bugs found post-merge are expensive; cardinality bugs caught pre-merge are free.

### Design / UX (10% rubric weight)

**C13 — Dashboards are version-controlled and valid (SC7).** Both `observability/dashboards/overview.json` and `observability/dashboards/policy_engagement.json` exist in the repo. Each parses as valid JSON, has a `name`, has a non-empty `panels` array, and references query files that exist in `observability/queries/`. The `overview` dashboard has exactly three panels matching `tool_calls_24h`, `tool_p95_24h`, `error_rate_24h`. *Locked by `OB36`, `OB37`. Live-data render verified by `MV4`, `MV5`.*

**C14 — `tsc --noEmit` clean.** Zero new TypeScript errors. The OTel SDK, Sentry SDK, Vector config schemas (if typed), and the four `/health` check helpers all type-check. New `runTool` wrapper integrates without touching tool handler signatures.

### Backward compatibility (central correctness gate)

**C15 — Regression suite green; no test-logic edits (with carve-outs).** The full pre-existing test suite (Sprint 2.5 → Sprint 4.0.1, currently **527 passing + 3 skipped + 2 todo**) passes after the Sprint 4.0.2 changes. The regression bar is **527 + new OB tests** passing, plus the 3 skipped and 2 todo retained as-is.

**Three allowed test-side modification classes (carve-outs):**

1. **Mechanical wrap of tool dispatch with `runTool(...)`** in shared test helpers. Strict ceiling: **two callsites per non-audit-log test file.**
2. **Mock-shape updates that mirror production return-type changes.** This formalizes the spirit-extension the Sprint 4.0.1 evaluator flagged on AM-equivalent mock factories. Concretely: if a production function's return type gains a field, the `vi.mock` factory may add that field; if a parameter shape changes, the mock implementation may accept the new shape. **Out of scope:** changed assertions, removed test cases, added bypass conditions, or any edit that loosens what the test verifies.
3. **Audit-log JSONL migration mechanical updates.** Tests that directly read or write `data/families/*/audit-log.*` may be mechanically updated to handle the JSONL format (changed parse logic, updated snapshot baselines, updated fixture file extensions). Subject to the same no-test-logic-edits constraint as classes 1 and 2. The W2 + D7 format change is a contained structural migration; carve-out is bounded to audit-log-touching tests only.

**What remains tightly bounded:** the two-mechanical-edit ceiling per file still applies to ALL non-audit-log tests (auth, signing, RBAC, policy engagement, allowlist, multi-tenant isolation, policy-cache). Any test-logic edit in those files — changed assertions, removed test cases, added bypass conditions, weakened expectations — is a sprint failure regardless of which class the Generator attempts to invoke.

### Performance (locked threshold)

**C16 — Instrumentation overhead under 5ms p95, strict (OB-PERF-1).** A 1000-iteration benchmark comparing `runTool("perf-test", "manager", "fam_abc", () => Promise.resolve())` against an unwrapped `await Promise.resolve()` shows **p95 difference strictly less than 5ms**. `/health` deep-check total p95 < 200ms (per plan §6 R6).

**Required test-design constraint:** OB-PERF-1 MUST include an explicit warmup phase that discards the first 100 invocations of both the wrapped and unwrapped paths before measurement begins. This amortizes OTel SDK init, JIT compilation, and V8 inline-caching costs out of per-call measurement, so the 5ms budget reflects steady-state behavior — not cold-start artifacts. Concretely:

```typescript
// Warmup — discard first 100 calls (covers SDK init, JIT, V8 inline caching)
for (let i = 0; i < 100; i++) {
  await runTool("perf-test", "manager", "fam_abc", () => Promise.resolve());
}
// Then measurement — record into unwrappedTimes / wrappedTimes arrays
```

**No soft-fail clause for SDK-init artifacts.** The warmup phase eliminates the SDK-init artifact by construction. A 5ms overshoot indicates real per-call wrapping overhead, which fails the sprint. *Locked by `OB-PERF-1`.*

---

## 5. Rubric (Infrastructure class)

| Category | Weight | Definition | Locked criteria |
|----------|--------|------------|-----------------|
| Functionality | **35%** | OTel spans flow to Axiom; both audit streams forward within 30s; `policy_evaluated` reaches Axiom; `/health` deep-checks behave (200 healthy / 503 degraded); audit log migration is non-destructive | C1, C2, C3, C4, C5, C6 |
| Auth / Security | **30%** | End-to-end Sentry redaction (Tier-1 patterns never reach transport); no Tier-1 pattern survives `redactSensitive` (load-bearing gate); Tier-2 deliberately preserved per documented policy; `beforeSend` fail-closed; redactor branch coverage strictly 100%; cardinality discipline (`family_id` never a metric label) | C7, C8, C9, C10, C11, C12 |
| Design / UX | **10%** | Dashboards version-controlled; `tsc --noEmit` clean; regression suite green within carve-outs | C13, C14, C15 |
| Originality | **25%** | Single-source-of-truth redactor shared across three observability surfaces (Sentry, audit walk, forwarder shape check) — and the consolidation of the existing `redactTokens` from `src/engine/state.ts` into it; two-tier PII model (Tier-1 always-redact vs Tier-2 documented-not-redacted); cardinality-as-design (family_id-as-trace-attribute-not-metric-label); Vector sidecar with one config covering both audit streams; direct OTel export (no collector) at this scale; aggregator escape hatch documented (Axiom → Grafana Cloud is a single-line config swap) | reviewed at evaluation |

**Why Auth/Security at 30% (not 25%):** the redactor is genuinely the security boundary of 4.2 — Tier-1 PII (`ows_key_…`, `SETUP-…` codes, master keys) flowing to a third-party aggregator is a security incident, not an operability bug. Most of 4.2 is wiring (OTel init, Vector config, dashboard JSON); the novel logic is concentrated in the redactor (W4) and the deep-health endpoint (W5). Weighting functionality at 45 would over-reward plumbing and under-reward the security-critical work. 30% on Auth makes OB-COV-1 (100% redactor coverage) and the Tier-1 redaction snapshot tests load-bearing for the grade, not nice-to-haves.

**Why Originality at 25% (high for infrastructure):** Four design decisions that are non-obvious and load-bearing:
1. The redactor is one module, used by three independent surfaces, AND it consolidates the pre-existing `redactTokens` from Sprint 4.0.1's `src/engine/state.ts`. A common implementation choice is to redact at each surface separately, which guarantees drift over time. Single source of truth eliminates the drift class.
2. The two-tier PII model rejects the "redact everything we might worry about later" instinct. Tier-2 is deliberate transparency, not laziness.
3. `family_id` is not a metric label — research §3.3 shows why, but the implementation has to carry the discipline through to a CI-enforced gate. Most infrastructure sprints fail this through accident rather than design.
4. The fail-closed `beforeSend` (drop the event if the redactor throws) inverts the default ergonomic preference (deliver telemetry on best-effort). The trade-off is that a missing error report is recoverable but a leaked token in Sentry's UI is not — and the inversion is the right call.

**Why Design at 10% unchanged:** 4.2 has no user-facing surface. Dashboards, `tsc` cleanliness, and regression-suite preservation are the entirety of the Design/UX category here.

---

## 6. Grading thresholds

- **Pass:** all of C1–C16 verified. Each rubric category at ≥75%. Backward-compat (C15) green within the three named carve-outs. Coverage gate (C11) at strict 100% branches/functions/lines on `src/observability/redact.ts`.
- **Fail (any single condition):**
  - ANY of the nine hard-fail criteria fails: **C1, C5, C6, C7, C8, C10, C11, C12, C15**.
  - `tsc --noEmit` errors (C14 failure).
  - Pre-existing test suite regresses with edits outside the C15 carve-outs.
  - A Tier-1 pattern survives `redactSensitive` for any input (C8 sub-failure).
  - A Tier-1 pattern reaches Sentry's transport in the mocked-pipeline test (C7 sub-failure).
  - `family_id` appears as a metric label dimension in any OTel instrument (C12 sub-failure).
  - Redactor coverage drops below 100% on any of branches / functions / lines (C11 sub-failure).
  - OB-PERF-1 lacks the required warmup phase (C16 test-design constraint).
- **Soft fail (Pass-with-followup):** Dashboard live-data verification (`MV4`, `MV5`) is gated on 1h of production traffic — if the deploy lands at end of day, evaluator may issue Pass-pending-MV with a 24h re-verification window. **No other soft-fail clauses.** The 4.1-style "harness shipped, baseline missing" pattern is the only acceptable Pass-with-followup shape, and only for live-data dashboards. Performance overhead (C16) is strict: the warmup phase eliminates SDK-init artifacts by construction, so any 5ms overshoot is a real per-call regression and fails the sprint.

---

## 7. Hand-off rules

1. Generator implements per [`plan.md`](./plan.md) §3 Workstreams AND this contract. Generator updates [`progress.md`](./progress.md) at every workstream checkpoint (W0 → W6), keeping the "Failed Approaches" section ≤10 lines per Harness v3 failure protocol.
2. Generator MUST read [`progress.md`](./progress.md) "Failed Approaches" before starting work each session. Repeating a documented failure is a rubric penalty.
3. Generator MUST run the regression bar after W2 (audit log JSONL migration touches every consumer), after W6 (callsite swap to `runTool`), and before any merge. Any red goes into "Failed Approaches" before continuation.
4. Generator MUST NOT self-evaluate. The Evaluator (Phase 3) reads only this contract + the deployed build + Axiom/Sentry observable state — never `progress.md`.
5. **Sentry framing correction (carry-over from Sprint 4.0.1 evaluation):** plan §3 W4 and research §1.3 originally read "the Sprint 4.0.1 W9.1 stub becomes the real `beforeSend` redactor." This framing is wrong — Sprint 4.0.1's W9 shipped the audit-walk `redactTokens` and the CI grep gate, but the Sentry `beforeSend` stub (Sprint 4.0.1 DEL11) was deferred and not delivered. **Sprint 4.0.2 W4 is net-new Sentry SDK integration, not stub promotion.** The Generator must NOT spend time looking for a non-existent stub. Instead, W4 consolidates the existing `redactTokens` in [`src/engine/state.ts`](../src/engine/state.ts) into the new `src/observability/redact.ts` as the single source of truth, then wires `beforeSend` to call it.
6. **Pre-implementation spike:** research §9 reports no ⚠️ markers, but at the start of W2 the Generator must verify the actual on-disk shape of `audit-log.json` (single array vs array-of-arrays vs newline-delimited array) before committing to migration semantics. If the format differs from research §1.2, append findings to research.md §5 under a new sub-section before proceeding.
7. **OB-PERF-1 warmup requirement (C16):** the perf benchmark MUST include the 100-call warmup phase shown in C16's code block. The Evaluator will inspect the test source for the warmup loop; absence is an automatic C16 failure regardless of the measured p95.
8. **Bundled 4.0.1 carry-over (DEL16a):** while touching the perf harness for OB-PERF-1, the Generator includes the AM-PERF-2 scrypt-counter assertion that Sprint 4.0.1's evaluator flagged as lower-priority follow-up #4. This closes the 4.1 contract cleanly so the 4.2 PASS verdict doesn't inherit open items. Cost is trivial (one assertion against `scryptSync` call count on the lazy-mint path); benefit is contract hygiene.
9. **Pre-deploy checklist:** W0 env vars set in Railway, W1 OTel SDK exporter URL hits Axiom (curl test returns 200), W4 Sentry DSN validates, W6 dashboard JSON files committed to repo.
10. **PR sequencing per plan §7:** PR1 (W0+W1+W2+W3) merges first; PR2 (W4+W5) and PR3 (W6) are independent and can land in either order after PR1. DEL16a (AM-PERF-2) rides with whichever PR includes the perf-harness changes.

---

## 8. Out-of-scope reminders (so the evaluator doesn't penalize their absence)

The evaluator MUST NOT mark Fail for any of:
- Alerting rules / paging policy not implemented (deferred per plan D8 + research §5.5).
- SLO definition not implemented (same reasoning).
- Self-hosted observability stack not implemented (research §6.1 rejected).
- CloudWatch / Datadog integration not implemented (research §6.2 rejected).
- Per-family rate limiting not implemented (separate concern).
- Historical audit-log backfill into Axiom (plan §2: not happening).
- Tier-2 PII (child names, family names, wallet addresses, tx amounts) NOT redacted — this is deliberate per plan D5 + `docs/PRIVACY.md`.
- OTel collector sidecar absent (research §4.3: rejected at scale).
- Sampling not implemented (plan D2: 100% until 50k families).
- Cross-region replication of Axiom data (out of program scope).
- Sub-30s log-forwarding latency (the SLA is 30s; sub-second is not a goal).

---

## 9. Risks acknowledged (mirror plan §6)

R1 (OTel SDK supply chain) → version pin + monthly review. R2 (Vector memory pressure on Railway) → tmpfs `data_dir`; 2GB headroom. R3 (Axiom outage during W6) → ingestion proven separately via curl; dashboards can wait. R4 (audit log format migration breaks consumer) → one-shot migration + `.bak` preservation. R5 (redactor bug drops legitimate events) → snapshot tests + first-week manual review. R6 (`/health` deep checks add latency) → `Promise.all` parallelization; p95 budget 200ms. R7 (cardinality explosion via `family_id`) → C12 hard gate + lint/test. R8 (forwarded child names trigger privacy concern) → `docs/PRIVACY.md` ships with sprint.

---

## 10. Status

- Contract version: **1.1** (incorporates user review feedback on rubric weights, hard-fail set expansion, C15 carve-outs, C16 warmup requirement, and Sprint 4.0.1 carry-over bundling)
- Approval: **pending user confirmation of v1.1**
- Changes from v1.0:
  - Rubric reweighted: Func 45→35, Auth 25→30, Design 10 (unchanged), Originality 20→25. Auth floor is 30%.
  - C7 strengthened to explicit end-to-end Sentry-redaction gate with mocked-transport capture (hard-fail). Closes the Sprint 4.0.1 C8.4 vacuous-satisfaction loophole.
  - C8 hard-fail status made explicit. Consolidation note: existing `redactTokens` in `src/engine/state.ts` folds into the new module.
  - C11 strict 100% (not ≥85%) and explicitly hard-fail. Rationale documented.
  - C12 (cardinality / `family_id`-not-a-metric-label) elevated to hard-fail with three-artifact verification.
  - C15 three carve-outs formalized: (1) `runTool` wrap ceiling 2/file, (2) mock-shape updates mirroring production changes, (3) audit-log JSONL migration mechanical updates. Two-edit ceiling still bounds non-audit-log tests.
  - C16 strict 5ms, warmup phase required in test design, soft-fail clause removed.
  - DEL16a added: bundle AM-PERF-2 scrypt-counter test from Sprint 4.0.1 evaluator follow-up #4 to close 4.1 contract cleanly.
  - Hand-off rule §7.5 added: Sentry framing correction for Generator (no stub exists; 4.2 W4 is net-new integration).
- Generator entry point on approval: W0 (provisioning) per [`plan.md`](./plan.md) §3
- Evaluator entry point on Generator hand-off: this contract + the deployed build + Axiom/Sentry observable state (no `progress.md` reads)
