/**
 * Sprint 4.0 W3.2 — `get-session-state`.
 *
 * Returns the current studyPlan state for a child + goal pair, so the
 * tutor LLM can recover context mid-session (e.g. if the chat thread
 * is interrupted and resumed). Read-only — no state mutation, no
 * audit entry.
 *
 * The Sprint Contract treats sessions as atomic single-sittings
 * (Decision 7), so this tool doesn't restore a specific in-flight
 * sessionId. It returns the persistent studyPlan state (phase,
 * knownGaps, sessions[], baselineAssessment) which is sufficient for
 * the tutor LLM to re-orient.
 *
 * Learner-scoped: a learner can only read their own state.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";
import { resolveCurrentPhase } from "../core/learning-mode.js";

export async function getSessionStateHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("get-session-state");
  const childName = String(args.childName ?? caller.childName ?? "");
  const goalTopic = String(args.goalTopic ?? "");
  if (!childName) {
    return jsonResponse({ success: false, error: "childName is required" });
  }
  if (!goalTopic) {
    return jsonResponse({ success: false, error: "goalTopic is required" });
  }

  if (
    caller.role === "learner" &&
    caller.childName &&
    caller.childName.toLowerCase() !== childName.toLowerCase()
  ) {
    return jsonResponse({
      success: false,
      error: "Learners can only read their own session state.",
    });
  }

  const state = new StateManager();
  const config = await state.loadFamilyConfig(caller.familyId);
  if (!config) {
    return jsonResponse({ success: false, error: "No family configured." });
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
      error: `Learning goal "${goalTopic}" not found.`,
    });
  }
  if (!goal.studyPlan) {
    return jsonResponse({
      success: false,
      error: "This goal has no studyPlan — Learning Mode is not configured.",
    });
  }

  const studyPlan = goal.studyPlan;
  return jsonResponse({
    success: true,
    state: {
      childName: childConfig.name,
      goalTopic: goal.topic,
      durationDays: studyPlan.durationDays,
      minutesPerSession: studyPlan.minutesPerSession,
      sessionsCompleted: studyPlan.sessionsCompleted,
      sessionsPlanned: studyPlan.sessionsPlanned,
      sessionsRemaining: Math.max(
        0,
        studyPlan.sessionsPlanned - studyPlan.sessionsCompleted
      ),
      currentPhase: resolveCurrentPhase(studyPlan),
      knownGaps: studyPlan.knownGaps,
      allowMakeupSessions: studyPlan.allowMakeupSessions,
      lastSessionDate: studyPlan.lastSessionDate ?? null,
      baselineAssessment: studyPlan.baselineAssessment ?? null,
      recentSessions: studyPlan.sessions.slice(-3).map((s) => ({
        sessionId: s.sessionId,
        date: s.date,
        topic: s.topic,
        avgEngagement: s.avgEngagement,
        assessmentPassed: s.assessmentPassed,
        confidenceFlag: s.confidenceFlag,
      })),
    },
  });
}

function jsonResponse(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

export const getSessionStateWrapped = withAccessControl(
  "get-session-state",
  getSessionStateHandler
);

export function registerGetSessionStateTool(server: McpServer): void {
  server.tool(
    "get-session-state",
    "Return the current Learning Mode studyPlan state for a child + goal. Use mid-session to recover tutoring context after an interruption.",
    {
      childName: z
        .string()
        .optional()
        .describe(
          "Child whose state to fetch. Optional for learners (defaults to self)."
        ),
      goalTopic: z
        .string()
        .describe("Topic of the math learning goal with the studyPlan."),
      ...rbacFields,
    },
    getSessionStateWrapped
  );
}
