# Sprint 4.0.3 — Sprint Contract (Phase 1.5)

**Status:** Derived from existing [`research.md`](./research.md), [`plan.md`](./plan.md), [`test.md`](./test.md), and [`Copy-reference.md`](./Copy-reference.md). Pending user confirmation.
**Inputs:** `research.md` v1.0 (all 8 open questions §5 resolved), `plan.md` v1.0 (W0–W10, D1–D8, SC1–SC11), `test.md` v1.0 (LS1–LS65 + LS-PERF-1/2 + LS-COV-1 + MV1–MV4), `Copy-reference.md` v1.0 (load-bearing UX source-of-truth).
**Sprint type:** Backend refactor + UX migration. Decouples earning recognition (`verify-achievement` → ledger write) from on-chain settlement (`settle-balance` → only path to chain).
**Sprint class:** **Data-integrity + UX migration.** Not custody-touching like 4.0.1 (signing path unchanged, reuses `WalletDistributor` agent-mode). Load-bearing failure modes are (a) money diverging between ledger and chain, (b) kid/parent mental-model breaking on the "earned vs spendable" distinction. Rubric is weighted toward Functionality + Design/UX accordingly.

---

## 1. Phase 0a — Problem framing (recorded inline)

**Problem statement.** `distribute-allowance` ([`src/tools/distribute-allowance.ts`](../src/tools/distribute-allowance.ts)) couples three concerns into one operation: earning recognition, savings split, and on-chain settlement. Each per-child distribution is 2 on-chain transactions minimum; at the Sprint 4.4 target scale (5,000 families × ~2 children × 52 weeks) this is ~1.04M tx/year ≈ ~$5,200/year in gas. Worse, partial failures (savings transfer succeeds, wallet transfer fails) silently mark the achievement as `distributed: true` regardless, producing ledger-vs-chain divergence. And the Sprint 3.0.2 destination allowlist check fires *after* `transferUSDC` returns — meaning a denied transfer still burned gas.

**"What is" statement.** Today, every verify → distribute call broadcasts 2× per child. The savings split is computed at distribute time using the *current* `savingsPercent`, meaning a parent who edits the policy retroactively reshapes pending savings allocations. There is no retry mechanism. There is no kid-facing settlement agency. There is no off-chain ledger; on-chain receipts are the system of record. The `Achievement.distributed` boolean conflates "credited" and "settled."

**Solution hypothesis.** Introduce `LedgerEntry` as the unit of "money owed but not yet on-chain." `verify-achievement` writes both the `Achievement` (existing) AND the corresponding LedgerEntries (new) with `status: "pending"` and the savings split locked in *at earn time*. `distribute-allowance`/`release-savings`/`settle-session-payout` become ledger-only (no broadcast). A new tool `settle-balance` is the ONLY path to chain: it reads pending entries, groups by destination, runs the OWS policy-engine allowlist check *pre-broadcast*, and issues one `transferUSDC` per destination. Kid-role learners can self-settle their own balance (RBAC). An opt-in weekly auto-settle policy (Sunday 00:00 UTC) bridges the UX regression for parents who liked implicit settlement. Three-phase migration (A: dual-write, B: introduce settle-balance, C: cutover) with ≥24h soak between phases and per-phase feature-flag rollback (`ALLOWME_LEDGER_MODE`).

**Scope boundary.** Four observable outcomes, full stop:
1. Every `verify-achievement` produces both an Achievement AND LedgerEntries with the correct split (SC1).
2. Post-cutover, `settle-balance` is the only path to chain (SC2 + SC3).
3. Per-family per-week gas drops by ≥80% vs the pre-sprint baseline (SC4).
4. Kids understand the new earned/spendable/pending model without explanation (SC11, validated by pilot family).

Anything that doesn't move one of those four outcomes is deferred (see plan §2 Non-goals).

---

## 2. Scope

**In scope.** Eleven workstreams across three phases, locked per [`plan.md`](./plan.md) §4:

