# Sprint 3.0.2 — Research

**Phase 0b output.** Scoped to the locked Phase 0a problem statement: introduce a per-family destination allowlist that constrains USDC outflows in `distribute-allowance` and `release-savings` (child-wallet leg only), validated at `configure-policy` mutation time, with the OWS executable-policy stretch closing the latent OWS-layer enforcement gap.

**Locked answers (Phase 0a):** Q1 = rename `authorized_wallets` → `authorized_destinations`. Q2 = force-add caller's wallet on every `configure-policy` call. Q3 = 3.0.2 goes next regardless of 3.0.3 status.

---

## Relevance summary

The Sprint 3.0 v4 baseline gives us everything we need to land this cleanly:

- **Identity is a lowercased address.** `src/auth/wallet.ts` established that wallet addresses are stored/compared lowercase throughout the auth and member-index layers. The allowlist comparison inherits this convention — no new normalization rules needed, only reuse.
- **`ChildConfig.walletAddress` is already the single source of destination truth.** Both `distribute-allowance` and `release-savings` resolve the child leg through this same field before passing it to `WalletDistributor.transferUSDC`. One gate guards both tools.
- **Savings-vault leg is already structurally separate.** `distribute-allowance` and `release-savings` both branch internal-vault traffic through `WALLET_NAMES.SAVINGS_VAULT` (no `toAddress` override), so Decision 2 (vaults exempt) falls out of the existing code shape without a refactor.
- **`configureFamilyCore` is the single mutation entry point.** Both the MCP `configure-policy` tool and the HTTP verify-page form funnel through `configureFamilyCore` in `src/core/configure-family.ts`. Validation injection is one location, two code paths (bootstrap vs update).
- **`SavingsEntrySchema` already carries the two booleans Decision 3 needs** (`released`, `converted`). The block-on-removal scan is a filter-and-count, not a schema extension.
- **The OWS dead-code gap is real and localized.** `src/wallet/setup.ts` ships `executable: null` in every policy bundle and populates `authorized_wallets` with wallet *names* (`"treasury"`, `"child-elina"`). `policies/allowance-policy.py` expects addresses. The stretch is a three-file change (`setup.ts`, `allowance-policy.py`, `Dockerfile`).

The architectural shape fits cleanly into Sprint 4.0 Approach A: `FamilyConfig.authorizedDestinations` is the exact data a Coinbase Smart Wallet spend permission would carry as its `recipients` constraint. Sprint 3.0.2 adds the data model; Sprint 4.0 migrates only the enforcement layer.

---

## Actionable insights

### I1 — The allowlist check goes at exactly two call sites

Both call sites are the line immediately before `distributor.transferUSDC(...)` for the *child-wallet leg*. The savings-vault leg of each tool is NOT gated (Decision 2).

- **`distribute-allowance`** — inject before `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/distribute-allowance.ts:126`. The `childAmount > 0` branch (line 125) is the guard. The savings-vault branch at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/distribute-allowance.ts:138-164` is exempt.
- **`release-savings`** — inject before `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/release-savings.ts:133`. The `totalMultiplied > 0` guard (line 132) scopes it. Savings-vault-as-source is exempt by construction (the `fromWallet` param is `SAVINGS_VAULT`; we check `toAddress`, not `fromWallet`).

On rejection: write audit entry `transfer-rejected-by-allowlist` with `attemptedDestination`, `childName`, `reason`, and — for release-savings — `affectedEntryIds`. Return `success: false` with a clean error string. Crucially: do NOT attempt the on-chain call. AL2 verifies the treasury USDC balance is unchanged after a rejection.

### I2 — Core module should be pure; I/O stays in the tools

`src/core/allowlist.ts` exports pure functions:

```ts
interface AllowlistCheckResult { allowed: boolean; reason?: string; }
function checkDestinationAllowlist(destination: string, list: string[]): AllowlistCheckResult
function computeRemovedDestinations(current: string[], proposed: string[]): string[]

interface BlockedRemoval { address: string; childName: string; entryIds: string[]; totalUsdcLocked: number; }
function findBlockedRemovals(removed: string[], savings: SavingsEntry[], children: ChildConfig[]): BlockedRemoval[]
```

Signatures are pure — callers load `savings.json` via `StateManager` and pass the array in. Testability: 8 unit tests with in-memory fixtures (AL-CORE1–8), no mocking required.

The normalization rule inside `checkDestinationAllowlist`: run both sides through `tryNormalizeWallet` (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/wallet.ts:35`). If either returns `null`, reject with `"malformed-address"`. If both normalize successfully, string-equality-compare the lowercased forms. This handles AL-CORE5 (case-insensitive) and AL-CORE3 (malformed) in one branch.

### I3 — `configure-policy` validation fires in both bootstrap and update paths, but Decision 3 only in update

