# Sprint 4.0 — Test Specifications

## Test inventory

| Suite | Count | Location | Purpose |
|-------|-------|----------|---------|
| S1-S4 | 4 | `tests/study-plan-schema.test.ts` (NEW) | Schema additions parse + validate; backward compat with pre-4.0 fixtures |
| LS1-LS5 | 5 | `tests/session-lifecycle.test.ts` (NEW) | Start → baseline → tutor → complete → receipt → settle, end-to-end |
| CD1-CD5 | 5 | `tests/cheating-defense.test.ts` (NEW) | Seven-layer defense behaviors (L1, L2, L3, L4, L5) |
| R1-R3 | 3 | `tests/session-receipt.test.ts` (NEW) | Receipt content, privacy, RBAC visibility |
| (manual) Pedagogy smoke | — | n/a | Real conversations with the tutor LLM rendering Socratic mode; Aiden dogfooding |

**Total automated tests added: 17.** Plus one backward-compat migration test (added to existing `tests/schema-migration.test.ts` or `tests/state-manager.test.ts`) = **18 total**.

Test count: 389 → 407.

Manual pedagogy smoke is non-automated. It's the qualitative gate that Aiden's first session works end-to-end — the production validation V2 + V3 in progress-4.0.md.

---

## Why automated tests can't cover pedagogy quality

Worth naming up front: the *most important* thing about Sprint 4.0 — does the LLM actually run a good Socratic tutoring session for a 12-year-old? — is fundamentally not unit-testable. The fragments are prose; the LLM's behavior is probabilistic; the kid's experience is subjective.

What automated tests CAN cover:
- Schema correctness (S1-S4)
- State transitions and persistence (LS1-LS5)
- Mechanical cheating-defense behaviors when given known inputs (CD1-CD5)
- Receipt generation produces structured output with required fields (R1-R3)

What automated tests CANNOT cover:
- Whether the tutor LLM actually shifts to Socratic mode
- Whether engagement scoring catches real low-effort responses vs. legitimate short answers
- Whether the assessment questions are pedagogically appropriate
- Whether the receipt reads honestly vs. promotionally

For those, the gate is Aiden's dogfooding and manual review during V1-V6 smoke. Don't conflate the two layers.

---

## S1-S4 — Schema tests