1. **W0 — Feature flags + dashboard precondition.** `ALLOWME_LEDGER_MODE` (`dual-write` | `settle-enabled` | `ledger-only`, default `dual-write`) and `ALLOWME_AUTO_SETTLE_DISABLED` (default `false`). Sprint 4.0.2 dashboards verified live.
2. **W1 — `LedgerEntry` schema + `FilesystemLedger` engine module** ([`src/schemas.ts`](../src/schemas.ts), new [`src/engine/ledger.ts`](../src/engine/ledger.ts)). JSONL persistence at `data/families/<id>/ledger.jsonl` (matches Sprint 4.0.2 audit-log format). Helpers `splitAchievement`, `buildLedgerEntriesForAchievement`. Public `LedgerStore` interface: `append`, `listPending`, `listFailed`, `markSettled`, `markFailed`, `findBySourceId`.
3. **W2 — Dual-write from `verify-achievement`** ([`src/tools/verify-achievement.ts`](../src/tools/verify-achievement.ts)). Idempotent via `sourceId` dedup against `findBySourceId`.
4. **W3 — `distribute-allowance` → ledger-only (Phase C)** ([`src/tools/distribute-allowance.ts`](../src/tools/distribute-allowance.ts)). Zero on-chain action. New `Achievement.ledgerized: boolean` field; `distributed` deprecated post-cutover.
5. **W4 — `release-savings` → ledger-only (Phase C)** ([`src/tools/release-savings.ts`](../src/tools/release-savings.ts)). Writes `kind: "savings-release"` entries; no broadcast.
6. **W5 — `settle-session-payout` → ledger-only (Phase C)** ([`src/tools/settle-session-payout.ts`](../src/tools/settle-session-payout.ts)). Writes `kind: "session-payout"` entries; no broadcast. Sprint 4.0 Learning Mode kid-facing flow unchanged.
7. **W6 — New `settle-balance` tool (Phase B)** (new [`src/tools/settle-balance.ts`](../src/tools/settle-balance.ts)). RBAC: manager + learner (learner scoped to own `childName` via middleware). Inputs: `childName?`, `dryRun?`. Pre-flight allowlist check via Sprint 4.0.1 policy engine. Groups by destination, one `transferUSDC` per destination, marks settled with shared `settlementBatchId`. Creates `SavingsEntry` records lazily when settling `savings-deposit` entries.
8. **W7 — Weekly auto-settle job (Phase B)** (new `src/jobs/auto-settle.ts`). Sunday 00:00 UTC via Railway scheduled task (not in-process `node-cron`). Opt-in via new `autoSettleWeekly: boolean` field on family policy (default `false`). Respects `ALLOWME_AUTO_SETTLE_DISABLED` env kill switch.
9. **W8 — Failure recovery / retry-then-abandon (Phase B-C).** `LedgerEntry.retryCount` (default 0). After 3 retries with same `failureReason`, mark `status: "abandoned"`, fire Sentry event with family_id + reason. `failureReason` classifier: `policy_denied`, `insufficient_gas`, `rpc_timeout`, `chain_reorg`, fallback to raw message.
10. **W9 — One-shot migration script (Phase A)** (new `scripts/migrate-achievements-to-ledger.ts`). Reads `Achievement.distributed = false`, writes corresponding LedgerEntries, idempotent via `findBySourceId`. Dry-run mode. Handles 1000+ achievements without OOM.
11. **W10 — Rich-card copy (Phase C)** ([`src/tools/check-progress.ts`](../src/tools/check-progress.ts), [`src/tools/check-savings.ts`](../src/tools/check-savings.ts), [`src/tools/settle-balance.ts`](../src/tools/settle-balance.ts)). Implements every string in `Copy-reference.md` §3–§13. Adds `fetchWalletUsdcBalance(childWallet)` RPC call to `check-progress` (one ERC-20 `balanceOf` per call). All copy variants × role × auto-settle × pending-state combinations rendered.

