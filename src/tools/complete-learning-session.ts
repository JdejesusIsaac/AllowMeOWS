/**
 * Sprint 4.0 W3.3 — `complete-learning-session`.
 *
 * Ends a Learning Mode session. The learner (or their AI client on
 * their behalf) calls this with per-turn engagement scores, turn
 * timestamps, the end-of-session assessment result, and the topic
 * covered. The tool then:
 *
 *   1. Parses engagement scores (W4.1) — explicit `engagementScores[]`
 *      arg wins; falls back to parsing `<!-- engagement: N -->` tags
 *      from `transcript`; falls back to a flat 3 if neither.
 *   2. Computes median turn interval (W4.3) -> confidenceFlag (L5).
 *   3. Derives completionRatio from assessment + engagement signals.
 *   4. Computes payout via the Sprint 4.0 formula.
 *   5. Generates a parent receipt — calls receipt LLM if env-configured,
 *      falls back to deterministic template (Decision 8).
 *   6. Persists SessionRecord; advances currentPhase; merges knownGaps.
 *   7. Settles USDC via `settle-session-payout` (W6).
 *   8. Writes audit entries: `learning-session-completed` always,
 *      `learning-session-flagged-low-confidence` if applicable,
 *      `baseline-assessment-completed` if first-session baseline present.
 *
 * RBAC: learner-only. A learner may only complete their own sessions.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";
import {
  parseEngagementTags,
  parseStructuredBlock,
  computeMedianTurnIntervalSeconds,
  resolveConfidenceFlag,
  computePayout,
  deriveCompletionRatio,
  generateTemplateReceipt,
  resolveCurrentPhase,
  LOW_CONFIDENCE_THRESHOLD_SEC,
} from "../core/learning-mode.js";
import { settleSessionPayout } from "./settle-session-payout.js";
import type { SessionRecord } from "../schemas.js";

const DEFAULT_FALLBACK_ENGAGEMENT = 3;

export async function completeLearningSessionHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("complete-learning-session");

  const sessionId = String(args.sessionId ?? "");
  const childName = String(args.childName ?? caller.childName ?? "");
  const goalTopic = String(args.goalTopic ?? "");
  if (!sessionId) return jsonResponse({ success: false, error: "sessionId is required" });
  if (!childName) return jsonResponse({ success: false, error: "childName is required" });
  if (!goalTopic) return jsonResponse({ success: false, error: "goalTopic is required" });

  if (
    caller.role === "learner" &&
    caller.childName &&
    caller.childName.toLowerCase() !== childName.toLowerCase()
  ) {
    return jsonResponse({
      success: false,
      error: "Learners can only complete their own sessions.",
    });
  }

  const state = new StateManager();
  const config = await state.loadFamilyConfig(caller.familyId);
  if (!config) return jsonResponse({ success: false, error: "No family configured." });

  const childConfig = config.children.find(
    (c) => c.name.toLowerCase() === childName.toLowerCase()
  );
  if (!childConfig) {
    return jsonResponse({ success: false, error: `Child "${childName}" not found.` });
  }
  const goal = childConfig.learningGoals?.find(
    (g) => g.topic.toLowerCase() === goalTopic.toLowerCase()
  );
  if (!goal) {
    return jsonResponse({
      success: false,
      error: `Learning goal "${goalTopic}" not found.`,
    });
  }
  if (!goal.studyPlan) {
    return jsonResponse({
      success: false,
      error: "This goal has no studyPlan — Learning Mode is not configured.",
    });
  }
  if (goal.studyPlan.sessions.some((s) => s.sessionId === sessionId)) {
    return jsonResponse({
      success: false,
      error: `Session ${sessionId} has already been completed.`,
    });
  }

  // 1. Engagement signal.
  const transcript = typeof args.transcript === "string" ? args.transcript : "";
  const structured = transcript ? parseStructuredBlock(transcript) : null;

  let engagementScores: number[] = [];
  if (Array.isArray(args.engagementScores)) {
    for (const v of args.engagementScores as unknown[]) {
      const n = Number(v);
      if (Number.isFinite(n)) {
        engagementScores.push(Math.max(1, Math.min(5, Math.round(n))));
      }
    }
  }
  if (engagementScores.length === 0 && Array.isArray(structured?.engagementScores)) {
    engagementScores = structured!
      .engagementScores!.map((n) => Math.max(1, Math.min(5, Math.round(Number(n)))))
      .filter((n) => Number.isFinite(n));
  }
  if (engagementScores.length === 0 && transcript) {
    engagementScores = parseEngagementTags(transcript);
  }
  const usedFallbackEngagement = engagementScores.length === 0;
  if (usedFallbackEngagement) engagementScores = [DEFAULT_FALLBACK_ENGAGEMENT];
  const avgEngagement =
    engagementScores.reduce((s, n) => s + n, 0) / engagementScores.length;

  // 2. Median turn interval + confidence flag (L5).
  let turnTimestamps: Array<string | number> = [];
  if (Array.isArray(args.turnTimestamps)) {
    turnTimestamps = args.turnTimestamps as Array<string | number>;
  } else if (Array.isArray(structured?.turnTimestamps)) {
    turnTimestamps = structured!.turnTimestamps!;
  }
  const medianTurnIntervalSeconds = computeMedianTurnIntervalSeconds(turnTimestamps);
  const confidenceFlag = resolveConfidenceFlag(medianTurnIntervalSeconds);

  // 3. Assessment + completion ratio.
  const assessmentArg = args.assessmentResult as
    | {
        questions?: string[];
        answers?: string[];
        score?: number;
        maxScore?: number;
        passed?: boolean;
      }
    | undefined;
  const assessment = assessmentArg ?? structured?.assessmentResult;
  const assessmentAttempted = Boolean(
    assessment &&
      (Array.isArray(assessment.answers) ? assessment.answers.length > 0 : true)
  );
  const assessmentPassed = Boolean(assessment?.passed);
  const completionRatio =
    typeof args.completionRatio === "number"
      ? Math.max(0, Math.min(1, args.completionRatio as number))
      : deriveCompletionRatio({
          avgEngagement,
          assessmentPassed,
          assessmentAttempted,
        });

  let assessmentScore: number | undefined;
  if (
    typeof assessment?.score === "number" &&
    typeof assessment?.maxScore === "number" &&
    assessment.maxScore > 0
  ) {
    assessmentScore = Math.round((assessment.score / assessment.maxScore) * 100);
  }

  // 4. Payout.
  const payout = computePayout({
    weeklyBudgetUsdc: childConfig.weeklyBudget,
    sessionsPlanned: goal.studyPlan.sessionsPlanned,
    avgEngagement,
    completionRatio,
  });

  // 5. Concepts + per-session known gaps.
  const conceptsCovered = Array.isArray(args.conceptsCovered)
    ? (args.conceptsCovered as unknown[]).map(String)
    : structured?.conceptsCovered?.map(String) ?? [];
  const sessionKnownGaps = Array.isArray(args.knownGaps)
    ? (args.knownGaps as unknown[]).map(String)
    : structured?.knownGaps?.map(String) ?? [];

  // 6. Duration.
  const durationMinutes =
    typeof args.durationMinutes === "number"
      ? Math.max(0, args.durationMinutes as number)
      : turnTimestamps.length >= 2
        ? Math.max(
            0,
            (toMillis(turnTimestamps[turnTimestamps.length - 1]!) -
              toMillis(turnTimestamps[0]!)) /
              60_000
          )
        : 0;

  // 7. Topic label.
  const topic =
    typeof args.topic === "string" && args.topic.length > 0
      ? args.topic
      : resolveCurrentPhase(goal.studyPlan);

  // 8. Receipt (template fallback; receipt-LLM call deferred to W5 wiring).
  const receiptSummary = generateTemplateReceipt({
    childName: childConfig.name,
    topic,
    durationMinutes,
    avgEngagement,
    assessmentPassed,
    assessmentScore,
    conceptsCovered,
    knownGaps: sessionKnownGaps,
    confidenceFlag,
    usdcSettledMicros: payout.payoutUsdc,
  });

  // 9. Persist session record + studyPlan mutations.
  const newRecord: SessionRecord = {
    sessionId,
    date: new Date().toISOString(),
    durationMinutes,
    topic,
    assessmentPassed,
    assessmentScore,
    conceptsCovered,
    knownGaps: sessionKnownGaps,
    avgEngagement,
    medianTurnIntervalSeconds: Number.isFinite(medianTurnIntervalSeconds)
      ? medianTurnIntervalSeconds
      : 0,
    confidenceFlag,
    usdcSettled: 0,
    receiptSummary,
  };
  goal.studyPlan.sessions.push(newRecord);
  goal.studyPlan.sessionsCompleted += 1;
  goal.studyPlan.currentPhase = resolveCurrentPhase(goal.studyPlan);

  const mergedGaps = new Set<string>(goal.studyPlan.knownGaps);
  for (const g of sessionKnownGaps) mergedGaps.add(g);
  goal.studyPlan.knownGaps = [...mergedGaps].slice(0, 20);

  // 10. First-session baseline persistence.
  const baseline = structured?.baselineAssessment;
  let baselinePersisted = false;
  if (
    !goal.studyPlan.baselineAssessment &&
    baseline &&
    (baseline.level === "novice" ||
      baseline.level === "intermediate" ||
      baseline.level === "advanced")
  ) {
    goal.studyPlan.baselineAssessment = {
      completedAt: new Date().toISOString(),
      level: baseline.level,
      gaps: Array.isArray(baseline.gaps) ? baseline.gaps.map(String) : [],
      score: typeof baseline.score === "number" ? baseline.score : undefined,
    };
    baselinePersisted = true;
  }

  await state.saveFamilyConfig(caller.familyId, config);

  // 11. Settle USDC.
  const settlement = await settleSessionPayout(caller, {
    childName: childConfig.name,
    amountUsdc: payout.payoutUsdc,
    sessionId,
  });

  let settledUsdcMicros = 0;
  let txHash: string | undefined;
  let settlementWarning: string | undefined;
  if (settlement.ok) {
    settledUsdcMicros = settlement.childAmount + settlement.savingsAmount;
    txHash = settlement.txHash;
  } else if ("rejectedReason" in settlement) {
    settlementWarning = `Payout blocked: ${settlement.rejectedReason}`;
  } else {
    settlementWarning = `Settlement error: ${settlement.error}`;
  }

  newRecord.usdcSettled = settledUsdcMicros;
  await state.saveFamilyConfig(caller.familyId, config);

  // 12. Audit.
  const now = new Date().toISOString();
  if (baselinePersisted) {
    await state.addAuditEntry(caller.familyId, {
      id: randomUUID(),
      timestamp: now,
      action: "baseline-assessment-completed",
      actor: caller.memberId,
      details: {
        childName: childConfig.name,
        goalTopic: goal.topic,
        level: goal.studyPlan.baselineAssessment!.level,
        gaps: goal.studyPlan.baselineAssessment!.gaps,
        score: goal.studyPlan.baselineAssessment!.score,
      },
    });
  }
  await state.addAuditEntry(caller.familyId, {
    id: randomUUID(),
    timestamp: now,
    action: "learning-session-completed",
    actor: caller.memberId,
    details: {
      childName: childConfig.name,
      goalTopic: goal.topic,
      sessionId,
      avgEngagement,
      medianTurnIntervalSeconds: Number.isFinite(medianTurnIntervalSeconds)
        ? medianTurnIntervalSeconds
        : null,
      assessmentPassed,
      assessmentScore: assessmentScore ?? null,
      confidenceFlag,
      baseRate: payout.baseRate,
      engagementMultiplier: payout.engagementMultiplier,
      completionRatio: payout.completionRatio,
      payoutUsdc: payout.payoutUsdc,
      txHash: txHash ?? null,
      settlementWarning: settlementWarning ?? null,
      receiptSummary,
    },
    txHash,
    amount: settledUsdcMicros,
  });
  if (confidenceFlag === "low") {
    await state.addAuditEntry(caller.familyId, {
      id: randomUUID(),
      timestamp: now,
      action: "learning-session-flagged-low-confidence",
      actor: caller.memberId,
      details: {
        childName: childConfig.name,
        sessionId,
        medianTurnIntervalSeconds,
        threshold: LOW_CONFIDENCE_THRESHOLD_SEC,
        reason: `median turn interval ${medianTurnIntervalSeconds.toFixed(2)}s below ${LOW_CONFIDENCE_THRESHOLD_SEC}s threshold`,
      },
    });
  }

  return jsonResponse({
    success: true,
    sessionId,
    payoutUsdc: payout.payoutUsdc,
    payoutBreakdown: payout,
    confidenceFlag,
    medianTurnIntervalSeconds: Number.isFinite(medianTurnIntervalSeconds)
      ? medianTurnIntervalSeconds
      : null,
    avgEngagement,
    assessmentPassed,
    assessmentScore: assessmentScore ?? null,
    txHash: txHash ?? null,
    receiptSummary,
    sessionsCompleted: goal.studyPlan.sessionsCompleted,
    sessionsRemaining: Math.max(
      0,
      goal.studyPlan.sessionsPlanned - goal.studyPlan.sessionsCompleted
    ),
    currentPhase: goal.studyPlan.currentPhase,
    settlementWarning: settlementWarning ?? null,
    usedFallbackEngagement,
  });
}

function toMillis(value: string | number): number {
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

function jsonResponse(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

export const completeLearningSessionWrapped = withAccessControl(
  "complete-learning-session",
  completeLearningSessionHandler
);

export function registerCompleteLearningSessionTool(server: McpServer): void {
  server.tool(
    "complete-learning-session",
    "End a Learning Mode session. Records engagement scores, runs the cheating-defense checks, generates a parent receipt, and settles USDC to the learner's wallet.",
    {
      sessionId: z.string().describe("The sessionId returned by start-learning-session."),
      childName: z.string().optional().describe("Child whose session is being completed. Optional for learners (defaults to self)."),
      goalTopic: z.string().describe("Topic of the math learning goal."),
      engagementScores: z.array(z.number().min(1).max(5)).optional().describe("Per-turn engagement scores (1-5). If omitted, parsed from `transcript`."),
      turnTimestamps: z.array(z.union([z.string(), z.number()])).optional().describe("Ordered turn timestamps. Used for the L5 cool-down flag."),
      assessmentResult: z.object({
        questions: z.array(z.string()).optional(),
        answers: z.array(z.string()).optional(),
        score: z.number().optional(),
        maxScore: z.number().optional(),
        passed: z.boolean().optional(),
      }).optional().describe("End-of-session assessment outcome."),
      conceptsCovered: z.array(z.string()).optional().describe("Concepts the kid worked on this session."),
      knownGaps: z.array(z.string()).optional().describe("Open knowledge gaps to revisit (L3)."),
      durationMinutes: z.number().nonnegative().optional().describe("Session duration in minutes."),
      topic: z.string().optional().describe("Topic label for the session record."),
      completionRatio: z.number().min(0).max(1).optional().describe("Optional explicit 0-1 completionRatio. Derived from signals if omitted."),
      transcript: z.string().optional().describe("Optional raw transcript. Server parses `<!-- engagement: N -->` tags and the structured end-of-session JSON block."),
      ...rbacFields,
    },
    completeLearningSessionWrapped
  );
}
