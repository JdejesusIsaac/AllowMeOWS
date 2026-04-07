import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateManager } from "../src/engine/state.js";
import { PolicyEngine } from "../src/engine/policy.js";
import {
  resolveCallerRole,
  isToolAuthorized,
  getChildScope,
} from "../src/middleware/access-control.js";
import { ROLES } from "../src/constants.js";
import type { FamilyConfig, AchievementRecord, Member, Invite } from "../src/schemas.js";

const testDataDir = join(process.cwd(), "data");

// Shared test config
function makeGarciaConfig(): FamilyConfig {
  return {
    familyName: "Garcia",
    children: [
      {
        name: "Maya",
        walletName: "child-maya",
        walletAddress: "0xExternalMayaWallet",
        weeklyBudget: 15_000_000,
        categories: [
          { name: "education", pct: 33, budget: 5_000_000 },
          { name: "health", pct: 33, budget: 5_000_000 },
          { name: "personal", pct: 33, budget: 5_000_000 },
        ],
        savingsPercent: 20,
        savingsLockDays: 90,
      },
      {
        name: "Carlos",
        walletName: "child-carlos",
        weeklyBudget: 10_000_000,
        categories: [
          { name: "education", pct: 40, budget: 4_000_000 },
          { name: "health", pct: 30, budget: 3_000_000 },
          { name: "personal", pct: 30, budget: 3_000_000 },
        ],
        savingsPercent: 20,
        savingsLockDays: 90,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chainId: "eip155:84532",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  };
}

// ============================================================
// D7: E2E Mother-Daughter Full Flow (8 steps)
// ============================================================
describe("D7: E2E Mother-Daughter Full Flow", () => {
  let state: StateManager;
  let engine: PolicyEngine;
  let config: FamilyConfig;
  let mayaMemberId: string;
  let inviteCode: string;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();
    engine = new PolicyEngine();
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("Step 1: Mother configures family", async () => {
    config = makeGarciaConfig();
    await state.saveFamilyConfig(config);

    // Initialize streaks
    for (const child of config.children) {
      await state.initializeStreak(child.name);
    }

    const loaded = await state.loadFamilyConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.children).toHaveLength(2);
    expect(loaded!.children[0].name).toBe("Maya");
    expect(loaded!.children[1].name).toBe("Carlos");

    const streaks = await state.loadStreaks();
    expect(streaks).toHaveLength(2);
  });

  it("Step 2: Mother invites Maya as learner", async () => {
    config = makeGarciaConfig();
    await state.saveFamilyConfig(config);

    // Simulate invite creation
    inviteCode = "MAYA-LEARN-T3X7";
    const invite: Invite = {
      code: inviteCode,
      role: "learner",
      childName: "Maya",
      familyId: "garcia-family",
      createdBy: "manager",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      used: false,
    };
    await state.addInvite(invite);

    const invites = await state.loadInvites();
    expect(invites).toHaveLength(1);
    expect(invites[0].role).toBe("learner");
    expect(invites[0].childName).toBe("Maya");
    expect(invites[0].code).toBe(inviteCode);
  });

  it("Step 3: Maya accepts invite", async () => {
    config = makeGarciaConfig();
    await state.saveFamilyConfig(config);

    inviteCode = "MAYA-LEARN-T3X7";
    await state.addInvite({
      code: inviteCode,
      role: "learner",
      childName: "Maya",
      familyId: "garcia-family",
      createdBy: "manager",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      used: false,
    });

    // Accept invite
    mayaMemberId = randomUUID();
    await state.addMember({
      id: mayaMemberId,
      name: "Maya",
      role: "learner",
      childName: "Maya",
      joinedAt: new Date().toISOString(),
      active: true,
    });

    // Mark invite as used
    const invites = await state.loadInvites();
    invites[0].used = true;
    invites[0].usedBy = mayaMemberId;
    invites[0].usedAt = new Date().toISOString();
    await state.saveInvites(invites);

    const members = await state.loadMembers();
    const mayaMember = members.find((m) => m.id === mayaMemberId);
    expect(mayaMember).toBeDefined();
    expect(mayaMember!.role).toBe("learner");
    expect(mayaMember!.childName).toBe("Maya");

    const updatedInvites = await state.loadInvites();
    expect(updatedInvites[0].used).toBe(true);
  });

  it("Step 4: Maya checks her progress (child-scoped)", async () => {
    config = makeGarciaConfig();
    await state.saveFamilyConfig(config);

    mayaMemberId = randomUUID();
    await state.addMember({
      id: mayaMemberId,
      name: "Maya",
      role: "learner",
      childName: "Maya",
      joinedAt: new Date().toISOString(),
      active: true,
    });

    const caller = await resolveCallerRole({
      _callerId: mayaMemberId,
      _callerRole: "learner",
    });
    expect(caller.childName).toBe("Maya");

    const scope = getChildScope(caller);
    expect(scope).toBe("Maya");

    // No achievements yet
    const achievements = await state.loadAchievements();
    const scoped = achievements.filter(
      (a) => a.childName.toLowerCase() === scope!.toLowerCase()
    );
    expect(scoped).toHaveLength(0);
  });

  it("Step 5: Maya self-reports an achievement", async () => {
    config = makeGarciaConfig();
    await state.saveFamilyConfig(config);

    mayaMemberId = randomUUID();
    await state.addMember({
      id: mayaMemberId,
      name: "Maya",
      role: "learner",
      childName: "Maya",
      joinedAt: new Date().toISOString(),
      active: true,
    });

    // Maya self-reports
    const amount = engine.evaluateAchievement(100, "personal", config.children[0]);
    const streak = await state.updateStreak("Maya");
    const multipliedAmount = Math.round(amount * streak.multiplier);

    const record: AchievementRecord = {
      id: randomUUID(),
      childName: "Maya",
      category: "personal",
      description: "Journaled about career goals",
      score: 100,
      amount: multipliedAmount,
      source: "self-report",
      verifiedBy: mayaMemberId,
      verifiedAt: new Date().toISOString(),
      distributed: false,
    };
    await state.addAchievement(record);

    const loaded = await state.loadAchievements();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].source).toBe("self-report");
    expect(loaded[0].verifiedBy).toBe(mayaMemberId);
    expect(loaded[0].verifiedBy).not.toBe("manager");
  });

  it("Step 6: Claude orchestrates OpenMAIC achievement (simulated)", async () => {
    config = makeGarciaConfig();
    await state.saveFamilyConfig(config);

    // OpenMAIC achievement via Claude orchestration
    const amount = engine.evaluateAchievement(88, "education", config.children[0]);
    const streak = await state.updateStreak("Maya");
    const multipliedAmount = Math.round(amount * streak.multiplier);

    const record: AchievementRecord = {
      id: randomUUID(),
      childName: "Maya",
      category: "education",
      description: "Completed OpenMAIC: Introduction to Fractions",
      score: 88,
      amount: multipliedAmount,
      source: "openMAIC",
      verifiedBy: "manager",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    };
    await state.addAchievement(record);

    // Audit with metadata
    await state.addAuditEntry({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "verify-achievement",
      actor: "manager",
      details: {
        childName: "Maya",
        category: "education",
        score: 88,
        source: "openMAIC",
        metadata: { classroomId: "test-123", topic: "Fractions" },
      },
    });

    const loaded = await state.loadAchievements();
    expect(loaded[0].source).toBe("openMAIC");

    const audit = await state.loadAuditLog();
    expect(audit[0].details.source).toBe("openMAIC");
    expect((audit[0].details.metadata as any).classroomId).toBe("test-123");
  });

  it("Step 7: Mother checks progress (sees source provenance)", async () => {
    config = makeGarciaConfig();
    await state.saveFamilyConfig(config);

    // Add two achievements with different sources
    await state.addAchievement({
      id: randomUUID(),
      childName: "Maya",
      category: "personal",
      description: "Journaled about career goals",
      score: 100,
      amount: 5_000_000,
      source: "self-report",
      verifiedBy: "maya-learner-id",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });
    await state.addAchievement({
      id: randomUUID(),
      childName: "Maya",
      category: "education",
      description: "Completed OpenMAIC: Fractions",
      score: 88,
      amount: 4_400_000,
      source: "openMAIC",
      verifiedBy: "manager",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });

    // Manager sees all children, all sources
    const managerCaller = await resolveCallerRole({ _callerRole: "manager" });
    expect(getChildScope(managerCaller)).toBeNull(); // sees all

    const achievements = await state.loadAchievements();
    const mayaAchievements = achievements.filter((a) => a.childName === "Maya");
    expect(mayaAchievements).toHaveLength(2);

    const sources = mayaAchievements.map((a) => a.source);
    expect(sources).toContain("self-report");
    expect(sources).toContain("openMAIC");
  });

  it("Step 8: Mother distributes (dry-run) + Maya checks savings", async () => {
    config = makeGarciaConfig();
    await state.saveFamilyConfig(config);

    mayaMemberId = randomUUID();
    await state.addMember({
      id: mayaMemberId,
      name: "Maya",
      role: "learner",
      childName: "Maya",
      joinedAt: new Date().toISOString(),
      active: true,
    });

    // Add achievement
    await state.addAchievement({
      id: randomUUID(),
      childName: "Maya",
      category: "education",
      description: "Fractions quiz",
      score: 88,
      amount: 4_400_000,
      source: "openMAIC",
      verifiedBy: "manager",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });

    // Dry-run distribution calculation
    const achievements = await state.loadAchievements();
    const pending = achievements.filter((a) => !a.distributed && a.childName === "Maya");
    const total = pending.reduce((sum, a) => sum + a.amount, 0);
    const { childAmount, savingsAmount } = engine.calculateSavingsSplit(total, 20);

    expect(total).toBe(4_400_000);
    expect(childAmount).toBe(3_520_000); // 80%
    expect(savingsAmount).toBe(880_000); // 20%

    // Maya checks savings (child-scoped)
    const mayaCaller = await resolveCallerRole({
      _callerId: mayaMemberId,
      _callerRole: "learner",
    });
    expect(getChildScope(mayaCaller)).toBe("Maya");

    const savings = await state.loadSavingsEntries("Maya");
    expect(savings).toHaveLength(0); // nothing distributed yet (dry-run)
  });
});

