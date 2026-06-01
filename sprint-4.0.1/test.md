# Sprint 4.1 — Test inventory: Agent-mode signing

> Test catalog for Sprint 4.1. Each test has a code (AM1-AM50) that
> maps to one or more success criteria from plan-4.1.md §6. Tests are
> grouped by category (unit, integration, regression, performance,
> security). Each test states its setup, action, expected outcome,
> and acceptance criteria.

## 1. Test coding scheme

- `AM1`–`AM10`: `FamilyApiTokenManager` unit tests
- `AM11`–`AM20`: `WalletDistributor` unit + integration tests
- `AM21`–`AM25`: lazy-mint helper tests
- `AM26`–`AM35`: end-to-end agent-mode signing on Base Sepolia
- `AM36`–`AM44`: regression suite (existing tests must still pass)
- `AM45`–`AM50`: security tests (token redaction, isolation)
- `AM-PERF-1`–`AM-PERF-3`: locked performance benchmarks

## 2. Acceptance criteria mapping

Cross-reference: every success criterion in plan-4.1.md §6 must map to
at least one test. Verification before sprint exit: this table is
complete and every row's test is green.

| SC# | Description | Tests |
|---|---|---|
| SC1 | Constructor rejects non-token credentials | AM12 |
| SC2 | `POLICY_DENIED` on unauthorized recipient, no broadcast | AM28 |
| SC3 | Median latency drops ≥40ms | AM-PERF-1 |
| SC4 | Existing distribute/release/settle tests pass | AM36-AM40 |
| SC5 | OWS audit log shows `policy_evaluated` per transfer | AM27 |
| SC6 | Lazy-mint idempotent (one scrypt per family) | AM21-AM22 |
| SC7 | No `ows_key_…` leak | AM45-AM50 |
| SC8 | Code coverage ≥85% on new modules | AM-COV-1 |

## 3. Unit tests — `FamilyApiTokenManager`

### AM1 — Roundtrip preserves exact token string

**Setup:** Fresh master key. Empty `data/family-api-tokens.json`.

**Action:**
```typescript
const mgr = new FamilyApiTokenManager(testDataDir);
const token = "ows_key_" + "a".repeat(64);
mgr.saveToken("family-1", token, "key-uuid-1");
const retrieved = mgr.getToken("family-1");
```

**Expected:** `retrieved === token`. Byte-for-byte preservation. No
trailing whitespace, no case modification.

### AM2 — `hasToken` returns true after save, false before

**Action:**
```typescript
expect(mgr.hasToken("family-1")).toBe(false);
mgr.saveToken("family-1", token, "key-uuid-1");
expect(mgr.hasToken("family-1")).toBe(true);
```

### AM3 — Cross-family isolation

**Setup:** Save tokens for two families.

**Action:**
```typescript
mgr.saveToken("family-1", "ows_key_aaa…", "k1");
mgr.saveToken("family-2", "ows_key_bbb…", "k2");
```

**Expected:** `mgr.getToken("family-1")` returns the first token,
`mgr.getToken("family-2")` returns the second. Neither sees the other.
Decrypting one doesn't leak the other.

### AM4 — `getToken` returns null for unknown family

**Action:** `mgr.getToken("never-existed")`.

**Expected:** `null` (not a thrown exception).

### AM5 — Corrupt JSON file recovers as empty store

**Setup:** Write garbage to `data/family-api-tokens.json`.

**Action:** Construct new `FamilyApiTokenManager`. Call `getToken("anything")`.

**Expected:** Returns `null`. A warning is logged. The file is not
overwritten yet (read-only fallback).

### AM6 — `forgetToken` removes entry and returns apiKeyId

**Action:**
```typescript
mgr.saveToken("family-1", token, "key-uuid-1");
const apiKeyId = mgr.forgetToken("family-1");
```

**Expected:** `apiKeyId === "key-uuid-1"`. `mgr.hasToken("family-1")`
returns `false`. The JSON file no longer contains the family entry.

### AM7 — `forgetToken` returns null for unknown family

**Action:** `mgr.forgetToken("never-existed")`.

