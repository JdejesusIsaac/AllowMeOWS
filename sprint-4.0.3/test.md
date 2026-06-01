# Sprint 4.0.3 — Test plan: Off-chain ledger and settlement decoupling

> Test inventory for Sprint 4.0.3 deliverables. Tests prefixed `LS`
> (Ledger/Settlement). Maps every test to one or more success criteria
> from plan-4.0.3.md §6.

## 1. Coverage map

| Success criterion | Tests |
|-------------------|-------|
| SC1: verify-achievement produces Achievement + LedgerEntries | LS11, LS12, LS13 |
| SC2: distribute-allowance is zero on-chain post-cutover | LS14, LS15 |
| SC3: settle-balance is only path to chain | LS16, LS17 |
| SC4: ≥80% gas reduction | LS-PERF-1 |
| SC5: Allowlist rejections pre-broadcast | LS31, LS32, LS33 |
| SC6: Kid self-settles own balance | LS22, LS23 |
| SC7: Kid cannot settle another child | LS24, LS25 |
| SC8: Auto-settle runs Sunday 00:00 UTC | LS51, LS52, LS53 |
| SC9: Failed entries retry 3× then abandon | LS41-LS50 |
| SC10: Copy renders correctly across variants | LS61-LS65 |
| SC11: Pilot acceptance | Manual MV1-MV4 |

Plus LS-PERF-1, LS-PERF-2 (perf), LS-COV-1 (CI gate).

## 2. Unit tests — ledger module

### LS1 — LedgerEntry schema validates required fields

```typescript
test("LS1: LedgerEntrySchema rejects missing required fields", () => {
  expect(() => LedgerEntrySchema.parse({})).toThrow();
  expect(() => LedgerEntrySchema.parse({
    id: "uuid", familyId: "f", childName: "M", kind: "achievement-credit",
    destination: "child-wallet", amountUsdcMicros: 100, status: "pending",
    createdAt: new Date().toISOString(), sourceId: "src1"
  })).not.toThrow();
});
```

### LS2 — splitAchievement: 80/20 split rounds correctly

```typescript
test("LS2: splitAchievement preserves total under floor rounding", () => {
  const { childMicros, savingsMicros } = splitAchievement(1_000_001, 20);
  expect(childMicros + savingsMicros).toBe(1_000_001);
  expect(savingsMicros).toBe(200_000); // floor(1_000_001 * 0.20)
  expect(childMicros).toBe(800_001);
});
```

### LS3 — splitAchievement: 0% savings = all to child

```typescript
test("LS3: splitAchievement with 0% savings returns only child portion", () => {
  const { childMicros, savingsMicros } = splitAchievement(500_000, 0);
  expect(childMicros).toBe(500_000);
  expect(savingsMicros).toBe(0);
});
```

### LS4 — splitAchievement: 100% savings = all to savings

```typescript
test("LS4: splitAchievement with 100% savings returns only savings portion", () => {
  const { childMicros, savingsMicros } = splitAchievement(500_000, 100);
  expect(childMicros).toBe(0);
  expect(savingsMicros).toBe(500_000);
});
```

### LS5 — buildLedgerEntriesForAchievement: 2 entries for split

```typescript
test("LS5: a non-zero split produces two ledger entries", () => {
  const achievement: Achievement = { id: "ach1", familyId: "fam_abc", childName: "Maya", amountUsdcMicros: 1_000_000, /* ... */ };
  const entries = buildLedgerEntriesForAchievement(achievement, 20);
  expect(entries).toHaveLength(2);
  expect(entries[0].kind).toBe("achievement-credit");
  expect(entries[0].destination).toBe("child-wallet");
  expect(entries[0].amountUsdcMicros).toBe(800_000);
  expect(entries[1].kind).toBe("savings-deposit");
  expect(entries[1].destination).toBe("savings-vault");
  expect(entries[1].amountUsdcMicros).toBe(200_000);
});
```

### LS6 — buildLedgerEntriesForAchievement: 1 entry when split is 0

```typescript
test("LS6: 100% savings produces one savings-only entry", () => {
  const achievement: Achievement = { /* ... */ amountUsdcMicros: 500_000 };
  const entries = buildLedgerEntriesForAchievement(achievement, 100);
  expect(entries).toHaveLength(1);
  expect(entries[0].kind).toBe("savings-deposit");
});
```

### LS7 — FilesystemLedger.append → listPending round-trip

