# Sprint 4.1 — Plan: Agent-mode signing

> Workstreams, decisions, sequencing, and success criteria for the
> `WalletDistributor` owner-mode → agent-mode refactor.
> Pre-reading: research-4.1.md. Verification: test-4.1.md.

## 1. Goals

Sprint 4.1 delivers three observable outcomes:

1. `WalletDistributor.transferUSDC` no longer runs scrypt per call. The
   only scrypt invocation per family is a one-time mint at bootstrap (or
   on the first lazy-mint call for pre-4.1 families).
2. `policies/allowance-policy.py` executes on every transfer. Visible
   confirmation: a `policy_evaluated=true` entry per transfer in the
   OWS audit log at `~/.ows/families/<id>/.ows/logs/audit.jsonl`.
3. The treasury mnemonic never enters Node's address space. Plaintext
   key material exists only inside OWS's hardened buffer for the
   microseconds of the sign operation.

Sprint 4.1 is the smallest possible scope that achieves all three. Every
workstream that doesn't contribute to one of those three outcomes is
deferred.

## 2. Non-goals

Explicit non-goals (and the sprint or program where they belong):

- **Key cache implementation (Spec 05).** HKDF-per-transfer is fast
  enough; cache complexity isn't justified yet. Future sprint.
- **Token rotation tooling.** 4.1 mints with no expiry. Rotation is a
  future sprint.
- **Multi-token-per-family (per-role tokens).** 4.1 ships one Manager
  token per family. Per-role tokens become relevant when non-Manager
  signing is introduced (e.g., co-parent gift fund).
- **OWS audit log forwarding.** Sprint 4.2 work.
- **Schema/state changes.** Sprint 4.4 work.
- **Settlement-decoupling.** Sprint 4.3 work.
- **ERC-4337 / smart-account migration.** Out of program scope.

## 3. Timeline + sequencing

Three working days, structured as three sub-sprints. Each day produces
a mergeable PR; nothing gets blocked behind the next day's work.

### Day 1 — Foundations

- **W0** (90 min): Performance baseline measurement (see §4 W0).
- **W1** (4 hr): `FamilyApiTokenManager` module + unit tests.
- **W3** (1 hr): `WalletSetup.initializeFamily` return-value enrichment.

Day 1 PR: ships in isolation; no behavior change in production.
`FamilyApiTokenManager` is present but unused. Token capture from
`WalletSetup` is wired but `FamilyApiTokenManager.saveToken` is not yet
called from `configureFamilyCore`. Safe to deploy.

### Day 2 — Distributor refactor

- **W2** (5 hr): `WalletDistributor` agent-mode rewrite.
- **W7** (2 hr): Policy-engine engagement test (the new lock-in artifact).

Day 2 PR: `WalletDistributor` accepts EITHER passphrase OR token via
runtime detection. Existing callsites still pass passphrase; the new
code path is exercised only by W7's test. Safe to deploy.

### Day 3 — Cutover

- **W4** (1 hr): Bootstrap path captures and persists token.
- **W5** (2 hr): Lazy-mint helper for pre-4.1 families.
- **W6** (2 hr): Callsite swaps in three tool files.
- **W8** (1 hr): Performance measurement (post-4.1) + locked benchmark
  assertions in test-4.1.md.
- **W9** (1 hr): Token redaction audit + Sentry/log scrubbing.

Day 3 PR: cutover. `WalletDistributor` constructor rejects passphrase
inputs. All callsites use tokens. Production behavior change. Deploy
with rollback procedure ready (§9).

## 4. Workstreams

### W0 — Performance baseline (Day 1, 90 min)

Establishes the measurement that proves Sprint 4.1's value.

**W0.1** — Set up a benchmark harness in `tests/bench/distributor.bench.ts`.
Uses vitest with `performance.now()`. Targets Base Sepolia testnet with
a pre-funded treasury (`OWS_BENCH_TREASURY_PRIVKEY` env var; see W0.4).

**W0.2** — Run 100 sequential `transferUSDC(treasury → known-child)`
calls. Capture p50, p95, p99, mean, stddev. Write to
`sprint-4.1/baselines/pre-4.1.json`.

**W0.3** — Decompose timing: wrap individual sub-operations in
`performance.mark`/`measure` for `exportWallet` (scrypt), viem
`sendTransaction`, `waitForTransactionReceipt`. Confirms scrypt is
the dominant non-RPC component before claiming credit for eliminating it.

