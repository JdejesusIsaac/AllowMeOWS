# Sprint 3.0.2 — Plan

**Sprint type:** Security-critical feature (destination allowlist)
**Inputs:** `sprint-3.0.2/research-3.0.2.md` (Phase 0b, no spikes needed)
**Duration estimate:** ~7.5 hr app-layer primary; +3–4 hr OWS stretch
**Test delta target:** +28 tests (AL-CORE1–8 unit + AL1–AL20 integration); +2 if stretch lands

---

## Feature summary

Introduce a per-family destination allowlist enforced at the app layer in `distribute-allowance` and `release-savings` (child-wallet leg only). Allowlist is a new `FamilyConfig.authorizedDestinations: string[]` field managed by `configure-policy` — auto-populated from admin + child wallets, force-adds caller's wallet on every update, blocks removal when the corresponding child has unreleased/unconverted savings. Four new audit-log actions. OWS executable-policy wiring is an opt-in stretch that closes the latent OWS-layer gap (`executable: null` + wallet-names-instead-of-addresses) discovered during Phase 0a spike.

---

## Architecture decisions (locked in research)

1. **App-layer primary, OWS stretch.** App-layer check is independently shippable; OWS wiring is opt-in.
2. **Savings vault and gift fund exempt.** Allowlist constrains external child-wallet destinations only; internal vault plumbing is invisible to the parent.
3. **Block removal with unreleased savings.** `configure-policy` fails loud when a removed address has bound non-released non-converted entries.
4. **Rename `authorized_wallets` → `authorized_destinations`** in `policy_config` and `PolicyConfigSchema`. Correct semantics (addresses, not names).
5. **`gift-contribute` deferred.** One-line RBAC cleanup only.
6. **`convert-savings` out of scope.** Ledger-only operation, no on-chain destination.

---

## Implementation steps

### Step 1 — Schema extension (15 min)
**File:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts`

- Add `authorizedDestinations: z.array(z.string()).default([])` to `FamilyConfigSchema` (line 72–80).
- Append four new enum values to `AuditEntrySchema.action` (line 197–219):
  - `transfer-rejected-by-allowlist`
  - `transfer-rejected-by-policy-enforcer` (stretch use only)
  - `authorized-destinations-updated`
  - `authorized-destinations-removal-blocked`
- `PolicyConfigSchema` (line 229–237): only touch if stretch is attempted — rename `authorized_wallets` → `authorized_destinations`. Primary leaves it alone.
- Verify `npx tsc --noEmit` clean. Verify existing fixtures still parse.

**Exit criteria:** schema additions compile; Zod defaults handle pre-3.0.2 configs; no test breakage.

---

### Step 2 — Core allowlist module + 8 unit tests (1 hr)
**New files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/allowlist.ts`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/core-allowlist.test.ts`

Public surface (pure functions, no I/O):

```ts
export interface AllowlistCheckResult { allowed: boolean; reason?: string; }
export function checkDestinationAllowlist(destination: string, list: string[]): AllowlistCheckResult;

export function computeRemovedDestinations(current: string[], proposed: string[]): string[];

export interface BlockedRemoval {
  address: string; childName: string; entryIds: string[]; totalUsdcLocked: number;
}
export function findBlockedRemovals(
  removed: string[],
  savings: SavingsEntry[],
  children: ChildConfig[]
): BlockedRemoval[];
```

**Normalization rule:** `checkDestinationAllowlist` runs both `destination` and each `list` entry through `tryNormalizeWallet` (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/wallet.ts:35`). Malformed destination → `{allowed: false, reason: "malformed-address"}`. Empty list → `{allowed: false, reason: "allowlist-empty"}`. Mismatch → `{allowed: false, reason: "not-in-allowlist"}`.

**`findBlockedRemovals` semantics:** for each address in `removed`, find children whose `walletAddress` normalizes to the same value; for each such child, filter `savings` where `childName` matches AND `!released` AND `!converted`. If any match, emit a `BlockedRemoval` entry.

**Unit tests (AL-CORE1–8):**
- AL-CORE1 happy path; AL-CORE2 unknown rejected; AL-CORE3 malformed rejected; AL-CORE4 empty-list rejected; AL-CORE5 case-insensitive (EIP-55 checksum accepted); AL-CORE6 `computeRemovedDestinations` diff correctness; AL-CORE7 `findBlockedRemovals` finds block when child has unreleased savings; AL-CORE8 `findBlockedRemovals` empty when all released/converted.

**Exit criteria:** `npx vitest run tests/core-allowlist.test.ts` — 8 passing.

---

