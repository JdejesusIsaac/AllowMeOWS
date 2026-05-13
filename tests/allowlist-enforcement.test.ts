// Sprint 3.0.2 — Integration tests AL1–AL20 for the destination allowlist.
//
// Tests are organized into 7 groups (A–G) mapped to Sprint Contract
// criteria (see sprint-3.0.2/test-3.0.2.md):
//   A. distribute-allowance enforcement (AL1–AL5)
//   B. release-savings enforcement (AL6, AL7)
//   C. configure-policy auto-populate + force-add (AL8–AL10)
//   D. Decision 3 block-on-removal (AL11–AL14)
//   E. Migration (AL15)
//   F. Audit log completeness (AL16–AL18)
//   G. Edge cases (AL19, AL20)
//
// Strategy:
//   - WalletDistributor is mocked at module level (vi.mock hoists). The
//     spy captures every transferUSDC call; tests assert call-count to
//     verify the allowlist rejection path NEVER reaches the on-chain leg
//     (failure mode F1 + F5 in the Sprint Contract).
//   - configure-policy is exercised through configureFamilyCore directly
//     (faster than going through the MCP tool wrapper, and exercises the
//     exact code path the wrapper delegates to).
//   - distribute-allowance and release-savings are exercised through the
//     extracted handler exports `distributeAllowanceHandler` and
//     `releaseSavingsHandler` (Sprint 3.0.2 Step 6 refactor).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// vi.mock MUST be at the top; hoists above all other imports.
const mockTransferUSDC = vi.fn();
vi.mock("../src/wallet/distributor.js", () => ({
  WalletDistributor: vi.fn().mockImplementation(() => ({
    transferUSDC: mockTransferUSDC,
  })),
}));
// FamilyKeyManager — bypass the real per-family encryption setup.
vi.mock("../src/keys/family-keys.js", () => ({
  FamilyKeyManager: vi.fn().mockImplementation(() => ({
    hasFamilyKey: () => true,
    getFamilyKey: () => "test-passphrase-not-real",
    getOrGenerateFamilyKey: () => "test-passphrase-not-real",
  })),
}));
// WalletSetup.initializeFamily — bypass real wallet creation in bootstrap.
vi.mock("../src/wallet/setup.js", () => ({
  WalletSetup: vi.fn().mockImplementation(() => ({
    initializeFamily: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { StateManager } from "../src/engine/state.js";
import { MemberIndex } from "../src/identity/member-index.js";
import { configureFamilyCore, ConfigureValidationError } from "../src/core/configure-family.js";
import { distributeAllowanceHandler } from "../src/tools/distribute-allowance.js";
import { releaseSavingsHandler } from "../src/tools/release-savings.js";
import { ROLES, USDC, CHAIN_IDS } from "../src/constants.js";
import type {
  AchievementRecord,
  AuditEntry,
  ChildConfig,
  FamilyConfig,
  Member,
  SavingsEntry,
} from "../src/schemas.js";

// Canonical lowercased addresses used across tests. ADMIN/CHILD1/CHILD2/ATTACK
// must all be valid EVM addresses to avoid `malformed-address` rejections
// in unrelated tests.
const ADMIN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CHILD1 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CHILD2 = "0xcccccccccccccccccccccccccccccccccccccccc";
const ATTACK = "0xdddddddddddddddddddddddddddddddddddddddd";
// EIP-55-cased version of a real valid address (Vitalik's) — exercises
// case-insensitive comparison in AL20.
const CHILD1_CHECKSUM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const CHILD1_LOWER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";

const testDataDir = join(process.cwd(), "data");

// -------------------- helpers ---------------------------------------------

function makeChild(name: string, walletAddress: string, weeklyBudgetUsd = 10): ChildConfig {
  const weeklyBudget = weeklyBudgetUsd * 10 ** USDC.DECIMALS;
  return {
    name,
    walletName: `child-${name.toLowerCase()}`,
    walletAddress,
    weeklyBudget,
    categories: [{ name: "general", pct: 100, budget: weeklyBudget }],
    savingsPercent: 20,
    savingsLockDays: 90,
  };
}

async function seedFamily(opts: {
  state: StateManager;
  index: MemberIndex;
  familyId: string;
  children: ChildConfig[];
  authorizedDestinations: string[];
  managerWalletAddress?: string;
}): Promise<{ memberId: string }> {
  await opts.state.createFamilyDir(opts.familyId);
  const now = new Date().toISOString();
  const config: FamilyConfig = {
    familyId: opts.familyId,
    familyName: "Test Family",
    children: opts.children,
    createdAt: now,
    updatedAt: now,
    chainId: CHAIN_IDS.BASE_SEPOLIA,
    usdcAddress: USDC.BASE_SEPOLIA,
    authorizedDestinations: opts.authorizedDestinations,
  };
  await opts.state.saveFamilyConfig(opts.familyId, config);

  const memberId = randomUUID();
  const member: Member = {
    id: memberId,
    name: "Manager",
    role: ROLES.MANAGER,
    walletAddress: opts.managerWalletAddress,
    joinedAt: now,
    active: true,
  };
  await opts.state.addMember(opts.familyId, member);
  await opts.index.set(memberId, opts.familyId, ROLES.MANAGER);
  for (const child of opts.children) {
    await opts.state.initializeStreak(opts.familyId, child.name);
  }
  return { memberId };
}

function makeAchievement(childName: string, amountUsd: number): AchievementRecord {
  return {
    id: randomUUID(),
    childName,
    title: "Test achievement",
    description: "Test",
    category: "general",
    amount: Math.round(amountUsd * 10 ** USDC.DECIMALS),
    verifiedBy: "system",
    verifiedAt: new Date().toISOString(),
    distributed: false,
    source: "manual",
  };
}

function makeSavings(opts: {
  id?: string;
  childName: string;
  amountUsd: number;
  released?: boolean;
  converted?: boolean;
  lockUntil?: string;
}): SavingsEntry {
  return {
    id: opts.id ?? randomUUID(),
    childName: opts.childName,
    amount: Math.round(opts.amountUsd * 10 ** USDC.DECIMALS),
    asset: "USDC",
    depositedAt: "2024-01-01T00:00:00.000Z",
    lockUntil: opts.lockUntil ?? "2024-04-01T00:00:00.000Z", // long past — matured
    released: opts.released ?? false,
    multiplierAtDeposit: 1.0,
    converted: opts.converted ?? false,
  };
}

function parseResponse(r: { content: Array<{ text: string }> }): any {
  return JSON.parse(r.content[0].text);
}

function findAuditEntries(entries: AuditEntry[], action: string): AuditEntry[] {
  return entries.filter((e) => e.action === action);
}

// -------------------- test scaffolding ------------------------------------

beforeEach(async () => {
  await rm(testDataDir, { recursive: true, force: true });
  await mkdir(testDataDir, { recursive: true });
  mockTransferUSDC.mockReset();
  mockTransferUSDC.mockResolvedValue({ txHash: "0xfaketxhash" });
});

afterEach(async () => {
  await rm(testDataDir, { recursive: true, force: true });
});

// =============================================================================
// Group A — distribute-allowance enforcement (AL1–AL5)
// =============================================================================

describe("AL Group A — distribute-allowance enforcement", () => {
  it("AL1: distribute to allowlisted child wallet succeeds", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", CHILD1);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [ADMIN, CHILD1],
    });
    await state.addAchievement(familyId, makeAchievement("Elina", 5));

    const response = await distributeAllowanceHandler({
      dryRun: false,
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    });
    const result = parseResponse(response);

    expect(result.success).toBe(true);
    expect(result.distributions).toHaveLength(1);
    expect(result.distributions[0].rejectedReason).toBeUndefined();
    expect(result.distributions[0].txHash).toBe("0xfaketxhash");
    // Child leg + savings vault leg both call transferUSDC.
    expect(mockTransferUSDC).toHaveBeenCalled();
    // Audit log: no rejection entry.
    const audit = await state.loadAuditLog(familyId);
    expect(findAuditEntries(audit, "transfer-rejected-by-allowlist")).toHaveLength(0);
  });

  it("AL2: distribute to non-allowlisted destination rejects with no on-chain call (F1, F5)", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    // Tamper: child's walletAddress is ATTACK, but allowlist only contains CHILD1.
    const child = makeChild("Elina", ATTACK);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [ADMIN, CHILD1],
    });
    await state.addAchievement(familyId, makeAchievement("Elina", 5));

    const response = await distributeAllowanceHandler({
      dryRun: false,
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    });
    const result = parseResponse(response);

    expect(result.success).toBe(true); // tool succeeds but the per-child entry is rejected
    expect(result.distributions[0].rejectedReason).toBe("not-in-allowlist");
    expect(result.distributions[0].attemptedDestination).toBe(ATTACK);
    expect(result.distributions[0].txHash).toBeUndefined();
    // Crucial: transferUSDC must NOT have been called.
    expect(mockTransferUSDC).not.toHaveBeenCalled();
    // Audit log records the rejection.
    const audit = await state.loadAuditLog(familyId);
    const rejections = findAuditEntries(audit, "transfer-rejected-by-allowlist");
    expect(rejections).toHaveLength(1);
    expect(rejections[0].details.attemptedDestination).toBe(ATTACK);
    expect(rejections[0].details.childName).toBe("Elina");
    expect(rejections[0].details.tool).toBe("distribute-allowance");
  });

  it("AL3: savings-vault leg is exempt from the allowlist check (F1)", async () => {
    // Allowlist contains ONLY CHILD1 (no ADMIN, no vault address). The
    // savings-vault leg must still execute — it's exempt by construction.
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = { ...makeChild("Elina", CHILD1), savingsPercent: 50 };
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [CHILD1],
    });
    await state.addAchievement(familyId, makeAchievement("Elina", 10));

    const response = await distributeAllowanceHandler({
      dryRun: false,
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    });
    const result = parseResponse(response);

    expect(result.success).toBe(true);
    // Both legs must have fired (child + savings vault).
    expect(mockTransferUSDC).toHaveBeenCalledTimes(2);
    expect(result.distributions[0].savingsTxHash).toBeDefined();
    expect(result.distributions[0].txHash).toBeDefined();
    // No audit rejection.
    const audit = await state.loadAuditLog(familyId);
    expect(findAuditEntries(audit, "transfer-rejected-by-allowlist")).toHaveLength(0);
  });

  it("AL4: multi-child — one rejection does not stop other children's distributions", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const childA = makeChild("Elina", CHILD1); // allowlisted
    const childB = makeChild("Sofia", ATTACK); // NOT allowlisted
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [childA, childB],
      authorizedDestinations: [ADMIN, CHILD1],
    });
    await state.addAchievement(familyId, makeAchievement("Elina", 5));
    await state.addAchievement(familyId, makeAchievement("Sofia", 5));

    const response = await distributeAllowanceHandler({
      dryRun: false,
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    });
    const result = parseResponse(response);

    expect(result.success).toBe(true);
    expect(result.distributions).toHaveLength(2);
    const byName = Object.fromEntries(
      result.distributions.map((d: any) => [d.childName, d])
    );
    expect(byName.Elina.rejectedReason).toBeUndefined();
    expect(byName.Elina.txHash).toBe("0xfaketxhash");
    expect(byName.Sofia.rejectedReason).toBe("not-in-allowlist");
    expect(byName.Sofia.txHash).toBeUndefined();
    // Audit: exactly one rejection (for Sofia).
    const audit = await state.loadAuditLog(familyId);
    const rejections = findAuditEntries(audit, "transfer-rejected-by-allowlist");
    expect(rejections).toHaveLength(1);
    expect(rejections[0].details.childName).toBe("Sofia");
  });

  it("AL5: dry-run never calls transferUSDC even with tampered destination", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", ATTACK);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [CHILD1],
    });
    await state.addAchievement(familyId, makeAchievement("Elina", 5));

    const response = await distributeAllowanceHandler({
      dryRun: true,
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    });
    const result = parseResponse(response);

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    // No on-chain calls in dry-run regardless of allowlist state.
    expect(mockTransferUSDC).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Group B — release-savings enforcement (AL6, AL7)
