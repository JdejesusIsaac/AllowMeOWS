# Sprint 3.0.6 — Sprint Contract (Phase 1.5, Negotiated)

**Status:** Aligned between planner draft and evaluator Mode A pushback. Ready for user confirmation.
**Inputs:** [`research/research.md`](../research/research.md) (spike-resolved S1–S5; ⚠️ OQ1/OQ2/OQ4/OQ5 deferred here), [`planning/plan.md`](plan.md).
**Sprint type:** Backend MCP tool — RBAC-sensitive read counterpart to `configure-policy`.
**Sprint class:** Security-critical (rubric Func 30 / Auth 50 / Design 10 / Orig 10 per [`planning/AGENTS.md:18`](AGENTS.md)).

---

## Scope

**In scope.** Five deliverables, locked:

1. **`policyVersion` monotonic counter** on `FamilyConfigSchema` ([`src/schemas.ts`](../src/schemas.ts)) with lazy migration via Zod default and synchronous `++1` increment inside `configureFamilyCore` (both bootstrap and update paths).
2. **New MCP tool `view-policy`** ([`src/tools/view-policy.ts`](../src/tools/view-policy.ts)) registered in [`src/index.ts`](../src/index.ts), with `withAccessControl` wrapping per existing convention.
3. **Role-based filter helper** ([`src/middleware/policy-view-filter.ts`](../src/middleware/policy-view-filter.ts)) encoding the 5×4 access-control matrix as inspectable data (D7), plus a `hydrateDestinations` helper for provenance tagging (D6).
4. **In-process cache** ([`src/cache/policy-cache.ts`](../src/cache/policy-cache.ts)) with 60s TTL and synchronous write-invalidation in `configure-policy`.
5. **`ROLE_TOOL_ACCESS` expansion** ([`src/constants.ts`](../src/constants.ts)) adding `"view-policy"` to allowed roles per the access-control matrix.