```typescript
import { describe, it, expect } from "vitest";
import {
  LearningGoalSchema,
  StudyPlanSchema,
  SessionRecordSchema,
  FamilyConfigSchema,
} from "../src/schemas.js";

describe("S: Sprint 4.0 schema additions", () => {
  it("S1: StudyPlan schema validates minimum required fields", () => {
    const validStudyPlan = {
      durationDays: 15,
      minutesPerSession: 30,
      startedAt: "2026-05-19T00:00:00.000Z",
      sessionsCompleted: 0,
      sessionsPlanned: 15,
      currentPhase: "place-value",
      sessions: [],
    };
    expect(StudyPlanSchema.parse(validStudyPlan)).toMatchObject(validStudyPlan);

    // Bounds
    expect(() => StudyPlanSchema.parse({ ...validStudyPlan, durationDays: 0 })).toThrow();
    expect(() => StudyPlanSchema.parse({ ...validStudyPlan, minutesPerSession: 5 })).toThrow();
    expect(() => StudyPlanSchema.parse({ ...validStudyPlan, durationDays: 365 })).toThrow();
  });

  it("S2: SessionRecord schema validates required fields", () => {
    const validRecord = {
      sessionId: "session-001",
      date: "2026-05-19T10:00:00.000Z",
      durationMinutes: 32,
      topic: "place value to 1000",
      assessmentPassed: true,
      assessmentScore: 4,
      conceptsCovered: ["tens place", "hundreds place"],
      knownGaps: ["zero-tens confusion"],
      avgEngagement: 4.2,
      medianTurnIntervalSeconds: 18,
      confidenceFlag: "ok" as const,
      usdcSettled: 280000n.toString(), // BigInt as string for JSON
      receiptSummary: "Aiden worked through place value with 4/5 engagement...",
    };
    expect(SessionRecordSchema.parse(validRecord)).toMatchObject(validRecord);

    // confidenceFlag must be enum
    expect(() => SessionRecordSchema.parse({ ...validRecord, confidenceFlag: "weird" })).toThrow();

    // avgEngagement must be 1-5
    expect(() => SessionRecordSchema.parse({ ...validRecord, avgEngagement: 6 })).toThrow();
    expect(() => SessionRecordSchema.parse({ ...validRecord, avgEngagement: 0 })).toThrow();
  });

  it("S3: LearningGoal accepts optional studyPlan; goals without studyPlan remain valid", () => {
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
    expect(LearningGoalSchema.parse(goalWithStudyPlan)).toMatchObject(goalWithStudyPlan);

    // Goal without studyPlan still parses
    const goalTrackerOnly = {
      topic: "Read 10 books",
      category: "reading",
      completed: false,
    };
    expect(LearningGoalSchema.parse(goalTrackerOnly)).toMatchObject(goalTrackerOnly);
  });

  it("S4: pre-4.0 family config (no studyPlan) loads cleanly through FamilyConfigSchema", () => {
    // Fixture mimicking a pre-4.0 config
    const preFortyConfig = {
      familyId: "test-family-id",
      familyName: "Test Family",
      children: [
        {
          name: "Aiden",
          weeklyBudget: 5_00,
          savingsPercent: 20,
          categories: [{ name: "math", pct: 100, budget: 5_00 }],
          learningGoals: [
            {
              topic: "Master 7th grade math",
              category: "math",
              completed: false,
              // NO studyPlan
            },
          ],
        },
      ],
      authorizedDestinations: [],
      chainId: 84532,
      usdcAddress: "0x036cbd...",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    expect(() => FamilyConfigSchema.parse(preFortyConfig)).not.toThrow();
    const parsed = FamilyConfigSchema.parse(preFortyConfig);
    expect(parsed.children[0].learningGoals?.[0].studyPlan).toBeUndefined();
  });
});
```

---

## LS1-LS5 — Session lifecycle tests