### Step 3 — Enforcement in `distribute-allowance` (30 min)
**File:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/distribute-allowance.ts`

- Import `checkDestinationAllowlist` from `src/core/allowlist.js`.
- Inside the `if (childAmount > 0)` branch at line 125, BEFORE the `transferUSDC` call at line 126:
  - Resolve the destination: `childConfig.walletAddress` (external) — skip check if `childConfig.walletAddress` is undefined (OWS-internal wallet case is exempt by construction; that address is not user-facing and lives in the family's own OWS vault).
  - Call `checkDestinationAllowlist(childConfig.walletAddress, config.authorizedDestinations)`.
  - On rejection: write audit entry `transfer-rejected-by-allowlist` with `{ childName, attemptedDestination: childConfig.walletAddress, reason }`; push a `savingsError`-style failure into the per-child result (or a new `rejectedReason` field) so the summary surfaces the rejection; **do not throw** — continue the loop so other children's distributions proceed.
  - Continue to savings-vault leg unchanged (Decision 2 — exempt).
- Audit-log distribute entry (line 176) records the rejection inline in `details.rejectedChildren` array.

**Exit criteria:** manual smoke — distribute with an allowlisted child wallet succeeds; tamper config to point child at a non-allowlisted address, distribute rejects with no on-chain transaction attempted (treasury USDC balance unchanged).

---

### Step 4 — Enforcement in `release-savings` (30 min)
**File:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/release-savings.ts`

- Import `checkDestinationAllowlist`.
- In the `if (totalMultiplied > 0)` branch at line 132, BEFORE `transferUSDC` at line 133:
  - Resolve destination: `childConfig.walletAddress`. Skip check if undefined (internal-OWS-wallet case).
  - Call `checkDestinationAllowlist`.
  - On rejection: write audit entry `transfer-rejected-by-allowlist` with `{ childName, attemptedDestination, reason, affectedEntryIds: usdcEntries.map(e => e.id) }`; return `{ success: false, error: "..." }` with copy that explicitly says "savings entries remain locked"; do NOT mark entries as released.

**Exit criteria:** manual smoke — legitimate release succeeds; tampered destination rejects; entries remain `released: false` in state; audit entry present.

---

### Step 5 — `configure-policy` validation in `configureFamilyCore` (1.5 hr)
**File:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/configure-family.ts`

- Introduce `ConfigureValidationError extends Error` with `affected: BlockedRemoval[]` and `kind: "removal-blocked" | "invalid-address"` fields.
- Extract a helper `buildAuthorizedDestinations(input, existing, caller, children)` that implements:
  1. Start set = empty
  2. If `input.authorizedDestinations` supplied: normalize each via `tryNormalizeWallet`; reject invalid; dedupe.
  3. Else if `existing.authorizedDestinations?.length`: start from existing.
  4. Else: start from empty (auto-populate below fills it).
  5. Force-add each child's `walletAddress` (if normalizable).
  6. Force-add `caller.walletAddress` (if normalizable). For bootstrap path, use `input.managerWalletAddress`.
  7. Return `{ destinations: string[], added: string[], removed: string[] }` (diff vs existing).

- **Bootstrap path** (`bootstrapFamily`, line 103–176):
  - Call `buildAuthorizedDestinations(input, null, null, input.children)`.
  - Persist `familyConfig.authorizedDestinations = destinations`.
  - Write audit entry `authorized-destinations-updated` with `{ added: destinations, removed: [] }`.

- **Update path** (`updateExistingFamily`, line 178–246):
  - Call `buildAuthorizedDestinations(input, existingConfig, caller, mergedChildren)`.
  - If `removed.length > 0`: load savings via `state.loadSavings(familyId)`; call `findBlockedRemovals(removed, savings, mergedChildren)`; if non-empty → write audit entry `authorized-destinations-removal-blocked` with full `BlockedRemoval[]` in `details`, then throw `ConfigureValidationError`.
  - Persist `familyConfig.authorizedDestinations = destinations`.
  - If `added.length || removed.length`: write audit entry `authorized-destinations-updated` with `{ added, removed }`.

- **MCP tool boundary** (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/configure-policy.ts:142-147`):
  - Catch `ConfigureValidationError` specifically and return `{ success: false, error: "<human-readable>", affected: <BlockedRemoval[]> }` so the conversational surface lists every affected child, not just the first.

**Exit criteria:** bootstrap populates `authorizedDestinations`; update preserves when unchanged, extends on additions, blocks on Decision-3 conflicts with a structured error listing all affected children.

---

### Step 6 — Integration tests AL1–AL20 (3 hr)
**New file:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/allowlist-enforcement.test.ts`
**Extend:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/tests/configure-policy.test.ts` (if exists) or append to above

See `sprint-3.0.2/test-3.0.2.md` for per-test specs. Groupings:

- **AL1–AL5** enforcement on distribute-allowance and release-savings (happy path, blocked path, treasury-balance-unchanged assertion, affected-entry-ids in audit, savings-vault leg exempt)
- **AL6–AL10** `configure-policy` auto-populate (bootstrap), force-add-caller (Q2), preserve-on-update, invalid-address rejection, dedupe
- **AL11–AL14** Decision 3 block-on-removal (single child, multi-child, released-entries-don't-block, converted-entries-don't-block, error lists ALL affected children)
- **AL15** pre-3.0.2 fixture migration (load → update → `authorizedDestinations` populated)
- **AL16–AL18** audit-log entries recorded correctly for each of the 3 primary action types
- **AL19–AL20** edge cases (empty allowlist blocks everything; case-insensitive EIP-55 checksum accepted)

**Exit criteria:** 20 AL tests green; all 300+ prior tests still green; `npx vitest run` exits clean.

---

### Step 7 — Documentation + cleanup (30 min)
**Files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/README.md`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/constants.ts`

- README: add "Sprint 3.0.2 — Destination Allowlist" section. Document: what's enforced, what's exempt (vaults), 4 new audit actions, force-add behavior (UX note: "Your wallet and each child's wallet are always on the allowlist"), forward-compat to Sprint 4.0 spend-permissions.
- CHANGELOG entry (if file exists) noting policy-bundle field rename as breaking-but-invisible (stretch only).
- Remove stale `gift-contribute` reference from `ROLE_TOOL_ACCESS[ROLES.FAMILY]` in `src/constants.ts`.
- Ensure no new TypeScript warnings / unused exports.

**Exit criteria:** `npx tsc --noEmit` clean; `npx vitest run` clean; README reflects shipped behavior.

---

### Step 8 — OWS executable wiring (STRETCH, 3–4 hr)
**Files:** `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/wallet/setup.ts`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/policies/allowance-policy.py`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/Dockerfile`

- `setup.ts` `buildManagerPolicy` (line 14–37):
  - Change `authorized_wallets` key to `authorized_destinations`.
  - Set `executable` to an in-container path (e.g. `/app/policies/allowance-policy.py`).
  - Callers pass `FamilyConfig.authorizedDestinations` (addresses), not wallet names.
- `PolicyConfigSchema`: rename field.
- `policies/allowance-policy.py`: rename variable; verify `.lower()` on both sides; improve rejection copy.
- `Dockerfile`: `apt-get install -y python3`, `COPY policies/ /app/policies/`.
- Staging smoke: construct a test-mode family where app-layer allows but OWS layer doesn't; attempt distribute; observe OWS-layer rejection + `transfer-rejected-by-policy-enforcer` audit entry.
- Integration tests AL-OWS1, AL-OWS2 (if stretch lands).

**Exit criteria:** OWS-layer rejection observable in staging; audit entry recorded; primary tests still green.

---

## Risks

- **R1 — Migration breaks an existing production family.** Mitigation: AL15 covers the migration path; `data/` volume backup before deploy; rollback target is pre-3.0.2 deploy.
- **R2 — Case-sensitivity mismatch surfaces at runtime.** Mitigation: AL20 + AL-CORE5; all comparisons go through `tryNormalizeWallet`.
- **R3 — Force-add surprises a parent.** Mitigation: UX copy in README; if pilot data warrants, Sprint 3.5 adds `allowAdminWalletOmission` opt-in.
- **R4 — Decision 3 false positive (legitimate removal blocked).** Mitigation: error message tells parent exactly how to unblock (release or convert first); audit log records every block attempt.
- **R5 — OWS stretch fails in staging.** Mitigation: stretch is opt-in; primary ships regardless. Document as "shipping in Sprint 3.5" if it slips.
- **R6 — `transferUSDC` failure after allowlist passes leaves inconsistent audit.** Mitigation: existing savings-error handling model is preserved; audit entries reflect intent not outcome (same as pre-3.0.2).

---

## Test delta summary

| Group | Count | Subtotal |
|---|---|---|
| AL-CORE1–8 unit (Step 2) | 8 | 8 |
| AL1–AL20 integration (Step 6) | 20 | 28 |
| AL-OWS1–2 integration (Step 8, stretch) | 2 | 30 |

Entering: 300 passing + 1 skipped (post-3.0 v4 baseline). Exiting primary: 328. Exiting with stretch: 330.

---

# Sprint Contract

**Contract ID:** sprint-3.0.2
**Sprint type:** Security-critical feature
**Evaluator: DO NOT read `progress-3.0.2.md`.** Grade strictly against this contract.

## Success criteria (all must be true to PASS)

