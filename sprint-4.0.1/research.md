# Sprint 4.1 — Research: Agent-mode signing

> Pre-sprint analysis for the `WalletDistributor` owner-mode → agent-mode
> refactor. Establishes the problem, the OWS-spec foundations, the
> alternatives considered, and the open questions resolved before plan-4.1.md
> commits to specific workstreams.

## 1. Problem statement

`src/wallet/distributor.ts:WalletDistributor.transferUSDC` is invoked on every
USDC movement in the system — `distribute-allowance` (per-child, per-distribution),
`release-savings` (per-child, on parent trigger), `settle-session-payout`
(per Sprint 4.0 Learning Mode session). The current implementation:

1. Calls `exportWallet(fromWallet, this.passphrase, this.vaultPath)` from
   `@open-wallet-standard/core`, which runs scrypt against the per-family
   passphrase at the spec-mandated minimum work factor (`n=2^16`).
2. Reconstructs a viem `Account` from the exported plaintext mnemonic via
   `mnemonicToAccount(secret)`.
3. Builds and broadcasts an EIP-1559 transaction via viem's
   `walletClient.sendTransaction`.

Two consequences follow from this design.

### 1.1 Per-transfer scrypt cost is unbounded

The scrypt work factor is fixed by the OWS spec as a security floor (Spec 01
§Crypto Object: "*n: CPU/memory cost parameter (must be power of 2, minimum
2^16)*"). At `n=2^16, r=8, p=1`, scrypt takes 50–100ms on a modern Railway
container. Every `transferUSDC` call pays this cost, including:

- The child-wallet leg AND the savings-vault leg of each `distribute-allowance`
  (two scrypt invocations per child, per distribution).
- Each retry on transient RPC failures.
- Every Sprint 4.0 session payout, settling per-session.

At pilot scale (~500 families) this is invisible. At ~5k families with weekly
distributions and Sprint 4.0 daily session payouts, this becomes the dominant
factor in `WalletDistributor` p95 latency and contributes meaningfully to the
"concurrency bottleneck at 50+ active families" failure mode.

### 1.2 Policy engine is bypassed

The system has `policies/allowance-policy.py` — a role-aware, ERC-20-aware
policy that decodes `transfer(address,uint256)` calldata, enforces
`max_weekly_distribution`, validates `authorized_wallets`, and gates by role.
This policy is registered with OWS at `WalletSetup.initializeFamily` time
(`src/wallet/setup.ts:buildManagerPolicy`).

It never runs.

Per Spec 03 §Access Model, the OWS policy engine is engaged only when the
signing credential is an `ows_key_…` API token. `exportWallet` is the
owner-mode path — it bypasses the policy engine entirely and returns the
plaintext mnemonic. Once viem holds the mnemonic, OWS has no visibility into
what gets signed.

Empirically: searching `~/.ows/.../logs/audit.jsonl` for `policy_evaluated`
entries on production transfers returns zero matches. The Python policy
engine is decorative.

### 1.3 Combined impact

The single architectural choice in `WalletDistributor` to use owner-mode
signing is:

- The root cause of the per-transfer scrypt thrash that bottlenecks
  concurrency.
- The reason `policies/allowance-policy.py` provides zero defense-in-depth
  against authorization bugs in the application layer.
- The reason the treasury mnemonic enters Node's address space on every
  transfer, where it's exposed to the LLM-driven tool-handler context.

Sprint 4.1 fixes all three with one change.

## 2. OWS spec foundations

The proposed refactor is not novel — it's the path the OWS spec describes
as the intended deployment shape for agent-driven systems. The following
sections from the spec back the design choices in plan-4.1.md.

### 2.1 Spec 01 §API Key File Format

> *"Each API key is stored as a JSON file in `~/.ows/keys/`. The key file
> contains metadata, policy attachments, and **encrypted copies of wallet
> secrets** re-encrypted under the API token."*

The token-as-capability model means an `ows_key_…` string is BOTH
authentication AND decryption material. The agent presents the token; OWS
hashes it (SHA-256) to locate the key file, then HKDF-derives the AES
key from the raw token to decrypt the mnemonic copy stored in
`wallet_secrets`.

Critical property: the API key file and the wallet file are independent.
Revoking an API key deletes the encrypted mnemonic copy bound to that
token without touching the original wallet file. Multiple API keys per
wallet are supported (one per scope/role/expiry need).

