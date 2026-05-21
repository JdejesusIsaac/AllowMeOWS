/**
 * Sprint 4.0 — S1-S4 schema tests for the Learning Mode studyPlan additions.
 *
 * S1: StudyPlanSchema validates required fields + bounds (durationDays
 *     1-60, minutesPerSession 15-60).
 * S2: SessionRecordSchema validates required fields + bounds (avgEngagement
 *     1-5, confidenceFlag enum).
 * S3: LearningGoalSchema accepts optional studyPlan; goals without it
 *     remain valid (per Sprint Contract criterion 13).
 * S4: CRITICAL — a pre-4.0 family config (no studyPlan field anywhere)
 *     loads cleanly through FamilyConfigSchema.parse. This is the
 *     ship-floor backward-compat gate from test.md.
 */

import { describe, it, expect } from "vitest";
import {
  LearningGoalSchema,
  StudyPlanSchema,
  SessionRecordSchema,
  FamilyConfigSchema,
} from "../src/schemas.js";

describe("S: Sprint 4.0 schema additions", () => {
  it("S1: StudyPlanSchema validates minimum required fields and bounds", () => {
    const validStudyPlan = {
      durationDays: 15,
      minutesPerSession: 30,
      startedAt: "2026-05-19T00:00:00.000Z",
      sessionsCompleted: 0,
      sessionsPlanned: 15,
      currentPhase: "place-value",
      sessions: [],
    };
    const parsed = StudyPlanSchema.parse(validStudyPlan);
    expect(parsed.durationDays).toBe(15);
    expect(parsed.minutesPerSession).toBe(30);
    // Defaults populated for fields not supplied
    expect(parsed.allowMakeupSessions).toBe(false);
    expect(parsed.knownGaps).toEqual([]);

    // Bounds — durationDays
    expect(() =>
      StudyPlanSchema.parse({ ...validStudyPlan, durationDays: 0 })
    ).toThrow();
    expect(() =>
      StudyPlanSchema.parse({ ...validStudyPlan, durationDays: 365 })
    ).toThrow();

    // Bounds — minutesPerSession
    expect(() =>
      StudyPlanSchema.parse({ ...validStudyPlan, minutesPerSession: 5 })
    ).toThrow();
    expect(() =>
      StudyPlanSchema.parse({ ...validStudyPlan, minutesPerSession: 120 })
    ).toThrow();

    // sessionsPlanned must be positive
    expect(() =>
      StudyPlanSchema.parse({ ...validStudyPlan, sessionsPlanned: 0 })
    ).toThrow();
  });

  it("S2: SessionRecordSchema validates required fields and bounds", () => {
    const validRecord = {
      sessionId: "session-001",
      date: "2026-05-19T10:00:00.000Z",
      durationMinutes: 32,
      topic: "place value to 1000",
      assessmentPassed: true,
      assessmentScore: 85,
      conceptsCovered: ["tens place", "hundreds place"],
      knownGaps: ["zero-tens confusion"],
      avgEngagement: 4.2,
      medianTurnIntervalSeconds: 18,
      confidenceFlag: "ok" as const,
      usdcSettled: 280_000, // 6-decimal micros ($0.28)
      receiptSummary:
        "Aiden worked through place value with 4/5 engagement and passed the end-of-session assessment.",
    };
    const parsed = SessionRecordSchema.parse(validRecord);
    expect(parsed.sessionId).toBe("session-001");
    expect(parsed.avgEngagement).toBe(4.2);
    expect(parsed.confidenceFlag).toBe("ok");
    expect(parsed.usdcSettled).toBe(280_000);

    // confidenceFlag must be enum
    expect(() =>
      SessionRecordSchema.parse({ ...validRecord, confidenceFlag: "weird" })
    ).toThrow();

    // avgEngagement must be 1-5
    expect(() =>
      SessionRecordSchema.parse({ ...validRecord, avgEngagement: 6 })
    ).toThrow();
    expect(() =>
      SessionRecordSchema.parse({ ...validRecord, avgEngagement: 0 })
    ).toThrow();

    // usdcSettled must be non-negative
    expect(() =>
      SessionRecordSchema.parse({ ...validRecord, usdcSettled: -1 })
    ).toThrow();
  });

  it("S3: LearningGoalSchema accepts optional studyPlan; tracker-only goals remain valid", () => {
    const goalWithStudyPlan = {
      topic: "Master 7th grade math",
      category: "math",
      completed: false,
      studyPlan: {
        durationDays: 15,
        minutesPerSession: 30,
        startedAt: "2026-05-19T00:00:00.000Z",
        sessionsCompleted: 0,
        sessionsPlanned: 15,
        currentPhase: "place-value",
        sessions: [],
      },
    };
    const parsedWith = LearningGoalSchema.parse(goalWithStudyPlan);
    expect(parsedWith.studyPlan).toBeDefined();
    expect(parsedWith.studyPlan!.durationDays).toBe(15);

    // Goal without studyPlan still parses (tracker-only path)
    const goalTrackerOnly = {
      topic: "Read 10 books",
      category: "reading",
      completed: false,
    };
    const parsedTracker = LearningGoalSchema.parse(goalTrackerOnly);
    expect(parsedTracker.studyPlan).toBeUndefined();
    expect(parsedTracker.completed).toBe(false);
  });

  it("S4: pre-4.0 family config (no studyPlan anywhere) loads cleanly through FamilyConfigSchema", () => {
    // CRITICAL — ship-floor backward-compat. Fixture intentionally omits
    // every Sprint 4.0 field so the test fails loudly if a future change
    // makes any of them non-optional. Mirrors the on-disk JSON shape from
    // pre-4.0 production data exactly.
    const preFortyConfig = {
      familyId: "b0000000-0000-0000-0000-000000000099",
      familyName: "Test Family",
      children: [
        {
          name: "Aiden",
          walletName: "child-aiden",
          weeklyBudget: 5_000_000, // $5.00 in 6-decimal micros
          savingsPercent: 20,
          savingsLockDays: 90,
          categories: [{ name: "math", pct: 100, budget: 5_000_000 }],
          learningGoals: [
            {
              topic: "Master 7th grade math",
              category: "math",
              completed: false,
              // NO studyPlan field — the whole point of the test.
            },
          ],
        },
      ],
      authorizedDestinations: [],
      chainId: "eip155:84532",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    expect(() => FamilyConfigSchema.parse(preFortyConfig)).not.toThrow();
    const parsed = FamilyConfigSchema.parse(preFortyConfig);
    expect(parsed.children[0]!.learningGoals?.[0]!.studyPlan).toBeUndefined();
    // Defaults still hydrate (policyVersion was added in 3.0.6, also optional)
    expect(parsed.policyVersion).toBe(0);
  });
});
