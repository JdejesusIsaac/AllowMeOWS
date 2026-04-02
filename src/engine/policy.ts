import type { ChildConfig, CategoryType } from "../schemas.js";
import { USDC } from "../constants.js";

export class PolicyEngine {
  /**
   * Calculate USDC amount earned for an achievement based on score and category budget.
   * Score 0-100 maps linearly to 0-100% of the category's budget allocation.
   */
  evaluateAchievement(
    score: number,
    category: CategoryType,
    childConfig: ChildConfig
  ): number {
    const categoryBudget = childConfig.categoryBudgets[category];
    // Linear mapping: score/100 * category budget
    const amount = Math.round((score / 100) * categoryBudget);
    return amount;
  }

  /**
   * Split a total amount into child wallet portion and savings vault portion.
   */
  calculateSavingsSplit(
    totalAmount: number,
    savingsPercent: number
  ): { childAmount: number; savingsAmount: number } {
    const savingsAmount = Math.round(totalAmount * (savingsPercent / 100));
    const childAmount = totalAmount - savingsAmount;
    return { childAmount, savingsAmount };
  }

  /**
   * Evaluate streak bonus. Returns the multiplier for the current streak level.
   * Every 7 consecutive days adds 0.1x (10%) bonus, up to 2.0x max.
   */
  evaluateStreak(currentStreak: number): number {
    const BONUS_THRESHOLD = 7;
    const INCREMENT = 0.1;
    const MAX = 2.0;

    const levels = Math.floor(currentStreak / BONUS_THRESHOLD);
    return Math.min(1.0 + levels * INCREMENT, MAX);
  }

  /**
   * Check if a weekly budget would be exceeded by adding a new amount.
   */
  checkWeeklyBudget(
    currentWeeklySpend: number,
    newAmount: number,
    weeklyBudget: number
  ): { allowed: boolean; remaining: number; reason?: string } {
    const remaining = weeklyBudget - currentWeeklySpend;
    if (newAmount > remaining) {
      return {
        allowed: false,
        remaining,
        reason: `Would exceed weekly budget. Remaining: $${(remaining / 10 ** USDC.DECIMALS).toFixed(2)}`,
      };
    }
    return { allowed: true, remaining: remaining - newAmount };
  }

  /**
   * Check if a category budget would be exceeded.
   */
  checkCategoryBudget(
    currentCategorySpend: number,
    newAmount: number,
    categoryBudget: number,
    category: string
  ): { allowed: boolean; remaining: number; reason?: string } {
    const remaining = categoryBudget - currentCategorySpend;
    if (newAmount > remaining) {
      return {
        allowed: false,
        remaining,
        reason: `Would exceed ${category} budget. Remaining: $${(remaining / 10 ** USDC.DECIMALS).toFixed(2)}`,
      };
    }
    return { allowed: true, remaining: remaining - newAmount };
  }
}