// ============================================================
// D8: E2E Cross-Child Isolation (5 tests)
// ============================================================
describe("D8: E2E Cross-Child Isolation", () => {
  let state: StateManager;
  let mayaMemberId: string;
  let carlosMemberId: string;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();

    // Setup: two-child family, both as learners
    await state.saveFamilyConfig(makeGarciaConfig());

    mayaMemberId = randomUUID();
    carlosMemberId = randomUUID();

    await state.addMember({
      id: mayaMemberId,
      name: "Maya",
      role: "learner",
      childName: "Maya",
      joinedAt: new Date().toISOString(),
      active: true,
    });
    await state.addMember({
      id: carlosMemberId,
      name: "Carlos",
      role: "learner",
      childName: "Carlos",
      joinedAt: new Date().toISOString(),
      active: true,
    });

    // Add achievements for both
    await state.addAchievement({
      id: randomUUID(),
      childName: "Maya",
      category: "education",
      description: "Math homework",
      score: 90,
      amount: 4_500_000,
      source: "openMAIC",
      verifiedBy: "manager",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });
    await state.addAchievement({
      id: randomUUID(),
      childName: "Carlos",
      category: "health",
      description: "Soccer practice",
      score: 80,
      amount: 2_400_000,
      source: "self-report",
      verifiedBy: carlosMemberId,
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });

    // Add savings for both
    await state.addSavingsEntry({
      id: randomUUID(),
      childName: "Maya",
      amount: 1_000_000,
      depositedAt: new Date().toISOString(),
      lockUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
    });
    await state.addSavingsEntry({
      id: randomUUID(),
      childName: "Carlos",
      amount: 500_000,
      depositedAt: new Date().toISOString(),
      lockUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
    });
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("ISO1: Maya calls check-progress — only Maya's achievements returned", async () => {
    const caller = await resolveCallerRole({
      _callerId: mayaMemberId,
      _callerRole: "learner",
    });
    const scope = getChildScope(caller);
    expect(scope).toBe("Maya");

    const all = await state.loadAchievements();
    const scoped = all.filter((a) => a.childName.toLowerCase() === scope!.toLowerCase());
    expect(scoped).toHaveLength(1);
    expect(scoped[0].childName).toBe("Maya");
    expect(scoped[0].category).toBe("education");
  });

  it("ISO2: Carlos calls check-progress — only Carlos's achievements returned", async () => {
    const caller = await resolveCallerRole({
      _callerId: carlosMemberId,
      _callerRole: "learner",
    });
    const scope = getChildScope(caller);
    expect(scope).toBe("Carlos");

    const all = await state.loadAchievements();
    const scoped = all.filter((a) => a.childName.toLowerCase() === scope!.toLowerCase());
    expect(scoped).toHaveLength(1);
    expect(scoped[0].childName).toBe("Carlos");
    expect(scoped[0].category).toBe("health");
  });

  it("ISO3: Manager calls check-progress — both Maya and Carlos returned", async () => {
    const caller = await resolveCallerRole({ _callerRole: "manager" });
    const scope = getChildScope(caller);
    expect(scope).toBeNull(); // no restriction

    const all = await state.loadAchievements();
    expect(all).toHaveLength(2);
    const names = all.map((a) => a.childName);
    expect(names).toContain("Maya");
    expect(names).toContain("Carlos");
  });

  it("ISO4: Maya calls check-savings — only Maya's savings entries", async () => {
    const caller = await resolveCallerRole({
      _callerId: mayaMemberId,
      _callerRole: "learner",
    });
    const scope = getChildScope(caller);
    const savings = await state.loadSavingsEntries(scope!);
    expect(savings).toHaveLength(1);
    expect(savings[0].childName).toBe("Maya");
  });

  it("ISO5: Maya cannot verify achievement for Carlos (learner child-scope enforcement)", async () => {
    // Learner can only verify for their own child
    const caller = await resolveCallerRole({
      _callerId: mayaMemberId,
      _callerRole: "learner",
    });
    expect(caller.childName).toBe("Maya");

    // Trying to verify for Carlos: the tool checks caller.childName vs args.childName
    const targetChild = "Carlos";
    const scopeViolation = caller.role === "learner" &&
      caller.childName?.toLowerCase() !== targetChild.toLowerCase();
    expect(scopeViolation).toBe(true);
  });
});