// =============================================================================

describe("AL Group B — release-savings enforcement", () => {
  it("AL6: release to allowlisted destination succeeds and marks entries released", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", CHILD1);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [ADMIN, CHILD1],
    });
    await state.saveSavingsEntries(familyId, [
      makeSavings({ id: "e1", childName: "Elina", amountUsd: 5 }),
    ]);

    const response = await releaseSavingsHandler({
      dryRun: false,
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    });
    const result = parseResponse(response);

    expect(result.success).toBe(true);
    expect(result.released).toBe(1);
    expect(mockTransferUSDC).toHaveBeenCalledTimes(1);
    const entries = await state.loadSavingsEntries(familyId);
    expect(entries[0].released).toBe(true);
  });

  it("AL7: release to non-allowlisted destination rejects, entries remain locked (F5)", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", ATTACK); // tampered
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [CHILD1],
    });
    await state.saveSavingsEntries(familyId, [
      makeSavings({ id: "e1", childName: "Elina", amountUsd: 5 }),
      makeSavings({ id: "e2", childName: "Elina", amountUsd: 7 }),
    ]);

    const response = await releaseSavingsHandler({
      dryRun: false,
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    });
    const result = parseResponse(response);

    expect(result.success).toBe(true);
    expect(result.distributions[0].rejectedReason).toBe("not-in-allowlist");
    // transferUSDC was not called.
    expect(mockTransferUSDC).not.toHaveBeenCalled();
    // Entries remain locked.
    const entries = await state.loadSavingsEntries(familyId);
    expect(entries.every((e) => e.released === false)).toBe(true);
    // Audit entry records affected entry IDs and the "locked" note.
    const audit = await state.loadAuditLog(familyId);
    const rejections = findAuditEntries(audit, "transfer-rejected-by-allowlist");
    expect(rejections).toHaveLength(1);
    expect(rejections[0].details.tool).toBe("release-savings");
    expect(rejections[0].details.affectedEntryIds).toEqual(
      expect.arrayContaining(["e1", "e2"])
    );
    expect(String(rejections[0].details.note)).toContain("locked");
  });
});

