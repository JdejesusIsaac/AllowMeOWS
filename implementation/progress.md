# Sprint 3.0.6 — Implementation Progress

**Sprint:** `view-policy` MCP tool + `policyVersion` counter + role × section access matrix + in-process cache
**Contract:** [`planning/contract.md`](../planning/contract.md) — 12 criteria (C1–C12), Func 30 / Auth 50 / Design 10 / Orig 10 (security-critical rubric)
**Baseline locked (W0):** 369 passing + 1 skipped, `tsc --noEmit` clean
**Final (W8):** **416 passing + 1 skipped**, `tsc --noEmit` clean, **+47 net new tests**

---

## Current state

| Workstream | Status | Tests | Notes |
|---|---|---|---|
| W0 — Backstop | DONE | 369 + 1 skipped | `npx tsc --noEmit` clean; `rm -rf data && mkdir data` before run. **Shell quirk discovered: `working_directory` param ignored by the harness — always prefix with `cd AllowMeOWS &&` for vitest/tsc.** Without the prefix, `process.cwd()` resolves to the parent and `state.ts` reads/writes to a different `data/` than tests clean, manifesting as 90+ "data-leakage" failures. |
| W1 — Regression bar (RED) | DONE | 3 red (expected) | CP-VER1/2/3 fail with `expected undefined to be 1/2/0` — locks the W2 spec before any field exists. |
| W2 — `policyVersion` schema + increment | DONE | 372 + 1 skipped | `FamilyConfigSchema.policyVersion: z.number().int().nonnegative().default(0)`. Bootstrap writes `1`; update path writes `(existing ?? 0) + 1`. Lazy migration mirrors Sprint 3.0.2's `authorizedDestinations` precedent. `tests/state-manager.test.ts` round-trip test extended to include the new default (single backward-compat pattern). |
| W3 — `hydrateDestinations` | DONE | 5 tests, 2 ms | Provenance labelling: `manager-wallet | child:<name> | custom`. Force-added set = managers' wallets ∪ BYO child wallets (lowercased compare). Child label wins over manager label on collision. Case-insensitive matching locked by PV-H5. |
| W4 — `view-policy` tool handler | DONE | 8 tests | `viewPolicyHandler` exported separately from `registerViewPolicyTool` so tests can call it directly (no test infra existed for invoking MCP tools through `server.tool`). VP-T1..T6 cover: full populated response, summary slice, child filter, wallet stripping toggle, empty-policy shell, byte-identical determinism. **W7 denial tests (VP-T7a Family, VP-T7b Learner) bundled in here for cohesion** — the moment the tool was registered, the gate test was the only thing left to write. |
| W5 — `filterPolicyForRole` matrix | DONE | 27 net new tests (32 in the file including W3) | 5×4 access matrix encoded as data in `ROLE_POLICY`. 18 allowed cells + 2 forbidden cells = 20 — parameterized via `it.each`. Childname scoping edges (PV-CHILDNAME1..4): Manager + ghost → `validChildNames` listed; Learner + ghost → no `validChildNames`; Learner + own → success; Learner + sibling → identical shape to Learner + ghost (sibling-enumeration block). Wallet-precedence edges (PV-WALLETS1..3): role policy beats client `includeWallets` for advisor/family; client preference honored for Manager when set to false. |
| W6 — Policy cache | DONE | 4 tests | `src/cache/policy-cache.ts` — `Map<familyId, {value, expiresAt}>` with 60s TTL, sweepless eviction. Synchronous invalidation inside `configureFamilyCore` at both bootstrap and update sites (cache concern lives in the read-side; invalidate is one call after `state.saveFamilyConfig`). PC4 integration locks the "no stale read after write" invariant end-to-end. |
| W7 — `ROLE_TOOL_ACCESS` expansion | DONE | (covered in W4 file) | Manager / Co-parent / Advisor have `view-policy`; Family / Learner denied at the gate (`tight_v1` per user-confirmed contract decision). `tests/http-transport.test.ts:H2` updated to assert `managerTools.length === 14` (was 13). |
| W8 — Full vitest + tsc + README | DONE | 416 + 1 skipped | All 36 test files green. README updated: intro test claim 369 → 416, MCP tool count 12 → 14 (also caught a pre-existing Sprint 3.0.3 staleness — `check-goals` was missing from the intro list), Sprint 3.0.6 block appended with the +47 test breakdown. **Audit-log enum sanity check: no changes needed — view-policy is read-only by design (no state mutation, no audit entries).** |
| W9 — Handoff | DONE | — | This file. No real-device smoke required for this sprint (read-only tool, no UI surface). |

---

## Significant changes

### W0 (2026-05-15 10:25)
- **Critical environmental find**: the harness `Shell` tool's `working_directory` parameter was being silently ignored; `pwd` showed the workspace root rather than `AllowMeOWS/`. `state.ts` resolves `dataDir` via `import.meta.url` (→ `AllowMeOWS/data`) but the test's `beforeEach` uses `process.cwd()` (→ workspace-root `data`). Mismatched paths = `rm -rf data` cleans the wrong dir and tests pile up against accreted state from previous runs. **Workaround: prefix every shell command with `cd /Users/juanisaac/Desktop/cursor-allowmeOpenWallet/AllowMeOWS &&`.** First clean baseline run after the workaround: 369 passing + 1 skipped.
- `npm run typecheck` failed (ENOENT on `cursor-allowmeOpenWallet/package.json`) because of the same cwd issue. Switched to `npx tsc --noEmit` directly.