```typescript
import { describe, it, expect } from "vitest";
import { setupFamily, inviteAndRedeemLearner } from "./helpers/setup.js";
import { callTool } from "./helpers/mcp.js";
import { StateManager } from "../src/engine/state.js";

let state: StateManager;

describe("LS: Session lifecycle", () => {
  beforeAll(() => {
    state = new StateManager();
  });

  it("LS1: start-learning-session for first session triggers baseline + returns prompt fragment", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      weeklyBudget: 5_00,
      learningGoals: [
        {
          topic: "Master 7th grade math",
          category: "math",
          studyPlan: {
            durationDays: 15,
            minutesPerSession: 30,
            sessionsPlanned: 15,
          },
        },
      ],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    const res = await callTool("start-learning-session", learnerMemberId, {
      childName: "Aiden",
      goalTopic: "Master 7th grade math",
    });

    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.sessionId).toMatch(/^session-/);
    expect(body.isFirstSession).toBe(true);
    expect(body.promptFragment).toMatch(/baseline assessment|assess.*starting level/i);
    expect(body.sessionState).toMatchObject({
      sessionNumber: 1,
      sessionsRemaining: 15,
    });

    // Audit entry
    const audit = await state.loadAuditLog(familyId);
    expect(audit.find((e) => e.action === "learning-session-started")).toBeDefined();
  });

  it("LS2: subsequent session returns tutoring fragment with current phase context", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Master 7th grade math",
          category: "math",
          studyPlan: {
            durationDays: 15,
            minutesPerSession: 30,
            sessionsPlanned: 15,
            sessionsCompleted: 3,
            currentPhase: "fractions",
            knownGaps: ["common denominators", "improper fractions"],
            baselineAssessment: {
              completedAt: "2026-05-15T00:00:00.000Z",
              level: "intermediate",
              gaps: ["fractions"],
            },
          },
        },
      ],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    // Advance "today" past last session date in test fixture
    const res = await callTool("start-learning-session", learnerMemberId, {
      childName: "Aiden",
      goalTopic: "Master 7th grade math",
    });

    const body = JSON.parse(res.content[0].text);
    expect(body.isFirstSession).toBe(false);
    expect(body.promptFragment).toMatch(/fractions/i);
    // Known gaps surface in prompt context for session continuity
    expect(body.promptFragment).toMatch(/common denominators|improper fractions/i);
    expect(body.sessionState.sessionNumber).toBe(4);
  });

  it("LS3: complete-learning-session persists record, generates receipt, triggers payout", async () => {
    const { familyId, managerMemberId, treasuryAddress } = await setupFamily({
      childName: "Aiden",
      weeklyBudget: 5_00,
      learningGoals: [
        {
          topic: "Master 7th grade math",
          category: "math",
          studyPlan: {
            durationDays: 15,
            minutesPerSession: 30,
            sessionsPlanned: 15,
            sessionsCompleted: 0,
          },
        },
      ],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");
    await fundTreasury(treasuryAddress, 10_000_000n);

    // Start
    const startRes = await callTool("start-learning-session", learnerMemberId, {
      childName: "Aiden",
      goalTopic: "Master 7th grade math",
    });
    const sessionId = JSON.parse(startRes.content[0].text).sessionId;

    // Complete
    const completeRes = await callTool("complete-learning-session", learnerMemberId, {
      sessionId,
      engagementScores: [4, 5, 4, 4, 5, 3, 4, 4, 5],
      turnTimestamps: [
        // 9 turns, ~20-30 seconds apart
        Date.now() - 25 * 9 * 1000,
        Date.now() - 25 * 8 * 1000,
        Date.now() - 25 * 7 * 1000,
        Date.now() - 25 * 6 * 1000,
        Date.now() - 25 * 5 * 1000,
        Date.now() - 25 * 4 * 1000,
        Date.now() - 25 * 3 * 1000,
        Date.now() - 25 * 2 * 1000,
        Date.now() - 25 * 1 * 1000,
      ],
      assessmentResult: {
        questions: ["What is 3/4 + 1/8?", "Why do we need common denominators?"],
        answers: ["7/8", "So fractions can be added directly"],
        score: 2,
        maxScore: 2,
        passed: true,
      },
      conceptsCovered: ["common denominators", "fraction addition"],
      knownGaps: [],
      transcript: "...",
    });

    const body = JSON.parse(completeRes.content[0].text);
    expect(body.success).toBe(true);
    expect(body.payoutUsdc).toBeGreaterThan(0n.toString());
    expect(body.confidenceFlag).toBe("ok");

    // Session record persisted
    const config = await state.loadFamilyConfig(familyId);
    const sessions = config?.children[0].learningGoals?.[0].studyPlan?.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions?.[0].avgEngagement).toBeCloseTo(4.22, 1);
    expect(sessions?.[0].assessmentPassed).toBe(true);

    // Receipt generated
    expect(sessions?.[0].receiptSummary).toBeDefined();
    expect(sessions?.[0].receiptSummary.length).toBeGreaterThan(50);

    // Audit + on-chain settlement
    const audit = await state.loadAuditLog(familyId);
    expect(audit.find((e) => e.action === "learning-session-completed")).toBeDefined();

    // Treasury balance decreased
    const newBalance = await getUsdcBalance(treasuryAddress);
    expect(newBalance).toBeLessThan(10_000_000n);
  });

  it("LS4: payout formula computes correctly across edge cases", async () => {
    // Test the payout computation directly without full end-to-end
    // Formula: (weeklyBudget / sessionsPlanned) × (avgEngagement / 5) × completionRatio

    const cases = [
      // Happy path: full engagement, passed assessment
      {
        weeklyBudgetUsd: 5.0,
        sessionsPlanned: 15,
        avgEngagement: 5.0,
        completionRatio: 1.0,
        expectedUsd: (5.0 / 15) * 1.0 * 1.0, // ≈ $0.33
      },
      // Mid engagement, passed
      {
        weeklyBudgetUsd: 5.0,
        sessionsPlanned: 15,
        avgEngagement: 3.0,
        completionRatio: 1.0,
        expectedUsd: (5.0 / 15) * 0.6 * 1.0, // ≈ $0.20
      },
      // Low engagement, failed assessment, low completion ratio
      {
        weeklyBudgetUsd: 5.0,
        sessionsPlanned: 15,
        avgEngagement: 1.5,
        completionRatio: 0.0,
        expectedUsd: 0, // 0 paid out
      },
    ];

    for (const c of cases) {
      const result = computePayout({
        weeklyBudgetUsdc: BigInt(Math.round(c.weeklyBudgetUsd * 1_000_000)),
        sessionsPlanned: c.sessionsPlanned,
        avgEngagement: c.avgEngagement,
        completionRatio: c.completionRatio,
      });
      const resultUsd = Number(result) / 1_000_000;
      expect(resultUsd).toBeCloseTo(c.expectedUsd, 2);
    }
  });

  it("LS5: view-session-receipt RBAC — learner sees own, manager sees any child", async () => {
    const { familyId, managerMemberId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [/* ... */],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    // Run a session, generate a receipt (abbreviated setup)
    // ... (assume LS3 setup pattern)

    // Manager can view Aiden's receipt
    const managerRes = await callTool("view-session-receipt", managerMemberId, {
      childName: "Aiden",
    });
    expect(JSON.parse(managerRes.content[0].text).success).toBe(true);
    expect(JSON.parse(managerRes.content[0].text).receipts.length).toBeGreaterThan(0);

    // Learner can view own receipt (no childName needed)
    const learnerRes = await callTool("view-session-receipt", learnerMemberId, {});
    expect(JSON.parse(learnerRes.content[0].text).success).toBe(true);

    // Learner CANNOT view another child's receipts (if multi-kid family)
    // (Add second child to setup if needed)
    const otherChildLearnerId = "...";  // simulate a second child's learner ID
    const crossRes = await callTool("view-session-receipt", learnerMemberId, {
      childName: "OtherChild",
    });
    const crossBody = JSON.parse(crossRes.content[0].text);
    expect(crossBody.success).toBe(false);
    expect(crossBody.error).toMatch(/permission|own.*only|not authorized/i);
  });
});
```

