/**
 * Sprint 3.0.3 — `check-goals` tool test suite (CG1–CG9).
 *
 * Strategy: exercise the branchy summary builder directly via the exported
 * `buildCheckGoalsSummary` helper. This is the same pattern as
 * `tests/learning-goals.test.ts` (LG-T3) where the derivation logic is
 * tested in isolation rather than spinning up the full MCP server.
 *
 * Coverage:
 *   - CG1: empty-state copy (learner-flavored)
 *   - CG2: empty-state copy (manager-flavored — different audience)
 *   - CG3: all goals not-started → summary lists each with "Not started yet"
 *   - CG4: mixed states (complete + in-progress + not-started)
 *   - CG5: in-progress goal with subgoals → "X/Y steps" rendered
 *   - CG6: deadline 5 days out → ⏰ urgency
 *   - CG7: RBAC — Advisor explicitly denied, Family + Learner allowed
 *   - CG8: all complete → celebratory copy (learner-flavored)
 *   - CG9: overdue deadline (negative daysUntilDeadline) → ⚠️ warning
 *
 * Also locks in schema acceptance of the new `subgoals` + `deadline` fields
 * through `LearningGoalSchema`.
 */
import { describe, it, expect } from "vitest";
import {
  buildCheckGoalsSummary,
  type GoalReport,
} from "../src/tools/check-goals.js";
import { isToolAuthorized } from "../src/middleware/access-control.js";
import { ROLES } from "../src/constants.js";
import { LearningGoalSchema } from "../src/schemas.js";

// Helper: build a GoalReport with sensible defaults.
function goalReport(
  topic: string,
  status: GoalReport["status"],
  extra: Partial<GoalReport> = {}
): GoalReport {
  return {
    topic,
    category: extra.category ?? "education",
    status,
    ...extra,
  };
}

describe("check-goals: buildCheckGoalsSummary — empty states (CG1, CG2)", () => {
  it("CG1: empty goals + learner role → prompts kid to ask parent to set goals", () => {
    const summary = buildCheckGoalsSummary("Elina", [], ROLES.LEARNER);
    expect(summary).toContain("Elina");
    expect(summary).toMatch(/no goals set yet/i);
    expect(summary).toMatch(/ask your parent/i);
  });

  it("CG2: empty goals + manager role → points at configure-policy", () => {
    const summary = buildCheckGoalsSummary("Elina", [], ROLES.MANAGER);
    expect(summary).toContain("Elina");
    expect(summary).toContain("configure-policy");
    // Manager-flavored copy should not address the child as "you".
    expect(summary).not.toMatch(/ask your parent/i);
  });
});

describe("check-goals: populated states (CG3, CG4)", () => {
  it("CG3: all goals not-started → lists them under 'Not started yet'", () => {
    const goals: GoalReport[] = [
      goalReport("Fractions", "not-started"),
      goalReport("Phonics", "not-started"),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.LEARNER);
    expect(summary).toMatch(/not started yet/i);
    expect(summary).toContain("Fractions");
    expect(summary).toContain("Phonics");
    // No "done" framing when nothing complete.
    expect(summary).not.toMatch(/\bdone\b/i);
    // No "In progress" framing when nothing in progress.
    expect(summary).not.toMatch(/in progress/i);
  });

  it("CG4: mixed states (complete + in-progress + not-started) — all three branches render", () => {
    const goals: GoalReport[] = [
      goalReport("Fractions", "complete"),
      goalReport("Decimals", "in-progress"),
      goalReport("Ratios", "not-started"),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.LEARNER);
    expect(summary).toMatch(/1 done/i);
    expect(summary).toContain("Fractions");
    expect(summary).toMatch(/in progress: decimals/i);
    expect(summary).toMatch(/not started yet: ratios/i);
  });
});

