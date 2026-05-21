/**
 * Sprint 4.0 — pure helper unit tests for src/core/learning-mode.ts.
 *
 * Covers W6.3 payout invariants and the W4 helpers (engagement
 * parsing, median turn interval, confidence flag, currentPhase
 * resolution, completion-ratio derivation, template receipt). All
 * pure functions — no filesystem, no wallet, no LLM. Fast.
 */

import { describe, it, expect } from "vitest";
import {
  parseEngagementTags,
  parseStructuredBlock,
  computeMedianTurnIntervalSeconds,
  resolveConfidenceFlag,
  computePayout,
  deriveCompletionRatio,
  resolveCurrentPhase,
  generateTemplateReceipt,
  PHASE_ORDER,
  LOW_CONFIDENCE_THRESHOLD_SEC,
} from "../src/core/learning-mode.js";
import type { StudyPlan } from "../src/schemas.js";

function makeStudyPlan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return {
    durationDays: 15,
    minutesPerSession: 30,
    sessionsCompleted: 0,
    sessionsPlanned: 15,
    currentPhase: "",
    sessions: [],
    allowMakeupSessions: false,
    knownGaps: [],
    ...overrides,
  };
}

describe("LM-H1: parseEngagementTags", () => {
  it("parses ordered per-turn scores from inline HTML comments", () => {
    const transcript = `
      Tutor: How many tens in 47?
      <!-- engagement: 4 -->
      Kid: 4.
      Tutor: How do you know?
      <!-- engagement: 5 -->
      Kid: Because each ten makes 10 and 4 tens is 40, plus 7.
      <!-- engagement: 3 -->
    `;
    expect(parseEngagementTags(transcript)).toEqual([4, 5, 3]);
  });

  it("clamps to 1-5 and rounds non-integers", () => {
    const transcript = `<!-- engagement: 0 --> <!-- engagement: 7 --> <!-- engagement: 3.8 -->`;
    expect(parseEngagementTags(transcript)).toEqual([1, 5, 4]);
  });

  it("returns empty array when no tags present", () => {
    expect(parseEngagementTags("nothing here")).toEqual([]);
  });
});

describe("LM-H2: parseStructuredBlock", () => {
  it("extracts the last HTML-commented JSON block", () => {
    const transcript = `
      Some prelude.
      <!-- engagement: 3 -->
      <!--
      {
        "engagementScores": [3, 4, 5],
        "conceptsCovered": ["place value"],
        "knownGaps": ["zero-tens confusion"],
        "assessmentResult": {
          "questions": ["q1"],
          "answers": ["a1"],
          "score": 1,
          "maxScore": 1,
          "passed": true
        }
      }
      -->
    `;
    const block = parseStructuredBlock(transcript);
    expect(block).not.toBeNull();
    expect(block!.engagementScores).toEqual([3, 4, 5]);
    expect(block!.conceptsCovered).toEqual(["place value"]);
    expect(block!.assessmentResult?.passed).toBe(true);
  });

  it("returns null for malformed JSON", () => {
    const transcript = `<!-- { not json } -->`;
    expect(parseStructuredBlock(transcript)).toBeNull();
  });

  it("returns null when no block present", () => {
    expect(parseStructuredBlock("plain text")).toBeNull();
  });
});

describe("LM-H3: computeMedianTurnIntervalSeconds", () => {
  it("computes the median of pairwise deltas", () => {
    const t0 = Date.parse("2026-05-21T10:00:00Z");
    const stamps = [
      new Date(t0).toISOString(),
      new Date(t0 + 20_000).toISOString(),
      new Date(t0 + 50_000).toISOString(),
      new Date(t0 + 60_000).toISOString(),
    ];
    // Deltas: 20s, 30s, 10s → sorted [10, 20, 30] → median 20
    expect(computeMedianTurnIntervalSeconds(stamps)).toBe(20);
  });

  it("returns Infinity when fewer than 2 timestamps (no signal)", () => {
    expect(computeMedianTurnIntervalSeconds([])).toBe(Infinity);
    expect(computeMedianTurnIntervalSeconds(["2026-05-21T10:00:00Z"])).toBe(
      Infinity
    );
  });

  it("flags suspiciously fast pacing (< threshold) as low confidence", () => {
    const now = Date.now();
    const fast = [now, now + 2_000, now + 4_000, now + 6_000]; // 2s apart
    const median = computeMedianTurnIntervalSeconds(fast);
    expect(median).toBeLessThan(LOW_CONFIDENCE_THRESHOLD_SEC);
    expect(resolveConfidenceFlag(median)).toBe("low");
  });

  it("normal pacing stays 'ok'", () => {
    const now = Date.now();
    const normal = [now, now + 25_000, now + 60_000, now + 100_000];
    const median = computeMedianTurnIntervalSeconds(normal);
    expect(median).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD_SEC);
    expect(resolveConfidenceFlag(median)).toBe("ok");
  });
});

