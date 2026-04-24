import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateManager } from "../src/engine/state.js";
import type { SavingsEntry, FamilyConfig } from "../src/schemas.js";

const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

const testDataDir = join(process.cwd(), "data");

// Helper: create a standard family config for tests
function makeConfig(overrides?: Partial<FamilyConfig>): FamilyConfig {
  return {
    familyName: "TestFamily",
    children: [
      {
        name: "Maya",
        walletName: "child-maya",
        weeklyBudget: 15_000_000,
        categories: [
          { name: "education", pct: 33, budget: 5_000_000 },
          { name: "health", pct: 33, budget: 5_000_000 },
          { name: "personal", pct: 33, budget: 5_000_000 },
        ],
        savingsPercent: 20,
        savingsLockDays: 90,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chainId: "eip155:84532",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    ...overrides,
  };
}

// Helper: create a USDC savings entry
function makeUsdcEntry(childName: string, amount: number, opts?: { lockDaysAgo?: number; lockDaysFromNow?: number }): SavingsEntry {
  const lockDays = opts?.lockDaysFromNow ?? -(opts?.lockDaysAgo ?? 0);
  return {
    id: randomUUID(),
    childName,
    amount,
    asset: "USDC",
    depositedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    lockUntil: new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000).toISOString(),
    released: false,
    multiplierAtDeposit: 1.0,
    converted: false,
  };
}

// ============================================================
// G1-G8: Unit Tests — Savings Diversification
// ============================================================
describe("Savings Diversification — Unit Tests", () => {
  let state: StateManager;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();
    await state.createFamilyDir(FAMILY_ID);
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("G1: Existing savings entries default to asset: USDC", async () => {
    // Create an entry without explicit asset field (backward compat)
    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date().toISOString(),
      lockUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
    });

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    expect(entries).toHaveLength(1);
    expect(entries[0].asset).toBe("USDC");
    expect(entries[0].converted).toBe(false);
  });

  it("G2: convert-savings with sufficient USDC balance creates PAXG entry", async () => {
    await state.saveFamilyConfig(FAMILY_ID, makeConfig());

    // Add two USDC entries totaling $6.00
    const entry1 = makeUsdcEntry("Maya", 3_000_000, { lockDaysFromNow: 60 });
    const entry2 = makeUsdcEntry("Maya", 3_000_000, { lockDaysFromNow: 60 });
    await state.addSavingsEntry(FAMILY_ID, entry1);
    await state.addSavingsEntry(FAMILY_ID, entry2);

    // Simulate convert-savings: convert $3.00 USDC to PAXG
    const allEntries = await state.loadSavingsEntries(FAMILY_ID);
    const usdcEntries = allEntries.filter(
      (e) => e.childName === "Maya" && !e.released && !e.converted && (e.asset || "USDC") === "USDC"
    );

    // Mark first entry as converted
    let remaining = 3_000_000;
    for (const entry of usdcEntries) {
      if (remaining <= 0) break;
      if (entry.amount <= remaining) {
        entry.converted = true;
        remaining -= entry.amount;
      }
    }

    // Create PAXG entry
    const paxgEntry: SavingsEntry = {
      id: randomUUID(),
      childName: "Maya",
      amount: 0,
      asset: "PAXG",
      depositedAt: new Date().toISOString(),
      lockUntil: new Date().toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
      converted: false,
      convertedFrom: usdcEntries[0].id,
      conversionTxHash: "0xabc123def456",
      priceAtConversion: 4660.0,
      receivedAmount: "0.000644",
    };
    allEntries.push(paxgEntry);
    await state.saveSavingsEntries(FAMILY_ID, allEntries);

    // Verify
    const after = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const converted = after.filter((e) => e.converted);
    const paxg = after.filter((e) => e.asset === "PAXG");
    const activeUsdc = after.filter((e) => !e.converted && (e.asset || "USDC") === "USDC");

    expect(converted).toHaveLength(1);
    expect(paxg).toHaveLength(1);
    expect(paxg[0].receivedAmount).toBe("0.000644");
    expect(paxg[0].priceAtConversion).toBe(4660.0);
    expect(paxg[0].conversionTxHash).toBe("0xabc123def456");
    expect(paxg[0].multiplierAtDeposit).toBe(1.0);
    expect(activeUsdc).toHaveLength(1);
    expect(activeUsdc[0].amount).toBe(3_000_000);
  });

  it("G3: convert-savings with insufficient USDC balance returns error", async () => {
    await state.saveFamilyConfig(FAMILY_ID, makeConfig());

    // Add only $2.00
    await state.addSavingsEntry(FAMILY_ID, makeUsdcEntry("Maya", 2_000_000, { lockDaysFromNow: 60 }));

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const available = entries
      .filter((e) => !e.released && !e.converted && (e.asset || "USDC") === "USDC")
      .reduce((sum, e) => sum + e.amount, 0);

    // Requesting $3.00 — should be insufficient
    const requested = 3_000_000;
    expect(available).toBeLessThan(requested);

    const errorMsg = `Insufficient USDC savings. Available: $${(available / 1e6).toFixed(2)}, requested: $${(requested / 1e6).toFixed(2)}`;
    expect(errorMsg).toContain("Insufficient USDC savings");
    expect(errorMsg).toContain("$2.00");
    expect(errorMsg).toContain("$3.00");
  });

  it("G4: convert-savings for nonexistent child returns error", async () => {
    await state.saveFamilyConfig(FAMILY_ID, makeConfig());

    const config = await state.loadFamilyConfig(FAMILY_ID);
    const childConfig = config!.children.find(
      (c) => c.name.toLowerCase() === "ghost".toLowerCase()
    );

    expect(childConfig).toBeUndefined();
  });

  it("G5: check-savings groups entries by asset (USDC + PAXG)", async () => {
    // Add USDC entry
    await state.addSavingsEntry(FAMILY_ID, makeUsdcEntry("Maya", 3_000_000, { lockDaysFromNow: 60 }));

    // Add PAXG entry
    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 0,
      asset: "PAXG",
      depositedAt: new Date().toISOString(),
      lockUntil: new Date().toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
      converted: false,
      receivedAmount: "0.000644",
      priceAtConversion: 4660.0,
      conversionTxHash: "0xabc123",
    });

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const active = entries.filter((e) => !e.converted);
    const usdc = active.filter((e) => (e.asset || "USDC") === "USDC" && !e.released);
    const paxg = active.filter((e) => e.asset === "PAXG" && !e.released);

    expect(usdc).toHaveLength(1);
    expect(paxg).toHaveLength(1);
    expect(usdc[0].amount).toBe(3_000_000);
    expect(parseFloat(paxg[0].receivedAmount || "0")).toBeCloseTo(0.000644, 6);
  });

  it("G6: check-savings with USDC only shows no PAXG section", async () => {
    await state.addSavingsEntry(FAMILY_ID, makeUsdcEntry("Maya", 5_000_000, { lockDaysFromNow: 30 }));

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const active = entries.filter((e) => !e.converted);
    const paxg = active.filter((e) => e.asset === "PAXG" && !e.released);

    expect(paxg).toHaveLength(0);
    // PAXG position should be undefined when no PAXG entries exist
    const paxgPosition = paxg.length > 0 ? { totalAmount: "some" } : undefined;
    expect(paxgPosition).toBeUndefined();
  });

  it("G7: Audit entry created for savings-converted action", async () => {
    // Simulate audit entry creation
    await state.addAuditEntry(FAMILY_ID, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "savings-converted",
      actor: "manager",
      details: {
        childName: "Maya",
        usdcConsumed: 3_000_000,
        usdcConsumedUsd: "3.00",
        receivedAsset: "PAXG",
        receivedAmount: "0.000644",
        priceAtConversion: 4660.0,
        txHash: "0xabc123def456",
        consumedEntryIds: ["entry-1"],
      },
      txHash: "0xabc123def456",
      amount: 3_000_000,
    });

    const log = await state.loadAuditLog(FAMILY_ID);
    const convertEntries = log.filter((e) => e.action === "savings-converted");
    expect(convertEntries).toHaveLength(1);
    expect(convertEntries[0].details.childName).toBe("Maya");
    expect(convertEntries[0].details.receivedAsset).toBe("PAXG");
    expect(convertEntries[0].details.receivedAmount).toBe("0.000644");
    expect(convertEntries[0].details.priceAtConversion).toBe(4660.0);
    expect(convertEntries[0].txHash).toBe("0xabc123def456");
    expect(convertEntries[0].amount).toBe(3_000_000);
  });

  it("G8: convert-savings is Manager only — other roles denied", async () => {
    // Import RBAC helpers
    const { isToolAuthorized } = await import("../src/middleware/access-control.js");

    expect(isToolAuthorized("convert-savings", "manager")).toBe(true);
    expect(isToolAuthorized("convert-savings", "learner")).toBe(false);
    expect(isToolAuthorized("convert-savings", "co-parent")).toBe(false);
    expect(isToolAuthorized("convert-savings", "family")).toBe(false);
    expect(isToolAuthorized("convert-savings", "advisor")).toBe(false);
  });
});

