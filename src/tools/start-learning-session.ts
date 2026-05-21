/**
 * Sprint 4.0 W3.1 — `start-learning-session`.
 *
 * Starts a Learning Mode tutoring session for a kid against a math
 * learning goal that has a configured studyPlan. Returns the prompt
 * fragment(s) the tutor LLM uses to drive today's session, plus the
 * session ID and current state.
 *
 * Behaviors:
 *   - L4 daily limit (criterion 8): rejects if studyPlan.lastSessionDate
 *     matches today (UTC) and allowMakeupSessions is false. Returns a
 *     clean error explaining when the next session is available.
 *   - First-session path (criterion 2): if sessionsCompleted === 0,
 *     concatenates `baseline-assessment.md` + `engagement-scoring.md`.
 *   - Subsequent-session path (criteria 3 + 10): concatenates the
 *     phase fragment (resolveCurrentPhase) + `engagement-scoring.md`,
 *     and surfaces knownGaps from prior sessions so the tutor LLM
 *     probes them (L3 conversation-state binding).
 *   - Math-only gate (criterion 12): non-math goals with a studyPlan
 *     are still accepted, but the response notes that Learning Mode
 *     is math-only in 4.0 and the goal will run tracker-only.
 *   - Audit: writes `learning-session-started` with session ID,
 *     session number, isFirstSession, isMakeupSession flags.
 *   - State mutation: updates studyPlan.lastSessionDate to today's UTC
 *     date AT START (so a kid can't dodge L4 by starting many sessions
 *     and only completing one).
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
  loadFragments,
  resolveCurrentPhase,
  todayUtcDateString,
  PHASE_ORDER,
} from "../core/learning-mode.js";

const MATH_CATEGORY = "math";

export async function startLearningSessionHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("start-learning-session");
  const childName = String(args.childName ?? "");
  const goalTopic = String(args.goalTopic ?? "");
  if (!childName) {
    return jsonResponse({
      success: false,
      error: "childName is required",
    });
  }
  if (!goalTopic) {
    return jsonResponse({
      success: false,
      error: "goalTopic is required",
    });
  }

  // Learner scope check: a learner may only start sessions for themself.
  if (
    caller.role === "learner" &&
    caller.childName &&
    caller.childName.toLowerCase() !== childName.toLowerCase()
  ) {
    return jsonResponse({
      success: false,
      error: "Learners can only start sessions for themselves.",
    });
  }

  const state = new StateManager();
  const config = await state.loadFamilyConfig(caller.familyId);
  if (!config) {
    return jsonResponse({
      success: false,
      error: "No family configured. Run configure-policy first.",
    });
  }
  const childConfig = config.children.find(
    (c) => c.name.toLowerCase() === childName.toLowerCase()
  );
  if (!childConfig) {
    return jsonResponse({
      success: false,
      error: `Child "${childName}" not found.`,
    });
  }
  const goal = childConfig.learningGoals?.find(
    (g) => g.topic.toLowerCase() === goalTopic.toLowerCase()
  );
  if (!goal) {
    return jsonResponse({
      success: false,
      error: `Learning goal "${goalTopic}" not found for ${childConfig.name}.`,
    });
  }
  if (!goal.studyPlan) {
    return jsonResponse({
      success: false,
      error: `Learning goal "${goalTopic}" has no studyPlan configured. Ask a manager to set one via configure-policy.`,
    });
  }

  // Criterion 12 — math-only Learning Mode in 4.0. Non-math goals with
  // studyPlan accept silently and the session does not start; the tool
  // returns a clean note instead of a hard error.
  if (goal.category.toLowerCase() !== MATH_CATEGORY) {
    return jsonResponse({
      success: false,
      mathOnly: true,
      message:
        `studyPlan accepted for tracking, but Learning Mode is math-only ` +
        `in Sprint 4.0 — this goal will continue as tracker-only. Use ` +
        `verify-achievement to record progress instead.`,
    });
  }

  // L4 daily limit (criterion 8).
  const today = todayUtcDateString();
  const isMakeupSession = Boolean(
    goal.studyPlan.lastSessionDate === today &&
      goal.studyPlan.allowMakeupSessions
  );
  if (
    goal.studyPlan.lastSessionDate === today &&
    !goal.studyPlan.allowMakeupSessions
  ) {
    return jsonResponse({
      success: false,
      dailyLimitReached: true,
      error:
        "You've completed today's session — come back tomorrow for the next one.",
    });
  }

  const sessionId = `session-${randomUUID()}`;
  const isFirstSession = goal.studyPlan.sessionsCompleted === 0;
  const sessionNumber = goal.studyPlan.sessionsCompleted + 1;
  const sessionsRemaining = Math.max(
    0,
    goal.studyPlan.sessionsPlanned - sessionNumber + 1
  );

  // Resolve the phase the tutor LLM should teach today and load the
  // matching fragments. First session = baseline + engagement-scoring.
  // Subsequent = topic fragment + engagement-scoring.
  let promptFragment: string;
  let phase: string;
  if (isFirstSession) {
    phase = "baseline";
    promptFragment = await loadFragments([
      "math/baseline-assessment.md",
      "math/engagement-scoring.md",
    ]);
  } else {
    phase = resolveCurrentPhase(goal.studyPlan);
    if (!(PHASE_ORDER as readonly string[]).includes(phase)) {
      phase = "fractions"; // safe default
    }
    promptFragment = await loadFragments([
      `math/${phase}.md`,
      "math/engagement-scoring.md",
    ]);
    // L3 — surface knownGaps from prior sessions so the tutor LLM
    // probes them. Inline header so the tutor can scan it quickly.
    if (goal.studyPlan.knownGaps.length > 0) {
      const gapsList = goal.studyPlan.knownGaps
        .slice(0, 8)
        .map((g) => `- ${g}`)
        .join("\n");
      promptFragment =
        `## Prior session knownGaps to probe today\n\n${gapsList}\n\n` +
        `Reference these from earlier sessions — the assessment at the ` +
        `end MUST self-reference today's framing, not generic content.\n\n---\n\n` +
        promptFragment;
    }
  }

  // State mutation — bump lastSessionDate to today AT START so L4 is
  // honored even if the kid bails mid-session.
  goal.studyPlan.lastSessionDate = today;
  if (isFirstSession && !goal.studyPlan.startedAt) {
    goal.studyPlan.startedAt = new Date().toISOString();
  }
  await state.saveFamilyConfig(caller.familyId, config);

  // Audit entry.
  await state.addAuditEntry(caller.familyId, {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action: "learning-session-started",
    actor: caller.memberId,
    details: {
      childName: childConfig.name,
      goalTopic: goal.topic,
      sessionId,
      sessionNumber,
      isFirstSession,
      isMakeupSession,
      phase,
    },
  });

  return jsonResponse({
    success: true,
    sessionId,
    isFirstSession,
    isMakeupSession,
    promptFragment,
    sessionState: {
      childName: childConfig.name,
      goalTopic: goal.topic,
      phase,
      sessionNumber,
      sessionsCompleted: goal.studyPlan.sessionsCompleted,
      sessionsPlanned: goal.studyPlan.sessionsPlanned,
      sessionsRemaining,
      knownGaps: goal.studyPlan.knownGaps,
      baselineAssessment: goal.studyPlan.baselineAssessment ?? null,
      minutesPerSession: goal.studyPlan.minutesPerSession,
    },
  });
}

function jsonResponse(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

export const startLearningSessionWrapped = withAccessControl(
  "start-learning-session",
  startLearningSessionHandler
);

export function registerStartLearningSessionTool(server: McpServer): void {
  server.tool(
    "start-learning-session",
    "Begin a Learning Mode tutoring session for a math learning goal with a configured study plan. Returns the prompt fragment the tutor LLM uses to drive today's session, plus a sessionId you'll pass to complete-learning-session at the end.",
    {
      childName: z.string().describe("Name of the child starting the session"),
      goalTopic: z
        .string()
        .describe(
          "Topic of the math learning goal (must match an existing learningGoal with a studyPlan)"
        ),
      ...rbacFields,
    },
    startLearningSessionWrapped
  );
}