```typescript
test("LS7: appended entry appears in listPending", async () => {
  const ledger = new FilesystemLedger(tmpDataDir);
  await ledger.append({ /* valid entry */ status: "pending", familyId: "fam_abc", childName: "Maya", ... });
  const pending = await ledger.listPending("fam_abc", "Maya");
  expect(pending).toHaveLength(1);
});
```

### LS8 — FilesystemLedger.markSettled updates status and tx fields

```typescript
test("LS8: markSettled updates status, txHash, settledAt, batchId", async () => {
  // Append a pending entry, then mark settled
  const entry = await appendTestEntry(ledger, "fam_abc", "Maya");
  await ledger.markSettled([entry.id], "0xabc...", "batch_1");
  const all = await ledger.listAll("fam_abc");
  const found = all.find(e => e.id === entry.id);
  expect(found.status).toBe("settled");
  expect(found.txHash).toBe("0xabc...");
  expect(found.settlementBatchId).toBe("batch_1");
  expect(found.settledAt).toBeTruthy();
});
```

### LS9 — FilesystemLedger.findBySourceId enables idempotent dedup

```typescript
test("LS9: findBySourceId returns existing entries for same achievement", async () => {
  const sourceId = "ach_1";
  await ledger.append({ /* ... */ sourceId, kind: "achievement-credit" });
  await ledger.append({ /* ... */ sourceId, kind: "savings-deposit" });
  const found = await ledger.findBySourceId(sourceId);
  expect(found).toHaveLength(2);
});
```

### LS10 — LedgerEntry JSONL persistence survives restart

```typescript
test("LS10: ledger.jsonl entries are durable across process restart", async () => {
  const ledger1 = new FilesystemLedger(tmpDataDir);
  await ledger1.append({ /* ... */ id: "entry_1", familyId: "fam_abc" });

  // Simulate restart: new instance, same dir
  const ledger2 = new FilesystemLedger(tmpDataDir);
  const found = await ledger2.listPending("fam_abc");
  expect(found.some(e => e.id === "entry_1")).toBe(true);
});
```

## 3. Phase A integration tests — dual-write

### LS11 — verify-achievement writes both Achievement and ledger entries

```typescript
test("LS11: verify-achievement creates Achievement + 2 LedgerEntries", async () => {
  await callTool("verify-achievement", {
    childName: "Maya",
    category: "reading",
    amountUsdcMicros: 1_000_000,
  }, { role: "manager", familyId: "fam_abc" });

  const achievements = await engine.listAchievements("fam_abc");
  const entries = await ledger.listPending("fam_abc", "Maya");
  expect(achievements).toHaveLength(1);
  expect(entries).toHaveLength(2);
  expect(entries.reduce((s, e) => s + e.amountUsdcMicros, 0)).toBe(1_000_000);
});
```

### LS12 — Dual-write is idempotent on retry

```typescript
test("LS12: re-running verify-achievement with same input does not duplicate ledger entries", async () => {
  // First call
  await callTool("verify-achievement", { childName: "Maya", category: "reading", amountUsdcMicros: 1_000_000 }, ctx);
  // Re-run with same idempotency key (or same input within dedup window)
  await callTool("verify-achievement", { childName: "Maya", category: "reading", amountUsdcMicros: 1_000_000 }, ctx);
  const entries = await ledger.listPending("fam_abc", "Maya");
  expect(entries).toHaveLength(2); // not 4
});
```

### LS13 — Existing tests still pass with dual-write enabled

```typescript
test("LS13: pre-sprint test suite passes with ALLOWME_LEDGER_MODE=dual-write", async () => {
  process.env.ALLOWME_LEDGER_MODE = "dual-write";
  // Run the existing distribute-allowance happy-path test
  const result = await runExistingDistributeAllowanceHappyPath();
  expect(result).toMatchExistingSnapshot();
});
```

## 4. Phase C tests — distribute-allowance becomes ledger-only

### LS14 — distribute-allowance does zero on-chain in Phase C

```typescript
test("LS14: distribute-allowance does not call transferUSDC in Phase C", async () => {
  process.env.ALLOWME_LEDGER_MODE = "ledger-only";
  const transferSpy = jest.spyOn(WalletDistributor.prototype, "transferUSDC");

  await callTool("distribute-allowance", { childName: "Maya" }, { role: "manager", familyId: "fam_abc" });

  expect(transferSpy).not.toHaveBeenCalled();
});
```

### LS15 — distribute-allowance marks achievements ledgerized