**Out of scope.**
- Mutation of any policy field (`view-policy` is read-only by construction).
- Pending achievement queue (lives on `check-progress`).
- Optimistic-concurrency enforcement on `configure-policy` (`policyVersion` shipped but unenforced — future sprint).
- Multi-instance cache coordination (Railway is single-instance; in-process Map is enough).
- Encrypted-blob inspection or debug endpoints.
- New audit-log enum values (read tool produces no audit entries).
- New `CallerContext.childName` plumbing for non-learner roles (locks family's child-scope behavior at "all-or-stripped", not "own-child" — see ⚠️ OQ5 default).
- Touching the verify-page form or any Sprint 3.0.5 artifact.

---

## Deliverables

| ID | Deliverable | File(s) | Phase |
|----|-------------|---------|-------|
| DEL1 | `policyVersion` Zod field + lazy-migration default | [`src/schemas.ts`](../src/schemas.ts) | W2 |
| DEL2 | `policyVersion` increment in `configureFamilyCore` (both paths) | [`src/core/configure-family.ts`](../src/core/configure-family.ts) | W2 |
| DEL3 | Provenance hydration helper | [`src/middleware/policy-view-filter.ts`](../src/middleware/policy-view-filter.ts) | W3 |
| DEL4 | `view-policy` tool handler | [`src/tools/view-policy.ts`](../src/tools/view-policy.ts) | W4 |
| DEL5 | `filterPolicyForRole` (5×4 matrix encoded as data) | [`src/middleware/policy-view-filter.ts`](../src/middleware/policy-view-filter.ts) | W5 |
| DEL6 | In-process cache + write-invalidation | [`src/cache/policy-cache.ts`](../src/cache/policy-cache.ts), [`src/tools/configure-policy.ts`](../src/tools/configure-policy.ts) | W6 |
| DEL7 | `ROLE_TOOL_ACCESS` expansion + tool registration | [`src/constants.ts`](../src/constants.ts), [`src/index.ts`](../src/index.ts) | W7 |
| DEL8 | Regression-bar tests `CP-VER1`/`CP-VER2`/`CP-VER3` | [`tests/configure-policy-version.test.ts`](../tests/configure-policy-version.test.ts) | W1 |
| DEL9 | Provenance + matrix + cache test suites | [`tests/policy-view-filter.test.ts`](../tests/policy-view-filter.test.ts), [`tests/view-policy-tool.test.ts`](../tests/view-policy-tool.test.ts), [`tests/policy-cache.test.ts`](../tests/policy-cache.test.ts) | W3–W6 |
| DEL10 | README append for Sprint 3.0.6 | [`README.md`](../README.md) | W8 |

---

## Verification Criteria

Twelve criteria, ordered by failure-mode severity. Evaluator verifies each from the deployed build without reading `implementation/progress.md`.

### Functionality (must all pass for Pass)

**C1 — Backward-compat lazy migration.** Pre-3.0.6 family configs (no `policyVersion` field on disk) hydrate via `state.loadFamilyConfig` with `policyVersion: 0`. *Locked by test `CP-VER3` in [`tests/configure-policy-version.test.ts`](../tests/configure-policy-version.test.ts).* Writes a pre-3.0.6-shaped `family-config.json` to disk directly, then reads via StateManager and asserts the default applied.

**C2 — `policyVersion` monotonic, increments by exactly 1.** Bootstrap call persists `policyVersion: 1`; the immediate next `configure-policy` update persists `policyVersion: 2`. Both assertions load the disk shape via `StateManager.loadFamilyConfig` per the Sprint 3.0.5 E-PB1 disk-shape-is-the-truth pattern. *Locked by tests `CP-VER1` (bootstrap) and `CP-VER2` (update).*

**C3 — `POLICY_NOT_INITIALIZED` returns success shell, not error.** A `view-policy` call on a family that has never been through `configure-policy` returns `{ success: true, policyVersion: 0, children: [], authorizedDestinations: [], summary: { childCount: 0, totalWeeklyBudgetUsd: 0, destinationCount: 0, learningGoalCount: 0, activeGoalCount: 0 }, message: <non-empty> }`. **Critical: the shape is structurally identical to a populated response, just zero-valued.** *Locked by `VP-T5`.*

**C4 — Populated read returns full provenance-tagged response.** Manager + `section="all"` + populated family returns: every section non-empty, every entry in `authorizedDestinations` carries `{ address, label, source }`, `policyVersion >= 1`, `updatedAt` is an ISO datetime string, `network` matches the configured chain. *Locked by `VP-T1` and the W4 happy-path suite.*

**C5 — Provenance derivation correctness.** Manager's wallet is tagged `label: "manager-wallet", source: "force-added"`. Each child's wallet (when present) is tagged `label: "child:<exact-name>", source: "force-added"`. Any wallet in `authorizedDestinations` matching neither is tagged `label: "custom", source: "configured"`. **Match is case-insensitive.** *Locked by `PV-H1` through `PV-H5` in [`tests/policy-view-filter.test.ts`](../tests/policy-view-filter.test.ts).*

### Auth / Security (the rubric's heaviest weight — 50%)

**C6 — Access-control matrix, every cell.** Per user-confirmed tight_v1 profile (D-OQ4):
- **Tool-level gate (`ROLE_TOOL_ACCESS`):** Manager, Co-parent, Advisor have `view-policy` access. Family and Learner are EXCLUDED at the `withAccessControl` layer — they receive the standard "Access denied" payload from `buildAccessDeniedResponse`, NOT a partial response.
- **Filter helper matrix (`filterPolicyForRole`):** still encodes all 5 rows × 4 sections = 20 cells as inspectable data (so when Family/Learner are added in a follow-up sprint, the matrix is ready). For each allowed (role, section) pair: forbidden cells return `{ error: "INSUFFICIENT_ROLE", role, requestedSection }`; allowed cells return the expected shape with role-specific stripping applied (e.g., advisor receives `children[]` with `walletAddress: undefined` on every entry per D-OQ1 tight).
- **Effective v1 happy-path coverage:** Manager/Co-parent/Advisor × 4 sections = 12 positive cells; Family/Learner × any section = 2 tool-level "Access denied" tests.
*Locked by `PV-M{role}-{section}` tests in `tests/policy-view-filter.test.ts` (folded via `test.each` for matrix discipline) plus `VP-T7a` (family denied) and `VP-T7b` (learner denied) in `tests/view-policy-tool.test.ts`. **Evaluator iterates every cell and asserts on each — no representative-sample testing.***

**C7 — Sibling-enumeration block for learner.** Learner calling `view-policy` with `childName="<sibling-name>"` (a real but unauthorized child) returns `{ success: false, error: "CHILD_NOT_FOUND" }` with NO `validChildNames` field. Same response shape as a non-existent child name. *Locked by `PV-CHILDNAME2` (learner with ghost name) and `PV-CHILDNAME4` (learner with real sibling) — must return identical error shape.*

**C8 — Wallet redaction respects role precedence.** Advisor calling `view-policy` with `includeWallets: true` STILL receives `children[].walletAddress: undefined` (role-level stripping wins over client preference). Family role same behavior per default matrix. `includeWallets: false` does NOT strip `authorizedDestinations` for any role — only `children[].walletAddress`. *Locked by `PV-WALLETS1`/`PV-WALLETS2` plus `VP-T4`.*

### Backward compatibility (central correctness gate)

**C9 — Cache write-invalidation, no stale reads.** A sequence `view-policy → configure-policy (update) → view-policy` returns DIFFERENT payloads for the two `view-policy` calls. The second reflects the post-write state, NOT the cached pre-write state. Invalidation must be synchronous within the `configure-policy` handler. *Locked by `PC4` in [`tests/policy-cache.test.ts`](../tests/policy-cache.test.ts) as an integration test against the live tool registry.*

**C10 — Zero regressions in pre-existing tests.** `npx vitest run` clean. Sprint 3.0.5 baseline = 369 passing + 1 skipped. Final tally lower bound = 369 + 30 (W1 +3, W3 +5, W4 +6, W5 +12 with the tight_v1 matrix folded via `test.each`, W6 +4) = **at minimum 399 passing + 1 skipped**. **If 369 baseline regresses, sprint fails regardless of every other criterion.** Test count target band: **+30 to +45 net new tests** (user-confirmed).

**C11 — `npx tsc --noEmit` clean.** No new TypeScript errors introduced by DEL1 (schema field) or DEL3/DEL4/DEL5/DEL6 (new modules). *Build gate.*

### Determinism

**C12 — Read determinism.** Two consecutive `view-policy` calls on the same family with no intervening `configure-policy` write return byte-identical payloads (JSON-serialized). Locks "view-policy is a pure read" — no clock drift in the response, no random IDs, no per-call mutation. *Locked by `VP-T6`.*

---

## Rubric

Security-critical class per [`planning/AGENTS.md:18`](AGENTS.md). Each category scored 0–100; thresholds in the Grading section.

| Category | Weight | Definition | Locked criteria |
|----------|--------|------------|-----------------|
| Functionality | 30% | Read path returns the persisted state correctly across populated + empty families; `policyVersion` monotonicity holds; provenance derivation matches the force-added set inversion | C1, C2, C3, C4, C5, C12 |
| Auth / Security | 50% | Every cell of the access-control matrix gates correctly; sibling enumeration is blocked for learner; wallet redaction respects role precedence over client preference | C6, C7, C8 |
| Design / UX | 10% | API shape is consistent across populated/empty/error cases (shell-not-throw discipline); cache invalidation is synchronous (no stale-read race); helper module boundaries are clean | C3, C9 |
| Originality | 10% | Provenance derivation as read-side hydration (no storage change); matrix encoded as inspectable data, not nested switches; in-process Map cache with same-handler invalidation rather than coordinating-process overhead | reviewed in evaluation |

---

## Grading thresholds

- **Pass:** all of C1–C12 verified. Each rubric category at ≥ 75%. Backward-compat regression tests `CP-VER1`/`CP-VER2`/`CP-VER3` green. Test count meets C10's lower bound (≥ 411 passing + 1 skipped).
- **Fail:** any of C1–C11 fails. OR `tsc --noEmit` errors. OR pre-existing test suite regresses. OR the access-control matrix has even ONE incorrect cell (learner seeing destinations is the canonical fail).
- **Soft fail (Pass-with-followup):** C12 determinism issue traceable to ISO-timestamp serialization order ONLY (cosmetic — `JSON.stringify` key order is deterministic in V8 but other engines may differ). Evaluator may issue Pass with a Sprint 3.5 ticket if Auth/Security and Functionality are both clean.

---

## Audit trail

The implementation MUST NOT introduce new audit-log action enum values. `view-policy` is a read tool and should produce no audit entries (consistent with `check-progress`, `check-goals`, `check-savings`). If the implementation finds a missing audit case (e.g., audit destination-list reads), the contract must be re-negotiated before adding a new enum value.

---

## Hand-off rules

1. Generator implements per [`planning/plan.md`](plan.md) AND this contract. Generator must update `implementation/progress.md` at every workstream checkpoint.
2. Generator MUST run the regression bar (`CP-VER1`/`CP-VER2`/`CP-VER3`) between every workstream from W2 onward. If any goes red, stop and document in "Failed Approaches" before continuing.
3. Generator MUST NOT self-evaluate. The evaluator (Phase 3, Mode B) reads only this contract and the deployed build — never `implementation/progress.md`.
4. No real-device smoke required. Optional Claude.ai integration smoke (Manager session calls `view-policy` in Claude Desktop, confirms response renders sensibly) — delegated to user if requested.

---

## Negotiation Log

### Round 1 — Planner draft (initial)

Planner produced the 12 criteria above from [`view-policy-sprint/plan.md`](../view-policy-sprint/plan.md) §"Acceptance criteria" (10 items) plus the Sprint 3.0.5 backward-compat pair (C10 zero-regressions, C11 tsc-clean) and a determinism gate (C12).

Rubric weights selected as Security-critical per [`planning/AGENTS.md:18`](AGENTS.md) — the access-control matrix is the central failure mode (learner-sees-destinations is a custody-adjacent data exposure).

### Round 2 — Evaluator pushback (Mode A)

The evaluator raised five concerns; each is reflected in the final criteria.

**E-PB1 (`policyVersion` monotonicity is too weak as "increases"):** A buggy implementation could increment by 2 on bootstrap or skip on update; the contract must demand `++1` per write, asserted on the disk shape.
→ **Resolution:** C2 now requires exact values (bootstrap → 1, first update → 2). Asserted via `StateManager.loadFamilyConfig`.

**E-PB2 (`POLICY_NOT_INITIALIZED` shell must be structurally identical to populated):** If the empty-state response has different keys than the populated state, every caller becomes a switch statement. Demand the SHAPE is identical, just zero-valued.
→ **Resolution:** C3 enumerates the shell fields and requires zero-valued sections, not absent ones.

**E-PB3 (5×4 matrix needs PER-CELL assertion, not representative sample):** "Tested some cells" is the canonical learner-sees-destinations failure mode. The contract must FORCE every cell to be asserted.
→ **Resolution:** C6 requires every (role, section) cell tested. `PV-M{role}-{section}` test names follow a deterministic pattern so the evaluator can enumerate them.

**E-PB4 (sibling enumeration block must produce identical shape to non-existent child):** If the learner gets `CHILD_NOT_FOUND` with `validChildNames: []` for a sibling but `CHILD_NOT_FOUND` with no field for a ghost name, the empty array IS information leakage (signals "there's a sibling but you can't see them"). The shapes must be byte-identical.
→ **Resolution:** C7 requires identical response shape, asserted by structural-equality compare in the test.

**E-PB5 (cache invalidation race — async invalidation is a stale-read bomb):** The contract must REQUIRE synchronous invalidation in the same handler, no `await` between save and invalidate, and the integration test must hit the live tool registry, not a mock.
→ **Resolution:** C9 specifies synchronous within the handler. `PC4` is an integration test against `registerConfigurePolicyTool` and `registerViewPolicyTool`-loaded server, not the cache module in isolation.

### Round 3 — Planner counter

Planner accepted all five pushback points without revision. One small clarification:

**Counter on E-PB3 matrix size:** the matrix has 5 roles × 4 sections = 20 cells, but the evaluator implied "20+ tests". For some cells the assertion is "this combination is forbidden" (one negative test); for others it's "this combination returns the expected stripped shape" (one positive test). Total = 20 tests for the matrix proper. Additional tests cover edge cases (childName scoping, includeWallets precedence, CHILD_NOT_FOUND shape parity) — those add ~5–7 more. **Total in `tests/policy-view-filter.test.ts`: ~25–28 tests.** Evaluator accepted.

### Round 4 — Sign-off

Both stances aligned on:
- Twelve criteria (C1–C12)
- Rubric: Security-critical class — Func 30 / Auth 50 / Design 10 / Orig 10
- Pass / Fail / Soft-fail thresholds
- Hand-off rules

Contract is final pending user confirmation of the four outstanding decisions below.

---

## Resolved decisions (user-confirmed)

All six outstanding decisions confirmed via Phase 1.5 batch:

| ID | Decision | Resolution | Effect on implementation |
|----|----------|-----------|--------------------------|
| D-Sprint | Sprint identifier | **3.0.6 (patch — additive)** | README append uses Sprint 3.0.6 (Done) heading; no semver bump beyond patch |
| D-OQ1 | Advisor wallet visibility | **Tight** — `walletAddress` always stripped | `filterPolicyForRole` for advisor role redacts `children[i].walletAddress` regardless of `includeWallets: true`. Asserted by `PV-WALLETS1` |
| D-OQ2 | Family destination visibility | **Tight** — destinations hidden | Moot for v1 because of D-OQ4 (Family doesn't get the tool at all). Matrix data still encodes `destinations: "hidden"` for Family row so the future sprint inherits the decision |
| D-OQ4 | Tool-level access scope | **Tight v1** — Manager + Co-parent + Advisor only | `ROLE_TOOL_ACCESS` gets `view-policy` added for these three roles ONLY. Family and Learner receive `buildAccessDeniedResponse` at the `withAccessControl` gate. Their RBAC access deferred to a follow-up sprint |
| D-OQ5 | Family role child scope | **Consistent** — family would see all children's policy slice if granted access (matches check-goals/check-progress) | Moot for v1 (D-OQ4). Encoded in matrix data for the future sprint |
| D-Test-count | Test count target band | **Accept** — +30 to +45 net new | C10 lower bound = 399 passing + 1 skipped; upper bound ~414. Matrix tests parameterized via `test.each` to stay in band |

**Effective v1 access-control matrix (the actual code shipped):**

| Role | Tool access (`ROLE_TOOL_ACCESS`) | If allowed → children | destinations | learning-goals | summary |
|------|----------------------------------|------------------------|--------------|----------------|---------|
| manager | ✅ | full | full | full | full |
| co-parent | ✅ | full | full | full | full |
| advisor | ✅ | full (no wallets per D-OQ1) | full | full | full |
| family | ❌ denied at tool gate | (deferred — matrix data: full, no wallets per D-OQ5 consistent) | (matrix data: hidden per D-OQ2) | (matrix data: full) | (matrix data: full) |
| learner | ❌ denied at tool gate | (deferred — matrix data: own-record only) | (matrix data: hidden) | (matrix data: own only) | (matrix data: scoped) |

Family / Learner rows remain in the filter helper's data table so the follow-up sprint that grants them tool access doesn't have to re-derive the policy. The tests cover all 20 cells of the matrix data; the integration tests confirm Family / Learner are denied at the `withAccessControl` gate before the filter even runs.

---

**Contract is locked. Generator proceeds with W0 → W9 per [`planning/plan.md`](plan.md) on `/implement`.**
