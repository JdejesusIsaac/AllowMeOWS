# Sprint 4.0.3 — Plan: Off-chain ledger and settlement decoupling

> Workstream-by-workstream execution plan for Sprint 4.0.3. Reads
> research-4.0.3.md as the prerequisite. Sequences W0-W10 across a
> 4-5 working day timeline, phased into A (dual-write), B (introduce
> settle-balance), C (cutover).

## 1. Goals

- Earning recognition is decoupled from on-chain settlement.
- `settle-balance` is the only path to on-chain transfers.
- Per-family gas costs drop by ≥80% in steady state.
- Allowlist failures are loud (pre-broadcast policy check) instead of
  silent (post-broadcast revert).
- Kids can self-settle their own pending balances.
- An opt-in weekly auto-settle policy is available.
- The kid-facing UX gains a clear earned-vs-spendable distinction
  without confusion.

## 2. Non-goals

- ERC-4337 account abstraction or sponsored transactions (deferred to
  4.5; see research §6.1).
- State channels (rejected; see research §6.2).
- Cross-sibling multicall batching (deferred — one tx per destination
  is sufficient for 4.0.3 cost goals).
- Renaming `distribute-allowance` (semantic change yes, name change
  no).
- Pre-cutover flash-settlement of in-flight pending balances (rejected
  per research §5.5).
- Backfilling LedgerEntries for historical (already-distributed)
  achievements.

## 3. Phasing

The sprint is structured into three phases that map to mergeable PRs:

| Phase | Days | Workstreams | User-visible? |
|-------|------|-------------|---------------|
| A | 1-2 | W0, W1, W2 | No (shadow data) |
| B | 3-4 | W6, W7 | Yes (new tool, opt-in) |
| C | 5 | W3, W4, W5, W10 | Yes (cutover + copy) |
| Cross-cutting | throughout | W8 (failure), W9 (migration) | Partial |

Each phase ships independently. The merge order is strict: Phase A
before B before C. Phase B can be paused if Phase A reveals issues;
Phase C requires Phase B to have soaked for at least 24 hours.

## 4. Workstreams

### W0 — Pre-sprint setup (1 hour)

- Add feature flag `ALLOWME_LEDGER_MODE` with values `dual-write`
  (Phase A), `settle-enabled` (Phase B), `ledger-only` (Phase C),
  default `dual-write`.
- Add feature flag `ALLOWME_AUTO_SETTLE_DISABLED` (default false) for
  emergency disable of the auto-settle job without a deploy.
- Confirm Sprint 4.0.2 dashboards are reporting tool-call metrics
  (precondition for measuring sprint impact).

**Exit criteria:** flags exist in env, defaults documented in
`docs/CONFIG.md`.

### W1 — LedgerEntry schema + engine module (4 hours)

New file: `src/engine/ledger.ts`.

```typescript
// src/schemas.ts — add
export const LedgerEntrySchema = z.object({
  id: z.string().uuid(),
  familyId: z.string(),
  childName: z.string(),
  kind: z.enum([
    "achievement-credit",
    "savings-deposit",
    "savings-release",
    "session-payout",
  ]),
  destination: z.enum(["child-wallet", "savings-vault"]),
  amountUsdcMicros: z.number().int().nonnegative(),
  status: z.enum(["pending", "settled", "failed"]),
  createdAt: z.string(),
  settledAt: z.string().optional(),
  txHash: z.string().optional(),
  settlementBatchId: z.string().optional(),
  sourceId: z.string(),
  failureReason: z.string().optional(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

// src/engine/ledger.ts — new
import { LedgerEntry, LedgerEntrySchema } from "../schemas";

export interface LedgerStore {
  append(entry: LedgerEntry): Promise<void>;
  listPending(familyId: string, childName?: string): Promise<LedgerEntry[]>;
  listFailed(familyId: string, childName?: string): Promise<LedgerEntry[]>;
  markSettled(ids: string[], txHash: string, batchId: string): Promise<void>;
  markFailed(ids: string[], reason: string): Promise<void>;
  findBySourceId(sourceId: string): Promise<LedgerEntry[]>;
}

export class FilesystemLedger implements LedgerStore {
  // Stored at data/families/<id>/ledger.jsonl (JSONL append-only,
  // matching the Sprint 4.0.2 audit log format change)
  // ...
}
```