// =============================================================================
// Group C — configure-policy auto-populate + force-add (AL8–AL10)
// =============================================================================

describe("AL Group C — configure-policy auto-populate + force-add", () => {
  it("AL8: bootstrap auto-populates from admin + child wallets", async () => {
    const state = new StateManager();
    const child1 = makeChild("Elina", CHILD1);
    const child2 = makeChild("Sofia", CHILD2);
    const result = await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [child1, child2],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        managerWalletAddress: ADMIN,
      },
      null // bootstrap path
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const config = await state.loadFamilyConfig(result.familyId);
    expect(config?.authorizedDestinations).toEqual(
      expect.arrayContaining([ADMIN, CHILD1, CHILD2])
    );
    expect(config?.authorizedDestinations).toHaveLength(3);
    const audit = await state.loadAuditLog(result.familyId);
    const entries = findAuditEntries(audit, "authorized-destinations-updated");
    expect(entries).toHaveLength(1);
    expect(entries[0].details.bootstrap).toBe(true);
  });

  it("AL9: update force-adds caller's wallet even if explicitly omitted (F2)", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", CHILD1);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [ADMIN, CHILD1],
      managerWalletAddress: ADMIN,
    });

    const result = await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [child],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        // Explicitly omit ADMIN — but it should still be force-added.
        authorizedDestinations: [CHILD1],
      },
      { role: ROLES.MANAGER, memberId, familyId }
    );
    expect(result.ok).toBe(true);
    const config = await state.loadFamilyConfig(familyId);
    expect(config?.authorizedDestinations).toEqual(
      expect.arrayContaining([ADMIN, CHILD1])
    );
    expect(config?.authorizedDestinations).toHaveLength(2);
  });

  it("AL10: invalid address in input throws ConfigureValidationError", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", CHILD1);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [ADMIN, CHILD1],
      managerWalletAddress: ADMIN,
    });

    await expect(
      configureFamilyCore(
        {
          familyName: "TestFam",
          children: [child],
          chainId: CHAIN_IDS.BASE_SEPOLIA,
          usdcAddress: USDC.BASE_SEPOLIA,
          useTestnet: true,
          authorizedDestinations: [ADMIN, "not-an-address"],
        },
        { role: ROLES.MANAGER, memberId, familyId }
      )
    ).rejects.toBeInstanceOf(ConfigureValidationError);

    // Family config unchanged.
    const config = await state.loadFamilyConfig(familyId);
    expect(config?.authorizedDestinations).toEqual([ADMIN, CHILD1]);
  });
});

