# Plan — `view-policy` MCP tool

**Sprint:** 3.0.6 (proposed — patch-level, additive only) OR 3.1.0 (minor, per Windsurf draft) — user decides in contract negotiation.
**Source:** [`research/research.md`](../research/research.md) — spike resolved S1–S5; OQ1/OQ2/OQ4/OQ5 deferred to contract negotiation.
**Depends on:** Sprint 3.0.2 (`authorizedDestinations` write path), Sprint 3.0.5 (verify-page bootstrap form — live data source).
**Class:** Security-critical — RBAC-sensitive read tool exposing custody-adjacent state across 5 roles. Rubric weight per [`planning/AGENTS.md:18`](AGENTS.md): **Func 30 / Auth/Security 50 / Design 10 / Originality 10**.

---

## Feature summary

Add `view-policy`, a read-only MCP tool that surfaces family policy (children config, categories, savings %, learning goals, authorized destinations, summary aggregates) through the existing decryption layer. Role-aware filtering across `manager | co-parent | advisor | family | learner`. Section filter (`all | summary | children | destinations | learning-goals`). Child scoping via `childName`. Wallet redaction via `includeWallets`. Destination provenance discriminator (`source: "force-added" | "configured"`). `policyVersion` monotonic counter shipped (no enforcement yet — foothold for a future optimistic-concurrency guard). 60s in-memory cache with synchronous write-invalidation.

**Failure modes the plan defends against:**
1. **Role-stripping bug exposes destinations to learner** (research §"Risks", high severity) — addressed by W5's per-cell matrix test (5 roles × 4 sections = 20 cells, every cell asserted).
2. **`policyVersion` non-monotonic across writes** — addressed by W2's increment-by-exactly-1 assertion, not "policyVersion increased".
3. **Cache stale read** — addressed by W6's `configure-policy` write → `policyCache.invalidate()` in the same handler, before the response returns.
4. **Pre-3.0.6 family configs fail to load after schema addition** — addressed by W2's lazy-migration via Zod default and W1's regression bar.
5. **Provenance mislabels a custom-configured wallet as force-added** — addressed by W3's helper unit tests covering manager-only, child-wallet, custom, and the overlap (manager + child + custom in one family).

---

## Architecture decisions (refined from research)

| ID | Decision | Rationale |
|---|---|---|
| D1 | Tool file: `src/tools/view-policy.ts` (new) | Matches existing kebab-case-per-file convention; flat tree at `src/tools/`. |
| D2 | Register via `registerViewPolicyTool(server)` in [`src/index.ts`](../src/index.ts) | Mirrors all 13 existing tool registrations; no tool registry abstraction needed. |
| D3 | RBAC entry: `withAccessControl("view-policy", ...)` | Identical to every existing tool. Tool-level access gated by `ROLE_TOOL_ACCESS`; section-level gated inside handler via `filterPolicyForRole` (D7). |
| D4 | `policyVersion: z.number().int().nonnegative().default(0)` on `FamilyConfigSchema` | Zod default applies on load — lazy migration. `0` = predates the counter; `1+` = has been through ≥1 `configure-policy` call post-3.0.6. |
| D5 | Increment `policyVersion` inside `configureFamilyCore` at the same point `state.saveFamilyConfig` is called | Single write site; no race in single-process Railway. Both bootstrap and update paths increment. |
| D6 | Provenance derived on read: `force-added = managerWallets ∪ childWallets`, everything else `configured` | No storage change. Label union: `"manager-wallet" \| "child:<name>" \| "custom"` (vault labels dropped per research OQ6/S5). |
| D7 | Filter helper: `src/middleware/policy-view-filter.ts` (new) — pure function `filterPolicyForRole(policy, caller, args) → filtered \| error` | Self-contained; unit-testable without the full MCP transport. Holds the 5×4 access-control matrix in one place. |
| D8 | Cache: `src/cache/policy-cache.ts` (new) — Map<familyId, FamilyConfig> with 60s TTL, in-process | Stores decrypted pre-filter config. Filter is cheap; decryption is the expensive op worth caching. Single-process scope (Railway constraint, research D8). |
| D9 | `POLICY_NOT_INITIALIZED` returns success-shaped shell, not error | Bootstrap pollers expect `success: true`; error reserved for unrecoverable states (`FAMILY_NOT_FOUND`, `INSUFFICIENT_ROLE`, `CHILD_NOT_FOUND`). |
| D10 | Default access-control matrix (subject to contract negotiation per ⚠️ OQ1/OQ2/OQ4/OQ5): see below | Defaults match Windsurf proposal; contract pushback may tighten. |