describe("check-goals: subgoals + deadlines (CG5, CG6, CG9)", () => {
  it("CG5: in-progress goal with subgoals → renders 'X/Y steps'", () => {
    const goals: GoalReport[] = [
      goalReport("7th grade math", "in-progress", {
        subgoals: [
          { topic: "fractions", status: "complete" },
          { topic: "decimals", status: "complete" },
          { topic: "ratios", status: "not-started" },
          { topic: "pre-algebra", status: "not-started" },
        ],
      }),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.LEARNER);
    expect(summary).toMatch(/7th grade math \(2\/4 steps\)/);
  });

  it("CG6: deadline 5 days out (incomplete) → ⏰ urgency footer", () => {
    const goals: GoalReport[] = [
      goalReport("Math review", "in-progress", {
        deadline: "2030-01-06T00:00:00.000Z",
        daysUntilDeadline: 5,
      }),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.LEARNER);
    expect(summary).toContain("⏰");
    expect(summary).toMatch(/due in 5 days/i);
    expect(summary).toMatch(/math review/i);
  });

  it("CG6b: deadline 1 day out → singular 'day' (no 's')", () => {
    const goals: GoalReport[] = [
      goalReport("Math review", "in-progress", {
        deadline: "2030-01-02T00:00:00.000Z",
        daysUntilDeadline: 1,
      }),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.LEARNER);
    expect(summary).toMatch(/due in 1 day\b/);
  });

  it("CG6c: deadline 20 days out → 📅 (within-30 framing)", () => {
    const goals: GoalReport[] = [
      goalReport("End-of-quarter project", "in-progress", {
        deadline: "2030-01-21T00:00:00.000Z",
        daysUntilDeadline: 20,
      }),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.LEARNER);
    expect(summary).toContain("📅");
    expect(summary).toMatch(/20 days out/i);
  });

  it("CG6d: deadline 60 days out → 📅 (beyond-30 framing, no 'steady progress' nudge)", () => {
    const goals: GoalReport[] = [
      goalReport("Year-end portfolio", "in-progress", {
        deadline: "2030-03-02T00:00:00.000Z",
        daysUntilDeadline: 60,
      }),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.LEARNER);
    expect(summary).toContain("📅");
    expect(summary).toMatch(/60 days out/i);
    expect(summary).not.toMatch(/steady progress/i);
  });

  it("CG9: overdue deadline (daysUntilDeadline < 0) → ⚠️ warning, not upcoming ⏰", () => {
    const goals: GoalReport[] = [
      goalReport("Late assignment", "in-progress", {
        deadline: "2025-01-01T00:00:00.000Z",
        daysUntilDeadline: -7,
      }),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.LEARNER);
    expect(summary).toContain("⚠️");
    expect(summary).toMatch(/deadline has passed/i);
    expect(summary).not.toContain("⏰");
  });
});

describe("check-goals: all-complete (CG8)", () => {
  it("CG8: every goal complete + learner → celebratory copy", () => {
    const goals: GoalReport[] = [
      goalReport("Fractions", "complete"),
      goalReport("Decimals", "complete"),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.LEARNER);
    expect(summary).toContain("🎯");
    expect(summary).toMatch(/every goal complete/i);
    expect(summary).toMatch(/2 of 2 done/i);
  });

  it("CG8b: every goal complete + manager → suggests setting new goals", () => {
    const goals: GoalReport[] = [
      goalReport("Fractions", "complete"),
      goalReport("Decimals", "complete"),
    ];
    const summary = buildCheckGoalsSummary("Elina", goals, ROLES.MANAGER);
    expect(summary).toMatch(/completed all 2/i);
    expect(summary).toContain("configure-policy");
    // No celebratory emoji for the manager-facing branch.
    expect(summary).not.toContain("🎯");
  });
});

describe("check-goals: RBAC matrix (CG7)", () => {
  it("CG7: check-goals is authorized for Manager, Co-parent, Family, Learner", () => {
    expect(isToolAuthorized("check-goals", ROLES.MANAGER)).toBe(true);
    expect(isToolAuthorized("check-goals", ROLES.CO_PARENT)).toBe(true);
    expect(isToolAuthorized("check-goals", ROLES.FAMILY)).toBe(true);
    expect(isToolAuthorized("check-goals", ROLES.LEARNER)).toBe(true);
  });

  it("CG7b: check-goals is denied to Advisor (read-only audit, goals out of scope)", () => {
    expect(isToolAuthorized("check-goals", ROLES.ADVISOR)).toBe(false);
  });
});

describe("check-goals: LearningGoalSchema accepts subgoals + deadline", () => {
  it("schema: accepts a goal with subgoals + ISO deadline", () => {
    const result = LearningGoalSchema.safeParse({
      topic: "7th grade math",
      category: "education",
      completed: false,
      subgoals: [
        { topic: "fractions", completed: false },
        { topic: "decimals", completed: true },
      ],
      deadline: "2026-08-15T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subgoals).toHaveLength(2);
      expect(result.data.subgoals?.[1].completed).toBe(true);
      expect(result.data.deadline).toBe("2026-08-15T00:00:00.000Z");
    }
  });

  it("schema: rejects deadline that isn't ISO-8601 datetime", () => {
    const result = LearningGoalSchema.safeParse({
      topic: "Math",
      category: "education",
      deadline: "tomorrow",
    });
    expect(result.success).toBe(false);
  });

  it("schema: caps subgoals at 20", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      topic: `step-${i}`,
      completed: false,
    }));
    const result = LearningGoalSchema.safeParse({
      topic: "Big curriculum",
      category: "education",
      subgoals: tooMany,
    });
    expect(result.success).toBe(false);
  });

  it("schema: backward-compat — Sprint 3.0.1 goals (no subgoals/deadline) still validate", () => {
    const result = LearningGoalSchema.safeParse({
      topic: "Phonics",
      category: "education",
      completed: false,
    });
    expect(result.success).toBe(true);
  });
});
