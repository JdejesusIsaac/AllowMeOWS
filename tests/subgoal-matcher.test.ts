/**
 * Sprint 3.7 — AM1–AM7 subgoal auto-matching tests.
 *
 * Verifies the matcher's behaviour at each confidence band:
 *   • substring / fuzzy ≥0.85 → auto-completes subgoal, writes audit entry
 *   • 0.65–0.85 → surfaces hint copy, no state mutation
 *   • <0.65 → silent
 *   • already-completed subgoals don't double-fire
 *   • false-positive prevention on cross-category and unrelated content
 *   • parent manual completion via configure-policy is idempotent with auto
 *
 * Drives `verifyAchievementHandler` directly (mirrors `tests/rich-cards.test.ts`
 * pattern) and asserts on family config + audit log via `StateManager`. No
 * MCP transport, no HTTP server.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { verifyAchievementHandler } from "../src/tools/verify-achievement.js";
import { StateManager } from "../src/engine/state.js";
import { mergeLearningGoals } from "../src/engine/learning-goals.js";
import { createTestFamily, makeChild } from "./helpers/family.js";
import type { FamilyConfig, LearningGoal } from "../src/schemas.js";

const testDataDir = join(process.cwd(), "data");

async function setLearningGoals(
  state: StateManager,
  familyId: string,
  childName: string,
  goals: LearningGoal[],
): Promise<void> {
  const config = (await state.loadFamilyConfig(familyId)) as FamilyConfig;
  const child = config.children.find(
    (c) => c.name.toLowerCase() === childName.toLowerCase(),
  );
  if (!child) throw new Error(`child ${childName} not found in test family`);
  child.learningGoals = goals;
  await state.saveFamilyConfig(familyId, config);
}

async function loadSubgoal(
  state: StateManager,
  familyId: string,
  childName: string,
  goalIndex: number,
  subgoalIndex: number,
) {
  const config = await state.loadFamilyConfig(familyId);
  const child = config?.children.find(
    (c) => c.name.toLowerCase() === childName.toLowerCase(),
  );
  return child?.learningGoals?.[goalIndex]?.subgoals?.[subgoalIndex];
}

describe("AM: subgoal auto-matching", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("AM1: exact substring match auto-completes subgoal and writes audit entry", async () => {
    const family = await createTestFamily({
      familyName: "Isaac Family",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
        }),
      ],
    });
    await setLearningGoals(family.state, family.familyId, "Aiden", [
      {
        topic: "Read about history",
        category: "reading",
        completed: false,
        subgoals: [
          { topic: "Ancient Greece reading", completed: false },
          { topic: "Roman empire history", completed: false },
        ],
      },
    ]);

    const res = await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "reading",
        description: "Read 30 minutes about Ancient Greece reading today",
        score: 85,
        ...family.asManager(),
      },
      family.managerContext,
    );
    const body = JSON.parse(res.content[0]!.text);
    expect(body.success).toBe(true);

    // First subgoal flipped, second untouched.
    const sg0 = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 0);
    const sg1 = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 1);
    expect(sg0?.completed).toBe(true);
    expect(sg1?.completed).toBe(false);

    // Audit entry recorded with all required fields.
    const audit = await family.state.loadAuditLog(family.familyId);
    const entry = audit.find((e) => e.action === "subgoal-auto-completed");
    expect(entry).toBeDefined();
    expect(entry?.actor).toBe(family.memberId);
    expect(entry?.details).toMatchObject({
      subgoalTopic: "Ancient Greece reading",
      goalTopic: "Read about history",
      matchType: "substring",
    });
    expect(typeof entry?.details.confidence).toBe("number");
    expect(entry?.details.confidence as number).toBeGreaterThanOrEqual(0.85);

    // Response card surfaces the auto-completion line.
    expect(body.subgoalAutoCompleted).toBe("Ancient Greece reading");
    expect(body.subgoalMatchType).toBe("substring");
    expect(body.summary).toMatch(/subgoal completed.*Ancient Greece reading/i);
  });

  it("AM2: high-confidence fuzzy match auto-completes subgoal", async () => {
    const family = await createTestFamily({
      familyName: "Isaac Family",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
        }),
      ],
    });
    await setLearningGoals(family.state, family.familyId, "Aiden", [
      {
        topic: "Read about history",
        category: "reading",
        completed: false,
        subgoals: [{ topic: "ancient greece reading", completed: false }],
      },
    ]);

    // Reordered tokens, slight noise — substring direction (subgoal in
    // description) still fires confidence 1.0.
    const res = await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "reading",
        description: "Today I did some Ancient Greece reading for school",
        score: 85,
        ...family.asManager(),
      },
      family.managerContext,
    );
    const body = JSON.parse(res.content[0]!.text);
    expect(body.success).toBe(true);

    const sg = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 0);
    expect(sg?.completed).toBe(true);
    expect(body.subgoalAutoCompleted).toBeTruthy();
  });

  it("AM3: ambiguous match (0.65 ≤ conf < 0.85) surfaces hint, does NOT auto-complete", async () => {
    const family = await createTestFamily({
      familyName: "Isaac Family",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
        }),
      ],
    });
    // Construct a topic that scores ≥0.65 but <0.85 against the description
    // via Dice coefficient on bigrams. "ancient civilizations chapter" vs
    // "read a chapter about ancient civilizations today" shares enough
    // bigrams to clear the floor without hitting the auto-complete cap.
    await setLearningGoals(family.state, family.familyId, "Aiden", [
      {
        topic: "Read about history",
        category: "reading",
        completed: false,
        subgoals: [
          { topic: "ancient civilizations chapter", completed: false },
        ],
      },
    ]);

    const res = await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "reading",
        description: "read a chapter about ancient civilizations today",
        score: 80,
        ...family.asManager(),
      },
      family.managerContext,
    );
    const body = JSON.parse(res.content[0]!.text);

    // Subgoal NOT flipped.
    const sg = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 0);
    expect(sg?.completed).toBe(false);

    // Hint surfaced in response.
    expect(body.subgoalAutoCompleted).toBeFalsy();
    expect(body.subgoalHint).toBe("ancient civilizations chapter");
    expect(typeof body.subgoalMatchConfidence).toBe("number");
    expect(body.subgoalMatchConfidence).toBeGreaterThanOrEqual(0.65);
    expect(body.subgoalMatchConfidence).toBeLessThan(0.85);
    expect(body.summary).toMatch(/possible match for subgoal/i);

    // No `subgoal-auto-completed` audit entry written.
    const audit = await family.state.loadAuditLog(family.familyId);
    const entry = audit.find((e) => e.action === "subgoal-auto-completed");
    expect(entry).toBeUndefined();
  });

  it("AM4: low-similarity match (<0.65) stays silent — no auto-completion, no hint", async () => {
    const family = await createTestFamily({
      familyName: "Isaac Family",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
        }),
      ],
    });
    await setLearningGoals(family.state, family.familyId, "Aiden", [
      {
        topic: "Read about history",
        category: "reading",
        completed: false,
        subgoals: [{ topic: "Ancient Greece reading", completed: false }],
      },
    ]);

    // Same category but the description has no meaningful bigram overlap.
    const res = await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "reading",
        description: "Read a Goosebumps book",
        score: 75,
        ...family.asManager(),
      },
      family.managerContext,
    );
    const body = JSON.parse(res.content[0]!.text);

    const sg = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 0);
    expect(sg?.completed).toBe(false);
    expect(body.subgoalAutoCompleted).toBeFalsy();
    expect(body.subgoalHint).toBeFalsy();
    expect(body.summary).not.toMatch(/Ancient Greece reading/);
    expect(body.summary).not.toMatch(/subgoal completed|possible match for subgoal/i);
  });

  it("AM5: already-completed subgoal does not double-fire", async () => {
    const family = await createTestFamily({
      familyName: "Isaac Family",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
        }),
      ],
    });
    await setLearningGoals(family.state, family.familyId, "Aiden", [
      {
        topic: "Read about history",
        category: "reading",
        completed: false,
        subgoals: [{ topic: "Ancient Greece reading", completed: true }],
      },
    ]);

    const res = await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "reading",
        description: "Read more about Ancient Greece reading today",
        score: 85,
        ...family.asManager(),
      },
      family.managerContext,
    );
    const body = JSON.parse(res.content[0]!.text);

    const audit = await family.state.loadAuditLog(family.familyId);
    const entries = audit.filter((e) => e.action === "subgoal-auto-completed");
    expect(entries.length).toBe(0);

    expect(body.subgoalAutoCompleted).toBeFalsy();
    expect(body.summary).not.toMatch(/subgoal completed.*Ancient Greece reading/i);
  });

  it("AM6: false-positive prevention — wrong category and unrelated content do NOT auto-complete (CRITICAL)", async () => {
    const family = await createTestFamily({
      familyName: "Isaac Family",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 10,
          categories: [
            { name: "reading", pct: 50 },
            { name: "math", pct: 50 },
          ],
        }),
      ],
    });
    await setLearningGoals(family.state, family.familyId, "Aiden", [
      {
        topic: "Read about history",
        category: "reading",
        completed: false,
        subgoals: [{ topic: "Ancient Greece reading", completed: false }],
      },
    ]);

    // Cross-category: math achievement that mentions ancient Greece in
    // text. Subgoal is under reading goal — category mismatch must short-
    // circuit the matcher before any text scoring.
    await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "math",
        description: "Did math homework about ancient Greek philosophers",
        score: 90,
        ...family.asManager(),
      },
      family.managerContext,
    );
    let sg = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 0);
    expect(sg?.completed).toBe(false);

    // Right category but unrelated content — must not score above floor.
    await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "reading",
        description: "Read a Goosebumps book",
        score: 80,
        ...family.asManager(),
      },
      family.managerContext,
    );
    sg = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 0);
    expect(sg?.completed).toBe(false);

    // No subgoal-auto-completed audit entries from either path.
    const audit = await family.state.loadAuditLog(family.familyId);
    const entries = audit.filter((e) => e.action === "subgoal-auto-completed");
    expect(entries.length).toBe(0);
  });

  it("AM7: parent manual completion via configure-policy is idempotent with auto-completion", async () => {
    const family = await createTestFamily({
      familyName: "Isaac Family",
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
        }),
      ],
    });
    await setLearningGoals(family.state, family.familyId, "Aiden", [
      {
        topic: "Read about history",
        category: "reading",
        completed: false,
        subgoals: [
          { topic: "Ancient Greece reading", completed: false },
          { topic: "Roman empire history", completed: false },
        ],
      },
    ]);

    // 1. Auto-complete first subgoal via verify-achievement.
    await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "reading",
        description: "Read about Ancient Greece reading for 30 min",
        score: 85,
        ...family.asManager(),
      },
      family.managerContext,
    );
    let sg0 = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 0);
    let sg1 = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 1);
    expect(sg0?.completed).toBe(true);
    expect(sg1?.completed).toBe(false);

    // 2. Parent manually completes the second subgoal — simulate the
    //    configure-policy persistence path by running the same merge helper
    //    the tool uses, then writing back. (Direct state mutation rather
    //    than the MCP tool keeps this test focused on idempotency rather
    //    than RBAC plumbing.)
    const config = (await family.state.loadFamilyConfig(family.familyId))!;
    const child = config.children.find((c) => c.name === "Aiden")!;
    child.learningGoals = mergeLearningGoals(child.learningGoals, [
      {
        topic: "Read about history",
        category: "reading",
        completed: false,
        subgoals: [
          { topic: "Ancient Greece reading", completed: true },
          { topic: "Roman empire history", completed: true },
        ],
      },
    ]);
    await family.state.saveFamilyConfig(family.familyId, config);

    // Both subgoals now read as completed. The auto path didn't fire a
    // second time, and no exceptions were thrown by the manual path
    // brushing past an already-auto-completed subgoal.
    sg0 = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 0);
    sg1 = await loadSubgoal(family.state, family.familyId, "Aiden", 0, 1);
    expect(sg0?.completed).toBe(true);
    expect(sg1?.completed).toBe(true);
    const audit = await family.state.loadAuditLog(family.familyId);
    const autoEntries = audit.filter(
      (e) => e.action === "subgoal-auto-completed",
    );
    expect(autoEntries.length).toBe(1);
  });
});