Persistence: `data/families/<id>/ledger.jsonl`. JSONL chosen for the
same reasons as Sprint 4.0.2's audit-log format: append performance,
Vector tail compatibility, future migration to Postgres in 4.4 is a
straight COPY.

Helper functions:

```typescript
// src/engine/ledger.ts — helpers
export function splitAchievement(
  totalMicros: number,
  savingsPercent: number,
): { childMicros: number; savingsMicros: number } {
  const savingsMicros = Math.floor(totalMicros * (savingsPercent / 100));
  const childMicros = totalMicros - savingsMicros;
  return { childMicros, savingsMicros };
}

export function buildLedgerEntriesForAchievement(
  achievement: Achievement,
  savingsPercent: number,
): [LedgerEntry, LedgerEntry] | [LedgerEntry] {
  const { childMicros, savingsMicros } = splitAchievement(
    achievement.amountUsdcMicros,
    savingsPercent,
  );
  const entries: LedgerEntry[] = [];
  if (childMicros > 0) {
    entries.push({
      id: randomUUID(),
      familyId: achievement.familyId,
      childName: achievement.childName,
      kind: "achievement-credit",
      destination: "child-wallet",
      amountUsdcMicros: childMicros,
      status: "pending",
      createdAt: new Date().toISOString(),
      sourceId: achievement.id,
    });
  }
  if (savingsMicros > 0) {
    entries.push({
      id: randomUUID(),
      familyId: achievement.familyId,
      childName: achievement.childName,
      kind: "savings-deposit",
      destination: "savings-vault",
      amountUsdcMicros: savingsMicros,
      status: "pending",
      createdAt: new Date().toISOString(),
      sourceId: achievement.id,
    });
  }
  return entries as [LedgerEntry] | [LedgerEntry, LedgerEntry];
}
```

**Exit criteria:** unit tests pass (LS1-LS10), schema validates,
FilesystemLedger CRUD round-trips correctly.

### W2 — Dual-write from verify-achievement (3 hours, Phase A)

Modify `src/tools/verify-achievement.ts` to write both an Achievement
AND the corresponding LedgerEntries. The Achievement keeps its
existing fields including `distributed: false`.

```typescript
// src/tools/verify-achievement.ts — additions
const achievement = await engine.recordAchievement(familyId, { ... });

if (process.env.ALLOWME_LEDGER_MODE !== "off") {
  const childConfig = await engine.getChildConfig(familyId, achievement.childName);
  const entries = buildLedgerEntriesForAchievement(achievement, childConfig.savingsPercent);
  for (const entry of entries) {
    await ledger.append(entry);
  }
}
```

The `ALLOWME_LEDGER_MODE !== "off"` check exists so Phase A is
disable-able via env var if anything goes wrong.

Idempotency: if a verify-achievement retry creates a duplicate
Achievement, the ledger writes must not duplicate. Use
`ledger.findBySourceId(achievement.id)` to deduplicate.

**Exit criteria:** every new verify-achievement call produces both an
Achievement AND ledger entries. Existing tests still pass (LS11).
Manual verification: trigger 10 verifies, confirm 20 ledger entries
exist with correct splits (LS12).

### W3 — distribute-allowance becomes ledger-only (Phase C, 4 hours)

The semantic change. Before:

```typescript
// src/tools/distribute-allowance.ts — current behavior
const pending = await engine.listPendingAchievements(familyId);
for (const child of childrenWithPending) {
  const { childAmount, savingsAmount } = engine.calculateSavingsSplit(...);
  if (childAmount > 0) await distributor.transferUSDC(...);
  if (savingsAmount > 0) await distributor.transferUSDC(...);
  await engine.markDistributed(child);
  await engine.createSavingsEntry(child, savingsAmount);
}
```

