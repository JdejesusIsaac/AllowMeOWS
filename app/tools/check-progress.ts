// @ts-nocheck — Sprint 2.9: aixyz legacy tool, superseded by src/tools/
import { tool } from "ai";
import { z } from "zod";
import { StateManager } from "../../src/engine/state.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";
const checkProgress = tool({
  description:
    "Check weekly progress for children — achievements, streaks, earnings, and savings. " +
    "Learners see only their own data. Managers and co-parents see all children.",
  inputSchema: z.object({
    childName: z.string().optional().describe("Check a specific child, or all if omitted"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("check-progress", caller.role)) {
      return accessDenied("check-progress", caller.role);
    }
    try {
      const state = new StateManager();
      const config = await state.loadFamilyConfig();
      if (!config) {
        return JSON.stringify({ success: false, error: "No family configured." });
      }

      // Child-scoped filtering for learners
      const scopedChildName = caller.role === "learner" ? caller.childName : args.childName;

      const achievements = await state.loadAchievements();
      const children = scopedChildName
        ? config.children.filter((c) => c.name.toLowerCase() === scopedChildName.toLowerCase())
        : config.children;

      const results = [];
      for (const child of children) {
        const childAch = achievements.filter(
          (a) => a.childName.toLowerCase() === child.name.toLowerCase()
        );
        const streak = await state.loadStreak(child.name);
        const pending = childAch.filter((a) => !a.distributed);
        const distributed = childAch.filter((a) => a.distributed);

        results.push({
          childName: child.name,
          weeklyBudgetUsd: (child.weeklyBudget / 1e6).toFixed(2),
          achievements: childAch.map((a) => ({
            category: a.category,
            description: a.description,
            score: a.score,
            amountUsd: (a.amount / 1e6).toFixed(2),
            source: a.source || "manual",
            distributed: a.distributed,
            verifiedAt: a.verifiedAt,
          })),
          streak: streak ? {
            current: streak.currentStreak,
            longest: streak.longestStreak,
            multiplier: streak.multiplier,
          } : null,
          pendingCount: pending.length,
          pendingAmountUsd: (pending.reduce((s, a) => s + a.amount, 0) / 1e6).toFixed(2),
          distributedCount: distributed.length,
          distributedAmountUsd: (distributed.reduce((s, a) => s + a.amount, 0) / 1e6).toFixed(2),
        });
      }

      return JSON.stringify({
        success: true,
        familyName: config.familyName,
        children: results,
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
});

export default checkProgress;