**W0.4** — Document benchmark setup in `sprint-4.1/baselines/README.md`:
test wallet provisioning, RPC endpoint, expected variance, how to re-run.

**Done when:** `pre-4.1.json` is committed with p50/p95/p99 numbers and
the decomposed timing confirms scrypt ≥40ms median.

### W1 — `FamilyApiTokenManager` (Day 1, 4 hr)

New module `src/keys/family-api-tokens.ts`. Storage layer for the
`ows_key_…` tokens.

**W1.1** — Module skeleton + AES-256-GCM wrap/unwrap helpers. Mirror
`FamilyKeyManager` patterns (same envelope, same file-mode 0o600, same
master-key dependency via `resolveMasterKey()`).

**W1.2** — Public API:

```typescript
class FamilyApiTokenManager {
  constructor(dataDir?: string)
  saveToken(familyId: string, token: string, apiKeyId: string): void
  getToken(familyId: string): string | null
  hasToken(familyId: string): boolean
  forgetToken(familyId: string): string | null  // returns apiKeyId for revocation
}
```

**W1.3** — Storage shape in `data/family-api-tokens.json`:

```json
{
  "<familyId>": {
    "encryptedToken": "<hex>",
    "iv": "<hex>",
    "tag": "<hex>",
    "apiKeyId": "<uuid>",
    "createdAt": "<iso>"
  }
}
```

**W1.4** — Unit tests (test-4.1.md §AM1-AM8):
- Save/get roundtrip preserves exact token string.
- Cross-family isolation (familyA's token decryption fails with familyB's key — N/A; master key is shared, but token-A in store-A and token-B in store-A roundtrip independently).
- Corruption recovery (corrupt JSON → empty store, log warning).
- Forget removes the entry and returns the apiKeyId.
- File mode is 0o600 after every write.
- Repeated save of the same familyId overwrites (no append).

**W1.5** — Token redaction in console.error. The module MUST NOT log
the raw token string under any condition. If logging the existence of
a token, log `ows_key_***` (prefix preserved for searchability,
suffix redacted).

**Done when:** all W1 unit tests pass; manual `grep ows_key_` against
captured logs shows zero raw tokens.

### W2 — `WalletDistributor` refactor (Day 2, 5 hr)

Rewrite `src/wallet/distributor.ts`.

**W2.1** — Replace the `passphrase` constructor argument with
`apiToken`. Add startup check:

```typescript
constructor(apiToken: string, vaultPath?: string) {
  if (!apiToken.startsWith("ows_key_")) {
    throw new Error(
      "WalletDistributor requires an OWS API token (ows_key_…). " +
      "Use FamilyApiTokenManager.getToken(familyId) or " +
      "lazyMintTokenForLegacyFamily(familyId)."
    );
  }
  // ...
}
```

**W2.2** — In `transferUSDC`, resolve the source wallet's canonical
UUID and EVM address:

```typescript
const sourceWallet = getWallet(fromWallet, this.vaultPath);
const sourceAccount = sourceWallet.accounts.find(
  (a) => a.chainId === chainId
);
if (!sourceAccount) throw new Error(`No account for ${chainId}`);
const sourceAddress = sourceAccount.address as `0x${string}`;
const walletId = sourceWallet.id;  // UUID per Spec 01
```

**W2.3** — Build the unsigned EIP-1559 envelope via viem:

```typescript
const prepared = await publicClient.prepareTransactionRequest({
  account: sourceAddress,
  chain: viemChain,
  to: usdcAddress as `0x${string}`,
  data: transferData,
  value: 0n,
});
const unsignedHex = serializeTransaction({
  chainId: viemChain.id,
  nonce: prepared.nonce!,
  maxFeePerGas: prepared.maxFeePerGas!,
  maxPriorityFeePerGas: prepared.maxPriorityFeePerGas!,
  gas: prepared.gas!,
  to: prepared.to,
  data: prepared.data,
  value: 0n,
  type: "eip1559",
});
```

**W2.4** — Invoke OWS `signAndSend` (with `sign` fallback). Runtime
detection of `signAndSend` availability:

```typescript
import * as ows from "@open-wallet-standard/core";

let transactionHash: string;
if (typeof (ows as any).signAndSend === "function") {
  const result = await (ows as any).signAndSend({
    walletId,
    chainId,
    transactionHex: unsignedHex,
    credential: this.apiToken,
    rpcUrl,
    vaultPath: this.vaultPath,
  });
  transactionHash = result.transactionHash;
} else {
  const signed = await (ows as any).sign({
    walletId,
    chainId,
    transactionHex: unsignedHex,
    credential: this.apiToken,
    vaultPath: this.vaultPath,
  });
  transactionHash = await publicClient.sendRawTransaction({
    serializedTransaction: signed.signature as `0x${string}`,
  });
}
```

**W2.5** — Confirmation polling via viem `waitForTransactionReceipt`
remains unchanged. Return `{txHash, from, to, amount}` matching the
existing `TransferResult` shape — no callsite-facing API changes.

**W2.6** — Drop the `mnemonicToAccount`, `privateKeyToAccount`,
`createWalletClient`, `exportWallet` imports. They are no longer used.

**W2.7** — Unit tests (test-4.1.md §AM11-AM18). See test doc.

**Done when:** all existing W2-touching tests in
`tests/wallet/distributor.test.ts` continue to pass after the rewrite,
plus the new agent-mode-specific tests added in W7.

### W3 — `WalletSetup` return-value enrichment (Day 1, 1 hr)

`src/wallet/setup.ts:initializeFamily` already returns
`{managerToken, wallets}`. Add `managerKeyId`:

```typescript
// In setup.ts after createApiKey:
const managerKey = createApiKey(...);
return {
  managerToken: managerKey.token,
  managerKeyId: managerKey.id,        // ← new
  wallets: createdWallets,
};
```

Update the return type declaration. No other code changes.

**Done when:** `tsc --noEmit` passes; `setup.ts` exposes the apiKeyId.

### W4 — Bootstrap path (Day 3, 1 hr)

`src/core/configure-family.ts:bootstrapFamily` captures and persists the
token returned by `WalletSetup.initializeFamily`.

**W4.1** — Capture the result:

```typescript
const setupResult = await setup.initializeFamily(familyConfig, familyKey);
```

**W4.2** — Persist via `FamilyApiTokenManager`:

```typescript
const apiTokens = new FamilyApiTokenManager();
apiTokens.saveToken(
  familyId,
  setupResult.managerToken,
  setupResult.managerKeyId
);
```

**W4.3** — Add to `bootstrapFamily`'s success path (just before the
final return). Do NOT update `updateExistingFamily` — that path doesn't
mint new tokens (the token is bootstrap-scoped per family).

**Done when:** integration test `configure-policy` (bootstrap path)
produces a row in `data/family-api-tokens.json` matching the new
family's UUID.

### W5 — Lazy-mint helper (Day 3, 2 hr)

For pre-4.1 families that don't have a token yet, mint one on first call.

**W5.1** — Add to `src/keys/family-api-tokens.ts`:

```typescript
import { createApiKey } from "@open-wallet-standard/core";
import { FamilyKeyManager } from "./family-keys.js";
import { POLICY_IDS, WALLET_NAMES } from "../constants.js";
import { getFamilyVaultPath } from "../engine/state.js";
import { StateManager } from "../engine/state.js";

export async function lazyMintTokenForLegacyFamily(
  familyId: string
): Promise<string> {
  const apiTokens = new FamilyApiTokenManager();
  const cached = apiTokens.getToken(familyId);
  if (cached) return cached;

  const familyKeys = new FamilyKeyManager();
  if (!familyKeys.hasFamilyKey(familyId)) {
    throw new Error(
      `Family ${familyId} has no encryption key — ` +
      `configure-policy was never completed.`
    );
  }
  const passphrase = familyKeys.getFamilyKey(familyId);

  const walletNames = await listFamilyWalletNames(familyId);
  const result = createApiKey(
    "allowance-agent-manager-v2",
    walletNames,
    [POLICY_IDS.ALLOWANCE_FULL_ACCESS],
    passphrase,
    undefined,
    getFamilyVaultPath(familyId)
  );

  apiTokens.saveToken(familyId, result.token, result.id);
  return result.token;
}

async function listFamilyWalletNames(familyId: string): Promise<string[]> {
  const state = new StateManager();
  const config = await state.loadFamilyConfig(familyId);
  if (!config) throw new Error(`Family config not loaded for ${familyId}`);
  const names: string[] = [
    WALLET_NAMES.TREASURY,
    WALLET_NAMES.SAVINGS_VAULT,
    WALLET_NAMES.GIFT_FUND,
  ];
  for (const child of config.children) {
    if (!child.walletAddress) {
      names.push(WALLET_NAMES.childWallet(child.name));
    }
  }
  return names;
}
```