---

## CD1-CD5 — Cheating defense tests

```typescript
describe("CD: Cheating defense layers", () => {
  it("CD1: low average engagement reduces payout (L1)", async () => {
    const { familyId, managerMemberId, treasuryAddress } = await setupFamily({
      childName: "Aiden",
      weeklyBudget: 5_00,
      learningGoals: [/* ... studyPlan with sessionsPlanned: 15 ... */],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");
    await fundTreasury(treasuryAddress, 10_000_000n);

    const startRes = await callTool("start-learning-session", learnerMemberId, { /* ... */ });
    const sessionId = JSON.parse(startRes.content[0].text).sessionId;

    // All low-engagement responses ("yes", "ok", "I see")
    const completeRes = await callTool("complete-learning-session", learnerMemberId, {
      sessionId,
      engagementScores: [1, 1, 2, 1, 1],
      turnTimestamps: [/* normal pacing */],
      assessmentResult: { passed: false, score: 0, maxScore: 2 },
      conceptsCovered: [],
      knownGaps: [],
    });

    const body = JSON.parse(completeRes.content[0].text);
    expect(body.success).toBe(true);
    expect(body.confidenceFlag).toBe("ok"); // pacing was normal
    expect(body.payoutUsdc).toBeLessThan(BigInt(50_000)); // very small payout due to low engagement
    // Expected: base $0.33 × (1.2/5) × 0 (failed) = $0.00 actually (completionRatio=0)
    expect(body.payoutUsdc).toBe(0n.toString());
  });

  it("CD2: daily session limit enforced (L4) — second session same day rejected", async () => {
    const { familyId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Master 7th grade math",
          category: "math",
          studyPlan: {
            durationDays: 15,
            minutesPerSession: 30,
            sessionsPlanned: 15,
            lastSessionDate: new Date().toISOString().split("T")[0], // today
            allowMakeupSessions: false,
          },
        },
      ],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    const res = await callTool("start-learning-session", learnerMemberId, {
      childName: "Aiden",
      goalTopic: "Master 7th grade math",
    });

    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/completed today's session|come back tomorrow|daily limit/i);
  });

  it("CD3: allowMakeupSessions=true bypasses daily limit (L4)", async () => {
    const { familyId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Master 7th grade math",
          category: "math",
          studyPlan: {
            durationDays: 15,
            minutesPerSession: 30,
            sessionsPlanned: 15,
            lastSessionDate: new Date().toISOString().split("T")[0],
            allowMakeupSessions: true,
          },
        },
      ],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    const res = await callTool("start-learning-session", learnerMemberId, {
      childName: "Aiden",
      goalTopic: "Master 7th grade math",
    });

    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.isMakeupSession).toBe(true);
  });

  it("CD4: fast median turn interval triggers low-confidence flag (L5)", async () => {
    const { familyId, managerMemberId, treasuryAddress } = await setupFamily({
      childName: "Aiden",
      weeklyBudget: 5_00,
      learningGoals: [/* ... */],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");
    await fundTreasury(treasuryAddress, 10_000_000n);

    const startRes = await callTool("start-learning-session", learnerMemberId, { /* ... */ });
    const sessionId = JSON.parse(startRes.content[0].text).sessionId;

    // Turns 2 seconds apart (suspicious copy-paste behavior)
    const now = Date.now();
    const fastTurnTimestamps = Array.from({ length: 10 }, (_, i) => now - (10 - i) * 2000);

    const completeRes = await callTool("complete-learning-session", learnerMemberId, {
      sessionId,
      engagementScores: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      turnTimestamps: fastTurnTimestamps,
      assessmentResult: { passed: true, score: 2, maxScore: 2 },
      conceptsCovered: ["fractions"],
      knownGaps: [],
    });

    const body = JSON.parse(completeRes.content[0].text);
    expect(body.success).toBe(true);
    expect(body.confidenceFlag).toBe("low");
    expect(body.medianTurnIntervalSeconds).toBeLessThan(5);

    // Audit entry for the flag
    const audit = await state.loadAuditLog(familyId);
    expect(
      audit.find((e) => e.action === "learning-session-flagged-low-confidence"),
    ).toBeDefined();

    // Receipt surfaces the flag
    const config = await state.loadFamilyConfig(familyId);
    const sessions = config?.children[0].learningGoals?.[0].studyPlan?.sessions;
    expect(sessions?.[0].receiptSummary).toMatch(/fast.paced|review|flagged/i);
  });

  it("CD5: known gaps from prior session inform current session prompt (L3)", async () => {
    const { familyId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [
        {
          topic: "Master 7th grade math",
          category: "math",
          studyPlan: {
            durationDays: 15,
            minutesPerSession: 30,
            sessionsPlanned: 15,
            sessionsCompleted: 2,
            currentPhase: "fractions",
            knownGaps: ["improper fractions", "mixed numbers"],
            sessions: [
              /* prior 2 session records */
            ],
          },
        },
      ],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    const res = await callTool("start-learning-session", learnerMemberId, {
      childName: "Aiden",
      goalTopic: "Master 7th grade math",
    });

    const body = JSON.parse(res.content[0].text);
    // The prompt fragment must include reference to known gaps so the tutor
    // LLM can probe / scaffold accordingly
    expect(body.promptFragment).toMatch(/improper fractions/i);
    expect(body.promptFragment).toMatch(/mixed numbers/i);
    // Should also instruct the tutor to reference prior session context for L3
    expect(body.promptFragment).toMatch(/prior session|previous|earlier you/i);
  });
});
```

