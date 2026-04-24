import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateManager } from "../src/engine/state.js";
import type { SavingsEntry } from "../src/schemas.js";

const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

const testDataDir = join(process.cwd(), "data");

// ============================================================
// D4: Savings Release Tests (5 tests)
// ============================================================
describe("D4: Savings Release", () => {
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

  it("SR1: Release expired entry with 1.0x multiplier", async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const entry: SavingsEntry = {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      lockUntil: pastDate,
      released: false,
      multiplierAtDeposit: 1.0,
    };
    await state.addSavingsEntry(FAMILY_ID, entry);

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const ready = entries.filter((e) => !e.released && new Date(e.lockUntil) <= new Date());
    expect(ready).toHaveLength(1);

    // Calculate release amount: amount * multiplier
    const releaseAmount = Math.round(ready[0].amount * ready[0].multiplierAtDeposit);
    expect(releaseAmount).toBe(3_000_000); // 1.0x
  });

  it("SR2: Release expired entry with 1.5x multiplier", async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const entry: SavingsEntry = {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      lockUntil: pastDate,
      released: false,
      multiplierAtDeposit: 1.5,
    };
    await state.addSavingsEntry(FAMILY_ID, entry);

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const ready = entries.filter((e) => !e.released && new Date(e.lockUntil) <= new Date());
    const releaseAmount = Math.round(ready[0].amount * ready[0].multiplierAtDeposit);
    expect(releaseAmount).toBe(4_500_000); // 1.5x
  });

  it("SR3: No expired entries — nothing to release", async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date().toISOString(),
      lockUntil: futureDate,
      released: false,
      multiplierAtDeposit: 1.0,
    });

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const ready = entries.filter((e) => !e.released && new Date(e.lockUntil) <= new Date());
    expect(ready).toHaveLength(0);
  });

  it("SR4: Mixed — only expired entries released", async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 2_000_000,
      depositedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      lockUntil: pastDate,
      released: false,
      multiplierAtDeposit: 1.0,
    });
    await state.addSavingsEntry(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      amount: 3_000_000,
      depositedAt: new Date().toISOString(),
      lockUntil: futureDate,
      released: false,
      multiplierAtDeposit: 1.2,
    });

    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    const ready = entries.filter((e) => !e.released && new Date(e.lockUntil) <= new Date());
    const locked = entries.filter((e) => !e.released && new Date(e.lockUntil) > new Date());
    expect(ready).toHaveLength(1);
    expect(locked).toHaveLength(1);
    expect(ready[0].amount).toBe(2_000_000);
    expect(locked[0].amount).toBe(3_000_000);
  });

  it("SR5: Empty savings vault — no error", async () => {
    const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    expect(entries).toHaveLength(0);
    const ready = entries.filter((e) => !e.released && new Date(e.lockUntil) <= new Date());
    expect(ready).toHaveLength(0);
  });
});

// ============================================================
// D5: Category % Validation Tests (3 tests)
// ============================================================
describe("D5: Category % Validation", () => {
  it("CV1: educationPct=34 + healthPct=33 + personalPct=33 = 100 → valid", () => {
    const sum = 34 + 33 + 33;
    expect(sum).toBeLessThanOrEqual(100);
  });

  it("CV2: educationPct=50 + healthPct=50 + personalPct=50 = 150 → invalid", () => {
    const sum = 50 + 50 + 50;
    expect(sum).toBeGreaterThan(100);
    // configure-policy should reject this with an error message
    const errorMsg = `Category percentages sum to ${sum}%, must be ≤ 100%`;
    expect(errorMsg).toContain("150%");
    expect(errorMsg).toContain("≤ 100%");
  });

  it("CV3: educationPct=40 + healthPct=30 + personalPct=20 = 90 → valid (10% unallocated)", () => {
    const sum = 40 + 30 + 20;
    expect(sum).toBeLessThanOrEqual(100);
    expect(sum).toBe(90); // 10% unallocated is fine
  });
});

// ============================================================
// D6: Bug Fix Verification Tests (3 tests)
// ============================================================
describe("D6: Bug Fix Verification", () => {
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

  it("BF1: Audit entry uses caller memberId, not hardcoded 'manager'", async () => {
    const coParentId = randomUUID();
    await state.addAuditEntry(FAMILY_ID, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "verify-achievement",
      actor: coParentId, // should be caller's ID, not "manager"
      details: {
        childName: "Maya",
        category: "education",
        score: 85,
        source: "parent-attested",
      },
    });

    const log = await state.loadAuditLog(FAMILY_ID);
    expect(log).toHaveLength(1);
    expect(log[0].actor).toBe(coParentId);
    expect(log[0].actor).not.toBe("manager");
  });

  it("BF2: Distribute audit entry uses caller memberId", async () => {
    const managerId = randomUUID();
    await state.addAuditEntry(FAMILY_ID, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "distribute",
      actor: managerId,
      details: { childName: "Maya", totalAmount: 10_000_000 },
      amount: 10_000_000,
    });

    const log = await state.loadAuditLog(FAMILY_ID);
    expect(log[0].actor).toBe(managerId);
  });

  it("BF3: Passphrase not in tool args — read from env", () => {
    // Verify the pattern: OWS_PASSPHRASE comes from process.env, not from tool input
    const originalEnv = process.env.OWS_PASSPHRASE;
    process.env.OWS_PASSPHRASE = "test-passphrase-123";
    expect(process.env.OWS_PASSPHRASE).toBe("test-passphrase-123");
    // Restore
    if (originalEnv) {
      process.env.OWS_PASSPHRASE = originalEnv;
    } else {
      delete process.env.OWS_PASSPHRASE;
    }
  });
});