**Out of scope (deliberate, with reason — evaluator MUST NOT penalize):**
- **ERC-4337 / smart-account batching** — deferred to Sprint 4.5 (research §6.1). Per-destination batching alone delivers the SC4 ≥80% gas reduction.
- **State channels** — rejected (research §6.2). Wrong tool for low-frequency macropayments.
- **Cross-sibling multicall** — deferred. One tx per destination is sufficient for SC4.
- **Renaming `distribute-allowance`** — semantic change yes (D5), name change no. Claude assistant prompt-pattern blast radius is too high.
- **Pre-cutover flash-settlement** — rejected (research §5.5). Combining code change with mass on-chain activity is a high-risk deploy.
- **Backfilling LedgerEntries for already-`distributed: true` achievements** — they're already on-chain; the ledger doesn't owe them anything.
- **Postgres migration of ledger** — Sprint 4.4. LS-PERF-2 (10k entries p95 < 100ms) is the trigger signal to accelerate if needed.
- **Reconciliation job (on-chain ↔ ledger)** — Sprint 4.4. Until then, the Sprint 4.0.2 audit log is the manual reconciliation surface.
- **Auto-settle notification surface (email/push)** — out of 4.0.3 scope. Copy §11.3/§11.4 specified for future use; no UI surface ships in this sprint.
- **Localization** — English only. Copy structured for future es-419 / es-DO substitution (`Copy-reference.md` §15).
- **Removing `Achievement.distributed`** — kept post-cutover for backward read compatibility; removal is a future cleanup sprint.

---

## 3. Deliverables

