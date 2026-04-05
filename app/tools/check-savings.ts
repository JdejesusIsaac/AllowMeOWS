import { tool } from "ai";
import { z } from "zod";
import { StateManager } from "../../src/engine/state.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";
const checkSavings = tool({
  description:
    "Check savings vault balances and locked entries for children. " +
    "Shows lock dates, multipliers, and maturity status. Learners see only their own savings.",
  inputSchema: z.object({
    childName: z.string().optional().describe("Check a specific child, or all if omitted"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("check-savings", caller.role)) {
      return accessDenied("check-savings", caller.role);
    }
    try {
      const state = new StateManager();
      const config = await state.loadFamilyConfig();
      if (!config) {
        return JSON.stringify({ success: false, error: "No family configured." });
      }

      // Child-scoped filtering for learners
      const scopedChildName = caller.role === "learner" ? caller.childName : args.childName;

      const children = scopedChildName
        ? config.children.filter((c) => c.name.toLowerCase() === scopedChildName!.toLowerCase())
        : config.children;

      const results = [];
      for (const child of children) {
        const entries = await state.loadSavingsEntries(child.name);
        const now = new Date();
        const locked = entries.filter((e) => !e.released && new Date(e.lockUntil) > now);
        const ready = entries.filter((e) => !e.released && new Date(e.lockUntil) <= now);
        const released = entries.filter((e) => e.released);

        results.push({
          childName: child.name,
          savingsPercent: child.savingsPercent,
          lockedCount: locked.length,
          lockedAmountUsd: (locked.reduce((s, e) => s + e.amount, 0) / 1e6).toFixed(2),
          readyToReleaseCount: ready.length,
          readyAmountUsd: (ready.reduce((s, e) => s + Math.round(e.amount * e.multiplierAtDeposit), 0) / 1e6).toFixed(2),
          releasedCount: released.length,
          releasedAmountUsd: (released.reduce((s, e) => s + e.amount, 0) / 1e6).toFixed(2),
          entries: entries.slice(-10).map((e) => ({
            amountUsd: (e.amount / 1e6).toFixed(2),
            multiplier: e.multiplierAtDeposit,
            lockUntil: e.lockUntil,
            released: e.released,
            releasedAt: e.releasedAt,
          })),
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

export default checkSavings;
