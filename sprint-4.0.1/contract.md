# Sprint 4.1 — Sprint Contract (Phase 1.5)

**Status:** Derived from existing `plan.md` + `research.md` + `test.md`. Pending user confirmation.
**Inputs:** [`research.md`](./research.md) (all open questions §5 resolved), [`plan.md`](./plan.md) v1.0, [`test.md`](./test.md) v1.0.
**Sprint type:** Backend refactor — custody / signing path. Owner-mode (`exportWallet` + viem sign) → agent-mode (OWS `signAndSend` with `ows_key_…` bearer token).
**Sprint class:** **Security-critical.** This sprint introduces a new bearer credential, first-time engages the OWS policy engine on the production signing path, and changes the lifetime/locus of plaintext mnemonic exposure. Rubric weights are tilted toward Auth/Security per the convention for custody-touching work.

---

## 1. Phase 0a — Problem framing (recorded inline)

**Problem statement.** `WalletDistributor.transferUSDC` (`src/wallet/distributor.ts`) is invoked on every USDC movement (`distribute-allowance`, `release-savings`, `settle-session-payout`). The current implementation calls `exportWallet` per transfer, paying scrypt (`n=2^16`, 50–100ms) every call, materializing the plaintext mnemonic in Node's heap, and structurally bypassing `policies/allowance-policy.py` (the policy engine engages only on `ows_key_…` credentials per OWS Spec 03 §Access Model).

**"What is" statement.** Today the policy file exists, is registered at `WalletSetup.initializeFamily`, and is decorative — `grep policy_evaluated ~/.ows/.../logs/audit.jsonl` returns zero hits on production transfers. The Manager API token (`ows_key_…`) is minted at bootstrap and then discarded unused. The only line of defense against an authorization bug in `withAccessControl`/`resolveCallerRole` is the application-layer `authorizedDestinations` check in `distribute-allowance.ts`.

**Solution hypothesis.** Stop discarding the bootstrap-minted token. Persist it under the master key (`data/family-api-tokens.json`, AES-256-GCM, file mode 0o600). Rewrite `WalletDistributor` to (a) reject anything that isn't an `ows_key_…` string, (b) build the EIP-1559 envelope with viem, and (c) hand off to OWS `signAndSend` (with runtime fallback to `sign` + `publicClient.sendRawTransaction`). This engages the policy engine on every transfer, drops per-transfer scrypt (50–100ms → <1ms HKDF inside OWS Rust), and keeps the plaintext mnemonic out of Node's heap.

**Scope boundary.** Three observable outcomes, full stop:
1. Per-family scrypt count drops from 1-per-transfer to 1-per-family-lifetime (lazy-mint).
2. `policy_evaluated=true` appears in `~/.ows/families/<id>/.ows/logs/audit.jsonl` for every transfer.
3. The treasury mnemonic never enters Node's address space on the hot path.

Anything that doesn't move one of those three outcomes is deferred (see plan §2 Non-goals).

---

## 2. Scope

**In scope.** Five workstream clusters, locked:

1. **`FamilyApiTokenManager`** ([`src/keys/family-api-tokens.ts`](../src/keys/family-api-tokens.ts), new) — AES-256-GCM wrap/unwrap of `ows_key_…` tokens under the master key. Mirrors `FamilyKeyManager` envelope. Public surface: `saveToken`, `getToken`, `hasToken`, `forgetToken`. Storage: `data/family-api-tokens.json` (global lookup table, 0o600). (W1)
2. **`WalletDistributor` agent-mode rewrite** ([`src/wallet/distributor.ts`](../src/wallet/distributor.ts)) — Constructor takes `apiToken` (must start with `ows_key_`), throws on anything else. `transferUSDC` builds the EIP-1559 envelope via viem `prepareTransactionRequest` + `serializeTransaction`, then calls OWS `signAndSend` with runtime fallback to `sign` + `publicClient.sendRawTransaction`. Drops imports of `mnemonicToAccount`, `privateKeyToAccount`, `createWalletClient`, `exportWallet`. Preserves the `TransferResult` shape (no callsite-facing API changes). (W2)
3. **Bootstrap token capture** — `WalletSetup.initializeFamily` ([`src/wallet/setup.ts`](../src/wallet/setup.ts)) return value gets `managerKeyId`; `configureFamilyCore.bootstrapFamily` ([`src/core/configure-family.ts`](../src/core/configure-family.ts)) persists the token via `FamilyApiTokenManager.saveToken`. (W3 + W4)
4. **Lazy-mint for pre-4.1 families** — `lazyMintTokenForLegacyFamily(familyId)` in `src/keys/family-api-tokens.ts`. Idempotent. Uses the existing per-family passphrase from `FamilyKeyManager` to mint a fresh `ows_key_…`, persist it, and return it. Three callsites (`distribute-allowance.ts`, `release-savings.ts`, `settle-session-payout.ts`) consult `getToken` first, fall back to lazy-mint. (W5 + W6)
5. **Policy-engine engagement test + token redaction + perf benchmark** — Lock-in artifacts (W7, W8, W9): real Sepolia integration test that reads the OWS audit log and asserts `policy_evaluated` precedes `broadcast_transaction`; triple-layer redaction (Sentry `beforeSend`, audit-details walk, CI regex); pre/post benchmark with locked `p50 -40ms` assertion.