describe("LM-H4: computePayout — W6.3 invariants", () => {
  // Plan invariants: payout >= 0, payout <= baseRate, engagement=1 pays
  // nothing, engagement=5 + completion=1 pays full base, monotonic.
  const baseInput = {
    weeklyBudgetUsdc: 5_000_000, // $5.00 in 6-decimal micros
    sessionsPlanned: 15,
  };

  it("baseRate equals weeklyBudget / sessionsPlanned", () => {
    const r = computePayout({
      ...baseInput,
      avgEngagement: 5,
      completionRatio: 1,
    });
    // 5_000_000 / 15 = 333_333.33... → rounded 333_333
    expect(r.baseRate).toBe(333_333);
  });

  it("avgEngagement=1 → engagementMultiplier=0 → payout=0 (kid earns nothing)", () => {
    const r = computePayout({
      ...baseInput,
      avgEngagement: 1,
      completionRatio: 1,
    });
    expect(r.engagementMultiplier).toBe(0);
    expect(r.payoutUsdc).toBe(0);
  });

  it("avgEngagement=5 + completionRatio=1 → payout equals baseRate (full)", () => {
    const r = computePayout({
      ...baseInput,
      avgEngagement: 5,
      completionRatio: 1,
    });
    expect(r.engagementMultiplier).toBe(1);
    expect(r.payoutUsdc).toBe(r.baseRate);
  });

  it("completionRatio=0 → payout=0 regardless of engagement", () => {
    const r = computePayout({
      ...baseInput,
      avgEngagement: 5,
      completionRatio: 0,
    });
    expect(r.payoutUsdc).toBe(0);
  });

  it("monotonic in engagement and completionRatio", () => {
    const low = computePayout({
      ...baseInput,
      avgEngagement: 2,
      completionRatio: 0.5,
    });
    const mid = computePayout({
      ...baseInput,
      avgEngagement: 3,
      completionRatio: 0.5,
    });
    const high = computePayout({
      ...baseInput,
      avgEngagement: 4,
      completionRatio: 1,
    });
    expect(mid.payoutUsdc).toBeGreaterThan(low.payoutUsdc);
    expect(high.payoutUsdc).toBeGreaterThan(mid.payoutUsdc);
  });

  it("payout is always non-negative and bounded by baseRate", () => {
    for (const eng of [1, 2, 3, 4, 5]) {
      for (const cr of [0, 0.25, 0.5, 1]) {
        const r = computePayout({
          ...baseInput,
          avgEngagement: eng,
          completionRatio: cr,
        });
        expect(r.payoutUsdc).toBeGreaterThanOrEqual(0);
        expect(r.payoutUsdc).toBeLessThanOrEqual(r.baseRate);
      }
    }
  });

  it("out-of-range engagement is clamped to 1-5", () => {
    const tooLow = computePayout({
      ...baseInput,
      avgEngagement: -3,
      completionRatio: 1,
    });
    const tooHigh = computePayout({
      ...baseInput,
      avgEngagement: 999,
      completionRatio: 1,
    });
    expect(tooLow.payoutUsdc).toBe(0);
    expect(tooHigh.payoutUsdc).toBe(tooHigh.baseRate);
  });

  it("zero sessionsPlanned gives zero baseRate (defensive)", () => {
    const r = computePayout({
      weeklyBudgetUsdc: 5_000_000,
      sessionsPlanned: 0,
      avgEngagement: 5,
      completionRatio: 1,
    });
    expect(r.baseRate).toBe(0);
    expect(r.payoutUsdc).toBe(0);
  });
});

