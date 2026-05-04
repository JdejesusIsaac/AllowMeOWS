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
import type { LearningGoal } from "../schemas.js";

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