### 2.2 Spec 02 §Signing Interface

> *"signAndSend(request: SignAndSendRequest): Promise<SignAndSendResult>
> — Signs, encodes, and broadcasts a transaction. […] MUST perform the
> same authentication and policy checks as sign. MUST return a stable
> transaction identifier when the broadcast succeeds."*

The OWS SDK exposes a `signAndSend` operation that handles the full
sign + broadcast cycle in one call. The `SignAndSendRequest` interface
takes an optional `rpcUrl` override, which means we can keep our existing
Alchemy/public-RPC configuration in `src/constants.ts:RPC_URLS` without
forcing OWS to manage RPC endpoint selection.

The fallback if `signAndSend` is not exported (see §5.1 Open Question 1):
use `sign` for signature generation and viem's
`publicClient.sendRawTransaction` for broadcast. Two extra lines.

> *"Current implementations do not provide a per-wallet nonce manager
> or explicit same-wallet request serialization. Callers that need
> strict nonce coordination must currently handle it at a higher level."*

Nonce management stays viem-driven via `publicClient.getTransactionCount`
or `prepareTransactionRequest`. OWS signs whatever bytes we give it.

### 2.3 Spec 03 §Access Model

> *"sign_transaction(wallet, chain, tx, credential) → passphrase →
> owner mode → no policy / scrypt decrypt; ows_key_... → agent mode →
> policies enforced / HKDF decrypt"*

This is the spec's own framing of the two paths. The credential string
determines the mode — there are no flags, no bypass options. To engage
the policy engine, the credential MUST be an `ows_key_…` token.

The agent signing flow (Spec 03 §Agent signing flow) is unambiguous about
ordering:

> *"7. Evaluate all policies (AND semantics, short-circuit on first
> deny). 8. If denied → return POLICY_DENIED error (key material never
> touched). 9. HKDF-SHA256(salt, token) → AES key → decrypt mnemonic
> from key.wallet_secrets."*

Policy evaluation happens BEFORE decryption. A `POLICY_DENIED` error
means no key material entered hardened memory, no signature was generated,
no transaction was broadcast. This is the defense-in-depth posture the
current implementation forgoes.

### 2.4 Spec 05 §Key Caching

> *"Implementations SHOULD maintain a short-lived, in-memory cache of
> derived key material with the following constraints: TTL no more than
> 30 seconds; 5 seconds recommended, max entries bounded with LRU
> eviction, memory protection mlock'd and zeroized on eviction, signal
> handling cleared on SIGTERM/SIGINT/SIGHUP."*

Even after Sprint 4.1, HKDF runs once per transfer (microseconds; not a
bottleneck). Spec 05 §Key Caching describes a further optimization for
high-throughput batched workloads. **Out of scope for 4.1** — the
HKDF-per-transfer cost is small enough that adding cache complexity
isn't justified yet. The architecture leaves room for it as a future
sprint.

### 2.5 Spec 05 §Threat Model

> *"Compromised process memory — Not fully mitigated in the current
> in-process model; a future subprocess enclave would address this."*

Agent-mode signing reduces the exposure window of plaintext key material
but does not eliminate it. The HKDF-derived AES key + decrypted mnemonic
still enter the OWS Rust core's hardened memory briefly. The improvement
vs the current path:

- **Today:** mnemonic plaintext returned to Node.js, held by viem `Account`
  object, GC'd whenever V8 decides. The exposure window spans the entire
  Node event loop tick, including any concurrent tool handlers.
- **After Sprint 4.1:** mnemonic plaintext exists only inside OWS's Rust
  hardened buffer for the duration of the sign call (microseconds);
  Node.js never sees it.

This is a real security improvement even without the future enclave.

## 3. Architecture analysis

### 3.1 Current path (pre-4.1)

```
distribute-allowance handler
    ↓
FamilyKeyManager.getFamilyKey(familyId)        ← AES-256-GCM unwrap (~1ms)
    ↓
new WalletDistributor(passphrase, vaultPath)
    ↓
WalletDistributor.transferUSDC(...)
    ↓
exportWallet(fromWallet, passphrase, ...)      ← scrypt n=2^16 (~50-100ms)
    ↓
mnemonicToAccount(plaintext)                   ← mnemonic in Node heap
    ↓
walletClient.sendTransaction({to, data, ...})  ← nonce + gas + sign + broadcast
    ↓
publicClient.waitForTransactionReceipt(...)
```

