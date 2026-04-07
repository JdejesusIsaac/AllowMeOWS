import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { PolicyEngine } from "../engine/policy.js";
import { AchievementSourceEnum } from "../schemas.js";
import type { AchievementRecord } from "../schemas.js";
import { USDC } from "../constants.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

export function registerVerifyAchievementTool(server: McpServer): void {
  server.tool(
    "verify-achievement",
    "Verify a child's achievement. Category must match one of the child's configured categories (e.g. 'reading', 'movement'). Queues the achievement for allowance distribution.",
    {
      childName: z.string().describe("Name of the child"),
      category: z.string().min(1).describe("Achievement category (must match a configured category name)"),
      description: z.string().describe("What the child accomplished"),
      score: z.number().min(0).max(100).describe("Achievement score (0-100)"),
      source: AchievementSourceEnum.default("manual").optional().describe("Achievement source: manual, openMAIC, fitbit, apple-health, self-report, parent-attested"),
      metadata: z.record(z.unknown()).optional().describe("Optional metadata (e.g. classroomId, topic)"),
      ...rbacFields,
    },
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("verify-achievement", caller.role)) {
        return buildAccessDeniedResponse("verify-achievement", caller.role);
      }
      try {
        const state = new StateManager();
        const engine = new PolicyEngine();

        // Load family config
        const config = await state.loadFamilyConfig();
        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: "No family configured. Use configure-policy first.",
              }),
            }],
          };
        }

        // Find child config
        const childConfig = config.children.find(
          (c) => c.name.toLowerCase() === args.childName.toLowerCase()
        );
        if (!childConfig) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Child "${args.childName}" not found. Configured children: ${config.children.map((c) => c.name).join(", ")}`,
              }),
            }],
          };
        }

        // Learner can only verify achievements for their own child
        if (caller.role === "learner" && caller.childName?.toLowerCase() !== args.childName.toLowerCase()) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: "Learners can only report achievements for themselves.",
              }),
            }],
          };
        }

        // Validate category exists in child's config
        const validCats = childConfig.categories?.map((c) => c.name) || [];
        const matchedCat = validCats.find((n) => n.toLowerCase() === args.category.toLowerCase());
        if (!matchedCat) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Category '${args.category}' not configured. Available: ${validCats.join(", ")}`,
              }),
            }],
          };
        }

        // Evaluate achievement amount
        const amount = engine.evaluateAchievement(
          args.score,
          matchedCat,
          childConfig
        );

        // Update streak
        const streak = await state.updateStreak(childConfig.name);

        // Apply streak multiplier
        const multipliedAmount = Math.round(amount * streak.multiplier);

        // Create achievement record
        const record: AchievementRecord = {
          id: randomUUID(),
          childName: childConfig.name,
          category: args.category,
          description: args.description,
          score: args.score,
          amount: multipliedAmount,
          source: args.source || "manual",
          verifiedBy: caller.memberId,
          verifiedAt: new Date().toISOString(),
          distributed: false,
        };

        await state.addAchievement(record);

        // Audit log
        await state.addAuditEntry({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "verify-achievement",
          actor: caller.memberId,
          details: {
            childName: args.childName,
            category: args.category,
            score: args.score,
            source: args.source || "manual",
            metadata: args.metadata,
            baseAmount: amount,
            multiplier: streak.multiplier,
            finalAmount: multipliedAmount,
          },
        });

        const amountUsd = (multipliedAmount / 10 ** USDC.DECIMALS).toFixed(2);
        const baseUsd = (amount / 10 ** USDC.DECIMALS).toFixed(2);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              childName: childConfig.name,
              category: args.category,
              score: args.score,
              source: args.source || "manual",
              baseAmountUsd: baseUsd,
              streakMultiplier: streak.multiplier,
              finalAmountUsd: amountUsd,
              currentStreak: streak.currentStreak,
              message: streak.multiplier > 1
                ? `${childConfig.name} earned $${amountUsd} for ${args.category} (${args.score}/100). ${streak.currentStreak}-day streak gives ${streak.multiplier}x bonus! (base: $${baseUsd}). Ready for distribution.`
                : `${childConfig.name} earned $${amountUsd} for ${args.category} (${args.score}/100). Ready for distribution.`,
            }),
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
