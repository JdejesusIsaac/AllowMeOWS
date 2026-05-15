# Sprint 3.0.5 — Implementation Progress

**Sprint:** verify-page form extension (form fields + ~13-line HTTP-boundary surfacing)
**Contract:** [`planning/contract.md`](../planning/contract.md) — 12 criteria (C1–C12), Func 35 / Auth 15 / Design 40 / Orig 10
**Baseline locked (W0):** 363 passing + 1 skipped, `tsc --noEmit` clean
**Final (W7):** 369 passing + 1 skipped, `tsc --noEmit` clean, +6 net new tests

---

## Current state

| Workstream | Status | Tests | Notes |
|---|---|---|---|
| W0 — Backstop | DONE | 363 + 1 skipped | `npx tsc --project ./tsconfig.json --noEmit` clean; `data/` cleaned before run |
| W1 — HE5c regression test | DONE | 1 red (expected) | All persistence + Sprint 3.0.2 assertions green; line 274 `body.authorizedDestinations` red — that's the W2 spec |
| W2 — HTTP boundary additions | DONE | 365 + 1 skipped | configureFamilyBodySchema +subgoals/deadline; ConfigureFamilyBootstrapResult.authorizedDestinations; response field; HE5d added |
| W3 — Form fields | DONE | 365 + 1 skipped | walletAddress, learningGoals, subgoals, deadline; cap-aware buttons; W5.1 wallet-blur validation bundled in for DOM cohesion |
| W4 — Submit serializer | DONE | 365 + 1 skipped | `buildSubmitPayload` filters empty + ISO-serializes deadline; W5.2 goal-topic check landed in the same handler |
| W5 — Inline validation | DONE | 365 + 1 skipped | W5.1 bundled in W3; W5.2 bundled in W4 |
| W6 — Allowlist transparency panel | DONE | 365 + 1 skipped | `#success-allowlist` placeholder + `renderAllowlistPanel` w/ admin / per-child / fallback labels; case-insensitive match |
| W7 — Tests + README | DONE | 369 + 1 skipped | HE5e/HE5f/HE5g/VP4 added; README updated; tsc clean; full suite green |
| W8 — Mobile smoke | **READY FOR USER** | n/a | See "W8 smoke instructions for the user" below |

---

## Significant changes

### W0 (2026-05-15 08:48)
- Cleaned `data/families/` (75 leftover dirs from prior CI/Windsurf runs). `vitest run` is sensitive to test-data leakage from non-verify-routes tests that don't clean up.
- Baseline: **363 passing + 1 skipped** in 54.7s. Matches Sprint 3.0.2 exit state per `sprint-3.0.2/progress-3.0.2.md`.
- `npx tsc --project ./tsconfig.json --noEmit` → exit 0, no output. (Plain `npx tsc --noEmit` printed help — must use `--project`.)

### W1 (2026-05-15 08:51)
- Added `HE5c: backward-compat — pre-3.0.5 form payload still bootstraps cleanly` to `tests/verify-routes.test.ts`, immediately after `HE5b`.
- HE5c posts the *exact* pre-3.0.5 payload shape (no `walletAddress`, no `learningGoals`). 21 of 22 assertions pass on current code (locks backward-compat); 1 assertion red on `body.authorizedDestinations` — that's the W2 spec, as planned.
- Sprint 3.0.2 disk-shape assertion (`persisted.authorizedDestinations.toContain(managerWallet)`) confirmed green — auto-populate behaviour intact under the new test.

### W2 (2026-05-15 08:53)
- `app/verify-routes.ts` — `configureFamilyBodySchema.learningGoals[]` extended with `subgoals` (`z.array(...).max(20).optional()`) and `deadline` (`z.string().datetime().optional()`). Mirrors `LearningGoalSchema` in `src/schemas.ts` exactly — HTTP edge is no longer laxer than persistence.
- `src/core/configure-family.ts` — `ConfigureFamilyBootstrapResult` gained `authorizedDestinations: string[]` (populated from `allowlist.destinations` inside `bootstrapFamily`).
- `app/verify-routes.ts` (response) — JSON shape now includes `authorizedDestinations`.
- Added `HE5d: rich payload — walletAddress + subgoals + deadline persist; allowlist includes child wallet`. Covers C2/C3/C5 with disk-shape assertions per E-PB1.
- Result: **365 passing + 1 skipped**, tsc clean. HE5c fully green from this point onward.