### W1 (2026-05-15 10:35)
- `tests/configure-policy-version.test.ts` written FIRST. CP-VER1 (bootstrap), CP-VER2 (update increments by exactly 1), CP-VER3 (pre-3.0.6 family-config.json on disk → loads with `policyVersion: 0` via Zod default).
- All 3 RED with `expected undefined to be 1/2/0` — locks the W2 spec.

### W2 (2026-05-15 10:36)
- `src/schemas.ts` — `FamilyConfigSchema` gained `policyVersion: z.number().int().nonnegative().default(0)`. Default = 0 means "predates the counter".
- `src/core/configure-family.ts` — bootstrap path sets `policyVersion: 1` explicitly; update path sets `policyVersion: (existingConfig?.policyVersion ?? 0) + 1`. The nullish-coalescing handles lazy-migrated configs (which load with 0 from Zod, then bump to 1 on the first post-deploy update).
- `tests/state-manager.test.ts` `saves and loads family config` round-trip test extended to include `policyVersion: 0` in the expected default shape (mirrors the Sprint 3.0.2 `authorizedDestinations: []` line). One-line backward-compat update; not a new test, an existing assertion extended.
- Net: 372 passing + 1 skipped, tsc clean.

### W3 (2026-05-15 10:41)
- `src/middleware/policy-view-filter.ts` — `hydrateDestinations(family, managers)` returns `HydratedDestination[]` with `{ address, label, source }`. Force-added set computed on read (managers' wallets ∪ children's BYO wallets); custom entries are anything outside that set.
- 5 tests in `tests/policy-view-filter.test.ts` covering: manager-only, manager + 2 BYO children, manager + child + custom (force-added vs configured split), multiple managers (legacy promoted co-parent), case-insensitive matching.

### W4 (2026-05-15 10:46)
- `src/tools/view-policy.ts` — `viewPolicyHandler` (exported) + `registerViewPolicyTool` (registers via `server.tool` with `withAccessControl("view-policy", viewPolicyHandler)`).
- `src/index.ts` — registered the new tool after `registerConfigurePolicyTool(server)`.
- `src/constants.ts` — added `view-policy` to `ROLE_TOOL_ACCESS[manager | co-parent | advisor]`. Family + Learner explicitly omitted (`tight_v1` per contract D-OQ4). **This is W7 work done early** because the moment the tool was registered, the access list and the denial tests were the only things left in that workstream — folding them in here kept the unit of cohesion intact.
- `tests/view-policy-tool.test.ts` — 8 tests (VP-T1..VP-T6 happy path + VP-T7a/VP-T7b denial). The denial tests invoke the WRAPPED handler (`withAccessControl("view-policy", viewPolicyHandler)`) to exercise the gate, then assert `success: false` + `error: "Access denied..."` + structural assertion that NO policy fields leak through the denial response (`expect(payload).not.toHaveProperty("children")` etc).