| ID | Deliverable | File(s) | Workstream | Test IDs |
|----|-------------|---------|------------|----------|
| DEL1 | `LedgerEntrySchema` + `LedgerEntry` type | [`src/schemas.ts`](../src/schemas.ts) | W1 | LS1 |
| DEL2 | `FilesystemLedger` class implementing `LedgerStore` interface (JSONL persistence, atomic append, restart-durable) | new [`src/engine/ledger.ts`](../src/engine/ledger.ts) | W1 | LS7, LS8, LS9, LS10 |
| DEL3 | `splitAchievement` + `buildLedgerEntriesForAchievement` helpers (exact floor-rounded splits, 0%/100% edge cases) | [`src/engine/ledger.ts`](../src/engine/ledger.ts) | W1 | LS2, LS3, LS4, LS5, LS6 |
| DEL4 | `verify-achievement` dual-write (gated on `ALLOWME_LEDGER_MODE !== "off"`, idempotent via `sourceId`) | [`src/tools/verify-achievement.ts`](../src/tools/verify-achievement.ts) | W2 | LS11, LS12, LS13 |
| DEL5 | `distribute-allowance` Phase C rewrite (zero on-chain; sets `Achievement.ledgerized: true`; new copy §10.1/§10.2) | [`src/tools/distribute-allowance.ts`](../src/tools/distribute-allowance.ts) | W3 | LS14, LS15 |
| DEL6 | `release-savings` Phase C rewrite (writes `savings-release` ledger entries; no broadcast) | [`src/tools/release-savings.ts`](../src/tools/release-savings.ts) | W4 | LS18 |
| DEL7 | `settle-session-payout` Phase C rewrite (writes `session-payout` entries; no broadcast; kid Learning Mode copy unchanged) | [`src/tools/settle-session-payout.ts`](../src/tools/settle-session-payout.ts) | W5 | LS19, LS20 |
| DEL8 | New `settle-balance` MCP tool — happy path, dry-run, RBAC, per-destination batching, batchId propagation | new [`src/tools/settle-balance.ts`](../src/tools/settle-balance.ts) | W6 | LS16, LS17, LS21, LS22, LS23, LS24, LS25, LS26, LS27, LS28, LS29, LS30 |
| DEL9 | `settle-balance` allowlist pre-flight integration with Sprint 4.0.1 policy engine | [`src/tools/settle-balance.ts`](../src/tools/settle-balance.ts) | W6 | LS31, LS32, LS33 |
| DEL10 | `settle-balance` failure classifier + retry/abandon semantics (3 retries → abandoned + Sentry) | [`src/tools/settle-balance.ts`](../src/tools/settle-balance.ts), [`src/engine/ledger.ts`](../src/engine/ledger.ts) | W8 | LS41–LS50 |
| DEL11 | Auto-settle job + Sunday 00:00 UTC scheduler + `autoSettleWeekly` policy field + `ALLOWME_AUTO_SETTLE_DISABLED` kill switch | new `src/jobs/auto-settle.ts`, [`src/schemas.ts`](../src/schemas.ts), Railway scheduled-task config | W7 | LS51, LS52, LS53, LS54, LS55 |
| DEL12 | One-shot migration script (idempotent, dry-run, 1000+ achievement scale) | new `scripts/migrate-achievements-to-ledger.ts` | W9 | LS56, LS57, LS58, LS59, LS60 |
| DEL13 | `check-progress` rich-card copy — kid/manager × auto-settle on/off × pending > 0 / pending = 0, includes wallet `balanceOf` RPC | [`src/tools/check-progress.ts`](../src/tools/check-progress.ts) | W10 | LS61, LS62, LS63 |
| DEL14 | `check-savings` rich-card copy — locked/released/pending three-row layout | [`src/tools/check-savings.ts`](../src/tools/check-savings.ts) | W10 | LS64 |
| DEL15 | `settle-balance` response copy — all success/failure variants per `Copy-reference.md` §7–§9 | [`src/tools/settle-balance.ts`](../src/tools/settle-balance.ts) | W10 | LS28, LS29, LS65 |
| DEL16 | LS-COV-1 coverage gate — `src/engine/ledger.ts` 100% branches/functions/lines, `src/tools/settle-balance.ts` ≥95% branches, 100% functions, ≥95% lines | `vitest.config.ts` | continuous | LS-COV-1 |
| DEL17 | LS-PERF-1 gas-reduction benchmark — 7-day kid week, post-cutover ≤2 tx vs pre-cutover 14 tx (≥85% reduction) | new `tests/bench/settle-balance.bench.ts`, baseline JSON | W10 | LS-PERF-1 |
| DEL18 | LS-PERF-2 ledger read benchmark — `listPending` p95 < 100ms at 10k entries (Sprint 4.4 acceleration trigger) | new `tests/bench/ledger-read.bench.ts` | W1 | LS-PERF-2 |
| DEL19 | `progress.md` updated at every workstream checkpoint (W0 → W10), with "Failed Approaches" section ≤10 lines per Harness v3 failure protocol | [`sprint-4.0.3/progress.md`](./progress.md) | continuous | n/a |
| DEL20 | `docs/SETTLEMENT.md` documenting the new flow for end users (post-cutover) | new `docs/SETTLEMENT.md` | W10 | n/a |

---

## 4. Verification criteria

Twelve criteria, evaluator-verifiable from the deployed build + test output alone (no `progress.md` reads).

### Functionality (40% rubric weight)

**C1 — `LedgerEntry` schema + `FilesystemLedger` round-trips.** `LedgerEntrySchema.parse` validates required fields. `FilesystemLedger.append → listPending` round-trips with exact equality. `markSettled` populates `status: "settled"`, `txHash`, `settledAt`, `settlementBatchId`. `findBySourceId` returns all entries with matching `sourceId`. Entries persist across process restart (read fresh instance, same dir). *Locked by `LS1`, `LS7`, `LS8`, `LS9`, `LS10`.*

**C2 — Savings split is exact and locked at earn time.** `splitAchievement(1_000_001, 20)` returns `{ childMicros: 800_001, savingsMicros: 200_000 }` (floor on savings, child gets remainder). `splitAchievement(N, 0)` → all to child. `splitAchievement(N, 100)` → all to savings. `buildLedgerEntriesForAchievement` returns 2 entries on a non-zero split, 1 entry on a zero-side split. Split percentage applied is the value at *write time* (verify-achievement time), never recomputed at settlement. *Locked by `LS2`, `LS3`, `LS4`, `LS5`, `LS6`.*

