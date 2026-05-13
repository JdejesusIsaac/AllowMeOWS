# Sprint 3.0.2 — Progress

**Status:** Implementation complete. Ready for Evaluator (Phase 3).
**Test count entering sprint:** 335 passing + 1 skipped
**Test count exiting sprint:** **363 passing + 1 skipped** (+28 net per plan)
**`npx tsc --noEmit`:** ✅ clean
**`npx vitest run`:** ✅ 32 test files, 363 passed, 1 skipped, 0 failed

---

## Step-level execution tracker

### Step 1 — Schema extension ✅
**File:** `src/schemas.ts`

- [x] Added `authorizedDestinations: z.array(z.string()).default([])` to `FamilyConfigSchema`
- [x] Appended 4 new enum values to `AuditEntrySchema.action`: `transfer-rejected-by-allowlist`, `transfer-rejected-by-policy-enforcer`, `authorized-destinations-updated`, `authorized-destinations-removal-blocked`
- [x] `npx tsc --noEmit` clean (after adding placeholders in `bootstrapFamily` / `updateExistingFamily` for required field — Step 5 replaces with real logic)
- [x] No existing test breakage

### Step 2 — Core allowlist module + 8 unit tests ✅
**Files:** `src/core/allowlist.ts` (NEW), `tests/core-allowlist.test.ts` (NEW)

- [x] `checkDestinationAllowlist(destination, list)` — normalizes via `tryNormalizeWallet`, returns `{allowed, reason?}`
- [x] `computeRemovedDestinations(current, proposed)` — case-insensitive diff, lowercased output, deduped
- [x] `findBlockedRemovals(removed, savings, children)` — Decision 3 filter (`!released && !converted`)
- [x] AL-CORE1–8 unit tests (8/8 passing)
- [x] AL-CORE5 case-insensitivity test uses Vitalik's real EIP-55 checksum to exercise the actual viem `isAddress` validator path

### Step 3 — Enforcement in `distribute-allowance` ✅
**File:** `src/tools/distribute-allowance.ts`

- [x] Allowlist check injected before `transferUSDC` on the child-wallet leg
- [x] Savings-vault leg unchanged (Decision 2 — exempt by construction)
- [x] Skip check when `childConfig.walletAddress === undefined` (OWS-internal-wallet path — by construction not user-facing)
- [x] On rejection: `transfer-rejected-by-allowlist` audit entry with `{tool, childName, attemptedDestination, reason}`
- [x] On rejection: per-child result gets `rejectedReason` + `attemptedDestination` fields; other children continue (AL4)
- [x] Refactored `registerDistributeAllowanceTool` to expose `distributeAllowanceHandler` for testing (design-quality positive)

### Step 4 — Enforcement in `release-savings` ✅
**File:** `src/tools/release-savings.ts`

- [x] Allowlist check before `transferUSDC` on the child-wallet leg
- [x] On rejection: entries remain `released: false` AND `converted` unchanged
- [x] Audit entry includes `affectedEntryIds` (USDC + PAXG combined) and `note: "savings entries remain locked"`
- [x] Per-child rejection skips that child; other children's releases proceed
- [x] Refactored to expose `releaseSavingsHandler` for testing

### Step 5 — `configure-policy` validation ✅
**Files:** `src/core/configure-family.ts`, `src/tools/configure-policy.ts`

- [x] `ConfigureValidationError` class with `kind: "removal-blocked" | "invalid-address"`, `affected?: BlockedRemoval[]`, `invalidValue?: string` — overloaded constructor for kind-specific fields
- [x] `buildAuthorizedDestinations({input, existing, callerWallet, children})` helper — pure function returning `{destinations, added, removed}`
- [x] Bootstrap path auto-populates from `managerWalletAddress` + each child's `walletAddress`; emits `authorized-destinations-updated` audit entry
- [x] Update path: builds new list, force-adds caller + children, diffs against existing, scans removals via `findBlockedRemovals` against **existing** children (not new — the savings binding lives on the OLD wallet)
- [x] `authorized-destinations-removal-blocked` audit entry emits BEFORE throw so the trail records the attempted mutation even on rejection
- [x] MCP tool boundary (`configure-policy.ts`) catches `ConfigureValidationError`, returns structured payload `{success: false, error, kind, affected?, invalidValue?}` for AL14 multi-child surface
- [x] Added `authorizedDestinations: z.array(z.string()).optional()` to MCP tool schema
- [x] Caller's `walletAddress` resolved from persisted `Member` record (CallerContext doesn't expose it directly)

