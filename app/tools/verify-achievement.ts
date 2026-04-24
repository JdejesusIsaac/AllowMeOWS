// @ts-nocheck — Sprint 2.9: aixyz legacy tool, superseded by src/tools/
import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../../src/engine/state.js";
import { PolicyEngine } from "../../src/engine/policy.js";
import { AchievementSourceEnum } from "../../src/schemas.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";
const verifyAchievement = tool({
  description:
    "Verify a child's achievement. Category must match a configured category name. Calculates USDC reward with streak bonus. Supports source tracking (manual, self-report, fitbit, openMAIC).",
  inputSchema: z.object({
    childName: z.string().min(1).describe("Child's name"),
    category: z.string().min(1).describe("Achievement category (must match a configured category name)"),
    description: z.string().min(1).describe("What the child accomplished"),
    score: z.number().min(0).max(100).describe("Achievement score (0-100)"),
    source: AchievementSourceEnum.default("manual").optional().describe("How this achievement was reported"),
    metadata: z.record(z.unknown()).optional().describe("Additional context (e.g. Fitbit step count)"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("verify-achievement", caller.role)) {
      return accessDenied("verify-achievement", caller.role);
    }
    try {
      const state = new StateManager();
      const engine = new PolicyEngine();
      const config = await state.loadFamilyConfig();
      if (!config) {
        return JSON.stringify({ success: false, error: "No family configured." });
      }

      const childConfig = config.children.find(
        (c) => c.name.toLowerCase() === args.childName.toLowerCase()
      );
      if (!childConfig) {
        return JSON.stringify({ success: false, error: `Child "${args.childName}" not found.` });
      }

      // Learner can only verify for their own child
      if (caller.role === "learner" && caller.childName?.toLowerCase() !== args.childName.toLowerCase()) {
        return JSON.stringify({ success: false, error: "Learners can only report achievements for themselves." });
      }

      // Validate category exists in child's config
      const validCats = childConfig.categories?.map((c) => c.name) || [];
      const matchedCat = validCats.find((n) => n.toLowerCase() === args.category.toLowerCase());
      if (!matchedCat) {
        return JSON.stringify({ success: false, error: `Category '${args.category}' not configured. Available: ${validCats.join(", ")}` });
      }

      const streak = await state.updateStreak(args.childName);
      const baseAmount = engine.evaluateAchievement(args.score, matchedCat, childConfig);
      const amount = Math.round(baseAmount * streak.multiplier);
      const source = args.source || "manual";

      const record = {
        id: randomUUID(),
        childName: args.childName,
        category: args.category,
        description: args.description,
        score: args.score,
        amount,
        source,
        verifiedBy: caller.memberId,
        verifiedAt: new Date().toISOString(),
        distributed: false,
      };

      await state.addAchievement(record);

      await state.addAuditEntry({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        action: "verify-achievement",
        actor: caller.memberId,
        details: {
          childName: args.childName,
          category: args.category,
          score: args.score,
          amount,
          source,
          metadata: args.metadata,
          streakMultiplier: streak.multiplier,
        },
      });

      return JSON.stringify({
        success: true,
        achievement: record,
        streak: { current: streak.currentStreak, multiplier: streak.multiplier },
        message: `${args.childName} earned $${(amount / 1e6).toFixed(2)} for ${args.category}: "${args.description}" (${streak.multiplier}x streak bonus)`,
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
});

export default verifyAchievement;
