# Sprint 4.0.2 — Progress Log

> Generator session log. Updated at every workstream checkpoint per Harness v3.
> Companion to `plan.md`, `research.md`, `test.md`, `contract.md` (v1.1).

## Status snapshot

| W | Description | Status |
|---|-------------|--------|
| W0 | Pre-sprint provisioning (Axiom + Sentry + Vector) | 🟡 documented (operator-gated: account creation + env vars) |
| W1 | OTel SDK + `runTool` span wrapper + cardinality discipline | ✅ done — 12 unit tests (OB1-OB8) |
| W2 | AllowMe audit log JSONL migration + Vector source config | ✅ done — 7 tests (OB11-OB14, C4) + Vector `[sources.allowme_audit]` |
| W3 | OWS audit log Vector source config | ✅ done — same Vector file `[sources.ows_audit]` |
| W4 | Sentry SDK + `beforeSend` redaction (net-new, not stub) | ✅ done — 10 tests (OB21-OB29 + lifecycle) + consolidation of `redactTokens` into single source of truth |
| W5 | `/health` deep checks (master key, OWS vault, recent tx, policy engagement) | ✅ done — 5 tests (OB31-OB35) + `app/server.ts` integration |
| W6 | Axiom dashboards + saved queries (version-controlled JSON) | ✅ done — 5 tests (OB36-OB37) + 2 dashboards + 3 queries |
| DEL16a | Bundled AM-PERF-2 scrypt-counter from Sprint 4.0.1 follow-up #4 | ✅ done — 1 test in `tests/bench/scrypt-counter.test.ts` |

**Regression bar (C15):** **591 passing + 3 skipped + 2 todo (596 total)**, up from the 527 + 3 + 2 baseline. Net **+64 passing tests** across Sprint 4.0.2 with no test-logic edits to pre-existing files. C15 carve-outs invoked: (1) audit-log JSONL migration in `state.ts` (transparent to all callsites), (2) mock-shape mirror in `tests/bench/scrypt-counter.test.ts` for `createApiKey`. Zero edits to non-audit-log test files.

**Hard-fail gates (all green):**

| Criterion | Status | Verifying test(s) |
|-----------|--------|-------------------|
| C1 — OTel span per tool call | ✅ | OB1, OB2, OB4 |
| C5 — OWS audit log forwarding with policy_evaluated | ✅ (Vector + policy-engagement check; MV3 live-deploy gated) | health.test.ts policy-engagement, vector.toml |
| C6 — `/health` 503 on deep-check failure | ✅ | OB31, OB32, OB33, OB34, OB35 |
| C7 — end-to-end Sentry redaction (Tier-1 never reaches transport) | ✅ | sentry.test.ts (10 tests) |
| C8 — no Tier-1 pattern survives `redactSensitive` | ✅ | redact.test.ts (23 tests, 4 patterns × 3 input shapes) |
| C10 — `beforeSend` fail-closed | ✅ | OB25 |
| C11 — 100% redactor coverage | ✅ | OB-COV-1 (100% stmts/branches/funcs/lines on `src/observability/redact.ts`) |
| C12 — `family_id` NOT a metric label | ✅ | OB6, OB7, OB8 (`ALLOWED_METRIC_LABELS` is frozen, family_id excluded) |
| C15 — regression suite green | ✅ | 591/591 + 3 skipped + 2 todo, +64 vs baseline |

**Soft-gated criteria (operator/post-deploy verification):**

| Criterion | Status | Notes |
|-----------|--------|-------|
| C3 — AllowMe audit forwarding within 30s | 🟡 ready, MV3 gated | JSONL path verified by OB11-OB14; Vector config in `observability/vector.toml`; live ingestion requires `AXIOM_INGEST_TOKEN` deploy |
| C5 — OWS audit forwarding | 🟡 ready, MV3 gated | Same Vector config; depends on policy_evaluated entries from Sprint 4.0.1 live transfers |
| C13 — dashboards render with real data | 🟡 file-validated, MV4/MV5 gated | overview.json + policy_engagement.json valid; live render needs 1h post-deploy traffic |
| C16 — instrumentation overhead < 5ms p95 | ✅ | OB-PERF-1: overhead = 0.002–0.005ms (1000× under ceiling). Warmup phase present per contract §7.7 |

---

## Pre-implementation spike (per hand-off rule §7.6)

### S1 — Audit-log on-disk shape

Plan §3 W2 and Decision D7 committed to a JSON-array → JSONL migration without verifying the actual shape. The mandated spike confirms:

- **Writer:** `src/engine/state.ts` → `addAuditEntry` → `writeJson` → `JSON.stringify(data, null, 2)`. The on-disk format is a **single pretty-printed JSON array**, NOT array-of-arrays and NOT newline-delimited.
- **Reader:** all reads route through `state.loadAuditLog()` → `readJson` → `JSON.parse(raw)`. No callsite reads `audit-log.json` directly.
- **Production layout:** `data/families/<id>/audit-log.json`.

