# Sprint 4.0.3 — Research: Off-chain ledger and settlement decoupling

> Pre-sprint analysis for decoupling earning from settlement. Establishes
> the problem, the ledger model, the phased migration, the UX impact,
> and the open questions resolved before plan-4.0.3.md commits to specific
> workstreams.

## 1. Problem statement

AllowMe today couples three concerns into one operation:

1. **Earning recognition** — "Maya did her reading today, $0.50 owed."
2. **Allocation split** — "Of that $0.50, 80% to wallet, 20% to savings."
3. **On-chain settlement** — broadcasting the transfer that moves USDC.

The coupling is mechanical: `distribute-allowance` reads pending
`Achievement` records, applies the savingsPercent split, and immediately
broadcasts two `transferUSDC` calls per child (one to the wallet, one
to the savings vault). Each per-child distribution is at minimum 2
on-chain transactions, sometimes 3 if `release-savings` matures
entries concurrently.

### 1.1 The cost story today

At the scale targeted by Sprint 4.4 (5,000 families, weekly
distributions), the on-chain cost is approximately:

- 5,000 families × ~2 children avg × 2 tx per distribution × 52 weeks
- = ~1.04M transactions/year
- × ~$0.005 per tx on Base (current gas + USDC transfer fee average)
- = **~$5,200/year in gas alone**

This number scales linearly with families AND with how often parents
distribute. A family that distributes daily generates 7× the gas of a
weekly family. The current product encourages "distribute when you
verify" — which is actually the worst case for gas economics.

### 1.2 The reliability story today

When `distribute-allowance` broadcasts and one transfer succeeds while
the other fails (e.g., savings vault transfer succeeds, child wallet
transfer fails due to gas underestimation), the achievement is marked
`distributed: true` regardless. The savings entry exists; the wallet
transfer is silently lost. There is no retry mechanism.

The Sprint 3.0.2 destination allowlist makes this worse, not better:
if a child's wallet was added to the allowlist after the transfer was
attempted, the achievement is still marked distributed and the on-chain
state is now divergent from the ledger.

### 1.3 The UX story today

Today's flow:

```
verify-achievement → ledger updated (Achievement.distributed=false)
       ↓
[some delay — minutes to weeks]
       ↓
distribute-allowance → on-chain, 2 transfers per child
       ↓
Achievement.distributed=true
```

The parent decides when to trigger `distribute-allowance`. The kid
sees "earned $X this week" in `check-progress` but cannot tell whether
that money is in their wallet (settled), in the ledger (pending), or
in a state of having-been-attempted-and-silently-failed.

The opacity at the kid layer is the load-bearing UX problem: the kid
doesn't know what "earned" means in cash-equivalent terms. After
Sprint 4.0.3, the gap between "earned" and "spendable" becomes
explicitly visible — which is both more honest and a new source of
confusion if the copy isn't right.

## 2. Why this sprint comes third

Three dependencies make 4.0.3 the natural third sprint:

- **Depends on 4.0.1.** Settlement must run through the OWS policy engine,
  not bypass it. Pre-4.0.1 `transferUSDC` would have bypassed the
  allowlist for the new settle-balance pathway just as it did for
  distribute-allowance. After 4.0.1, both paths are policy-gated.
- **Depends on 4.0.2.** Settlement is a new code path; we need metrics
  on settlement success/failure rate, pending balance distribution,
  and time-to-settle from day one. Without 4.0.2 we are flying blind
  during the most behavior-changing sprint.
- **Blocks 4.4.** The Postgres migration in 4.4 is materially simpler
  if all ledger writes are funneled through `src/engine/ledger.ts`
  rather than scattered across `verify-achievement`,
  `distribute-allowance`, `release-savings`, and
  `settle-session-payout`. 4.0.3 produces that funnel.

## 3. Architecture analysis

### 3.1 The ledger model

A `LedgerEntry` is the unit of "money owed but not yet on-chain":

```typescript
interface LedgerEntry {
  id: string;                               // uuid
  familyId: string;
  childName: string;
  kind: "achievement-credit"                // from verify-achievement (wallet portion)
      | "savings-deposit"                   // from verify-achievement (savings portion)
      | "savings-release"                   // from release-savings
      | "session-payout";                   // from settle-session-payout (Sprint 4.0)
  destination: "child-wallet" | "savings-vault";
  amountUsdcMicros: number;                 // 1 USDC = 1_000_000
  status: "pending" | "settled" | "failed";
  createdAt: string;                        // ISO
  settledAt?: string;                       // ISO; only when status=settled
  txHash?: string;                          // only when status=settled
  settlementBatchId?: string;               // groups entries in same on-chain tx
  sourceId: string;                         // FK to Achievement | SavingsEntry | SessionReceipt
  failureReason?: string;                   // only when status=failed
}
```

