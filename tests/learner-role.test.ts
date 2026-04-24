import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  isToolAuthorized,
  getChildScope,
  resolveCallerRole,
} from "../src/middleware/access-control.js";
import { StateManager } from "../src/engine/state.js";
import { ROLES } from "../src/constants.js";
import type { CallerContext } from "../src/middleware/access-control.js";

const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

const testDataDir = join(process.cwd(), "data");

// ============================================================
// D1: Learner Role RBAC (8 tests)
// ============================================================
describe("D1: Learner Role RBAC", () => {
  it("L1: Learner can call check-progress", () => {
    expect(isToolAuthorized("check-progress", "learner")).toBe(true);
  });

  it("L2: Learner can call check-savings", () => {
    expect(isToolAuthorized("check-savings", "learner")).toBe(true);
  });

  it("L3: Learner can call verify-achievement", () => {
    expect(isToolAuthorized("verify-achievement", "learner")).toBe(true);
  });

  it("L4: Learner can call accept-invite", () => {
    expect(isToolAuthorized("accept-invite", "learner")).toBe(true);
  });

  it("L5: Learner cannot call configure-policy", () => {
    expect(isToolAuthorized("configure-policy", "learner")).toBe(false);
  });

  it("L6: Learner cannot call distribute-allowance", () => {
    expect(isToolAuthorized("distribute-allowance", "learner")).toBe(false);
  });

  it("L7: Learner cannot call invite-member", () => {
    expect(isToolAuthorized("invite-member", "learner")).toBe(false);
  });

  it("L8: Learner cannot call manage-members", () => {
    expect(isToolAuthorized("manage-members", "learner")).toBe(false);
  });
});

// ============================================================
// D2: Child-Scoped Data Access (6 tests)
// ============================================================
describe("D2: Child-Scoped Data Access", () => {
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

  it("CS1: getChildScope returns childName for learner", () => {
    const caller: CallerContext = {
      role: ROLES.LEARNER,
      memberId: "maya-learner-id",
      childName: "Maya",
    };
    expect(getChildScope(caller)).toBe("Maya");
  });

  it("CS2: getChildScope returns null for manager", () => {
    const caller: CallerContext = {
      role: ROLES.MANAGER,
      memberId: "manager-id",
    };
    expect(getChildScope(caller)).toBeNull();
  });

  it("CS3: getChildScope returns null for co-parent", () => {
    const caller: CallerContext = {
      role: ROLES.CO_PARENT,
      memberId: "coparent-id",
    };
    expect(getChildScope(caller)).toBeNull();
  });

  it("CS4: Learner resolveCallerRole includes childName from member record", async () => {
    const memberId = randomUUID();
    await state.addMember(FAMILY_ID, {
      id: memberId,
      name: "Maya",
      role: "learner",
      childName: "Maya",
      joinedAt: new Date().toISOString(),
      active: true,
    });

    const caller = await resolveCallerRole({
      _callerId: memberId,
      _callerRole: "learner",
    });
    expect(caller.role).toBe("learner");
    expect(caller.childName).toBe("Maya");
  });

  it("CS5: Learner check-progress filtering — only own child data", async () => {
    // Setup: two children config
    await state.saveFamilyConfig(FAMILY_ID, {
      familyName: "Garcia",
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
    });

    // Add achievements for both children
    await state.addAchievement(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      category: "education",
      description: "Math homework",
      score: 90,
      amount: 4_500_000,
      source: "manual",
      verifiedBy: "manager",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });
    await state.addAchievement(FAMILY_ID, {
      id: randomUUID(),
      childName: "Carlos",
      category: "health",
      description: "Soccer practice",
      score: 80,
      amount: 2_400_000,
      source: "manual",
      verifiedBy: "manager",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });

    // Maya learner scope should only return Maya's achievements
    const mayaCaller: CallerContext = {
      role: ROLES.LEARNER,
      memberId: "maya-learner",
      childName: "Maya",
    };
    const scope = getChildScope(mayaCaller);
    expect(scope).toBe("Maya");

    // Simulate what check-progress does: filter achievements by scope
    const allAchievements = await state.loadAchievements(FAMILY_ID);
    const scopedAchievements = allAchievements.filter(
      (a) => a.childName.toLowerCase() === scope!.toLowerCase()
    );
    expect(scopedAchievements).toHaveLength(1);
    expect(scopedAchievements[0].childName).toBe("Maya");
  });

  it("CS6: Manager check-progress returns all children", async () => {
    const managerCaller: CallerContext = {
      role: ROLES.MANAGER,
      memberId: "manager-id",
    };
    const scope = getChildScope(managerCaller);
    expect(scope).toBeNull(); // null means "all children"
  });
});