After (Phase C):

```typescript
// src/tools/distribute-allowance.ts — new behavior
const pending = await engine.listPendingAchievements(familyId);
for (const child of childrenWithPending) {
  // Ledger entries already written by verify-achievement in Phase A;
  // this is a no-op in steady state. The migration script in W9
  // handles pre-existing pending achievements.
  await ensureLedgerEntriesExist(familyId, child);
  await engine.markLedgerized(child); // new method, not "distributed"
}

// Response copy directs the user to settle-balance for actual
// on-chain action.
return {
  content: [{
    type: "text",
    text: buildDistributeAllowanceResponse({
      familyId,
      ledgerized: ledgerEntries.length,
      pending: pendingSummary,
    }),
  }],
};
```

The Achievement record's `distributed` field is repurposed: in Phase
A+B it means "on-chain settled" (legacy meaning); in Phase C it means
"ledgerized" (new meaning). A new field `ledgerized: boolean` is added
to distinguish during the transition. Post-cutover, the `distributed`
field is deprecated and removed in a future cleanup sprint.

**Exit criteria:** distribute-allowance does NO on-chain action in
Phase C. Tests LS13-LS18 pass.

### W4 — release-savings becomes ledger-only (Phase C, 2 hours)

Modify `src/tools/release-savings.ts` to mark matured `SavingsEntry`
records as released AND write a `savings-release` LedgerEntry, but NO
on-chain action.

```typescript
const matured = await engine.matureExpiredSavings(familyId, childName);
for (const entry of matured) {
  await ledger.append({
    id: randomUUID(),
    familyId,
    childName,
    kind: "savings-release",
    destination: "child-wallet",
    amountUsdcMicros: entry.releasedAmountMicros,
    status: "pending",
    createdAt: new Date().toISOString(),
    sourceId: entry.id,
  });
}
```

**Exit criteria:** release-savings writes ledger entries but no
on-chain. Test LS19 passes.

### W5 — settle-session-payout becomes ledger-only (Phase C, 1 hour)

Same pattern. `LedgerEntry { kind: "session-payout" }`.

**Exit criteria:** Test LS20 passes. Sprint 4.0 Learning Mode session
flow is unchanged from the kid's perspective.

### W6 — New `settle-balance` tool (Phase B, 8 hours)

This is the load-bearing engineering work. New file:
`src/tools/settle-balance.ts`.

```typescript
// src/tools/settle-balance.ts
export const settleBalanceTool: McpTool = {
  name: "settle-balance",
  description: "Push pending ledger entries on-chain. Batches transfers by destination.",
  inputSchema: z.object({
    childName: z.string().optional(),
    dryRun: z.boolean().optional().default(false),
  }),
  rbac: ["manager", "learner"], // learner scoped to own child by middleware

  async handler({ input, context }) {
    const { childName, dryRun } = input;
    const { familyId, role, callerChildName } = context;

    // Resolve scope: manager can settle any child; learner only their own
    const scope = role === "learner"
      ? { childName: callerChildName }
      : childName ? { childName } : {};

    // 1. Read pending entries (also includes retryable failed)
    const pending = await ledger.listPendingOrFailed(familyId, scope.childName);

    if (pending.length === 0) {
      return buildNothingToSettleResponse({ childName: scope.childName });
    }

    // 2. Group by destination
    const byDestination = groupByDestination(pending);

    // 3. Pre-flight allowlist check (Sprint 3.0.2 via Sprint 4.0.1 policy engine)
    const allowlistResults = await Promise.all(
      Object.entries(byDestination).map(async ([dest, entries]) => {
        const resolved = await resolveDestinationAddress(familyId, scope.childName, dest);
        const allowed = await policyEngine.checkDestination(familyId, resolved);
        return { dest, resolved, entries, allowed };
      })
    );

    const blocked = allowlistResults.filter(r => !r.allowed);
    if (blocked.length > 0 && !dryRun) {
      return buildAllowlistBlockedResponse({ blocked, allowed: allowlistResults.filter(r => r.allowed) });
    }

    // 4. Dry-run preview
    if (dryRun) {
      const estimatedGas = await estimateBatchGas(allowlistResults);
      return buildDryRunResponse({ allowlistResults, estimatedGas });
    }

    // 5. Execute one tx per destination
    const batchId = randomUUID();
    const results: SettlementResult[] = [];
    for (const { dest, resolved, entries } of allowlistResults.filter(r => r.allowed)) {
      const total = entries.reduce((s, e) => s + e.amountUsdcMicros, 0);
      try {
        const txHash = await distributor.transferUSDC(resolved, total);
        await ledger.markSettled(entries.map(e => e.id), txHash, batchId);
        // Create SavingsEntry for savings-deposit settlements
        if (dest === "savings-vault") {
          await engine.createSavingsEntriesFromLedger(entries);
        }
        results.push({ dest, status: "settled", txHash, amount: total });
      } catch (err) {
        const reason = classifyFailure(err);
        await ledger.markFailed(entries.map(e => e.id), reason);
        results.push({ dest, status: "failed", reason, amount: total });
      }
    }

    return buildSettleBalanceResponse({ results, batchId });
  },
};
```

