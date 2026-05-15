# Sprint 3.0.5 — Sprint Contract (Phase 1.5, Negotiated)

**Status:** Aligned between planner draft and evaluator Mode A pushback. Ready for user confirmation.
**Inputs:** [`research/research.md`](../research/research.md) (spike-resolved), [`planning/plan.md`](plan.md).
**Sprint type:** Frontend/UX + thin HTTP-boundary surfacing.

---

## Scope

**In scope.** Three deliverables, locked:

1. Extend [`public/verify.html`](../public/verify.html)'s bootstrap form (`state-family-create`) to collect per-child `walletAddress` and `learningGoals` (with optional `subgoals` and `deadline`), capped at 5 goals per child and 5 subgoals per goal as UX guardrails.
2. Extend the verify-page HTTP boundary at [`app/verify-routes.ts`](../app/verify-routes.ts) by ~13 lines additive:
   - `configureFamilyBodySchema.learningGoals` mirrors the persistence schema's `subgoals` + `deadline` shape.
   - `/api/configure-family` JSON response carries `authorizedDestinations: string[]` (sourced from the resolved `buildAuthorizedDestinations` result in `bootstrapFamily()`).
3. Render a post-submit allowlist transparency panel in `renderSuccess({kind: "create"})` listing the admin + each child's authorized wallet, with a one-line pointer to `configure-policy` for future edits.

**Out of scope.** Anything that requires:
- Touching [`src/schemas.ts`](../src/schemas.ts) (persistence schema unchanged).
- New MCP tools or HTTP endpoints.
- Core domain changes beyond extending `ConfigureFamilyBootstrapResult` and its return statement in `bootstrapFamily()`.
- Dashboard, goal-recommendation engine, wallet picker, React migration, multi-language form, deadline-notification infrastructure, subgoal auto-matching on `verify-achievement`.
- The full Windsurf "scope guard" exclusion list in [`sprint-3.0.5/plan-3.0.5.md`](../sprint-3.0.5/plan-3.0.5.md) §"Scope guard" items 1–20.

---

## Deliverables

| ID | Deliverable | File(s) | Phase |
|----|-------------|---------|-------|
| DEL1 | `walletAddress` input per child with inline regex feedback | `public/verify.html` | W3, W5 |
| DEL2 | Per-child `learningGoals` section with topic, category dropdown, subgoals, deadline | `public/verify.html` | W3 |
| DEL3 | Submit serializer that posts the richer payload (omitting empty optionals) | `public/verify.html` | W4 |
| DEL4 | HTTP body schema accepts `subgoals` and `deadline` | `app/verify-routes.ts` | W2 |
| DEL5 | `ConfigureFamilyBootstrapResult.authorizedDestinations` + populate in core | `src/core/configure-family.ts` | W2 |
| DEL6 | `/api/configure-family` response includes `authorizedDestinations` | `app/verify-routes.ts` | W2 |
| DEL7 | Allowlist transparency panel in `renderSuccess()` | `public/verify.html` | W6 |
| DEL8 | Backward-compat regression test `HE5c` | `tests/verify-routes.test.ts` | W1 |
| DEL9 | Rich-payload persistence test `HE5d` | `tests/verify-routes.test.ts` | W2 |
| DEL10 | README append line for Sprint 3.0.5 | `README.md` | W7 |

---

## Verification Criteria

Each criterion is independently testable and the evaluator must verify it without reading `implementation/progress.md`. Twelve criteria, ordered by failure-mode severity.

### Functionality (must all pass for Pass)

**C1 — Backward-compat bootstrap.** A POST to `/api/configure-family` with the *old* payload shape (no `walletAddress`, no `learningGoals` on any child) returns 200 with `body.ok === true`, persists `FamilyConfig` with `children[0].walletAddress === undefined` and `children[0].learningGoals === undefined`, and includes `body.authorizedDestinations` containing the lowercased SIWE-verified manager wallet. *Locked by test `HE5c` in `tests/verify-routes.test.ts`.*