**Out of scope (deliberate, with reason):**
- Spec 05 §Key Caching (HKDF result cache). HKDF-per-transfer is <1ms; cache complexity isn't justified. Future sprint.
- Token rotation tooling. 4.1 mints with no expiry. `forgetToken` returns the `apiKeyId` so a future sprint can wire `revokeApiKey`, but the orchestration is out.
- Multi-token per family / per-(role, wallet) tokens. Only Manager-scoped signing exists today. Reconsidered when Sprint 4.x introduces non-Manager signing (co-parent gift-fund).
- OWS audit-log forwarding to an immutable aggregator → Sprint 4.2.
- Schema/state changes (`FamilyConfig`, etc.) → Sprint 4.4.
- ERC-4337 / smart-account migration → out of program scope.
- Removal of `FamilyKeyManager` or owner-mode `exportWallet`. Owner-mode must remain reachable for emergency recovery + lazy-mint itself.
- `OWS_PASSPHRASE` env-var fallback in the three callsites is REMOVED (D6). Env var stays supported in `FamilyKeyManager` for legacy import flows only.

---

## 3. Deliverables

| ID | Deliverable | File(s) | Workstream |
|----|-------------|---------|------------|
| DEL1 | `FamilyApiTokenManager` class + AES-GCM envelope + 0o600 file mode | [`src/keys/family-api-tokens.ts`](../src/keys/family-api-tokens.ts) | W1 |
| DEL2 | `FamilyApiTokenManager` unit tests (AM1–AM10) | [`tests/keys/family-api-tokens.test.ts`](../tests/keys/family-api-tokens.test.ts) | W1 |
| DEL3 | `WalletDistributor` agent-mode rewrite (constructor guard, viem envelope build, OWS `signAndSend` + `sign` fallback) | [`src/wallet/distributor.ts`](../src/wallet/distributor.ts) | W2 |
| DEL4 | `WalletDistributor` unit + mocked integration tests (AM11–AM20) | [`tests/wallet/distributor.test.ts`](../tests/wallet/distributor.test.ts) | W2 |
| DEL5 | `WalletSetup.initializeFamily` returns `managerKeyId` (additive field) | [`src/wallet/setup.ts`](../src/wallet/setup.ts) | W3 |
| DEL6 | `bootstrapFamily` captures + persists token via `FamilyApiTokenManager` | [`src/core/configure-family.ts`](../src/core/configure-family.ts) | W4 |
| DEL7 | `lazyMintTokenForLegacyFamily(familyId)` helper + tests (AM21–AM25) | [`src/keys/family-api-tokens.ts`](../src/keys/family-api-tokens.ts), [`tests/keys/lazy-mint.test.ts`](../tests/keys/lazy-mint.test.ts) | W5 |
| DEL8 | Callsite swap in `distribute-allowance.ts`, `release-savings.ts`, `settle-session-payout.ts` (token resolution + `OWS_PASSPHRASE` fallback removal) | `src/tools/distribute-allowance.ts`, `src/tools/release-savings.ts`, `src/tools/settle-session-payout.ts` | W6 |
| DEL9 | Policy-engine engagement test on Base Sepolia (AM26–AM28) + OWS audit-log helper | [`tests/integration/policy-engagement.test.ts`](../tests/integration/policy-engagement.test.ts), [`tests/helpers/ows-audit-log.ts`](../tests/helpers/ows-audit-log.ts) | W7 |
| DEL10 | Performance benchmark harness + locked `p50 -40ms` assertion | [`tests/bench/distributor.bench.ts`](../tests/bench/distributor.bench.ts), `sprint-4.0.1/baselines/{pre,post}-4.1.json` | W0 + W8 |
| DEL11 | Token redaction in audit details (`redactTokens`), Sentry `beforeSend` stub, CI `git grep -E 'ows_key_[a-f0-9]{64}'` | [`src/engine/state.ts`](../src/engine/state.ts), `app/server.ts`, CI config | W9 |
| DEL12 | Regression suite green (AM36–AM44) — only allowed modification is `new WalletDistributor(passphrase, …)` → `new WalletDistributor(token, …)` in test helpers | existing test files | W6 + regression bar |
| DEL13 | `progress.md` updated at every workstream checkpoint (W0 → W9), with "Failed Approaches" section maintained per Harness v3 failure protocol | [`sprint-4.0.1/progress.md`](./progress.md) | continuous |