The schema is deliberately denormalized: `destination` is resolved at
write time (not at settlement). This means the savings-split decision
is locked in at the moment the achievement is verified, not at the
moment a parent runs settle-balance. A parent changing `savingsPercent`
in `configure-policy` next week does NOT retroactively reshape last
week's pending entries.

This decision is defensible: the savings split is a promise made to
the kid at earn time. Retroactively changing it would mean parents
could "claw back" savings allocations after the fact, which is
incompatible with the trust model AllowMe sells to families.

### 3.2 The settlement model

`settle-balance` is the only path to on-chain after 4.0.3. Its job:

1. Find all `LedgerEntry` records with `status = "pending"` for the
   target child(ren).
2. Group them by `destination` wallet address.
3. Sum the amounts per destination.
4. For each destination: issue ONE `transferUSDC` call via OWS
   agent-mode signing (Sprint 4.0.1).
5. Mark settled entries with `txHash`, `settledAt`, and a shared
   `settlementBatchId`.

The "one tx per destination" guarantee is the key gas optimization. A
week of 7 achievements (7 verify calls × 2 ledger entries each = 14
pending entries) becomes 2 on-chain transactions instead of 14.

### 3.3 The savings model post-4.0.3

Today's `SavingsEntry` records mature on the lock period and become
"released" when `release-savings` runs. After 4.0.3:

- A savings deposit is a `LedgerEntry { kind: "savings-deposit",
  destination: "savings-vault" }`. On settlement, USDC moves to the
  savings vault address.
- A `SavingsEntry` is created at SETTLEMENT time (when the deposit
  ledger entry settles), with the lock period and multiplier
  recorded.
- `release-savings` matures entries AND writes a new
  `LedgerEntry { kind: "savings-release", destination: "child-wallet" }`.
- Next `settle-balance` pushes the release to the child wallet.

This keeps the conceptual model: savings live in the vault, mature
over time, and release to the wallet on demand. But every on-chain
transfer is now gated by a settle-balance call.

### 3.4 The phased migration

This is the highest-risk sprint of the program because user-visible
behavior changes. Three phases:

**Phase A (W1-W3, days 1-2): Dual-write.**

- LedgerEntry schema lands.
- `verify-achievement` writes both an `Achievement` record (existing)
  AND two `LedgerEntry` rows (new, with `status: "pending"`).
- `distribute-allowance` still does on-chain settlement, AND marks
  the corresponding LedgerEntries as settled.
- `release-savings` and `settle-session-payout` similarly dual-write.
- The ledger is shadow data; UX is unchanged.

This phase produces no user-visible change. It exists to validate the
ledger model against real production traffic before flipping the
on-chain semantics.

**Phase B (W6-W7, days 3-4): Introduce `settle-balance`.**

- New tool ships, RBAC: manager + learner.
- Settles entries in the new ledger.
- Operates IN ADDITION to existing `distribute-allowance` (parallel
  paths to chain).
- New UX copy lands but emphasizes the existing flow.

This phase makes settle-balance usable but does not deprecate the old
flow. Parents who want the old behavior keep it.

**Phase C (W3-W5, day 5): Flip to ledger-only.**

- `distribute-allowance` stops broadcasting. It becomes a pure ledger
  operation: reads `Achievement` records, ensures the corresponding
  LedgerEntries exist, returns the ledger summary.
- `release-savings` stops broadcasting. Same pattern.
- `settle-session-payout` stops broadcasting. Same pattern.
- `settle-balance` is the only on-chain path.

This phase is the user-visible cutover. The copy changes in W10 land
with this phase.

### 3.5 Auto-settle policy

Adding a new tool that a parent must run weekly is a UX regression for
parents who liked the implicit-settlement model. Mitigation: a new
policy field `autoSettleWeekly: boolean` (default `false`) and a
background job that runs every Sunday at 00:00 UTC and calls
`settle-balance` for every family that has opted in.

Opt-in (not opt-out) for two reasons:

1. The first run of auto-settle is materially different from a manual
   run (no human gate). Asking parents to flip a flag once is a
   reasonable expectation that they consent to the new behavior.
