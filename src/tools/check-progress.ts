import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import { USDC } from "../constants.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

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
        const children = args.childName
          ? config.children.filter((c) => c.name.toLowerCase() === args.childName!.toLowerCase())
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

          // Category breakdown
          const byCat = { education: 0, health: 0, personal: 0 };
          for (const a of thisWeek) {
            byCat[a.category] += a.amount;
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
            categories: {
              education: `$${(byCat.education / 10 ** USDC.DECIMALS).toFixed(2)} / $${(child.categoryBudgets.education / 10 ** USDC.DECIMALS).toFixed(2)}`,
              health: `$${(byCat.health / 10 ** USDC.DECIMALS).toFixed(2)} / $${(child.categoryBudgets.health / 10 ** USDC.DECIMALS).toFixed(2)}`,
              personal: `$${(byCat.personal / 10 ** USDC.DECIMALS).toFixed(2)} / $${(child.categoryBudgets.personal / 10 ** USDC.DECIMALS).toFixed(2)}`,
            },
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
