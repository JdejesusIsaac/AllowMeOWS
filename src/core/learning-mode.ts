/**
 * Sprint 4.0 — Learning Mode core helpers.
 *
 * Shared by `start-learning-session`, `complete-learning-session`,
 * `get-session-state`, `view-session-receipt`, and `settle-session-payout`.
 * Keep this module pure (no I/O) except where explicitly noted; the
 * tool handlers compose these helpers with their state-loading logic.
 *
 * Public surface:
 *   - loadFragment / loadFragments : read prompt-fragment markdown from
 *     `src/prompts/math/*.md` and `src/prompts/receipt-generator.md`.
 *   - resolveCurrentPhase : derive `currentPhase` from sessionsCompleted
 *     and prior knownGaps; default progression is place-value → fractions
 *     → decimals → ratios → pre-algebra.
 *   - parseEngagementTags / parseStructuredBlock : extract per-turn
 *     `<!-- engagement: N -->` tags and the structured end-of-session
 *     JSON block emitted by the tutor LLM (see
 *     `src/prompts/math/engagement-scoring.md`).
 *   - computeMedianTurnIntervalSeconds : L5 cool-down statistical signal.
 *   - resolveConfidenceFlag : "ok" | "low" based on median turn interval.
 *   - computePayout : (weeklyBudget / sessionsPlanned) × engagementMult
 *     × completionRatio. Output is 6-decimal USDC micros.
 *   - generateTemplateReceipt : deterministic fallback receipt for when
 *     no receipt-LLM credential is configured.
 *   - todayUtcDateString : YYYY-MM-DD UTC, used by the L4 daily-limit check.
 *   - PHASE_ORDER : default math curriculum progression.
 *   - LOW_CONFIDENCE_THRESHOLD_SEC : 5s, per plan.md criterion 9.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USDC } from "../constants.js";
import type { StudyPlan } from "../schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/core/learning-mode.ts → ../prompts/...
const PROMPTS_DIR = join(__dirname, "..", "prompts");

/**
 * Default math curriculum progression for Sprint 4.0. Tutor LLM advances
 * across phases as sessionsCompleted accrues; if prior knownGaps reference
 * an earlier phase, that phase is revisited first.
 */
export const PHASE_ORDER = [
  "place-value",
  "fractions",
  "decimals",
  "ratios",
  "pre-algebra",
] as const;

export type MathPhase = (typeof PHASE_ORDER)[number];

/**
 * Plan.md criterion 9: median turn interval < 5s flags the session as
 * "low" confidence. Tunable in Sprint 4.0.1 based on dogfooding data.
 */
export const LOW_CONFIDENCE_THRESHOLD_SEC = 5;

/**
 * Load a single prompt-fragment markdown file by relative path under
 * `src/prompts/`. Returns the file contents. Throws if the file is
 * missing — fragment files are part of the shipped artifact and absence
 * is a bug, not a runtime condition.
 */
export async function loadFragment(relativePath: string): Promise<string> {
  const filepath = join(PROMPTS_DIR, relativePath);
  return readFile(filepath, "utf-8");
}

/**
 * Load and concatenate multiple fragments in order, separated by
 * markdown horizontal rules. Used when assembling the prompt for
 * `start-learning-session` (baseline + engagement-scoring, or topic +
 * engagement-scoring).
 */
export async function loadFragments(relativePaths: string[]): Promise<string> {
  const contents = await Promise.all(relativePaths.map(loadFragment));
  return contents.join("\n\n---\n\n");
}

/**
 * Decide which curriculum phase a kid is in for the upcoming session.
 *
 * Strategy:
 *   1. If `studyPlan.currentPhase` is set and not yet completed, keep it.
 *   2. If knownGaps from prior sessions reference an earlier phase
 *      (e.g. kid is on "ratios" but knownGaps still mentions "fractions"),
 *      revisit the earlier phase.
 *   3. Otherwise advance based on `sessionsCompleted / sessionsPlanned`
 *      ratio mapped uniformly across PHASE_ORDER.
 *
 * Tutor LLM sees the resolved phase and pulls the matching fragment.
 */
export function resolveCurrentPhase(studyPlan: StudyPlan): MathPhase {
  // Priority 1: explicit currentPhase if set and valid.
  if (
    studyPlan.currentPhase &&
    (PHASE_ORDER as readonly string[]).includes(studyPlan.currentPhase)
  ) {
    // Honor knownGaps revisit: if the kid is on a later phase but
    // knownGaps still references an earlier phase, revisit.
    const currentIdx = PHASE_ORDER.indexOf(studyPlan.currentPhase as MathPhase);
    const gapsIdx = findEarliestGapPhaseIndex(studyPlan.knownGaps);
    if (gapsIdx !== -1 && gapsIdx < currentIdx) {
      return PHASE_ORDER[gapsIdx]!;
    }
    return studyPlan.currentPhase as MathPhase;
  }
  // Priority 3: derive from progress ratio.
  const ratio =
    studyPlan.sessionsPlanned > 0
      ? studyPlan.sessionsCompleted / studyPlan.sessionsPlanned
      : 0;
  const idx = Math.min(
    PHASE_ORDER.length - 1,
    Math.floor(ratio * PHASE_ORDER.length)
  );
  return PHASE_ORDER[idx]!;
}