```typescript
test("LS15: distribute-allowance in Phase C sets Achievement.ledgerized=true", async () => {
  await seedPendingAchievement("fam_abc", "Maya");
  await callTool("distribute-allowance", { childName: "Maya" }, ctx);
  const achievements = await engine.listAchievements("fam_abc");
  expect(achievements.every(a => a.ledgerized)).toBe(true);
});
```

### LS16 — settle-balance is the only path that calls transferUSDC

```typescript
test("LS16: in Phase C, only settle-balance triggers on-chain transfers", async () => {
  const transferSpy = jest.spyOn(WalletDistributor.prototype, "transferUSDC");
  process.env.ALLOWME_LEDGER_MODE = "ledger-only";

  // Try all the legacy paths
  await callTool("verify-achievement", { ... }, managerCtx);
  await callTool("distribute-allowance", { ... }, managerCtx);
  await callTool("release-savings", { ... }, managerCtx);
  await callTool("settle-session-payout", { ... }, managerCtx);
  expect(transferSpy).not.toHaveBeenCalled();

  // Now settle-balance
  await callTool("settle-balance", {}, managerCtx);
  expect(transferSpy).toHaveBeenCalled();
});
```

### LS17 — On-chain audit log records settle-balance batchId

```typescript
test("LS17: audit-log entries from settle-balance include settlementBatchId", async () => {
  await callTool("settle-balance", {}, managerCtx);
  const auditEntries = await readAuditLog("fam_abc");
  const settleEntry = auditEntries.find(e => e.event === "balance_settled");
  expect(settleEntry.settlement_batch_id).toBeTruthy();
});
```

## 5. release-savings + settle-session-payout in Phase C

### LS18 — release-savings writes savings-release ledger entries, no broadcast

```typescript
test("LS18: release-savings creates LedgerEntry { kind: 'savings-release' } and no tx", async () => {
  process.env.ALLOWME_LEDGER_MODE = "ledger-only";
  const transferSpy = jest.spyOn(WalletDistributor.prototype, "transferUSDC");
  await seedMaturedSavings("fam_abc", "Maya", 500_000);

  await callTool("release-savings", { childName: "Maya" }, managerCtx);

  expect(transferSpy).not.toHaveBeenCalled();
  const entries = await ledger.listPending("fam_abc", "Maya");
  const releases = entries.filter(e => e.kind === "savings-release");
  expect(releases).toHaveLength(1);
  expect(releases[0].amountUsdcMicros).toBe(500_000);
});
```

### LS19 — settle-session-payout writes session-payout entry

```typescript
test("LS19: settle-session-payout creates session-payout LedgerEntry only", async () => {
  process.env.ALLOWME_LEDGER_MODE = "ledger-only";
  const transferSpy = jest.spyOn(WalletDistributor.prototype, "transferUSDC");

  await callTool("settle-session-payout", { sessionId: "sess_1", amountUsdcMicros: 100_000 }, managerCtx);

  expect(transferSpy).not.toHaveBeenCalled();
  const entries = await ledger.listPending("fam_abc", "Maya");
  expect(entries.some(e => e.kind === "session-payout")).toBe(true);
});
```

### LS20 — Kid-facing flow for Sprint 4.0 Learning Mode is unchanged

```typescript
test("LS20: Learning Mode session flow shows correct receipt UX post-cutover", async () => {
  // Run a full Learning Mode session
  const receipt = await runLearningModeSessionAsKid("fam_abc", "Maya");
  // Kid receipt should show "earned" and "ready to settle"
  expect(receipt.body).toContain("earned");
  expect(receipt.body).not.toContain("transferred"); // no longer broadcasts immediately
});
```

## 6. settle-balance tool tests

### LS21 — settle-balance happy path: all pending entries settle

```typescript
test("LS21: settle-balance settles all pending entries with one tx per destination", async () => {
  await seedLedgerEntries([
    { childName: "Maya", destination: "child-wallet", amount: 500_000 },
    { childName: "Maya", destination: "child-wallet", amount: 300_000 },
    { childName: "Maya", destination: "savings-vault", amount: 200_000 },
  ]);
  const transferSpy = jest.spyOn(WalletDistributor.prototype, "transferUSDC");

  await callTool("settle-balance", { childName: "Maya" }, managerCtx);

  expect(transferSpy).toHaveBeenCalledTimes(2); // one per destination
  expect(transferSpy).toHaveBeenCalledWith(expect.anything(), 800_000); // wallet sum
  expect(transferSpy).toHaveBeenCalledWith(expect.anything(), 200_000); // savings sum

  const settled = await ledger.listSettled("fam_abc", "Maya");
  expect(settled).toHaveLength(3);
  // All share same batchId
  expect(new Set(settled.map(s => s.settlementBatchId)).size).toBe(1);
});
```

