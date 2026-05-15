/**
 * Sprint 3.0.6 — `view-policy` tool tests (W4 + W7).
 *
 *   W4 happy-path (Manager full access):
 *     - VP-T1: section="all" + no childName + includeWallets=true → all
 *              sections populated with provenance-tagged destinations.
 *     - VP-T2: section="summary" → summary populated, children +
 *              destinations are empty arrays (NOT missing).
 *     - VP-T3: childName="Aiden" → children filtered to one entry.
 *     - VP-T4: includeWallets=false → children[].walletAddress undefined;
 *              authorizedDestinations UNCHANGED.
 *     - VP-T5: empty-policy shell — call before configure-policy ever ran.
 *     - VP-T6: determinism — two consecutive calls return byte-identical
 *              payloads (locks the no-mutation, no-clock-drift property).
 *
 *   W7 tool-level access denial (VP-T7a, VP-T7b) lives in this file too —
 *     family + learner roles must hit `withAccessControl`'s deny before
 *     the handler runs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  viewPolicyHandler,
  type ViewPolicySuccess,
  type ViewPolicyFailure,
} from "../src/tools/view-policy.js";
import {
  withAccessControl,
  type CallerContext,
} from "../src/middleware/access-control.js";
import { configureFamilyCore } from "../src/core/configure-family.js";
import { CHAIN_IDS, USDC, ROLES } from "../src/constants.js";
import type { ChildConfig } from "../src/schemas.js";

const DATA_DIR = join(process.cwd(), "data");
const MANAGER_WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CHILD_AIDEN_WALLET = "0xcccccccccccccccccccccccccccccccccccccccc";

function buildChild(
  name: string,
  overrides: Partial<ChildConfig> = {}
): ChildConfig {
  return {
    name,
    walletName: `child-${name.toLowerCase()}`,
    walletAddress: overrides.walletAddress,
    weeklyBudget: overrides.weeklyBudget ?? 15_000_000,
    categories: overrides.categories ?? [
      { name: "education", pct: 50, budget: 7_500_000 },
      { name: "movement", pct: 50, budget: 7_500_000 },
    ],
    savingsPercent: overrides.savingsPercent ?? 20,
    savingsLockDays: overrides.savingsLockDays ?? 90,
    learningGoals: overrides.learningGoals,
  };
}

interface Bootstrapped {
  caller: CallerContext;
  familyId: string;
}

/**
 * Bootstrap a family with one Manager and the given children. Returns a
 * Manager `CallerContext` ready for view-policy invocations.
 */
async function bootstrapTestFamily(opts: {
  familyName?: string;
  children: ChildConfig[];
  managerWalletAddress?: string;
}): Promise<Bootstrapped> {
  const result = await configureFamilyCore(
    {
      familyName: opts.familyName ?? "Garcia",
      children: opts.children,
      chainId: CHAIN_IDS.BASE_SEPOLIA,
      usdcAddress: USDC.BASE_SEPOLIA,
      useTestnet: true,
      managerWalletAddress: opts.managerWalletAddress,
    },
    null
  );
  if (!result.ok || !result.bootstrap) {
    throw new Error("expected bootstrap success");
  }
  return {
    caller: {
      role: ROLES.MANAGER,
      memberId: result.memberId,
      familyId: result.familyId,
    },
    familyId: result.familyId,
  };
}

/**
 * Parse the JSON payload from a ToolResponse for ergonomic assertions.
 */
function parsePayload(
  response: Awaited<ReturnType<typeof viewPolicyHandler>>
): ViewPolicySuccess | ViewPolicyFailure {
  return JSON.parse(response.content[0]!.text);
}