**C2 — Rich-payload bootstrap, subgoals persist.** A POST including a child with `walletAddress: "0x..."`, one goal with `{topic, category, subgoals: [{topic}, {topic}], deadline: "2026-08-15T00:00:00.000Z"}` returns 200, persists `FamilyConfig.children[0].learningGoals[0].subgoals.length === 2` (each `subgoal.completed === false` after `normalizeChildren`), `learningGoals[0].deadline === "2026-08-15T00:00:00.000Z"`, `children[0].walletAddress === <lowercased input>`, and `body.authorizedDestinations` contains both the manager and child wallets. *Locked by test `HE5d` in `tests/verify-routes.test.ts`.*

**C3 — BYO-wallet auto-feeds the allowlist (Sprint 3.0.2 integration).** Posting `walletAddress` per child results in the address appearing in `FamilyConfig.authorizedDestinations` after bootstrap, lowercased. Evaluator verifies by loading the persisted file directly with `StateManager.loadFamilyConfig`. *Subsumed by `HE5d` but called out as the strongest Sprint 3.0.2 integration assertion.*

**C4 — AllowMe-managed wallet path still works.** Posting with `walletAddress` omitted leaves `ChildConfig.walletAddress` undefined, `buildChildrenSummary` returns `wallet: "OWS-managed"` for that child, and the response's `authorizedDestinations` still contains the manager wallet. *Verified by `HE5c`.*

**C5 — Date serialization is correct.** A form-side `YYYY-MM-DD` deadline (e.g. `"2026-08-15"`) is serialized to `${date}T00:00:00.000Z` before posting; the persisted `LearningGoal.deadline` exactly equals that string. *Verified by `HE5d`'s deadline assertion.*

### Backward compatibility (must pass — central correctness bar)

**C6 — Zero regressions in pre-existing tests.** `npx vitest run` returns 363 passing + 1 skipped (Sprint 3.0.2 baseline) + the new tests from W1/W2. No previously-passing test starts failing. Required exit state: `369 passing + 1 skipped` (363 baseline + HE5c + HE5d + W7.2 if implemented + at most 3 internal regression hooks). *If 363 baseline regresses, sprint fails regardless of every other criterion.*

**C7 — `npx tsc --noEmit` clean.** No new TypeScript errors introduced by D8 / D9 type extensions. *Build gate.*

### Frontend / UX (Design 40% — the rubric's heaviest weight)

**C8 — Form renders with caps enforced.** The DOM, after `renderChildren()` runs with 5 goals on one child, must contain a "+ Add learning goal" button with `disabled` attribute set. Same for subgoals at 5. *Evaluator verifies via JSDOM smoke or by loading the form in a headless browser; the disabled state must be set programmatically (not CSS-only), so reading `button.disabled === true` works.*

**C9 — Inline wallet validation fires.** Typing `0xnotanaddress` into a wallet field and triggering `blur` shows an inline error element below the input containing a message about valid Ethereum address shape. Clearing or typing a valid 40-hex-char address removes the error. *Manual smoke + a JSDOM test if W7.2 lands.*

**C10 — Allowlist transparency panel renders.** Post-submit success state contains a DOM block (above the `success-url` block) listing at least one entry per address in `body.authorizedDestinations`. Each entry has a human-readable label identifying it as the admin or a specific child. Each entry shows a truncated/checksummed address. *Manual smoke; the panel must exist before W8 begins.*

**C11 — Per-child nesting preserved.** Learning goals MUST render inside their child's `.child-row` block, not in a flat top-level section. The category `<select>` for each goal MUST populate from that child's `categories[].name`. *Reviewed visually in W8; structural assertion possible via JSDOM if time permits.*

### Mobile

**C12 — iOS Safari bootstrap end-to-end.** A real-device test on iOS Safari + Coinbase Wallet completes a bootstrap with one child, two goals (one with 3 subgoals + deadline), one BYO wallet. Magic-link works in Claude Desktop on macOS. `check-goals` MCP call returns the configured goals with subgoals and `daysUntilDeadline`. Inspecting `data/families/{id}/family-config.json` shows `learningGoals[0].subgoals.length === 3` and `learningGoals[0].deadline` is the expected ISO datetime. *Reported in the evaluator's smoke notes; cannot be CI-tested.*

