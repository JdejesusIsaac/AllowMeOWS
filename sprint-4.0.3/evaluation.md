# Sprint 4.0.3 — Evaluation Report (CA-1 re-evaluation)

> **Phase 3 / Evaluator.** Structurally independent: graded against
> [`contract.md`](./contract.md) + the deployed build + test output only.
> `progress.md` was not read.
>
> **Revision:** v2 — re-issued after Contract Amendment
> [`CA-1`](../contact-Amendment.md). v1 verdict was FAIL with blockers
> BUG-1, BUG-2, BUG-3, and the C8 deploy gate. CA-1 reclassifies BUG-3.
> Mode: **read-only** (no `git stash`/`checkout`; user-directed).

---

## 0. Verdict

**FAIL** — but the blocking set is reduced from v1.

- **Blocking (load-bearing):** BUG-1 (LS-PERF-1/2 do not exist), BUG-2 (LS-COV-1 gate unwired + coverage below threshold).
- **Reclassified by CA-1 Part A → permitted, non-blocking:** BUG-3a.
- **Hygiene finding (CA-1 Part B), non-blocking:** BUG-3b.
- **Deploy-gated, non-code:** C8 pilot acceptance (MV1–MV4).
- **New process finding:** no per-sprint commit boundary (PF-1).

The load-bearing money-integrity surface (Functionality 40% + Auth/Security 15% + the C7 copy work) is **clean and verified**. The failure is in verification scaffolding (perf benches, coverage gate) and a deploy-gated manual sign-off.

---

## 1. Pre-grade working-tree gate (CA-1 Part C / C.3)

CA-1 §C requires the Evaluator to grade exactly `git diff <prev-sprint-HEAD>` and halt on out-of-scope changes. **This gate cannot be satisfied as written**, recorded as **PF-1**:

- `HEAD = ce4b679 (sprint-4.0)`. No tags. No commits since.
- Sprint 4.0.1 + 4.0.2 + 4.0.3 are **all uncommitted in one working tree**, so `git diff sprint-4.0` is the combined diff of three sprints — there is no `prev-sprint-HEAD` for 4.0.3 (the 4.0.2 cutover commit was never made).

Per the user's read-only directive, the prescribed quarantine (Part B git mechanics) and the literal diff-isolation (Part C) are **deferred-by-user-choice**. Grading proceeds by **file + comment-label attribution** instead, and PF-1 is surfaced to the planner: CA-1 §C is unenforceable until per-sprint commit/tag boundaries exist.

---

## 2. Rubric scorecard

| Category | Weight | Result | Basis |
|----------|--------|--------|-------|
| Functionality | 40% | **PASS (~40/40)** | C1–C6 verified green |
| Design / UX | 25% | **PARTIAL** | C7 verified; C8 deploy-gated, unsigned |
| Auth / Security | 15% | **PASS (15/15)** | C9, C10 verified incl. nonce invariant |
| Performance | 10% | **FAIL (0/10)** | LS-PERF-1 & LS-PERF-2 absent (BUG-1) |
| Originality | 10% | **PASS (~10/10)** | Phased dual-write, opt-in auto-settle (default off), semantic-not-name change, per-destination batching |

Against `contract.md` §6: C1–C7/C9/C10 all pass, `tsc` clean, no C4 broadcast leak, no C10 nonce bypass — so the hard auto-FAIL clauses are NOT triggered. The FAIL is driven by the unmet Pass-gates: LS-PERF-1 ≥80% (absent), LS-COV-1 (unmet), C8 (unsigned).

---

## 3. Verified clean (no action)

- **C1–C6 (Functionality):** `ledger-module`, `verify-achievement-dual-write`, `phase-c-ledger-only`, `settle-balance`, `migrate-achievements-to-ledger` all green. Exact splits, dual-write idempotency (`findBySourceId`), idempotent migration.
- **C4 (decoupling):** `phase-c-ledger-only.test.ts` asserts `transferUSDC` is never called by `distribute-allowance`, `release-savings`, or `settle-session-payout` in `ledger-only`; only `settle-balance` broadcasts. Entry kinds (`savings-release`, `session-payout`) verified.
- **C9/C10 (Auth):** LS22–25 (learner self-scope; sibling block returns "cannot settle for another child"); LS31–33 (allowlist pre-flight, entries remain `pending`, failing address shown, `configure-policy` route). Nonce-unchanged invariant satisfied transitively — `transferSpy` is never invoked on a rejected destination.
- **C7 (Copy):** LS61–65 green; wallet/pending rows, manager vs kid forks, auto-settle countdown.
- `tsc --noEmit` clean. Full suite **666 passed / 0 failed / 3 skipped / 2 todo**.

---

## 4. CA-1 classifications

### BUG-3a — RATIFIED PERMITTED (CA-1 Part A.1)
Removed from the blocking set.

