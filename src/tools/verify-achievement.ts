import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { PolicyEngine } from "../engine/policy.js";
import { AchievementSourceEnum } from "../schemas.js";
import type { AchievementRecord } from "../schemas.js";
import { USDC } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
} from "../middleware/access-control.js";

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
    withAccessControl("verify-achievement", async (args, caller) => {
      if (!caller) return buildNoIdentityResponse("verify-achievement");
      const childName = args.childName as string;
      const category = args.category as string;
      const description = args.description as string;
      const score = args.score as number;
      const source = (args.source as string | undefined) || "manual";
      const metadata = args.metadata as Record<string, unknown> | undefined;
      try {
        const state = new StateManager();
        const engine = new PolicyEngine();
        const familyId = caller.familyId;

        // Load family config
        const config = await state.loadFamilyConfig(familyId);
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
          (c) => c.name.toLowerCase() === childName.toLowerCase()
        );
        if (!childConfig) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Child "${childName}" not found. Configured children: ${config.children.map((c) => c.name).join(", ")}`,
              }),
            }],
          };
        }

        // Learner can only verify achievements for their own child
        if (caller.role === "learner" && caller.childName?.toLowerCase() !== childName.toLowerCase()) {
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
        const matchedCat = validCats.find((n) => n.toLowerCase() === category.toLowerCase());
        if (!matchedCat) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Category '${category}' not configured. Available: ${validCats.join(", ")}`,
              }),
            }],
          };
        }

        // Evaluate achievement amount
        const amount = engine.evaluateAchievement(
          score,
          matchedCat,
          childConfig
        );

        // Update streak
        const streak = await state.updateStreak(familyId, childConfig.name);

        // Apply streak multiplier
        const multipliedAmount = Math.round(amount * streak.multiplier);

        // Create achievement record
        const record: AchievementRecord = {
          id: randomUUID(),
          childName: childConfig.name,
          category,
          description,
          score,
          amount: multipliedAmount,
          source: source as AchievementRecord["source"],
          verifiedBy: caller.memberId,
          verifiedAt: new Date().toISOString(),
          distributed: false,
        };

        await state.addAchievement(familyId, record);

        // Audit log
        await state.addAuditEntry(familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "verify-achievement",
          actor: caller.memberId,
          details: {
            childName,
            category,
            score,
            source,
            metadata,
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
              category,
              score,
              source,
              baseAmountUsd: baseUsd,
              streakMultiplier: streak.multiplier,
              finalAmountUsd: amountUsd,
              currentStreak: streak.currentStreak,
              message: streak.multiplier > 1
                ? `${childConfig.name} earned $${amountUsd} for ${category} (${score}/100). ${streak.currentStreak}-day streak gives ${streak.multiplier}x bonus! (base: $${baseUsd}). Ready for distribution.`
                : `${childConfig.name} earned $${amountUsd} for ${category} (${score}/100). Ready for distribution.`,
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
    })
  );
}