**Expected:** `null`. No mutation to the file.

### AM8 — File mode is 0o600 after every write

**Action:** Save a token. `fs.statSync(filepath).mode & 0o777`.

**Expected:** `0o600`. Group + other have no access.

### AM9 — Repeated save overwrites in place

**Action:**
```typescript
mgr.saveToken("family-1", "ows_key_aaa…", "k1");
mgr.saveToken("family-1", "ows_key_bbb…", "k2");
const retrieved = mgr.getToken("family-1");
```

**Expected:** `retrieved === "ows_key_bbb…"`. `forgetToken("family-1")`
returns `"k2"`, not `"k1"`. No orphaned entries in the store.

### AM10 — Wrong master key produces decrypt failure (not exception)

**Setup:** Save a token with master key A. Swap `data/.master-key`
to a different value (master key B). Construct new
`FamilyApiTokenManager`.

**Action:** `mgr.getToken("family-1")`.

**Expected:** Returns `null` (not throw). Error logged. This is the
"master key changed" recovery path. Lazy-mint can then regenerate.

## 4. Unit tests — `WalletDistributor`

### AM11 — Constructor accepts valid token

**Action:**
```typescript
new WalletDistributor("ows_key_" + "a".repeat(64), "/tmp/vault");
```

**Expected:** No throw. Distributor is constructible.

### AM12 — Constructor rejects passphrase (SC1)

**Action:**
```typescript
new WalletDistributor("not-a-token", "/tmp/vault");
new WalletDistributor("password123!", "/tmp/vault");
new WalletDistributor("", "/tmp/vault");
new WalletDistributor(undefined as any, "/tmp/vault");
```

**Expected:** All four throw with a clear error message mentioning
`ows_key_…` and `FamilyApiTokenManager`.

### AM13 — `getWalletAddress` returns EVM address

**Setup:** Test OWS vault with a "treasury" wallet.

**Action:**
```typescript
const dist = new WalletDistributor(token, vaultPath);
dist.getWalletAddress("treasury");
```

**Expected:** A `0x`-prefixed 40-hex-char address. No mnemonic
exposure (read-only OWS lookup).

### AM14 — `transferUSDC` resolves `walletId` from name

Mock OWS `getWallet` to return a known UUID. Capture the `walletId`
parameter passed to `signAndSend`.

**Expected:** The UUID from `getWallet(name).id`, NOT the name itself.

### AM15 — `transferUSDC` uses configured RPC URL

**Setup:** Mock viem `publicClient` to capture RPC URL it was
constructed with. Mock `signAndSend` to capture its `rpcUrl` arg.

**Expected:** Both use `constants.RPC_URLS[chainId]`.

### AM16 — `transferUSDC` builds correct EIP-1559 envelope

**Setup:** Mock viem and OWS to capture the `transactionHex` arg.
Decode it with viem's `parseTransaction`.

**Expected:**
- `type === "eip1559"`
- `to === usdcAddress`
- `data` is the ERC-20 `transfer(destAddress, amount)` calldata
- `value === 0n`
- `chainId` matches the requested chain
- `nonce`, `gas`, `maxFeePerGas`, `maxPriorityFeePerGas` are populated

### AM17 — `transferUSDC` waits for receipt

**Setup:** Mock `signAndSend` to return a tx hash immediately. Mock
`waitForTransactionReceipt` to assert it was called with the hash.

**Expected:** `waitForTransactionReceipt` invoked with the returned
tx hash. Timeout 60s as before.

### AM18 — `transferUSDC` returns `TransferResult` matching legacy shape

**Setup:** Mock everything.

**Action:**
```typescript
const result = await dist.transferUSDC(
  "treasury", "child-maya", 1_000_000n,
  "eip155:84532", USDC_SEPOLIA
);
```

**Expected:** `result === {txHash, from: "treasury", to: "child-maya", amount: 1_000_000n}`.
Backward-compatible with the existing `TransferResult` interface.

### AM19 — `signAndSend` fallback to `sign` + manual broadcast

**Setup:** Mock `@open-wallet-standard/core` to NOT export `signAndSend`,
only `sign`. Mock `publicClient.sendRawTransaction`.