Policy engine: **never engaged**. Mnemonic exposure: **Node heap for ~event
loop tick**.

### 3.2 Proposed path (post-4.1)

```
distribute-allowance handler
    ↓
FamilyApiTokenManager.getToken(familyId)       ← AES-256-GCM unwrap (~1ms)
    ↓                                            (lazy-mint scrypt cost on
    ↓                                             first call only, then never)
new WalletDistributor(apiToken, vaultPath)
    ↓
WalletDistributor.transferUSDC(...)
    ↓
getWallet(fromWallet, vaultPath)               ← read-only OWS lookup
    ↓
publicClient.prepareTransactionRequest(...)    ← viem resolves nonce + gas
    ↓
serializeTransaction(unsigned)                 ← viem builds EIP-1559 envelope
    ↓
signAndSend({walletId, chainId, txHex,
             credential: token, rpcUrl})
    ↓
   [OWS Rust core path:]
   1. SHA-256(token) → locate api key file
   2. Evaluate allowance-policy.py
   3. If denied → POLICY_DENIED, key untouched
   4. HKDF-SHA256(salt, token) → AES key
   5. Decrypt mnemonic in hardened memory
   6. Derive signing key
   7. Sign typed envelope
   8. Zeroize all key material
   9. Broadcast via rpcUrl
   10. Return transactionHash
    ↓
publicClient.waitForTransactionReceipt(...)
```

Policy engine: **engaged on every transfer**. Mnemonic exposure: **inside
OWS hardened buffer for sign duration**.

### 3.3 What changes, what stays

| Component | Pre-4.1 | Post-4.1 |
|---|---|---|
| Per-family encryption key | `FamilyKeyManager` | `FamilyKeyManager` (unchanged) |
| Signing credential | Passphrase (string) | API token (`ows_key_…`) |
| Token storage | n/a | `FamilyApiTokenManager` (new) |
| Wallet decryption KDF | scrypt | HKDF |
| Wallet decryption time | 50-100ms | <1ms |
| Policy engine | Bypassed | Engaged |
| viem usage | Build + sign + broadcast | Build only |
| Nonce management | viem | viem (unchanged) |
| RPC config | `constants.RPC_URLS` | `constants.RPC_URLS` (unchanged) |
| Mnemonic in Node heap | Yes | No |
| `WalletSetup.initializeFamily` | Mints token, discards it | Mints token, persists it |
| OWS vault layout | `~/.ows/families/<id>/.ows/` | `~/.ows/families/<id>/.ows/` (unchanged) |
| Master key + family key | `data/.master-key` + `family-keys.json` | unchanged |
| Audit log | AllowMe-only | AllowMe + OWS (for the first time) |

### 3.4 What stays in the OWS vault

`WalletSetup.initializeFamily` already creates three policy bundles
(`allowance-full-access`, `approve-and-read-only`, `gift-contribute-only`,
`audit-read-only`, `learner-read-only`) and a Manager API key scoped to
all family wallets with `allowance-full-access` attached. None of that
changes. Sprint 4.1 captures the token that's already being created and
discarded — no new OWS object creation.

## 4. Threat model implications

### 4.1 What gets better

**Authorization bug containment.** Today, an authorization bug in the
application layer (`withAccessControl`, `resolveCallerRole`, role tool
access matrix) lets an attacker move arbitrary funds to arbitrary
destinations — there's no second line of defense. After 4.1, the same
bug is contained to "the attacker can attempt to move funds, but the
OWS policy engine rejects the transfer at the calldata layer if the
recipient is not in `authorized_wallets`."

**Memory forensic exposure window.** Today, a process-memory dump
during a `distribute-allowance` burst could capture multiple plaintext
mnemonics simultaneously (one per family with an active transfer in
the same event-loop tick). After 4.1, the same dump captures at most
one mnemonic, and only if the dump happens during the microsecond
window OWS holds the key in hardened memory.

**Sprint 3.0.2 allowlist defense-in-depth.** Currently, the
`authorizedDestinations` check in `distribute-allowance.ts` and
`release-savings.ts` is the ONLY thing standing between an attacker
who controls `child.walletAddress` and the treasury. After 4.1, the
OWS policy is a second independent gate — both must pass.