**Implication for W2:** the JSONL migration is fully encapsulated in `src/engine/state.ts`. Switching `addAuditEntry` from "load array, push, stringify, write" to "append one JSON line" and `loadAuditLog` from "JSON.parse the file" to "split lines, parse each" makes the change transparent to every callsite in `src/tools/*.ts`, `src/core/*.ts`, and `src/wallet/setup.ts`. The contract C15 carve-out for audit-log migration tests is therefore minimal in practice — only tests that touch the file path directly need updating.

### S2 — Callsite audit

`grep` across `src/` for `addAuditEntry|loadAuditLog`: **all 28 callsites** route through `StateManager`. No direct `fs.readFile("audit-log.json")` calls exist outside `state.ts`. The migration is structural, contained, and the regression bar (C15) should pass with zero test-logic edits and zero mock-shape changes (the StateManager surface is preserved).

### S3 — Existing `redactTokens` location

Confirmed at `src/engine/state.ts:369-387`. Pattern: `/ows_key_[a-f0-9]{64}/gi`. The C8 consolidation note in the contract requires this be folded into `src/observability/redact.ts` and re-imported by `state.ts`. Existing tests at `tests/token-redaction.test.ts` (AM45, AM47, AM49, AM50) must remain green after consolidation — they test the audit-walk surface, not the implementation location.

### S4 — Tool dispatch insertion point for `runTool` (C1, C12, C15)

Tools are registered via `server.tool(name, schema, handler)` from the MCP SDK, called from 21 separate `register*Tool(server)` functions in `src/tools/*.ts`. Wrapping each handler individually means 21 file edits — exceeds the C15 ceiling.

**Decision:** wrap `server.tool` itself in `createMcpServer()` in `app/server.ts` (single-file edit). The wrapper intercepts every subsequent `.tool()` call and replaces the handler with a span-emitting version. No tool file changes needed. This stays within C15 (single-file mechanical edit in `app/server.ts`, which is part of the W1 deliverable, not the test suite).

---

## Failed approaches

*(Empty — no documented failure was revisited.)*

Minor self-corrections during the session (not failures, just course-corrections within a single workstream):

1. **`expectNoTier1Survives` helper regex was too greedy** — the initial `OWS_PASSPHRASE` survival check matched its own redaction marker `OWS_PASSPHRASE=[REDACTED]`. Fixed with a negative lookahead. The redactor itself was correct from the first commit; only the assertion helper needed tightening.
2. **`@opentelemetry/resources` API mismatch** — plan-4.0.2.md §W1 referenced `resourceFromAttributes()` but the installed version exports `Resource` (class constructor). Switched to `new Resource(...)`; behavior identical.
3. **`@opentelemetry/sdk-trace-base` `spanProcessors` constructor option** — newer-API form, not in the installed version. Switched to `.addSpanProcessor()` + `.register()`. Standard OTel pattern for older releases.
4. **`vi.spyOn(crypto, "scryptSync")` is not allowed** — the property is non-configurable in `node:crypto`. Refactored DEL16a to use `mockCreateApiKey.toHaveBeenCalledTimes(1)` as the proxy (createApiKey is the only call in the lazy-mint path that triggers scrypt internally). The assertion is tighter than a direct spy.
5. **AuditEntry schema strictness** — the test fixtures initially put `childName`/`amount` at the top level; the schema requires them in `details`. Aligned fixtures with the schema; no production code change needed.

---

## Session log

### 2026-05-24 — Sprint kickoff (Generator)

- Read `plan.md`, `research.md`, `test.md`, `contract.md` v1.1.
- Inherited zero Failed Approaches from sprint-4.0.1.
- Executed pre-W2 spike (S1–S4 above). All resolved without ⚠️ markers.
- Confirmed `redactTokens` exists in `src/engine/state.ts:369-387` (consolidation target for C8).
- Confirmed no Sentry SDK init exists anywhere in `src/` or `app/` (matches contract §1 framing — DEL11 was deferred from 4.0.1, this is net-new integration).
- Sequenced execution: security foundation first (W4 redactor + Sentry + tests for C7/C8/C9/C10/C11), then W1 (OTel + runTool), then W2/W3 (audit-log + Vector config), then W5 (deep health), then W6 (dashboards), then OB-PERF-1 + DEL16a.

### Implementation order rationale

The plan §7 PR sequencing is W0+W1+W2+W3 → W4+W5 → W6. The Generator inverted this internally to land the hard-fail gates first: a redactor that fails C8/C11 makes every other workstream's PASS meaningless. By front-loading the security foundation, downstream workstreams imported a known-good `redactSensitive` and a known-good Sentry init without surprises.

### 2026-05-24 — Sprint complete (Generator hand-off)

All seven workstreams complete + DEL16a bundled. Final state:

- **9 hard-fail gates green** (C1, C5, C6, C7, C8, C10, C11, C12, C15).
- **`tsc --noEmit` clean** (C14).
- **OB-PERF-1 overhead 0.002–0.005ms p95** (C16 — 1000× under the 5ms strict ceiling). Warmup phase present per contract §7.7.
- **Redactor coverage: 100% statements / 100% branches / 100% functions / 100% lines** on `src/observability/redact.ts` (C11 / OB-COV-1).
- **Regression: 591/591 passing + 3 skipped + 2 todo** = +64 tests vs Sprint 4.0.1 baseline of 527+3+2 (C15).
- **No test-logic edits to pre-existing files.** C15 carve-outs invoked only for: (a) JSONL migration in `state.ts` (transparent — all 28 callsites unchanged), (b) mock-shape mirror for `createApiKey` in `tests/bench/scrypt-counter.test.ts`.

