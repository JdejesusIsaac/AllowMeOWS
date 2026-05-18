import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import { USDC } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  getChildScope,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";
import { renderProgressBar, formatUsdFromMicro } from "../utils/card-formatting.js";

/**
 * Sprint 3.6 rich markdown card (contract C3 CARD1): progress bar + $ + 🔥/⏳ + 👉
 */
export function buildCheckProgressRichMarkdown(input: {
  childName: string;
  weeklyBudgetMicro: number;
  totalEarnedMicro: number;
  pendingMicro: number;
  categories: Array<{ name: string; budget: number }>;
  byCatEarned: Record<string, number>;
  streak: { currentStreak: number; multiplier: number } | null;
  hasEarnedOrPending: boolean;
}): string {
  const streakDays = input.streak?.currentStreak ?? 0;
  const mult = input.streak?.multiplier ?? 1;
  const streakEmoji =
    streakDays >= 7 ? "🔥" : streakDays >= 1 ? "🔥" : "⏳";
  const weekBar = renderProgressBar(
    input.totalEarnedMicro,
    Math.max(input.weeklyBudgetMicro, 1),
    10,
  );

  const lines: string[] = [`**${input.childName}'s week so far**`, ""];

  if (!input.hasEarnedOrPending) {
    lines.push(
      `Earned: ${formatUsdFromMicro(0)} / ${formatUsdFromMicro(input.weeklyBudgetMicro)} ${weekBar}`,
    );
    lines.push(`Streak: ${streakDays} days ${streakEmoji} (${mult}x multiplier)`);
    lines.push("");
    lines.push("**Categories**");
    for (const cat of input.categories) {
      const bar = renderProgressBar(0, Math.max(cat.budget, 1), 10);
      lines.push(
        `${cat.name}   ${formatUsdFromMicro(0)} / ${formatUsdFromMicro(cat.budget)} ${bar}`,
      );
    }
    lines.push("");
    lines.push(
      "👉 Log your first achievement this week to start filling the bar and light the streak.",
    );
    return lines.join("\n");
  }

  lines.push(
    `Earned: ${formatUsdFromMicro(input.totalEarnedMicro)} / ${formatUsdFromMicro(input.weeklyBudgetMicro)} ${weekBar}`,
  );
  lines.push(
    `Streak: ${streakDays} days ${streakEmoji} (${mult}x multiplier)`,
  );
  lines.push("");
  lines.push("**Categories**");
  for (const cat of input.categories) {
    const e = input.byCatEarned[cat.name] ?? 0;
    const bar = renderProgressBar(e, Math.max(cat.budget, 1), 10);
    lines.push(
      `${cat.name}   ${formatUsdFromMicro(e)} / ${formatUsdFromMicro(cat.budget)} ${bar}`,
    );
  }
  if (input.pendingMicro > 0) {
    lines.push("");
    lines.push(
      `⏳ ${formatUsdFromMicro(input.pendingMicro)} is pending distribution — ask a parent to run **distribute-allowance** when ready.`,
    );
  }
  lines.push("");
  lines.push("👉 Log something today to keep your streak going.");
  return lines.join("\n");
}