describe("Sprint 3.0.6 — view-policy tool (W4 happy path, Manager role)", () => {
  beforeEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
    await mkdir(DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("VP-T1: Manager + section='all' + no childName + includeWallets=true → all sections populated", async () => {
    const { caller } = await bootstrapTestFamily({
      managerWalletAddress: MANAGER_WALLET,
      children: [
        buildChild("Aiden", { walletAddress: CHILD_AIDEN_WALLET }),
        buildChild("Maya"),
      ],
    });

    const response = await viewPolicyHandler({}, caller);
    const payload = parsePayload(response) as ViewPolicySuccess;

    expect(payload.success).toBe(true);
    expect(payload.familyName).toBe("Garcia");
    expect(payload.network).toBe("Base Sepolia (testnet)");
    expect(payload.policyVersion).toBe(1);
    expect(payload.children).toHaveLength(2);
    expect(payload.children[0]!.name).toBe("Aiden");
    expect(payload.children[0]!.walletAddress).toBe(
      CHILD_AIDEN_WALLET.toLowerCase()
    );
    expect(payload.children[1]!.name).toBe("Maya");
    expect(payload.children[1]!.walletAddress).toBeUndefined();
    expect(payload.authorizedDestinations.length).toBeGreaterThan(0);

    // Provenance: manager wallet + Aiden's wallet should both be tagged
    // force-added with the correct labels.
    const managerEntry = payload.authorizedDestinations.find(
      (d) => d.label === "manager-wallet"
    );
    expect(managerEntry).toBeDefined();
    expect(managerEntry!.source).toBe("force-added");
    const aidenEntry = payload.authorizedDestinations.find(
      (d) => d.label === "child:Aiden"
    );
    expect(aidenEntry).toBeDefined();
    expect(aidenEntry!.source).toBe("force-added");

    expect(payload.summary).toEqual({
      childCount: 2,
      totalWeeklyBudgetUsd: 30,
      destinationCount: payload.authorizedDestinations.length,
      learningGoalCount: 0,
      activeGoalCount: 0,
    });
    expect(payload.updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it("VP-T2: section='summary' → summary populated, other sections empty arrays (not missing)", async () => {
    const { caller } = await bootstrapTestFamily({
      managerWalletAddress: MANAGER_WALLET,
      children: [buildChild("Aiden", { walletAddress: CHILD_AIDEN_WALLET })],
    });

    const response = await viewPolicyHandler({ section: "summary" }, caller);
    const payload = parsePayload(response) as ViewPolicySuccess;

    expect(payload.success).toBe(true);
    expect(payload.summary.childCount).toBe(1);
    expect(payload.summary.totalWeeklyBudgetUsd).toBe(15);

    // The structural-shape gate: other sections are present-but-empty arrays,
    // not missing keys. (Empty shell parity — C3.)
    expect(payload.children).toEqual([]);
    expect(payload.authorizedDestinations).toEqual([]);
    expect(payload).toHaveProperty("policyVersion");
    expect(payload).toHaveProperty("familyName");
    expect(payload).toHaveProperty("updatedAt");
  });

  it("VP-T3: childName='Aiden' → children[] filtered to one entry; summary still describes full policy", async () => {
    const { caller } = await bootstrapTestFamily({
      managerWalletAddress: MANAGER_WALLET,
      children: [
        buildChild("Aiden", { walletAddress: CHILD_AIDEN_WALLET }),
        buildChild("Maya"),
      ],
    });

    const response = await viewPolicyHandler({ childName: "Aiden" }, caller);
    const payload = parsePayload(response) as ViewPolicySuccess;

    expect(payload.children).toHaveLength(1);
    expect(payload.children[0]!.name).toBe("Aiden");
    // Summary always describes the FULL policy regardless of child filter —
    // child filter narrows the children array, summary stays global. Locks
    // the design intent so callers can show "you're seeing 1 of 2 kids".
    expect(payload.summary.childCount).toBe(2);
    expect(payload.summary.totalWeeklyBudgetUsd).toBe(30);
  });

  it("VP-T4: includeWallets=false strips children[].walletAddress but NOT authorizedDestinations", async () => {
    const { caller } = await bootstrapTestFamily({
      managerWalletAddress: MANAGER_WALLET,
      children: [buildChild("Aiden", { walletAddress: CHILD_AIDEN_WALLET })],
    });

    const response = await viewPolicyHandler({ includeWallets: false }, caller);
    const payload = parsePayload(response) as ViewPolicySuccess;

    expect(payload.children[0]!.walletAddress).toBeUndefined();
    // Destinations are NOT a children[]-wallet concern — the design says
    // they remain visible even when wallets are stripped. Locked by C8.
    expect(payload.authorizedDestinations.length).toBeGreaterThan(0);
    const aidenEntry = payload.authorizedDestinations.find(
      (d) => d.label === "child:Aiden"
    );
    expect(aidenEntry).toBeDefined();
    expect(aidenEntry!.address).toBe(CHILD_AIDEN_WALLET.toLowerCase());
  });

  it("VP-T5: family with no policy (loadFamilyConfig returns null) → success-shaped empty shell", async () => {
    // Manufacture a Manager caller for a familyId that DOESN'T have a
    // family-config.json on disk. This simulates the structural
    // POLICY_NOT_INITIALIZED case the contract C3 demands.
    const ghostCaller: CallerContext = {
      role: ROLES.MANAGER,
      memberId: "ghost-manager",
      familyId: "00000000-0000-0000-0000-000000000099",
    };

    const response = await viewPolicyHandler({}, ghostCaller);
    const payload = parsePayload(response) as ViewPolicySuccess;

    expect(payload.success).toBe(true);
    expect(payload.policyVersion).toBe(0);
    expect(payload.familyName).toBe("");
    expect(payload.network).toBe("");
    expect(payload.children).toEqual([]);
    expect(payload.authorizedDestinations).toEqual([]);
    expect(payload.summary).toEqual({
      childCount: 0,
      totalWeeklyBudgetUsd: 0,
      destinationCount: 0,
      learningGoalCount: 0,
      activeGoalCount: 0,
    });
    expect(payload.updatedAt).toBe("");
    expect(payload.message.length).toBeGreaterThan(0);
  });

  it("VP-T6: two consecutive view-policy calls return byte-identical payloads (determinism)", async () => {
    const { caller } = await bootstrapTestFamily({
      managerWalletAddress: MANAGER_WALLET,
      children: [buildChild("Aiden", { walletAddress: CHILD_AIDEN_WALLET })],
    });

    const first = await viewPolicyHandler({}, caller);
    const second = await viewPolicyHandler({}, caller);

    expect(first.content[0]!.text).toBe(second.content[0]!.text);
  });
});

describe("Sprint 3.0.6 — view-policy tool-level access denial (W7)", () => {
  beforeEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
    await mkdir(DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("VP-T7a: family role calling view-policy gets Access Denied at the gate (NOT a filtered partial)", async () => {
    const { familyId } = await bootstrapTestFamily({
      managerWalletAddress: MANAGER_WALLET,
      children: [buildChild("Aiden", { walletAddress: CHILD_AIDEN_WALLET })],
    });

    // Construct a Family member directly and invoke the WRAPPED handler so
    // withAccessControl runs.
    const { StateManager } = await import("../src/engine/state.js");
    const { MemberIndex } = await import("../src/identity/member-index.js");
    const state = new StateManager();
    const index = new MemberIndex();
    const familyMemberId = "family-uncle-001";
    await state.addMember(familyId, {
      id: familyMemberId,
      name: "Uncle Bob",
      role: ROLES.FAMILY,
      joinedAt: new Date().toISOString(),
      active: true,
    });
    await index.set(familyMemberId, familyId, ROLES.FAMILY);

    const wrapped = withAccessControl("view-policy", viewPolicyHandler);
    const response = await wrapped({
      _callerRole: ROLES.FAMILY,
      _callerId: familyMemberId,
      _familyId: familyId,
    });
    const payload = JSON.parse(response.content[0]!.text);

    expect(payload.success).toBe(false);
    expect(payload.error).toContain("Access denied");
    expect(payload.role).toBe("family");
    expect(payload.toolName).toBe("view-policy");
    // CRITICAL: must NOT leak policy data through the denial response.
    expect(payload).not.toHaveProperty("children");
    expect(payload).not.toHaveProperty("authorizedDestinations");
    expect(payload).not.toHaveProperty("summary");
  });

  it("VP-T7b: learner role calling view-policy gets Access Denied at the gate (identical shape to VP-T7a)", async () => {
    const { familyId } = await bootstrapTestFamily({
      managerWalletAddress: MANAGER_WALLET,
      children: [buildChild("Aiden", { walletAddress: CHILD_AIDEN_WALLET })],
    });

    const { StateManager } = await import("../src/engine/state.js");
    const { MemberIndex } = await import("../src/identity/member-index.js");
    const state = new StateManager();
    const index = new MemberIndex();
    const learnerMemberId = "learner-aiden-001";
    await state.addMember(familyId, {
      id: learnerMemberId,
      name: "Aiden Learner",
      role: ROLES.LEARNER,
      childName: "Aiden",
      joinedAt: new Date().toISOString(),
      active: true,
    });
    await index.set(learnerMemberId, familyId, ROLES.LEARNER);

    const wrapped = withAccessControl("view-policy", viewPolicyHandler);
    const response = await wrapped({
      _callerRole: ROLES.LEARNER,
      _callerId: learnerMemberId,
      _familyId: familyId,
    });
    const payload = JSON.parse(response.content[0]!.text);

    expect(payload.success).toBe(false);
    expect(payload.error).toContain("Access denied");
    expect(payload.role).toBe("learner");
    expect(payload).not.toHaveProperty("children");
    expect(payload).not.toHaveProperty("authorizedDestinations");
  });
});