### W3 (2026-05-15 08:57)
- `public/verify.html` CSS — `.goal-row` (dashed-border block), `.subgoal-row` (inline flex), `.btn-icon` (small ghost button), `.field-error` (red 13px inline error). Date and select inputs styled to match existing controls (`16px` font for iOS auto-zoom guard).
- `blankChildRow()` extended with `walletAddress: ""` and `learningGoals: []`. New helpers `blankGoalRow()` (topic/category/subgoals/deadline) and `blankSubgoalRow()` (topic).
- `renderChildren()` rewritten — adds wallet input + inline error span, learning-goals section with cap-aware "+ Add learning goal" button (disables at `MAX_GOALS_PER_CHILD = 5`, sets `aria-disabled`, swaps button text to "Maximum 5 goals reached").
- New `renderGoals()` and `renderSubgoals()` render each goal-row with topic input, category `<select>` (options derived from THIS child's categories per C11), date input, subgoals list, "+ Add sub-step" button (cap `MAX_SUBGOALS_PER_GOAL = 5`), and "× Remove this goal" button.
- W5.1 — wallet-address input has a `blur` listener that validates against `WALLET_RE = /^0x[a-fA-F0-9]{40}$/` and toggles a `[data-wallet-error]` span; the span clears on the next `input` event. Bundled here (not in a separate W5 pass) for DOM cohesion — the listener lives on the input element rendered by W3.

### W4 (2026-05-15 09:00)
- Hoisted `WALLET_RE` to module scope so the submit handler can use it.
- New `buildSubmitPayload()` — pure function that returns `{ children, goalTopicErrors }`. Drops `walletAddress` when blank, filters out goals whose `topic.trim()` is empty (silently if no other signal; flagging via `goalTopicErrors` if subgoals / deadline / category are populated — W5.2). Filters empty subgoals, serializes `deadline` (`YYYY-MM-DD`) to `${date}T00:00:00.000Z`. Omits `learningGoals` entirely when zero clean goals remain.
- New `clearGoalTopicErrors()` and `showGoalTopicErrors()` — DOM helpers for the inline goal-topic error UX (W5.2).
- `submitFamilyCreate()` now: clears stale goal errors, runs the existing familyName / child-name / categories-100% checks, validates wallet regex per child, calls `buildSubmitPayload()`, renders inline goal-topic errors if any, posts the cleaned `children` (not raw `childrenDraft`), and passes `authorizedDestinations` + `children` + `managerWallet` to `renderSuccess` for W6.

### W6 (2026-05-15 09:01)
- Added `<div id="success-allowlist" class="hidden">` placeholder inside `#state-success`, between the body paragraph and the magic-link block.
- New `shortAddr()` helper — formats `0x123…abcd` for display.
- New `renderAllowlistPanel(authorizedDestinations, children, managerWalletAddr)` — walks `authorizedDestinations`, labels each entry as `Admin (you)` (case-insensitive match against manager wallet), `<Name>'s wallet` (case-insensitive match against `children[].wallet`), or `Authorized address N` (fallback). Renders into a `.alert`-styled block with a `<dl class="kv">` list and a one-line note about `configure-policy` for later changes. Hidden for `kind !== "create"` (returning sessions / invite redemptions use a different code path).

### W7 (2026-05-15 09:04)
- Added `HE5e` (multi-child mixed BYO + OWS-managed coexist; allowlist contains only the BYO wallet + manager).
- Added `HE5f` (deadline-only goal — `subgoals` independence).
- Added `HE5g` (subgoals-only goal — `deadline` independence; also locks the Sprint 3.0.4 `subgoal.completed = false` default).
- Added `VP4` (Sprint 3.0.5 HTML structural-marker assertions on the served `/verify` HTML — `data-field="walletAddress"`, `data-wallet-error`, `data-goals`, `data-add-goal`, `data-goal-field`, `data-subgoals`, `data-add-subgoal`, `data-subgoal-field`, `data-remove-goal`, `data-remove-subgoal`, `data-goal-topic-error`, `MAX_GOALS_PER_CHILD`, `MAX_SUBGOALS_PER_GOAL`, `#success-allowlist`, `buildSubmitPayload`, `showGoalTopicErrors`).
- README — appended Sprint 3.0.5 (Done) block under Sprint 3.0.2; updated test-count claim in the intro (`297 → 369 passing`).
- Final: **369 passing + 1 skipped** (363 baseline + HE5c + HE5d + HE5e + HE5f + HE5g + VP4 = +6 net, hitting the lower bound of the user-confirmed +6 to +9 target). tsc clean. Lints clean across all five edited files.

---

## Failed Approaches

- None documented.

---

## W8 smoke instructions for the user

Per contract Hand-off Rule 3, the generator stops here. W8 is the **iOS Safari + Coinbase Wallet end-to-end smoke** — user-owned per the negotiated scope.

1. Start the server in testnet mode against the real Base Sepolia chain:
   ```sh
   cd AllowMeOWS && ALLOWANCE_USE_TESTNET=true bun app/server.ts
   ```
   Make sure the server is reachable from your phone (ngrok / Tailscale / LAN — your usual setup).

2. On iPhone, open Safari, navigate to `/verify` on the URL above. **Confirm:**
   - **C12a — Connect Wallet** opens Coinbase Wallet, prompts for the SIWE signature, returns to Safari with no errors.
   - **C12b — Form renders** with one default child row. Add a second child via "+ Add child".
   - **C8a — Goals cap** — click "+ Add learning goal" five times on a child. The button disables on the sixth and its label switches to "Maximum 5 goals reached".
   - **C8b — Subgoals cap** — click "+ Add sub-step" five times inside a goal. Same disable behaviour with "Max 5 sub-steps".
   - **C9 — Wallet validation** — paste `0xnotvalid` into a child's wallet input and tap away. Red inline error appears under the input. Clear the field and tap away again — error disappears.
   - **C5 — Date input** — verify the native iOS date wheel opens for the deadline field.
   - **C11 — Per-child nesting** — confirm each child has its own categories, goals, and subgoals; nothing leaks between children.

3. Fill in a complete configuration (familyName + 2 kids, one with a BYO wallet, one OWS-managed, each with one goal + subgoals + deadline) and tap **Create family**. **Confirm:**
   - **C1/C2/C7 — Bootstrap succeeds** — the success screen loads with a magic-link URL and "Copy link" button working.
   - **C10 — Allowlist transparency panel** renders BEFORE the magic-link block. The admin wallet shows as "Admin (you)"; the BYO child's wallet shows as `<Name>'s wallet`. The OWS-managed child should NOT appear in the allowlist (its OWS-created wallet is generated server-side and lands on the allowlist via `buildAuthorizedDestinations` — verify it shows as an "Authorized address" entry; if not, that's a real C10 bug).

4. Paste the magic-link URL into Claude Desktop and run `check-goals` for one of the kids. **Confirm:**
   - **C2 round-trip** — the goal you typed in Step 3 appears in Claude's output with subgoals and deadline intact.

5. Record results (pass/fail per check above) and any screenshots in your local notes. Then trigger Phase 3 (evaluation) — the evaluator will read this file, the contract, and your smoke notes, and grade against the rubric.

**The generator does NOT self-evaluate.** Decisions on Pass / Pass-with-followup / Fail belong to the evaluator after the smoke is in.

---

## Smoke Test Results

- W0–W7 automated smoke: **369 passing + 1 skipped**, `tsc --noEmit` clean, no linter errors across the five edited files.
- W8 manual mobile smoke: **PENDING USER RUN.**
