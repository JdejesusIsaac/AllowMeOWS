# Sprint 4.0.3 — Progress

> Generator-owned working artifact. Updated at every workstream
> checkpoint. Compact aggressively — target ≤20% of context per
> `harness-core.md`. Evaluator does NOT read this file.

## Current phase

**All workstreams implemented (W0–W10) + fail-forward BUG-1/BUG-2
closed.** Code-complete; phase soaks (G3/G5 + MV1–MV4) remain as
deploy-gated manual steps before the Phase B/C cutovers. Full suite
green: 703 passed / 0 failed, `tsc` clean. LS-COV-1 gate now enforced
in `vitest.config.ts`; LS-PERF-1/2 implemented and green.

## Phase ordering (locked)

Phase A (W0, W1, W2, W9) → ≥24h soak in `ALLOWME_LEDGER_MODE=dual-write`
→ Phase B (W6, W7, W8) → ≥24h soak with `settle-balance` exercised on
staging → Phase C (W3, W4, W5, W10) cutover.

## Workstream checkpoints

| WS | Phase | Status | Notes |
|----|-------|--------|-------|
| W0 | A | ✅ done | Feature flags `ALLOWME_LEDGER_MODE`, `ALLOWME_AUTO_SETTLE_DISABLED` in `engine/ledger.ts`. |
| W1 | A | ✅ done | `LedgerEntrySchema` + `FilesystemLedger` + `splitAchievement` / `buildLedgerEntriesForAchievement`. JSONL at `data/families/<id>/ledger.jsonl`. `ledger-module.test.ts`. |
| W2 | A | ✅ done | Dual-write from `verify-achievement`. Idempotent via `findBySourceId`. `verify-achievement-dual-write.test.ts`. |
| W9 | A | ✅ done | One-shot migration `scripts/migrate-achievements-to-ledger.ts`. Dry-run + idempotent. `migrate-achievements-to-ledger.test.ts`. |
| — | — | ⬜ deploy-gated | **Phase A soak ≥24h** before Phase B merges (G3). |
| W6 | B | ✅ done | `settle-balance` MCP tool. RBAC manager + learner-self. Per-destination batching. Allowlist pre-flight. `settle-balance.test.ts`. |
| W7 | B | ✅ done | Auto-settle job `jobs/auto-settle.ts`. `autoSettleWeekly` policy field. Sunday 00:00 UTC via `railway.toml`. `auto-settle.test.ts`. |
| W8 | B-C | ✅ done | Retry-then-abandon (3 retries) + Sentry escalation + `classifyFailure`. |
| — | — | ⬜ deploy-gated | **Phase B soak ≥24h** with `settle-balance` exercised on staging before Phase C merges. |
| W3 | C | ✅ done | `distribute-allowance` → ledger-only. `Achievement.ledgerized=true`. Copy §10.1/§10.2. |
| W4 | C | ✅ done | `release-savings` → ledger-only. Writes `savings-release` entries. |
| W5 | C | ✅ done | `settle-session-payout` → ledger-only. Writes `session-payout` entries. `phase-c-ledger-only.test.ts` covers W3–W5. |
| W10 | C | ✅ done | Rich-card copy in `check-progress` + `check-savings` (wallet/pending rows, manager/kid forks, auto-settle countdown). `utils/usdc-balance.ts` `balanceOf` RPC (best-effort, null-tolerant). `ux-copy-w10.test.ts` LS61–LS65. |
| — | — | ⬜ deploy-gated | `docs/SETTLEMENT.md` ships with Phase C. |

Legend: ⬜ pending · 🟡 in progress · ✅ done · ⛔ blocked · 🔄 needs revisit

## Pre-flight gates

- [ ] G1 — Sprint 4.0.2 dashboards verified reporting (W0 precondition).
- [ ] G2 — Sprint 4.0.1 policy engine `checkDestination` API surface confirmed (W6 precondition; spike if drift detected per `contract.md` §7 rule 6).
- [ ] G3 — W9 migration dry-run clean on production-shape staging data before Phase A merges.
- [x] G4 — LS-PERF-1 + LS-PERF-2 green (`tests/bench/settle-balance-gas.test.ts`, `tests/bench/ledger-read.test.ts`). LS-PERF-2 is a soft Sprint-4.4 trigger signal (warns over 100ms target; hard-fails only on O(n²) regression).
- [ ] G5 — Pilot family acceptance (MV1–MV4 / SC11 / C8) signed off in writing before Phase C deploy.

## Regression bar (run between every workstream transition)

- [ ] `tsc --noEmit` clean
- [ ] Full pre-4.0.3 vitest suite green
- [ ] No edits to pre-existing test logic (only allowed: new ledger fixtures)
- [ ] LS-COV-1 thresholds met for any module touched in current workstream

## Failed Approaches

- [2026-06-01] [LS-PERF-1] asserted `payload.settled === 14` → wrong: `settled` counts settlement *transactions* (groups), not entries → assert `payload.settled === 2` + `ledger.listSettled()` has 14 (that 14→2 collapse IS the gas win).
- [2026-06-01] [LS-PERF-2] hard `expect(p95).toBeLessThan(100)` flaked under `--coverage` (v8 instruments ledger.ts ~3×: 41ms→131ms) → contract §6 says it's a SOFT trigger, not a hard gate → warn over 100ms target, hard-fail only >300ms.

## Decisions revised in-flight

*(none yet — record any deviation from `plan.md` §5 D1–D8 here with rationale)*

## Open spike findings

*(none yet — append `research.md` §5 with full results; one-line summary here)*

## Working notes

- **W10 (2026-05-31):** `buildCheckProgressRichMarkdown` extended with optional `walletBalanceMicro` / `pendingLedgerMicro` / `autoSettleOn` / `nextSundayDays` / `role` (backward-compatible). Enrichment gated on `isLedgerWriteEnabled()` so legacy deploys skip the per-call RPC. Wallet row omitted (not $0.00) when `balanceOf` returns null — preserves the "earned never decreases" UX principle during RPC outages. `daysUntilNextSundayUtc()` drives the auto-settle countdown copy ("Sunday (in N days)" vs "tonight").
- Copy-reference `**bold:**` wraps the colon, so copy regexes use `.*` not `\s*` between label and amount.
- **Fail-forward (2026-06-01):** BUG-2 (LS-COV-1) closed — `ledger.ts` 100/100/100, `settle-balance.ts` 100 stmt / 98.77 br / 100 fn / 100 ln (only flow-guaranteed defensive nullish at L562–573 remain, ≥95% gate). Added `tests/ledger-coverage.test.ts` + `tests/settle-balance-coverage.test.ts` (new tests only). Removed dead `?? 0` at `ledger.ts` markFailed (schema guarantees `retryCount: number`). Gate wired into `vitest.config.ts` thresholds. BUG-1 (LS-PERF-1/2) closed per above.
- Known: `tests/allowlist-enforcement.test.ts` has a pre-existing fixture typing issue (`title` field, missing `score`/`policyVersion`/`autoSettleWeekly`) surfaced only by the IDE's tests-inclusive tsconfig; build `tsc` and vitest both pass. Out of W10 scope — flag for a fixture-cleanup pass.