// =============================================================================
// Group D — Decision 3 block-on-removal (AL11–AL14)
// =============================================================================

describe("AL Group D — Decision 3 block-on-removal", () => {
  it("AL11: removing child wallet with unreleased savings throws with affected info (F3, F5)", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", CHILD1);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [ADMIN, CHILD1],
      managerWalletAddress: ADMIN,
    });
    await state.saveSavingsEntries(familyId, [
      makeSavings({ id: "s1", childName: "Elina", amountUsd: 3 }),
    ]);

    // Attempt to remove CHILD1 from the allowlist (admin only).
    const err = await configureFamilyCore(
      {
        familyName: "TestFam",
        // Important: remove CHILD1 from the child config too, otherwise
        // the force-add behaviour re-adds it.
        children: [{ ...child, walletAddress: undefined }],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        authorizedDestinations: [ADMIN],
      },
      { role: ROLES.MANAGER, memberId, familyId }
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ConfigureValidationError);
    const cve = err as ConfigureValidationError;
    expect(cve.kind).toBe("removal-blocked");
    expect(cve.affected).toHaveLength(1);
    expect(cve.affected![0].address).toBe(CHILD1);
    expect(cve.affected![0].childName).toBe("Elina");
    expect(cve.affected![0].entryIds).toEqual(["s1"]);
    // Audit entry recorded.
    const audit = await state.loadAuditLog(familyId);
    expect(
      findAuditEntries(audit, "authorized-destinations-removal-blocked")
    ).toHaveLength(1);
    // Family config unchanged.
    const config = await state.loadFamilyConfig(familyId);
    expect(config?.authorizedDestinations).toEqual([ADMIN, CHILD1]);
  });

  it("AL12: released entries do not block removal (F3)", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", CHILD1);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [ADMIN, CHILD1],
      managerWalletAddress: ADMIN,
    });
    await state.saveSavingsEntries(familyId, [
      makeSavings({ id: "s1", childName: "Elina", amountUsd: 3, released: true }),
    ]);

    const result = await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [{ ...child, walletAddress: undefined }],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        authorizedDestinations: [ADMIN],
      },
      { role: ROLES.MANAGER, memberId, familyId }
    );
    expect(result.ok).toBe(true);
    const config = await state.loadFamilyConfig(familyId);
    expect(config?.authorizedDestinations).toEqual([ADMIN]);
  });

  it("AL13: converted entries do not block removal (F3 off-by-one)", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", CHILD1);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [ADMIN, CHILD1],
      managerWalletAddress: ADMIN,
    });
    await state.saveSavingsEntries(familyId, [
      // converted but NOT released — critical edge case.
      makeSavings({ id: "s1", childName: "Elina", amountUsd: 3, released: false, converted: true }),
    ]);

    const result = await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [{ ...child, walletAddress: undefined }],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        authorizedDestinations: [ADMIN],
      },
      { role: ROLES.MANAGER, memberId, familyId }
    );
    expect(result.ok).toBe(true);
  });

  it("AL14: multi-child block lists ALL affected children, not just first", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const childA = makeChild("Elina", CHILD1);
    const childB = makeChild("Sofia", CHILD2);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [childA, childB],
      authorizedDestinations: [ADMIN, CHILD1, CHILD2],
      managerWalletAddress: ADMIN,
    });
    await state.saveSavingsEntries(familyId, [
      makeSavings({ id: "s1", childName: "Elina", amountUsd: 3 }),
      makeSavings({ id: "s2", childName: "Sofia", amountUsd: 5 }),
    ]);

    const err = await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [
          { ...childA, walletAddress: undefined },
          { ...childB, walletAddress: undefined },
        ],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        authorizedDestinations: [ADMIN],
      },
      { role: ROLES.MANAGER, memberId, familyId }
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ConfigureValidationError);
    const cve = err as ConfigureValidationError;
    expect(cve.affected).toHaveLength(2);
    const affectedNames = (cve.affected ?? []).map((a) => a.childName).sort();
    expect(affectedNames).toEqual(["Elina", "Sofia"]);
  });
});

