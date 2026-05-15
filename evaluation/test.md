# Sprint 3.0.5 — Evaluation Report (Phase 3, Mode B)

**Date:** 2026-05-15
**Contract:** [`planning/contract.md`](../planning/contract.md) (Func 35 / Auth 15 / Design 40 / Orig 10)
**Inputs read by evaluator:** Contract, deployed build (source files, served HTML, test sources), `npx tsc` output, `npx vitest run` output.
**Inputs deliberately NOT read:** `implementation/progress.md` (per Hand-off Rule 3 + user instruction).

---

## Verdict: **PASS** — with one Sprint 3.5 follow-up + C12 user smoke gating final merge

**Weighted score: 92 / 100** — every rubric category clears the 75% threshold. CI gates green, contract C1–C7 + C8–C11 all verified from the build, C12 user-owned per the negotiated contract decision and pending the user's mobile smoke.

| Category | Weight | Score | Weighted | Threshold |
|---|---|---|---|---|
| Functionality | 35% | **95** | 33.25 | ≥ 75 ✓ |
| Auth / Security | 15% | **95** | 14.25 | ≥ 75 ✓ |
| Design / UX | 40% | **90** | 36.00 | ≥ 75 ✓ |
| Originality | 10% | **85** | 8.50 | ≥ 75 ✓ |
| **Total** | 100% | — | **92.00** | — |

---

## CI gate results

| Gate | Result |
|---|---|
| `npx tsc --project ./tsconfig.json --noEmit` | **Exit 0**, no diagnostics — C7 PASS |
| `npx vitest run` (from clean `data/`) | **369 passing + 1 skipped** in 68.7s — C6 PASS, exact match to contract target ("369 passing + 1 skipped (363 baseline + HE5c + HE5d + W7.2 if implemented + at most 3 internal regression hooks)") |
| `ReadLints` on all 5 edited files | Zero lint diagnostics |
| Audit-log enum check (contract §"Audit trail") | `grep AuditAction` shows only the pre-existing `"family-created-via-verify-page"` enum — no new audit-log values introduced, contract line 106 satisfied |

---

## Criterion-by-criterion verification

### Functionality (Func 35%)

**C1 — Backward-compat bootstrap.** PASS.
- `tests/verify-routes.test.ts:202–276` (`HE5c`) posts the exact pre-3.0.5 shape (no `walletAddress`, no `learningGoals`).
- Asserts 200, `body.ok === true`, `body.familyId/memberId/setupCode/mcpUrl/sessionToken` all populated (lines 242–249).
- Loads persisted FamilyConfig via `StateManager.loadFamilyConfig` (line 256).
- Asserts `children[0].walletAddress === undefined` (264), `children[0].learningGoals === undefined` (265).
- Asserts `persisted.authorizedDestinations.toContain(managerWallet)` (268) — Sprint 3.0.2 disk-level integration.
- Asserts `body.authorizedDestinations` is an array containing the lowercased manager wallet (274–275).
- Every contract C1 assertion present and green.

**C2 — Rich-payload bootstrap, subgoals persist.** PASS *with one minor spec drift (see Bug 1)*.
- `tests/verify-routes.test.ts:285–383` (`HE5d`) posts walletAddress + one goal with 2 subgoals + ISO deadline.
- Asserts 200, body.ok, body.authorizedDestinations contains both wallets (345–347).
- Loads persisted FamilyConfig, asserts `aiden.learningGoals[0].subgoals.length === 2` (371), each `subgoal.completed === false` (373/375), `goal.deadline === deadlineIso` (377).
- One contract literal-text drift on `children[0].walletAddress`: contract says `<lowercased input>`; test asserts `aiden.walletAddress === childWalletInput` (the raw mixed-case input). Implementation preserves raw casing in `ChildConfig.walletAddress`; security-critical lowercasing happens in `buildAuthorizedDestinations` via `tryNormalizeWallet`. **User-visible behavior is unaffected** (allowlist matching is case-insensitive throughout). Flagged as Sprint 3.5 cleanup, not a fail.

**C3 — BYO-wallet auto-feeds the allowlist (Sprint 3.0.2 integration).** PASS.
- `HE5d:345–347` and `:381–382` both assert `body.authorizedDestinations` and `persisted.authorizedDestinations` contain the lowercased child wallet AND manager wallet. This is the strongest E-PB5 silent-data-loss shield and it is in place.
- `HE5e:438` independently asserts the BYO wallet round-trips persistence for the BYO child while the OWS-managed child has `walletAddress === undefined` (439).

**C4 — AllowMe-managed wallet path still works.** PASS.
- `HE5c:264` asserts `walletAddress === undefined` after the omitted-walletAddress bootstrap.
- `HE5e:439` asserts the OWS-managed child's `walletAddress === undefined` in the mixed-wallet scenario.