**Expected:** `sign` is called; the result is passed to
`sendRawTransaction`. The same `transactionHash` is returned. The
fallback path is exercised exactly once per call when `signAndSend`
is absent.

### AM20 — OWS `POLICY_DENIED` error propagates as `TransferError`

**Setup:** Mock `signAndSend` to throw `{code: "POLICY_DENIED",
message: "recipient not in authorized_wallets"}`.

**Expected:** `transferUSDC` re-throws with the OWS error message
preserved. The caller (e.g., distribute-allowance handler) can
distinguish this from a network error.

## 5. Lazy-mint tests

### AM21 — Idempotent: first call mints, second returns cached (SC6)

**Setup:** Fresh family with no token. Mock `createApiKey` to track
invocation count.

**Action:**
```typescript
const t1 = await lazyMintTokenForLegacyFamily("family-1");
const t2 = await lazyMintTokenForLegacyFamily("family-1");
```

**Expected:** `t1 === t2`. `createApiKey` invoked exactly once.
Scrypt invoked exactly once.

### AM22 — Concurrent lazy-mint requests both resolve to a token

**Setup:** Fresh family. Trigger two `lazyMintTokenForLegacyFamily`
calls concurrently via `Promise.all`.

**Expected:** Both resolve. Both return strings starting with
`ows_key_`. Note: due to the race, one or two `createApiKey` calls
may occur (acceptable — the orphan is harmless and cleaned up in
Sprint 4.2). The `family-api-tokens.json` store contains exactly
one row.

### AM23 — Errors if family has no encryption key

**Setup:** Family directory exists but `FamilyKeyManager.hasFamilyKey`
returns false.

**Expected:** `lazyMintTokenForLegacyFamily` throws with message
mentioning `configure-policy was never completed`.

### AM24 — Wallet name resolution includes OWS-managed + BYO children

**Setup:** Family with two children — one BYO wallet
(`walletAddress` set in config), one OWS-managed.

**Expected:** `createApiKey` is called with wallet names that
include `treasury`, `savings-vault`, `gift-fund`, and the OWS-managed
child's wallet. The BYO child is NOT included (no OWS wallet exists
for them).

### AM25 — Token used after lazy-mint signs successfully

**Setup:** Fresh family. Run lazy-mint. Use returned token to
construct `WalletDistributor` and run a test transfer (mocked OWS
sign).

**Expected:** `signAndSend` is invoked with the lazy-minted token.
The token's `apiKeyId` matches the row in `family-api-tokens.json`.

## 6. Integration tests — End-to-end on Base Sepolia

These require live testnet access. Run via `OWS_BENCH_TREASURY_PRIVKEY`
env var pointing at a pre-funded Sepolia wallet.

### AM26 — Test fixture: bootstrap a family with a known allowlist

**Setup:**
1. Configure a test family via `configureFamilyCore` bootstrap path.
2. Wait for `configure-policy` to mint the token and persist it.
3. Assert `data/family-api-tokens.json` contains the new family.
4. Assert `~/.ows/families/<id>/.ows/keys/<keyId>.json` exists.
5. Assert the policy file in `~/.ows/families/<id>/.ows/policies/`
   contains the `authorized_wallets` matching the test child's address.

**Expected:** All five preconditions hold. This is the setup for
AM27, AM28.

### AM27 — Authorized transfer succeeds AND OWS audit log shows evaluation (SC5)

**Setup:** AM26 fixture.

**Action:**
1. Run `distribute-allowance` for a known authorized child.
2. Wait for transaction to confirm on Sepolia.
3. Read `~/.ows/families/<id>/.ows/logs/audit.jsonl`.

**Expected:**
- `transferUSDC` returns a valid `txHash`.
- The transaction is confirmed on-chain (block number returned).
- The OWS audit log contains an entry with `operation:
  "broadcast_transaction"` and the `txHash`.
- The OWS audit log contains a `policy_evaluated` entry that precedes
  the broadcast entry, with `result: allow`.