### v1 access-control matrix (locked per [`planning/contract.md`](contract.md) §"Resolved decisions")

**Tool-level gate (`ROLE_TOOL_ACCESS`):** view-policy added for `manager`, `co-parent`, `advisor` only. `family` and `learner` are denied at the `withAccessControl` gate per user-confirmed D-OQ4 (tight v1).

**Filter helper matrix data** (encoded as inspectable data in `policy-view-filter.ts` — all 5 rows so the future sprint adding family/learner inherits cleanly):

| Role | Tool access | children | destinations | learning-goals | summary |
|---|---|---|---|---|---|
| manager | ✅ | full | full | full | full |
| co-parent | ✅ | full | full | full | full |
| advisor | ✅ | full (no wallets — D-OQ1 tight) | full | full | full |
| family | ❌ denied at gate | (data: full, no wallets — D-OQ5 consistent, future use) | (data: hidden — D-OQ2 tight) | (data: full) | (data: full) |
| learner | ❌ denied at gate | (data: own-record only) | (data: hidden) | (data: own-only) | (data: scoped) |

---

## Implementation steps

### W0 — Pre-sprint backstop (10 min)

1. Clean `data/` to avoid Sprint 3.0.5's data-leakage trap (workaround documented in 3.0.5 progress.md).
2. `npx vitest run` → expect **369 passing + 1 skipped** (Sprint 3.0.5 exit state).
3. `npx tsc --project ./tsconfig.json --noEmit` → expect clean.

### W1 — Regression bar tests FIRST (30 min)

Following the Sprint 3.0.5 HE5c precedent. Tests are written BEFORE any code change; they lock the contract before the implementation can violate it.

**File:** [`tests/configure-policy-version.test.ts`](../tests/configure-policy-version.test.ts) (new).

1. **CP-VER1** — `configure-policy` on a fresh family persists `policyVersion: 1` (NOT `0`). Bootstrap path. Loads via `StateManager.loadFamilyConfig`, asserts on the disk shape (per Sprint 3.0.5 E-PB1 disk-shape-is-the-truth pattern).
2. **CP-VER2** — Two consecutive `configure-policy` calls on the same family persist `policyVersion: 2`. Update path. Locks "increments by exactly 1 per write", not "increases".
3. **CP-VER3** — Pre-3.0.6 family configs (missing `policyVersion` field) load with `policyVersion: 0` via Zod default. Backward-compat regression — write a `family-config.json` to disk WITHOUT the field, then `loadFamilyConfig` returns the parsed shape with `policyVersion: 0`.

