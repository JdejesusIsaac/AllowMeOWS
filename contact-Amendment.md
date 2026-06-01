# Contract Amendment CA-1 — Test-side modification boundary and working-tree scope

> **Status:** Planner ruling. Ratified for application to Sprint 4.0.3
> `/fail-forward` and forward to all subsequent sprint contracts
> beginning with Sprint 4.0.4.
>
> **Origin:** Sprint 4.0.3 evaluation, BUG-3. Recurs from Sprint 4.0.1
> C10 (the `vi.mock` factory-extension finding). This amendment closes
> the recurring spirit-vs-letter gap permanently.
>
> **Portability:** This document is self-contained. It is referenced by
> `sprint-4.0.3/contract.md` (retroactively, for the fail-forward
> re-evaluation) and embedded into `sprint-4.0.4/contract.md` (and all
> later contracts) under their "Regression bar" / C12-equivalent
> section.

## 0. Why this amendment exists

Two consecutive evaluations surfaced the same structural problem: a
sprint's mandated deliverables *mechanically force* edits to
pre-existing test assertions, but the regression-bar invariant
("no pre-existing test-logic edits") forbids them in its strict letter.
The result is a contract-letter FAIL on changes that are non-gaming and
unavoidable.

- **Sprint 4.0.1, C10:** the Generator extended `vi.mock` factories in
  `allowlist-enforcement.test.ts` and `session-lifecycle.test.ts` to
  mirror a production return-type change. The evaluator ruled it
  "within C10's spirit" but flagged the interpretive ambiguity and
  recommended a contract amendment for the next sprint. The amendment
  was not written.
- **Sprint 4.0.3, BUG-3:** the same class of edit recurred (tool-count
  assertion, defaulted-policy-field round-trip), PLUS a distinct second
  problem — unrelated Sprint 4.0.1 work commingled into the 4.0.3 working
  tree.

CA-1 resolves both, and distinguishes them, so that the two are never
again conflated. The first is a contract that was too strict. The
second is a process that let unrelated work contaminate the evaluation
surface. Only the first earns a carve-out; the second earns a guardrail.

## 1. Part A — Forced-assertion carve-out (ratified)

### A.1 Ruling

The following test-side modifications are **permitted** and are NOT
"test-logic edits" for the purposes of the regression-bar invariant:

> **An assertion update is permitted when, and only when, it is
> strictly entailed by a deliverable mandated in the active sprint's
> plan — specifically:**
>
> **(a) a count or enumeration assertion that changes solely because
> the sprint adds or removes a registered tool, role, route, or
> capability** (e.g. `expect(managerTools.length).toBe(18)` →
> `toBe(19)` because the sprint adds `settle-balance`; adding the new
> tool name to a "free tools" or "allowed tools" list assertion);
> **and**
>
> **(b) a round-trip or serialization assertion that changes solely
> because the sprint adds a new field with a specified default to a
> persisted schema** (e.g. a `FamilyConfig` round-trip gaining
> `autoSettleWeekly: false` because the sprint adds that field with
> default `false`).**

### A.2 What this carve-out does NOT permit

The carve-out is deliberately narrow. The following remain
**test-logic edits and therefore sprint failures** under the
regression bar:

- Changing an assertion's *expected behavior* (e.g. flipping an
  expected `POLICY_DENIED` to an expected success).
- Removing, skipping, or `.todo`-ing a pre-existing test case.
- Adding a bypass condition, early return, or conditional skip to a
  pre-existing test.
- Loosening a pre-existing assertion (e.g. `toBe(x)` → `toBeGreaterThan(0)`,
  `toEqual(exact)` → `toMatchObject(subset)`) unless the loosening is
  itself the strictly-entailed consequence of (a) or (b).
- Changing a mock's *return value semantics* in a way that alters what
  the test proves (as opposed to mechanically extending a mock's shape
  to mirror a production type change — see A.3).

### A.3 Mock-shape extensions

Mechanically extending a mock factory to mirror a production
return-type change — the Sprint 4.0.1 C10 case — is permitted under the
same principle as (a) and (b), provided the extension does not change
what any assertion proves. Concretely:

- **Permitted:** adding a new field to a mock's returned object because
  the production type it mocks gained that field; adding a
  `vi.mock("../src/keys/family-api-tokens.js", …)` stub because the
  code under test now imports it. The mock's *behavior* (what it
  returns for existing fields, what assertions read) is unchanged.