**C3 — Dual-write correctness + idempotency.** With `ALLOWME_LEDGER_MODE !== "off"`, every `verify-achievement` call produces exactly one `Achievement` AND the exact set of LedgerEntries from `buildLedgerEntriesForAchievement` (sum of `amountUsdcMicros` matches `achievement.amountUsdcMicros`). A retry call with the same `sourceId` does NOT duplicate ledger entries. Pre-sprint test suite passes with `ALLOWME_LEDGER_MODE=dual-write`. *Locked by `LS11`, `LS12`, `LS13`.*

**C4 — Post-cutover, settlement decoupled from earning.** In `ALLOWME_LEDGER_MODE=ledger-only`, `WalletDistributor.prototype.transferUSDC` is NOT called by `verify-achievement`, `distribute-allowance`, `release-savings`, or `settle-session-payout`. The same spy IS called by `settle-balance`. `Achievement.ledgerized: true` is set after `distribute-allowance`. `release-savings` produces `kind: "savings-release"` entries; `settle-session-payout` produces `kind: "session-payout"` entries. `settle-balance` audit-log entries carry `settlementBatchId`. *Locked by `LS14`, `LS15`, `LS16`, `LS17`, `LS18`, `LS19`, `LS20`, `LS30`.*

**C5 — `settle-balance` happy path + dry-run + family/child scoping.** Multi-entry settlement to N destinations issues exactly N `transferUSDC` calls (one per destination), with amounts equal to the per-destination sum. All settled entries share one `settlementBatchId`. `dryRun: true` returns a preview AND does NOT call `transferUSDC`. `settle-balance` with no `childName` settles all children in the family. Empty-pending returns a friendly empty-state response (no "error" language). *Locked by `LS21`, `LS26`, `LS27`, `LS28`, `LS29`.*

**C6 — Migration W9 is idempotent and scales.** Migration script writes 2 ledger entries per undistributed achievement (for a non-zero split). Achievements with `distributed: true` are NOT migrated. Re-running the migration 3× produces the same entry count as 1×. 1000 achievements process without OOM in <60s. `--dry-run` reports `wouldCreate` count without writing. *Locked by `LS56`, `LS57`, `LS58`, `LS59`, `LS60`.*

### Design / UX (25% rubric weight)

**C7 — Copy variants render correctly across role × auto-settle × pending state.** `check-progress` kid-facing shows `Earned this week`, `In your wallet: $X.XX`, `Pending settlement: $X.XX — run **settle-balance**` (manual) or `auto-settles Sunday (in N days)` (auto-settle on). Manager-facing shows `auto-settle` reference. `check-savings` kid-facing shows three rows: `Locked`, `Released`, `Pending`. Empty pending omits the pending row entirely (never shows `Pending: $0.00`). Nothing-to-settle response uses friendly empty-state language (no "error" / "fail" / "problem"). Every string matches `Copy-reference.md` verbatim. *Locked by `LS28`, `LS29`, `LS61`, `LS62`, `LS63`, `LS64`, `LS65`.*

**C8 — Pilot family acceptance (SC11).** One parent + one kid use the deployed Phase C build for ≥3 days. Self-report (signed off in writing): kid understands `earned` vs `in your wallet` vs `pending` without explanation; parent does not file a "where's my money" support ticket; allowlist failure scenario (MV2) produces an actionable error in staging. *Locked by `MV1`, `MV2`, `MV3`, `MV4`.*

### Auth / Security (15% rubric weight)

**C9 — RBAC: learner self-settle scoping (SC6 + SC7).** Role `learner` calling `settle-balance` with no `childName` succeeds and settles only their own `callerChildName` entries. Role `learner` calling `settle-balance { childName: "Diego" }` from `callerChildName: "Maya"` returns `isError: true` with text containing "cannot settle for another child". Roles `family` and `advisor` are rejected entirely. *Locked by `LS22`, `LS23`, `LS24`, `LS25`.*