**W5.2** — Idempotency: a second call returns the cached token without
re-running scrypt or re-minting. Tested in AM21.

**W5.3** — Failure mode: if `createApiKey` fails (e.g., passphrase
mismatch from a corrupt FamilyKeyManager entry), the error propagates.
The caller in `distribute-allowance` falls back to a clear error message
asking the parent to re-run `configure-policy`.

**Done when:** AM21-AM25 pass; lazy-mint on a fresh pre-4.1 family
fixture produces a usable token.

### W6 — Callsite swaps (Day 3, 2 hr)

Three files. Identical diff pattern.

**W6.1** — `src/tools/distribute-allowance.ts`. The block at
~line 50-60:

```typescript
// BEFORE:
const keyManager = new FamilyKeyManager();
let passphrase: string | undefined;
if (keyManager.hasFamilyKey(familyId)) {
  passphrase = keyManager.getFamilyKey(familyId);
} else if (process.env.OWS_PASSPHRASE) {
  passphrase = process.env.OWS_PASSPHRASE;
  console.error(`[keys] Using legacy OWS_PASSPHRASE...`);
}
const distributor = new WalletDistributor(passphrase, getFamilyVaultPath(familyId));

// AFTER:
const apiTokens = new FamilyApiTokenManager();
let token = apiTokens.getToken(familyId);
if (!token) {
  token = await lazyMintTokenForLegacyFamily(familyId);
}
const distributor = new WalletDistributor(token, getFamilyVaultPath(familyId));
```

Drop the `OWS_PASSPHRASE` env-var fallback — it doesn't make sense in
the token-based world.

**W6.2** — `src/tools/release-savings.ts`. Same diff at the analogous
block.

**W6.3** — `src/tools/settle-session-payout.ts`. Same diff in
`settleSessionPayout` function.

**W6.4** — Remove the now-dead `if (!passphrase)` error guards. The
token resolution above either returns a valid token or throws.

**Done when:** all existing 389+ tests for distribute-allowance,
release-savings, and settle-session-payout pass without any test-side
modification beyond the constructor argument substitution.

### W7 — Policy-engine engagement test (Day 2, 2 hr)

The lock-in artifact for the sprint. Confirms that `allowance-policy.py`
actually runs on real transfers.

**W7.1** — Test setup (AM26 in test-4.1.md): create a test family with a
known authorized child wallet AND a known unauthorized address.
Mint the API token via the bootstrap path. Configure
`allowance-policy.py` with the authorized wallet in `authorized_wallets`.

**W7.2** — Positive test (AM27): `transferUSDC` to the authorized
wallet succeeds. After the test, read
`~/.ows/families/<id>/.ows/logs/audit.jsonl`. Assert:

- One entry with `operation: "broadcast_transaction"` exists.
- The entry's `api_key_id` matches the family's token's apiKeyId.
- A `policy_evaluated` entry precedes the broadcast entry.

**W7.3** — Negative test (AM28): `transferUSDC` to the unauthorized
address throws `POLICY_DENIED`. After the test, read the OWS audit
log. Assert:

- A `policy_evaluated` entry exists with `result: deny`.
- No `broadcast_transaction` entry exists.
- The on-chain RPC was NOT called (verify via mock RPC counter, or via
  checking `eth_getTransactionCount` was not incremented).

**W7.4** — Audit log validation helper: extract this into
`tests/helpers/ows-audit-log.ts` for reuse by future sprints (4.2 will
forward this log; 4.4 will move audit storage but keep OWS's log
in place).

**Done when:** AM27 and AM28 pass against Base Sepolia testnet using
real OWS signing. The "in-process" execution path is verified end-to-end.

### W8 — Performance measurement (Day 3, 1 hr)

Symmetric to W0. Re-runs the same benchmark harness against the
post-4.1 code.

**W8.1** — Run `tests/bench/distributor.bench.ts` 100 sequential
`transferUSDC` calls. Write to `sprint-4.1/baselines/post-4.1.json`.