---

## R1-R3 — Receipt tests

```typescript
describe("R: Session receipts", () => {
  it("R1: receipt summary is ~200 words, includes required fields, omits full transcript", async () => {
    const { familyId } = await setupFamily({
      childName: "Aiden",
      learningGoals: [/* ... */],
    });
    const learnerMemberId = await inviteAndRedeemLearner(familyId, "Aiden");

    // Run a session through completion (abbreviated)
    // ...

    const config = await state.loadFamilyConfig(familyId);
    const sessions = config?.children[0].learningGoals?.[0].studyPlan?.sessions;
    const receipt = sessions?.[0].receiptSummary;

    expect(receipt).toBeDefined();
    const wordCount = receipt!.split(/\s+/).length;
    expect(wordCount).toBeGreaterThan(50);
    expect(wordCount).toBeLessThan(400); // ~200 target with reasonable variance

    // Required content
    expect(receipt).toMatch(/Aiden/);
    expect(receipt).toMatch(/engagement|engaged/i);
    expect(receipt).toMatch(/assessment|quiz|check/i);
    expect(receipt).toMatch(/\$[\d.]+/); // USDC amount

    // Privacy: receipt must NOT contain raw transcript-style content
    // (no Q&A pairs verbatim)
    const transcriptPatterns = [
      /Aiden: .{30,}\nTutor:/, // back-and-forth format
      /Question \d+:/i, // numbered Q&A
    ];
    for (const pattern of transcriptPatterns) {
      expect(receipt).not.toMatch(pattern);
    }
  });

  it("R2: receipt for low-confidence session surfaces the flag honestly", async () => {
    // Run a session with low engagement AND fast turn intervals
    // Trigger confidenceFlag = "low"
    // ...

    const config = await state.loadFamilyConfig(familyId);
    const session = config?.children[0].learningGoals?.[0].studyPlan?.sessions?.[0];
    expect(session?.confidenceFlag).toBe("low");
    expect(session?.receiptSummary).toMatch(/fast.paced|review|low engagement|flagged/i);
    // Receipt should be informational, not punitive
    expect(session?.receiptSummary).not.toMatch(/cheating|gaming|punishment/i);
  });

  it("R3: receipt for high-quality session reads positively without being promotional", async () => {
    // Run a happy-path session: high engagement, passed assessment, normal pacing
    // ...

    const config = await state.loadFamilyConfig(familyId);
    const session = config?.children[0].learningGoals?.[0].studyPlan?.sessions?.[0];
    expect(session?.confidenceFlag).toBe("ok");
    expect(session?.avgEngagement).toBeGreaterThan(4);

    // Receipt names what was learned
    expect(session?.receiptSummary).toMatch(/learned|covered|understood|worked through/i);

    // Receipt is not marketing-shaped — no hype words
    const hypePatterns = [
      /amazing|incredible|fantastic|brilliant/i,
      /crushed it|killed it|nailed it/i,
      /superstar|rockstar|champion/i,
    ];
    for (const pattern of hypePatterns) {
      expect(session?.receiptSummary).not.toMatch(pattern);
    }
  });
});
```