---

## 4. Verification criteria

Twelve criteria, evaluator-verifiable from the deployed build alone (no `progress.md` reads).

### Functionality (must all pass for Pass)

**C1 — Constructor guard.** `new WalletDistributor("not-a-token", …)`, `new WalletDistributor("password123", …)`, `new WalletDistributor("", …)`, `new WalletDistributor(undefined as any, …)` all throw with a message mentioning both `ows_key_…` and `FamilyApiTokenManager`. *Locked by `AM12`.*

**C2 — Token persistence on bootstrap.** A fresh `configureFamilyCore` bootstrap call produces a row in `data/family-api-tokens.json` keyed by the new family's UUID. The row's `apiKeyId` matches an `~/.ows/families/<id>/.ows/keys/<apiKeyId>.json` on disk. The encrypted blob decrypts via the master key to a string matching `/^ows_key_[a-f0-9]{64}$/`. *Locked by `AM26`.*

**C3 — Lazy-mint idempotency.** Two consecutive `lazyMintTokenForLegacyFamily("family-X")` calls on a pre-4.1 family return the same token string. `createApiKey` is invoked exactly once. `crypto.scryptSync` is invoked exactly once across both calls. *Locked by `AM21` + `AM-PERF-2`.*

**C4 — `TransferResult` shape preserved.** `transferUSDC` returns `{txHash, from, to, amount}` matching the existing interface byte-for-byte (same keys, same value types). No callsite needs to change its destructure. *Locked by `AM18`.*

**C5 — `signAndSend` fallback works.** When `@open-wallet-standard/core` does not export `signAndSend`, the runtime fallback calls `sign` and pipes the signed bytes to viem's `publicClient.sendRawTransaction`. Both paths return the same `TransferResult`. The branch is exercised by a mock test. *Locked by `AM19`.*

### Auth / Security (50% rubric weight)

**C6 — Policy engine engaged on every transfer (SC5).** A successful `transferUSDC` to an authorized recipient on Base Sepolia produces, in this order, in `~/.ows/families/<id>/.ows/logs/audit.jsonl`:
1. A `policy_evaluated` entry with `result: allow`.
2. A `broadcast_transaction` entry with the on-chain `txHash` AND `api_key_id` matching the family's row in `family-api-tokens.json`.

Both entries must reference the same `api_key_id`. *Locked by `AM27`.*

**C7 — `POLICY_DENIED` blocks broadcast (SC2).** `transferUSDC` to a recipient absent from `authorized_wallets`:
- Throws an error containing `POLICY_DENIED`.
- The treasury wallet's nonce on Base Sepolia is unchanged before/after (no RPC submission occurred).
- The OWS audit log contains a `policy_evaluated` entry with `result: deny` and a `reason` field. It does NOT contain a `broadcast_transaction` for this attempt.

*Locked by `AM28`. **Critical:** if the nonce moved, the policy engine was bypassed and the sprint fails regardless of any other criterion.*

