import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import { USDC } from "../constants.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, getChildScope, rbacFields } from "../middleware/access-control.js";

export function registerCheckProgressTool(server: McpServer): void {
  server.tool(
    "check-progress",
    "Check a child's weekly progress, achievements, streaks, and savings balance.",
    {
      childName: z.string().optional().describe("Check a specific child, or all children if omitted"),
      ...rbacFields,
    },
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("check-progress", caller.role)) {
        return buildAccessDeniedResponse("check-progress", caller.role);
      }
      try {
        const state = new StateManager();
        const config = await state.loadFamilyConfig();

        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured." }),
            }],
          };
        }

        const achievements = await state.loadAchievements();

        // Child-scoped filtering: learner sees only their own data
        const childScope = getChildScope(caller);
        const requestedChild = childScope || args.childName;

        const children = requestedChild
          ? config.children.filter((c) => c.name.toLowerCase() === requestedChild.toLowerCase())
          : config.children;

        if (children.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: `Child "${args.childName}" not found.` }),
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
          const streak = await state.loadStreak(child.name);

          // Savings
          const savings = await state.loadSavingsEntries(child.name);
          const totalSaved = savings.reduce((sum, s) => sum + s.amount, 0);
          const lockedSavings = savings.filter((s) => !s.released).reduce((sum, s) => sum + s.amount, 0);

          reports.push({
            childName: child.name,
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
    }
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
