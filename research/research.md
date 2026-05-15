# Sprint 3.0.5 — Research (Phase 0b)

## Relevance Summary

Sprint 3.0.5 closes a UX gap between the verify-page bootstrap form (`public/verify.html`) and the backend features shipped by Sprints 3.0.2 (destination allowlist), 3.0.3 (`learningGoals` + `check-goals`), and 3.0.4 (`subgoals` + `deadline`). Three problems frame the work:

1. **Form doesn't surface `learningGoals`** — `LearningGoalSchema` is in `src/schemas.ts:36–49` with `subgoals.max(20)` + `deadline.datetime()`, but the form's child template (`public/verify.html:638–653`) collects only `name / weeklyBudget / savingsPercent / categories`. New families ship with empty goals; `check-goals` returns the empty-state for everyone.
2. **Form doesn't surface per-child `walletAddress`** — `ChildConfigSchema.walletAddress` is optional (`src/schemas.ts:55`) and `buildAuthorizedDestinations` (`src/core/configure-family.ts:120–190`) auto-adds each child wallet to the allowlist. The form has no input, so parents must context-switch to Claude to bind external kid wallets.
3. **Allowlist is invisible** — `FamilyConfig.authorizedDestinations` is enforced on the child-wallet leg of `distribute-allowance` and `release-savings` (Sprint 3.0.2), but the verify-page success state shows only the magic-link URL. Parents cannot see what addresses the treasury is authorized to send to.

The Windsurf doc [`sprint-3.0.5/research-3.0.5.md`](../sprint-3.0.5/research-3.0.5.md) frames this work as "UI-only, no backend changes." Grounding that framing against current code reveals a gap (see Open Questions Q1, Q2) — the HTTP boundary layer is stricter than the persistence schema. The spike resolves whether the gap is closed with a 10-line additive backend change or worked around in the form.

## Actionable Insights

Distilled from [`sprint-3.0.5/research-3.0.5.md`](../sprint-3.0.5/research-3.0.5.md) "Locked decisions" and validated against current code:

**D1 — Per-child nesting (Option A).** Learning goals render inside each child block, after `categories`, before the per-child remove button. The child template already loops `child.categories` (`public/verify.html:655–669`); add a parallel `child.learningGoals` loop with the same DOM pattern. Mirrors `ChildConfigSchema.learningGoals` (per-child) and lets the category dropdown read directly from `child.categories[].name` without cross-referencing.

**D2 — Form caps: 5 goals/child, 5 subgoals/goal.** The schema cap is 20 for both (`src/schemas.ts:44, 68`); the form cap is a UX guardrail. Parents exceeding 5 can configure post-bootstrap via Claude `configure-policy`. Disable the "+ Add" buttons at the cap.

**D3 — Optional fields, no required additions.** All new inputs (`walletAddress`, goals, subgoals, deadlines) are optional. Old form payload (no new fields) must still succeed — this is the backward-compat regression bar.

**D4 — Native `<input type="date">` for deadlines, serialized via `${date}T00:00:00.000Z`.** `LearningGoalSchema.deadline` is `z.string().datetime()`. Submit handler converts `YYYY-MM-DD → YYYY-MM-DDT00:00:00.000Z` before posting. Mobile-native date picker on iOS/Android; no JS date-library dependency.

**D5 — Client-side wallet regex on blur, server-side `tryNormalizeWallet` authoritative.** Regex `/^0x[a-fA-F0-9]{40}$/` for immediate feedback; `src/auth/wallet.ts:35` validates with viem's `isAddress` at the persistence boundary. Defense-in-depth, not replacement.

**D6 — Post-submit allowlist transparency panel.** Renders after `renderSuccess({kind: "create"})` (`public/verify.html:805–845`), before the `success-url` block. Lists admin wallet + each child's wallet + one-line explainer. Q3 below confirms data source.

**D7 — Single-file vanilla JS, zero new deps.** `public/verify.html` is a single static file (Sprint 3.0 v4 Decision 2). Add fields by extending `renderChildren()` (`public/verify.html:632–689`), the submit serializer (`submitFamilyCreate()` lines 691–751), and `renderSuccess()`. No React, no Tailwind addition, no bundler.

**D8 — Backend allowlist auto-populate already handles BYO-wallet correctly.** `buildAuthorizedDestinations` (`src/core/configure-family.ts:120–190`) force-adds caller + every `child.walletAddress`. If the form posts `walletAddress`, the bootstrap audit entry `authorized-destinations-updated` (`src/core/configure-family.ts:317–329`) records the resolved list — no new core logic needed.