### LS22 — Kid can settle own balance (RBAC pass)

```typescript
test("LS22: learner role can call settle-balance for own childName", async () => {
  const learnerCtx = { role: "learner" as const, familyId: "fam_abc", callerChildName: "Maya" };
  await seedLedgerEntries([{ childName: "Maya", destination: "child-wallet", amount: 500_000 }]);

  const result = await callTool("settle-balance", {}, learnerCtx);
  expect(result.isError).toBeFalsy();
});
```

### LS23 — Kid self-settle scopes to own child only

```typescript
test("LS23: learner cannot settle sibling balances even with explicit childName", async () => {
  const learnerCtx = { role: "learner" as const, callerChildName: "Maya" };
  await seedLedgerEntries([{ childName: "Diego", destination: "child-wallet", amount: 500_000 }]);

  const result = await callTool("settle-balance", { childName: "Diego" }, learnerCtx);
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("cannot settle for another child");
});
```

### LS24 — Family viewer role rejected

```typescript
test("LS24: family role cannot call settle-balance", async () => {
  const familyCtx = { role: "family" as const };
  const result = await callTool("settle-balance", {}, familyCtx);
  expect(result.isError).toBe(true);
});
```

### LS25 — Advisor role rejected

```typescript
test("LS25: advisor role cannot call settle-balance", async () => {
  const advisorCtx = { role: "advisor" as const };
  const result = await callTool("settle-balance", {}, advisorCtx);
  expect(result.isError).toBe(true);
});
```

### LS26 — Dry-run returns preview without on-chain

```typescript
test("LS26: dryRun=true returns preview and does not call transferUSDC", async () => {
  await seedLedgerEntries([{ childName: "Maya", destination: "child-wallet", amount: 500_000 }]);
  const transferSpy = jest.spyOn(WalletDistributor.prototype, "transferUSDC");

  const result = await callTool("settle-balance", { childName: "Maya", dryRun: true }, managerCtx);

  expect(transferSpy).not.toHaveBeenCalled();
  expect(result.content[0].text).toContain("preview");
  expect(result.content[0].text).toContain("$0.50");
});
```

### LS27 — Family-wide settle without childName settles all children

```typescript
test("LS27: settle-balance with no childName settles all children in family", async () => {
  await seedLedgerEntries([
    { childName: "Maya", destination: "child-wallet", amount: 500_000 },
    { childName: "Diego", destination: "child-wallet", amount: 300_000 },
  ]);

  await callTool("settle-balance", {}, managerCtx);

  const settled = await ledger.listSettled("fam_abc");
  expect(settled).toHaveLength(2);
});
```

### LS28 — settle-balance response includes per-destination summary

```typescript
test("LS28: response markdown shows per-destination amount and tx hash", async () => {
  await seedLedgerEntries([
    { childName: "Maya", destination: "child-wallet", amount: 500_000 },
    { childName: "Maya", destination: "savings-vault", amount: 100_000 },
  ]);
  const result = await callTool("settle-balance", { childName: "Maya" }, managerCtx);

  const text = result.content[0].text;
  expect(text).toContain("→ Maya's wallet");
  expect(text).toContain("→ savings vault");
  expect(text).toMatch(/0x[a-fA-F0-9]+/); // tx hash
});
```

### LS29 — Empty ledger returns nothing-to-settle response

```typescript
test("LS29: settle-balance with no pending returns friendly empty state", async () => {
  const result = await callTool("settle-balance", { childName: "Maya" }, managerCtx);
  expect(result.content[0].text.toLowerCase()).toContain("nothing to settle");
});
```

### LS30 — Batch ID is propagated to audit log

```typescript
test("LS30: settle-balance audit entry references settlementBatchId", async () => {
  await seedLedgerEntries([{ childName: "Maya", destination: "child-wallet", amount: 500_000 }]);
  await callTool("settle-balance", { childName: "Maya" }, managerCtx);

  const auditEntries = await readAuditLog("fam_abc");
  const settleEntry = auditEntries.find(e => e.event === "balance_settled");
  expect(settleEntry.settlement_batch_id).toBeTruthy();
});
```

## 7. Allowlist integration

### LS31 — Allowlist rejection happens before broadcast

