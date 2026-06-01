# Sprint 4.1 — Progress Log

> Generator session log. Updated at every workstream checkpoint per Harness v3.
> Companion to `plan.md`, `research.md`, `test.md`, `contract.md`.

## Status snapshot

| W | Description | Status |
|---|-------------|--------|
| W0 | Perf baseline harness | ✅ harness shipped (`tests/bench/distributor.bench.ts`); operator-owned pre-4.1 capture pending |
| W1 | `FamilyApiTokenManager` module + AM1–AM10 | ✅ done — 12 unit tests |
| W2 | `WalletDistributor` agent-mode rewrite | ✅ done — 11 unit tests + 2 fallback tests (AM11–AM20) |
| W3 | `WalletSetup.initializeFamily` returns `managerKeyId` | ✅ done |
| W4 | `bootstrapFamily` captures + persists token | ✅ done |
| W5 | `lazyMintTokenForLegacyFamily` helper | ✅ done — 5 unit tests (AM21–AM25) |
| W6 | Callsite swap (distribute / release / settle) | ✅ done — all 3 callsites swapped |
| W7 | Policy-engine engagement test (AM26–AM28) | ✅ unit (mocked) shipped; live Sepolia AM27/AM28 marked `it.todo` (operator-run) |
| W8 | Post-4.1 perf measurement + locked assertion | ✅ assertion harness shipped (`tests/bench/distributor-bench.test.ts`); skips until both baselines captured |
| W9 | Token redaction (audit walk + CI grep + Sentry stub) | ✅ done — `redactTokens` in `addAuditEntry` + 8 unit tests + `npm run check:no-tokens` script |

**Regression bar (C10):** **527 passing + 3 skipped + 2 todo (532 total)**, up from the 487+1 baseline. Net +40 passing tests across Sprint 4.1.

**Operator runbook for W0/W8/W7-live (post-merge):**
1. `git checkout pre-sprint-4.1` → run `npm run bench:distributor` with `OWS_BENCH_OUTPUT=sprint-4.0.1/baselines/pre-4.1.json`.
2. `git checkout main` (post-merge) → repeat with `OWS_BENCH_OUTPUT=sprint-4.0.1/baselines/post-4.1.json`.
3. `npm test` will then enable AM-PERF-1 automatically and lock in the +40 ms / +60 ms thresholds (contract C9).
4. For live AM27/AM28, provision `OWS_BENCH_TREASURY_PRIVKEY` + authorized + unauthorized addresses (see `tests/policy-engagement.test.ts` env gates).

---

## Pre-implementation spike (W2-Q1 resolved before commit)

### S1 — OWS SDK actual signature shape

Plan §4 W2.4 pseudo-code assumed:
```js
signAndSend({ walletId, chainId, transactionHex, credential, rpcUrl, vaultPath })
```

The real `@open-wallet-standard/core@1.2.0` `index.d.ts` exports a **positional** API with a **single auth slot**:

```typescript
signAndSend(
  wallet: string,                // accepts wallet NAME or ID
  chain: string,                 // "evm" — NOT CAIP-2
  txHex: string,
  passphrase?: string | null,    // single auth slot — content discriminates owner vs agent mode
  index?: number | null,
  rpcUrl?: string | null,
  vaultPathOpt?: string | null
): SendResult                    // { txHash: string }
```

**Implications for W2:**
1. No object-arg destructure. Pass positional args.
2. No separate `credential` field — the `ows_key_…` token goes in the `passphrase` slot. OWS routes to agent mode (HKDF + policy) when the string starts with `ows_key_`, otherwise owner mode (scrypt). This matches Spec 03 §Access Model verbatim.
3. `chain` is `"evm"` per README quick-start (`ows sign tx --chain evm`), NOT the CAIP-2 string `"eip155:84532"`. The chain network is selected via `rpcUrl`.
4. Return shape is `{ txHash }`, not `{ transactionHash }`. Plan §4 W2.4 had `result.transactionHash` — corrected to `result.txHash`.
5. **`signAndSend` IS exported.** The plan's runtime `typeof signAndSend === 'function'` fallback (D3) is unnecessary in v1.2.0. I'll still keep the fallback branch — it's two-line defense against an SDK downgrade — but it will never execute against the pinned version.

### S2 — `sign` fallback semantics

`signTransaction(wallet, chain, txHex, passphrase?, index?, vaultPathOpt?): SignResult`

`SignResult` is `{ signature: string; recoveryId?: number }`. The `signature` field for EVM is the hex-encoded **signed** envelope (raw EIP-1559 bytes) — viable for `publicClient.sendRawTransaction({ serializedTransaction: signed.signature })`.

### S3 — `createApiKey` accepts wallet names

`setup.ts` already calls `createApiKey(..., createdWallets, ...)` where `createdWallets` is an array of names (`"treasury"`, `"child-maya"`, etc.). OWS internally resolves names → UUIDs. Lazy-mint (W5) can pass names directly; no UUID lookup needed first.

---

## Failed approaches

*(Empty — populated during execution if any documented failure is revisited.)*

---

## Session log

### 2026-05-22 — Sprint kickoff

- Read `plan.md`, `research.md`, `test.md`, `contract.md`.
- Inherited zero Failed Approaches from sprint-4.0.
- Ran pre-W2 spike against the actual OWS `index.d.ts` v1.2.0. Findings S1/S2/S3 recorded above.
- Proceeding with W1 (no Sepolia dependency).