**D9 — `normalizeChildren` already passes subgoals + deadline through.** `src/core/configure-family.ts:591–599` reads `g.subgoals` and `g.deadline` from input and writes them into `ChildConfig.learningGoals`. The pipeline from `/api/configure-family` body → `normalizeChildren` → `configureFamilyCore` → persistence is already wired for the richer payload IF the HTTP body schema accepts it (see Q1).

**D10 — `validateChildren` accepts the richer goal shape.** `src/core/configure-family.ts:526–555` signature already takes `subgoals?` and `deadline?`. No change.

## Open Questions

### ⚠️ Q1 — HTTP body schema strips `subgoals` and `deadline`

`configureFamilyBodySchema` at [`app/verify-routes.ts:94–102`](../app/verify-routes.ts):

```ts
learningGoals: z
  .array(z.object({
    topic: z.string().min(1).max(200),
    category: z.string().min(1),
  }))
  .max(20)
  .optional(),
```

Zod's default `.strict()` mode is off here, so unknown keys are silently stripped, not rejected. The form would post `{topic, category, subgoals, deadline}` and the HTTP layer would drop `subgoals` + `deadline` before `normalizeChildren` runs. Net effect: the form looks like it works, but the persisted `ChildConfig.learningGoals` never gets the new fields.

This contradicts the Windsurf plan's "no backend changes" framing. Either:
- **Option A (spike-recommended):** Extend `configureFamilyBodySchema` to mirror `LearningGoalSchema`'s `subgoals` + `deadline` shape. ~5-line additive change. Backward-compat preserved (both fields stay optional).
- **Option B:** Ship the form fields without `subgoals`/`deadline`, defer those UI pieces to a follow-on sprint. Sacrifices D2/D4 above.

Spike must confirm Option A's diff is genuinely additive (no test breakage in 363 existing tests) and that the response chain (D9) carries the new fields end-to-end.

### ⚠️ Q2 — `/api/configure-family` response omits `authorizedDestinations`

The response (verify-routes.ts:329–339) returns `{ok, familyId, memberId, familyName, children, mcpUrl, setupCode, sessionToken, network}`. `children` is the `ChildConfigSummary[]` from `buildChildrenSummary` (`src/core/configure-family.ts:504–519`), which exposes per-child `wallet` (string, "OWS-managed" if not BYO) but NOT the resolved allowlist.

D6's transparency panel needs the canonical allowlist source. Two options:
- **Option A (spike-recommended):** Add `authorizedDestinations: string[]` to the response, sourced from `FamilyConfig.authorizedDestinations` after `configureFamilyCore` resolves. ~3-line additive change. Lets the panel render the actual enforced list.
- **Option B:** Derive the panel client-side from `managerWalletAddress` (already in session claims) + the per-child `wallet` field in the response. Drift risk if backend logic changes; no audit-trail equivalence.

Spike confirms Option A is the correct surface and that it doesn't leak data inappropriately (allowlist is family-scoped, caller is the family's manager).

### Q3 — Cursor-harness research path coexistence with Windsurf docs

Resolved inline (no `⚠️`): the Cursor v3 path `research/research.md` is canonical going forward. [`sprint-3.0.5/research-3.0.5.md`](../sprint-3.0.5/research-3.0.5.md), [`plan-3.0.5.md`](../sprint-3.0.5/plan-3.0.5.md), [`test-3.0.5.md`](../sprint-3.0.5/test-3.0.5.md), [`progress-3.0.5.md`](../sprint-3.0.5/progress-3.0.5.md) are read-only source material the planner can cite; they do not get edited.

### Q4 — Mobile date input on iOS Safari

Resolved inline (no `⚠️`): native `<input type="date">` is well-supported on iOS Safari 14+; Sprint 3.0 v4 already ships number/text inputs with `font-size: 16px` to avoid auto-zoom (`public/verify.html:110`). If the smoke test in W6 surfaces a real issue, fallback is `<input type="text" pattern>` — captured as a fallback decision, not a blocker.

## Key Code References

