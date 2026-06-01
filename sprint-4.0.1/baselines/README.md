# Sprint 4.1 — Performance baselines

> Operator-owned artifacts. Captured by `tests/bench/distributor.bench.ts`.

## Files

- `pre-4.1.json` — captured against the `pre-sprint-4.1` git tag (owner-mode
  signing + scrypt per transfer). Provides the comparison baseline for
  contract C9 / SC3.
- `post-4.1.json` — captured after the W6 callsite cutover (agent-mode
  signing via `signAndSend`). Locked assertion in
  `tests/bench/distributor-bench.test.ts` compares the two.

Both files are gitignored placeholders by default; the operator commits
them once captured.

## How to run

```bash
# Pre-deploy (against the pre-sprint-4.1 tag):
OWS_BENCH_FAMILY_ID=<uuid>                           \
OWS_BENCH_OUTPUT=sprint-4.0.1/baselines/pre-4.1.json \
OWS_BENCH_TREASURY_PRIVKEY=0x…                       \
OWS_BENCH_AUTHORIZED_CHILD_ADDRESS=0x…               \
BASE_SEPOLIA_RPC_URL=…                               \
OWS_BENCH_NOTES="pre-4.1 baseline"                   \
npx tsx tests/bench/distributor.bench.ts

# Post-deploy (on main with all Sprint 4.1 PRs merged):
OWS_BENCH_FAMILY_ID=<uuid>                            \
OWS_BENCH_OUTPUT=sprint-4.0.1/baselines/post-4.1.json \
OWS_BENCH_TREASURY_PRIVKEY=0x…                        \
OWS_BENCH_AUTHORIZED_CHILD_ADDRESS=0x…                \
BASE_SEPOLIA_RPC_URL=…                                \
OWS_BENCH_NOTES="post-4.1 cutover"                    \
npx tsx tests/bench/distributor.bench.ts
```

## Treasury provisioning

The benchmark fires 100 sequential `transferUSDC` calls of 1000 micro-USDC
each (default `OWS_BENCH_AMOUNT_MICRO=1000` = $0.001/tx). Total cost ~$0.10
USDC + Sepolia ETH for gas. The treasury wallet must be:

1. Bootstrapped via `configure-policy` (or have a lazy-mint-eligible
   FamilyKeyManager entry — see `lazyMintTokenForLegacyFamily`).
2. Funded with ≥ 0.01 ETH and ≥ 1 USDC on Base Sepolia.
3. Its policy file (`allowance-policy.py` in the OWS vault) must include
   `OWS_BENCH_AUTHORIZED_CHILD_ADDRESS` in `authorized_wallets`.

## Locked thresholds (contract C9)

| Metric | Expected delta | Rationale |
|---|---|---|
| p50 | ≥ 40 ms drop | Scrypt elimination (~50–100 ms saved per call). |
| p95 | ≥ 60 ms drop | Tail also benefits from scrypt removal. |
| p99 | (informational) | RPC variance dominates; not asserted. |

Soft-fail eligible (contract §6) if the p50 misses by ≤ 10 ms AND
scrypt-invocation count is still 0 — typically a noisy-Sepolia-window
situation rather than a real regression.