2. The allowlist check failure mode (Sprint 3.0.2) is harmless when a
   human runs settle-balance manually (they get a clear error) but
   silent when an auto-settle hits a misconfigured family. We don't
   want families to wake up Sunday morning with a failed auto-settle
   they can't troubleshoot until Monday.

The flag is set via `configure-policy`. Operators can change it any
time.

### 3.6 Failure recovery model

`settle-balance` can fail mid-batch. Two failure types:

**Type 1: Policy rejection (Sprint 3.0.2 allowlist).** OWS returns
`policy_denied`. The ledger entries stay `pending`. No on-chain
attempt happens. The tool returns a clear error explaining what's
missing from the allowlist.

**Type 2: On-chain failure (insufficient gas, RPC down, etc.).** One
destination succeeds; the next fails before broadcasting. The first
destination's entries are marked `settled` with the tx hash. The
failed destination's entries are marked `failed` with the
`failureReason`. The user sees a partial-success response.

Retry semantics:

- Manual retry: a parent runs `settle-balance` again. Failed entries
  are re-picked up (logic: query `status IN ('pending', 'failed')`).
- Auto-settle retry: the Sunday job processes failed entries up to 3
  times across the week (Mon/Wed/Sat) before paging an operator.
- Operator escalation: 3+ consecutive failures emit a Sentry event
  (Sprint 4.0.2) with the family_id and the failure pattern.

The `LedgerEntry.failureReason` field is the diagnostic surface.
Common values: `"policy_denied: recipient_not_authorized"`,
`"insufficient_gas"`, `"rpc_timeout"`, `"chain_reorg"`.

## 4. UX impact analysis

This sprint is the only one in the program that meaningfully changes
user-facing semantics. The honest accounting:

### 4.0.1 What gets harder

- **Parents must now run `settle-balance`** (or opt into auto-settle).
  Today, calling `distribute-allowance` ended in money-on-chain. After
  4.0.3, calling `distribute-allowance` ends in money-in-ledger;
  `settle-balance` ends in money-on-chain. One additional step in the
  steady state.
- **Kids see two numbers** instead of one in `check-progress`. "Earned
  this week" is the motivational number (unchanged). "In your wallet"
  is the new transparency number. The gap between them needs
  explaining.
- **The "instant gratification" loop is broken** for verify → see
  money in wallet. After 4.0.3, the kid earns, then has to ask for or
  trigger settlement to see the money move.

### 4.0.2 What gets easier

- **Parents stop paying per-distribution gas.** Weekly batched
  settlement is materially cheaper. A family that distributes twice
  a week saves ~85% on gas.
- **The Sprint 3.0.2 allowlist failure mode becomes loud** instead of
  silent. Today, a misconfigured allowlist means a transfer is
  attempted and reverts on-chain (gas spent, no funds moved). After
  4.0.3, the policy check happens before broadcast; the entries stay
  pending; the parent gets a clear error.
- **Kids gain agency.** They can now run `settle-balance` themselves
  (RBAC-extended). Today they have to ask a parent. After 4.0.3 they
  can pull their own money when they want to spend it.
- **Auditing improves.** Every on-chain action has a clear
  pre-broadcast ledger record. Reconciling on-chain vs ledger becomes
  a SQL JOIN (after 4.4) instead of a multi-file grep.

### 4.0.3 Per-role accounting

| Role | New steps | Removed pain | Net change |
|------|-----------|--------------|------------|
| Manager | +1 (settle-balance weekly, or opt-in auto-settle) | Gas anxiety, silent allowlist failures | Simpler in steady state |
| Co-parent | 0 | Same as manager | None |
| Learner (kid) | +1 (can self-settle, optional) | Opaque earned-vs-spendable distinction | More clarity, new agency |
| Family viewer | 0 | New visibility into pending | More info, same actions |
| Advisor | 0 | Cleaner audit log | Better tooling |

The manager case is the load-bearing one: do they consider one new
weekly step a regression, given the elimination of gas anxiety + silent
failures? Anecdotally, yes-it's-a-win for families who care about
cost; no-it's-a-regression for families who never noticed gas. The
auto-settle opt-in is the bridge: power users get manual control, casual
users get one-time setup and forget.

### 4.4 The copy trap

The most likely failure mode for Sprint 4.0.3 is not technical — it's
linguistic. If `check-progress` says:

> Earned: $4.23
> Pending settlement: $4.23

…parents will read that as "the system isn't working — Maya's money
hasn't been distributed." Support tickets follow.

The mitigation is in W10 (copy work). The kid-facing copy MUST lead
with the motivational number and treat the settlement detail as
transparent context, not an alarming status. See copy-4.0.3.md for the
specific phrasings.