**C10 — Allowlist pre-flight check, no gas burned on rejected settle (SC5).** `settle-balance` against a destination NOT in the Sprint 3.0.2 allowlist:
1. Does NOT call `transferUSDC` (spy assertion).
2. Returns a response with text matching "not on the authorized" and pointing to `configure-policy` (manager) or "ask a parent" (kid).
3. Pending entries are preserved with `status: "pending"` (NOT marked failed, NOT marked settled).
4. The failing destination address appears in the error message.

The treasury wallet's nonce is unchanged before/after the rejected call (pre-broadcast policy gate, not post-broadcast revert). *Locked by `LS31`, `LS32`, `LS33`. **Critical:** if the nonce moved on a rejected destination, the policy gate was bypassed and the sprint fails regardless of any other criterion.*

### Performance (10% rubric weight)

**C11 — Gas reduction (SC4) + ledger read perf.** LS-PERF-1: a 7-day simulated kid week (7 verify-achievement calls, each producing 2 ledger entries) is settled by exactly 1 `settle-balance` call that issues ≤2 `transferUSDC` calls (one wallet, one savings). The reduction `(14 − 2) / 14 = 85.7%` meets the SC4 ≥80% threshold. LS-PERF-2: `FilesystemLedger.listPending` p95 latency at 10,000 entries in a single family file is < 100ms (Sprint 4.4 acceleration signal). *Locked by `LS-PERF-1`, `LS-PERF-2`.*

### Failure recovery + auto-settle + regression (cross-cutting)

**C12 — Retry/abandon + auto-settle + coverage + regression.**
- Failed entries with same `failureReason` retry on subsequent `settle-balance` calls; after exactly 3 failed attempts mark `status: "abandoned"`. Sentry receives an event referencing the family_id. Abandoned entries are NOT re-picked-up by subsequent runs (manual operator only). Failure classifier maps gas → `insufficient_gas`, timeout → `rpc_timeout`, OWS policy → `policy_denied: recipient_not_authorized`, unknown → raw message preserved. *Locked by `LS41`–`LS50`.*
- Auto-settle runs only for families with `autoSettleWeekly: true`. `ALLOWME_AUTO_SETTLE_DISABLED=true` skips all. Scheduler config matches `0 0 * * 0` (Sunday 00:00 UTC). A failure in one family does not stop processing of others; the failed family appears in Sentry. Auto-settle invokes `settle-balance` with manager-equivalent context. *Locked by `LS51`–`LS55`.*
- LS-COV-1 coverage gate green: `src/engine/ledger.ts` 100% branches/functions/lines; `src/tools/settle-balance.ts` ≥95% branches, 100% functions, ≥95% lines.
- `tsc --noEmit` clean. All pre-4.0.3 tests pass. **The only allowed test-side modification is adding new ledger fixtures.** Any pre-existing test-logic edit is a sprint failure.

---

## 5. Rubric (Data-integrity + UX-migration class)

| Category | Weight | Definition | Locked criteria |
|----------|--------|------------|-----------------|
| Functionality | **40%** | Ledger schema correctness, exact savings splits, dual-write idempotency, post-cutover decoupling (only `settle-balance` reaches chain), happy-path settlement with per-destination batching + shared `settlementBatchId`, idempotent migration at scale | C1, C2, C3, C4, C5, C6 |
| Design / UX | **25%** | Every `Copy-reference.md` string deployed verbatim; copy variants render across role × auto-settle × pending-state; empty/nothing-to-settle copy is friendly not alarm-shaped; pilot family acceptance signed off | C7, C8 |
| Auth / Security | **15%** | Learner RBAC scoping (self only, never sibling); allowlist pre-flight check with nonce-unchanged invariant on rejected destinations | C9, C10 |
| Performance | **10%** | ≥80% gas reduction validated by LS-PERF-1; ledger read p95 < 100ms at 10k entries (LS-PERF-2 — Sprint 4.4 acceleration signal, not a fail gate) | C11 |
| Originality | **10%** | Phased dual-write soak (no shadow-mode); opt-in auto-settle as informed-consent (default off, research §3.5); `distribute-allowance` semantic-not-name change preserving Claude prompt patterns (D5); per-destination batching delivering SC4 without ERC-4337 dependency; reviewed in evaluation | reviewed |