- **Not permitted:** changing what a mock returns for an existing field
  in a way that flips a test's outcome; mocking out a real assertion
  target to make a failing test pass.

The test: *would the mock change alter the pass/fail outcome of any
assertion if the production code were correct?* If no, it's a permitted
shape extension. If yes, it's a test-logic edit.

### A.4 Evaluator obligation under Part A

When the Evaluator encounters a test-side edit, it MUST classify it:

1. **Strictly-entailed (A.1 a/b) or permitted mock-shape (A.3)** →
   non-blocking; note in the report; do not fail the sprint on it.
2. **Test-logic edit (A.2)** → blocking; fail per the regression bar.
3. **Cannot determine from the diff alone** → flag to planner for a
   ruling; do not unilaterally pass or fail.

The Evaluator documents the classification and the one-line
justification ("tool count changed solely because W6 adds
`settle-balance`") in the evaluation report.

### A.5 Applicability to Sprint 4.0.3 BUG-3a

BUG-3a (`http-transport.test.ts` tool count 18→19 and `settle-balance`
added to the free-tools list; `state-manager.test.ts` round-trip gains
`autoSettleWeekly: false`) is **ratified as permitted** under A.1(a)
and A.1(b) respectively. It does not contribute to the 4.0.3 FAIL.

## 2. Part B — 3b quarantine procedure (guardrail, not carve-out)

### B.1 Ruling

The `allowlist-enforcement.test.ts` and `session-lifecycle.test.ts`
edits flagged in BUG-3b — which add `family-api-tokens.js` mocks and
change the `initializeFamily` mock shape, and which are **labeled
"Sprint 4.0.1"** — are **not** ratified. They are unrelated future-sprint
work that leaked into the Sprint 4.0.3 working tree.

This is NOT granted a carve-out. Papering over it would legitimize
commingling future sprints' changes into the active sprint's evaluation
surface, which destroys `git diff` as a trustworthy scope boundary.
Instead, it is quarantined.

### B.2 Quarantine procedure (executed before fail-forward re-evaluation)

1. **Identify** the commingled changes. A change is commingled if it is
   (a) attributable by label, comment, or content to a sprint other
   than the active one, AND (b) not strictly entailed by an active-
   sprint deliverable under Part A. The BUG-3b edits meet both.

2. **Extract** the commingled changes out of the active working tree.
   Mechanism (Generator's choice, documented in the fail-forward
   progress log):
   - `git stash push -m "sprint-4.0.1 mock work, quarantined from 4.0.3" <paths>`, or
   - move to a dedicated `sprint-4.0.1-wip` branch via
     `git stash` → `git checkout -b sprint-4.0.1-wip` → `git stash pop`, or
   - revert the specific files to their `sprint-4.0` HEAD state and
     re-apply when 4.0.1 is the active sprint.

3. **Verify** the working tree is clean of the quarantined changes:
   `git diff sprint-4.0 -- tests/allowlist-enforcement.test.ts
   tests/session-lifecycle.test.ts` returns only changes strictly
   entailed by 4.0.3 deliverables (under Part A) or nothing.

4. **Re-run** the full suite after quarantine to confirm 4.0.3 still
   passes in isolation. If the suite now fails because the quarantined
   mocks were load-bearing for a 4.0.3 test, that is itself a finding:
   it means 4.0.3 work depended on un-merged 4.0.1 work, which is a
   sequencing violation to be surfaced to the planner — not silently
   re-merged.

5. **Re-evaluate** 4.0.3 against the cleaned working tree.

### B.3 Disposition of the quarantined work

The quarantined Sprint 4.0.1 mock changes re-enter the working tree when
Sprint 4.0.1 is the active sprint (or are re-derived fresh if 4.0.1's
implementation has moved on). They are not lost; they are deferred to
their correct sprint.

### B.4 Applicability to the 4.0.3 verdict

The 4.0.3 FAIL stands regardless of BUG-3b disposition (BUG-1 and BUG-2
are independently blocking). BUG-3b does not *cause* the FAIL; it is a
hygiene finding that must be cleaned before the fail-forward
re-evaluation produces a trustworthy grade.

## 3. Part C — Active-sprint-only working-tree invariant (new contract clause)

### C.1 The invariant

Added to the regression-bar / C12-equivalent section of every sprint
contract from Sprint 4.0.4 forward, and applied retroactively to the
Sprint 4.0.3 fail-forward:

> **C-INV (active-sprint-only working tree):** At evaluation time, the
> working tree MUST contain only changes attributable to the active
> sprint. "Attributable to the active sprint" means: implementing a
> deliverable in the active sprint's plan, or a test-side modification
> permitted under Part A of CA-1. Any change attributable to a
> different sprint — by label, comment, content, or the Generator's own
> admission — is a working-tree-hygiene violation and MUST be
> quarantined (CA-1 Part B) before evaluation proceeds.
>
> **Consequence:** `git diff <prev-sprint-HEAD>` is the authoritative
> scope boundary for evaluation. The Evaluator grades exactly that diff.
> If the diff contains out-of-scope changes, the Evaluator halts and
> requests quarantine rather than grading a commingled tree.

### C.2 Why this is an invariant, not a carve-out

A carve-out *permits* something. An invariant *requires* a precondition.
Part A permits forced assertion updates. Part C requires that the only
thing the Evaluator ever sees is the active sprint's work. The two
compose: Part A defines what legitimately belongs in the active
sprint's diff; Part C requires that nothing else is in it.

Together they restore the property the evaluation process depends on:
**`git diff` means exactly "this sprint's work," no more and no less.**
The Evaluator can trust it as the scope boundary, and the
Generator/Evaluator separation stays clean.

### C.3 Evaluator obligation under Part C

At the start of every evaluation, before grading:

1. Compute `git diff <prev-sprint-HEAD>` (for 4.0.3: against
   `sprint-4.0`; for 4.0.4: against the 4.0.3 cutover tag).
2. Scan for out-of-scope changes (labels/comments referencing other
   sprints; files unrelated to any active-sprint deliverable).
3. If found → **halt**, report the specific files, request quarantine
   (CA-1 Part B). Do not grade.
4. If clean → proceed to grade exactly the diff.

This is a pre-grade gate. It runs before the rubric scorecard.

## 4. Combined application checklist

### 4.0.1 For the Sprint 4.0.3 fail-forward

- [ ] **Part A ratified:** BUG-3a (tool count, `autoSettleWeekly`
      round-trip) reclassified as permitted; removed from the blocking
      set.
- [ ] **Part B executed:** BUG-3b (4.0.1-labeled mocks in
      `allowlist-enforcement.test.ts`, `session-lifecycle.test.ts`)
      quarantined out of the working tree per B.2.
- [ ] **Part B.2 step 4 confirmed:** full suite still passes after
      quarantine (no hidden 4.0.3-on-4.0.1 dependency). If it fails,
      surface the sequencing violation to planner.
- [ ] **Part C applied:** re-evaluation grades `git diff sprint-4.0`
      with the cleaned tree.
- [ ] **Remaining blockers unchanged:** BUG-1 (LS-PERF-1/2 benches) and
      BUG-2 (LS-COV-1 wiring + coverage to threshold) are still the
      load-bearing fail-forward work. CA-1 does not touch them.

### 4.0.2 For the Sprint 4.0.4 contract

- [ ] **Part A embedded** in the 4.0.4 regression-bar section verbatim.
      4.0.4 will trigger A.1(a) — the `ledger_status` reference table
      (D11) and the new `settle-balance`/factory changes — and A.1(b) —
      any new persisted field with a default. Without Part A, 4.0.4
      re-runs the same FAIL a third time.
- [ ] **Part A.3 embedded:** the `STATE_BACKEND` factory change and the
      `DualWriteStateManager` will force mock-shape extensions across
      many existing tests (every test that instantiates a StateManager).
      A.3 is what keeps those non-blocking.
- [ ] **Part C embedded** as C-INV in the 4.0.4 contract. The 4.0.4
      migration spans 5 PRs over ~10 days; the risk of commingling
      unrelated work into the tree is higher than any prior sprint.
      The pre-grade gate matters most here.

## 5. Precedent note

CA-1 is the second attempt to close this gap; the first (the Sprint 4.0.1
C10 recommendation) was advisory and was not acted on, so the gap
recurred. CA-1 is **binding**, not advisory: it is ratified into the
contract text, not left as a recommendation for "the next sprint to
consider." The distinction is the entire point — an advisory note
produced a recurrence; a ratified clause does not get to.

If a third instance of this class surfaces despite CA-1, that is
evidence the carve-out language in Part A is mis-scoped (too narrow or
too broad), and Part A should be revised — not re-litigated case by
case in evaluation reports.