---

## Rubric

Frontend/UX class per [`planning/AGENTS.md`](AGENTS.md). Each category scored 0–100; thresholds in the Grading section.

| Category | Weight | Definition | Locked criteria |
|----------|--------|------------|-----------------|
| Functionality | 35% | Bootstrap-to-check-goals round-trip works for both old and new payload shapes; subgoals and deadlines persist correctly; allowlist auto-feeds | C1, C2, C3, C4, C5, C6 |
| Auth / Security | 15% | Server-side wallet normalization remains authoritative (client regex is supplemental); HTTP boundary additions don't leak data outside the family's session; no schema relaxation | C1, C3 partial; reviewed against `src/auth/wallet.ts` and `app/verify-routes.ts` diff |
| Design / UX | 40% | Per-child nesting reads naturally, cap enforcement engages, allowlist panel makes the security model legible to non-crypto parents, inline error states are clear, mobile flow respects existing single-file design | C8, C9, C10, C11, C12 |
| Originality | 10% | Vanilla JS array-of-objects state pattern reused cleanly; no over-engineered abstractions; allowlist panel framing communicates the model rather than just dumping addresses | reviewed in evaluation |

---

## Grading thresholds

- **Pass:** all of C1–C12 verified. Each rubric category at ≥ 75%. Backward-compat regression test green. Total test count meets C6's target (≥ 363 baseline + at least HE5c + HE5d).
- **Fail:** any of C1–C7 fails. OR `npx tsc --noEmit` errors. OR pre-existing test suite regresses. OR mobile smoke (C12) blocks before merge.
- **Soft fail (Pass-with-followup):** C8–C11 fail individually only on cosmetic grounds (e.g., button is disabled visually but `disabled` attribute not set) — evaluator may issue a Pass with a Sprint 3.5 polish ticket if Functionality + Backward-compat are both clean.

---

## Audit trail

The implementation MUST NOT introduce new audit-log action enum values. The existing `family-created-via-verify-page` and Sprint 3.0.2's `authorized-destinations-updated` already cover the events produced by this sprint's flow. If the implementation finds a missing audit case, the contract must be re-negotiated before adding a new enum value.

---

## Hand-off rules

1. Generator implements per [`planning/plan.md`](plan.md) AND this contract. Generator must update `implementation/progress.md` at every workstream checkpoint.
2. Generator MUST run the backward-compat regression test (`HE5c`) between every workstream. If it fails, stop and document in "Failed Approaches" in `implementation/progress.md` before continuing.
3. Generator MUST NOT self-evaluate. The evaluator (Phase 3, Mode B) reads only this contract and the deployed build — never `implementation/progress.md`, enforced by [`.cursor/hooks/evaluator-isolation.py`](../.cursor/hooks/evaluator-isolation.py).
4. Mobile smoke (C12) is a real-device manual test. The generator stops and writes the smoke results into `evaluation/test.md` before handing off, OR delegates the smoke to the user and waits.

---

## Negotiation Log

The contract emerged from the planner draft and evaluator Mode A pushback. Each exchange below was internalized into the criteria above; the log is the audit trail of why each criterion exists.

### Round 1 — Planner draft (initial)
Planner adapted the 12 success criteria from [`sprint-3.0.5/plan-3.0.5.md`](../sprint-3.0.5/plan-3.0.5.md) §"Sprint Contract" (Windsurf), mapping each to a numbered C-criterion and choosing the Frontend/UX rubric weights from [`planning/AGENTS.md`](AGENTS.md).

### Round 2 — Evaluator pushback (Mode A)

The evaluator raised five concerns; each is reflected in the final criteria above.

**E-PB1 (functionality):** "Bootstrap with goals works end-to-end" is too vague. Generator could ship a form that compiles a payload that posts successfully (200 OK) but where the persisted JSON is missing fields and no one notices. Demand a *file-on-disk assertion*, not a *response code assertion*.

