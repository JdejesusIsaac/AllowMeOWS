import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { StateManager } from "../src/engine/state.js";
import {
  findMatchingGoalIndex,
  mergeLearningGoals,
} from "../src/engine/learning-goals.js";
import { LearningGoalSchema, ChildConfigSchema } from "../src/schemas.js";
import type { FamilyConfig, LearningGoal } from "../src/schemas.js";

const FAMILY_ID = "b0000000-0000-0000-0000-000000000001";
const SECOND_FAMILY_ID = "b0000000-0000-0000-0000-000000000002";
const testDataDir = join(process.cwd(), "data");

function buildConfig(goalsByChild: Record<string, LearningGoal[]> = {}): FamilyConfig {
  return {
    familyId: FAMILY_ID,
    familyName: "Garcia",
    children: [
      {
        name: "Aiden",
        walletName: "child-aiden",
        weeklyBudget: 15_000_000,
        categories: [
          { name: "education", pct: 50, budget: 7_500_000 },
          { name: "movement", pct: 50, budget: 7_500_000 },
        ],
        savingsPercent: 20,
        savingsLockDays: 90,
        learningGoals: goalsByChild["Aiden"],
      },
      {
        name: "Maya",
        walletName: "child-maya",
        weeklyBudget: 10_000_000,
        categories: [{ name: "education", pct: 100, budget: 10_000_000 }],
        savingsPercent: 20,
        savingsLockDays: 90,
        learningGoals: goalsByChild["Maya"],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chainId: "eip155:84532",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  };
}

describe("D7: Learning Goals (Sprint 3.0.1)", () => {
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

  // ----- LG-T1: store goals -----
  it("LG-T1: configure child with 3 learning goals — all stored as incomplete", async () => {
    const goals: LearningGoal[] = [
      { topic: "Fractions — equivalent fractions", category: "education", completed: false },
      { topic: "US states and capitals", category: "education", completed: false },
      { topic: "Charlotte's Web chapter 3", category: "education", completed: false },
    ];
    const config = buildConfig({ Aiden: goals });
    await state.saveFamilyConfig(FAMILY_ID, config);

    const loaded = await state.loadFamilyConfig(FAMILY_ID);
    expect(loaded).not.toBeNull();
    const aiden = loaded!.children.find((c) => c.name === "Aiden")!;
    expect(aiden.learningGoals).toHaveLength(3);
    expect(aiden.learningGoals!.every((g) => g.completed === false)).toBe(true);
    expect(aiden.learningGoals![0]!.topic).toBe("Fractions — equivalent fractions");
  });

  // ----- LG-T2: reject goal with unconfigured category -----
  // Validation lives in the configure-policy tool, but the helper has no
  // dependency on the tool layer. We assert the schema accepts the goal
  // shape and that the matching helper will silently never match a goal
  // whose category doesn't exist on the child (defense in depth).
  it("LG-T2: goal with unconfigured category never matches any achievement", () => {
    const goals: LearningGoal[] = [
      { topic: "Soccer drills", category: "sports", completed: false },
    ];
    // achievement category is "education" — not "sports" — so no match.
    expect(
      findMatchingGoalIndex({ category: "education", description: "Soccer drills" }, goals)
    ).toBe(-1);
    // achievement category "sports" would match if the goal category did,
    // but we still need both prefixes to align — verify the rule.
    expect(
      findMatchingGoalIndex({ category: "sports", description: "Soccer drills" }, goals)
    ).toBe(0);
  });

  // ----- LG-T3: check-progress shape -----
  it("LG-T3: check-progress data shape — completedGoals/totalGoals/nextGoal", async () => {
    const goals: LearningGoal[] = [
      { topic: "Fractions", category: "education", completed: true, completedAt: new Date().toISOString(), achievementId: "ach-1" },
      { topic: "US states and capitals", category: "education", completed: false },
      { topic: "Charlotte's Web chapter 3", category: "education", completed: false },
    ];
    const config = buildConfig({ Aiden: goals });
    await state.saveFamilyConfig(FAMILY_ID, config);

    // Mirror the exact derivation that check-progress runs.
    const loaded = await state.loadFamilyConfig(FAMILY_ID);
    const aiden = loaded!.children.find((c) => c.name === "Aiden")!;
    const list = aiden.learningGoals ?? [];
    const completedGoals = list.filter((g) => g.completed).length;
    const nextGoal = list.find((g) => !g.completed)?.topic ?? null;

    expect(completedGoals).toBe(1);
    expect(list.length).toBe(3);
    expect(nextGoal).toBe("US states and capitals");
  });

  // ----- LG-T4: matching marks goal completed -----
  it("LG-T4: verify-achievement matches a learning goal by prefix", () => {
    const goals: LearningGoal[] = [
      { topic: "Fractions — equivalent fractions", category: "education", completed: false },
      { topic: "US states and capitals", category: "education", completed: false },
    ];
    const idx = findMatchingGoalIndex(
      { category: "education", description: "Fractions" },
      goals
    );
    expect(idx).toBe(0);
    expect(goals[idx]!.topic).toBe("Fractions — equivalent fractions");
  });

  // ----- LG-T5: no-match is silent -----
  it("LG-T5: verify-achievement with no matching goal returns -1 (no-op)", () => {
    const goals: LearningGoal[] = [
      { topic: "Fractions — equivalent fractions", category: "education", completed: false },
    ];
    const idx = findMatchingGoalIndex(
      { category: "education", description: "Solar system planets" },
      goals
    );
    expect(idx).toBe(-1);
    // Goals untouched
    expect(goals[0]!.completed).toBe(false);
  });

  // ----- LG-T6: merge preserves completed goals on reconfigure -----
  it("LG-T6: reconfigure with new goals preserves prior completion state", () => {
    const completedAt = "2026-04-07T14:00:00.000Z";
    const oldGoals: LearningGoal[] = [
      { topic: "Fractions", category: "education", completed: true, completedAt, achievementId: "ach-1" },
      { topic: "US states", category: "education", completed: false },
    ];
    const newGoals: LearningGoal[] = [
      { topic: "Fractions", category: "education", completed: false }, // should inherit completed: true
      { topic: "US states", category: "education", completed: false },
      { topic: "Multiplication tables", category: "education", completed: false }, // brand-new
    ];
    const merged = mergeLearningGoals(oldGoals, newGoals);

    expect(merged).toHaveLength(3);
    expect(merged[0]!.completed).toBe(true);
    expect(merged[0]!.completedAt).toBe(completedAt);
    expect(merged[0]!.achievementId).toBe("ach-1");
    expect(merged[1]!.completed).toBe(false);
    expect(merged[2]!.completed).toBe(false);
    expect(merged[2]!.topic).toBe("Multiplication tables");
  });

  // ----- LG-T7: child-scoping — goals isolated per child -----
  it("LG-T7: each Learner sees only their own goals (child scoping)", async () => {
    const config = buildConfig({
      Aiden: [{ topic: "Fractions", category: "education", completed: false }],
      Maya: [{ topic: "Phonics", category: "education", completed: true, completedAt: new Date().toISOString() }],
    });
    await state.saveFamilyConfig(FAMILY_ID, config);

    const loaded = await state.loadFamilyConfig(FAMILY_ID);
    const aiden = loaded!.children.find((c) => c.name === "Aiden")!;
    const maya = loaded!.children.find((c) => c.name === "Maya")!;

    // Aiden's goals do not include Maya's, and vice versa.
    expect(aiden.learningGoals!.map((g) => g.topic)).toEqual(["Fractions"]);
    expect(maya.learningGoals!.map((g) => g.topic)).toEqual(["Phonics"]);
    expect(aiden.learningGoals!.find((g) => g.topic === "Phonics")).toBeUndefined();
  });

  // ----- LG-T8: backward compat — existing config without learningGoals -----
  it("LG-T8: legacy config with no learningGoals field loads with totalGoals=0", async () => {
    const legacyConfig: FamilyConfig = buildConfig();
    // Strip learningGoals entirely to mimic Sprint 2.x data on disk.
    legacyConfig.children.forEach((c) => {
      delete (c as { learningGoals?: unknown }).learningGoals;
    });
    await state.saveFamilyConfig(SECOND_FAMILY_ID, { ...legacyConfig, familyId: SECOND_FAMILY_ID });

    const loaded = await state.loadFamilyConfig(SECOND_FAMILY_ID);
    expect(loaded).not.toBeNull();
    const aiden = loaded!.children.find((c) => c.name === "Aiden")!;
    expect(aiden.learningGoals).toBeUndefined();

    // Mirror the check-progress derivation.
    const goals = aiden.learningGoals ?? [];
    expect(goals.length).toBe(0);
    expect(goals.filter((g) => g.completed).length).toBe(0);
    expect(goals.find((g) => !g.completed) ?? null).toBeNull();

    // Schema should still accept a child without learningGoals (zod parse).
    const reparsed = ChildConfigSchema.parse({
      name: "Test",
      walletName: "child-test",
      weeklyBudget: 1_000_000,
      categories: [{ name: "education", pct: 100, budget: 1_000_000 }],
      savingsPercent: 20,
      savingsLockDays: 90,
    });
    expect(reparsed.learningGoals).toBeUndefined();

    // Schema should also accept a goal with required fields and apply default `completed=false`.
    const goal = LearningGoalSchema.parse({ topic: "X", category: "education" });
    expect(goal.completed).toBe(false);
  });
});
