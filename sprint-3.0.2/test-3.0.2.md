# Sprint 3.0.2 — Test Plan

**Scope:** 8 unit tests (AL-CORE1–8) + 20 integration tests (AL1–AL20) + 2 stretch (AL-OWS1–2).
**Test framework:** Vitest. **New files:** `tests/core-allowlist.test.ts`, `tests/allowlist-enforcement.test.ts`.

Per Sprint Contract rubric weight (Authenticity/Security 50%), every test doubles as a failure-mode guard. Each test below names the Sprint Contract criterion it verifies.

---

## Fixtures (shared helpers)

Add to `tests/helpers/family.ts` (or a new `tests/helpers/allowlist.ts`):

```ts
// Minimum valid family with 2 children having external wallets
export function makeFamilyWithAllowlist(opts?: {
  destinations?: string[]; // defaults to admin + both children
  savings?: Array<Partial<SavingsEntry>>;
}): { config: FamilyConfig; caller: CallerContext; savings: SavingsEntry[]; }
```

Addresses used in tests (lowercased canonical form):
- `ADMIN  = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`
- `CHILD1 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"` (checksum variant `0xBbBb...` used in AL20)
- `CHILD2 = "0xcccccccccccccccccccccccccccccccccccccccc"`
- `ATTACK = "0xdddddddddddddddddddddddddddddddddddddddd"`

---

## Core unit tests (`tests/core-allowlist.test.ts`)

### AL-CORE1 — Happy path: allowlisted address allowed
**Verifies:** Sprint Contract #2.
Call `checkDestinationAllowlist(CHILD1, [ADMIN, CHILD1, CHILD2])`. Expect `{allowed: true}`, no `reason`.

### AL-CORE2 — Unknown address rejected with clear reason
**Verifies:** Sprint Contract #2.
Call `checkDestinationAllowlist(ATTACK, [ADMIN, CHILD1, CHILD2])`. Expect `{allowed: false, reason: "not-in-allowlist"}`.

### AL-CORE3 — Malformed destination rejected
**Verifies:** Sprint Contract #2 + failure mode F4.
Call with `"not-an-address"` and `"0xdeadbeef"` (short). Both expect `{allowed: false, reason: "malformed-address"}`.

### AL-CORE4 — Empty allowlist rejects with explicit reason
**Verifies:** Sprint Contract #2.
Call `checkDestinationAllowlist(CHILD1, [])`. Expect `{allowed: false, reason: "allowlist-empty"}`. (Distinct from `not-in-allowlist`.)

### AL-CORE5 — Case-insensitive comparison
**Verifies:** Failure mode F4.
Inputs with mixed EIP-55 checksum capitalization. e.g., destination is `0xBbBb...` and list contains lowercase `0xbbbb...`. Expect `{allowed: true}`. Also reverse direction.

### AL-CORE6 — `computeRemovedDestinations` diff
**Verifies:** Sprint Contract #2.
Inputs: current = `[ADMIN, CHILD1, CHILD2]`, proposed = `[ADMIN, CHILD2]`. Expect `[CHILD1]`. Test also: no removals (empty), full removal (all), case-insensitive dedup.

### AL-CORE7 — `findBlockedRemovals` returns block when unreleased savings present
**Verifies:** Sprint Contract #5, failure mode F3.
Setup: child-1 has 2 savings entries (1 released, 1 unreleased). Remove CHILD1 from allowlist. Expect 1 `BlockedRemoval` entry with `entryIds.length === 1` (unreleased only) and `totalUsdcLocked > 0`.

### AL-CORE8 — `findBlockedRemovals` empty when all released or converted
**Verifies:** Failure mode F3 (off-by-one).
Setup: child-1 has 3 entries — 1 released, 1 converted, 1 converted+released. Remove CHILD1. Expect empty `[]`. (Critical: converted entries must NOT block even if `released: false`.)

---

## Integration tests (`tests/allowlist-enforcement.test.ts`)

### Group A — distribute-allowance enforcement

#### AL1 — Happy path: distribute to allowlisted child wallet succeeds
**Verifies:** Sprint Contract #3.
Configure family with `authorizedDestinations = [ADMIN, CHILD1, CHILD2]`. Child1 has `walletAddress = CHILD1`. Trigger `distribute-allowance`. Expect `success: true`, tx hash returned, achievements marked distributed.

#### AL2 — Blocked: distribute to non-allowlisted destination rejects without on-chain call
**Verifies:** Sprint Contract #3, failure mode F5.
Same family, but tamper `child1.walletAddress = ATTACK` in config. Mock `WalletDistributor.transferUSDC` to throw if called — test asserts it is NOT called. Response is `success: false` with rejection reason. Audit log contains `transfer-rejected-by-allowlist` entry with `attemptedDestination = ATTACK`, `childName`, `reason`.

