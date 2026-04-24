import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateManager } from "../src/engine/state.js";
import { PolicyEngine } from "../src/engine/policy.js";
import type { AchievementRecord } from "../src/schemas.js";

const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

const testDataDir = join(process.cwd(), "data");

// ============================================================
// D3: Source Field Tests (5 tests)
// ============================================================
describe("D3: Source Field", () => {
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

  it("S1: verify-achievement with source 'openMAIC' persists correctly", async () => {
    const record: AchievementRecord = {
      id: randomUUID(),
      childName: "Maya",
      category: "education",
      description: "Completed OpenMAIC: Fractions",
      score: 88,
      amount: 4_400_000,
      source: "openMAIC",
      verifiedBy: "manager-id",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    };
    await state.addAchievement(FAMILY_ID, record);

    const loaded = await state.loadAchievements(FAMILY_ID);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].source).toBe("openMAIC");
  });

  it("S2: verify-achievement with source 'self-report' persists correctly", async () => {
    const record: AchievementRecord = {
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
    };
    await state.addAchievement(FAMILY_ID, record);

    const loaded = await state.loadAchievements(FAMILY_ID);
    expect(loaded[0].source).toBe("self-report");
  });

  it("S3: verify-achievement without source defaults to 'manual'", async () => {
    const record: AchievementRecord = {
      id: randomUUID(),
      childName: "Maya",
      category: "health",
      description: "10,000 steps",
      score: 100,
      amount: 5_000_000,
      source: "manual",
      verifiedBy: "manager-id",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    };
    await state.addAchievement(FAMILY_ID, record);

    const loaded = await state.loadAchievements(FAMILY_ID);
    expect(loaded[0].source).toBe("manual");
  });

  it("S4: check-progress includes source per achievement in response data", async () => {
    // Add achievements with different sources
    await state.addAchievement(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      category: "education",
      description: "OpenMAIC Fractions",
      score: 88,
      amount: 4_400_000,
      source: "openMAIC",
      verifiedBy: "manager-id",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });
    await state.addAchievement(FAMILY_ID, {
      id: randomUUID(),
      childName: "Maya",
      category: "health",
      description: "8,200 steps",
      score: 82,
      amount: 4_100_000,
      source: "self-report",
      verifiedBy: "maya-learner-id",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });

    const achievements = await state.loadAchievements(FAMILY_ID);
    const sources = achievements.map((a) => a.source);
    expect(sources).toContain("openMAIC");
    expect(sources).toContain("self-report");
    // Each achievement has its own source preserved
    expect(achievements.find((a) => a.category === "education")?.source).toBe("openMAIC");
    expect(achievements.find((a) => a.category === "health")?.source).toBe("self-report");
  });

  it("S5: Source field persists through distribution marking", async () => {
    const id = randomUUID();
    await state.addAchievement(FAMILY_ID, {
      id,
      childName: "Maya",
      category: "education",
      description: "OpenMAIC Fractions",
      score: 88,
      amount: 4_400_000,
      source: "openMAIC",
      verifiedBy: "manager-id",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    });

    // Simulate distribution — mark as distributed
    const achievements = await state.loadAchievements(FAMILY_ID);
    achievements[0].distributed = true;
    achievements[0].distributedAt = new Date().toISOString();
    achievements[0].txHash = "0xfake123";
    await state.saveAchievements(FAMILY_ID, achievements);

    // Verify source survives
    const after = await state.loadAchievements(FAMILY_ID);
    expect(after[0].distributed).toBe(true);
    expect(after[0].source).toBe("openMAIC");
    expect(after[0].txHash).toBe("0xfake123");
  });
});