All three are RED on the current `main` (field doesn't exist yet). W2 makes them GREEN.

### W2 — `policyVersion` schema + increment + lazy migration (30 min)

1. **D4 schema diff:** [`src/schemas.ts:72–84`](../src/schemas.ts) `FamilyConfigSchema` — add one line:
   ```ts
   policyVersion: z.number().int().nonnegative().default(0),
   ```
2. **D5 increment site:** [`src/core/configure-family.ts`](../src/core/configure-family.ts) — find the `state.saveFamilyConfig` call in both `bootstrapFamily` and `updateExistingFamily` paths. Bump `policyVersion` immediately before save:
   ```ts
   const currentVersion = existingConfig?.policyVersion ?? 0;
   const newConfig = { ...config, policyVersion: currentVersion + 1 };
   await state.saveFamilyConfig(familyId, newConfig);
   ```
   Bootstrap path: `existingConfig` is undefined → `currentVersion = 0` → save with `1`. Update path: load existing → increment → save.
3. **W1 regression bar:** CP-VER1, CP-VER2, CP-VER3 must ALL go green after this step. Run between checkpoints.
4. **Full suite:** `npx vitest run` → expect **372 passing + 1 skipped** (369 baseline + 3 W1 tests).
5. `tsc --noEmit` clean.

### W3 — Destination provenance hydration (1 h)

**File:** [`src/middleware/policy-view-filter.ts`](../src/middleware/policy-view-filter.ts) — start the file (filter helper added in W5; provenance helper here).

1. **Helper:** `hydrateDestinations(family: FamilyConfig, managers: Member[]): Array<{ address, label, source }>`.
   ```ts
   // Inputs: the full family config (carries authorizedDestinations + children).
   //         the list of Member records with role === "manager".
   // Output: provenance-tagged array, same order as input authorizedDestinations.
   ```
2. **Logic:**
   - Build `forceAdded: Map<string, string>` (lowercased address → label).
     - For each manager: `forceAdded.set(m.walletAddress.toLowerCase(), "manager-wallet")` (only if walletAddress is present).
     - For each `child` in `family.children`: if `child.walletAddress` is set, `forceAdded.set(child.walletAddress.toLowerCase(), \`child:${child.name}\`)`.
   - Map each entry of `family.authorizedDestinations` to either the matching force-added label (and `source: "force-added"`) or `{ label: "custom", source: "configured" }`.
3. **Unit tests** ([`tests/policy-view-filter.test.ts`](../tests/policy-view-filter.test.ts) new):
   - **PV-H1:** Manager wallet only (no children configured) → 1 entry tagged `manager-wallet`/`force-added`.
   - **PV-H2:** Manager + 2 children, no custom → 3 entries, all `force-added`, labels match.
   - **PV-H3:** Manager + 1 child + 1 custom configured address → 3 entries, 2 force-added, 1 `custom`/`configured`.
   - **PV-H4:** Multiple managers (legacy promoted co-parent) → all matched as `manager-wallet`.
   - **PV-H5:** Address case-insensitive matching (input: mixed-case; allowlist: lowercase) → still matched correctly.

### W4 — `view-policy` tool handler skeleton (2 h)

**File:** [`src/tools/view-policy.ts`](../src/tools/view-policy.ts) (new).

1. **Input schema** (Zod):
   ```ts
   section: z.enum(["all", "summary", "children", "destinations", "learning-goals"]).default("all"),
   childName: z.string().optional(),
   includeWallets: z.boolean().default(true),
   ...rbacFields,
   ```
2. **Handler structure** — mirrors `check-goals.ts`:
   ```ts
   withAccessControl("view-policy", async (args, caller) => {
     if (!caller) return buildNoIdentityResponse("view-policy");
     // 1. Load policy from cache or state.loadFamilyConfig(caller.familyId)
     // 2. If null → return POLICY_NOT_INITIALIZED shell (success: true, empty values)
     // 3. Load managers via state.loadMembers(familyId).filter(role==="manager")
     // 4. Hydrate provenance via W3 helper
     // 5. Apply filterPolicyForRole(policy, caller, args) — returns filtered shape or { error }
     // 6. If filter returns error → forbidden response
     // 7. Return jsonResponse({ success: true, ...filteredPolicy, message })
   })
   ```
3. **Tests** ([`tests/view-policy-tool.test.ts`](../tests/view-policy-tool.test.ts) new) — happy-path only here; access-control matrix lives in W5:
   - **VP-T1:** Manager + section="all" + no childName + includeWallets=true → all sections populated; provenance tagged.
   - **VP-T2:** Manager + section="summary" → only `summary` section non-zero; other sections present but empty arrays.
   - **VP-T3:** Manager + childName="Aiden" → `children[]` filtered to one entry; `learning-goals` scoped.
   - **VP-T4:** Manager + includeWallets=false → `children[].walletAddress` undefined; `authorizedDestinations` UNCHANGED (per Windsurf design decision §"includeWallets stripping destinations too: rejected").
   - **VP-T5:** Family with no policy (call `view-policy` before `configure-policy` ever ran) → returns `success: true` shell with `policyVersion: 0`, `children: []`, `summary: { childCount: 0, ... }`. (Note: requires bootstrapped Manager identity to call — see test setup.)
   - **VP-T6:** Two consecutive `view-policy` calls return identical payloads (locks determinism).

### W5 — Role-based filter helper (`filterPolicyForRole`) (2 h)

**File:** [`src/middleware/policy-view-filter.ts`](../src/middleware/policy-view-filter.ts) (extends W3 file).

1. **Signature:**
   ```ts
   export function filterPolicyForRole(
     fullPolicy: FamilyConfig,
     hydratedDestinations: Array<{ address, label, source }>,
     managers: Member[],
     caller: CallerContext,
     args: { section: SectionEnum; childName?: string; includeWallets: boolean }
   ): FilteredPolicy | { error: "INSUFFICIENT_ROLE" | "CHILD_NOT_FOUND"; ... }
   ```
2. **Matrix encoded as data, not nested switches** — one `const ACCESS_MATRIX` object keyed by `[role][section]` returning `"full" | "scoped" | "stripped" | "hidden"`. Easier to audit; easier for the matrix test to iterate.
3. **`childName` validation:**
   - If `childName` provided and caller's role can see that child → filter children + learning-goals to that name.
   - If `childName` is provided but caller can't see ANY child by that name → `CHILD_NOT_FOUND`; include `validChildNames` ONLY when caller is `manager | co-parent | advisor | family` (NOT learner — prevents sibling enumeration; learner gets `CHILD_NOT_FOUND` with no validChildNames).
4. **Tests** — the 5×4 matrix in `tests/policy-view-filter.test.ts`:
   - **PV-M{role}-{section}** for every (role, section) pair = 20 happy-path matrix tests.
     - Each asserts: forbidden cells return `{ error: "INSUFFICIENT_ROLE" }`; allowed cells return the expected shape (with role-specific stripping applied).
   - **PV-CHILDNAME1:** Manager + childName="ghost" → `CHILD_NOT_FOUND` + `validChildNames: ["Aiden", "Sofia"]`.
   - **PV-CHILDNAME2:** Learner + childName="ghost" → `CHILD_NOT_FOUND` + NO `validChildNames`.
   - **PV-CHILDNAME3:** Learner + childName="<own child name>" → succeeds; learner sees own record only.
   - **PV-CHILDNAME4:** Learner + childName="<sibling name>" → `CHILD_NOT_FOUND` (sibling enumeration blocked).
   - **PV-WALLETS1:** Advisor + includeWallets=true → wallets STILL stripped (advisor's `(no wallets)` rule wins; client preference doesn't override role).
   - **PV-WALLETS2:** Family + includeWallets=true → wallets stripped (per default matrix — contract may revise).

### W6 — Cache layer + invalidation (1 h)

**File:** [`src/cache/policy-cache.ts`](../src/cache/policy-cache.ts) (new).

1. **API:**
   ```ts
   export const policyCache = {
     get(familyId: string): FamilyConfig | undefined;
     set(familyId: string, value: FamilyConfig): void; // 60s TTL
     invalidate(familyId: string): void;
   };
   ```
2. **Implementation:** Map<string, { value: FamilyConfig; expiresAt: number }>. On `get`, check `expiresAt` against `Date.now()`; if expired, delete and return undefined.
3. **Wire into `view-policy.ts`:** before `state.loadFamilyConfig(familyId)`, check cache. On miss, load + set.
4. **Wire into `configure-policy` write path** — at [`src/tools/configure-policy.ts`](../src/tools/configure-policy.ts), after `configureFamilyCore` succeeds, call `policyCache.invalidate(result.familyId)`. Synchronous, same handler, before response returns. No await race.
5. **Tests** ([`tests/policy-cache.test.ts`](../tests/policy-cache.test.ts) new):
   - **PC1:** Get-miss → load → set → get-hit (within 60s window) → same instance returned.
   - **PC2:** Set + advance time past 60s (`vi.useFakeTimers`) → get returns undefined.
   - **PC3:** Set → invalidate → get returns undefined.
   - **PC4:** Integration — `view-policy` → `configure-policy` → `view-policy` → second view returns the post-write state, not the cached pre-write state.

### W7 — RBAC tool registration + ROLE_TOOL_ACCESS expansion (30 min)

1. **[`src/constants.ts`](../src/constants.ts) `ROLE_TOOL_ACCESS`:** Add `"view-policy"` to **manager, co-parent, advisor** allowed lists per the user-confirmed tight_v1 profile (D-OQ4). **Family and Learner do NOT receive view-policy access in v1** — deferred to a follow-up sprint.
2. **[`src/index.ts`](../src/index.ts):** Import + register:
   ```ts
   import { registerViewPolicyTool } from "./tools/view-policy.js";
   // ...after registerConfigurePolicyTool(server):
   registerViewPolicyTool(server);
   ```
3. **Tests** — `VP-T7a` and `VP-T7b` (in [`tests/view-policy-tool.test.ts`](../tests/view-policy-tool.test.ts)):
   - **VP-T7a:** Family role calling `view-policy` returns `buildAccessDeniedResponse` payload (`{ success: false, error: "Access denied. The \"family\" role cannot use \"view-policy\".", role: "family", toolName: "view-policy" }`). NOT a stripped/filtered partial response.
   - **VP-T7b:** Learner role calling `view-policy` returns identical access-denied shape. Locks "tight v1 is enforced at the gate, not by the filter helper".

### W8 — Full suite + README + changelog (30 min)

1. `npx vitest run` clean. Target: **+30 to +40 net new tests** (W1 +3, W3 +5, W4 +6-7, W5 +24-26, W6 +4 = 42–45). Final tally ~411–414 passing + 1 skipped.
2. `npx tsc --noEmit` clean.
3. `README.md` — append Sprint 3.0.6 (Done) block under Sprint 3.0.5; update top-of-file test-count claim (369 → ~412).
4. Confirm no new audit-log enum values were introduced (Sprint 3.0.5 contract precedent — view-policy is read-only and shouldn't produce audit entries).

### W9 — Handoff (10 min)

1. Update `implementation/progress.md` with the W0–W8 state.
2. No mobile/device smoke required — pure backend tool. Optional Claude.ai integration smoke: have a Manager session call `view-policy` from Claude Desktop and confirm the response renders sensibly. **Delegated to user, OR run by generator if MCP test harness is available.**
3. Hand off to evaluator. **No self-grading.**

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `policyVersion` increment site missed in one of the two configure-family paths (bootstrap vs update) | High | W2 tests cover both paths separately (CP-VER1 = bootstrap, CP-VER2 = update). |
| Role-stripping bug exposes destinations to learner | High | W5 matrix test asserts EVERY (role, section) cell, not a representative sample. |
| Cache stale read after `configure-policy` write | High | W6 wires invalidation into the write handler SYNCHRONOUSLY before response (no `await` between save and invalidate). PC4 integration test locks this end-to-end. |
| Family / learner role scope mismatch from existing tools (OQ5) | Medium | Default matrix tracks existing-tool behavior (family sees full children, no wallets); contract negotiation may revise. |
| `policyVersion` collision with future Sprint 3.0.2 hypothetical migration | Low | Field is additive with default — older code paths ignore it. |
| Manager wallet lookup at read time misses legacy promoted-co-parent case (multi-manager family) | Low | W3 PV-H4 covers it; helper iterates ALL managers, not just first. |
| New tests trip the data-leakage trap (Sprint 3.0.5 W0 finding) | Low | Plan inherits the `rm -rf data/families` cleanup pattern between full-suite runs. |

---

## Fallback approaches

- **If W5 access-control matrix proves too complex to land in one workstream:** ship Manager-only first (matrix collapses to 1×4), defer co-parent/advisor/family/learner to W5.5. The tool surface stays the same; only `ROLE_TOOL_ACCESS` and the matrix data table change. Manager-only happy-path is enough for the first Claude-integration smoke.
- **If `policyVersion` increment site is too tangled in `configureFamilyCore`'s control flow:** ship the schema field (D4) without the increment in W2; have W2 only test the lazy-migration default. CP-VER1/CP-VER2 deferred to a follow-up. The view-policy tool can still return `policyVersion` (always `0` for now). This degrades the optimistic-concurrency foothold but doesn't block the read path.
- **If the cache layer (W6) introduces flakiness in tests:** drop the cache for v1. Every `view-policy` hits `state.loadFamilyConfig`. Performance is acceptable on Railway single-instance. PC1–PC4 deferred.

---

## How to use this plan

Generator (`@generator`) opens this file at every workstream checkpoint:

1. **Before any code change:** verify the latest test outcome (regression bar must be green from W2 onward).
2. **After each workstream:** run `npx vitest run` AND `npx tsc --noEmit`. Update `implementation/progress.md`.
3. **If a workstream's tests go red unexpectedly:** stop, document the failure in `implementation/progress.md`'s "Failed Approaches" section (≤10 lines), then either fix forward or revert + replan.
4. **Do NOT skip W1.** The regression bar must be written FIRST per the Sprint 3.0.5 precedent. CP-VER1/2/3 lock the central correctness gate of W2 before any code change.
5. **Stop after W8.** No self-evaluation; evaluator runs Phase 3 from the contract + deployed build.
