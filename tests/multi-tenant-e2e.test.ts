import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { StateManager } from "../src/engine/state.js";
import {
  resolveCallerRole,
  UNIDENTIFIED_CALLER_TOOLS,
} from "../src/middleware/access-control.js";
import { MemberIndex } from "../src/identity/member-index.js";
import { createTestFamily, makeChild } from "./helpers/family.js";

const testDataDir = join(process.cwd(), "data");

describe("TF: Two Families on One Server — Full Isolation (Sprint 2.9)", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("TF1+TF2: two independent families can be created without collision", async () => {
    const alice = await createTestFamily({
      familyName: "Garcia",
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 10, categories: [{ name: "reading", pct: 100 }] }),
      ],
      managerName: "Alice",
    });
    const bob = await createTestFamily({
      familyName: "Chen",
      children: [
        makeChild("Carlos", { weeklyBudgetUsd: 12, categories: [{ name: "health", pct: 100 }] }),
      ],
      managerName: "Bob",
    });

    expect(alice.familyId).not.toBe(bob.familyId);
    expect(alice.memberId).not.toBe(bob.memberId);
    // Both managers are in the global member-index
    const index = new MemberIndex();
    expect((await index.get(alice.memberId))?.familyId).toBe(alice.familyId);
    expect((await index.get(bob.memberId))?.familyId).toBe(bob.familyId);
  });

  it("TF3+TF4: each family's data is isolated at the filesystem level", async () => {
    const alice = await createTestFamily({
      familyName: "Garcia",
      children: [makeChild("Maya", { weeklyBudgetUsd: 10, categories: [{ name: "r", pct: 100 }] })],
    });
    const bob = await createTestFamily({ familyName: "Chen" });
    const state = new StateManager();

    const aliceConfig = await state.loadFamilyConfig(alice.familyId);
    const bobConfig = await state.loadFamilyConfig(bob.familyId);
    expect(aliceConfig?.familyName).toBe("Garcia");
    expect(bobConfig?.familyName).toBe("Chen");
    // Alice's child list does not leak into Bob's family
    expect(aliceConfig?.children.map((c) => c.name)).toContain("Maya");
    expect(bobConfig?.children).toHaveLength(0);
  });

  it("TF5: resolving a caller by memberId cross-family lookup matches the correct family", async () => {
    const alice = await createTestFamily({ familyName: "Garcia" });
    const bob = await createTestFamily({ familyName: "Chen" });

    const aliceCaller = await resolveCallerRole({ _callerId: alice.memberId });
    const bobCaller = await resolveCallerRole({ _callerId: bob.memberId });

    expect(aliceCaller?.familyId).toBe(alice.familyId);
    expect(bobCaller?.familyId).toBe(bob.familyId);
  });

  it("TF6+TF7: achievements persist only to the authoring caller's family", async () => {
    const alice = await createTestFamily({
      familyName: "Garcia",
      children: [makeChild("Maya", { weeklyBudgetUsd: 10, categories: [{ name: "r", pct: 100 }] })],
    });
    const bob = await createTestFamily({
      familyName: "Chen",
      children: [makeChild("Carlos", { weeklyBudgetUsd: 12, categories: [{ name: "h", pct: 100 }] })],
    });

    const state = new StateManager();
    await state.addAchievement(alice.familyId, {
      id: "ach-1",
      childName: "Maya",
      category: "r",
      description: "read a book",
      score: 100,
      amount: 10_000_000,
      source: "manual",
      verifiedBy: alice.memberId,
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });

    const aliceAchs = await state.loadAchievements(alice.familyId);
    const bobAchs = await state.loadAchievements(bob.familyId);
    expect(aliceAchs).toHaveLength(1);
    expect(bobAchs).toHaveLength(0);
  });
});

describe("BR: April 24 Bug Reproduction (Sprint 2.9)", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("BR1: fresh server with no families returns null caller, not default Manager", async () => {
    const caller = await resolveCallerRole({});
    expect(caller).toBeNull();
  });

  it("BR2: unidentified caller + existing family triggers legacy fallback (single-family transitional path)", async () => {
    await createTestFamily({ familyName: "Isaac" });
    const caller = await resolveCallerRole({});
    expect(caller).not.toBeNull();
    expect(caller!.memberId).toBe("legacy-manager"); // not the Isaac Manager — sentinel only
  });

  it("BR3: unidentified caller + 2 families deactivates the legacy fallback (bug repro defense)", async () => {
    await createTestFamily({ familyName: "Isaac" });
    await createTestFamily({ familyName: "Chen" });
    // Two families → no single-family disambiguation → null caller
    const caller = await resolveCallerRole({});
    expect(caller).toBeNull();
  });

  it("BR4: only configure-policy and accept-invite are in UNIDENTIFIED_CALLER_TOOLS", () => {
    // Regression guard: every other tool must reject null callers
    expect(UNIDENTIFIED_CALLER_TOOLS.has("configure-policy")).toBe(true);
    expect(UNIDENTIFIED_CALLER_TOOLS.has("accept-invite")).toBe(true);

    const denied = [
      "verify-achievement",
      "distribute-allowance",
      "check-progress",
      "check-savings",
      "invite-member",
      "manage-members",
      "get-funding-address",
      "release-savings",
      "connect-fitbit",
      "convert-savings",
    ];
    for (const tool of denied) {
      expect(UNIDENTIFIED_CALLER_TOOLS.has(tool)).toBe(false);
    }
  });
});

describe("ID: Identity resolution — extended coverage", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("ID1: X-Member-Id header resolves to matching CallerContext", async () => {
    // Header priority is tested indirectly via the _callerId path since the
    // in-process resolver shares the same resolveFromMemberId helper.
    const family = await createTestFamily();
    const caller = await resolveCallerRole({ _callerId: family.memberId });
    expect(caller?.familyId).toBe(family.familyId);
  });

  it("ID3: unknown memberId with multiple families returns null (no fallback)", async () => {
    await createTestFamily({ familyName: "Alice" });
    await createTestFamily({ familyName: "Bob" });
    const caller = await resolveCallerRole({ _callerId: "nonexistent-id" });
    expect(caller).toBeNull();
  });

  it("ID4: no identity + multiple families returns null", async () => {
    await createTestFamily({ familyName: "Alice" });
    await createTestFamily({ familyName: "Bob" });
    const caller = await resolveCallerRole({});
    expect(caller).toBeNull();
  });

  it("ID5: no identity + exactly one family returns legacy single-family fallback", async () => {
    const f = await createTestFamily({ familyName: "Isaac" });
    const caller = await resolveCallerRole({});
    expect(caller?.familyId).toBe(f.familyId);
    expect(caller?.memberId).toBe("legacy-manager");
  });

  it("ID6: _callerRole + _familyId test-mode pass-through works without persistence", async () => {
    // No family exists on disk, but the test-mode path requires a familyId
    // to be explicitly provided. It still creates a CallerContext.
    const caller = await resolveCallerRole({
      _callerRole: "manager",
      _familyId: "aaaaaaaa-0000-0000-0000-000000000001",
    });
    expect(caller?.role).toBe("manager");
    expect(caller?.familyId).toBe("aaaaaaaa-0000-0000-0000-000000000001");
  });
});