describe("LM-H5: deriveCompletionRatio", () => {
  it("passed assessment → 1.0", () => {
    expect(
      deriveCompletionRatio({
        avgEngagement: 4,
        assessmentPassed: true,
        assessmentAttempted: true,
      })
    ).toBe(1);
  });

  it("failed but engaged → 0.5", () => {
    expect(
      deriveCompletionRatio({
        avgEngagement: 3.5,
        assessmentPassed: false,
        assessmentAttempted: true,
      })
    ).toBe(0.5);
  });

  it("failed and disengaged → 0", () => {
    expect(
      deriveCompletionRatio({
        avgEngagement: 1.5,
        assessmentPassed: false,
        assessmentAttempted: true,
      })
    ).toBe(0);
  });

  it("not attempted → 0", () => {
    expect(
      deriveCompletionRatio({
        avgEngagement: 5,
        assessmentPassed: false,
        assessmentAttempted: false,
      })
    ).toBe(0);
  });
});

describe("LM-H6: resolveCurrentPhase", () => {
  it("honors explicit currentPhase when set and valid", () => {
    expect(
      resolveCurrentPhase(
        makeStudyPlan({ currentPhase: "fractions", sessionsCompleted: 5 })
      )
    ).toBe("fractions");
  });

  it("revisits earlier phase when knownGaps reference it", () => {
    expect(
      resolveCurrentPhase(
        makeStudyPlan({
          currentPhase: "ratios",
          knownGaps: ["still shaky on fractions"],
        })
      )
    ).toBe("fractions");
  });

  it("derives from progress ratio when currentPhase is empty", () => {
    // 0/15 = 0% → place-value
    expect(resolveCurrentPhase(makeStudyPlan({ sessionsCompleted: 0 }))).toBe(
      "place-value"
    );
    // 14/15 ≈ 93% → pre-algebra (last phase)
    expect(
      resolveCurrentPhase(
        makeStudyPlan({ sessionsCompleted: 14, sessionsPlanned: 15 })
      )
    ).toBe("pre-algebra");
  });

  it("always returns a known phase from PHASE_ORDER", () => {
    const phase = resolveCurrentPhase(
      makeStudyPlan({ sessionsCompleted: 7, sessionsPlanned: 15 })
    );
    expect(PHASE_ORDER).toContain(phase);
  });
});

describe("LM-H7: generateTemplateReceipt — R1 invariants", () => {
  it("names the kid, mentions engagement, assessment, USDC; omits transcript markers", () => {
    const receipt = generateTemplateReceipt({
      childName: "Aiden",
      topic: "fractions",
      durationMinutes: 32,
      avgEngagement: 4.2,
      assessmentPassed: true,
      conceptsCovered: ["common denominators", "fraction addition"],
      knownGaps: [],
      confidenceFlag: "ok",
      usdcSettledMicros: 280_000,
    });
    expect(receipt).toMatch(/Aiden/);
    expect(receipt).toMatch(/engagement|engaged|attentive/i);
    expect(receipt).toMatch(/assessment|check/i);
    expect(receipt).toMatch(/\$0\.28/);
    // Transcript-style content is forbidden (R1 privacy invariant)
    expect(receipt).not.toMatch(/Aiden:.*\n.*Tutor:/);
    expect(receipt).not.toMatch(/Question \d+:/);
  });

  it("low-confidence sessions surface the flag in the receipt — R2", () => {
    const receipt = generateTemplateReceipt({
      childName: "Aiden",
      topic: "decimals",
      durationMinutes: 8,
      avgEngagement: 3,
      assessmentPassed: true,
      conceptsCovered: [],
      knownGaps: [],
      confidenceFlag: "low",
      usdcSettledMicros: 100_000,
    });
    expect(receipt).toMatch(/fast.paced|review|copy.paste|flagged|conversation/i);
    expect(receipt).not.toMatch(/cheating|gaming|punishment/i);
  });

  it("high-quality session reads positively without hype words — R3", () => {
    const receipt = generateTemplateReceipt({
      childName: "Aiden",
      topic: "pre-algebra",
      durationMinutes: 30,
      avgEngagement: 4.8,
      assessmentPassed: true,
      conceptsCovered: ["variables", "one-step equations"],
      knownGaps: [],
      confidenceFlag: "ok",
      usdcSettledMicros: 330_000,
    });
    expect(receipt).toMatch(/attentive|engaged|worked on/i);
    const hypePatterns = [
      /amazing|incredible|fantastic|brilliant/i,
      /crushed it|killed it|nailed it/i,
      /superstar|rockstar|champion/i,
    ];
    for (const p of hypePatterns) {
      expect(receipt).not.toMatch(p);
    }
  });
});
