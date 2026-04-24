/**
 * E2E test — exercises the full AllowanceAgent flow without OWS wallet calls.
 * Tests the business logic path: configure → invite → accept → verify → distribute (dry) → progress → RBAC deny.
 *
 * OWS SDK calls are not made (no real wallet); we test the state transitions,
 * RBAC enforcement, and data persistence end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateManager } from "../src/engine/state.js";
import { PolicyEngine } from "../src/engine/policy.js";
import { InviteSystem } from "../src/invites/system.js";
import {
  resolveCallerRole,
  isToolAuthorized,
  buildAccessDeniedResponse,
} from "../src/middleware/access-control.js";
import type { FamilyConfig, AchievementRecord, Member, SavingsEntry } from "../src/schemas.js";

const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

const testDataDir = join(process.cwd(), "data");

describe("E2E: Full Allowance Flow", () => {
  let state: StateManager;
  let engine: PolicyEngine;
  let inviteSystem: InviteSystem;

  // Shared state across sequential test steps
  let familyConfig: FamilyConfig;
  let inviteCode: string;
  let coParentMemberId: string;
  let achievementId: string;

  beforeAll(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();
    await state.createFamilyDir(FAMILY_ID);
    engine = new PolicyEngine();
    inviteSystem = new InviteSystem();
  });

  afterAll(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  // === Step 1: Configure family policy ===
  it("1. Manager configures family policy", async () => {
    // Sprint 2.9 hotfix: the bare resolveCallerRole({}) call used to default
    // to a single-family Manager via Priority 5. That fallback is gone, so
    // tests must explicitly pass _callerRole + _familyId (same pattern as
    // Steps 2-9 in this file).
    const caller = await resolveCallerRole({ _callerRole: "manager", _familyId: FAMILY_ID });
    expect(caller!.role).toBe("manager");
    expect(isToolAuthorized("configure-policy", caller!.role)).toBe(true);

    familyConfig = {
      familyName: "TestFamily",
      children: [
        {
          name: "Maya",
          walletName: "child-maya",
          weeklyBudget: 15_000_000, // $15 USDC
          categories: [
            { name: "education", pct: 33, budget: 5_000_000 },
            { name: "health", pct: 33, budget: 5_000_000 },
            { name: "personal", pct: 33, budget: 5_000_000 },
          ],
          savingsPercent: 20,
          savingsLockDays: 90,
        },
        {
          name: "Alex",
          walletName: "child-alex",
          weeklyBudget: 10_000_000, // $10 USDC
          categories: [
            { name: "education", pct: 40, budget: 4_000_000 },
            { name: "health", pct: 30, budget: 3_000_000 },
            { name: "personal", pct: 30, budget: 3_000_000 },
          ],
          savingsPercent: 15,
          savingsLockDays: 60,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chainId: "eip155:84532",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    };

    await state.saveFamilyConfig(FAMILY_ID, familyConfig);

    // Register manager as first member
    const managerId = randomUUID();
    await state.addMember(FAMILY_ID, {
      id: managerId,
      name: "Parent",
      role: "manager",
      joinedAt: new Date().toISOString(),
      active: true,
    });

    // Initialize streaks for each child
    for (const child of familyConfig.children) {
      await state.initializeStreak(FAMILY_ID, child.name);
    }

    // Log audit
    await state.addAuditEntry(FAMILY_ID, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "configure",
      actor: managerId,
      details: { familyName: "TestFamily", childCount: 2 },
    });

    // Verify persistence
    const loaded = await state.loadFamilyConfig(FAMILY_ID);
    expect(loaded?.familyName).toBe("TestFamily");
    expect(loaded?.children).toHaveLength(2);

    const members = await state.loadMembers(FAMILY_ID);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("manager");
  });

  // === Step 2: Manager creates invite for co-parent ===
  it("2. Manager invites a co-parent", async () => {
    const caller = await resolveCallerRole({ _callerRole: "manager", _familyId: FAMILY_ID });
    expect(isToolAuthorized("invite-member", caller.role)).toBe(true);

    const invite = inviteSystem.generateInvite(
      "co-parent",
      "Maya",
      "TestFamily",
      "manager"
    );
    inviteCode = invite.code;

    await state.addInvite(FAMILY_ID, invite);

    // Log audit
    await state.addAuditEntry(FAMILY_ID, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "invite-created",
      actor: "manager",
      details: { code: inviteCode, role: "co-parent" },
    });

    const invites = await state.loadInvites(FAMILY_ID);
    expect(invites).toHaveLength(1);
    expect(invites[0].code).toBe(inviteCode);
    expect(invites[0].used).toBe(false);
  });

  // === Step 3: Co-parent accepts invite ===
  it("3. Co-parent accepts invite and joins", async () => {
    // accept-invite is available to all roles
    expect(isToolAuthorized("accept-invite", "manager")).toBe(true);

    const invites = await state.loadInvites(FAMILY_ID);
    const invite = inviteSystem.validateInvite(inviteCode, invites);
    expect(invite).not.toBeNull();
    expect(invite!.role).toBe("co-parent");

    // Register co-parent member
    coParentMemberId = randomUUID();
    const newMember: Member = {
      id: coParentMemberId,
      name: "CoParent Maria",
      role: invite!.role,
      joinedAt: new Date().toISOString(),
      active: true,
    };
    await state.addMember(FAMILY_ID, newMember);

    // Mark invite as used
    invite!.used = true;
    invite!.usedBy = coParentMemberId;
    invite!.usedAt = new Date().toISOString();
    await state.saveInvites(FAMILY_ID, invites);

    // Log audit
    await state.addAuditEntry(FAMILY_ID, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "invite-accepted",
      actor: coParentMemberId,
      details: { code: inviteCode, role: "co-parent" },
    });

    const members = await state.loadMembers(FAMILY_ID);
    expect(members).toHaveLength(2);
    const coParent = members.find((m) => m.role === "co-parent");
    expect(coParent?.name).toBe("CoParent Maria");

    // Verify invite is now used
    const updatedInvites = await state.loadInvites(FAMILY_ID);
    expect(updatedInvites[0].used).toBe(true);
  });

  // === Step 4: Co-parent verifies an achievement for Maya ===
  it("4. Co-parent verifies Maya's education achievement", async () => {
    const caller = await resolveCallerRole({
      _callerRole: "co-parent",
      _callerId: coParentMemberId,
    });
    expect(caller.role).toBe("co-parent");
    expect(isToolAuthorized("verify-achievement", caller.role)).toBe(true);

    const config = await state.loadFamilyConfig(FAMILY_ID);
    const mayaConfig = config!.children.find((c) => c.name === "Maya")!;

    // Evaluate achievement
    const score = 85;
    const baseAmount = engine.evaluateAchievement(score, "education", mayaConfig);
    expect(baseAmount).toBe(4_250_000); // 85% of $5.00 = $4.25

    // Update streak
    const streak = await state.updateStreak(FAMILY_ID, "Maya");
    expect(streak.currentStreak).toBe(1);
    expect(streak.multiplier).toBe(1.0); // no streak bonus yet

    const finalAmount = Math.round(baseAmount * streak.multiplier);
    expect(finalAmount).toBe(4_250_000);

    // Create achievement record
    achievementId = randomUUID();
    const record: AchievementRecord = {
      id: achievementId,
      childName: "Maya",
      category: "education",
      description: "Completed math quiz with 85% score",
      score,
      amount: finalAmount,
      verifiedBy: coParentMemberId,
      verifiedAt: new Date().toISOString(),
      distributed: false,
    };
    await state.addAchievement(FAMILY_ID, record);

    // Log audit
    await state.addAuditEntry(FAMILY_ID, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "verify-achievement",
      actor: coParentMemberId,
      details: { child: "Maya", score, amount: finalAmount, category: "education" },
    });

    const achievements = await state.loadAchievements(FAMILY_ID);
    expect(achievements).toHaveLength(1);
    expect(achievements[0].amount).toBe(4_250_000);
    expect(achievements[0].distributed).toBe(false);
  });

  // === Step 5: Manager distributes allowance (dry-run) ===
  it("5. Manager distributes allowance (dry-run)", async () => {
    const caller = await resolveCallerRole({ _callerRole: "manager", _familyId: FAMILY_ID });
    expect(isToolAuthorized("distribute-allowance", caller.role)).toBe(true);

    const config = await state.loadFamilyConfig(FAMILY_ID);
    const achievements = await state.loadAchievements(FAMILY_ID);
    const pending = achievements.filter(
      (a) => !a.distributed && a.childName === "Maya"
    );
    expect(pending).toHaveLength(1);

    const totalAmount = pending.reduce((sum, a) => sum + a.amount, 0);
    expect(totalAmount).toBe(4_250_000);

    // Calculate savings split
    const mayaConfig = config!.children.find((c) => c.name === "Maya")!;
    const { childAmount, savingsAmount } = engine.calculateSavingsSplit(
      totalAmount,
      mayaConfig.savingsPercent
    );
    expect(savingsAmount).toBe(850_000);  // 20% of 4.25M
    expect(childAmount).toBe(3_400_000);   // 80%
    expect(childAmount + savingsAmount).toBe(totalAmount);

    // In dry-run, we don't actually send transactions, but we verify the calculations
    // In real flow, WalletDistributor would call OWS signAndSend here

    // Simulate marking as distributed (real flow does this after tx confirms)
    // For the e2e test, we DO mark them to test the full state transition
    for (const ach of pending) {
      ach.distributed = true;
      ach.distributedAt = new Date().toISOString();
      ach.txHash = "0xDRYRUN_" + randomUUID().slice(0, 8);
    }
    await state.saveAchievements(FAMILY_ID, achievements);

    // Add savings entry
    const savingsEntry: SavingsEntry = {
      id: randomUUID(),
      childName: "Maya",
      amount: savingsAmount,
      depositedAt: new Date().toISOString(),
      lockUntil: new Date(
        Date.now() + mayaConfig.savingsLockDays * 24 * 60 * 60 * 1000
      ).toISOString(),
      released: false,
      multiplierAtDeposit: 1.0,
    };
    await state.addSavingsEntry(FAMILY_ID, savingsEntry);

    // Log audit
    await state.addAuditEntry(FAMILY_ID, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "distribute",
      actor: "manager",
      details: {
        child: "Maya",
        total: totalAmount,
        childAmount,
        savingsAmount,
        dryRun: true,
      },
      amount: totalAmount,
    });

    // Verify state
    const updatedAch = await state.loadAchievements(FAMILY_ID);
    expect(updatedAch[0].distributed).toBe(true);

    const savings = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    expect(savings).toHaveLength(1);
    expect(savings[0].amount).toBe(850_000);
    expect(savings[0].released).toBe(false);
  });

  // === Step 6: Check progress ===
  it("6. Check Maya's progress shows correct data", async () => {
    const caller = await resolveCallerRole({ _callerRole: "co-parent", _familyId: FAMILY_ID });
    expect(isToolAuthorized("check-progress", caller.role)).toBe(true);

    const achievements = await state.loadAchievements(FAMILY_ID);
    const mayaAch = achievements.filter((a) => a.childName === "Maya");
    expect(mayaAch).toHaveLength(1);

    const streak = await state.loadStreak(FAMILY_ID, "Maya");
    expect(streak).not.toBeNull();
    expect(streak!.currentStreak).toBe(1);

    const savings = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    expect(savings).toHaveLength(1);

    // Total earned and distributed
    const totalEarned = mayaAch.reduce((s, a) => s + a.amount, 0);
    expect(totalEarned).toBe(4_250_000);

    const totalSaved = savings.reduce((s, e) => s + e.amount, 0);
    expect(totalSaved).toBe(850_000);
  });

  // === Step 7: Check savings vault ===
  it("7. Check Maya's savings vault", async () => {
    const caller = await resolveCallerRole({ _callerRole: "manager", _familyId: FAMILY_ID });
    expect(isToolAuthorized("check-savings", caller.role)).toBe(true);

    const savings = await state.loadSavingsEntries(FAMILY_ID, "Maya");
    expect(savings).toHaveLength(1);

    const entry = savings[0];
    expect(entry.released).toBe(false);

    // Lock shouldn't be expired yet (90 days from now)
    const lockDate = new Date(entry.lockUntil);
    expect(lockDate.getTime()).toBeGreaterThan(Date.now());
  });

  // === Step 8: RBAC denial — family member can't configure policy ===
  it("8. RBAC: Family member denied configure-policy", async () => {
    const caller = await resolveCallerRole({ _callerRole: "family", _familyId: FAMILY_ID });
    expect(caller.role).toBe("family");
    expect(isToolAuthorized("configure-policy", caller.role)).toBe(false);

    const response = buildAccessDeniedResponse("configure-policy", caller.role);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("family");
    expect(parsed.error).toContain("configure-policy");
  });

  // === Step 9: RBAC denial — co-parent can't distribute ===
  it("9. RBAC: Co-parent denied distribute-allowance", async () => {
    const caller = await resolveCallerRole({
      _callerRole: "co-parent",
      _callerId: coParentMemberId,
    });
    expect(isToolAuthorized("distribute-allowance", caller.role)).toBe(false);
  });

  // === Step 10: RBAC denial — advisor can't verify achievements ===
  it("10. RBAC: Advisor denied verify-achievement", async () => {
    expect(isToolAuthorized("verify-achievement", "advisor")).toBe(false);
    expect(isToolAuthorized("distribute-allowance", "advisor")).toBe(false);
    expect(isToolAuthorized("configure-policy", "advisor")).toBe(false);
    expect(isToolAuthorized("manage-members", "advisor")).toBe(false);
  });

  // === Step 11: Audit log integrity ===
  it("11. Audit log has all expected entries", async () => {
    const log = await state.loadAuditLog(FAMILY_ID);
    expect(log.length).toBeGreaterThanOrEqual(4);

    const actions = log.map((e) => e.action);
    expect(actions).toContain("configure");
    expect(actions).toContain("invite-created");
    expect(actions).toContain("invite-accepted");
    expect(actions).toContain("verify-achievement");
    expect(actions).toContain("distribute");
  });

  // === Step 12: Budget enforcement ===
  it("12. Budget check catches over-spending", async () => {
    const config = await state.loadFamilyConfig(FAMILY_ID);
    const mayaConfig = config!.children.find((c) => c.name === "Maya")!;

    // Maya already earned $4.25 this week from education
    const currentSpend = 4_250_000;

    // Try to add another $12 education achievement — exceeds $15 weekly budget
    const budgetCheck = engine.checkWeeklyBudget(
      currentSpend,
      12_000_000,
      mayaConfig.weeklyBudget
    );
    expect(budgetCheck.allowed).toBe(false);
    expect(budgetCheck.reason).toContain("exceed weekly budget");

    // But a $5 achievement should be fine
    const okCheck = engine.checkWeeklyBudget(
      currentSpend,
      5_000_000,
      mayaConfig.weeklyBudget
    );
    expect(okCheck.allowed).toBe(true);
    expect(okCheck.remaining).toBe(5_750_000);
  });

  // === Step 13: Re-used invite rejected ===
  it("13. Used invite code is rejected", async () => {
    const invites = await state.loadInvites(FAMILY_ID);
    const result = inviteSystem.validateInvite(inviteCode, invites);
    expect(result).toBeNull(); // already used
  });
});