**Additional fix:** `StateManager.loadFamilyConfig` now parses through `FamilyConfigSchema` so the `.default([])` runs on read — this is what "lazy migration" actually requires. Pre-3.0.2 fixtures load with `authorizedDestinations: []`. One existing test (`tests/state-manager.test.ts`) updated to match the new round-trip behavior (test wasn't weakened — it now asserts the correct identity-plus-default behavior).

### Step 6 — Integration tests AL1–AL20 ✅
**File:** `tests/allowlist-enforcement.test.ts` (NEW)

- [x] AL1–AL5 distribute-allowance enforcement (happy, blocked, savings-vault exempt, multi-child partial, dry-run)
- [x] AL6, AL7 release-savings enforcement (happy, blocked-stays-locked)
- [x] AL8–AL10 configure-policy auto-populate + force-add + invalid-address rejection
- [x] AL11–AL14 Decision 3 block-on-removal (single, released-not-block, converted-not-block, multi-child error)
- [x] AL15 pre-3.0.2 fixture migration
- [x] AL16–AL18 audit-log completeness (each of the 3 primary audit actions)
- [x] AL19, AL20 edge cases (empty allowlist, EIP-55 checksum stored lowercase)
- [x] All 20 passing; all 335 prior tests still green; net +28 (8 unit + 20 integration)

**Mocking strategy:** `vi.mock` on `WalletDistributor` so `transferUSDC` becomes a spy. AL2/AL5/AL7/AL19 assert `mockTransferUSDC` was NOT called on the rejection path — the strongest possible guarantee that the allowlist check actually fires before the on-chain leg (failure mode F1 + F5).

### Step 7 — Documentation + cleanup ✅
**Files:** `README.md`, `src/constants.ts`

- [x] README "Sprint 3.0.2 (Done)" section with 6 bullets: allowlist enforcement, auto-populate+force-add, Decision 3 block-on-removal, 4 new audit actions, backward-compat schema, forward-compat for Sprint 4.0
- [x] `contribute-gift` removed from `ROLE_TOOL_ACCESS[ROLES.FAMILY]` (Decision 5)
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` 363 passed / 1 skipped

### Step 8 — OWS executable wiring ⏸️ STRETCH (not attempted)

Sprint Contract states S1–S5 are bonus only, do not gate PASS. Primary scope complete; stretch deferred. Tracked for Sprint 3.5 if pilot data warrants.

---

## Test delta

| Group | Before | After | Delta |
|---|---|---|---|
| Test files | 31 | 32 | +1 (`allowlist-enforcement.test.ts`)... plus `core-allowlist.test.ts` already counted in earlier run |
| Total tests | 335 + 1 skipped | 363 + 1 skipped | **+28** |

Matches plan exactly (AL-CORE1–8 = 8, AL1–AL20 = 20, total 28).

---

## Failed Approaches

*(empty — no approaches required rollback. Two transient issues during Step 6 were fixed upstream rather than worked around:)*

- **Issue 1: `findBlockedRemovals` mismatch.** Initial implementation passed `mergedChildren` (new children), but test scenarios change child wallets to undefined (to escape the force-add re-adding the address). Root-cause fix: pass `existingConfig.children` instead — the savings binding lives on the OLD wallet config. One-line change in `configure-family.ts`. Documented inline at the call site.
- **Issue 2: Schema defaults not applied on load.** Plan said "Zod default handles pre-3.0.2 configs," but `loadFamilyConfig` returned raw JSON without parsing through the schema. Root-cause fix: added `FamilyConfigSchema.parse(config)` to `loadFamilyConfig`. One-line change. One existing test in `tests/state-manager.test.ts` updated to reflect the corrected identity-plus-default round-trip.

Both fixes were upstream rather than downstream workarounds. Bug-fixing discipline preserved.

---

## Files changed

**New:**
- `src/core/allowlist.ts` — pure-function allowlist module
- `tests/core-allowlist.test.ts` — 8 unit tests
- `tests/allowlist-enforcement.test.ts` — 20 integration tests

**Modified:**
- `src/schemas.ts` — `FamilyConfig.authorizedDestinations`, 4 new audit-action enum values
- `src/engine/state.ts` — `loadFamilyConfig` parses through schema (lazy migration enabler)
- `src/core/configure-family.ts` — `ConfigureValidationError`, `buildAuthorizedDestinations`, bootstrap + update wiring, Decision 3 scan
- `src/tools/configure-policy.ts` — `authorizedDestinations` MCP arg, structured `ConfigureValidationError` surface
- `src/tools/distribute-allowance.ts` — allowlist gate on child leg, refactored to expose `distributeAllowanceHandler`
- `src/tools/release-savings.ts` — allowlist gate on child leg, refactored to expose `releaseSavingsHandler`
- `src/constants.ts` — removed stale `contribute-gift` from `ROLE_TOOL_ACCESS[ROLES.FAMILY]`
- `tests/state-manager.test.ts` — one assertion updated for schema-on-load behavior
- `README.md` — Sprint 3.0.2 roadmap section

---

## Definition of done

- [x] Sprint Contract criteria 1–10 verifiably pass (see plan-3.0.2.md)
- [x] 28 new tests green; 335+ prior tests still green
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` clean (363 + 1 skipped)
- [x] README updated; `contribute-gift` cleanup landed
- [x] Generator did NOT self-evaluate. Stopping here per harness protocol.

**Next:** Evaluator (Phase 3) grades against the Sprint Contract in `plan-3.0.2.md`. Evaluator must NOT read this `progress-3.0.2.md` file.