// =============================================================================
// Group E — Migration (AL15)
// =============================================================================

describe("AL Group E — pre-3.0.2 fixture migration", () => {
  it("AL15: pre-3.0.2 family without authorizedDestinations parses; update auto-populates", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    await state.createFamilyDir(familyId);
    const child = makeChild("Elina", CHILD1);
    // Write a pre-3.0.2-shaped config directly — no authorizedDestinations field.
    const legacyConfig = {
      familyId,
      familyName: "LegacyFam",
      children: [child],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      chainId: CHAIN_IDS.BASE_SEPOLIA,
      usdcAddress: USDC.BASE_SEPOLIA,
    };
    // Use saveFamilyConfig which round-trips through schema validation; if
    // the Zod default works, the field will get `[]`.
    await state.saveFamilyConfig(familyId, legacyConfig as any);
    const loaded = await state.loadFamilyConfig(familyId);
    expect(loaded?.authorizedDestinations).toEqual([]);

    // Register the manager so the update path can find a caller.
    const memberId = randomUUID();
    await state.addMember(familyId, {
      id: memberId,
      name: "Manager",
      role: ROLES.MANAGER,
      walletAddress: ADMIN,
      joinedAt: "2024-01-01T00:00:00.000Z",
      active: true,
    });
    await index.set(memberId, familyId, ROLES.MANAGER);

    // Trigger an update — the helper auto-populates.
    const result = await configureFamilyCore(
      {
        familyName: "LegacyFam",
        children: [child],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
      },
      { role: ROLES.MANAGER, memberId, familyId }
    );
    expect(result.ok).toBe(true);

    const reloaded = await state.loadFamilyConfig(familyId);
    expect(reloaded?.authorizedDestinations).toEqual(
      expect.arrayContaining([ADMIN, CHILD1])
    );
    const audit = await state.loadAuditLog(familyId);
    expect(findAuditEntries(audit, "authorized-destinations-updated")).toHaveLength(1);
  });
});