1. `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts` adds `FamilyConfig.authorizedDestinations: string[]` with safe default; adds 4 new `AuditEntry.action` enum values. No type errors.
2. `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/allowlist.ts` exists, exports `checkDestinationAllowlist`, `computeRemovedDestinations`, `findBlockedRemovals` — all pure, address-normalization via `tryNormalizeWallet`.
3. `distribute-allowance` child-wallet leg rejects non-allowlisted destinations BEFORE `transferUSDC`; savings-vault leg unaffected; rejection writes `transfer-rejected-by-allowlist` audit entry.
4. `release-savings` child-wallet leg rejects non-allowlisted destinations BEFORE `transferUSDC`; entries remain `released: false` on rejection; audit entry recorded with `affectedEntryIds`.
5. `configureFamilyCore` auto-populates `authorizedDestinations` on bootstrap (admin wallet + child wallets); force-adds caller's wallet on every update; blocks removal when the corresponding child has unreleased unconverted savings, with a structured error listing ALL affected children.
6. All 4 new audit actions observably emitted on their respective triggers.
7. AL-CORE1–8 (8) + AL1–AL20 (20) = 28 new tests passing. All pre-existing tests (300+) still pass.
8. Stale `gift-contribute` reference removed from `ROLE_TOOL_ACCESS[ROLES.FAMILY]`.
9. README documents the feature and the force-add UX behavior.
10. `npx tsc --noEmit` exits 0; `npx vitest run` exits 0.

## Stretch criteria (bonus, do not gate PASS)

- S1. `src/wallet/setup.ts` policy bundles ship with `executable: <path>` and `authorized_destinations: <addresses>` (not names).
- S2. `policies/allowance-policy.py` reads `authorized_destinations`, lowercases both sides.
- S3. `Dockerfile` installs Python 3 and copies `policies/`.
- S4. Staging smoke test demonstrates OWS-layer rejection with `transfer-rejected-by-policy-enforcer` audit entry.
- S5. AL-OWS1 and AL-OWS2 integration tests pass.

## Rubric (security-critical weights)

| Dimension | Weight | What it measures |
|---|---|---|
| **Functional correctness** | **30%** | All criteria 1–10 verifiably pass. Tests green. Manual smokes V1–V5 (see progress doc). |
| **Authenticity / security** | **50%** | Threat-model delta actually delivered: app-layer check cannot be bypassed via any code path in `distribute-allowance` / `release-savings` child leg; `configure-policy` cannot produce a `FamilyConfig` state where an attacker-controlled address is in the allowlist and a legitimate child address is not. Audit trail is complete: every rejection and every mutation leaves a record. Address normalization is consistent (no case-sensitivity bugs). Decision 3 actually prevents orphaning savings. Force-add is idempotent and cannot be bypassed by explicit omission. |
| **Design quality** | **10%** | Core module is pure and unit-testable. Tool-layer code delegates to core. `ConfigureValidationError` is a real class with structured fields, not a string-munged error. Schema changes are backward-compatible. |
| **Originality / forward-compat** | **10%** | Data model (`authorizedDestinations` as `string[]` of lowercased addresses) is the exact shape Sprint 4.0 spend-permissions will consume, unchanged. No schema migration required at Sprint 4.0. |

**Weight rationale:** This sprint exists to close a security gap (Manager-session compromise → unconstrained drain). Functional correctness matters, but the *security properties* are what justify the sprint. Design and originality are lightly weighted because the architectural cut was already made in Phase 0a research; the Generator is executing a known design, not inventing one.

## Failure modes the evaluator must explicitly check

- **F1 — Allowlist bypass via savings-vault leg argument confusion.** The child leg and savings-vault leg of `distribute-allowance` both call `transferUSDC`. Confirm the allowlist check gates only the child leg AND that no code path in the child leg can skip the check (e.g., `childConfig.walletAddress === undefined` must not silently pass — it must fall through to OWS-internal-wallet resolution, which is by definition not an external destination).
- **F2 — Force-add regression.** Confirm that a `configure-policy` call with `authorizedDestinations: []` explicitly omits the caller's wallet but still ends up with the caller's wallet in the persisted list.
- **F3 — Decision 3 off-by-one.** Confirm `findBlockedRemovals` correctly filters `!released && !converted`. A released-but-not-converted entry should NOT block removal.
- **F4 — Case-sensitivity.** Confirm EIP-55 checksum-cased input to `configure-policy` is accepted and stored lowercased; confirm the comparison in `checkDestinationAllowlist` is case-insensitive.
- **F5 — Audit log completeness.** Every rejection and every mutation writes an entry. No silent failures.

## Out of scope for evaluation

- OWS stretch (S1–S5) — graded as bonus only, does not affect PASS/FAIL.
- Production deployment — evaluator runs locally, not Railway.
- UI / conversational polish — evaluator inspects code and test behavior, not Claude-side copy.

---

**End of plan and Sprint Contract.** Generator agent proceeds only after user confirms the contract.