- `tests/http-transport.test.ts`: `expect(managerTools.length).toBe(18)` → `toBe(19)`, plus `settle-balance` added to the free-tools list. → **Permitted A.1(a)**: count/enumeration assertion changing *solely* because W6 registers the `settle-balance` tool.
- `tests/state-manager.test.ts`: lazy-migration round-trip expectation gains `autoSettleWeekly: false`. → **Permitted A.1(b)**: serialization assertion changing *solely* because W7 adds a persisted field with a specified default. (Mirrors the documented 3.0.2 / 3.0.6 precedent in the same comment block.)

Neither alters what any assertion proves; both are strictly entailed by mandated deliverables.

### BUG-3b — HYGIENE FINDING (CA-1 Part B), non-blocking
Not ratified; not a carve-out.

- `tests/allowlist-enforcement.test.ts` and `tests/session-lifecycle.test.ts` add `family-api-tokens.js` mocks and change the `initializeFamily` mock return shape, **labeled "Sprint 4.1"** (= Sprint 4.0.1 under the current renaming).
- **Read-only load-bearing assessment (substitutes for B.2 step 4):** `src/keys/family-api-tokens.ts` is real Sprint-4.0.1 agent-mode code that `distribute-allowance`, `release-savings`, `settle-session-payout`, and `settle-balance` all import, and that `configureFamilyCore` instantiates. Reverting these mocks would route those tests through real `FamilyApiTokenManager` / `lazyMintTokenForLegacyFamily` (scrypt + OWS `createApiKey` + fs writes) that the tests do not set up. **Therefore the mocks are load-bearing relative to the current commingled tree.**
- **CA-1 B.2-step-4 implication:** the green suite depends on un-isolated Sprint-4.0.1 production code being present. This is precisely the sequencing/commingling signal CA-1 Part B + PF-1 describe. The definitive quarantine-and-rerun is **deferred-by-user-choice** (read-only).
- Per CA-1 §B.4, the 4.0.3 FAIL stands regardless of BUG-3b disposition.

---

## 5. Remaining bug reports (blocking)

### BUG-1 — LS-PERF-1 & LS-PERF-2 benchmarks do not exist (C11, DEL17, DEL18)
- **Expected:** a gas-reduction bench proving ≥80% (14 tx → ≤2 tx), and a ledger-read bench proving `FilesystemLedger.listPending` p95 < 100ms at 10k entries.
- **Actual:** `tests/bench/` holds only `distributor-bench.test.ts`, `distributor.bench.ts`, `scrypt-counter.test.ts` (Sprint 4.0.1/4.0.2). `grep -r "LS-PERF" tests/` → no matches.
- **Impact:** Performance category → 0/10. `contract.md` §6 Pass requires "LS-PERF-1 gas reduction ≥80%." SC4 is unverifiable.

### BUG-2 — LS-COV-1 coverage gate unwired and below threshold (C12, DEL16)
- **Expected:** `vitest.config.ts` enforces `src/engine/ledger.ts` 100% branches/functions/lines and `src/tools/settle-balance.ts` ≥95% branches, 100% functions, ≥95% lines.
- **Actual:** coverage `include` is still `src/observability/**` only (4.0.2 config). Measured:
  - `ledger.ts` — branch **89.41%**, funcs **92.59%**, lines **94.75%**.
  - `settle-balance.ts` — branch **83.07%**, funcs **81.81%**, lines **84.78%**.
- **Repro:** `npx vitest run --coverage.enabled --coverage.include='src/engine/ledger.ts' --coverage.include='src/tools/settle-balance.ts' --coverage.reporter=text --coverage.thresholds.lines=0`
- **Impact:** Misses (10–18 points) far exceed the ≤2-point soft-fail tolerance. C12 unmet.

### C8 — Pilot family acceptance not signed off (Design/UX Pass-gate; non-code)
- **Expected:** MV1–MV4 — one parent + one kid use the Phase C build ≥3 days, written sign-off; staging allowlist-failure scenario actionable.
- **Actual:** no sign-off artifact; deploy-gated manual step. Cannot be satisfied from build/test output. Resolve via the Phase C deploy gate, not the Generator.

---

## 6. Non-blocking gaps

- **DEL20 — `docs/SETTLEMENT.md` missing** (`docs/` has only `PRIVACY.md`). No test ID; post-cutover doc. Open deliverable, not a fail gate.
- **PF-1 — no per-sprint commit boundary** (see §1). Blocks literal enforcement of CA-1 §C; recommend committing/tagging at each sprint cutover.

---

## 7. Fail-forward routing

The functional core passed; the fail-forward sprint input is **BUG-1** (write LS-PERF-1/2 benches) and **BUG-2** (wire `vitest.config.ts` gate + raise `ledger.ts` to 100% and `settle-balance.ts` to the ≥95%/100%/≥95% bars). **C8** and **DEL20** are Phase-C deploy-gate items. **PF-1** is a process recommendation for the planner. **BUG-3b** is cleaned (quarantined) once per-sprint boundaries exist — not Generator implementation work.