RBAC enforcement: the `access-control.ts` middleware adds
`settle-balance` to the `learner` allowed list, with the constraint
that learners can only operate on their own `childName`. See LS21-LS25.

Response copy: see copy-4.0.3.md.

**Exit criteria:** tool registers, all RBAC paths tested
(LS21-LS25), happy path settlement works end-to-end (LS26-LS30),
allowlist-blocked path works (LS31-LS33), partial-failure path works
(LS34-LS40).

### W7 — Auto-settle weekly job (Phase B, 3 hours)

New file: `src/jobs/auto-settle.ts`. Triggered by a cron-like
scheduler at Sunday 00:00 UTC. Uses `node-cron` or Railway scheduled
tasks (decision in W7 sub-discussion).

```typescript
// src/jobs/auto-settle.ts
export async function runAutoSettle() {
  if (process.env.ALLOWME_AUTO_SETTLE_DISABLED === "true") {
    logger.info("auto-settle disabled by env var; skipping");
    return;
  }

  const families = await engine.listFamiliesWithPolicy({ autoSettleWeekly: true });
  for (const familyId of families) {
    try {
      // Call settle-balance internally — same code path as a manager invocation
      await invokeSettleBalanceForAutoSettle({ familyId });
    } catch (err) {
      logger.error("auto-settle failed for family", { familyId, err });
      // Track in Sentry (Sprint 4.0.2) — but don't escalate until 3 consecutive fails
      // ... see W8 ...
    }
  }
}
```

The `autoSettleWeekly: boolean` field is added to the family policy
schema. Default `false`. Set via `configure-policy`.

Scheduling: prefer Railway scheduled tasks over an in-process
`node-cron` because the latter ties scheduling to process lifecycle
(restart misses a run). Railway scheduled tasks run as a separate
process invocation.

**Exit criteria:** cron entry configured; manual trigger of auto-settle
job processes opted-in families correctly; opted-out families skipped
(LS51-LS55).

### W8 — Failure recovery and retry semantics (Phase B-C, 2 hours)

`settle-balance` retries failed entries:

```typescript
const pendingOrFailed = await ledger.listPendingOrFailed(familyId, childName);
// "failed" entries with same destination as new pending entries are batched together
```

Retry count tracked: a new `LedgerEntry.retryCount: number` field
(default 0, incremented on each failure). After 3 retries with the
same `failureReason`, the entry is marked `status: "abandoned"` and a
Sentry event fires with the family_id and reason. Operators investigate
abandoned entries manually.

The auto-settle job inherits this behavior: Sunday's run may
re-process Wednesday's failed entries. After 3 failed Sundays, the
entry abandons and operations is notified.

**Exit criteria:** retry tests (LS41-LS50) pass; Sentry escalation
verified.

### W9 — Migration of in-flight pending state (Phase A, 2 hours)

