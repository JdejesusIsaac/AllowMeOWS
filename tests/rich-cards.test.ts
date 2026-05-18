/**
 * Sprint 3.6 — CARD1–CARD4 rich markdown cards (contract C3 + C3a).
 *
 * Handlers are exercised directly (`evaluation/test.md` stubs use MCP transport
 * helpers that do not exist in this repo — see Decision D1 in progress.md).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { verifyAchievementHandler } from "../src/tools/verify-achievement.js";
import { checkProgressHandler } from "../src/tools/check-progress.js";
import { checkSavingsHandler } from "../src/tools/check-savings.js";
import { checkGoalsHandler } from "../src/tools/check-goals.js";
import { createTestFamily, makeChild } from "./helpers/family.js";
import type { ChildConfig } from "../src/schemas.js";

const testDataDir = join(process.cwd(), "data");

describe("CARD: rich response cards", () => {
  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("CARD1: check-progress returns rich card with progress bar, streak, next-action", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
        }),
      ],
    });

    await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "reading",
        description: "Read a chapter today",
        score: 85,
        ...family.asManager(),
      },
      family.managerContext,
    );

    const learner = await family.addMember("learner", {
      childName: "Aiden",
      name: "Aiden",
    });

    const res = await checkProgressHandler(
      {},
      learner.context,
    );
    const body = JSON.parse(res.content[0]!.text);

    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary).toBe("string");

    expect(body.summary).toMatch(/▓|░/);
    expect(body.summary).toMatch(/\$[\d.]+/);
    expect(body.summary).toMatch(/👉|🔥|⏳/);
    expect(body.summary).toMatch(/Aiden/);

    expect(body.earned).toBeDefined();
    expect(body.streak).toBeDefined();
    expect(body.categories).toBeDefined();
  });

  it("CARD2: check-savings rich card includes locked-vs-released breakdown", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
        }),
      ],
    });

    const learner = await family.addMember("learner", {
      childName: "Aiden",
      name: "Aiden",
    });

    const res = await checkSavingsHandler(
      {},
      learner.context,
    );
    const body = JSON.parse(res.content[0]!.text);

    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();
    expect(body.summary).toMatch(/Aiden/);
    expect(body.summary).toMatch(/\$0\.00|nothing|haven't/i);

    expect(body.lockedAmount).toBeDefined();
    expect(body.releasedAmount).toBeDefined();
    expect(body.currentMultiplier).toBeDefined();
  });

  it("CARD3: check-goals rich card includes status indicators and subgoal nesting", async () => {
    const base = makeChild("Aiden", {
      weeklyBudgetUsd: 10,
      categories: [
        { name: "math", pct: 50 },
        { name: "reading", pct: 50 },
      ],
    });

    const withGoals: ChildConfig = {
      ...base,
      learningGoals: [
        {
          topic: "Master 7th grade math",
          category: "math",
          completed: false,
          subgoals: [
            { topic: "Fractions", completed: false },
            { topic: "Decimals", completed: true },
          ],
        },
      ],
    };

    const family = await createTestFamily({
      children: [withGoals],
    });

    const learner = await family.addMember("learner", {
      childName: "Aiden",
      name: "Aiden",
    });

    const res = await checkGoalsHandler(
      {},
      learner.context,
    );
    const body = JSON.parse(res.content[0]!.text);

    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();
    expect(body.summary).toMatch(/✓|○|⏳/);
    expect(body.summary).toMatch(/Fractions/);
    expect(body.summary).toMatch(/Decimals/);

    const decimalsLine = body.summary.match(/.*Decimals.*/)![0];
    expect(decimalsLine).toMatch(/✓/);

    expect(Array.isArray(body.reports)).toBe(true);
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]?.goals).toBeDefined();
    expect(Array.isArray(body.reports[0]?.goals)).toBe(true);
  });

  it("CARD4: verify-achievement returns 'what changed' delta card", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Aiden", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
        }),
      ],
    });

    const res = await verifyAchievementHandler(
      {
        childName: "Aiden",
        category: "reading",
        description: "Read for 30 min",
        score: 85,
        ...family.asManager(),
      },
      family.managerContext,
    );
    const body = JSON.parse(res.content[0]!.text);

    expect(body.success).toBe(true);
    expect(body.summary).toBeDefined();
    expect(body.summary).toMatch(/\+\$[\d.]+/);
    expect(body.summary).toMatch(/streak|🔥/i);
    expect(body.summary).toMatch(/✓.*reading/i);

    expect(typeof body.delta).toBe("number");
    expect(body.delta).toBeGreaterThan(0);
    expect(typeof body.newStreak).toBe("number");
    expect(typeof body.newEarned).toBe("number");
  });
});