`configureFamilyCore` splits at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/configure-family.ts:93-100`:

- **Bootstrap path** (`caller === null`, `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/configure-family.ts:103-176`) — auto-populate `authorizedDestinations` from manager's wallet + each child's `walletAddress`. No diff, no block. Write `authorized-destinations-updated` audit entry.
- **Update path** (`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/configure-family.ts:178-246`) — (a) build proposed list from input (or preserve existing, or auto-populate); (b) force-add `caller.walletAddress` (Q2 locked yes); (c) force-add each child's `walletAddress`; (d) diff against existing config's `authorizedDestinations`; (e) for any removals, call `findBlockedRemovals` — if non-empty, write `authorized-destinations-removal-blocked` audit entry and throw `ConfigureValidationError` listing ALL affected children (not just first); (f) persist new list, write `authorized-destinations-updated` audit entry if list changed.

The `ConfigureValidationError` class does not exist yet — introduce it in `src/core/configure-family.ts` and catch-and-surface at the MCP tool boundary in `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/configure-policy.ts:142-147`.

### I4 — Schema migration is lazy and safe

Adding `authorizedDestinations: z.array(z.string()).default([])` to `FamilyConfigSchema` at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts:72-80` is a safe backward-compat change. Pre-3.0.2 family configs load cleanly (Zod default). The first `configure-policy` call after deploy auto-populates via Insight I3.

AL15 (migration test) must exercise: load a pre-3.0.2 fixture → verify it parses clean → trigger `configureFamilyCore` update → verify `authorizedDestinations` now contains admin + children wallets → verify audit entry recorded.

### I5 — Audit log extension is a four-value enum addition

Append to the `AuditEntrySchema` enum at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts:197-219`:

- `transfer-rejected-by-allowlist` — both tools, on rejection
- `transfer-rejected-by-policy-enforcer` — OWS stretch only, emitted by the Python script path
- `authorized-destinations-updated` — configure-policy, on any list change (including bootstrap)
- `authorized-destinations-removal-blocked` — configure-policy, on Decision 3 trigger

No new fields in the schema itself — `details` is already `z.record(z.unknown())`, so attempted-destination, affected-entry-ids, etc. go there.

### I6 — OWS stretch is a surgical three-file change

The latent gap is real. Three coupled changes close it:

1. **`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/wallet/setup.ts`** — `buildManagerPolicy` (line 14-37) changes: field rename `authorized_wallets` → `authorized_destinations` (also update `PolicyConfigSchema` at `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts:229-237`), `executable` gets a path (e.g. `/app/policies/allowance-policy.py` in-container), and the caller now passes `FamilyConfig.authorizedDestinations` (addresses) instead of wallet names.
2. **`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/policies/allowance-policy.py`** — rename variable `authorized_wallets` → `authorized_destinations`, verify `.lower()` on both sides of the comparison, improve rejection-reason copy.
3. **`@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/Dockerfile`** — install Python 3 in the container (`apt-get install -y python3`), COPY `policies/` into the image.

Smoke-test path: deploy with stretch changes → construct a family where app-layer thinks destination is allowed but OWS layer doesn't (test-mode only) → attempt distribute → observe OWS-layer rejection + `transfer-rejected-by-policy-enforcer` audit entry.

The stretch is opt-in to the sprint: primary ships with or without it.

### I7 — Stale `gift-contribute` RBAC reference is a one-line cleanup

`ROLE_TOOL_ACCESS[ROLES.FAMILY]` in `src/constants.ts` references `gift-contribute` but no tool is registered. Decision 5 defers the tool; Sprint 3.0.2 removes the reference during the documentation step so it doesn't confuse security review.

---

## Open questions

No ⚠️ spike markers. Phase 0a spike work (pre-sprint investigation of OWS dead code) is complete and documented under Insight I6. No integration uncertainty remains.

Two soft uncertainties worth naming but not blocking:

- **Q-soft-1:** Should `FamilyConfig.authorizedDestinations` store addresses lowercased on disk, or preserve checksum capitalization for display? Recommendation: store lowercase (matches identity convention from `src/auth/wallet.ts`), re-checksum via `viem.getAddress()` only at UI boundaries. Not worth a spike; lock at implementation time.
- **Q-soft-2:** When bootstrap runs with a `managerWalletAddress` that fails `tryNormalizeWallet`, do we reject the whole bootstrap or silently skip adding it to the allowlist? Recommendation: reject with a clear error. A manager without a valid wallet can't later withdraw; fail loud at creation time.

Both resolvable by the Generator during Phase 2 without further research.

---

## Key code references

| Concern | File | Lines |
|---|---|---|
| Address normalization helper | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/wallet.ts` | `27-38` |
| Distribute-allowance child leg (gate insertion point) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/distribute-allowance.ts` | `124-135` |
| Distribute-allowance savings-vault leg (exempt) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/distribute-allowance.ts` | `138-164` |
| Distribute-allowance audit-write site | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/distribute-allowance.ts` | `176-191` |
| Release-savings child leg (gate insertion point) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/release-savings.ts` | `131-142` |
| `FamilyConfigSchema` (add `authorizedDestinations`) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts` | `72-80` |
| `AuditEntrySchema` (append 4 actions) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts` | `194-225` |
| `PolicyConfigSchema` (rename `authorized_wallets`) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts` | `229-237` |
| `SavingsEntrySchema` (`released`, `converted` flags) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/schemas.ts` | `173-188` |
| `configureFamilyCore` bootstrap path | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/configure-family.ts` | `103-176` |
| `configureFamilyCore` update path | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/configure-family.ts` | `178-246` |
| `normalizeChildren` | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/core/configure-family.ts` | `306-346` |
| `configure-policy` MCP boundary (error surfacing) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/tools/configure-policy.ts` | `115-149` |
| OWS `buildManagerPolicy` (stretch target) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/wallet/setup.ts` | `14-37` |
| OWS Python enforcement script | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/policies/allowance-policy.py` | — |
| Dockerfile (stretch target — Python 3) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/Dockerfile` | — |
| `ROLE_TOOL_ACCESS` (cleanup stale `gift-contribute`) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/constants.ts` | — |
| `WalletDistributor.transferUSDC` (unchanged, reference only) | `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/wallet/distributor.ts` | `69-142` |