**W8.2** — Decompose timing: confirm scrypt time is 0 (no `exportWallet`
calls), confirm HKDF-equivalent time is <1ms (inside OWS Rust; will
appear as part of the OWS sign call latency).

**W8.3** — Lock benchmarks into `tests/bench/distributor.bench.test.ts`
as assertions:

```typescript
test("AM-PERF-1: scrypt elimination", () => {
  const pre = require("../../sprint-4.1/baselines/pre-4.1.json");
  const post = require("../../sprint-4.1/baselines/post-4.1.json");
  expect(post.p50).toBeLessThan(pre.p50 - 40);  // SC3
  expect(post.p95).toBeLessThan(pre.p95 - 60);
});
```

**Done when:** p50 delta ≥40ms (the success criterion lower bound); the
assertion test is committed and runs in CI.

### W9 — Token redaction + Sentry/log hardening (Day 3, 1 hr)

Final pass to ensure `ows_key_…` never appears in logs, error messages,
audit details, or Sentry breadcrumbs.

**W9.1** — Add a global string-redaction step to Sentry's
`beforeSend` (in `app/server.ts` Sentry init — anticipates Sprint 4.2):

```typescript
Sentry.init({
  // ...
  beforeSend(event) {
    const json = JSON.stringify(event);
    if (json.match(/ows_key_[a-f0-9]{64}/i)) {
      Sentry.captureMessage("TOKEN_LEAK: ows_key_ detected in Sentry event");
      const scrubbed = json.replace(/ows_key_[a-f0-9]{64}/gi, "ows_key_***");
      return JSON.parse(scrubbed);
    }
    return event;
  },
});
```