→ **Resolution:** C1, C2, C3, C5 now require the evaluator to load the persisted `FamilyConfig` via `StateManager.loadFamilyConfig` and assert on shape directly. The HTTP 200 is necessary but not sufficient.

**E-PB2 (backward-compat):** the regression bar must lock against the *old* payload shape AT LEAST. The Windsurf plan called for one. Generator must write it first, before any other change, and re-run it every workstream.

→ **Resolution:** DEL8 (HE5c) is the regression test. W1 in [`planning/plan.md`](plan.md) makes writing it the first action AFTER baseline confirmation. Plan's "How to use this plan" section enforces the re-run cadence.

**E-PB3 (caps enforcement):** "Caps prevent UI overload" is a UX claim, not a test. The disabled state of the button matters because a screen reader / a-11y user must know they're at the limit.

→ **Resolution:** C8 requires the `disabled` attribute (not just CSS) and `aria-disabled` per [`planning/plan.md`](plan.md) W3.5. The evaluator can verify via DOM inspection of the rendered page.

**E-PB4 (inline wallet validation):** what's "valid Ethereum address" feedback? Need a concrete pattern test — typing a known-bad input must produce a known-shape error.

→ **Resolution:** C9 specifies the trigger (`blur`), the bad input shape, the error-element existence assertion, and the clear-on-fix behavior. Implementation lives in W5.1 of [`planning/plan.md`](plan.md).

**E-PB5 (the silent-data-loss failure mode the spike found):** if the generator implements the form fields but forgets the HTTP body schema extension (D8) OR the response extension (D9), the form will look like it works but persist nothing of the new fields, and the panel will be empty. This is exactly the "looks polished but core feature broken" failure mode that bias-toward-failure (`@evaluator` Mode B) targets.

→ **Resolution:** C2 forces a file-on-disk assertion on the persisted subgoals/deadline (D8 failure → C2 fails). C3 forces an `authorizedDestinations` assertion on the response (D9 failure → C3 fails). HE5d locks both. The evaluator's grading procedure must explicitly check the persisted JSON, not just the API response.

### Round 3 — Planner counter

The planner pushed back on E-PB5's framing only — D8 and D9 are not "fields the generator might forget" but explicit deliverables (DEL4, DEL5, DEL6) with diffs locked in the spike. Forgetting them isn't a risk of inattention but of scope-creep elsewhere distracting the generator. The mitigation is the workstream sequencing in [`planning/plan.md`](plan.md) which makes W2 (HTTP boundary) come BEFORE W3 (form fields) — by the time the form is built, the backend is already accepting the new shape.

Evaluator accepted the sequencing as sufficient mitigation. Counter resolved.

### Round 4 — Sign-off

Both stances aligned on:
- Twelve criteria (C1–C12)
- Rubric: Func 35 / Auth 15 / Design 40 / Orig 10
- Pass / Fail / Soft-fail thresholds
- Hand-off rules

Contract is final pending user confirmation.

---

## Outstanding decisions for user confirmation

Before implementation begins, the user should confirm:

1. **Scope reframe accepted?** The Windsurf plan said "UI-only, no backend changes." The spike found that ~13 lines of additive HTTP-boundary code are required for the form's new fields to actually persist and for the transparency panel to have data. The reframe doesn't change the spirit (still 95% UI work, no schema/persistence/core-domain changes) but the framing differs from the Windsurf plan. **Acceptable?**
2. **Test count target.** Plan targets +6 to +9 new tests. The Windsurf plan called for +1 backward-compat test only. Evaluator's E-PB1/E-PB5 pushback pushed the test count up (HE5d for rich-payload persistence). **Acceptable?**
3. **Mobile smoke (C12) ownership.** Real-device iOS Safari smoke can be run by the generator (if iOS hardware available) or delegated to the user. **Who runs it?**
4. **Soft-fail threshold.** Cosmetic C8–C11 failures that don't break Functionality may earn Pass-with-followup. **Acceptable, or strict Pass/Fail only?**

Once these are confirmed, the generator begins W0 → W8 per [`planning/plan.md`](plan.md).