export async function checkProgressHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null,
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("check-progress");
  const requestedChildArg = args.childName as string | undefined;
  try {
    const state = new StateManager();
    const familyId = caller.familyId;
    const config = await state.loadFamilyConfig(familyId);

    if (!config) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: false, error: "No family configured." }),
        }],
      };
    }

    const achievements = await state.loadAchievements(familyId);

    const childScope = getChildScope(caller);
    const requestedChild = childScope || requestedChildArg;

    const children = requestedChild
      ? config.children.filter((c) => c.name.toLowerCase() === requestedChild.toLowerCase())
      : config.children;

    if (children.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: false, error: `Child "${requestedChildArg}" not found.` }),
        }],
      };
    }

    type ReportRow = Record<string, unknown>;
    const reports: ReportRow[] = [];
    const progressCardsForSingleScope: string[] = [];

    for (const child of children) {
      const childAchievements = achievements.filter(
        (a) => a.childName.toLowerCase() === child.name.toLowerCase(),
      );

      const weekStart = getWeekStart();
      const thisWeek = childAchievements.filter(
        (a) => new Date(a.verifiedAt) >= weekStart,
      );

      const totalEarned = thisWeek.reduce((sum, a) => sum + a.amount, 0);
      const distributed = thisWeek.filter((a) => a.distributed).reduce((sum, a) => sum + a.amount, 0);
      const pending = thisWeek.filter((a) => !a.distributed).reduce((sum, a) => sum + a.amount, 0);

      const byCat: Record<string, {
        earned: number;
        details: Array<{ description: string; score: number; amount: number; source: string; verifiedBy: string }>;
      }> = {};
      for (const cat of child.categories || []) {
        byCat[cat.name] = { earned: 0, details: [] };
      }
      for (const a of thisWeek) {
        if (!byCat[a.category]) {
          byCat[a.category] = { earned: 0, details: [] };
        }
        byCat[a.category].earned += a.amount;
        byCat[a.category].details.push({
          description: a.description,
          score: a.score,
          amount: a.amount,
          source: (a as Record<string, unknown>).source as string || "manual",
          verifiedBy: a.verifiedBy,
        });
      }

      const byCatEarned: Record<string, number> = {};
      for (const k of Object.keys(byCat)) {
        byCatEarned[k] = byCat[k].earned;
      }

      const streak = await state.loadStreak(familyId, child.name);

      const savings = await state.loadSavingsEntries(familyId, child.name);
      const totalSaved = savings.reduce((sum, s) => sum + s.amount, 0);
      const lockedSavings = savings.filter((s) => !s.released).reduce((sum, s) => sum + s.amount, 0);

      const goals = child.learningGoals ?? [];
      const completedGoals = goals.filter((g) => g.completed).length;
      const nextGoal = goals.find((g) => !g.completed)?.topic ?? null;

      const hasEarned = totalEarned > 0;
      const hasPendingOnly = pending > 0 && !hasEarned;
      const streakDays = streak?.currentStreak ?? 0;
      const streakMultiplier = streak?.multiplier ?? 1.0;
      const daysToNextStreakLevel = streakDays > 0 ? 7 - (streakDays % 7) : 7;
      const nextMultiplier = Math.min(2.0, streakMultiplier + 0.1);

      let summary: string;
      if (!hasEarned && childAchievements.length === 0) {
        summary =
          `Fresh start for ${child.name} this week! No achievements logged yet. ` +
          `Try saying "${child.name} read for 30 minutes today, score 85, reading" ` +
          `to log your first one and start a streak.`;
      } else if (!hasEarned && thisWeek.length === 0 && childAchievements.length > 0) {
        summary =
          `${child.name} hasn't logged anything this week yet. Your overall streak ` +
          `is ${streakDays} day${streakDays === 1 ? "" : "s"} at ${streakMultiplier}x — ` +
          `complete an achievement today to keep it going.`;
      } else if (hasPendingOnly) {
        summary =
          `${child.name} has $${(pending / 10 ** USDC.DECIMALS).toFixed(2)} pending ` +
          `distribution. Ask your parent to run distribute-allowance when ready.`;
      } else {
        const streakNote = streakDays > 0 && streakMultiplier < 2.0
          ? ` ${daysToNextStreakLevel} more day${daysToNextStreakLevel === 1 ? "" : "s"} ` +
            `at this pace and your multiplier goes to ${nextMultiplier}x.`
          : streakMultiplier >= 2.0
            ? ` You're at the max 2x streak multiplier — keep it going!`
            : "";
        summary =
          `${child.name} this week: $${(totalEarned / 10 ** USDC.DECIMALS).toFixed(2)} ` +
          `earned across ${thisWeek.length} achievement${thisWeek.length === 1 ? "" : "s"}. ` +
          `Streak: ${streakDays} day${streakDays === 1 ? "" : "s"} (${streakMultiplier}x).` +
          streakNote;
      }

      const categoriesStructured = Object.fromEntries(
        (child.categories || []).map((cat) => {
          const catData = byCat[cat.name] || { earned: 0, details: [] };
          return [cat.name, {
            earned: `$${(catData.earned / 10 ** USDC.DECIMALS).toFixed(2)}`,
            budget: `$${(cat.budget / 10 ** USDC.DECIMALS).toFixed(2)}`,
            achievements: catData.details.map((d) => ({
              description: d.description,
              score: d.score,
              amountUsd: (d.amount / 10 ** USDC.DECIMALS).toFixed(2),
              source: d.source,
            })),
          }];
        }),
      );

      progressCardsForSingleScope.push(
        buildCheckProgressRichMarkdown({
          childName: child.name,
          weeklyBudgetMicro: child.weeklyBudget,
          totalEarnedMicro: totalEarned,
          pendingMicro: pending,
          categories: child.categories || [],
          byCatEarned,
          streak,
          hasEarnedOrPending: hasEarned || pending > 0,
        }),
      );

      reports.push({
        childName: child.name,
        summary,
        weeklyBudgetMicro: child.weeklyBudget,
        earnedMicro: totalEarned,
        pendingMicro: pending,
        weeklyBudgetUsd: (child.weeklyBudget / 10 ** USDC.DECIMALS).toFixed(2),
        totalEarnedUsd: (totalEarned / 10 ** USDC.DECIMALS).toFixed(2),
        distributedUsd: (distributed / 10 ** USDC.DECIMALS).toFixed(2),
        pendingUsd: (pending / 10 ** USDC.DECIMALS).toFixed(2),
        categories: categoriesStructured,
        achievementsThisWeek: thisWeek.length,
        totalAchievements: childAchievements.length,
        streak: streak
          ? {
              current: streak.currentStreak,
              longest: streak.longestStreak,
              multiplier: streak.multiplier,
            }
          : null,
        savingsTotalUsd: (totalSaved / 10 ** USDC.DECIMALS).toFixed(2),
        savingsLockedUsd: (lockedSavings / 10 ** USDC.DECIMALS).toFixed(2),
        learningGoals: goals,
        completedGoals,
        totalGoals: goals.length,
        nextGoal,
      });
    }

    const payload: Record<string, unknown> = { success: true, reports };

    if (reports.length === 1) {
      const r = reports[0]!;
      payload.summary = progressCardsForSingleScope[0]!;
      payload.earned = r.earnedMicro;
      payload.pending = r.pendingMicro;
      payload.streak = r.streak;
      payload.categories = r.categories;
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(payload),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      }],
    };
  }
}

export function registerCheckProgressTool(server: McpServer): void {
  server.tool(
    "check-progress",
    "Check a child's weekly progress, achievements, streaks, and savings balance.",
    {
      childName: z.string().optional().describe("Check a specific child, or all children if omitted"),
      ...rbacFields,
    },
    withAccessControl("check-progress", checkProgressHandler),
  );
}

function getWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}