**Why Functionality gets 40%:** The load-bearing failure mode of this sprint is **money diverging between ledger and chain** — a dual-write bug, a non-idempotent retry, a missed migration edge case, or a post-cutover broadcast leak from a legacy code path. Every one of those failures produces "where's my money" support tickets and damages family trust. Functionality criteria are how we catch them.

**Why Design/UX gets 25%:** Plan §10 explicitly calls W10 "load-bearing UX work." `Copy-reference.md` is structured as a source-of-truth document (code references the copy doc, not vice versa). The pilot family acceptance test (MV1 / SC11 / C8) is a hard merge gate for Phase C precisely because the kid mental-model rewrite is the most likely user-facing failure.

**Why Auth/Security only 15%:** The RBAC + allowlist surface is real but narrow. Custody and signing are unchanged from Sprint 4.0.1 (already-verified primitives). The new attack surface is "fraudulent pending entries" — and even a compromised ledger cannot invent allowlist destinations (research §7.2).

**Why Performance 10%:** SC4 is a real measurable target, but a soft-miss on gas reduction is recoverable and operationally non-urgent. A money-divergence bug is not.

---

## 6. Grading thresholds

- **Pass:** all of C1–C12 verified. Each rubric category at ≥75% of its weight. Backward-compat (C12 regression bar) green with zero test-logic edits to pre-existing tests. Pilot family acceptance (C8 / MV1–MV4) signed off. LS-PERF-1 gas reduction ≥80%. LS-COV-1 coverage gate met.
- **Fail:** any of C1–C7, C9, or C10 fails. OR `tsc --noEmit` errors. OR pre-existing test-logic was edited (only allowed change: new ledger fixtures). OR a post-cutover code path other than `settle-balance` is observed calling `transferUSDC` (C4 violation — settlement-decoupling regression). OR the C10 nonce-unchanged invariant fails on a rejected destination (policy bypass).
- **Soft fail (Pass-with-followup):**
  - LS-PERF-1 misses SC4's 80% target by ≤5 percentage points (e.g., lands at 75–79%) AND no other criterion failed → Pass with a Sprint 4.5 ticket to investigate.
  - LS-PERF-2 misses 100ms p95 by ≤30ms AND other Functionality criteria are clean → Pass with a Sprint 4.4 ticket to accelerate Postgres migration (this is exactly the intended trigger signal per `test.md` §12).
  - LS-COV-1 coverage below the locked thresholds by ≤2 points → Soft-fail-eligible ONLY if Functionality (C1–C6) AND Auth/Security (C9, C10) are fully clean.
  - C8 pilot acceptance produces "understandable with minor copy nits" rather than fully clean → Pass with copy-revision ticket; copy nits must be filed against `Copy-reference.md` first per its §16 approval flow.

---

## 7. Hand-off rules

1. Generator implements per [`plan.md`](./plan.md) §4 Workstreams AND this contract. Generator updates [`progress.md`](./progress.md) at every workstream checkpoint (W0 → W10), keeping the "Failed Approaches" section ≤10 lines per Harness v3 failure protocol.
2. Generator MUST read [`progress.md`](./progress.md) "Failed Approaches" before starting work each session. Repeating a documented failure is a rubric penalty.
3. **Phase ordering is strict and locked:** Phase A (W0, W1, W2, W9) → ≥24h soak in dual-write mode → Phase B (W6, W7, W8) → ≥24h soak with `settle-balance` available alongside legacy paths → Phase C (W3, W4, W5, W10) cutover. Skipping soak time is a rubric penalty in Originality + Functionality.
4. Generator MUST run the regression bar (pre-4.0.3 test suite) between every workstream transition. If anything goes red, stop and document in "Failed Approaches" before continuing.
5. Generator MUST NOT self-evaluate. The Evaluator (Phase 3) reads only this contract + the deployed build + test output — never `progress.md`.
6. **Spike before commit:** if at the start of W6 the Sprint 4.0.1 policy-engine `checkDestination` API surface is missing or has unexpected behavior on the new `settle-balance` call path, run a 30-min timeboxed spike before committing. Append findings to [`research.md`](./research.md) §5 (open questions) under a new sub-section.
7. **Copy-reference is source of truth.** Any post-approval copy change requires editing `Copy-reference.md` FIRST, then the code. Direct code edits to user-visible strings without a corresponding `Copy-reference.md` update are a Design/UX rubric penalty.
8. **Pre-cutover checklist (Phase C gate)** must be green before W3/W4/W5/W10 merge to main: Phase A soaked ≥24h, Phase B soaked ≥24h with `settle-balance` exercised on staging, W9 migration dry-run clean on production data, LS-PERF-1 + LS-PERF-2 green on nightly, pilot family acceptance test (C8) signed off.

