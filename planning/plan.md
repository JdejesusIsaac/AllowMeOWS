# Sprint 3.0.5 — Plan (Phase 1)

**Sprint type:** Frontend/UX (verify-page bootstrap form extension) + thin HTTP-boundary surfacing
**Rubric weighting:** Func 35% / Auth 15% / Design 40% / Orig 10% (per [`planning/AGENTS.md`](AGENTS.md))
**Inputs:** [`research/research.md`](../research/research.md) (spike-resolved, no `⚠️` open)
**Test delta target:** +6 to +9 net tests (backward-compat regression, HTTP body schema for new fields, response carries `authorizedDestinations`, form-render smoke, end-to-end persistence round-trip)
**Duration estimate:** ~5 hours (form work primary; ~30 min for HTTP plumbing)

---

## Feature Summary

Extend [`public/verify.html`](../public/verify.html)'s bootstrap form (`state-family-create`) so it can collect everything Sprints 3.0.2 / 3.0.3 / 3.0.4 added to the backend, and surface the Sprint 3.0.2 allowlist in the success state. Three deliverables:

1. **Per-child `walletAddress` input** (optional, regex-validated on blur) — feeds the Sprint 3.0.2 allowlist via `buildAuthorizedDestinations`.
2. **Per-child `learningGoals` section** — up to 5 goals per child, each with `topic` + `category` (dropdown sourced from the child's just-configured categories) + optional `subgoals` (up to 5, topic only) + optional native `<input type="date">` deadline serialized as `${YYYY-MM-DD}T00:00:00.000Z`.
3. **Post-submit allowlist transparency panel** — renders in `renderSuccess()` before the magic-link URL, listing admin wallet + each child's wallet, sourced from a new `authorizedDestinations` field on the `/api/configure-family` response.

The HTTP boundary at [`app/verify-routes.ts`](../app/verify-routes.ts) gets two additive changes (locked by Phase 0.5 spike):

- `configureFamilyBodySchema.learningGoals` accepts `subgoals` (array of `{topic}`, max 20) and `deadline` (ISO datetime).
- `/api/configure-family` response includes `authorizedDestinations: string[]`, populated from the resolved `buildAuthorizedDestinations` result inside `bootstrapFamily()`.

No schema changes. No new tools. No new endpoints. The form learns to ask for what the persistence schema already accepts, and the HTTP boundary stops dropping the new fields.

---

## Architecture Decisions

Locked from [`research/research.md`](../research/research.md) D1–D10 plus Spike Results.

### D1 — Per-child nesting (Option A)
Goals nest inside each `child-row` in `public/verify.html`, after the categories block and before the optional remove button. The category dropdown for each goal reads directly from `child.categories[].name`, eliminating cross-reference validation.

### D2 — Form caps (5 goals / 5 subgoals)
Persistence schema caps at 20 (`src/schemas.ts:44, 68`); form caps at 5 per child / 5 per goal as UX guardrail. "+ Add" buttons disable at the cap. Parents needing more configure post-bootstrap via Claude `configure-policy`.

### D3 — All new fields optional, old payload still valid
Backward-compat is the central correctness bar. Old form payload (no `walletAddress`, no `learningGoals`) must still create a valid family with empty goals and an auto-created managed wallet per child. A dedicated regression test in `tests/verify-routes.test.ts` locks this contract.

### D4 — Native `<input type="date">` for deadlines
Submit handler converts `YYYY-MM-DD → YYYY-MM-DDT00:00:00.000Z`. Mobile-native picker; no JS date library. Fallback to `<input type="text" pattern="\d{4}-\d{2}-\d{2}">` only if iOS smoke test surfaces a real issue (W6).

### D5 — Wallet validation: client-side regex on blur, server-side `tryNormalizeWallet` authoritative
Regex `/^0x[a-fA-F0-9]{40}$/` for immediate UX feedback only. `src/auth/wallet.ts:35` enforces canonical normalization at the persistence boundary via viem's `isAddress`. Defense-in-depth, not replacement.

### D6 — Post-submit allowlist transparency panel
Renders in `renderSuccess({kind: "create", ...})` before the existing `success-url` block. Lists admin wallet (from `walletAddress` already captured in the SIWE session) + each entry from `response.authorizedDestinations` not equal to the admin (so child wallets render as "Sofia's wallet (BYO)" vs "Sofia's wallet (AllowMe-managed)" — distinguishable by whether the parent supplied an address). One-line explainer: "These are the only addresses the family treasury can send USDC to. Update this list with Claude using `configure-policy`."

### D7 — Single-file vanilla JS, zero new npm deps
All work lives in `public/verify.html`. No React, no Formik, no date library, no Tailwind addition. The form is one file by Sprint 3.0 v4 Decision 2 — Sprint 3.0.5 preserves that commitment.

### D8 — HTTP body schema mirror (locked in spike Q1)
`configureFamilyBodySchema.learningGoals` extended to accept `subgoals: z.array(z.object({topic: z.string().min(1).max(200)})).max(20).optional()` and `deadline: z.string().datetime().optional()`. ~8 added lines. Additive; old payloads validate as before.

### D9 — Response carries `authorizedDestinations` (locked in spike Q2)
`ConfigureFamilyBootstrapResult` interface extended with `authorizedDestinations: string[]`; populated from the resolved `allowlist.destinations` already computed by `buildAuthorizedDestinations` at `src/core/configure-family.ts:257`; passed through in the `res.json({...})` block at `app/verify-routes.ts:329–339`. ~5 added lines.

### D10 — No editing of Windsurf source material
[`sprint-3.0.5/plan-3.0.5.md`](../sprint-3.0.5/plan-3.0.5.md) and siblings are read-only references. The canonical artifacts for this sprint are `research/research.md`, `planning/plan.md`, `planning/contract.md`, `implementation/progress.md`, `evaluation/test.md`.

---

## Implementation Steps

Six workstreams, sequenced to keep the backward-compat regression test green at every checkpoint.

### W0 — Pre-sprint backstop (10 min)
1. Confirm [`src/schemas.ts:30–34, 36–49, 52–69, 72–84`](../src/schemas.ts) contains `SubgoalSchema`, `LearningGoalSchema.subgoals/deadline`, `ChildConfigSchema.walletAddress`, `FamilyConfigSchema.authorizedDestinations` as documented in research. (Verified in spike; smoke check the file hasn't drifted.)
2. Run `npx vitest run` → expect 363 passing + 1 skipped (Sprint 3.0.2 baseline).
3. Run `npx tsc --noEmit` → expect clean.

**Exit:** baseline locked; any drift halts the sprint before touching code.

### W1 — Backward-compat regression test FIRST (25 min)
**File:** `tests/verify-routes.test.ts` (extend).

Before any UI work, write the regression bar. New test `HE5c` posts the *old* form's payload shape (no `walletAddress`, no `learningGoals`) to `/api/configure-family`, asserts:
- 200 response, `body.ok === true`
- `body.familyId`, `body.memberId`, `body.setupCode`, `body.mcpUrl` populated
- The persisted `FamilyConfig` (loaded via `StateManager.loadFamilyConfig(familyId)`) has `children[0].learningGoals === undefined` (or empty array — read the existing `normalizeChildren` behavior to lock which) and `children[0].walletAddress === undefined`
- `body.authorizedDestinations` is an array containing the SIWE-verified manager wallet (lowercased)

This test must pass with the existing code before any other work. After W1, every subsequent step runs this test between checkpoints. **If it ever fails, stop and revert.**

**Exit:** HE5c green; 364 passing total.

### W2 — HTTP boundary extensions (D8 + D9) (30 min)
**Files:** [`app/verify-routes.ts`](../app/verify-routes.ts), [`src/core/configure-family.ts`](../src/core/configure-family.ts).

1. Extend `configureFamilyBodySchema.learningGoals` per D8 spike diff. Verify `npx tsc --noEmit` clean.
2. Extend `ConfigureFamilyBootstrapResult` and `bootstrapFamily()` return statement per D9 spike diff.
3. Extend the `res.json({...})` block at verify-routes.ts:329–339 to include `authorizedDestinations`.
4. Add a new test `HE5d` to `tests/verify-routes.test.ts`: post a payload WITH `walletAddress` and a goal containing `subgoals` + `deadline`; assert the persisted `FamilyConfig.children[0]` has the goal with `subgoals.length === 2` and `deadline` matches `${date}T00:00:00.000Z`. Also assert `body.authorizedDestinations` includes the lowercased child wallet AND the manager wallet.
5. Run `HE5c` (backward-compat) — must still pass. Run `HE5d` (new). Run full suite — must be 365 passing.

**Exit:** Both new HTTP-layer tests green; 365 passing; no existing test regressed.

### W3 — Form field additions (W1 from Windsurf plan recast, ~1.5h)
**File:** [`public/verify.html`](../public/verify.html).

Following the Windsurf workstream decomposition (W1.1–W1.6) but recast against current code paths and harness rubric weights (Design 40%):

1. **W3.1 — `walletAddress` per child (20 min):** Extend `blankChildRow()` at lines 618–629 with `walletAddress: ""`. Extend `renderChildren()` at lines 632–689 to add `<input type="text" data-field="walletAddress" placeholder="0x… (optional)">` immediately after the name input, with helper text `Leave blank to have AllowMe create a wallet for this child.` Wire to `child.walletAddress = e.target.value.trim()` in the input handler.
2. **W3.2 — Goals section header + "+ Add learning goal" button (30 min):** Extend `blankChildRow()` with `learningGoals: []`. In `renderChildren()`, after the categories block, append a `<div data-goals>` container plus a `<button data-add-goal>` (disabled when `child.learningGoals.length >= 5`). Click handler pushes `{topic: "", category: "", subgoals: [], deadline: ""}` and re-renders.
3. **W3.3 — Goal row template (30 min):** For each goal in `child.learningGoals`, render `<input type="text" data-goal-field="topic">`, `<select data-goal-field="category">` populated from `child.categories.map(c => c.name)`, `<input type="date" data-goal-field="deadline">`, "+ Add subgoal" button (capped at 5), "× Remove goal" button.
4. **W3.4 — Subgoal sub-row template (15 min):** For each subgoal, render `<input type="text" data-subgoal-field="topic">` + "× Remove subgoal" button.
5. **W3.5 — Cap enforcement (15 min):** Disable "+ Add goal" when `learningGoals.length >= 5`; disable "+ Add subgoal" when `subgoals.length >= 5`. Disabled buttons must include `aria-disabled="true"` and visually grey out.

After W3, the form renders correctly; submission still posts the existing field set (W4 wires the new fields).

**Exit:** Form renders without console errors on every recent Chrome / Safari / mobile Safari. HE5c still green. Run a manual smoke: open `public/verify.html` via `python3 -m http.server 0` and verify the new fields appear, add/remove buttons work, caps engage.

### W4 — Submit serializer (45 min)
**File:** [`public/verify.html`](../public/verify.html) (`submitFamilyCreate()` at lines 691–751).

1. **W4.1 — `walletAddress` (15 min):** In the children-loop validation block, for each `c`: if `c.walletAddress` is a non-empty string, validate `/^0x[a-fA-F0-9]{40}$/`. If malformed, set `alertEl.textContent` to `Wallet for ${c.name} must start with 0x and have 40 hex characters.` and return. If empty string, omit the field entirely from the posted payload (not `walletAddress: ""` — that fails `tryNormalizeWallet`).
2. **W4.2 — `learningGoals` (30 min):** Build a `cleanedChildren` array. For each `child`:
   - Filter `learningGoals` to those with non-empty `topic.trim()`.
   - For each kept goal: keep `topic.trim()`, `category` (already from dropdown so valid), filter `subgoals` to those with non-empty `topic.trim()` and pass through `[{topic}]` shape only (no `completed` — that's set in `normalizeChildren`), and if `deadline` is a non-empty string, append `T00:00:00.000Z`.
   - If after filtering `learningGoals` is empty, omit the field entirely (don't post `learningGoals: []` since the backend treats `undefined` and `[]` identically but the simpler shape is cleaner).
   - Same for `walletAddress`: omit if empty.

**Exit:** Submit POSTs the richer payload; HE5c still green; new HE5d (or its UI equivalent) passes when run against the form's submitted payload.

### W5 — Inline validation feedback (30 min)
**File:** [`public/verify.html`](../public/verify.html).

1. **W5.1 — Wallet regex on blur (15 min):** Wire a `blur` listener on each `walletAddress` input that shows an inline error span (`<span class="alert alert-error">…</span>`) under the input when the value is non-empty and malformed. Clear the error on subsequent valid input. Use the same `escapeHtml`-safe rendering helpers already in `verify.html`.
2. **W5.2 — Goal topic required-when-others-present (15 min):** On submit attempt, if any goal has `subgoals.length > 0` OR `deadline` OR a non-default `category`, the goal's `topic` must be non-empty. Inline error under that goal's topic input on submit failure; cleared on the next render.

**Exit:** UX feedback is immediate and clear; W3 manual smoke shows red error states correctly.

### W6 — Post-submit allowlist transparency panel (D6) (30 min)
**File:** [`public/verify.html`](../public/verify.html) (`renderSuccess()` at lines 805–845).

1. **W6.1 — Panel render:** Extend `renderSuccess({kind, role, mcpUrl, familyName, childName, authorizedDestinations, children})` signature. For `kind === "create"`, render before the existing `<div>` that contains the magic-link URL:

```html
<div class="alert" style="border-color: var(--brand); background: rgba(0,82,255,.04);">
  <strong>Your family's allowlist</strong>
  <p class="muted">USDC transfers from the treasury can only land at these addresses. You can change this list later by asking Claude to <code>configure-policy</code>.</p>
  <dl class="kv">
    <!-- one row per address -->
  </dl>
</div>
```

Each `<dt>/<dd>` row: `<dt>{label}</dt><dd>{checksummed-truncated-address}</dd>`, where label is "Admin (you)" for the manager wallet, "{childName}'s wallet" for each child, falling back to "Authorized address {n}" if unmatched. Render in order: admin first, then children matching by lowercased equality between `authorizedDestinations[]` and each `child.wallet` from the response, then any unmatched extras.

2. **W6.2 — Wire submitFamilyCreate response into renderSuccess:** Update the call site at `public/verify.html:738–743` to pass `authorizedDestinations: body.authorizedDestinations, children: body.children`.

**Exit:** A bootstrap with a child holding a BYO wallet shows admin + child wallet in the panel; a bootstrap with no BYO wallet shows admin + AllowMe-managed child wallet (the response's `child.wallet` is the auto-created address). Manual smoke confirms.

### W7 — Test updates + docs (30 min)
**Files:** [`tests/verify-page.test.ts`](../tests/verify-page.test.ts), [`README.md`](../README.md).

1. **W7.1 — Verify-page HTML smoke:** Audit `tests/verify-page.test.ts`. The current VP1 test (lines 64–88) asserts on `state-*` container IDs only — unaffected by new fields. No update required unless a new state container is added (none planned).
2. **W7.2 — End-to-end persistence test (optional, ~20 min):** A test that drives a bootstrap with the new fields, then resolves the magic-link `?setup=` to a session and calls the `check-goals` MCP tool (via the existing test harness pattern from `tests/check-goals.test.ts`). Asserts `check-goals` returns the configured goals. This is the truest test of the round-trip but is non-trivial to wire — if it lands quickly, ship it; otherwise defer the MCP-side assertion to the manual W8 smoke.
3. **W7.3 — README:** Append a Sprint 3.0.5 line under the existing Sprint 3.0.2 section noting "bootstrap form learns goals + BYO-wallet; allowlist transparency in success state." Keep to ~3 lines.

**Exit:** All targeted tests green; README current.

### W8 — Manual smoke (Railway + iOS) (30 min)
1. Deploy to Railway preview environment.
2. On real iOS Safari with Coinbase Wallet: complete a full bootstrap with 1 child, 2 goals, 3 subgoals on one goal, a date deadline, and a BYO wallet.
3. Confirm magic-link copy works.
4. In Claude on macOS, add the magic link and call `check-goals` — confirm goals come back with subgoals and `daysUntilDeadline`.
5. Inspect `data/families/{familyId}/family-config.json` — confirm `learningGoals[0].subgoals.length === 3`, `learningGoals[0].deadline` is a valid ISO datetime, and `authorizedDestinations` contains both manager and child addresses lowercased.

**Exit:** End-to-end mobile flow passes; backup verified.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| HTTP body schema change breaks an unobserved test path | Low | Medium | W2 runs full suite before declaring complete; spike already verified `configureFamilyBodySchema` is the only producer/consumer chain |
| Form state desync (e.g., goal removed but DOM still shows it) | Medium | Low | Use the existing pattern from `renderChildren()` — full re-render on each state mutation (no surgical DOM patches). Vanilla-JS array-of-objects pattern proven in Sprint 3.0 v4 W2.2 |
| iOS Safari native date input edge cases | Low | Low | Spike already noted iOS Safari 14+ support; D4 fallback locked but not pre-built. W8 smoke catches |
| Allowlist panel reveals address even when manager declined to set one for a child | Low | Low | The response's `authorizedDestinations` is exactly what the backend enforces; if a child's address is missing it's because no wallet was set — the panel correctly shows "AllowMe-managed wallet (created automatically)" for that case |
| Backward-compat regression test (HE5c) writes against an evolving response shape | Low | Medium | W1 explicitly locks the *additive* nature: HE5c asserts ON known fields only, doesn't assert response keys are exhaustive. Anything new is non-breaking |
| Sprint 3.0.5 expands beyond UI + HTTP boundary into core logic | Medium | High | Scope guard: any change to `src/core/configure-family.ts` beyond the ~5 lines in D9 spike diff stops the sprint. If a deeper change becomes necessary, declare scope creep and re-negotiate the contract |
| Generator self-evaluates and grades the work | N/A | Critical | Hard rule per [`AllowMeOWS/AGENTS.md`](../AGENTS.md) Rule 1 + hook enforcement. Generator must stop after W8 and hand off to evaluator |

---

## Fallback approaches

- **iOS date input fails:** swap to `<input type="text" pattern="\d{4}-\d{2}-\d{2}">` with helper text. Cosmetic regression only.
- **Subgoal UI feels too dense on mobile:** ship goals without subgoals, defer subgoals UI to Sprint 3.5. `check-goals` handles goals-without-subgoals gracefully (covered by `tests/check-goals.test.ts`).
- **Transparency panel feels intrusive:** turn into a collapsible `<details>/<summary>` block — same content, less visual weight. Decision deferred until W8 smoke feedback.
- **Backward-compat regression reveals an actual incompatibility:** stop, root-cause, do not work around. If HE5c ever fails post-W2, the sprint is on hold until the regression is fixed at the upstream cause (per Sprint 3.0.2 progress.md "Failed Approaches" discipline).

---

## How to use this plan

Execution order, with each W-step a checkpoint that re-runs the regression test:

1. W0 — backstop (locks baseline)
2. W1 — write HE5c FIRST (regression bar before any code change)
3. W2 — HTTP boundary additions; HE5c green, HE5d green
4. W3 — form fields; HE5c green
5. W4 — submit serializer; HE5c green; HE5d green
6. W5 — validation feedback
7. W6 — transparency panel
8. W7 — test/docs cleanup
9. W8 — Railway + iOS smoke
10. Hand off to evaluator. Do NOT self-grade.

Total: ~5 hours. The generator follows this plan AND [`planning/contract.md`](contract.md) (negotiated next).
