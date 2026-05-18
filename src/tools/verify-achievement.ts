import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { PolicyEngine } from "../engine/policy.js";
import { AchievementSourceEnum } from "../schemas.js";
import type { AchievementRecord } from "../schemas.js";
import { findMatchingGoalIndex } from "../engine/learning-goals.js";
import { USDC } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";
import { formatUsdFromMicro } from "../utils/card-formatting.js";

/** Sprint 3.6 CARD4-style "what changed" markdown (`summary`; contract C3). */
export function buildVerifyAchievementRichMarkdown(input: {
  childName: string;
  category: string;
  score: number;
  deltaMicro: number;
  baseMicro: number;
  streakDays: number;
  streakMultiplier: number;
  goalCompleted: string | null;
}): string {
  const lines: string[] = [
    `**Achievement logged — ${input.childName}**`,
    "",
    `**+${formatUsdFromMicro(input.deltaMicro)}** toward this week's allowance ` +
      `(${input.score}/100 • **${input.category}**)`,
    "",
  ];

  const fire = input.streakDays >= 1 ? "🔥 " : "";
  lines.push(
    `${fire}**Streak:** ${input.streakDays} day${input.streakDays === 1 ? "" : "s"} ` +
      `— **${input.streakMultiplier}x** multiplier on this payout ` +
      `(base **${formatUsdFromMicro(input.baseMicro)}**).`,
    "",
  );

  lines.push(`✓ **${input.category}** counted for this verification.`);

  if (input.goalCompleted) {
    lines.push(
      "",
      `Bonus: learning goal **${input.goalCompleted}** marked complete 🎯`,
    );
  }

  return lines.join("\n");
}

async function weeklyEarnedMicroForChild(
  state: StateManager,
  familyId: string,
  childCanonName: string,
): Promise<number> {
  const weekStart = getWeekStartUtc();
  const ach = await state.loadAchievements(familyId);
  return ach
    .filter(
      (a) =>
        a.childName.toLowerCase() === childCanonName.toLowerCase() &&
        new Date(a.verifiedAt) >= weekStart,
    )
    .reduce((sum, a) => sum + a.amount, 0);
}

export async function verifyAchievementHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null,
): Promise<ToolResponse> {
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

    const childConfig = config.children.find(
      (c) => c.name.toLowerCase() === childName.toLowerCase(),
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

    const amount = engine.evaluateAchievement(
      score,
      matchedCat,
      childConfig,
    );

    const streak = await state.updateStreak(familyId, childConfig.name);

    const multipliedAmount = Math.round(amount * streak.multiplier);

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

    let goalCompleted: string | null = null;
    if (childConfig.learningGoals && childConfig.learningGoals.length > 0) {
      const idx = findMatchingGoalIndex(
        { category: matchedCat, description },
        childConfig.learningGoals,
      );
      if (idx >= 0) {
        const goal = childConfig.learningGoals[idx]!;
        goal.completed = true;
        goal.completedAt = record.verifiedAt;
        goal.achievementId = record.id;
        goalCompleted = goal.topic;
        await state.saveFamilyConfig(familyId, config);
      }
    }

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

    const totalGoals = childConfig.learningGoals?.length ?? 0;
    const completedCount = childConfig.learningGoals?.filter((g) => g.completed).length ?? 0;
    const baseMessage = streak.multiplier > 1
      ? `${childConfig.name} earned $${amountUsd} for ${category} (${score}/100). ${streak.currentStreak}-day streak gives ${streak.multiplier}x bonus! (base: $${baseUsd}). Ready for distribution.`
      : `${childConfig.name} earned $${amountUsd} for ${category} (${score}/100). Ready for distribution.`;
    const message = goalCompleted
      ? `${baseMessage} Goal completed: ${goalCompleted}! ${completedCount} of ${totalGoals} done.`
      : baseMessage;

    const newEarnedWeekly = await weeklyEarnedMicroForChild(
      state,
      familyId,
      childConfig.name,
    );

    const summary = buildVerifyAchievementRichMarkdown({
      childName: childConfig.name,
      category: matchedCat,
      score,
      deltaMicro: multipliedAmount,
      baseMicro: amount,
      streakDays: streak.currentStreak,
      streakMultiplier: streak.multiplier,
      goalCompleted,
    });

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
          goalCompleted,
          completedGoals: completedCount,
          totalGoals,
          message,
          summary,
          delta: multipliedAmount,
          newStreak: streak.currentStreak,
          newEarned: newEarnedWeekly,
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
    withAccessControl("verify-achievement", verifyAchievementHandler),
  );
}

/** Monday UTC 00:00 (matches `check-progress` week slicing). */
function getWeekStartUtc(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}