### W5 (2026-05-15 10:50)
- `src/middleware/policy-view-filter.ts` — `filterPolicyForRole(family, hydrated, args)` returns either a filtered shape (`{ ok: true, children, destinations, effective }`) or an error (`{ ok: false, error: "INSUFFICIENT_ROLE" | "CHILD_NOT_FOUND", requestedSection?, validChildNames? }`).
- `ROLE_POLICY` matrix encoded as data — 5 roles × 4 dimensions (`wallets | destinations | childScope | goalScope`). Manager / Co-parent: full across all dimensions. Advisor: wallets stripped, destinations + goals visible. Family: wallets stripped, destinations hidden, child scope all (matrix data only; tool-denied in v1). Learner: wallets stripped, destinations hidden, child scope own, goal scope own.
- `src/tools/view-policy.ts` — wired the filter helper in between `hydrateDestinations` and the response shaper. The handler is now thinner: load, hydrate, filter, project. Wallet stripping respects role precedence (`includeWallets: false` honored when role allows wallets; role policy wins when role doesn't).
- Tests in `tests/policy-view-filter.test.ts` — `it.each(FORBIDDEN_CELLS)` for the 2 INSUFFICIENT_ROLE cells, `it.each(allowedCells)` for the 18 allowed cells (asserts effective wallet level + destinations visibility + section content per role). Plus PV-CHILDNAME1..4 + PV-WALLETS1..3 covering sibling-enumeration block + role precedence.

### W6 (2026-05-15 10:53)
- `src/cache/policy-cache.ts` — `policyCache` singleton (`get/set/invalidate`) + `_clearPolicyCache` + `_setPolicyCacheTtl` test-only escape hatches. 60s default TTL. Sweepless eviction (expired entries dropped lazily on `get`).
- `src/core/configure-family.ts` — added `policyCache.invalidate(familyId)` synchronously after `state.saveFamilyConfig` in BOTH bootstrap and update paths. **Decision: invalidate at the CORE level rather than at the TOOL level.** Rationale: the HTTP path (`/api/configure-family`) calls `configureFamilyCore` too; a tool-level invalidate would silently leave stale cache entries on HTTP writes. Core-level invalidate covers both surfaces with one line.
- `src/tools/view-policy.ts` — added cache lookup before `state.loadFamilyConfig`; on miss, fall through to disk and populate the cache for subsequent calls.
- `tests/policy-cache.test.ts` — 4 tests. PC1 (get/set/get-hit), PC2 (TTL expiry with `vi.useFakeTimers` + `_setPolicyCacheTtl(1000)`), PC3 (idempotent invalidate), **PC4 (the canonical integration: bootstrap → view-policy v1 → configure-policy update → view-policy v2 — verifies no stale read post-write end-to-end)**.

### W7 (bundled into W4) (2026-05-15 10:46)
- `src/constants.ts` updates for `ROLE_TOOL_ACCESS` documented in W4.
- `src/index.ts` registration documented in W4.
- VP-T7a/VP-T7b denial tests in `tests/view-policy-tool.test.ts` documented in W4.

### W8 (2026-05-15 10:57)
- `tests/http-transport.test.ts:H2` updated: `managerTools.length` 13 → 14 (added `view-policy`).
- `README.md` — Sprint 3.0.6 (Done) block appended under Sprint 3.0.5; intro test claim 369 → 416 + added `view-policy` filter matrix + cache to the feature list; MCP tool count 12 → 14 in three places (intro list, install note, code-layout note); intro tools list also gained `check-goals` (was missing — Sprint 3.0.3 staleness that this sprint corrected).
- Audit-log enum sanity check: searched for `AuditAction` / `auditAction` in `src/schemas.ts` — no enum exists; audit entries use free-form `action: string`. No view-policy entries to add anyway (the tool is read-only by design; contract C1 + plan §4 confirmed no audit emission).
- Final: **416 passing + 1 skipped** across 36 test files. `tsc --noEmit` clean.

---

## Test count math

| Source | Tests | Cumulative |
|---|---|---|
| Baseline (Sprint 3.0.5 exit) | 369 | 369 |
| W1: CP-VER1/2/3 | +3 | 372 |
| W3: PV-H1..PV-H5 (hydrate) | +5 | 377 |
| W4: VP-T1..VP-T6 (Manager happy path) | +6 | 383 |
| W5: PV-M-FORBIDDEN (it.each, 2 cells) | +2 | 385 |
| W5: PV-M-ALLOWED (it.each, 18 cells) | +18 | 403 |
| W5: PV-CHILDNAME1..4 | +4 | 407 |
| W5: PV-WALLETS1..3 | +3 | 410 |
| W6: PC1..PC4 | +4 | 414 |
| W7: VP-T7a/VP-T7b (bundled in W4 file) | +2 | 416 |
| **Total** | **+47 net new** | **416** |

Contract C10 target: +30 to +45. Actual: **+47** (slight overshoot driven by `it.each`-parameterized 20-cell matrix; each parameterization expands into a single counted test). Justification: the matrix tests have to assert every cell to discharge C6, and parameterization is the right tool — collapsing them into a single "matrix" test would hide which cell broke when one fails.

---

## Failed approaches

None. The implementation followed the plan straight through. Two minor course corrections:

1. **W7 timing.** Plan had W7 after W5 (RBAC expansion + denial tests). In execution, the moment the tool was registered in W4, `ROLE_TOOL_ACCESS` had to be expanded too (otherwise Manager couldn't call the tool for happy-path tests). Folding W7's ROLE_TOOL_ACCESS + tool registration + denial tests into W4's commit kept the diff cohesive. W7 in this progress.md is therefore listed as "bundled into W4" — the work was done, just not in a separate slice.
2. **Cache invalidation site.** Plan D8 had invalidate at the tool level (`src/tools/configure-policy.ts`). Switched to the core level (`src/core/configure-family.ts`) because the HTTP path (`/api/configure-family`) calls `configureFamilyCore` too; tool-level invalidate would silently miss HTTP writes. Documented inline in `configure-family.ts` and in W6 above.

---

## Hand-off

- All 9 workstreams complete. No follow-on real-device smoke required (view-policy is a read-only MCP tool; no UI surface).
- Ready for `/evaluate` against [`planning/contract.md`](../planning/contract.md). Suggested checks:
  - `cd AllowMeOWS && rm -rf data && mkdir data && npx vitest run` → expect 416 passing + 1 skipped.
  - `cd AllowMeOWS && npx tsc --noEmit` → expect exit 0, no output.
  - Spot-check C1–C12 (functional behaviour, auth matrix, deterministic responses, backward compat).
- Heads-up for the evaluator: **always `cd AllowMeOWS &&` before running shell commands** — see W0 above for the harness cwd quirk. The same trap will catch any subsequent sprint.