---

## Test fixture helpers

Several helpers may need adding to the test harness:

| Helper | Purpose | Likely exists? |
|--------|---------|----------------|
| `setupFamily(opts)` | Bootstrap family + manager + optional children + optional learning goals (with studyPlan) | Extend from Sprint 3.6 |
| `inviteAndRedeemLearner(familyId, childName)` | Returns learner memberId | Yes (Sprint 3.6) |
| `fundTreasury(addr, amount)` | Send Base Sepolia USDC | Yes |
| `getUsdcBalance(addr)` | Read balance | Yes |
| `callTool(name, memberId, args)` | HTTP MCP invocation | Yes |
| `computePayout(opts)` | Direct call to the payout formula function | NEW — write (~10 lines) |

The `computePayout` helper exposes the internal payout computation for direct unit testing without going through the full session lifecycle.

---

## Coverage matrix

| Property | Tests |
|----------|-------|
| Schema additions parse | S1, S2, S3 |
| Backward compat with pre-4.0 fixtures | S4 (CRITICAL) |
| Baseline assessment on first session | LS1 |
| Subsequent session context-aware tutoring | LS2 |
| Full session lifecycle: start → complete → receipt → settle | LS3 (CRITICAL — proves end-to-end loop) |
| Payout formula correctness across edge cases | LS4 |
| Receipt RBAC and cross-child isolation | LS5 |
| L1 engagement scoring affects payout | CD1 (CRITICAL) |
| L4 daily session limit | CD2 |
| L4 makeup-session override | CD3 |
| L5 cool-down statistical flag | CD4 |
| L3 conversation-state binding via knownGaps | CD5 |
| Receipt content structure + privacy | R1 (CRITICAL) |
| Receipt honesty on low-confidence sessions | R2 |
| Receipt non-promotional tone | R3 |