**C8 — Token never leaks anywhere observable (SC7).** Across the full test suite + a manual smoke run, `ows_key_[a-f0-9]{64}` does NOT appear in:
1. `data/families/<id>/audit-log.json` (AllowMe audit log) — enforced by `redactTokens` walk in `state.addAuditEntry`. *Locked by `AM45`.*
2. Any MCP tool response body. *Locked by `AM46`.*
3. `console.error` / `console.log` output. *Locked by `AM47`.*
4. Sentry events / breadcrumbs (when Sentry is mocked). *Locked by `AM48`.*
5. Any file in the repo (`git grep -E 'ows_key_[a-f0-9]{64}'` returns no matches). *Locked by `AM49` (CI gate).*
6. `data/family-api-tokens.json` is mode 0o600 after every write. *Locked by `AM50`.*

**All six sub-conditions must hold.** Token leakage to any of these surfaces is a custody-adjacent data exposure and fails the sprint.

### Performance (locked benchmark)

**C9 — Scrypt elimination, locked assertion (SC3).** The benchmark harness in `tests/bench/distributor.bench.ts` runs 100 sequential `transferUSDC` calls on Base Sepolia pre-deploy (committed as `baselines/pre-4.1.json`) and post-deploy (`baselines/post-4.1.json`). The assertion:

```typescript
expect(post.p50_ms).toBeLessThan(pre.p50_ms - 40);
expect(post.p95_ms).toBeLessThan(pre.p95_ms - 60);
```

…runs in CI and must be green. Additionally, `scryptSync` invocation count across the 100-call run is exactly 0 (assuming the family is already bootstrapped). *Locked by `AM-PERF-1` + `AM-PERF-2`.*

### Backward compatibility (central correctness gate)

**C10 — Regression suite green with constructor-only modification.** All pre-existing tests in `tests/tools/distribute-allowance.test.ts`, `tests/tools/release-savings.test.ts`, `tests/tools/settle-session-payout.test.ts`, Sprint 3.0.2 allowlist tests (AL1–AL30), Sprint 2.9 multi-tenant isolation tests, Sprint 3.0.6 policy-cache tests (PC1–PC5), Sprint 3.0 v4 verify-page tests, and Sprint 4.0 Learning Mode integration tests pass after the rewrite. **The only allowed test-side modification is substituting `new WalletDistributor(passphrase, vaultPath)` → `new WalletDistributor(token, vaultPath)` in test setup helpers.** Any test-logic edit is a sprint failure. *Locked by `AM36`–`AM44`.*

**C11 — `tsc --noEmit` clean.** Zero new TypeScript errors. `WalletDistributor`'s constructor signature change ripples cleanly through every callsite via the W6 swap.

### Determinism / Quality

**C12 — Coverage gate (SC8).** Vitest coverage report: ≥85% line coverage on `src/keys/family-api-tokens.ts` AND `src/wallet/distributor.ts`. The new code path is exercised by CI, not dead. *Locked by `AM-COV-1`.*

---

## 5. Rubric (Security-critical class)

| Category | Weight | Definition | Locked criteria |
|----------|--------|------------|-----------------|
| Functionality | 25% | `WalletDistributor` returns correct results across populated/empty/legacy families; lazy-mint idempotency holds; bootstrap captures + persists token; `signAndSend` fallback works | C1, C2, C3, C4, C5 |
| Auth / Security | **50%** | Policy engine engages on every transfer (`policy_evaluated` precedes `broadcast_transaction`); `POLICY_DENIED` blocks broadcast (nonce-unchanged invariant); bearer token never leaks across 6 surfaces; file-mode hardening | C6, C7, C8 |
| Design / UX | 15% | `TransferResult` API shape preserved; constructor error surface is clear; regression suite passes with constructor-only edits; `tsc --noEmit` clean; coverage ≥85% on new modules | C4, C10, C11, C12 |
| Originality | 10% | Lazy-mint pattern (avoiding eager migration script); runtime `signAndSend`/`sign` fallback (resilient to SDK version drift); triple-layer redaction with CI gate | reviewed in evaluation |

**Why Auth/Security gets 50%:** This sprint introduces a new bearer credential AND first-engages the policy engine on the custody hot path. The two canonical failure modes (token leak → custody breach; policy bypass → loss of defense-in-depth) are both Auth/Security failures. Performance (C9) is a real success criterion but at 25% — a slower-than-target outcome is recoverable; a leaked token or bypassed policy is not.