---

## Threat-model delta (what 3.0.2 changes)

**Pre-3.0.2 residual risk:** Manager-session compromise → unconstrained drain within weekly budgets. Per-child budget ($5–$20) caps per-call loss; over time systematic drain possible.

**Post-3.0.2 residual risk (primary only):**
- Attacker who compromises Manager session AND updates `authorizedDestinations` via `configure-policy` before draining. One extra step, two extra audit entries. Still bypassable at app layer.
- Attacker who drains to legitimate destinations (child's own wallet) and induces downstream forwarding. Funds stay in family-controlled wallets — not wholesale loss — but a real path.
- Decision 3 timing window: removing a destination + adding an attacker address in the same call, when no kid currently has matured savings bound to the removed address. Mitigated by force-add admin wallet (Q2).

**Post-3.0.2 residual risk (with OWS stretch):** The above two app-layer bypass paths close at the OWS API key level. Even a compromised app server cannot sign UserOperations to non-allowlisted recipients — the API key itself refuses. Meaningful defense-in-depth.

**Not addressed by 3.0.2:** sybil attacks (Sprint 4.0 paymaster), phishing-as-Manager (UX problem, not mechanism), insider co-parent (RBAC already blocks), bearer-credential setup codes (Sprint 3.5+ device binding).

---

## Forward-compatibility with Sprint 4.0

Sprint 4.0 Approach A migrates the family treasury to a Coinbase Smart Wallet owned by the parent's Base Account, with AllowMe as a session key constrained by a spend permission. The permission carries: spender (AllowMe), token (USDC), max-per-period (weekly cap), and — the relevant bit — a recipient allowlist.

`FamilyConfig.authorizedDestinations` as introduced in 3.0.2 is the exact data shape the spend-permission recipient list will read. No schema change during the Sprint 4.0 migration. The app-layer check remains as belt-and-suspenders; the canonical enforcement moves to the chain.

This is the signal that 3.0.2's architectural cut is correct: the data model survives the enforcement-layer migration unchanged.

---

## What 3.0.2 is NOT (scope fence)

- Not a new disbursement mechanism. Existing tools unchanged in shape.
- Not a withdraw-treasury tool — that falls out for free as `distribute-allowance` to an allowlisted admin wallet.
- Not a gift-card / merchant-settlement integration (Bitrefill explicitly rejected).
- Not a notification system.
- Not a UI — allowlist management is conversational via `configure-policy` in Claude.
- Not multi-signer-required mutation (Sprint 4.0 co-parent-as-second-signer).
- Not sybil defense (Sprint 4.0 paymaster).
- Not a fix for bearer-credential setup codes (Sprint 3.5+).
- Not kid-facing UX (Sprint 3.0.3, already shipped independently).

---

## References

- Phase 0a framing: locked inline in this sprint's conversation
- Sprint 3.0 v4 baseline: `sprint-3.0/plan-3.0-v4.md`, `sprint-3.0/progress-3.0-v4.md`
- Sprint 2.9.1 hotfix: per-family OWS vault, legacy-fallback removal
- OWS policy DSL: `@open-wallet-standard/core`
- Identity convention: `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/auth/wallet.ts`