function findEarliestGapPhaseIndex(gaps: string[]): number {
  for (let i = 0; i < PHASE_ORDER.length; i++) {
    const phase = PHASE_ORDER[i]!;
    // Loose match: any gap string containing the phase name (case-insensitive)
    if (
      gaps.some((g) =>
        g.toLowerCase().includes(phase.replace(/-/g, " ").toLowerCase())
      )
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse `<!-- engagement: N -->` tags from the tutor LLM's session
 * transcript. Returns the ordered array of integer scores (1-5).
 * Out-of-range scores are clamped; non-integer scores are rounded.
 * Missing scores trigger the receipt-LLM post-hoc fallback in
 * `complete-learning-session`.
 */
export function parseEngagementTags(transcript: string): number[] {
  const regex = /<!--\s*engagement:\s*([0-9]+(?:\.[0-9]+)?)\s*-->/gi;
  const scores: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(transcript)) !== null) {
    const raw = Number(match[1]);
    if (!Number.isFinite(raw)) continue;
    const rounded = Math.round(raw);
    scores.push(Math.max(1, Math.min(5, rounded)));
  }
  return scores;
}

export interface StructuredEndOfSessionBlock {
  engagementScores?: number[];
  turnTimestamps?: string[];
  conceptsCovered?: string[];
  knownGaps?: string[];
  assessmentResult?: {
    questions?: string[];
    answers?: string[];
    score?: number;
    maxScore?: number;
    passed?: boolean;
  };
  baselineAssessment?: {
    level?: "novice" | "intermediate" | "advanced";
    gaps?: string[];
    score?: number;
  };
}

/**
 * Parse the structured end-of-session JSON block emitted by the tutor
 * LLM inside an HTML comment (see engagement-scoring.md). Returns null
 * if no block is found or the JSON is malformed — callers fall back
 * to per-turn engagement tags and other heuristics.
 */
export function parseStructuredBlock(
  transcript: string
): StructuredEndOfSessionBlock | null {
  // Match the LAST `<!-- ... -->` block in the transcript that contains a
  // JSON object — that's the end-of-session payload per the prompt spec.
  const regex = /<!--\s*(\{[\s\S]*?\})\s*-->/g;
  let lastJson: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(transcript)) !== null) {
    lastJson = match[1] ?? null;
  }
  if (!lastJson) return null;
  try {
    return JSON.parse(lastJson) as StructuredEndOfSessionBlock;
  } catch {
    return null;
  }
}

/**
 * Compute the median turn interval in seconds. Used for the L5 cool-down
 * statistical flag. Returns Infinity for 0-or-1 timestamps (no signal).
 */
export function computeMedianTurnIntervalSeconds(
  turnTimestamps: ReadonlyArray<string | number>
): number {
  if (turnTimestamps.length < 2) return Infinity;
  const ms = turnTimestamps.map((t) =>
    typeof t === "number" ? t : new Date(t).getTime()
  );
  // Validate parse
  for (const m of ms) {
    if (!Number.isFinite(m)) return Infinity;
  }
  ms.sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < ms.length; i++) {
    deltas.push((ms[i]! - ms[i - 1]!) / 1000);
  }
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  if (deltas.length % 2 === 1) return deltas[mid]!;
  return (deltas[mid - 1]! + deltas[mid]!) / 2;
}

export function resolveConfidenceFlag(
  medianTurnIntervalSeconds: number
): "ok" | "low" {
  return medianTurnIntervalSeconds < LOW_CONFIDENCE_THRESHOLD_SEC
    ? "low"
    : "ok";
}

export interface PayoutBreakdown {
  baseRate: number; // 6-decimal USDC micros per session
  engagementMultiplier: number; // 0..1
  completionRatio: number; // 0..1
  payoutUsdc: number; // 6-decimal USDC micros, rounded
}

export interface ComputePayoutInput {
  weeklyBudgetUsdc: number; // 6-decimal micros
  sessionsPlanned: number;
  avgEngagement: number; // 1..5
  completionRatio: number; // 0..1 — typically 1 if assessment passed, 0.5 if attempted but failed, 0 if not attempted
}