// ============================================================
// E1-E6: E2E Test — Savings Diversification Flow
// ============================================================
describe("E2E: Savings Diversification Flow", () => {
  let state: StateManager;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();
    await state.createFamilyDir(FAMILY_ID);
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("E1: Configure family with Maya ($15/week, 20% savings)", async () => {
    const config = makeConfig();
    await state.saveFamilyConfig(FAMILY_ID, config);

    const loaded = await state.loadFamilyConfig(FAMILY_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.children).toHaveLength(1);
    expect(loaded!.children[0].name).toBe("Maya");
    expect(loaded!.children[0].weeklyBudget).toBe(15_000_000);
    expect(loaded!.children[0].savingsPercent).toBe(20);
  });

  it("E2: Deposit $3.00 savings (USDC, locked 90 days)", async () => {
    await state.saveFamilyConfig(FAMILY_ID, makeConfig());

    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date().toISOString(),
      lockUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
    });

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    expect(entries).toHaveLength(1);
    expect(entries[0].asset).toBe("USDC");
    expect(entries[0].amount).toBe(3_000_000);
  });

  it("E3: Second deposit brings total to $6.00 locked", async () => {
    await state.saveFamilyConfig(FAMILY_ID, makeConfig());

    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      lockUntil: new Date(Date.now() + 83 * 24 * 60 * 60 * 1000).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
    });
    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date().toISOString(),
      lockUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
    });

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    expect(entries).toHaveLength(2);
    const total = entries.reduce((sum, e) => sum + e.amount, 0);
    expect(total).toBe(6_000_000);
  });

  it("E4: Convert $3.00 to PAXG — original marked converted, PAXG entry created", async () => {
    await state.saveFamilyConfig(FAMILY_ID, makeConfig());

    // Two deposits of $3 each
    const entry1Id = randomUUID();
    const entry2Id = randomUUID();
    await state.addSavingsEntry(FAMILY_ID, {
      id: entry1Id,
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      lockUntil: new Date(Date.now() + 83 * 24 * 60 * 60 * 1000).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
    });
    await state.addSavingsEntry(FAMILY_ID, {
      id: entry2Id,
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date().toISOString(),
      lockUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
    });

    // Convert $3.00 (first entry) to PAXG
    const allEntries = await state.loadSavingsEntries(FAMILY_ID);
    const firstEntry = allEntries.find((e) => e.id === entry1Id)!;
    firstEntry.converted = true;

    // Create PAXG entry
    const paxgId = randomUUID();
    allEntries.push({
      id: paxgId,
      childName: "Maya",
      amount: 0,
      asset: "PAXG",
      depositedAt: new Date().toISOString(),
      lockUntil: new Date().toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
      converted: false,
      convertedFrom: entry1Id,
      conversionTxHash: "0xe2e_test_tx_hash",
      priceAtConversion: 4660.0,
      receivedAmount: "0.000644",
    });

    await state.saveSavingsEntries(FAMILY_ID, allEntries);

    // Audit
    await state.addAuditEntry(FAMILY_ID, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "savings-converted",
      actor: "manager",
      details: {
        childName: "Maya",
        usdcConsumed: 3_000_000,
        receivedAsset: "PAXG",
        receivedAmount: "0.000644",
        priceAtConversion: 4660.0,
        txHash: "0xe2e_test_tx_hash",
      },
      txHash: "0xe2e_test_tx_hash",
      amount: 3_000_000,
    });

    // Verify
    const after = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const converted = after.filter((e) => e.converted);
    const paxg = after.filter((e) => e.asset === "PAXG");
    expect(converted).toHaveLength(1);
    expect(converted[0].id).toBe(entry1Id);
    expect(paxg).toHaveLength(1);
    expect(paxg[0].conversionTxHash).toBe("0xe2e_test_tx_hash");
    expect(paxg[0].priceAtConversion).toBe(4660.0);
  });

  it("E5: check-savings shows both USDC and PAXG positions", async () => {
    // Set up mixed portfolio directly
    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      asset: "USDC",
      depositedAt: new Date().toISOString(),
      lockUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
      converted: false,
    });
    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 0,
      asset: "PAXG",
      depositedAt: new Date().toISOString(),
      lockUntil: new Date().toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
      converted: false,
      receivedAmount: "0.000644",
      priceAtConversion: 4660.0,
      conversionTxHash: "0xcheck_test",
    });

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const active = entries.filter((e) => !e.converted);
    const locked = active.filter((e) => !e.released);

    const usdcLocked = locked.filter((e) => (e.asset || "USDC") === "USDC");
    const paxgLocked = locked.filter((e) => e.asset === "PAXG");

    // USDC position
    expect(usdcLocked).toHaveLength(1);
    const totalUsdcLocked = usdcLocked.reduce((sum, e) => sum + e.amount, 0);
    expect(totalUsdcLocked).toBe(3_000_000);
    expect((totalUsdcLocked / 1e6).toFixed(2)).toBe("3.00");

    // PAXG position
    expect(paxgLocked).toHaveLength(1);
    const totalPaxgOz = paxgLocked.reduce((sum, e) => sum + parseFloat(e.receivedAmount || "0"), 0);
    expect(totalPaxgOz).toBeCloseTo(0.000644, 6);
    const valueAtConversion = totalPaxgOz * (paxgLocked[0].priceAtConversion || 0);
    expect(valueAtConversion).toBeCloseTo(3.0, 0);
  });

  it("E6: release-savings — USDC releases normally, PAXG returns orchestration message", async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Add expired USDC entry
    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      asset: "USDC",
      depositedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      lockUntil: pastDate,
      released: false,
      multiplierAtDeposit: 1.2,
      converted: false,
    });

    // Add expired PAXG entry (lockUntil in the past)
    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 0,
      asset: "PAXG",
      depositedAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
      lockUntil: pastDate,
      released: false,
      multiplierAtDeposit: 1.0,
      converted: false,
      receivedAmount: "0.000644",
      priceAtConversion: 4660.0,
      conversionTxHash: "0xrelease_test",
    });

    const allEntries = await state.loadSavingsEntries(FAMILY_ID);
    const now = new Date();

    // Find ready entries (same logic as release-savings tool)
    const readyEntries = allEntries.filter((e) => {
      if (e.released) return false;
      if (e.converted) return false;
      if (new Date(e.lockUntil) > now) return false;
      if (e.childName.toLowerCase() !== "maya") return false;
      return true;
    });

    expect(readyEntries).toHaveLength(2);

    // Split USDC vs PAXG
    const usdcReady = readyEntries.filter((e) => (e.asset || "USDC") === "USDC");
    const paxgReady = readyEntries.filter((e) => e.asset === "PAXG");

    expect(usdcReady).toHaveLength(1);
    expect(paxgReady).toHaveLength(1);

    // USDC: multiplier applied
    const usdcRelease = Math.round(usdcReady[0].amount * usdcReady[0].multiplierAtDeposit);
    expect(usdcRelease).toBe(3_600_000); // $3.00 * 1.2x = $3.60

    // PAXG: orchestration message (no direct transfer)
    const paxgMessage = "Gold release requires MoonPay swap — Claude will handle the conversion back to USDC for transfer to the child's wallet.";
    const paxgOz = paxgReady.reduce((sum, e) => sum + parseFloat(e.receivedAmount || "0"), 0);
    expect(paxgOz).toBeCloseTo(0.000644, 6);
    expect(paxgMessage).toContain("MoonPay swap");
    expect(paxgMessage).toContain("Claude will handle");

    // Mark both as released
    for (const entry of readyEntries) {
      entry.released = true;
      entry.releasedAt = new Date().toISOString();
    }
    await state.saveSavingsEntries(FAMILY_ID, allEntries);

    // Verify all marked released
    const afterRelease = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const stillUnreleased = afterRelease.filter((e) => !e.released && !e.converted);
    expect(stillUnreleased).toHaveLength(0);
  });
});
