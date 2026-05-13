/**
 * Sprint 3.0.3 — `check-goals` MCP tool.
 *
 * Surfaces parent-defined `learningGoals` (Sprint 3.0.1) plus the new
 * `subgoals` + `deadline` extensions. Returns one report per child with:
 *
 *   - `summary` — kid-facing prose string (see {@link buildCheckGoalsSummary}).
 *     This is the field Claude reaches for when answering "what are my
 *     goals?" conversationally. Same UX pattern as `summary` on
 *     `check-progress` and `message` on `check-savings`.
 *   - `goals[]` — structured per-goal status, including subgoal completion
 *     counts and `daysUntilDeadline` arithmetic.
 *   - Aggregate counts (`completeCount`, `inProgressCount`, `notStartedCount`).
 *
 * Status semantics (intentionally simple — no fuzzy "did the child master
 * this" judgment here; that lives in `verify-achievement`):
 *   - "complete"     → `goal.completed === true` (set by parent at verify time)
 *   - "in-progress"  → at least one prior achievement in the goal's category
 *   - "not-started"  → otherwise
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  getChildScope,
  rbacFields,
} from "../middleware/access-control.js";

/** Shape of one entry in `reports[].goals[]`. Exported for test ergonomics. */
export interface GoalReport {
  topic: string;
  category: string;
  status: "complete" | "in-progress" | "not-started";
  subgoals?: Array<{ topic: string; status: "complete" | "not-started" }>;
  deadline?: string;
  daysUntilDeadline?: number;
}