/**
 * Sprint 4.0 payout formula:
 *
 *   baseRate            = weeklyBudgetUsdc / sessionsPlanned
 *   engagementMult      = max(0, (avgEngagement - 1) / 4)   // maps 1→0, 5→1
 *   completionRatio     = caller-supplied (0..1)
 *   payoutUsdc          = round(baseRate * engagementMult * completionRatio)
 *
 * Rationale on engagementMultiplier: a 1.0 engagement (the lowest
 * possible score) should pay nothing — the kid demonstrated nothing
 * worth paying for. A 5.0 engagement pays the full base. Linear
 * interpolation between gives a smooth penalty for low effort. This
 * matches the plan's "× (avgEngagement / 5)" framing in spirit but
 * scales 1→0 not 1→0.2 (a kid who scores 1 across the board does NOT
 * earn 20% — they earn nothing).
 *
 * Bounds:
 *   payoutUsdc >= 0
 *   payoutUsdc <= baseRate (= weeklyBudgetUsdc / sessionsPlanned)
 */
export function computePayout(input: ComputePayoutInput): PayoutBreakdown {
  const baseRate =
    input.sessionsPlanned > 0
      ? input.weeklyBudgetUsdc / input.sessionsPlanned
      : 0;
  const engagement = Math.max(1, Math.min(5, input.avgEngagement));
  const engagementMultiplier = Math.max(0, (engagement - 1) / 4);
  const completionRatio = Math.max(0, Math.min(1, input.completionRatio));
  const payoutUsdc = Math.max(
    0,
    Math.round(baseRate * engagementMultiplier * completionRatio)
  );
  return {
    baseRate: Math.round(baseRate),
    engagementMultiplier,
    completionRatio,
    payoutUsdc,
  };
}

export interface DeriveCompletionRatioInput {
  avgEngagement: number; // 1..5
  assessmentPassed: boolean;
  assessmentAttempted: boolean;
}

/**
 * Derive completionRatio from session signals when the caller doesn't
 * supply one explicitly. Default rule (plan.md W3.3):
 *   - assessment passed       → 1.0
 *   - attempted but failed,
 *     engagement >= 3         → 0.5  (effort recognized)
 *   - attempted but failed,
 *     engagement < 3          → 0    (low effort + failure = no payout)
 *   - assessment not attempted → 0    (kid bailed)
 */
export function deriveCompletionRatio(
  input: DeriveCompletionRatioInput
): number {
  if (!input.assessmentAttempted) return 0;
  if (input.assessmentPassed) return 1.0;
  if (input.avgEngagement >= 3) return 0.5;
  return 0;
}

/**
 * YYYY-MM-DD in UTC. Used by the L4 daily-session-limit check.
 * Safe for date-only comparison; ISO timezone shifts don't matter
 * because we always use UTC on both sides.
 */
export function todayUtcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Deterministic template-fill receipt used when no receipt-LLM
 * credential is configured (Decision 8 fallback). Produces a
 * structured ~80-100 word summary that satisfies R1 invariants
 * (named the kid, mentions engagement + assessment + USDC, omits
 * transcript). Lower quality than an LLM-generated receipt but
 * never blocks the session from completing.
 */
export function generateTemplateReceipt(input: {
  childName: string;
  topic: string;
  durationMinutes: number;
  avgEngagement: number;
  assessmentPassed: boolean;
  assessmentScore?: number;
  conceptsCovered: string[];
  knownGaps: string[];
  confidenceFlag: "ok" | "low";
  usdcSettledMicros: number;
}): string {
  const usd = (input.usdcSettledMicros / 10 ** USDC.DECIMALS).toFixed(2);
  const engagementWord = engagementToPhrase(input.avgEngagement);
  const assessmentSentence = input.assessmentPassed
    ? "Passed the end-of-session check."
    : "Did not pass the end-of-session check — worth revisiting next time.";
  const conceptsSentence =
    input.conceptsCovered.length > 0
      ? `Worked on ${input.conceptsCovered.slice(0, 3).join(", ")}.`
      : "";
  const gapsSentence =
    input.knownGaps.length > 0
      ? `Still needs work on ${input.knownGaps.slice(0, 2).join(", ")}.`
      : "";
  const flagSentence =
    input.confidenceFlag === "low"
      ? "Heads up — turn pacing was unusually fast, which can indicate copy-paste from another tool. Worth a quick conversation before the next session."
      : "";
  const sentences = [
    `${input.childName} logged ${Math.round(input.durationMinutes)} minutes on ${input.topic} today (${input.avgEngagement.toFixed(1)}/5 engagement — ${engagementWord}).`,
    conceptsSentence,
    assessmentSentence,
    gapsSentence,
    flagSentence,
    `$${usd} USDC settled.`,
  ].filter((s) => s && s.length > 0);
  return sentences.join(" ");
}

function engagementToPhrase(score: number): string {
  if (score >= 4.5) return "fully attentive throughout";
  if (score >= 3.5) return "engaged for most of the session";
  if (score >= 2.5) return "mixed engagement";
  if (score >= 1.5) return "checked-out for much of the session";
  return "disengaged throughout";
}