---

## 6. Grading thresholds

- **Pass:** all of C1–C12 verified. Each rubric category at ≥75%. Backward-compat (C10) green with zero test-logic edits. Performance assertion (C9) green. Coverage gate (C12) met.
- **Fail:** any of C1–C8 fails. OR `tsc --noEmit` errors. OR pre-existing test suite regresses with test-logic edits. OR ANY of the 6 sub-conditions in C8 fails (token leak is fail regardless of severity). OR the C7 nonce-unchanged invariant fails (policy bypass).
- **Soft fail (Pass-with-followup):** Performance (C9) misses by ≤10ms on p50 traceable to Sepolia RPC variance ONLY (not scrypt re-introduction), AND `scryptSync` count is still 0, AND every other criterion passes. Evaluator may issue Pass with a Sprint 4.x ticket to re-benchmark on a quieter window. **Coverage (C12) below 85% by ≤2 points is soft-fail-eligible only if Auth/Security (C6–C8) are fully clean.**

---

## 7. Hand-off rules

1. Generator implements per [`plan.md`](./plan.md) §4 Workstreams AND this contract. Generator updates [`progress.md`](./progress.md) at every workstream checkpoint (W0 → W9), keeping the "Failed Approaches" section ≤10 lines per Harness v3 failure protocol.
2. Generator MUST read [`progress.md`](./progress.md) "Failed Approaches" before starting work each session. Repeating a documented failure is a rubric penalty.
3. Generator MUST run the regression bar (AM36–AM44) between W2 and every later workstream. If any goes red, stop and document in "Failed Approaches" before continuing.
4. Generator MUST NOT self-evaluate. The Evaluator (Phase 3) reads only this contract + the deployed build — never `progress.md`.
5. Spike before commit: if at the start of W2 the OWS Node SDK introspection reveals `signAndSend` is NOT exported AND the fallback `sign` also has unexpected signature drift, run a 30-min timeboxed spike before committing to either path. Append findings to [`research.md`](./research.md) §5 (open questions) under a new sub-section.
6. Pre-deploy checklist (plan §9.1) must be green before W6's callsite swap merges to main: W0 baseline measured, R5 reconciliation script drafted, W7 policy-engine engagement test green on Sepolia, W9 redaction CI gate green.

---

## 8. Out-of-scope reminders (so the evaluator doesn't penalize their absence)

The evaluator MUST NOT mark Fail for any of:
- HKDF key caching (Spec 05) not implemented.
- Token rotation tooling not implemented.
- OWS audit-log forwarding not implemented (Sprint 4.2).
- Audit-log immutability enforcement not implemented (Sprint 4.2).
- Per-role / per-wallet token scoping not implemented.
- `FamilyConfig` schema changes (Sprint 4.4).
- Settlement decoupling (Sprint 4.3).
- ERC-4337 migration (out of program scope).
- Removal of `FamilyKeyManager` or owner-mode `exportWallet` (D4: keep them, owner-mode is the recovery path).
- `OWS_PASSPHRASE` env-var support retained in `FamilyKeyManager` (D6 removes it only from the three callsites).

---

## 9. Risks acknowledged (mirror plan §7)

R1 (`signAndSend` not exported) → D3 runtime fallback. R2 (token leak) → C8 six sub-conditions. R3 (lazy-mint fails mid-transfer) → owner-mode one-time fallback (W5.3). R4 (orphaned API keys from pre-4.1) → Sprint 4.2 cleanup task; harmless until then. R5 (allowlist misconfig blocks legitimate transfer) → pre-deploy reconciliation script. R6 (RPC-bound perf regression >20ms) → abort cutover, investigate. R7 (token store mid-write corruption) → atomic tmp+rename pattern. R8 (concurrent lazy-mint race) → idempotent, second mint becomes harmless orphan.

---

## 10. Status

- Contract version: 1.0
- Approval: **pending user confirmation**
- Generator entry point on approval: W0 (perf baseline) per [`plan.md`](./plan.md) §4
- Evaluator entry point on Generator hand-off: this contract + deployed build only
