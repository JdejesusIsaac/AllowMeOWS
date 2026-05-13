import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import { USDC } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  getChildScope,
  rbacFields,
} from "../middleware/access-control.js";

export function registerCheckProgressTool(server: McpServer): void {
  server.tool(
    "check-progress",
    "Check a child's weekly progress, achievements, streaks, and savings balance.",
    {
      childName: z.string().optional().describe("Check a specific child, or all children if omitted"),
      ...rbacFields,
    },
    withAccessControl("check-progress", async (args, caller) => {
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

        // Child-scoped filtering: learner sees only their own data
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

        const reports = [];

        for (const child of children) {
          const childAchievements = achievements.filter(
            (a) => a.childName.toLowerCase() === child.name.toLowerCase()
          );

          // This week's achievements
          const weekStart = getWeekStart();
          const thisWeek = childAchievements.filter(
            (a) => new Date(a.verifiedAt) >= weekStart
          );

          const totalEarned = thisWeek.reduce((sum, a) => sum + a.amount, 0);
          const distributed = thisWeek.filter((a) => a.distributed).reduce((sum, a) => sum + a.amount, 0);
          const pending = thisWeek.filter((a) => !a.distributed).reduce((sum, a) => sum + a.amount, 0);

          // Category breakdown with source provenance — dynamic from config
          const byCat: Record<string, { earned: number; details: Array<{ description: string; score: number; amount: number; source: string; verifiedBy: string }> }> = {};
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

          // Streak
          const streak = await state.loadStreak(familyId, child.name);

          // Savings
          const savings = await state.loadSavingsEntries(familyId, child.name);
          const totalSaved = savings.reduce((sum, s) => sum + s.amount, 0);
          const lockedSavings = savings.filter((s) => !s.released).reduce((sum, s) => sum + s.amount, 0);

          // Sprint 3.0.1: surface parent-defined learning goals so Claude
          // can prompt "Want to start on [nextGoal]?" for Learners and so
          // Manager/Co-parent see curriculum progress alongside earnings.
          const goals = child.learningGoals ?? [];
          const completedGoals = goals.filter((g) => g.completed).length;
          const nextGoal = goals.find((g) => !g.completed)?.topic ?? null;

          // Build a friendly summary string per child. Empty-state, low-streak,
          // and mid-week states each get distinct framing instead of bare zeros.
          const hasEarned = totalEarned > 0;
          const hasPending = pending > 0;
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
          } else if (hasPending && !hasEarned) {
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

          reports.push({
            childName: child.name,
            summary,
            weeklyBudgetUsd: (child.weeklyBudget / 10 ** USDC.DECIMALS).toFixed(2),
            totalEarnedUsd: (totalEarned / 10 ** USDC.DECIMALS).toFixed(2),
            distributedUsd: (distributed / 10 ** USDC.DECIMALS).toFixed(2),
            pendingUsd: (pending / 10 ** USDC.DECIMALS).toFixed(2),
            categories: Object.fromEntries(
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
              })
            ),
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

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: true, reports }),
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
    })
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
