import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../src/engine/policy.js";
import type { ChildConfig } from "../src/schemas.js";

const engine = new PolicyEngine();

const mockChild: ChildConfig = {
  name: "Maya",
  walletName: "child-maya",
  weeklyBudget: 15_000_000, // $15.00
  categoryBudgets: {
    education: 5_000_000, // $5.00
    health: 5_000_000,
    personal: 5_000_000,
  },
  savingsPercent: 20,
  savingsLockDays: 90,
};

describe("PolicyEngine.evaluateAchievement", () => {
  it("returns full category budget for score=100", () => {
    const amount = engine.evaluateAchievement(100, "education", mockChild);
    expect(amount).toBe(5_000_000);
  });

  it("returns zero for score=0", () => {
    const amount = engine.evaluateAchievement(0, "health", mockChild);
    expect(amount).toBe(0);
  });

  it("returns 50% of category budget for score=50", () => {
    const amount = engine.evaluateAchievement(50, "personal", mockChild);
    expect(amount).toBe(2_500_000);
  });

  it("rounds correctly for non-even scores", () => {
    const amount = engine.evaluateAchievement(33, "education", mockChild);
    // 33/100 * 5_000_000 = 1_650_000
    expect(amount).toBe(1_650_000);
  });

  it("works with different categories", () => {
    const ed = engine.evaluateAchievement(80, "education", mockChild);
    const hp = engine.evaluateAchievement(80, "health", mockChild);
    const pe = engine.evaluateAchievement(80, "personal", mockChild);
    expect(ed).toBe(4_000_000);
    expect(hp).toBe(4_000_000);
    expect(pe).toBe(4_000_000);
  });

  it("handles unequal category budgets", () => {
    const unequalChild: ChildConfig = {
      ...mockChild,
      categoryBudgets: { education: 10_000_000, health: 3_000_000, personal: 2_000_000 },
    };
    expect(engine.evaluateAchievement(100, "education", unequalChild)).toBe(10_000_000);
    expect(engine.evaluateAchievement(100, "health", unequalChild)).toBe(3_000_000);
    expect(engine.evaluateAchievement(100, "personal", unequalChild)).toBe(2_000_000);
  });
});

describe("PolicyEngine.calculateSavingsSplit", () => {
  it("splits 20% to savings", () => {
    const { childAmount, savingsAmount } = engine.calculateSavingsSplit(10_000_000, 20);
    expect(savingsAmount).toBe(2_000_000);
    expect(childAmount).toBe(8_000_000);
  });

  it("0% savings means child gets all", () => {
    const { childAmount, savingsAmount } = engine.calculateSavingsSplit(10_000_000, 0);
    expect(savingsAmount).toBe(0);
    expect(childAmount).toBe(10_000_000);
  });

  it("100% savings means child gets nothing", () => {
    const { childAmount, savingsAmount } = engine.calculateSavingsSplit(10_000_000, 100);
    expect(savingsAmount).toBe(10_000_000);
    expect(childAmount).toBe(0);
  });

  it("preserves total (no rounding loss)", () => {
    const total = 7_777_777;
    const { childAmount, savingsAmount } = engine.calculateSavingsSplit(total, 30);
    expect(childAmount + savingsAmount).toBe(total);
  });
});

describe("PolicyEngine.evaluateStreak", () => {
  it("returns 1.0x for streaks under 7", () => {
    expect(engine.evaluateStreak(0)).toBe(1.0);
    expect(engine.evaluateStreak(6)).toBe(1.0);
  });

  it("returns 1.1x for 7-day streak", () => {
    expect(engine.evaluateStreak(7)).toBe(1.1);
  });

  it("returns 1.2x for 14-day streak", () => {
    expect(engine.evaluateStreak(14)).toBe(1.2);
  });

  it("caps at 2.0x", () => {
    expect(engine.evaluateStreak(200)).toBe(2.0);
  });

  it("correctly increments at boundaries", () => {
    expect(engine.evaluateStreak(13)).toBe(1.1);
    expect(engine.evaluateStreak(21)).toBe(1.3);
  });
});

describe("PolicyEngine.checkWeeklyBudget", () => {
  it("allows spending within budget", () => {
    const result = engine.checkWeeklyBudget(5_000_000, 3_000_000, 15_000_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(7_000_000);
  });

  it("denies spending that exceeds budget", () => {
    const result = engine.checkWeeklyBudget(14_000_000, 2_000_000, 15_000_000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("exceed weekly budget");
  });

  it("allows spending exactly at budget limit", () => {
    const result = engine.checkWeeklyBudget(10_000_000, 5_000_000, 15_000_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });
});

describe("PolicyEngine.checkCategoryBudget", () => {
  it("allows spending within category", () => {
    const result = engine.checkCategoryBudget(2_000_000, 1_000_000, 5_000_000, "education");
    expect(result.allowed).toBe(true);
  });

  it("denies spending that exceeds category", () => {
    const result = engine.checkCategoryBudget(4_500_000, 1_000_000, 5_000_000, "health");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("health budget");
  });
});