**C5 — Date serialization is correct.** PASS.
- End-state lock: `HE5d:377` asserts `goal.deadline === "2026-08-15T00:00:00.000Z"` after round-trip through the HTTP boundary + persistence.
- Form-side conversion: `public/verify.html:1008` does `goal.deadline = ${deadline}T00:00:00.000Z` inside `buildSubmitPayload` — implementation matches the contract spec character-for-character. (Not exercised by a vitest test because the vitest environment is `node`, not `jsdom`; verified by code review and gated by the user's W8 mobile smoke per contract.)

**C6 — Zero regressions.** PASS. 369 passing + 1 skipped — exact contract target.

### Auth / Security (Auth 15%)

- Server-side `tryNormalizeWallet` (`src/auth/wallet.ts`) remains the authoritative normalizer. The client regex at `public/verify.html:708` (`/^0x[a-fA-F0-9]{40}$/`) is defence-in-depth only, not a security barrier — the comment at the const literally says "Defence-in-depth only; server-side `tryNormalizeWallet` is authoritative".
- HTTP boundary additions (`authorizedDestinations` in response) leak nothing outside the family session: the field is the requesting family's own allowlist, returned to the family's authenticated session token. No cross-family data exposure.
- No schema relaxation: `configureFamilyBodySchema.learningGoals[].subgoals.max(20)` matches `SubgoalSchema` cap; `deadline: z.string().datetime()` matches `LearningGoalSchema.deadline.datetime()`. HTTP edge is now strictly equivalent to persistence, not laxer. The spike that flagged the silent-data-loss risk (E-PB5) is fully closed.
- No new audit-log enum values introduced — `grep AuditAction src/` shows only the pre-existing `"family-created-via-verify-page"`. Contract line 106 satisfied.
- Minor: server accepts `walletAddress: "0xinvalid"` and persists it verbatim in `ChildConfig.walletAddress` (it is simply excluded from the allowlist because `tryNormalizeWallet` returns null). Not a security hole — allowlist enforcement still works — but the persisted file ends up with malformed data. Pre-existing behavior; not Sprint 3.0.5's regression. Mentioned only for completeness.

### Design / UX (Design 40%)

**C8 — Caps enforced via `disabled` attribute.** PASS.
- `public/verify.html:829` sets `addGoalBtn.disabled = true` programmatically (not CSS-only).
- Line 830: `addGoalBtn.setAttribute("aria-disabled", "true")` — a11y mirror.
- Line 831: button label changes to `Maximum ${MAX_GOALS_PER_CHILD} goals reached` — visible feedback.
- Lines 833–834 reset the state on re-render after a removal.
- Lines 912–917: identical pattern for `addSubBtn` at `MAX_SUBGOALS_PER_GOAL`.
- E-PB3's a11y concern is fully addressed.

**C9 — Inline wallet validation fires.** PASS.
- `public/verify.html:803` attaches a `blur` listener to the wallet input.
- `:805` validates against `WALLET_RE`. Empty input is accepted (means OWS-managed); non-empty must match the regex.
- `:809–810` toggle `walletErr.hidden = false` with the message "Must be a valid Ethereum address starting with 0x and 40 hex characters." — concrete, actionable.
- `:815–818` clear the error on the next `input` event so the error disappears as soon as the user corrects it (clear-on-fix behavior the contract calls for).
- The submit handler at `:1064` re-validates server-side before posting; both paths use the same `WALLET_RE`.

**C10 — Allowlist transparency panel renders.** PASS.
- `<div id="success-allowlist" class="hidden">` placeholder at line 398, positioned **between** `<p id="success-body">` (393) and the `Your magic link` block (400–407) — **above** the success-url block as contract requires.
- `renderAllowlistPanel` (`:1199–1232`) iterates `authorizedDestinations`, labels each entry as `Admin (you)` when it matches the manager wallet (case-insensitive at 1213), `${name}'s wallet` when it matches a child wallet (case-insensitive at 1215–1218), or `Authorized address ${idx+1}` as fallback.
- Each entry shows a truncated address (`shortAddr`: `0x123456…abcd`) with the full address in the title attribute for hover/copy.
- Panel only renders for `kind === "create"` (`renderSuccess:1254`); hidden for `returning` / invite flows.
- Framing copy ("USDC transfers from the treasury can only land at the addresses below. To update this list later, ask Claude to `configure-policy`.") communicates the security model rather than just dumping addresses — meets the originality intent too.

**C11 — Per-child nesting preserved.** PASS.
- `renderGoals` (`:857`) is invoked from inside the child-row `renderChildren` loop (`:837`); goals containers are nested inside each child's `.child-row` div, not in a flat top-level section.
- The category `<select>` at `:866–871` builds its `<option>` list from `child.categories.map(...)` — the per-child category list, NOT a global one. Goal-row category options reflect the categories the parent just configured for THAT specific child.
- Case-insensitive selected-state preservation at `:868` (handles category rename gracefully on re-render).

**C12 — iOS Safari real-device bootstrap.** **DEFERRED — USER-OWNED PER CONTRACT.**
- Cannot be CI-tested. Contract's "Outstanding decision" #3 was negotiated to "User runs the smoke; generator stops at W7 and waits". The deployed build provides every hook the smoke needs (`16px` font on date/select inputs guards iOS auto-zoom; mobile-friendly tap targets; no fixed widths that break on iPhone).
- **C12 status: pending user smoke.** If the user reports C12 PASS, this verdict stands. If C12 FAILS in real-device testing, this evaluation must be reopened.

### Originality (Orig 10%)

- The vanilla-JS array-of-objects state pattern (`childrenDraft.forEach` with `data-field` attribute dispatch) is reused cleanly for the new fields. `CHILD_STRING_FIELDS = new Set(["name", "walletAddress"])` is a tidy extension of the existing string-vs-number dispatch instead of bolting on a separate handler.
- New `blankGoalRow()` / `blankSubgoalRow()` factory helpers mirror the existing `blankChildRow()` style.
- `renderGoals` and `renderSubgoals` are inlined as their own functions rather than nested inside `renderChildren`, which keeps the closures manageable and matches the codebase's existing flat-helper style.
- `shortAddr` is a small focused utility (8 lines) — no over-engineered address formatting library.
- The allowlist panel framing (admin / child name / fallback labels + the one-line `configure-policy` pointer) tells parents *what the system enforces*, not just *what addresses are in a list*. That framing is the highest-originality element of the sprint.

---

## Bug reports — Sprint 3.5 follow-ups

### Bug 1 — C2 contract-text drift on persisted `walletAddress` casing (low severity, not a Pass blocker)

- **What failed:** Contract C2 reads: *"persists `FamilyConfig.children[0].walletAddress === <lowercased input>`"*. The implementation preserves the **raw** (mixed-case EIP-55-checksummed) input in `ChildConfig.walletAddress`. `tests/verify-routes.test.ts:360` documents this: `expect(aiden.walletAddress).toBe(childWalletInput)` (the raw input, not `childWalletLower`).
- **Expected (per contract literal):** `aiden.walletAddress === "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"` (lowercased).
- **Actual:** `aiden.walletAddress === "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"` (raw input preserved).
- **Repro:** Run `npx vitest run -t "HE5d"` and inspect the persisted FamilyConfig at `data/families/<familyId>/family-config.json`.
- **Why this isn't a Fail:** All Sprint 3.0.2 allowlist enforcement uses `tryNormalizeWallet` (which lowercases) before comparison, so the security and allowlist semantics are unaffected. The mixed-case persistence is arguably better UX (parents see the address as they pasted it). The contract drift is on a literal text in C2, not on the contract's underlying intent.
- **Recommendation for Sprint 3.5:** Either (a) update the contract C2 wording to `children[0].walletAddress === <preserved input>` to match implementation, or (b) add one line in `normalizeChildren` to lowercase `c.walletAddress` before persistence to match contract. Either is a one-line change.
- **Rubric impact:** −5 in Functionality (95 instead of 100). Did not knock the rubric below the 75% threshold; Pass intact.

### Bug 2 — Pre-existing test-data leakage between vitest invocations (infrastructure, not Sprint 3.0.5's regression)

- **What surfaced:** A fresh `npx vitest run` after a previous run *without* cleaning `data/families/` fails ~92 tests on cross-family Manager assertions (e.g., `verify-routes.test.ts:579 expected 6 to be 1`). This bit during the W0 baseline check.
- **Root cause:** Only `tests/verify-routes.test.ts` cleans `data/` in `beforeEach`. Other test files (e.g., bootstrap-via-MCP, magic-link-persistence) write to `data/families/` and don't clean up, so the next `verify-routes` run sees stale state.
- **Workaround applied throughout Sprint 3.0.5:** `rm -rf data/families …` before every `npx vitest run`.
- **Recommendation for Sprint 3.5:** Move the `data/` cleanup into a global `globalSetup` or `vitest.config.ts` setup file so all test files inherit the clean slate. This is pre-existing infra debt, not Sprint 3.0.5's responsibility.
- **Rubric impact:** None for Sprint 3.0.5 (not its regression).

---

## C12 user-smoke handoff

Per the contract's Hand-off Rule 4 and the user-confirmed negotiated decision, **the user runs the iOS Safari + Coinbase Wallet end-to-end smoke**. The deployed build is ready: every DOM marker the smoke needs is in place (VP4 locks the structural inventory at `tests/verify-page.test.ts`), and the CSS auto-zoom guard is set (`font-size: 16px` on `input[type=date]` and `select`).

When the user reports C12 results:
- **C12 PASS** → this verdict stands as-is. Sprint 3.0.5 is shippable.
- **C12 FAIL** → re-open this evaluation with the smoke notes; specifically grade the failure against C1–C5 (real-device round-trip) and C8–C11 (UX on iPhone).

---

## Summary line

**Sprint 3.0.5: PASS — 92 / 100. CI gates green (tsc + 369/1-skipped vitest), all 11 CI-verifiable criteria met, one Sprint 3.5 follow-up logged (C2 walletAddress casing drift), C12 user-owned smoke pending.**