- The entry's `api_key_id` matches the family's token's apiKeyId
  from `family-api-tokens.json`.

### AM28 — Unauthorized transfer is denied AND no broadcast occurs (SC2)

**Setup:** AM26 fixture, plus an unauthorized address NOT in
`authorized_wallets`.

**Action:**
1. Attempt `transferUSDC` directly to the unauthorized address.
2. Check the test wallet's nonce on Sepolia before AND after.
3. Read the OWS audit log.

**Expected:**
- `transferUSDC` throws an error containing `POLICY_DENIED`.
- The nonce before === the nonce after. No transaction was submitted
  to the RPC.
- The OWS audit log contains a `policy_evaluated` entry with
  `result: deny` and `reason` matching the policy's denial message.
- The OWS audit log does NOT contain a `broadcast_transaction` entry
  for this attempt.

### AM29 — Concurrent transfers from the same treasury serialize correctly

**Setup:** AM26 fixture. Three authorized child wallets.

**Action:** Issue three `transferUSDC` calls in parallel via
`Promise.all` (each to a different child).

**Expected:**
- All three resolve with valid tx hashes.
- All three are confirmed on-chain.
- Nonces are sequential (no gaps, no collisions).
- The treasury's USDC balance decreased by the sum.

### AM30 — Insufficient gas surfaces clearly (not POLICY_DENIED)

**Setup:** AM26 fixture, but artificially drain the treasury's ETH so
gas estimation fails.

**Action:** Run `transferUSDC`.