#### AL3 — Savings-vault leg exempt from allowlist check
**Verifies:** Sprint Contract #3 + failure mode F1.
Family with `authorizedDestinations = [CHILD1]` (no admin, no vault). `savingsPercent = 50`. Distribute → child leg succeeds (CHILD1 allowlisted), savings-vault leg succeeds (exempt). Assert both tx hashes present. Assert no `transfer-rejected-by-allowlist` entry for the vault leg.

#### AL4 — Multi-child: one child rejects, others proceed
**Verifies:** Sprint Contract #3.
Family with 2 children; child1 allowlisted, child2 tampered to ATTACK. Both have pending achievements. Distribute all. Expect child1 distributed, child2 rejected. Both audit entries present. Only child1's achievements marked distributed.

#### AL5 — Dry-run never calls transferUSDC, regardless of allowlist
**Verifies:** Sprint Contract #3.
`dryRun: true` with tampered destination. Response includes the distribution preview but no audit-log `transfer-rejected-by-allowlist` entry (dry-run does not invoke enforcement side-effects; the rejection would manifest on the real run).

### Group B — release-savings enforcement

(AL4-style tests reused for release. Covered by AL2/AL3 semantic equivalents below.)

#### AL6 — Release to allowlisted destination succeeds
**Verifies:** Sprint Contract #4.
Mature unlocked savings entry. `child1.walletAddress = CHILD1` in allowlist. Release. Entries marked `released: true`, tx hash returned.

#### AL7 — Release blocked: non-allowlisted destination leaves entries locked
**Verifies:** Sprint Contract #4, failure mode F5.
Tamper `child1.walletAddress = ATTACK`. Release. Response `success: false`, error copy contains "remain locked". Entries remain `released: false` in state. Audit entry `transfer-rejected-by-allowlist` contains `affectedEntryIds` matching the mature entries. `transferUSDC` not called.

### Group C — configure-policy auto-populate + force-add

#### AL8 — Bootstrap auto-populates from admin + child wallets
**Verifies:** Sprint Contract #5.
Fresh `configureFamilyCore` call (caller === null) with `managerWalletAddress = ADMIN`, two children with `walletAddress = CHILD1, CHILD2`. After: `familyConfig.authorizedDestinations` contains exactly `[ADMIN, CHILD1, CHILD2]` (lowercased). Audit entry `authorized-destinations-updated` recorded.

#### AL9 — Update force-adds caller's wallet even if explicitly omitted (Q2)
**Verifies:** Sprint Contract #5, failure mode F2.
Existing family, caller has `walletAddress = ADMIN`. Update with `authorizedDestinations: [CHILD1]` (explicit, omits ADMIN). After: persisted list is `[ADMIN, CHILD1]` (ADMIN force-re-added). Audit entry shows ADMIN in `added`.

#### AL10 — Invalid address in input rejects the update
**Verifies:** Sprint Contract #5.
Update with `authorizedDestinations: [ADMIN, "not-an-address"]`. Throws `ConfigureValidationError` (kind `invalid-address`). Family config unchanged. No partial write.

### Group D — Decision 3 (block removal with unreleased savings)

#### AL11 — Block: removing child wallet with unreleased savings throws with affected info
**Verifies:** Sprint Contract #5, failure mode F3.
Family with `authorizedDestinations = [ADMIN, CHILD1]`. Child1 has 1 unreleased savings entry. Update removing CHILD1. Expect `ConfigureValidationError` with `kind: "removal-blocked"`, `affected[0] = { address: CHILD1, childName: "...", entryIds: [<id>], totalUsdcLocked: <amount> }`. `authorized-destinations-removal-blocked` audit entry recorded with full `affected` array.

#### AL12 — No block: removing child wallet with only released entries succeeds
**Verifies:** Sprint Contract #5, failure mode F3.
Same family, but child1's savings entry is `released: true`. Update removing CHILD1 succeeds. `authorized-destinations-updated` audit entry with `removed: [CHILD1]`.

#### AL13 — No block: converted entries don't block removal
**Verifies:** Failure mode F3 (off-by-one).
Child1 has `converted: true, released: false` entry. Remove CHILD1. Succeeds. (Converted entries no longer live in the child's savings path — they're PAXG now.)

#### AL14 — Multi-child block: error lists ALL affected children, not just first
**Verifies:** Sprint Contract #5.
`authorizedDestinations = [ADMIN, CHILD1, CHILD2]`. Both children have unreleased entries. Update removes both. Error's `affected.length === 2`. Audit entry lists both.

### Group E — Migration