```typescript
test("LS31: settle-balance does not broadcast when destination is not allowlisted", async () => {
  await seedLedgerEntries([{ childName: "Maya", destination: "child-wallet", amount: 500_000 }]);
  await configurePolicyWithEmptyAllowlist("fam_abc");

  const transferSpy = jest.spyOn(WalletDistributor.prototype, "transferUSDC");
  const result = await callTool("settle-balance", { childName: "Maya" }, managerCtx);

  expect(transferSpy).not.toHaveBeenCalled();
  expect(result.content[0].text.toLowerCase()).toContain("not on the authorized");
});
```

### LS32 — Rejected entries stay pending (no status change)

```typescript
test("LS32: pending entries are preserved when allowlist rejects", async () => {
  // ... setup as LS31 ...
  await callTool("settle-balance", { childName: "Maya" }, managerCtx);
  const pending = await ledger.listPending("fam_abc", "Maya");
  expect(pending).toHaveLength(1);
  expect(pending[0].status).toBe("pending");
});
```

### LS33 — Allowlist error message includes the failing destination

```typescript
test("LS33: allowlist rejection message identifies the unauthorized wallet", async () => {
  // ... setup ...
  const result = await callTool("settle-balance", { childName: "Maya" }, managerCtx);
  expect(result.content[0].text).toContain("0x"); // wallet address shown
  expect(result.content[0].text.toLowerCase()).toContain("configure-policy");
});
```

## 8. Partial failure recovery

### LS41 — One destination fails, other succeeds — partial settlement

```typescript
test("LS41: when one transfer fails, other destinations still settle", async () => {
  await seedLedgerEntries([
    { childName: "Maya", destination: "child-wallet", amount: 500_000 },
    { childName: "Maya", destination: "savings-vault", amount: 200_000 },
  ]);

  // Mock: wallet succeeds, savings fails
  jest.spyOn(WalletDistributor.prototype, "transferUSDC")
    .mockResolvedValueOnce("0xabc")
    .mockRejectedValueOnce(new Error("insufficient gas"));

  const result = await callTool("settle-balance", { childName: "Maya" }, managerCtx);

  const settled = await ledger.listSettled("fam_abc", "Maya");
  const failed = await ledger.listFailed("fam_abc", "Maya");
  expect(settled).toHaveLength(1);
  expect(failed).toHaveLength(1);
  expect(failed[0].failureReason).toContain("insufficient gas");
});
```

### LS42 — Failed entries are picked up on next settle-balance call

```typescript
test("LS42: failed entries retry on subsequent settle-balance calls", async () => {
  // First call: one fails
  // ... (setup as LS41) ...

  // Second call: succeeds this time
  jest.spyOn(WalletDistributor.prototype, "transferUSDC").mockResolvedValueOnce("0xdef");
  await callTool("settle-balance", { childName: "Maya" }, managerCtx);

  const settled = await ledger.listSettled("fam_abc", "Maya");
  expect(settled).toHaveLength(2);
});
```

### LS43 — Retry count is incremented per failure

```typescript
test("LS43: each failure increments retryCount", async () => {
  jest.spyOn(WalletDistributor.prototype, "transferUSDC").mockRejectedValue(new Error("rpc timeout"));
  await seedLedgerEntries([{ childName: "Maya", destination: "child-wallet", amount: 500_000 }]);

  await callTool("settle-balance", { childName: "Maya" }, managerCtx);
  await callTool("settle-balance", { childName: "Maya" }, managerCtx);

  const failed = await ledger.listFailed("fam_abc", "Maya");
  expect(failed[0].retryCount).toBe(2);
});
```

### LS44 — Abandoned status after 3 failed retries

```typescript
test("LS44: entry transitions to abandoned after 3 failures", async () => {
  jest.spyOn(WalletDistributor.prototype, "transferUSDC").mockRejectedValue(new Error("perma fail"));
  await seedLedgerEntries([{ childName: "Maya", destination: "child-wallet", amount: 500_000 }]);

  for (let i = 0; i < 3; i++) await callTool("settle-balance", { childName: "Maya" }, managerCtx);

  const abandoned = await ledger.listAbandoned("fam_abc", "Maya");
  expect(abandoned).toHaveLength(1);
  expect(abandoned[0].retryCount).toBe(3);
});
```

### LS45 — Sentry event fires on abandon

```typescript
test("LS45: Sentry receives event when entry abandoned", async () => {
  // ... setup as LS44 ...
  expect(sentryEvents.find(e => e.message?.includes("ledger entry abandoned"))).toBeTruthy();
});
```