// =============================================================================
// Group F — Audit log completeness (AL16–AL18)
// =============================================================================

describe("AL Group F — audit log completeness (F5)", () => {
  it("AL16: distribute-allowance rejection produces a transfer-rejected-by-allowlist audit entry", async () => {
    // Redundant with AL2's audit assertion — kept as explicit decoupled
    // F5 coverage so a refactor that breaks the audit write surfaces here.
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", ATTACK);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [CHILD1],
    });
    await state.addAchievement(familyId, makeAchievement("Elina", 5));
    await distributeAllowanceHandler({
      dryRun: false,
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    });
    const audit = await state.loadAuditLog(familyId);
    expect(findAuditEntries(audit, "transfer-rejected-by-allowlist")).toHaveLength(1);
  });

  it("AL17: authorized-destinations-updated emitted on every list change", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    // Bootstrap (1st entry).
    const bootstrap = await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [makeChild("Elina", CHILD1)],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        managerWalletAddress: ADMIN,
      },
      null
    );
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) throw new Error("unreachable");
    const familyId = bootstrap.familyId;
    const memberId = bootstrap.bootstrap ? bootstrap.memberId : "";

    // Update 1: add a new external destination (2nd entry).
    await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [makeChild("Elina", CHILD1)],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        authorizedDestinations: [ADMIN, CHILD1, ATTACK],
      },
      { role: ROLES.MANAGER, memberId, familyId }
    );

    // Update 2: remove ATTACK (3rd entry — no unreleased savings, so allowed).
    await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [makeChild("Elina", CHILD1)],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        authorizedDestinations: [ADMIN, CHILD1],
      },
      { role: ROLES.MANAGER, memberId, familyId }
    );

    const audit = await state.loadAuditLog(familyId);
    const updates = findAuditEntries(audit, "authorized-destinations-updated");
    expect(updates).toHaveLength(3);
    // 2nd update added ATTACK.
    expect(updates[1].details.added).toContain(ATTACK);
    // 3rd update removed ATTACK.
    expect(updates[2].details.removed).toContain(ATTACK);
  });

  it("AL18: authorized-destinations-removal-blocked emitted on block", async () => {
    // Redundant with AL11's audit assertion — explicit F5 coverage.
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", CHILD1);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [ADMIN, CHILD1],
      managerWalletAddress: ADMIN,
    });
    await state.saveSavingsEntries(familyId, [
      makeSavings({ childName: "Elina", amountUsd: 3 }),
    ]);
    await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [{ ...child, walletAddress: undefined }],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        authorizedDestinations: [ADMIN],
      },
      { role: ROLES.MANAGER, memberId, familyId }
    ).catch(() => undefined);
    const audit = await state.loadAuditLog(familyId);
    expect(
      findAuditEntries(audit, "authorized-destinations-removal-blocked")
    ).toHaveLength(1);
  });
});