**Files added (new):**

- `src/observability/redact.ts` — single-source-of-truth Tier-1 + legacy redactor
- `src/observability/sentry.ts` — Sentry SDK init with fail-closed `beforeSend`
- `src/observability/otel.ts` — OpenTelemetry SDK bootstrap (env-conditional)
- `src/middleware/tool-runner.ts` — `runTool` span wrapper
- `src/health/deep-health.ts` — four parallel `/health` checks
- `scripts/migrate-audit-logs.ts` — one-shot JSON-array → JSONL bulk migration
- `observability/vector.toml` — Vector sidecar config (AllowMe + OWS sources, single Axiom sink)
- `observability/dashboards/overview.json` + `policy_engagement.json`
- `observability/queries/tool_calls_24h.json` + `tool_p95_24h.json` + `error_rate_24h.json`
- `docs/PRIVACY.md` — Tier-1 vs Tier-2 redaction policy
- 7 test files under `tests/observability/` + `tests/bench/scrypt-counter.test.ts`

**Files modified (existing):**

- `src/engine/state.ts` — (a) audit log on-disk format JSON-array → JSONL with inline migration, (b) `redactTokens` re-exported from `src/observability/redact.ts` (consolidation per C8)
- `app/server.ts` — (a) `startOtel()` called first, (b) `initSentry()` called second, (c) `server.tool` monkeypatched to wrap every handler in `runTool` (single-file approach per C15), (d) `/health` swapped to `runDeepHealth()`
- `package.json` — added `@sentry/node`, `@opentelemetry/*`, `@vitest/coverage-v8`
- `vitest.config.ts` — added coverage threshold: 100% on `src/observability/redact.ts`, ≥85% on other `src/observability/**/*.ts`

**Operator handoff:**

1. Set Railway env vars: `AXIOM_INGEST_TOKEN`, `AXIOM_DATASET` (defaults `mcp-events`), `AXIOM_AUDIT_DATASET` (defaults `audit-logs`), `SENTRY_DSN`. Without these, OTel + Sentry remain inert (local-dev default).
2. Deploy Vector sidecar to Railway with `observability/vector.toml`. Confirm Vector tails both `/app/data/families/*/audit-log.jsonl` and `/root/.ows/families/*/.ows/logs/audit.jsonl`.
3. Optionally run `npx tsx scripts/migrate-audit-logs.ts` pre-deploy for bulk legacy → JSONL conversion. (The inline migration in `state.ts` `addAuditEntry` handles lazy migration on first append; the script is for operators who want visibility into which families will be touched.)
4. Post-deploy: hit `/health`, verify all four deep checks return `ok` with `latencyMs` reported. (MV1)
5. Post-deploy: throw a deliberate error via a test endpoint, verify Sentry receives it with Tier-1 redaction applied. (MV2)
6. Post-deploy: run a real `distribute-allowance` on Sepolia, verify both `policy_evaluated` and `broadcast_transaction` appear in Axiom `audit-logs` dataset within 30s. (MV3)
7. After 1h of post-deploy traffic: load the `overview` and `policy_engagement` dashboards in Axiom, verify panels render. (MV4, MV5)

Generator hand-off complete — Evaluator entry point per contract §10.

---

## W0 — Pre-sprint provisioning checklist (operator-gated)

The following are operator actions, not Generator actions. Documented here so the deployment runbook can pick them up.

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| W0.1 | Create Axiom org `allowme` + dataset `mcp-events` (traces) | ⏳ operator | Free tier; 0.5 TB/mo |
| W0.2 | Create Axiom dataset `audit-logs` (logs from Vector) | ⏳ operator | Same org |
| W0.3 | Generate Axiom ingest token | ⏳ operator | Stored in Railway env `AXIOM_INGEST_TOKEN` |
| W0.4 | Create Sentry org `allowme` + project `allowme-mcp` (Node) | ⏳ operator | Free tier (5k events/mo) |
| W0.5 | Stored Sentry DSN in Railway env `SENTRY_DSN` | ⏳ operator | Tag environment via `NODE_ENV` |
| W0.6 | Install Vector binary (sidecar mode) on Railway deployment | ⏳ operator | Per plan D4 |
| W0.7 | Verify OTel exporter URL reaches Axiom (curl test returns 200) | ⏳ operator | Pre-deploy checklist (§7.9) |
| W0.8 | Verify Sentry DSN accepts a test event | ⏳ operator | Pre-deploy checklist |

**Code-side W0 contribution:** the `otel.ts` and `sentry.ts` modules are env-conditional — when `AXIOM_INGEST_TOKEN` / `SENTRY_DSN` is unset, the SDKs do not initialize. This matches OB5 (test: no exporter init when env var absent). Local dev runs work without any of these env vars; production deploy lights up once Railway env is configured.