### LS46 — Abandoned entry not retried by auto-settle

```typescript
test("LS46: auto-settle skips abandoned entries", async () => {
  // ... seed abandoned entry ...
  const transferSpy = jest.spyOn(WalletDistributor.prototype, "transferUSDC");
  await runAutoSettle();
  expect(transferSpy).not.toHaveBeenCalled();
});
```

### LS47 — failureReason classification: insufficient_gas

```typescript
test("LS47: gas-related errors classify as insufficient_gas", () => {
  expect(classifyFailure(new Error("execution reverted: insufficient funds for gas"))).toBe("insufficient_gas");
});
```

### LS48 — failureReason classification: rpc_timeout

```typescript
test("LS48: timeout errors classify as rpc_timeout", () => {
  expect(classifyFailure(new Error("ETIMEDOUT"))).toBe("rpc_timeout");
});
```

### LS49 — failureReason classification: policy_denied

```typescript
test("LS49: OWS policy_denied errors classify as policy_denied", () => {
  expect(classifyFailure(new OwsPolicyError("recipient not authorized"))).toBe("policy_denied: recipient_not_authorized");
});
```

### LS50 — Unclassified failures still record raw message

```typescript
test("LS50: unknown errors fall back to raw message in failureReason", () => {
  const reason = classifyFailure(new Error("something else weird"));
  expect(reason).toContain("something else weird");
});
```

## 9. Auto-settle tests

### LS51 — Auto-settle runs for opted-in families only

```typescript
test("LS51: auto-settle skips families with autoSettleWeekly=false", async () => {
  await seedFamily("fam_optin", { autoSettleWeekly: true });
  await seedFamily("fam_optout", { autoSettleWeekly: false });
  await seedLedgerEntries([
    { familyId: "fam_optin", childName: "Maya", destination: "child-wallet", amount: 500_000 },
    { familyId: "fam_optout", childName: "Diego", destination: "child-wallet", amount: 500_000 },
  ]);

  await runAutoSettle();

  expect(await ledger.listSettled("fam_optin")).toHaveLength(1);
  expect(await ledger.listSettled("fam_optout")).toHaveLength(0);
});
```

### LS52 — Auto-settle disabled by env var skips all

```typescript
test("LS52: ALLOWME_AUTO_SETTLE_DISABLED=true skips all families", async () => {
  process.env.ALLOWME_AUTO_SETTLE_DISABLED = "true";
  await seedFamily("fam_optin", { autoSettleWeekly: true });
  await seedLedgerEntries([{ familyId: "fam_optin", childName: "Maya", destination: "child-wallet", amount: 500_000 }]);

  await runAutoSettle();
  expect(await ledger.listSettled("fam_optin")).toHaveLength(0);
});
```

### LS53 — Auto-settle Sunday scheduling

```typescript
test("LS53: auto-settle scheduler triggers on Sunday 00:00 UTC", () => {
  // Verify Railway scheduled tasks config or node-cron expression
  const cronExpr = readSchedulerConfig();
  expect(cronExpr).toBe("0 0 * * 0"); // Sunday 00:00 UTC
});
```

### LS54 — Auto-settle failure on one family does not block others

```typescript
test("LS54: a failure in one family's auto-settle does not stop the job", async () => {
  await seedFamily("fam_broken", { autoSettleWeekly: true });
  await seedFamily("fam_ok", { autoSettleWeekly: true });
  await corruptLedgerFile("fam_broken"); // simulate broken state
  await seedLedgerEntries([{ familyId: "fam_ok", childName: "Maya", destination: "child-wallet", amount: 500_000 }]);

  await runAutoSettle();

  expect(await ledger.listSettled("fam_ok")).toHaveLength(1);
  expect(sentryEvents.find(e => e.tags?.familyId === "fam_broken")).toBeTruthy();
});
```

### LS55 — Auto-settle uses same RBAC path as manager invocation

```typescript
test("LS55: auto-settle internally invokes settle-balance with manager-equivalent context", async () => {
  // ... seed entries ...
  const handlerSpy = jest.spyOn(settleBalanceTool, "handler");
  await runAutoSettle();
  expect(handlerSpy).toHaveBeenCalledWith(
    expect.objectContaining({ context: expect.objectContaining({ role: "manager" }) })
  );
});
```

## 10. Migration tests

### LS56 — Migration script writes ledger entries for undistributed achievements