---

## 8. Out-of-scope reminders (so the evaluator doesn't penalize their absence)

The evaluator MUST NOT mark Fail for any of:
- ERC-4337 / smart-account migration not implemented (research §6.1 — deferred to 4.5).
- State channels not implemented (research §6.2 — rejected).
- Cross-sibling multicall batching not implemented (D3 — deferred).
- `distribute-allowance` not renamed (D5 — semantic-not-name change is intentional).
- Pre-cutover flash-settlement not implemented (research §5.5 — rejected).
- Already-`distributed: true` achievements not backfilled into ledger (research §5.4 — already on-chain).
- Postgres migration of `ledger.jsonl` not done (Sprint 4.4 — LS-PERF-2 is the trigger signal).
- On-chain ↔ ledger reconciliation job not implemented (Sprint 4.4).
- Auto-settle email/push notifications not implemented (out of 4.0.3 scope; copy specified for future).
- Localization (es-419 / es-DO) not implemented (out of 4.0.3; copy structured for future substitution).
- `Achievement.distributed` field not removed (kept for backward read compat).
- Per-role / per-wallet settle scoping beyond manager + learner-self (out of scope).

---

## 9. Risks acknowledged (mirror plan §7)

R1 (kid-facing copy confuses parents into "where's my money") → C7 + C8 + `Copy-reference.md` §16 approval flow + revertable copy via W10 rollback row in plan §10.
R2 (LedgerEntry-to-Achievement divergence after a process crash) → C3 idempotency via `sourceId`; reconciliation deferred to Sprint 4.4 (acknowledged limitation).
R3 (auto-settle hits misconfigured allowlist and silently fails) → opt-in default-off (D4); 3-retry-then-Sentry escalation (C12).
R4 (`settle-balance` becomes new bottleneck at peak settlement) → per-destination batching delivers SC4 without multicall; Sprint 4.0.2 observability flags hotspot.
R5 (`ledger.jsonl` grows unboundedly) → LS-PERF-2 is the explicit Sprint 4.4 trigger signal.
R6 (kid self-settles before parent reviews achievement) → `Achievement.verified-by-manager` gate stays in place upstream of ledger writes.
R7 (cross-sibling order-of-settlement creates fairness perception) → deterministic ordering by `childName`, documented.
R8 (Phase A dual-write doubles I/O) → Sprint 4.0.2 OB-PERF-1 baseline; `ALLOWME_LEDGER_MODE=off` rollback flag.
R9 (W9 migration misses an edge case and pending state is lost) → idempotent + dry-run mode + ≥24h Phase A soak before Phase B.
R10 (Phase C cutover races with in-flight `distribute-allowance` calls) → W9 migration handles backlog; Phase A soak time mitigates.
R11 (`balanceOf` call in `check-progress` hits RPC rate limits) → caching layer (out of scope) or fallback to ledger-only display.

---

## 10. Status

- Contract version: 1.0
- Approval: **pending user confirmation**
- Generator entry point on approval: **W0** (feature flags + dashboard precondition) per [`plan.md`](./plan.md) §4
- Phase ordering: **A → 24h soak → B → 24h soak → C** (locked, see §7 hand-off rule 3)
- Evaluator entry point on Generator hand-off: this contract + deployed build + test output only