#### AL15 — Pre-3.0.2 fixture loads, update auto-populates
**Verifies:** Sprint Contract #5.
Seed a `FamilyConfig` fixture on disk WITHOUT `authorizedDestinations` field (pre-3.0.2 shape). Load via `state.loadFamilyConfig` → parses clean (Zod default is `[]`). Trigger `configureFamilyCore` update with the same children. After: `authorizedDestinations` contains admin + both children. Audit entry recorded.

### Group F — Audit log completeness

#### AL16 — `transfer-rejected-by-allowlist` recorded for distribute
**Verifies:** Sprint Contract #6, failure mode F5. (Redundant with AL2 assertion; kept as an explicit audit-only test — decouple from distribute path semantics.)

#### AL17 — `authorized-destinations-updated` recorded on every list change
**Verifies:** Sprint Contract #6.
Bootstrap, then two consecutive updates (one adds address, one removes unblocked address). Assert three `authorized-destinations-updated` entries, each with correct `added` / `removed` details.

#### AL18 — `authorized-destinations-removal-blocked` recorded on block
**Verifies:** Sprint Contract #6, failure mode F5. (Redundant with AL11 assertion; kept as explicit audit-only test.)

### Group G — Edge cases

#### AL19 — Empty allowlist blocks all distributions
**Verifies:** Sprint Contract #3 + #4 + failure mode F2.
Manually set `authorizedDestinations = []` on disk (simulating a corrupted config). Distribute rejects with reason `allowlist-empty`. Release rejects same. No on-chain calls.

#### AL20 — Checksum-cased input accepted, stored lowercase
**Verifies:** Failure mode F4.
Bootstrap with `managerWalletAddress = "0xAaAa...Aaaa"` (EIP-55 checksum). Persisted `authorizedDestinations[0]` is the lowercase form. Subsequent distribute to the same checksum-cased destination succeeds (case-insensitive match).

---

## Stretch tests (`tests/allowlist-ows.test.ts`, if Step 8 lands)

### AL-OWS1 — Policy bundle ships with `executable` path and addresses
**Verifies:** Sprint Contract S1, S2.
After `setup.initializeFamily`, inspect written policy bundle. Assert `policy.executable` is a non-null string ending in `allowance-policy.py`. Assert `policy.config.authorized_destinations` is an array of lowercased addresses (not wallet names like `"treasury"`).

### AL-OWS2 — OWS-layer rejection emits `transfer-rejected-by-policy-enforcer`
**Verifies:** Sprint Contract S4.
Requires staging smoke environment with Python runtime. Skippable in local CI with a `.skipIf(!process.env.STAGING_OWS)` guard. Construct a test path where app-layer allows but OWS rejects (e.g., via manual policy bundle edit). Attempt distribute. Assert response `success: false` AND audit entry `transfer-rejected-by-policy-enforcer` present AND `transferUSDC` did reach the OWS layer (confirmed via side-effect or log marker).

---

## Test-count reconciliation

| Group | Count | Cumulative |
|---|---|---|
| AL-CORE1–8 | 8 | 8 |
| AL1–AL5 (distribute) | 5 | 13 |
| AL6–AL7 (release) | 2 | 15 |
| AL8–AL10 (configure auto-populate) | 3 | 18 |
| AL11–AL14 (Decision 3) | 4 | 22 |
| AL15 (migration) | 1 | 23 |
| AL16–AL18 (audit) | 3 | 26 |
| AL19–AL20 (edge) | 2 | 28 |
| **Primary total** | **28** | **28** |
| AL-OWS1–2 (stretch) | 2 | 30 |

Entering baseline: 300 passing + 1 skipped. Primary exit: 328 + 1 skipped. With stretch: 330 + 1 skipped.

---

## Evaluator checklist (maps tests to Sprint Contract criteria)

| Criterion | Tests |
|---|---|
| #2 Core module correct | AL-CORE1–6 |
| #3 distribute-allowance enforcement | AL1–AL5 |
| #4 release-savings enforcement | AL6, AL7 |
| #5 configure-policy validation (auto-populate, force-add, Decision 3) | AL8–AL15 |
| #6 Audit-log completeness | AL2, AL7, AL8, AL11, AL16–AL18 |
| #7 28 new tests pass, 300+ prior pass | entire file + baseline |
| F1 savings-vault leg not gated | AL3 |
| F2 force-add idempotent / cannot be bypassed | AL9, AL19 |
| F3 Decision 3 `!released && !converted` filter | AL-CORE7, AL-CORE8, AL11, AL12, AL13 |
| F4 case-insensitivity everywhere | AL-CORE3, AL-CORE5, AL20 |
| F5 audit log records rejections and mutations | AL2, AL7, AL11, AL16–AL18 |