```typescript
test("LS56: migration creates LedgerEntries for Achievement.distributed=false records", async () => {
  await seedAchievement("fam_abc", "Maya", { distributed: false, amountUsdcMicros: 1_000_000 });
  await seedAchievement("fam_abc", "Maya", { distributed: true, amountUsdcMicros: 500_000 });

  await runMigration();

  const entries = await ledger.listPending("fam_abc", "Maya");
  expect(entries).toHaveLength(2); // only the undistributed achievement, split into 2
  expect(entries.reduce((s, e) => s + e.amountUsdcMicros, 0)).toBe(1_000_000);
});
```

### LS57 — Migration is idempotent

```typescript
test("LS57: re-running migration does not duplicate entries", async () => {
  await seedAchievement("fam_abc", "Maya", { distributed: false, amountUsdcMicros: 1_000_000 });

  await runMigration();
  await runMigration();
  await runMigration();

  const entries = await ledger.listPending("fam_abc", "Maya");
  expect(entries).toHaveLength(2); // not 6
});
```

### LS58 — Migration handles 1000+ achievements without OOM

```typescript
test("LS58: migration processes 1000 achievements without memory blowup", async () => {
  for (let i = 0; i < 1000; i++) {
    await seedAchievement("fam_abc", "Maya", { distributed: false });
  }
  await expect(runMigration()).resolves.not.toThrow();
  const entries = await ledger.listPending("fam_abc", "Maya");
  expect(entries).toHaveLength(2000);
}, 60000);
```

### LS59 — Migration dry-run reports what would happen

```typescript
test("LS59: migration --dry-run reports counts without writing", async () => {
  await seedAchievement("fam_abc", "Maya", { distributed: false });

  const report = await runMigration({ dryRun: true });
  expect(report.wouldCreate).toBe(2);

  const entries = await ledger.listPending("fam_abc", "Maya");
  expect(entries).toHaveLength(0); // no writes
});
```

### LS60 — Migration preserves savingsPercent at time of original achievement

```typescript
test("LS60: migration uses current childConfig.savingsPercent (not at-achievement-time)", async () => {
  // Achievement created when savingsPercent was 30%, but current is 20%
  // Migration uses CURRENT — this is documented behavior (research §5.1 caveat)
  await seedAchievement("fam_abc", "Maya", { amountUsdcMicros: 1_000_000, distributed: false });
  await setChildConfig("fam_abc", "Maya", { savingsPercent: 20 });

  await runMigration();
  const entries = await ledger.listPending("fam_abc", "Maya");
  const savings = entries.find(e => e.kind === "savings-deposit");
  expect(savings.amountUsdcMicros).toBe(200_000);
});
```

## 11. UX copy tests

### LS61 — check-progress kid-facing copy includes wallet balance and pending

```typescript
test("LS61: kid-facing check-progress shows earned + wallet + pending", async () => {
  await seedLedgerEntries([{ childName: "Maya", destination: "child-wallet", amount: 730_000, status: "pending" }]);
  await mockUsdcBalance(mayaWallet, 3_500_000);

  const result = await callTool("check-progress", {}, learnerCtx);
  const text = result.content[0].text;

  expect(text).toMatch(/Earned this week/i);
  expect(text).toMatch(/In your wallet:\s*\$3\.50/);
  expect(text).toMatch(/Pending settlement:\s*\$0\.73/);
  expect(text).toMatch(/settle-balance/);
});
```

### LS62 — check-progress manager-facing copy includes auto-settle option

```typescript
test("LS62: manager-facing check-progress mentions auto-settle option", async () => {
  await seedLedgerEntries([{ childName: "Maya", destination: "child-wallet", amount: 500_000 }]);
  const result = await callTool("check-progress", { childName: "Maya" }, managerCtx);
  expect(result.content[0].text).toMatch(/auto-settle/i);
});
```

### LS63 — check-progress with auto-settle enabled shows countdown

```typescript
test("LS63: when autoSettleWeekly=true, copy shows next-Sunday countdown", async () => {
  await setPolicyAutoSettle("fam_abc", true);
  await seedLedgerEntries([{ childName: "Maya", destination: "child-wallet", amount: 500_000 }]);
  const result = await callTool("check-progress", {}, learnerCtx);
  expect(result.content[0].text).toMatch(/auto-settles Sunday/i);
});
```

### LS64 — check-savings shows locked / released / pending-settlement breakdown