---

## Critical-path tests

If execution slips and not every test can land, **ship-floor is these five**:

1. **S4** — backward compat. Pre-4.0 families must continue to work.
2. **LS3** — full end-to-end session lifecycle. Proves the core loop.
3. **CD1** — engagement scoring affects payout. The central economic mechanism.
4. **CD2** — daily limit enforced. Basic gaming prevention.
5. **R1** — receipt structure. Parent visibility into the system.

Five tests cover the load-bearing behaviors. The remaining 13 tests catch regressions in details but aren't load-bearing for sprint value.

**If you have to slip:** ship the 5 critical-path tests + all 9 workstreams. Defer S1/S2/S3, LS1/LS2/LS4/LS5, CD3/CD4/CD5, R2/R3 to a Sprint 4.0.x follow-up.

---

## Test execution order

Recommended:

1. **S1-S4 first** (~45 min) — schema validity gates everything else. Write right after Step 1 (schema work) lands.
2. **LS3 second** (~60 min) — end-to-end happy path validates the core loop. Critical-path.
3. **CD1, CD2** (~40 min) — primary defense mechanisms. Critical-path.
4. **R1** (~20 min) — receipt structure. Critical-path.
5. **LS1, LS2** (~40 min) — start-session variations.
6. **LS4, LS5** (~30 min) — payout edge cases + RBAC.
7. **CD3, CD4, CD5** (~50 min) — secondary defense layers.
8. **R2, R3** (~25 min) — receipt content quality.

Total: ~5 hours, broadly matching the W8 estimate. Plus mobile smoke (V1-V6 in progress-4.0.md) which is non-automated.

---

## Manual pedagogy smoke checklist (V2-V3 in progress-4.0.md)

The most important "test" of Sprint 4.0 — does the tutor LLM actually run a good Socratic math session — happens manually with Aiden. Capture:

### V2 attestation (first session + baseline)
- [ ] Aiden's first message in Claude with AllowMe connected: "I want to start my math study"
- [ ] Confirm tutor LLM responds with baseline-assessment framing, not generic "what would you like to learn"
- [ ] Confirm baseline includes 5-10 questions covering grade-level math
- [ ] Confirm baseline result stored in studyPlan
- [ ] Subjective: does the assessment feel age-appropriate? Did Aiden engage or quit?

### V3 attestation (subsequent session)
- [ ] Next calendar day: Aiden continues
- [ ] Confirm tutor opens with continuity reference ("Last time we worked on...")
- [ ] Confirm Socratic patterns visible in the conversation (questions back, not answers given)
- [ ] Confirm engagement scores emit reliably (check session state during the session)
- [ ] Confirm end-of-session assessment generates fresh, references today's content
- [ ] Subjective: did Aiden learn something he didn't know before? Walking away, can he explain what he learned?

These manual observations are the qualitative gate. Automated tests prove the wiring works; manual smoke proves the product works.

---

## Artifacts to capture for docs / pilot pitch

After Sprint 4.0 ships and Aiden's pilot runs:

- [ ] Screenshot of parent configuring math study plan via Claude
- [ ] Screenshot of kid's first session start with baseline assessment
- [ ] Screenshot of mid-session Socratic exchange (engagement score visible if dev mode, hidden if production)
- [ ] Screenshot of end-of-session assessment generation
- [ ] Screenshot of parent receipt for a high-engagement session
- [ ] Screenshot of parent receipt for a low-confidence flagged session (shows the system catching gaming)
- [ ] Audit log excerpt showing the four new action types
- [ ] basescan.org transaction for engagement-weighted USDC payout
- [ ] Aiden's qualitative feedback after 5-7 sessions (anonymized for any external use)

These 9 artifacts close the Sprint 4.0 demoability story for charter school pitches and landing-page docs.