(If Sprint 4.2 hasn't shipped Sentry yet, add this comment as a
TODO-tagged stub for W4.2's W3 task.)

**W9.2** — Audit-details scrubbing: `state.addAuditEntry`'s `details`
object can contain arbitrary fields. Add a string-walk that redacts
`ows_key_…` patterns. Implementation in `src/engine/state.ts`:

```typescript
function redactTokens(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/ows_key_[a-f0-9]{64}/gi, "ows_key_***");
  }
  if (Array.isArray(obj)) return obj.map(redactTokens);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, redactTokens(v)])
    );
  }
  return obj;
}
// In addAuditEntry:
const safeDetails = redactTokens(entry.details);
```

**W9.3** — Regex scan of test fixtures + CI step. New test AM49:

```typescript
test("AM49: no token leaks in repo", async () => {
  const files = await glob("**/*.{ts,js,json,md}", { ignore: ["node_modules"] });
  for (const f of files) {
    const content = await readFile(f, "utf-8");
    expect(content).not.toMatch(/ows_key_[a-f0-9]{64}/);
  }
});
```

**Done when:** AM45-AM50 (security tests) pass; no `ows_key_…` patterns
in repo, logs, or Sentry test events.

## 5. Decisions

### D1 — Token storage location

**Decision:** `data/family-api-tokens.json` at the global data dir.

**Rationale:** Mirrors `member-index.json` and `setup-codes.json` —
global lookup tables wrapped under the master key. Mixing the
credential with the family-scoped data dir creates the same
isolation footgun Sprint 2.9 explicitly removed.

**Rejected alternatives:** inside `data/families/<id>/`; inside the
OWS vault.

### D2 — Lazy-mint vs eager migration for pre-4.1 families

**Decision:** Lazy-mint on first call.

**Rationale:** Avoids a migration script, avoids a blocking startup
hook, amortizes scrypt cost over natural usage. One-time 50-100ms
hit is invisible to users. The branch is removable in Sprint 4.2
once `family-api-tokens.json` row count equals `data/families/`
directory count.

**Rejected alternative:** eager migration via a one-shot script at
deploy time. Adds operational complexity for no benefit at AllowMe's
scale.

### D3 — `signAndSend` vs `sign` + manual broadcast

**Decision:** `signAndSend` if exported, `sign` + manual broadcast
as runtime fallback.

**Rationale:** Fewer code paths; OWS audit log consistently captures
the broadcast event (broadcasts via viem don't appear in OWS audit
log); simpler error handling. The fallback is two extra lines if the
SDK doesn't yet export `signAndSend`.

### D4 — Keep `FamilyKeyManager`

**Decision:** Keep it. Don't remove or deprecate.

**Rationale:** The per-family encryption key is the passphrase that
unlocks the OWS wallet. The API token sits ON TOP of that — it doesn't
replace it. Owner-mode signing must remain possible for token rotation,
emergency recovery, and the lazy-mint path itself (which needs the
passphrase to mint a new token).

### D5 — One token per family, scoped to ALL family wallets

**Decision:** Single Manager-scoped token per family.

**Rationale:** `WalletSetup.initializeFamily` already creates exactly
this. The Manager role at the application layer has access to all
family wallets; per-wallet tokens would create OWS-layer scope tighter
than the application-layer access. Incoherent.

**Rejected alternative:** per-(family, wallet) tokens. Reconsidered
when Sprint 4.x introduces non-Manager signing (e.g., co-parent gift
fund).

### D6 — Drop `OWS_PASSPHRASE` env-var fallback in callsites

**Decision:** Remove the env-var fallback in
`distribute-allowance`, `release-savings`, `settle-session-payout`.

**Rationale:** The env var was a single-family backward-compat hack.
With per-family tokens, an env-var-supplied passphrase can't possibly
map to the right family. Keep `OWS_PASSPHRASE` support only in
`FamilyKeyManager` (where it serves legacy import flows).

### D7 — Token redaction is mandatory, not best-effort

**Decision:** Active redaction via `beforeSend` (Sentry), `redactTokens`
(audit log), and CI regex scan.

**Rationale:** Tokens are bearer credentials. A single leaked token
in a Sentry crash report or an audit-log file shared with a partner
compromises the family treasury. Defense-in-depth via three independent
redaction layers + a CI gate that fails the build if any layer is
bypassed.

## 6. Success criteria

Numbered for cross-reference with test-4.1.md.

**SC1** — `WalletDistributor` constructor throws if passed anything
other than an `ows_key_…` string. Verified by AM12.

**SC2** — A transfer to a recipient absent from `authorized_wallets`
throws `POLICY_DENIED` and produces no on-chain transaction. Verified
by AM28.

**SC3** — Per-transfer benchmark: median `transferUSDC` time on Base
Sepolia drops by at least 40ms vs the pre-4.1 baseline. Verified by
AM-PERF-1.

**SC4** — All existing distribute-allowance + release-savings +
settle-session-payout tests pass without modification beyond the
constructor argument substitution. Verified by AM36-AM40 (regression
suite).

**SC5** — The OWS audit log gains a `policy_evaluated` entry per
transfer. Verified by AM27.

**SC6** — Lazy-mint path executes exactly once per legacy family
(idempotent on second call). Verified by AM21-AM22.

**SC7** — `ows_key_…` token never appears in: console output, Sentry
events, AllowMe audit log details, OWS audit log details, source code,
test fixtures, committed files. Verified by AM45-AM50.

**SC8** — The new code path is exercised by at least one CI test on
every PR. The path is not dead-code. Verified by code coverage report
showing `>=85%` line coverage on `family-api-tokens.ts` and
`distributor.ts`.

## 7. Risks + mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | OWS Node SDK doesn't export `signAndSend` | Medium | Low | Runtime fallback to `sign` + viem broadcast (D3). Two-line delta. |
| R2 | Token leaks via logs/breadcrumbs/Sentry | Low | High | Triple redaction (W9) + CI scan (AM49). |
| R3 | Lazy-mint fails during a user-visible transfer | Low | Medium | If `lazyMintTokenForLegacyFamily` throws, fall back to one-time owner-mode signing for that transfer; queue background retry; surface a non-blocking warning. (W5.3) |
| R4 | Orphaned API key from pre-4.1 `WalletSetup.initializeFamily` | High (every existing family) | Low | The orphan is harmless — the token was never used. Sprint 4.2 cleanup task: list OWS API keys, identify pre-4.1 orphans (created_at before deploy date, no matching row in `family-api-tokens.json`), revoke them. |
| R5 | Policy engine rejects a legitimate transfer due to misconfigured `authorized_wallets` | Medium | High (user-visible failure) | Pre-deploy: audit every existing family's `authorized_wallets` config vs current `FamilyConfig.children[].walletAddress`. Reconciliation script in `scripts/audit-policy-config.ts`. |
| R6 | Performance regression on RPC-bound portion (e.g., OWS Rust core has overhead vs viem) | Low | Medium | W8 benchmark is mandatory pre-cutover. If post-4.1 p95 exceeds pre-4.1 p95 by more than 20ms, abort cutover and investigate. |
| R7 | Token storage corruption (mid-write crash) | Low | High | Atomic write via tmp+rename (same pattern as `FamilyKeyManager`). If still corrupt, lazy-mint regenerates from passphrase. |
| R8 | A second concurrent `distribute-allowance` for the same family while lazy-mint is in flight | Low | Medium | Lazy-mint is idempotent (W5.2). Worst case: two scrypt calls instead of one. Eventual consistency: both writes converge to the same token (the second `createApiKey` call generates a different token, but only one wins the `saveToken` race; the other becomes an orphan). For Sprint 4.2 cleanup. |

## 8. Out of scope (explicit)

These are deliberate omissions, NOT future work. Each is paired with
the reason it's deferred.

- **Concurrent transfer serialization.** OWS doesn't provide nonce
  serialization (Spec 02 §Concurrency). viem handles it via
  `getTransactionCount`. The current 389+ test suite passes; no new
  concurrency primitives needed.
- **Multi-token per family.** Per-role tokens (manager, co-parent,
  family) become relevant when non-Manager signing is introduced.
- **Token rotation tooling.** Manual rotation via `forgetToken` + lazy-
  mint works today; automated periodic rotation is future.
- **Pre-deploy audit log forwarding.** Sprint 4.2 work.
- **OWS Rust core hardening verification.** Spec 05 §Threat Model
  describes mlock/zeroize/anti-coredump — these are OWS implementation
  responsibilities, not AllowMe's. Trust the spec.
- **Smart-account migration.** Out of program scope.

## 9. Deployment + rollback

### 9.1 Pre-deploy checklist

1. W0 baseline measured and committed.
2. R5 reconciliation script run; all existing families' allowlist
   configurations validated.
3. W7 policy-engine engagement test green on Base Sepolia testnet.
4. W8 post-4.1 benchmark green; SC3 satisfied.
5. W9 token redaction CI step green.
6. Manual smoke test: bootstrap a fresh test family on Sepolia, run a
   distribute-allowance, verify OWS audit log shows policy evaluation.

### 9.2 Deploy

- Tag `pre-sprint-4.1` on main.
- Merge Day 1 PR → deploy to Railway. Wait 24h, verify no regressions.
- Merge Day 2 PR → deploy. Verify no regressions.
- Merge Day 3 PR → deploy. Monitor closely for 48h.

### 9.3 Rollback procedure

If post-deploy anomaly:

1. **Symptom:** transfers failing with `POLICY_DENIED` for
   legitimate destinations.
   **Cause:** R5 missed an allowlist misconfig.
   **Recovery:** Hotfix the affected family's `allowance-policy.py`
   config via `configure-policy` to add the missing destination. The
   policy file is re-loaded on next signing call.

2. **Symptom:** transfers failing with token errors.
   **Cause:** R8 race or R7 corruption.
   **Recovery:** Delete the family's row in `family-api-tokens.json`;
   lazy-mint regenerates on next call.

3. **Symptom:** p95 regression.
   **Cause:** OWS sign call slower than expected.
   **Recovery:** Revert to `pre-sprint-4.1` tag. Re-investigate
   benchmark methodology.

4. **Symptom:** systemic failure (production down).
   **Recovery:** Revert to `pre-sprint-4.1`. Existing
   `WalletDistributor(passphrase)` path is fully restored. No data
   migration is required — `family-api-tokens.json` is additive; the
   passphrase path still works.

The architectural commitment is: **rollback is one git revert away
through the entire sprint.** No data migrations, no schema changes.

## 10. Approval gate

Before W1 begins, this plan must be reviewed against:

- **research-4.1.md** open questions §5: all five must be marked
  resolved.
- **test-4.1.md** test inventory: every SC must map to at least one
  test.
- **R5 reconciliation:** the pre-deploy script must be drafted (not
  necessarily run) before W6 begins.

The Generator/Evaluator separation pattern from Sprint 3.0.6: the
Generator agent (whoever picks up W1) writes code per the plan; the
Evaluator agent reads the diff against the plan + test inventory and
either approves or returns to Generator with specific objections.

## 11. Status tracker

This document is immutable post-approval. Daily progress lives in
progress-4.1.md (created at sprint start).

- Plan version: 1.0
- Approval: pending
- Sprint start: TBD
- Sprint exit (target): start + 3 working days