## 5. Open questions resolved

### 5.1 Q1: Does the savings split happen at earn time or at settle time?

**Status:** Resolved. At earn time.

Rationale (§3.1): the savings split is a promise made to the kid when
the achievement is verified. Retroactive changes via `savingsPercent`
edits would undermine the trust model. Concretely:
`verify-achievement` writes two LedgerEntries per achievement, with
the split already applied. The split percentage stored at write time
is preserved in the entry; no recomputation at settlement.

### 5.2 Q2: Does `distribute-allowance` survive Sprint 4.0.3?

**Status:** Resolved. Yes, but with changed semantics.

`distribute-allowance` keeps its name (familiar to parents and to the
Claude assistant's prompt patterns) but becomes a ledger-only
operation. Internally it: reads pending `Achievement` records, ensures
the corresponding LedgerEntries exist, marks achievements as
`ledgerized: true`, returns a summary. NO on-chain action.

A future sprint may rename or deprecate this tool. For 4.0.3, keeping
the name minimizes blast radius.

### 5.3 Q3: What's the granularity of `settle-balance`?

**Status:** Resolved. Family-level with optional child filter.

- `settle-balance` with no `childName` → settles all children in the
  family.
- `settle-balance { childName: "Maya" }` → settles only Maya.
- Kid-role caller MUST scope to their own childName (RBAC enforced).

Settlement batching across siblings is allowed: if Maya and Diego
both have pending wallet entries, the call could in principle batch
into a single multicall. For 4.0.3 we keep one tx per destination
(simpler, no multicall complexity); cross-sibling batching is a
future optimization.

### 5.4 Q4: How do existing achievements migrate?

**Status:** Resolved. Phase A handles it.

At the start of Phase A (W1), a one-shot migration script
(`scripts/migrate-achievements-to-ledger.ts`) reads every
`Achievement` with `distributed: false` and writes the corresponding
LedgerEntries with `status: "pending"`. Achievements with
`distributed: true` are NOT migrated — they're already on-chain
and the ledger doesn't owe them anything.

The migration runs once at deploy. Re-runs are idempotent
(checked via `sourceId` deduplication).

### 5.5 Q5: What happens if a family has pending entries during the Phase C cutover?

**Status:** Resolved. They stay pending.

Phase C flips `distribute-allowance` to ledger-only. Any LedgerEntries
that exist at the moment of cutover stay in their current state. The
next `settle-balance` call (manual or auto) clears them. There's no
flash-settlement step at cutover.

This is intentional: a Phase C deploy that includes "settle everything
in flight" combines a code change with mass on-chain activity, which
is exactly the kind of high-risk deploy we should avoid.

### 5.6 Q6: Are session-payouts in scope?

**Status:** Resolved. Yes.

Sprint 4.0's `settle-session-payout` already lives in
`src/tools/settle-session-payout.ts` and does an on-chain transfer.
After 4.0.3 it becomes a ledger-only operation:
`LedgerEntry { kind: "session-payout", destination: "child-wallet" }`.
Next `settle-balance` moves the funds.

The naming collision (`settle-session-payout` vs `settle-balance`) is
unfortunate but the two have different semantic roles:
`settle-session-payout` confirms a learning session occurred;
`settle-balance` is the only path to chain.

A future copy pass might rename `settle-session-payout` to
`record-session-payout` or `credit-session-earnings` to remove the
"settle" overload.

### 5.7 Q7: What's the auto-settle schedule?

**Status:** Resolved. Sunday 00:00 UTC.

Rationale: weekly cadence matches the existing AllowMe weekly budget
model. UTC chosen because timezone-aware scheduling adds complexity
without much value (most parents don't care about the exact minute).
Communicated to users as "weekly" or "every Sunday."

For families in extreme timezones (e.g., Pacific Islands), the "Sunday
night USA" run lands on Monday morning local. The copy should say
"weekly" or "approximately once a week" rather than committing to a
specific local time.

### 5.8 Q8: Does the kid see the failure when settlement is rejected?

**Status:** Resolved. Yes — with a parent-action callout.

If a kid runs `settle-balance` and the allowlist check fails, the
response message tells them their wallet isn't authorized yet and to
ask a parent. The pending balance is preserved. This is the
"transparent failure" UX: the kid knows something needs to happen and
who can fix it, without seeing the internal allowlist mechanics.

## 6. Alternatives considered

### 6.1 Alt A: Smart-account batching via ERC-4337

Rejected for this sprint. Account abstraction with sponsored
transactions would let the family treasury issue one bundle covering
many users' settlements, reducing gas further. Real consideration —
but it introduces a paymaster dependency and requires the per-child
wallets to support 4337. Defer to Sprint 4.5 (post-Postgres) when the
infrastructure is otherwise stable.

### 6.2 Alt B: Channel-style settlements (state channels)

Rejected. State channels are correct for high-frequency micropayments
between known parties; AllowMe is low-frequency macropayments. The
channel overhead (open + close transactions, watchtower requirement)
exceeds the savings.

### 6.3 Alt C: Keep current model, just batch by week

Rejected. "Don't broadcast until 7 achievements accumulate" is a
naive batch and doesn't help mid-week distributions. The full ledger
model is necessary to support both manual and auto-settle, partial
failure recovery, and the kid-self-settle agency.

### 6.4 Alt D: Move savings vault on-chain to be the same account as
the child wallet (eliminate the second transfer)

Rejected. The savings vault separation is a feature, not a bug —
parents trust it because the funds are in a custodial-but-isolated
account. Merging them into the child wallet means the kid can
withdraw matured savings directly, which is exactly what the savings
model is designed to prevent.

## 7. Threat model

### 7.1 What gets better

- **Allowlist enforcement before broadcast.** Today's allowlist check
  happens after `transferUSDC` returns — meaning a denied transfer
  still ate gas. After 4.0.3, the policy check fires before any
  broadcast, and pending entries stay pending. Zero gas wasted on
  rejected transfers.
- **Reconciliation surface.** Every on-chain transfer now has a clear
  pre-broadcast ledger record. Auditing on-chain-vs-ledger becomes
  feasible (and is the foundation for the Postgres migration in 4.4).
- **Less time-windowed exposure.** Today, a stolen `OWS_PASSPHRASE`
  could be used to repeatedly call `transferUSDC` until detected.
  After 4.0.1+4.0.3, the same compromise requires the `ows_key_…` token
  AND a destination on the allowlist. After 4.0.3, even an authorized
  attacker can only drain pending balances — not invent transfers.

### 7.2 What gets worse

- **Pending balance becomes a value-at-risk surface.** If a family's
  ledger is compromised before settlement, an attacker could write
  fraudulent pending entries to point at a destination they control.
  Mitigation: the policy engine still gates the on-chain transfer
  via the allowlist (Sprint 3.0.2). Even a compromised ledger cannot
  invent new authorized destinations.
- **Auto-settle is a new automated code path.** A bug in the auto-
  settle scheduler could trigger settlement at the wrong time, the
  wrong cadence, or for the wrong family. Mitigation: the scheduler
  is a thin wrapper over `settle-balance` (no special privileges),
  and disabling the scheduler can be done via env var without a
  deploy.

### 7.3 New threat: ledger-on-chain divergence

If a transaction succeeds on-chain but the ledger fails to update
(e.g., process crash between broadcast and ledger write), we have a
divergence. The fix:

- The settlement broadcast and ledger update are wrapped in a
  try/finally that ensures the ledger write happens even on partial
  process failure.
- A reconciliation job (Sprint 4.4) reads on-chain transfers and
  matches them to ledger entries; divergences are flagged for
  operator review.
- Until 4.4 ships, the reconciliation is manual: the audit log
  (Sprint 4.0.2) is the source of truth.

## 8. References

- [Sprint 4.0.1 — Agent-mode signing](../sprint-4.0.1/research-4.0.1.md)
- [Sprint 4.0.2 — Observability foundation](../sprint-4.0.2/research-4.0.2.md)
- [Sprint 3.0.2 — Destination allowlist](../sprint-3.0.2/research.md)
- [Sprint 3.0.6 — Policy cache and version counter](../sprint-3.0.6/research.md)
- [Sprint 4.0 — Learning Mode pedagogy](../sprint-4.0/research.md)
- [OWS spec 03 — Policy engine](https://github.com/open-wallet-standard/core/blob/main/docs/03-policy-engine.md)
- [Base mainnet fee tracker](https://basescan.org/chart/gasprice)

## 9. Status

- Research: complete.
- Plan: see plan-4.0.3.md.
- Tests: see test-4.0.3.md.
- Copy: see copy-4.0.3.md.
- Code: not started.
- Open questions: all resolved (§5).
- Approval to proceed: pending Generator/Evaluator pass on plan-4.0.3.md
  AND user-acceptance test of copy-4.0.3.md drafts with one pilot family.