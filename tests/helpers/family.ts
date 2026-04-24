import { randomUUID } from "node:crypto";
import { StateManager } from "../../src/engine/state.js";
import { MemberIndex } from "../../src/identity/member-index.js";
import { ROLES } from "../../src/constants.js";
import type { Role } from "../../src/constants.js";
import { USDC, CHAIN_IDS } from "../../src/constants.js";
import type { CallerContext } from "../../src/middleware/access-control.js";
import type { ChildConfig, FamilyConfig, Member } from "../../src/schemas.js";

export interface CreateTestFamilyOverrides {
  familyId?: string;
  familyName?: string;
  children?: ChildConfig[];
  chainId?: string;
  usdcAddress?: string;
  managerName?: string;
}

export interface TestFamily {
  familyId: string;
  memberId: string;
  managerContext: CallerContext;
  state: StateManager;
  index: MemberIndex;
  /**
   * Build args the tool handlers accept to authenticate as the Manager of
   * this test family. Use via `await tool({ ...someArgs, ...family.asManager() })`.
   */
  asManager(): { _callerRole: Role; _callerId: string; _familyId: string };
  /**
   * Add another member to the family (co-parent, learner, etc.) and return
   * a CallerContext plus a matching args fragment.
   */
  addMember(
    role: Role,
    opts?: { name?: string; childName?: string; id?: string }
  ): Promise<{
    memberId: string;
    context: CallerContext;
    asArgs: { _callerRole: Role; _callerId: string; _familyId: string; _callerChildName?: string };
  }>;
}

/**
 * Create a test family with a Manager already registered in both the
 * family directory and the global MemberIndex. Used by every Sprint 2.9
 * test that needs multi-tenant state. Mechanical replacement for the
 * Sprint 2.75 pattern of `new StateManager()` + manual setup.
 */
export async function createTestFamily(
  overrides: CreateTestFamilyOverrides = {}
): Promise<TestFamily> {
  const familyId = overrides.familyId ?? randomUUID();
  const memberId = randomUUID();
  const now = new Date().toISOString();

  const state = new StateManager();
  const index = new MemberIndex();

  await state.createFamilyDir(familyId);

  const config: FamilyConfig = {
    familyId,
    familyName: overrides.familyName ?? "Test Family",
    children: overrides.children ?? [],
    createdAt: now,
    updatedAt: now,
    chainId: overrides.chainId ?? CHAIN_IDS.BASE_SEPOLIA,
    usdcAddress: overrides.usdcAddress ?? USDC.BASE_SEPOLIA,
  };
  await state.saveFamilyConfig(familyId, config);

  const manager: Member = {
    id: memberId,
    name: overrides.managerName ?? "Test Manager",
    role: ROLES.MANAGER,
    joinedAt: now,
    active: true,
  };
  await state.addMember(familyId, manager);
  await index.set(memberId, familyId, ROLES.MANAGER);

  for (const child of config.children) {
    await state.initializeStreak(familyId, child.name);
  }

  const managerContext: CallerContext = {
    role: ROLES.MANAGER,
    memberId,
    familyId,
  };

  return {
    familyId,
    memberId,
    managerContext,
    state,
    index,
    asManager: () => ({
      _callerRole: ROLES.MANAGER,
      _callerId: memberId,
      _familyId: familyId,
    }),
    async addMember(role, opts = {}) {
      const newMemberId = opts.id ?? randomUUID();
      const member: Member = {
        id: newMemberId,
        name: opts.name ?? `Test ${role}`,
        role,
        childName: role === ROLES.LEARNER ? opts.childName : undefined,
        joinedAt: new Date().toISOString(),
        active: true,
      };
      await state.addMember(familyId, member);
      await index.set(newMemberId, familyId, role);

      const context: CallerContext = {
        role,
        memberId: newMemberId,
        familyId,
        childName: member.childName,
      };
      return {
        memberId: newMemberId,
        context,
        asArgs: {
          _callerRole: role,
          _callerId: newMemberId,
          _familyId: familyId,
          _callerChildName: member.childName,
        },
      };
    },
  };
}

/**
 * Build a child config object quickly for tests. Converts USD to USDC units
 * and calculates category budgets so tests don't have to do the arithmetic.
 */
export function makeChild(
  name: string,
  opts: {
    weeklyBudgetUsd: number;
    categories: Array<{ name: string; pct: number }>;
    savingsPercent?: number;
    walletAddress?: string;
    savingsLockDays?: number;
  }
): ChildConfig {
  const weeklyBudget = Math.round(opts.weeklyBudgetUsd * 10 ** USDC.DECIMALS);
  return {
    name,
    walletName: `child-${name.toLowerCase()}`,
    walletAddress: opts.walletAddress,
    weeklyBudget,
    categories: opts.categories.map((c) => ({
      name: c.name,
      pct: c.pct,
      budget: Math.round(weeklyBudget * (c.pct / 100)),
    })),
    savingsPercent: opts.savingsPercent ?? 20,
    savingsLockDays: opts.savingsLockDays ?? 90,
  };
}