- **Form structure:** [`public/verify.html:291–310`](../public/verify.html) (`state-family-create` section), [`public/verify.html:618–629`](../public/verify.html) (`blankChildRow()`), [`public/verify.html:632–689`](../public/verify.html) (`renderChildren()`), [`public/verify.html:691–751`](../public/verify.html) (`submitFamilyCreate()`), [`public/verify.html:805–845`](../public/verify.html) (`renderSuccess()`).
- **HTTP body schema (Q1):** [`app/verify-routes.ts:76–107`](../app/verify-routes.ts) (`configureFamilyBodySchema`).
- **HTTP response shape (Q2):** [`app/verify-routes.ts:329–339`](../app/verify-routes.ts).
- **Endpoint handler:** [`app/verify-routes.ts:264–340`](../app/verify-routes.ts) (`POST /api/configure-family`).
- **Persistence schema:** [`src/schemas.ts:30–34`](../src/schemas.ts) (`SubgoalSchema`), [`src/schemas.ts:36–49`](../src/schemas.ts) (`LearningGoalSchema`), [`src/schemas.ts:52–69`](../src/schemas.ts) (`ChildConfigSchema`), [`src/schemas.ts:72–84`](../src/schemas.ts) (`FamilyConfigSchema`).
- **Core domain:** [`src/core/configure-family.ts:120–190`](../src/core/configure-family.ts) (`buildAuthorizedDestinations`), [`src/core/configure-family.ts:243–345`](../src/core/configure-family.ts) (`bootstrapFamily`), [`src/core/configure-family.ts:526–555`](../src/core/configure-family.ts) (`validateChildren`), [`src/core/configure-family.ts:562–602`](../src/core/configure-family.ts) (`normalizeChildren`).
- **Wallet normalization:** [`src/auth/wallet.ts:35`](../src/auth/wallet.ts) (`tryNormalizeWallet`).
- **Tests to extend or leave intact:** [`tests/verify-page.test.ts`](../tests/verify-page.test.ts) (HTML smoke — VP0/VP1/VP2/VP3, asserts state container IDs only), [`tests/verify-routes.test.ts:125–168`](../tests/verify-routes.test.ts) (HE5 bootstrap happy path — the regression baseline).
- **Source material (Windsurf):** [`sprint-3.0.5/plan-3.0.5.md`](../sprint-3.0.5/plan-3.0.5.md), [`sprint-3.0.5/research-3.0.5.md`](../sprint-3.0.5/research-3.0.5.md), [`sprint-3.0.5/test-3.0.5.md`](../sprint-3.0.5/test-3.0.5.md), [`sprint-3.0.5/progress-3.0.5.md`](../sprint-3.0.5/progress-3.0.5.md).
- **Checkpoint:** [`sprint-3.0.2/progress-3.0.2.md`](../sprint-3.0.2/progress-3.0.2.md) (Sprint 3.0.2 complete, 363 passing + 1 skipped).

## Spike Results

Time-boxed at 30 minutes per [`AGENTS.md`](../AGENTS.md) rule 5. Spike was scoped strictly to resolving Q1 and Q2 by reading existing code paths, not by writing any implementation. No files were modified.

### Q1 resolution — extend `configureFamilyBodySchema` to accept `subgoals` + `deadline`

**Decision: Option A (additive HTTP schema extension).**

**Confirmed facts from current code:**

- Zod's default `z.object()` behavior strips unknown keys silently; the current schema at [`app/verify-routes.ts:94–102`](../app/verify-routes.ts) does not use `.strict()`, so a form payload containing `subgoals`/`deadline` is accepted by the endpoint but the extra fields are dropped before [`normalizeChildren`](../src/core/configure-family.ts) runs (lines 562–602). Net effect today: form data flows in, persistence drops it — silent data loss.
- `normalizeChildren` (src/core/configure-family.ts:591–599) already reads `g.subgoals` and `g.deadline` from input and writes them into the persisted `ChildConfig.learningGoals` shape. The persistence half of the pipeline is already correct.
- `validateChildren` (src/core/configure-family.ts:526–555) already declares `subgoals?: Array<{topic: string}>` and `deadline?: string` in its input shape. No signature change required.

**Minimal diff** (locked for the planner — generator will land this in implementation):

```ts
learningGoals: z
  .array(z.object({
    topic: z.string().min(1).max(200),
    category: z.string().min(1),
    subgoals: z
      .array(z.object({ topic: z.string().min(1).max(200) }))
      .max(20)
      .optional(),
    deadline: z.string().datetime().optional(),
  }))
  .max(20)
  .optional(),
```