```typescript
test("LS64: check-savings rich card has all three rows", async () => {
  await seedSavingsState("fam_abc", "Maya", { locked: 150_000, released: 200_000 });
  await seedLedgerEntries([{ childName: "Maya", destination: "savings-vault", amount: 30_000, kind: "savings-deposit" }]);

  const result = await callTool("check-savings", { childName: "Maya" }, learnerCtx);
  const text = result.content[0].text;
  expect(text).toMatch(/Locked.*\$1\.50/);
  expect(text).toMatch(/Released.*\$2\.00/);
  expect(text).toMatch(/Pending.*\$0\.30/);
});
```

### LS65 — Nothing-to-settle copy is friendly, not error-shaped

```typescript
test("LS65: empty-state settle-balance response is encouraging, not alarming", async () => {
  const result = await callTool("settle-balance", { childName: "Maya" }, managerCtx);
  const text = result.content[0].text;
  expect(text).not.toMatch(/error|fail|problem/i);
  expect(text).toMatch(/nothing to settle|all caught up|already in/i);
});
```

## 12. Performance tests

### LS-PERF-1 — Gas reduction validation

```typescript
test("LS-PERF-1: weekly batched settlement uses fewer tx than per-distribution", async () => {
  // Seed: 7 days of achievements (typical kid week)
  for (let day = 0; day < 7; day++) {
    await seedAchievement("fam_abc", "Maya", { amountUsdcMicros: 150_000 });
  }

  // Run settle-balance once
  const txCount = await countOnChainTxInTestSettle();
  expect(txCount).toBe(2); // one to wallet, one to savings

  // Compare to old behavior (7 days × 2 tx = 14)
  expect(txCount).toBeLessThanOrEqual(2);
  // Reduction: (14 - 2) / 14 = 85.7% ≥ 80% threshold
});
```

### LS-PERF-2 — Ledger read performance at 10k entries

```typescript
test("LS-PERF-2: listPending p95 < 100ms with 10k entries in family file", async () => {
  for (let i = 0; i < 10_000; i++) {
    await ledger.append({ /* ... */ familyId: "fam_perf", childName: "Maya" });
  }

  const times: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = Date.now();
    await ledger.listPending("fam_perf", "Maya");
    times.push(Date.now() - start);
  }

  const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
  expect(p95).toBeLessThan(100);
}, 60000);
```

This test sets the Sprint 4.4 threshold: if it fails consistently in
production, that's the signal to accelerate the Postgres migration.

## 13. CI coverage gate

### LS-COV-1 — Ledger module 100% branch coverage

```javascript
// jest.config.js — addition
module.exports = {
  // ...
  coverageThreshold: {
    "src/engine/ledger.ts": { branches: 100, functions: 100, lines: 100 },
    "src/tools/settle-balance.ts": { branches: 95, functions: 100, lines: 95 },
  },
};
```

## 14. Manual verification

- **MV1:** Pilot family (one parent, one kid) uses the new flow for 3
  days. Acceptance: kid understands the "earned vs spendable"
  distinction without explanation.
- **MV2:** Trigger a real allowlist failure in staging. Verify the
  error message is actionable (parent knows what to fix).
- **MV3:** Run auto-settle manually in staging. Verify Axiom
  dashboard shows the batched activity.
- **MV4:** Compare gas spend pre- and post-cutover for one staging
  family over 7 days. Verify ≥80% reduction.

## 15. Test execution order

1. Unit tests (LS1-LS10) — every PR.
2. Phase A integration (LS11-LS13) — PR1 + main.
3. Phase C integration (LS14-LS20) — PR3 + main.
4. settle-balance tests (LS21-LS30) — PR2 + main.
5. Allowlist tests (LS31-LS33) — PR2 + main.
6. Failure recovery (LS41-LS50) — PR2 + main.
7. Auto-settle (LS51-LS55) — PR2 + main.
8. Migration (LS56-LS60) — PR1 + main.
9. Copy tests (LS61-LS65) — PR3 + main.
10. Performance (LS-PERF-1, LS-PERF-2) — nightly + pre-cutover.
11. Manual (MV1-MV4) — pre-cutover and 72h post-cutover.

## 16. Exit criteria for Sprint 4.0.3

- All 65 automated tests pass on main.
- LS-COV-1 coverage gate green.
- All 4 manual verification items signed off.
- 72-hour post-cutover production observation confirms SC4 (≥80% gas
  reduction) and SC10 (zero "where's my money" support tickets).
- Pilot family acceptance test passed.
- `docs/SETTLEMENT.md` exists.
- copy-4.0.3.md matches deployed copy exactly.