**Expected:** Error is caught and re-thrown with a message
distinguishable from `POLICY_DENIED`. Mentions "insufficient funds for
gas" or similar. The OWS audit log does NOT show `policy_evaluated`
(viem's `prepareTransactionRequest` fails before OWS is involved).

### AM31 — Treasury → savings-vault leg works alongside child leg

**Setup:** AM26 fixture. Use `distribute-allowance` (which does both
legs).

**Expected:** Both transfers succeed. Both appear in the OWS audit
log with separate `policy_evaluated` entries. Both contribute to the
ledger.

### AM32 — `release-savings` end-to-end on Sepolia

**Setup:** Pre-populate `savings.json` with a matured entry.

**Action:** Run `release-savings` for the child.

**Expected:** USDC transferred from savings-vault to child wallet.
OWS audit log shows policy evaluation. The savings entry is marked
`released: true`.

### AM33 — `settle-session-payout` end-to-end on Sepolia

**Setup:** Sprint 4.0 Learning Mode session completed; payout amount
calculated.

**Action:** `settleSessionPayout({childName, amountUsdc, sessionId})`.

**Expected:** USDC transferred. OWS audit log shows policy evaluation.
The session record is updated.

### AM34 — Recovery from RPC timeout

**Setup:** Inject latency into the Sepolia RPC to force `waitForTransactionReceipt`
to time out at 60s.

**Expected:** `transferUSDC` throws a clear error. The transaction
MAY have been submitted to mempool (OWS already broadcast); the OWS
audit log records the broadcast. On retry, viem's nonce check would
detect the in-flight tx (existing behavior; no change).

### AM35 — Master key rotation breaks tokens, lazy-mint recovers

**Setup:** Use AM26 fixture. Rotate `data/.master-key` to a new value.

**Action:** Run `distribute-allowance` for the same family.

**Expected:** `FamilyApiTokenManager.getToken` returns null (AM10).
Lazy-mint fails because `FamilyKeyManager.getFamilyKey` also fails
(both wrapped under the same master key). The transfer surfaces a
clear error: "master key changed; re-run configure-policy with
family encryption key recovery." This is the explicit migration
path documented for master-key rotation.

## 7. Regression tests

These are EXISTING tests that must continue to pass without modification
beyond the constructor argument substitution.

### AM36 — `tests/tools/distribute-allowance.test.ts`

All 389+ existing tests pass. The only allowed modification: replace
`new WalletDistributor(passphrase, vaultPath)` with
`new WalletDistributor(token, vaultPath)` in test setup helpers.

### AM37 — `tests/tools/release-savings.test.ts`

All existing tests pass. Same modification allowance.

### AM38 — `tests/tools/settle-session-payout.test.ts`

All existing tests pass. Same modification allowance.

### AM39 — Allowlist tests AL1-AL30 (Sprint 3.0.2)

All allowlist tests continue to pass. Confirms that the application-
layer allowlist (in `distribute-allowance.ts`) is unchanged.

### AM40 — Multi-tenant isolation tests (Sprint 2.9)

All family-isolation tests continue to pass. Confirms that the new
`FamilyApiTokenManager` doesn't cross family boundaries.

### AM41 — Policy cache tests PC1-PC5 (Sprint 3.0.6)

All policy-cache tests continue to pass. Confirms that the view-policy
path is not affected.

### AM42 — Verify-page tests (Sprint 3.0 v4)

All SIWE / verify-page tests continue to pass. Confirms that the
verify-page → `/api/configure-family` path correctly triggers the new
bootstrap (W4) and produces a row in `family-api-tokens.json`.

### AM43 — Sprint 4.0 Learning Mode integration tests

All Learning Mode session tests continue to pass. Confirms that
`settle-session-payout` (now agent-mode) settles payouts correctly.

### AM44 — Multi-family migration tests

Add: simulate a deploy where one existing family's token is lazy-minted
on first `distribute-allowance` call. Verify:
- First call has elevated latency (one-time scrypt).
- Second call has normal latency.
- The OWS audit log shows policy evaluation on both calls.

## 8. Performance benchmarks

### AM-PERF-1 — Scrypt elimination (SC3)

**Methodology:** See plan W0 + W8.

**Locked assertion:**
```typescript
test("AM-PERF-1: scrypt elimination drops p50 by ≥40ms", () => {
  const pre = require("./baselines/pre-4.1.json");
  const post = require("./baselines/post-4.1.json");
  expect(post.p50_ms).toBeLessThan(pre.p50_ms - 40);
  expect(post.p95_ms).toBeLessThan(pre.p95_ms - 60);
});
```

Run on every commit via CI. If pre-4.1 baseline JSON is missing,
test is skipped (with warning) — the assertion only fires after
W0 has been committed.

### AM-PERF-2 — Scrypt invocation count

**Methodology:** Wrap `node:crypto.scryptSync` with a counter via
`sinon.spy`. Run 100 `transferUSDC` calls.

**Expected:** `scryptSync` invocation count === 0 in the post-4.1
code path (assuming family has been bootstrapped pre-test). Strict
upper bound: 1 (for the case where the test starts with no token and
lazy-mint fires once).

### AM-PERF-3 — End-to-end transfer latency under load

**Methodology:** 50 concurrent `transferUSDC` calls across 10 families
(5 per family) on Base Sepolia. Capture p50, p95, p99.

**Expected:**
- p95 ≤ 350ms (vs ~500ms+ in pre-4.1 due to scrypt CPU contention).
- p99 ≤ 600ms.
- No requests fail. No nonce collisions.

This is the load test that validates Sprint 4.1's claim about
"~50+ active families concurrency bottleneck" relief.

## 9. Security tests

### AM45 — Token never appears in audit log details

**Setup:** Configure a family. Run a `distribute-allowance`.

**Action:** Read `data/families/<id>/audit-log.json`. JSON-stringify it.

**Expected:** `JSON.stringify(auditLog).match(/ows_key_/i)` returns
null. Active redaction via W9.2 ensures this.

### AM46 — Token never appears in MCP tool response

**Action:** Run every MCP tool that touches `WalletDistributor`.
For each, capture the response body and grep for `ows_key_`.

**Expected:** Zero matches across all responses.

### AM47 — Token never appears in console.error output

**Setup:** Spy on `console.error`. Run distribute-allowance with a
deliberate failure injected (e.g., invalid recipient).

**Action:** After test, scan all captured `console.error` strings.

**Expected:** Zero matches for `/ows_key_[a-f0-9]{64}/`.

### AM48 — Token never appears in Sentry breadcrumbs/events

**Setup:** Mock Sentry SDK to capture all events. Force a transfer
error.

**Action:** Inspect every captured Sentry event for the token
substring.

**Expected:** Zero matches. The `beforeSend` redaction (W9.1) is
the active control.

### AM49 — No tokens committed in repo

**Methodology:** CI step running:

```bash
git grep -E 'ows_key_[a-f0-9]{64}' && exit 1 || exit 0
```

**Expected:** Exit 0 (no matches). Any test fixture that needs a token
must construct it programmatically (e.g., `"ows_key_" + "a".repeat(64)`).

### AM50 — File mode hardening

**Methodology:**

```typescript
test("AM50: token store file permissions are 0o600", () => {
  const stat = fs.statSync("data/family-api-tokens.json");
  expect(stat.mode & 0o777).toBe(0o600);
});
```

Run after any test that touches `FamilyApiTokenManager.saveToken`.

### AM-COV-1 — Coverage gate (SC8)

**Methodology:** Vitest coverage report.

**Expected:** Line coverage ≥85% on `src/keys/family-api-tokens.ts`
and `src/wallet/distributor.ts`. CI fails if below threshold.

## 10. Test data + fixtures

### Required test fixtures

1. **`tests/fixtures/test-family.json`** — A minimal `FamilyConfig`
   used by AM26 to bootstrap a test family.

2. **`tests/fixtures/test-policy-allowlist.json`** — A test
   `allowance-policy.py` config with a known authorized child wallet
   address (the test wallet, address committed to fixtures).

3. **`tests/helpers/ows-audit-log.ts`** — Helper to read and parse
   OWS audit log entries. Used by AM27, AM28, AM31, AM32, AM33.

4. **`tests/helpers/sepolia-wallets.ts`** — Helpers for managing the
   test treasury wallet and known-good / known-bad child addresses
   on Base Sepolia.

### Required environment variables

- `OWS_BENCH_TREASURY_PRIVKEY` — private key of a pre-funded
  Sepolia treasury. NEVER committed; loaded from `.env.test` or
  CI secrets.
- `OWS_BENCH_AUTHORIZED_CHILD_ADDRESS` — known-authorized recipient.
- `OWS_BENCH_UNAUTHORIZED_ADDRESS` — known-unauthorized recipient
  (e.g., a freshly-generated random address).
- `BASE_SEPOLIA_RPC_URL` — RPC endpoint for testnet operations.

### Pre-test setup

Before running the test suite:

1. `tests/setup/provision-treasury.ts` checks the treasury balance
   on Sepolia and warns if it's below 0.01 ETH or 100 testnet USDC.
2. `tests/setup/reset-family-data.ts` clears the test
   `data/families/test-family-*/` directories so each test run starts
   clean.

## 11. Test execution order

For local development, the recommended order:

1. **Phase 1 (Day 1 PR):** AM1-AM10 (FamilyApiTokenManager units),
   AM-PERF-1 pre-baseline capture.
2. **Phase 2 (Day 2 PR):** AM11-AM20 (WalletDistributor units),
   AM26-AM28 (the critical policy-engine engagement tests).
3. **Phase 3 (Day 3 PR):** AM21-AM25 (lazy-mint), AM29-AM35
   (additional integration), AM36-AM44 (regression suite),
   AM-PERF-1 post-baseline + assertion, AM45-AM50 (security gates),
   AM-COV-1 (coverage).

For CI:

- Unit tests (AM1-AM25, AM45-AM48, AM50): every commit.
- Regression suite (AM36-AM44): every commit.
- Performance benchmarks (AM-PERF-1, AM-PERF-2): every commit (mocked
  RPC).
- Integration tests (AM26-AM35): every PR + nightly (real Sepolia).
- AM-PERF-3 load test: nightly (real Sepolia).
- AM49 git grep: every commit (cheap).
- AM-COV-1: every PR.

## 12. Status tracker

This document is immutable post-approval. Test results live in CI
output and progress-4.1.md.

- Test inventory version: 1.0
- Approval: pending alongside plan-4.1.md.
- Coverage target: 85% on new modules.
- Integration test target: 100% pass on Sepolia before cutover.
- Regression target: 100% pass with constructor-substitution only.