Additive change (~8 lines). Backward-compat preserved by `.optional()`: old payloads without `subgoals`/`deadline` still validate as before. No existing test references these fields on the HTTP layer (greps in `tests/verify-routes.test.ts`, `tests/magic-link-persistence.test.ts` confirm).

**Risk assessment:** Zero compatibility risk. The pre-existing `LearningGoalSchema` already mandates `subgoals.max(20)` and `deadline.datetime()`; the HTTP boundary just needs to mirror it.

### Q2 resolution — expose `authorizedDestinations` in `/api/configure-family` response

**Decision: Option A (additive response field, sourced from the resolved `allowlist.destinations` returned by `buildAuthorizedDestinations`).**

**Confirmed facts from current code:**

- [`bootstrapFamily`](../src/core/configure-family.ts) (lines 243–345) already computes `allowlist.destinations` at line 257 and persists it into `familyConfig.authorizedDestinations` at line 272. The value is available locally; it just isn't included in the returned `ConfigureFamilyBootstrapResult` (lines 192–201).
- The HTTP response shape at [`app/verify-routes.ts:329–339`](../app/verify-routes.ts) returns `{ok, familyId, memberId, familyName, children, mcpUrl, setupCode, sessionToken, network}`. Adding a new key is additive — Zod runs on the request body only, not the response.
- No existing test asserts on the response's strict shape (no `toEqual`, no `toMatchObject` against a closed object). HE5 (`tests/verify-routes.test.ts:125–168`) asserts each known key individually; `tests/magic-link-persistence.test.ts:144–155` reads only `cfg.familyId | memberId | setupCode | mcpUrl`. Adding a new field cannot break them.

**Minimal diff** across two files (locked for the planner):

`src/core/configure-family.ts` — extend the result interface and populate from the resolved allowlist:

```ts
export interface ConfigureFamilyBootstrapResult {
  ok: true;
  bootstrap: true;
  familyId: string;
  memberId: string;
  setupCode: string;
  mcpUrl: string;
  familyName: string;
  children: ChildConfigSummary[];
  authorizedDestinations: string[];
}
```

And inside `bootstrapFamily()`'s return statement at lines 335–344:

```ts
return {
  ok: true,
  bootstrap: true,
  familyId,
  memberId,
  setupCode,
  mcpUrl,
  familyName: input.familyName,
  children: buildChildrenSummary(input.children),
  authorizedDestinations: allowlist.destinations,
};
```

`app/verify-routes.ts` — pass through in the JSON response at lines 329–339:

```ts
return res.json({
  ok: true,
  familyId: result.familyId,
  memberId: result.memberId,
  familyName: result.familyName,
  children: result.children,
  authorizedDestinations: result.authorizedDestinations,
  mcpUrl: result.mcpUrl,
  setupCode: result.setupCode,
  sessionToken: newSession,
  network: useTestnet ? "Base Sepolia (testnet)" : "Base (mainnet)",
});
```

Total Q2 diff: ~5 lines added across two files. Additive; no test breakage; no leak — the response is already gated behind the SIWE-verified session token for the family's manager (`claims.walletAddress`), and the allowlist is family-scoped.

**Symmetry note (out of Sprint 3.0.5 scope):** `ConfigureFamilyUpdateResult` could carry the same field for consistency when the existing `configure-policy` MCP tool runs an update; that's a Sprint 3.5 polish item, not blocking here.

### Spike summary — scope reframe

Sprint 3.0.5 is **not** pure UI-only as the Windsurf plan framed it. It is "verify-page form extension + ~13 lines of additive HTTP boundary changes to surface what the persistence schema already accepts." The reframe matters for:

- **Contract scope:** the negotiated contract must include the two backend additions as explicit deliverables, not hide them behind "no backend changes."
- **Rubric weighting:** still Frontend/UX-dominant (Func 35 / Auth 15 / Design 40 / Orig 10) per [`planning/AGENTS.md`](../planning/AGENTS.md). The backend additions are HTTP-boundary plumbing, not auth/security work.
- **Failure modes:** if the planner forgot the HTTP body schema extension, the form would silently lose `subgoals` + `deadline` on submit — a "looks like it works" failure mode of the kind the evaluator's bias-toward-failure rule (`@evaluator` Mode B) is meant to catch. The spike removes this risk by surfacing it pre-implementation.

Both `⚠️` markers above are resolved; the planning phase is unblocked.
