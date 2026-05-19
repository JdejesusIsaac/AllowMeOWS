// Sprint 3.0.1: pure helpers for parent-defined learning goals.
//
// Matching philosophy: parents enter goals as "Topic — detail" (em-dash separated),
// children/Claude log achievements as free-text descriptions like
// "Fractions" or "Fractions — equivalent fractions". The fuzzy match treats
// the part before the first " — " as the canonical topic and asks: does
// either side's prefix appear in the other side's text?
//
// Match rule (all conditions required):
//   1. goal.category == achievement.category (case-insensitive)
//   2. goal not already completed
//   3. either:
//        achievement.description (lowered) includes goal.topic prefix (lowered), OR
//        goal.topic (lowered) includes achievement.description prefix (lowered)
//
// First incomplete match wins; later goals are not auto-completed by the
// same achievement.
//
// Sprint 3.7: `findMatchingSubgoal` extends matching to subgoal topics,
// using `string-similarity`'s Dice coefficient on top of substring checks.
// Conservative thresholds (≥0.85 auto-complete, ≥0.65 hint-only). See
// research-3.7.md Decision 2 for the asymmetric-cost reasoning.
import { compareTwoStrings } from "string-similarity";
import type { ChildConfig, LearningGoal } from "../schemas.js";

const SEPARATOR = " — ";

function topicPrefix(text: string): string {
  return text.toLowerCase().split(SEPARATOR)[0]!.trim();
}

export interface AchievementMatchInput {
  category: string;
  description: string;
}

export function findMatchingGoalIndex(
  achievement: AchievementMatchInput,
  goals: readonly LearningGoal[]
): number {
  const desc = achievement.description.toLowerCase();
  const achPrefix = topicPrefix(achievement.description);
  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i]!;
    if (goal.completed) continue;
    if (goal.category.toLowerCase() !== achievement.category.toLowerCase()) continue;
    const tPrefix = topicPrefix(goal.topic);
    const tLower = goal.topic.toLowerCase();
    if (desc.includes(tPrefix) || tLower.includes(achPrefix)) {
      return i;
    }
  }
  return -1;
}

// Sprint 3.7 — subgoal auto-matching thresholds.
//
// `AUTO_COMPLETE`: substring or fuzzy similarity at/above this confidence
//   flips `subgoal.completed` to `true` and writes a `subgoal-auto-completed`
//   audit entry.
// `HINT_FLOOR`: matches between this floor and `AUTO_COMPLETE` are surfaced
//   to the learner as a "possible match — ask your parent" hint without
//   any state mutation. Below `HINT_FLOOR` the matcher stays silent.
//
// Tunable in Sprint 4.0+ against pilot data. The asymmetry (silent rather
// than aggressive) is intentional — see research-3.7.md Decision 2.
export const SUBGOAL_MATCH_AUTO_COMPLETE = 0.85;
export const SUBGOAL_MATCH_HINT_FLOOR = 0.65;

export type SubgoalMatchType = "substring" | "fuzzy";

export interface SubgoalMatchResult {
  goalIndex: number;
  subgoalIndex: number;
  goalTopic: string;
  subgoalTopic: string;
  confidence: number;
  matchType: SubgoalMatchType;
}

/**
 * Find the highest-confidence open-subgoal match for an achievement.
 *
 * Walks each goal whose category matches the achievement's category, then
 * each open subgoal under that goal, scoring them by:
 *   1. case-insensitive substring inclusion in either direction → 1.0
 *   2. `string-similarity` Dice coefficient on the lowered, full strings
 *
 * Returns the highest-scoring candidate at or above `SUBGOAL_MATCH_HINT_FLOOR`,
 * or `null` if nothing clears the floor. The caller decides whether to
 * auto-complete (`confidence ≥ SUBGOAL_MATCH_AUTO_COMPLETE`) or merely
 * surface a hint.
 *
 * Already-completed subgoals are skipped so a single achievement never
 * double-fires the audit entry. Goal-level category equality is required
 * before any subgoal scoring runs (subgoals inherit their parent goal's
 * category — schema-level invariant from Sprint 3.0.4).
 */
export function findMatchingSubgoal(
  achievement: AchievementMatchInput,
  child: Pick<ChildConfig, "learningGoals">,
): SubgoalMatchResult | null {
  const goals = child.learningGoals;
  if (!goals || goals.length === 0) return null;

  const desc = achievement.description.toLowerCase().trim();
  const ach = achievement.category.toLowerCase();
  if (desc.length === 0) return null;

  let best: SubgoalMatchResult | null = null;

  for (let gi = 0; gi < goals.length; gi++) {
    const goal = goals[gi]!;
    if (goal.category.toLowerCase() !== ach) continue;
    const subgoals = goal.subgoals;
    if (!subgoals || subgoals.length === 0) continue;

    for (let si = 0; si < subgoals.length; si++) {
      const sg = subgoals[si]!;
      if (sg.completed) continue;

      const topic = sg.topic.toLowerCase().trim();
      if (topic.length === 0) continue;

      let confidence = 0;
      let matchType: SubgoalMatchType = "fuzzy";

      if (desc.includes(topic) || topic.includes(desc)) {
        confidence = 1;
        matchType = "substring";
      } else {
        const sim = compareTwoStrings(desc, topic);
        confidence = Number.isFinite(sim) ? sim : 0;
        matchType = "fuzzy";
      }

      if (confidence < SUBGOAL_MATCH_HINT_FLOOR) continue;
      if (best && confidence <= best.confidence) continue;

      best = {
        goalIndex: gi,
        subgoalIndex: si,
        goalTopic: goal.topic,
        subgoalTopic: sg.topic,
        confidence,
        matchType,
      };
    }
  }

  return best;
}

// Merge prior completion state into a new goals list. Match key is the
// (topic, category) lowercased pair. Used by configure-policy on update so
// the parent can add/edit goals mid-week without wiping earned progress.
export function mergeLearningGoals(
  oldGoals: readonly LearningGoal[] | undefined,
  newGoals: readonly LearningGoal[]
): LearningGoal[] {
  if (!oldGoals || oldGoals.length === 0) {
    return newGoals.map((g) => ({ ...g }));
  }
  return newGoals.map((g) => {
    const prior = oldGoals.find(
      (og) =>
        og.topic.toLowerCase() === g.topic.toLowerCase() &&
        og.category.toLowerCase() === g.category.toLowerCase()
    );
    if (prior?.completed) {
      return {
        topic: g.topic,
        category: g.category,
        completed: true,
        completedAt: prior.completedAt,
        achievementId: prior.achievementId,
      };
    }
    return { ...g };
  });
}