One-shot script: `scripts/migrate-achievements-to-ledger.ts`.

```typescript
async function migrate() {
  const families = await listAllFamilies();
  for (const familyId of families) {
    const undistributed = await engine.listAchievements(familyId, { distributed: false });
    for (const achievement of undistributed) {
      const existing = await ledger.findBySourceId(achievement.id);
      if (existing.length > 0) continue; // idempotent

      const childConfig = await engine.getChildConfig(familyId, achievement.childName);
      const entries = buildLedgerEntriesForAchievement(achievement, childConfig.savingsPercent);
      for (const entry of entries) {
        await ledger.append(entry);
      }
    }
  }
}
```

Runs once during Phase A deploy. Idempotent (re-runs are safe).

Edge cases:

- An achievement created during the migration window: handled by the
  W2 dual-write code path; idempotency via `sourceId` dedup.
- A family being modified during migration: per-family processing is
  atomic enough; if a write conflict happens, retry the family.
- Already-released savings (matured but not yet released): NOT
  migrated — the released portion is already on-chain. The next
  `release-savings` call will create new ledger entries for newly-
  matured savings only.

**Exit criteria:** dry-run on staging shows expected entries; idempotency
test passes (LS56-LS60).

### W10 — check-progress + check-savings + settle-balance copy (Phase C, 6 hours)

The load-bearing UX work. Detailed copy lives in copy-4.0.3.md; this
workstream implements the copy in the rich-card markdown builders.

Files modified:

- `src/tools/check-progress.ts` — `buildCheckProgressRichMarkdown`
  signature gains `pendingLedgerSummary` and `walletBalance` params;
  rich card adds the "Earned / Spendable / Pending" three-row layout.
- `src/tools/check-savings.ts` — adds "Pending settlement" row.
- `src/tools/settle-balance.ts` — all response builders (see W6).

Copy variants:

- Kid-facing
- Manager-facing
- Auto-settle on (changes the "pending" line to "auto-settles
  Sunday")
- Auto-settle off (default; "run settle-balance to move it")

Implementation:

```typescript
// src/tools/check-progress.ts — additions
const walletBalance = await fetchWalletUsdcBalance(childWallet);
const pendingByKind = await ledger.summarizePending(familyId, childName);
const autoSettleOn = childConfig.familyPolicy.autoSettleWeekly;
const nextSundayUtc = computeNextSunday();

return buildCheckProgressRichMarkdown({
  childName,
  total, budget, streak, multiplier, categories,
  walletBalance,
  pendingSummary: pendingByKind,
  autoSettleOn,
  nextSundayUtc,
  role, // kid vs manager copy variant
});
```

The wallet balance fetch adds a USDC ERC-20 `balanceOf` call to
`check-progress`. This is one new RPC call per `check-progress` call.
At AllowMe scale this is fine (~10k calls/day at 5k families × 2
runs/day per family). Mitigation if it becomes hot: cache by
(wallet, blockNumber).

**Exit criteria:** all copy variants render correctly across role
combinations (LS61-LS65). Pilot family acceptance test (one parent,
one kid, three days of use).

## 5. Decisions

### D1: LedgerEntry persistence format → JSONL on disk

**Decision:** `data/families/<id>/ledger.jsonl`.
**Rationale:** matches Sprint 4.0.2's audit-log format change. Append
performance, Vector compatibility, future Postgres migration is one
COPY command.
**Trade-off:** in-memory ledger sums require reading the whole file.
At 5k families × ~50 entries/week × 52 weeks = ~13M total entries by
year-end. Per-family file remains small (~2.6k entries). Acceptable
until 4.4 moves to Postgres.

### D2: Savings split at earn time, not settle time

**Decision:** split is computed and persisted in LedgerEntry at
verify-achievement time.
**Rationale:** trust model. The kid's understanding at earn time is
"80% to me, 20% to savings"; a parent retroactively changing
savingsPercent should not retroactively reshape past entries.
**Trade-off:** if a parent legitimately wants to change the split mid-
sprint, the change applies prospectively only. Past entries keep
their split.

### D3: One tx per destination, no cross-sibling multicall

**Decision:** settle-balance issues one `transferUSDC` per
destination wallet.
**Rationale:** simplicity. Multicall introduces a contract dependency
and changes the policy-engine integration. The 80%+ gas savings come
from batching same-destination entries, which this provides.
**Future:** Sprint 4.5+ can add ERC-4337 batching if metrics show
sibling-destination gas dominating.

### D4: Auto-settle is opt-in (default off)

**Decision:** `autoSettleWeekly: false` is the default.
**Rationale:** research §3.5. Silent allowlist failures are the worst
auto-settle outcome; opt-in is informed consent.
**Trade-off:** parents who don't read release notes won't discover
auto-settle. Mitigation: post-cutover, the first run of
`distribute-allowance` includes a one-time hint about auto-settle in
the response copy.

### D5: `distribute-allowance` keeps its name, changes its semantics

**Decision:** rename rejected; semantic change accepted.
**Rationale:** prompt-engineering surface. The Claude assistant has
learned to call `distribute-allowance` in many contexts; renaming
would break those patterns. The function's purpose ("commit pending
earnings") is consistent across old and new semantics.
**Trade-off:** users who knew the old "this triggers on-chain" model
need to update their mental model. Mitigation: response copy in Phase
C makes the new behavior explicit ("Earnings ledgerized. Run
**settle-balance** to push them on-chain.").

### D6: Auto-settle schedule → Sunday 00:00 UTC

**Decision:** Sunday 00:00 UTC, weekly.
**Rationale:** matches weekly budget model; UTC avoids timezone
complexity. Communicated as "approximately weekly."
**Trade-off:** Pacific Islands families see settlements Monday
morning local. Acceptable.

### D7: Phase A is dual-write, not shadow-mode

**Decision:** Phase A writes the new ledger AND keeps existing
distribute-allowance behavior.
**Rationale:** allows real production data to validate the ledger
model. Shadow mode (write but never read) doesn't catch read-path
bugs.
**Trade-off:** Phase A doubles the audit-log write volume. Sprint
4.0.2 has the capacity (research §5.1).

### D8: Failure recovery → 3 retries then abandon

**Decision:** failed LedgerEntries retry up to 3 times before being
marked `abandoned` and escalated to Sentry.
**Rationale:** prevents infinite retry loops while giving transient
failures (RPC outages, gas spikes) room to recover. Three retries
covers Mon/Wed/Sat after a Sunday failure.
**Trade-off:** the abandoned state requires manual operator
intervention. Acceptable until 4.4+ adds dashboards for it.

## 6. Success criteria

- **SC1:** Every new verify-achievement call produces both an
  Achievement and LedgerEntries with the correct split.
- **SC2:** distribute-allowance in Phase C performs zero on-chain
  transactions.
- **SC3:** settle-balance is the only path to on-chain transfers
  post-cutover (verified by audit-log analysis).
- **SC4:** Gas cost per family-week drops by ≥80% in pilot families.
- **SC5:** Allowlist rejections produce a clear error before
  broadcast (zero gas spent on rejected transfers).
- **SC6:** A kid can self-settle their own pending balance (RBAC
  passes).
- **SC7:** A kid CANNOT settle another child's balance (RBAC fails
  correctly).
- **SC8:** Auto-settle runs Sunday 00:00 UTC for opted-in families
  only.
- **SC9:** Failed entries retry up to 3 times then abandon with
  Sentry escalation.
- **SC10:** check-progress rich-card copy renders correctly for all
  role × auto-settle × pending-state combinations.
- **SC11:** Pilot family acceptance test (one parent, one kid, three
  days) reports the new flow as "understandable" or better.

## 7. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R1 | Kid-facing copy confuses parents into thinking money is missing | High | Medium | copy-4.0.3.md pilot acceptance test; revertable copy |
| R2 | LedgerEntry-to-Achievement divergence after a process crash | Medium | High | Idempotency via sourceId; Sprint 4.4 reconciliation |
| R3 | Auto-settle hits a misconfigured allowlist and silently fails | High | Medium | Sentry escalation after 3 fails; opt-in not opt-out |
| R4 | settle-balance becomes the new bottleneck during peak settlement times | Low | Medium | Per-destination batching; Sprint 4.0.2 observability flags hotspot |
| R5 | LedgerEntry JSONL file grows unboundedly | Medium | Low | Rotation strategy; 4.4 migrates to Postgres |
| R6 | Kid self-settles before parent has reviewed achievement | Medium | Low | Achievement.verified-by-manager check stays in place |
| R7 | Cross-sibling order-of-settlement creates fairness perception | Low | Low | Deterministic ordering by childName; documented |
| R8 | Phase A dual-write doubles disk I/O and impacts perf | Low | Medium | Sprint 4.02 OB-PERF-1 baseline; rollback flag |
| R9 | Migration script (W9) misses an edge case and pending state is lost | Medium | High | Idempotent + dry-run mode + 24h Phase A soak before Phase B |
| R10 | Phase C cutover happens before a family has run distribute-allowance for in-flight achievements | Medium | Medium | W9 migration handles this; Phase A soak time mitigates |
| R11 | `wallet balanceOf` call in check-progress hits RPC rate limits | Low | Medium | Caching layer; fallback to ledger-only display |

## 8. Sequencing

**PR1 (Phase A, days 1-2):** W0, W1, W2, W9. Ships ledger schema +
dual-write + migration. NO user-visible change. Soaks for ≥24 hours.

**PR2 (Phase B, days 3-4):** W6, W7, W8. Ships `settle-balance` tool
and auto-settle job. Old flow still works. Pilot families opt in.

**PR3 (Phase C, day 5):** W3, W4, W5, W10. Ships the cutover and the
new copy. distribute-allowance/release-savings/settle-session-payout
become ledger-only.

**Hotfix surface:** any of W0-W10 can be reverted independently. The
feature flag `ALLOWME_LEDGER_MODE` reverts code-path semantics
without a redeploy.

## 9. Timeline

| Day | Workstreams | Phase | Deliverable |
|-----|-------------|-------|-------------|
| 1 | W0 + W1 + W2 | A | Ledger schema, dual-write live |
| 2 | W9 | A | Migration script run on staging; 24h soak begins |
| 3 | W6 (first half) + W7 | B | settle-balance MVP, auto-settle job |
| 4 | W6 (second half) + W8 | B | Full settle-balance with failure recovery |
| 5 | W3 + W4 + W5 + W10 | C | Cutover; new copy live; production deploy |

Total: 5 working days, with the first 24 hours of day 3 being soak
time for Phase A.

## 10. Rollback strategy

| Scenario | Rollback |
|----------|----------|
| Phase A bug in ledger writes | Set `ALLOWME_LEDGER_MODE=off`; verify-achievement stops writing ledger. No data loss; existing tests cover the path. |
| Phase B settle-balance bug | Remove tool from registry; users can't call it; pending balances accumulate; Phase A path still works for distribution. |
| Phase C cutover regression | Set `ALLOWME_LEDGER_MODE=dual-write`; old distribute-allowance path resumes broadcasting. |
| Auto-settle outage | Set `ALLOWME_AUTO_SETTLE_DISABLED=true`; manual settle-balance still works. |
| Copy confuses users | Revert `src/tools/check-progress.ts` to pre-W10 commit; old copy resumes. |

The phase-by-phase rollback granularity is the load-bearing risk
mitigation for this sprint.

## 11. Acceptance

Sprint 4.0.3 is complete when:

- All 11 success criteria pass (verified by test-4.0.3.md execution).
- All 3 PRs merged to main.
- Pilot family acceptance test signed off.
- 72-hour post-cutover production observation shows: ≥80% gas savings
  vs pre-sprint baseline; zero "where's my money" support tickets;
  pending-balance distribution matches expected curve.
- `docs/SETTLEMENT.md` exists documenting the new flow for users.
- copy-4.0.3.md is finalized and matches the deployed copy.