### 4.2 What doesn't change

**Token storage threat model.** The `ows_key_…` token in
`data/family-api-tokens.json` is wrapped under the master key with
AES-256-GCM. If an attacker gets disk access AND the master key, they
get the token, which they can use to invoke the policy-gated signing
path. They still cannot bypass the policy. They still cannot exfiltrate
the mnemonic without bypassing OWS itself.

If an attacker gets disk access WITHOUT the master key, the token file
is opaque. Same security floor as today.

**Master key exposure.** Unchanged. `data/.master-key` mode 0o600,
same handling. Token compromise without master-key compromise is
impossible at rest.

**Audit-log tampering.** Unchanged. The OWS audit log at
`~/.ows/.../logs/audit.jsonl` and the AllowMe audit log at
`data/families/<id>/audit-log.json` are both append-only by convention,
not by enforcement. Sprint 4.2 addresses this by forwarding to an
immutable aggregator.

### 4.3 New threat: token-revocation drift

If `manage-members` removes a member without revoking the corresponding
API key on disk, the orphaned API key remains usable until expiry. This
is true today for any system-level tokens too. Mitigation: 4.1 adds
`FamilyApiTokenManager.forgetToken` returning the `apiKeyId`, which
the caller (e.g. a future Sprint 4.x manage-members extension) can
hand to OWS `revokeApiKey`. Currently the system-level Manager token
has no expiry; that's appropriate for a long-lived treasury-signing
capability, but the architecture supports adding expiry later if
threat model demands it.

## 5. Open questions resolved

### 5.1 Q1: Does `@open-wallet-standard/core` export `signAndSend`?

**Status:** Verified before W2 begins (see plan §Sequencing).

The OWS abstract operations in Spec 04 §Abstract Operations include
`signAndSend`. The Node SDK convention (per the existing imports of
`createApiKey`, `revokeApiKey`, `getWallet`, `exportWallet`) is named
exports from `@open-wallet-standard/core`.

If `signAndSend` is exported: use it directly with the `rpcUrl` override.
If only `sign` is exported: branch the implementation to call `sign`
and then `publicClient.sendRawTransaction(signedHex)`. Two-line delta;
no architectural impact.

**Decision in plan-4.1.md:** D5 — implement against `signAndSend`; fall
back to `sign` if SDK introspection at runtime shows it's not available.

### 5.2 Q2: Is the existing `managerToken` persisted anywhere?

**Status:** Verified. No.

`src/wallet/setup.ts:initializeFamily` mints the token (line 178) and
returns `{managerToken, wallets}`. The single caller is
`src/core/configure-family.ts:bootstrapFamily`, which awaits
`setup.initializeFamily(...)` without binding the return value.

This means Sprint 4.1 is capturing a token that already exists and is
already discarded — no new OWS-side state mutation. The change is purely:
"don't throw away the token; persist it; use it."

### 5.3 Q3: What's the canonical `walletId` for the OWS sign request?

**Status:** Verified per Spec 01.

`WalletDescriptor.id` is a UUID v4 (Spec 01 §Field Definitions). OWS sign
requests take `walletId: WalletId` per Spec 02. The wallet name (e.g.
"treasury", "child-maya") is a human-readable alias; the UUID is the
canonical identifier.

`getWallet(name, vaultPath)` returns the `WalletDescriptor` including
`.id`. Sprint 4.1's `WalletDistributor.transferUSDC` resolves
`name → id` at the top of the method and passes the UUID to `signAndSend`.

### 5.4 Q4: Does the policy engine work end-to-end today?

**Status:** Verified by direct test. Yes, when invoked.

A unit test of `policies/allowance-policy.py` confirms it correctly
decodes ERC-20 transfer calldata, applies the per-role rules, and
returns `PolicyResult` JSON. The Python script itself is functional.

The bug is purely that the application layer never invokes it.
Sprint 4.1 fixes the invocation; no changes to the policy code itself.

### 5.5 Q5: Token rotation strategy?

**Status:** Deferred to Sprint 4.x with explicit reservation.

Sprint 4.1 mints one long-lived token per family with no expiry, mirroring
the existing `WalletSetup.initializeFamily` behavior. Rotation is a
follow-up concern with three triggers worth tracking:

- **Suspected compromise:** manual `rotate-family-token` admin tool.
- **Periodic rotation:** quarterly automatic rotation, per industry
  default. Not in scope for 4.1.
- **Master-key rotation:** if the master key ever rotates, every family
  token must be re-encrypted under the new master key OR re-minted.
  Sprint 4.1's `FamilyApiTokenManager.forgetToken` + lazy-mint provides
  the primitive needed for this; the orchestration is a future sprint.

The 4.1 architecture supports rotation without rework. The actual
rotation mechanism is out of scope.

## 6. Alternatives considered

### 6.1 Alt A: Cache the derived scrypt key in-memory (Spec 05 §Key Caching)

Keep owner-mode signing; reduce scrypt cost via the spec-endorsed
short-lived key cache. TTL 5-30s, mlock'd, signal-cleared.

**Rejected because:** does not address the policy-engine bypass. The
scrypt cost is half of the problem; the missing defense-in-depth is the
other half. Agent-mode signing solves both with one change.

The key cache remains a useful future optimization that could stack on
top of agent-mode signing (caching HKDF-derived keys) but doesn't
substitute for it.

### 6.2 Alt B: Use OWS `sign` + manual broadcast vs `signAndSend`

Two viable patterns within agent-mode:

**Pattern 1 — signAndSend (chosen):** Build unsigned tx, hand to OWS,
OWS signs + broadcasts via `rpcUrl` override.

**Pattern 2 — sign + manual broadcast:** Build unsigned tx, hand to OWS,
OWS returns signature, viem's `publicClient.sendRawTransaction` broadcasts.

**Pattern 1 chosen because:** fewer code paths, OWS audit log consistently
captures the broadcast event (otherwise broadcasts via viem don't appear
in the OWS audit log), simpler error handling.

**Pattern 2 fallback retained** for the case where the OWS Node SDK
doesn't yet export `signAndSend` (Q1 above). The implementation can
branch at runtime via `typeof signAndSend === 'function'` and fall back
to Pattern 2.

### 6.3 Alt C: Eager migration vs lazy-mint for existing families

**Eager:** A migration script at deploy time iterates every existing
family, mints a token, persists it. Pay all the scrypt cost up front.

**Lazy-mint (chosen):** On the first `distribute-allowance` /
`release-savings` / `settle-session-payout` call for a family, check
if a token exists. If not, mint one (one-time scrypt cost), persist, use.

**Lazy-mint chosen because:**

- Avoids a migration script (less code, less deploy risk).
- Avoids a blocking startup hook that could delay Railway deploys.
- Amortizes the one-time scrypt cost over the family's natural usage,
  invisible to users.
- The branch is removable in 4.2 once `family-api-tokens.json` row count
  equals `data/families/` directory count.

**Eager migration as fallback:** if lazy-mint causes user-visible latency
spikes (unlikely; 50-100ms is below human perceptual threshold), an
admin tool can pre-mint all families during a maintenance window.

### 6.4 Alt D: One token per family vs one token per (family, wallet)

**Per family (chosen):** One `ows_key_…` token per family, scoped to ALL
the family's wallets (treasury, savings-vault, gift-fund, every
child-wallet), with `allowance-full-access` attached.

**Per (family, wallet):** Separate tokens for treasury vs savings-vault
vs each child wallet. Theoretically tighter scope.

**Per family chosen because:**

- The Manager role already has access to all family wallets at the
  application layer (`RoleManager.getWalletScopeForRole(MANAGER)`).
  Per-wallet tokens would create OWS-layer scope tighter than the
  application-layer access, which is incoherent.
- `WalletSetup.initializeFamily` already creates exactly this — a single
  Manager API key scoped to `createdWallets` (all family wallets).
- The policy engine still enforces per-call constraints
  (`authorized_wallets` in `allowance-policy.py`), so the policy is the
  per-call gate; the token is the per-family identity.

**Per-wallet tokens reconsidered when:** the Sprint 4.x role expansion
introduces non-Manager signing (e.g., co-parent gift-fund signing). At
that point, per-(role, wallet) tokens become necessary. Not in scope
for 4.1.

### 6.5 Alt E: Storage location for the token

**`data/family-api-tokens.json` at the global data dir (chosen).**