// =============================================================================
// Group G — Edge cases (AL19, AL20)
// =============================================================================

describe("AL Group G — edge cases", () => {
  it("AL19: empty authorized list rejects all distributions (F2)", async () => {
    const state = new StateManager();
    const index = new MemberIndex();
    const familyId = randomUUID();
    const child = makeChild("Elina", CHILD1);
    const { memberId } = await seedFamily({
      state, index, familyId,
      children: [child],
      authorizedDestinations: [], // empty allowlist
    });
    await state.addAchievement(familyId, makeAchievement("Elina", 5));

    const response = await distributeAllowanceHandler({
      dryRun: false,
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    });
    const result = parseResponse(response);
    expect(result.distributions[0].rejectedReason).toBe("allowlist-empty");
    expect(mockTransferUSDC).not.toHaveBeenCalled();
  });

  it("AL20: EIP-55 checksum-cased input accepted, stored lowercase (F4)", async () => {
    const state = new StateManager();
    const result = await configureFamilyCore(
      {
        familyName: "TestFam",
        children: [makeChild("Elina", CHILD1_CHECKSUM)],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
        managerWalletAddress: ADMIN,
      },
      null
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const config = await state.loadFamilyConfig(result.familyId);
    // Stored lowercase, regardless of input case.
    expect(config?.authorizedDestinations).toContain(CHILD1_LOWER);
    expect(config?.authorizedDestinations).not.toContain(CHILD1_CHECKSUM);
  });
});