export function registerCheckGoalsTool(server: McpServer): void {
  server.tool(
    "check-goals",
    "See what learning goals are set, which are in progress, and which are complete. " +
      "Learners see only their own goals. Managers, co-parents, and family see all children's goals.",
    {
      childName: z
        .string()
        .optional()
        .describe("Check a specific child's goals, or all children's goals if omitted"),
      ...rbacFields,
    },
    withAccessControl("check-goals", async (args, caller) => {
      if (!caller) return buildNoIdentityResponse("check-goals");
      const requestedChildArg = args.childName as string | undefined;

      try {
        const state = new StateManager();
        const familyId = caller.familyId;
        const config = await state.loadFamilyConfig(familyId);

        if (!config) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: "No family configured.",
                }),
              },
            ],
          };
        }

        // Child-scoping: Learner sees only their own; everyone else sees all
        // or the explicitly requested child.
        const childScope = getChildScope(caller);
        const requestedChild = childScope || requestedChildArg;

        const children = requestedChild
          ? config.children.filter(
              (c) => c.name.toLowerCase() === requestedChild.toLowerCase()
            )
          : config.children;

        if (children.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Child "${requestedChildArg}" not found.`,
                }),
              },
            ],
          };
        }

        const allAchievements = await state.loadAchievements(familyId);

        const reports = children.map((child) => {
          const childAchievements = allAchievements.filter(
            (a) => a.childName.toLowerCase() === child.name.toLowerCase()
          );

          const goals = child.learningGoals ?? [];
          const now = Date.now();

          const goalReports: GoalReport[] = goals.map((goal) => {
            const matchingAchievements = childAchievements.filter(
              (a) => a.category.toLowerCase() === goal.category.toLowerCase()
            );

            const status: GoalReport["status"] = goal.completed
              ? "complete"
              : matchingAchievements.length > 0
                ? "in-progress"
                : "not-started";

            return {
              topic: goal.topic,
              category: goal.category,
              status,
              subgoals: goal.subgoals?.map((sg) => ({
                topic: sg.topic,
                status: sg.completed
                  ? ("complete" as const)
                  : ("not-started" as const),
              })),
              deadline: goal.deadline,
              daysUntilDeadline: goal.deadline
                ? Math.ceil(
                    (new Date(goal.deadline).getTime() - now) /
                      (24 * 60 * 60 * 1000)
                  )
                : undefined,
            };
          });

          const summary = buildCheckGoalsSummary(
            child.name,
            goalReports,
            caller.role
          );

          return {
            childName: child.name,
            summary,
            goalCount: goalReports.length,
            completeCount: goalReports.filter((g) => g.status === "complete").length,
            inProgressCount: goalReports.filter((g) => g.status === "in-progress").length,
            notStartedCount: goalReports.filter((g) => g.status === "not-started").length,
            goals: goalReports,
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, reports }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            },
          ],
        };
      }
    })
  );
}

/**
 * Build the kid-facing summary string for one child's goals.
 *
 * Distinct branches for empty / all-not-started / mixed / all-complete states,
 * with deadline urgency surfaced when present. Same UX principles as the
 * `check-savings` and `check-progress` copy fixes — name the child, lead
 * with action when relevant, avoid system-shaped phrasing.
 *
 * Exported so unit tests can exercise the branchy logic directly without
 * standing up the full MCP server.
 */
export function buildCheckGoalsSummary(
  childName: string,
  goals: GoalReport[],
  role: string
): string {
  if (goals.length === 0) {
    return role === "learner"
      ? `No goals set yet, ${childName}! Ask your parent to set up some learning goals — ` +
          `things like "read 20 books" or "learn programming fundamentals" — and they'll ` +
          `show up here once they're added.`
      : `No learning goals are set for ${childName} yet. ` +
          `Use configure-policy to add learning goals as part of the family setup.`;
  }

  const complete = goals.filter((g) => g.status === "complete");
  const inProgress = goals.filter((g) => g.status === "in-progress");
  const notStarted = goals.filter((g) => g.status === "not-started");

  // Most-urgent deadline-bound goal among the incomplete ones.
  const urgentGoal = goals
    .filter(
      (g) =>
        g.status !== "complete" &&
        g.daysUntilDeadline !== undefined &&
        g.daysUntilDeadline >= 0
    )
    .sort((a, b) => (a.daysUntilDeadline ?? 0) - (b.daysUntilDeadline ?? 0))[0];

  // Overdue goal — separately tracked so we surface it even if there's a
  // later-dated urgent goal that isn't overdue yet.
  const overdueGoal = goals.find(
    (g) =>
      g.status !== "complete" &&
      g.daysUntilDeadline !== undefined &&
      g.daysUntilDeadline < 0
  );

  if (complete.length === goals.length) {
    return role === "learner"
      ? `Every goal complete, ${childName}! 🎯 ${goals.length} of ${goals.length} done. ` +
          `Ask your parent to set new goals when you're ready for the next challenge.`
      : `${childName} has completed all ${goals.length} learning goals. ` +
          `Consider setting new ones via configure-policy.`;
  }

  const parts: string[] = [];
  parts.push(
    role === "learner"
      ? `Here's what you're working on, ${childName}:`
      : `${childName}'s learning goals:`
  );

  if (complete.length > 0) {
    parts.push(
      `${complete.length} done (${complete.map((g) => g.topic).join(", ")}).`
    );
  }

  if (inProgress.length > 0) {
    const inProgressList = inProgress
      .map((g) => {
        if (g.subgoals && g.subgoals.length > 0) {
          const subComplete = g.subgoals.filter(
            (s) => s.status === "complete"
          ).length;
          return `${g.topic} (${subComplete}/${g.subgoals.length} steps)`;
        }
        return g.topic;
      })
      .join(", ");
    parts.push(`In progress: ${inProgressList}.`);
  }

  if (notStarted.length > 0) {
    parts.push(
      `Not started yet: ${notStarted.map((g) => g.topic).join(", ")}.`
    );
  }

  // Deadline urgency footer. Overdue takes precedence over upcoming.
  if (overdueGoal) {
    parts.push(
      `⚠️ "${overdueGoal.topic}" deadline has passed. ` +
        `Talk to your parent about what to do next.`
    );
  } else if (urgentGoal && urgentGoal.daysUntilDeadline !== undefined) {
    const days = urgentGoal.daysUntilDeadline;
    if (days <= 7) {
      parts.push(
        `⏰ "${urgentGoal.topic}" is due in ${days} day${days === 1 ? "" : "s"}. Time to focus.`
      );
    } else if (days <= 30) {
      parts.push(
        `📅 "${urgentGoal.topic}" deadline is ${days} days out. Steady progress will get you there.`
      );
    } else {
      parts.push(`📅 "${urgentGoal.topic}" deadline is ${days} days out.`);
    }
  }

  return parts.join(" ");
}