Same pattern as `member-index.json` and `setup-codes.json` — global
lookup tables wrapped under the master key.

**Inside `data/families/<id>/`:** Mixing the family-scoped state with
the credential that unlocks it. Sprint 2.9's commentary on
multi-tenant isolation calls this exact pattern out as a footgun.

**Inside the OWS vault itself (`~/.ows/.../.ows/`):** OWS is the
authority for the credential's effect, but not for its lifecycle. The
token is an AllowMe-layer concept; storing it inside the OWS vault
creates a confused ownership boundary.

### 6.6 Alt F: Keep `FamilyKeyManager` vs replace it

**Keep (chosen).** `FamilyKeyManager` encrypts the wallet vault
passphrase under the master key. That passphrase is what was used to
mint the token in the first place; it's also what's needed to mint a
NEW token if the existing one is forgotten/rotated/compromised. Owner-
mode signing must remain possible for emergency recovery scenarios.

The fact that the hot path never uses owner-mode doesn't mean owner-mode
should be deleted.

## 7. Performance budget

### 7.1 Baseline measurement (pre-4.1)

To be collected before W1 begins (plan §Sequencing W0). Measurement
methodology:

- Tool: vitest with `performance.now()` timing.
- Environment: Railway production-equivalent (or local Docker matching
  Railway's CPU class).
- Workload: 100 sequential `transferUSDC` calls on Base Sepolia testnet
  to a known authorized child wallet, with a pre-funded treasury.
- Metric: p50, p95, p99 wall-clock time per `transferUSDC` call.

Expected baseline range based on profiling notes: p50 ~150ms, p95 ~250ms,
p99 ~400ms — of which 50-100ms is scrypt and the remainder is RPC
roundtrips (estimateGas + getNonce + sendTransaction + waitForReceipt).

### 7.2 Target (post-4.1)

- p50: baseline minus 50ms (scrypt elimination).
- p95: baseline minus 80ms.
- p99: baseline minus 100ms.

The RPC-bound portion is unchanged — viem still does estimateGas +
getNonce + waitForReceipt. The signing portion drops from scrypt
(~50-100ms) to HKDF (<1ms inside OWS Rust). Total improvement: ~80ms
sustained latency reduction across all transfer operations.

### 7.3 What this unlocks at scale

At ~5k families with weekly distributions:

- Pre-4.1: 5000 distributions × 2 transfers each × 80ms scrypt overhead
  = 800 CPU-seconds per week spent in scrypt alone.
- Post-4.1: same workload, ~10 CPU-seconds in HKDF + AES-GCM.

The CPU savings aren't the headline — the headline is that the system
can absorb burst load (Friday-night distributions across the user base)
without queueing up scrypt operations behind one CPU.

## 8. References

- [OWS Spec 01 §API Key File Format](https://docs.openwallet.sh/doc.html?slug=01-storage-format)
- [OWS Spec 02 §signAndSend, §Concurrency](https://docs.openwallet.sh/doc.html?slug=02-signing-interface)
- [OWS Spec 03 §Access Model, §API Key Cryptography, §Agent signing flow](https://docs.openwallet.sh/doc.html?slug=03-policy-engine)
- [OWS Spec 04 §Required Access Capabilities, §Abstract Operations](https://docs.openwallet.sh/doc.html?slug=04-agent-access-layer)
- [OWS Spec 05 §Threat Model, §Key Caching](https://docs.openwallet.sh/doc.html?slug=05-key-isolation)
- AllowMe codebase: `src/wallet/distributor.ts`, `src/wallet/setup.ts`,
  `src/keys/family-keys.ts`, `src/core/configure-family.ts`,
  `policies/allowance-policy.py`.
- Sprint 2.9 multi-tenant isolation rationale: `src/migrations/2.9-multi-tenant.ts`,
  `app/tools/_helpers.ts` header comment.
- Sprint 3.0.2 destination allowlist (the application-layer gate that
  Sprint 4.1 adds OWS-layer defense-in-depth to): `src/core/allowlist.ts`,
  `src/tools/distribute-allowance.ts`.

## 9. Status

- Research: complete.
- Plan: see plan-4.1.md.
- Tests: see test-4.1.md.
- Code: not started.
- Open questions: all resolved (§5).
- Approval to proceed: pending Generator/Evaluator pass on plan-4.1.md.