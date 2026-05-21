/**
 * Sprint 4.0 — LS1-LS5 session lifecycle tests + CD1-CD5 cheating
 * defense + R1 integration receipt invariants. Single file because
 * setup is shared and the loop is genuinely one piece.
 *
 * Strategy: mock WalletDistributor + FamilyKeyManager at module level
 * (same pattern as `tests/allowlist-enforcement.test.ts`), then drive
 * the tool handlers via their exported `*Wrapped` middleware closures
 * using the test-mode `_callerRole / _callerId / _familyId` args.
 *
 * Coverage map to plan / test.md:
 *   - LS1: start-learning-session on first session → baseline fragment + audit
 *   - LS2: subsequent session returns phase context + knownGaps surface
 *   - LS3: end-to-end happy path (CRITICAL — ship-floor)
 *   - LS4: payout formula edge cases (covered by helper tests + this)
 *   - LS5: view-session-receipt RBAC (learner-self, manager all)
 *   - CD1: low avgEngagement reduces payout to zero
 *   - CD2: daily limit blocks second session same UTC day
 *   - CD3: allowMakeupSessions=true bypasses daily limit
 *   - CD4: fast median turn interval → confidence "low" + audit entry
 *   - CD5: knownGaps from prior sessions surface in next prompt fragment
 *   - R1: receipt content + privacy invariants on actual tool output
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const mockTransferUSDC = vi.fn();
vi.mock("../src/wallet/distributor.js", () => ({
  WalletDistributor: vi.fn().mockImplementation(() => ({
    transferUSDC: mockTransferUSDC,
  })),
}));
vi.mock("../src/keys/family-keys.js", () => ({
  FamilyKeyManager: vi.fn().mockImplementation(() => ({
    hasFamilyKey: () => true,
    getFamilyKey: () => "test-passphrase",
    getOrGenerateFamilyKey: () => "test-passphrase",
  })),
}));

import { StateManager } from "../src/engine/state.js";
import { MemberIndex } from "../src/identity/member-index.js";
import { startLearningSessionWrapped } from "../src/tools/start-learning-session.js";
import { completeLearningSessionWrapped } from "../src/tools/complete-learning-session.js";
import { viewSessionReceiptWrapped } from "../src/tools/view-session-receipt.js";
import { ROLES, USDC, CHAIN_IDS } from "../src/constants.js";
import type {
  FamilyConfig,
  Member,
  StudyPlan,
  ChildConfig,
} from "../src/schemas.js";

const testDataDir = join(process.cwd(), "data");

interface SetupOpts {
  childName?: string;
  weeklyBudgetUsd?: number;
  walletAddress?: string;
  authorizedDestinations?: string[];
  studyPlan?: Partial<StudyPlan> | null;
  category?: string;
  goalTopic?: string;
}

interface SetupResult {
  familyId: string;
  managerId: string;
  learnerId: string;
  goalTopic: string;
  childName: string;
}

async function setupFamily(opts: SetupOpts = {}): Promise<SetupResult> {
  const familyId = randomUUID();
  const managerId = randomUUID();
  const learnerId = randomUUID();
  const childName = opts.childName ?? "Aiden";
  const goalTopic = opts.goalTopic ?? "Master 7th grade math";
  const category = opts.category ?? "math";
  const weeklyBudget = Math.round(
    (opts.weeklyBudgetUsd ?? 5) * 10 ** USDC.DECIMALS
  );
  const walletAddress = opts.walletAddress;
  const baseStudyPlan: StudyPlan = {
    durationDays: 15,
    minutesPerSession: 30,
    sessionsCompleted: 0,
    sessionsPlanned: 15,
    currentPhase: "",
    sessions: [],
    allowMakeupSessions: false,
    knownGaps: [],
  };
  const studyPlan: StudyPlan | undefined =
    opts.studyPlan === null
      ? undefined
      : { ...baseStudyPlan, ...(opts.studyPlan ?? {}) };
  const child: ChildConfig = {
    name: childName,
    walletName: `child-${childName.toLowerCase()}`,
    walletAddress,
    weeklyBudget,
    categories: [{ name: category, pct: 100, budget: weeklyBudget }],
    savingsPercent: 20,
    savingsLockDays: 90,
    learningGoals: [
      {
        topic: goalTopic,
        category,
        completed: false,
        ...(studyPlan ? { studyPlan } : {}),
      },
    ],
  };
  const config: FamilyConfig = {
    familyId,
    familyName: "Test Family",
    children: [child],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chainId: CHAIN_IDS.BASE_SEPOLIA,
    usdcAddress: USDC.BASE_SEPOLIA,
    authorizedDestinations: opts.authorizedDestinations
      ? opts.authorizedDestinations.map((a) => a.toLowerCase())
      : walletAddress
        ? [walletAddress.toLowerCase()]
        : [],
    policyVersion: 1,
  };

  const state = new StateManager();
  const index = new MemberIndex();
  await state.createFamilyDir(familyId);
  await state.saveFamilyConfig(familyId, config);

  const now = new Date().toISOString();
  const manager: Member = {
    id: managerId,
    name: "Test Manager",
    role: ROLES.MANAGER,
    joinedAt: now,
    active: true,
  };
  await state.addMember(familyId, manager);
  await index.set(managerId, familyId, ROLES.MANAGER);

  const learner: Member = {
    id: learnerId,
    name: childName,
    role: ROLES.LEARNER,
    childName,
    joinedAt: now,
    active: true,
  };
  await state.addMember(familyId, learner);
  await index.set(learnerId, familyId, ROLES.LEARNER);

  await state.initializeStreak(familyId, childName);

  return { familyId, managerId, learnerId, goalTopic, childName };
}

function parseResponse<T = Record<string, unknown>>(response: {
  content: Array<{ type: "text"; text: string }>;
}): T {
  return JSON.parse(response.content[0]!.text) as T;
}

function learnerArgs(s: SetupResult) {
  return {
    _callerRole: ROLES.LEARNER,
    _callerId: s.learnerId,
    _familyId: s.familyId,
    _callerChildName: s.childName,
  };
}

function managerArgs(s: SetupResult) {
  return {
    _callerRole: ROLES.MANAGER,
    _callerId: s.managerId,
    _familyId: s.familyId,
  };
}

beforeEach(async () => {
  await rm(testDataDir, { recursive: true, force: true });
  await mkdir(testDataDir, { recursive: true });
  mockTransferUSDC.mockReset();
  mockTransferUSDC.mockResolvedValue({ txHash: "0xdeadbeef" });
});

afterEach(async () => {
  await rm(testDataDir, { recursive: true, force: true });
});

// ===== LS1-LS5: Session lifecycle =====

describe("LS: Session lifecycle", () => {
  it("LS1: first session triggers baseline fragment + writes audit entry", async () => {
    const s = await setupFamily();
    const res = await startLearningSessionWrapped({
      childName: s.childName,
      goalTopic: s.goalTopic,
      ...learnerArgs(s),
    });
    const body = parseResponse<{
      success: boolean;
      sessionId: string;
      isFirstSession: boolean;
      promptFragment: string;
      sessionState: { sessionNumber: number; sessionsRemaining: number };
    }>(res);
    expect(body.success).toBe(true);
    expect(body.isFirstSession).toBe(true);
    expect(body.sessionId).toMatch(/^session-/);
    expect(body.promptFragment).toMatch(/baseline|assess.*level|calibrate/i);
    expect(body.sessionState.sessionNumber).toBe(1);
    expect(body.sessionState.sessionsRemaining).toBe(15);

    const audit = await new StateManager().loadAuditLog(s.familyId);
    expect(
      audit.find((e) => e.action === "learning-session-started")
    ).toBeDefined();
  });

  it("LS2: subsequent session returns topic fragment + surfaces knownGaps (L3)", async () => {
    const s = await setupFamily({
      studyPlan: {
        sessionsCompleted: 3,
        currentPhase: "fractions",
        knownGaps: ["common denominators", "improper fractions"],
        baselineAssessment: {
          completedAt: new Date().toISOString(),
          level: "intermediate",
          gaps: ["fractions"],
        },
        // Set lastSessionDate to yesterday so today's session is allowed
        lastSessionDate: "2026-01-01",
      },
    });

    const res = await startLearningSessionWrapped({
      childName: s.childName,
      goalTopic: s.goalTopic,
      ...learnerArgs(s),
    });
    const body = parseResponse<{
      success: boolean;
      isFirstSession: boolean;
      promptFragment: string;
      sessionState: { sessionNumber: number; knownGaps: string[] };
    }>(res);
    expect(body.success).toBe(true);
    expect(body.isFirstSession).toBe(false);
    // Phase fragment loaded
    expect(body.promptFragment).toMatch(/fractions/i);
    // L3 — knownGaps from prior sessions surface in the prompt
    expect(body.promptFragment).toMatch(/common denominators/i);
    expect(body.promptFragment).toMatch(/improper fractions/i);
    expect(body.promptFragment).toMatch(/prior session|earlier/i);
    expect(body.sessionState.sessionNumber).toBe(4);
  });

  it("LS3: full happy path — start → complete → receipt + audit + settlement", async () => {
    const s = await setupFamily({ walletAddress: "0x" + "a".repeat(40) });
    const startRes = await startLearningSessionWrapped({
      childName: s.childName,
      goalTopic: s.goalTopic,
      ...learnerArgs(s),
    });
    const startBody = parseResponse<{ sessionId: string }>(startRes);

    const now = Date.now();
    const completeRes = await completeLearningSessionWrapped({
      sessionId: startBody.sessionId,
      childName: s.childName,
      goalTopic: s.goalTopic,
      engagementScores: [4, 5, 4, 4, 5, 3, 4, 4, 5],
      turnTimestamps: [
        now - 200_000,
        now - 175_000,
        now - 150_000,
        now - 125_000,
        now - 100_000,
        now - 75_000,
        now - 50_000,
        now - 25_000,
        now,
      ],
      assessmentResult: {
        questions: ["What is 3/4 + 1/8?", "Why common denominators?"],
        answers: ["7/8", "So we can add them"],
        score: 2,
        maxScore: 2,
        passed: true,
      },
      conceptsCovered: ["common denominators", "fraction addition"],
      knownGaps: [],
      durationMinutes: 30,
      topic: "fractions",
      ...learnerArgs(s),
    });
    const completeBody = parseResponse<{
      success: boolean;
      payoutUsdc: number;
      confidenceFlag: string;
      receiptSummary: string;
      txHash: string | null;
    }>(completeRes);
    expect(completeBody.success).toBe(true);
    expect(completeBody.payoutUsdc).toBeGreaterThan(0);
    expect(completeBody.confidenceFlag).toBe("ok");
    expect(completeBody.receiptSummary.length).toBeGreaterThan(20);
    // R1 invariants on the actual tool-returned receipt
    expect(completeBody.receiptSummary).toMatch(/Aiden/);
    expect(completeBody.receiptSummary).toMatch(/\$\d/);

    // Persisted SessionRecord
    const config = await new StateManager().loadFamilyConfig(s.familyId);
    const sessions =
      config!.children[0]!.learningGoals![0]!.studyPlan!.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.avgEngagement).toBeCloseTo(4.22, 1);
    expect(sessions[0]!.assessmentPassed).toBe(true);
    expect(sessions[0]!.usdcSettled).toBeGreaterThan(0);

    // Audit log + on-chain
    const audit = await new StateManager().loadAuditLog(s.familyId);
    expect(
      audit.find((e) => e.action === "learning-session-completed")
    ).toBeDefined();
    // Both legs (child + savings) called
    expect(mockTransferUSDC).toHaveBeenCalled();
  });

  it("LS5: view-session-receipt RBAC — learner sees own only; manager sees any", async () => {
    const s = await setupFamily({ walletAddress: "0x" + "b".repeat(40) });
    const startBody = parseResponse<{ sessionId: string }>(
      await startLearningSessionWrapped({
        childName: s.childName,
        goalTopic: s.goalTopic,
        ...learnerArgs(s),
      })
    );
    await completeLearningSessionWrapped({
      sessionId: startBody.sessionId,
      childName: s.childName,
      goalTopic: s.goalTopic,
      engagementScores: [4, 4, 4],
      turnTimestamps: [Date.now() - 60_000, Date.now() - 30_000, Date.now()],
      assessmentResult: { passed: true, score: 1, maxScore: 1 },
      conceptsCovered: ["place value"],
      knownGaps: [],
      durationMinutes: 25,
      topic: "place value",
      ...learnerArgs(s),
    });

    const mgr = parseResponse<{ success: boolean; receipts: unknown[] }>(
      await viewSessionReceiptWrapped({ ...managerArgs(s) })
    );
    expect(mgr.success).toBe(true);
    expect(mgr.receipts.length).toBeGreaterThan(0);

    const learnerView = parseResponse<{ success: boolean; receipts: unknown[] }>(
      await viewSessionReceiptWrapped({ ...learnerArgs(s) })
    );
    expect(learnerView.success).toBe(true);
    expect(learnerView.receipts.length).toBeGreaterThan(0);

    // Learner trying to pass a different childName must be ignored
    // (scoped to own child).
    const learnerCross = parseResponse<{ receipts: Array<{ childName: string }> }>(
      await viewSessionReceiptWrapped({
        childName: "SomeOtherChild",
        ...learnerArgs(s),
      })
    );
    // Either returns own (childName arg ignored) or empty — either way,
    // it does NOT leak another child's data.
    for (const r of learnerCross.receipts) {
      expect(r.childName).toBe(s.childName);
    }
  });
});

// ===== CD1-CD5: Cheating defense =====

describe("CD: Cheating defense layers", () => {
  it("CD1: low avgEngagement reduces payout to zero (L1)", async () => {
    const s = await setupFamily({ walletAddress: "0x" + "c".repeat(40) });
    const startBody = parseResponse<{ sessionId: string }>(
      await startLearningSessionWrapped({
        childName: s.childName,
        goalTopic: s.goalTopic,
        ...learnerArgs(s),
      })
    );
    const now = Date.now();
    const res = await completeLearningSessionWrapped({
      sessionId: startBody.sessionId,
      childName: s.childName,
      goalTopic: s.goalTopic,
      // All ones — pure spam
      engagementScores: [1, 1, 1, 1, 1],
      turnTimestamps: [
        now - 100_000,
        now - 75_000,
        now - 50_000,
        now - 25_000,
        now,
      ],
      assessmentResult: { passed: false, score: 0, maxScore: 2 },
      conceptsCovered: [],
      knownGaps: [],
      durationMinutes: 30,
      ...learnerArgs(s),
    });
    const body = parseResponse<{
      success: boolean;
      payoutUsdc: number;
      confidenceFlag: string;
      avgEngagement: number;
    }>(res);
    expect(body.success).toBe(true);
    expect(body.confidenceFlag).toBe("ok"); // pacing normal
    expect(body.payoutUsdc).toBe(0); // engagement=1 + failed = no payout
    expect(body.avgEngagement).toBe(1);
  });

  it("CD2: daily limit blocks second session same UTC day (L4)", async () => {
    const s = await setupFamily({
      studyPlan: {
        lastSessionDate: new Date().toISOString().slice(0, 10), // today
        allowMakeupSessions: false,
      },
    });
    const res = await startLearningSessionWrapped({
      childName: s.childName,
      goalTopic: s.goalTopic,
      ...learnerArgs(s),
    });
    const body = parseResponse<{
      success: boolean;
      dailyLimitReached?: boolean;
      error: string;
    }>(res);
    expect(body.success).toBe(false);
    expect(body.dailyLimitReached).toBe(true);
    expect(body.error).toMatch(/today.*session|come back tomorrow|daily limit/i);
  });

  it("CD3: allowMakeupSessions=true bypasses the daily limit (L4 override)", async () => {
    const s = await setupFamily({
      studyPlan: {
        lastSessionDate: new Date().toISOString().slice(0, 10),
        allowMakeupSessions: true,
      },
    });
    const res = await startLearningSessionWrapped({
      childName: s.childName,
      goalTopic: s.goalTopic,
      ...learnerArgs(s),
    });
    const body = parseResponse<{ success: boolean; isMakeupSession: boolean }>(
      res
    );
    expect(body.success).toBe(true);
    expect(body.isMakeupSession).toBe(true);
  });

  it("CD4: fast median turn interval → 'low' confidence + audit flag (L5)", async () => {
    const s = await setupFamily({ walletAddress: "0x" + "d".repeat(40) });
    const startBody = parseResponse<{ sessionId: string }>(
      await startLearningSessionWrapped({
        childName: s.childName,
        goalTopic: s.goalTopic,
        ...learnerArgs(s),
      })
    );
    const now = Date.now();
    // 10 turns 2 seconds apart = median 2s < 5s threshold
    const fast = Array.from({ length: 10 }, (_, i) => now - (9 - i) * 2_000);
    const res = await completeLearningSessionWrapped({
      sessionId: startBody.sessionId,
      childName: s.childName,
      goalTopic: s.goalTopic,
      engagementScores: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      turnTimestamps: fast,
      assessmentResult: { passed: true, score: 2, maxScore: 2 },
      conceptsCovered: ["fractions"],
      knownGaps: [],
      durationMinutes: 1,
      ...learnerArgs(s),
    });
    const body = parseResponse<{
      success: boolean;
      confidenceFlag: string;
      medianTurnIntervalSeconds: number;
      receiptSummary: string;
    }>(res);
    expect(body.success).toBe(true);
    expect(body.confidenceFlag).toBe("low");
    expect(body.medianTurnIntervalSeconds).toBeLessThan(5);

    const audit = await new StateManager().loadAuditLog(s.familyId);
    expect(
      audit.find(
        (e) => e.action === "learning-session-flagged-low-confidence"
      )
    ).toBeDefined();
    // R2: receipt surfaces the flag
    expect(body.receiptSummary).toMatch(
      /fast.paced|review|copy.paste|flagged|conversation/i
    );
  });

  it("CD5: knownGaps from completed session flow into next session's prompt (L3)", async () => {
    const s = await setupFamily({ walletAddress: "0x" + "e".repeat(40) });
    // First session — complete it with knownGaps captured
    const startBody = parseResponse<{ sessionId: string }>(
      await startLearningSessionWrapped({
        childName: s.childName,
        goalTopic: s.goalTopic,
        ...learnerArgs(s),
      })
    );
    const now = Date.now();
    await completeLearningSessionWrapped({
      sessionId: startBody.sessionId,
      childName: s.childName,
      goalTopic: s.goalTopic,
      engagementScores: [4, 4, 4],
      turnTimestamps: [now - 90_000, now - 60_000, now - 30_000],
      assessmentResult: { passed: true, score: 1, maxScore: 1 },
      conceptsCovered: ["place value"],
      knownGaps: ["zero-tens confusion in 3-digit numbers"],
      durationMinutes: 25,
      ...learnerArgs(s),
    });

    // Reset lastSessionDate so we can start a 2nd session today.
    const state = new StateManager();
    const config = await state.loadFamilyConfig(s.familyId);
    config!.children[0]!.learningGoals![0]!.studyPlan!.lastSessionDate =
      "2026-01-01";
    await state.saveFamilyConfig(s.familyId, config!);

    // Second session — knownGaps from session 1 must appear in the
    // prompt fragment, per L3 binding.
    const nextRes = await startLearningSessionWrapped({
      childName: s.childName,
      goalTopic: s.goalTopic,
      ...learnerArgs(s),
    });
    const nextBody = parseResponse<{ promptFragment: string }>(nextRes);
    expect(nextBody.promptFragment).toMatch(/zero-tens confusion/i);
  });
});

// ===== R1: integration receipt invariants (tool-returned) =====

describe("R: Session receipts (integration)", () => {
  it("R1: receipt from completed session names kid, mentions engagement + USDC, omits transcript", async () => {
    const s = await setupFamily({ walletAddress: "0x" + "f".repeat(40) });
    const startBody = parseResponse<{ sessionId: string }>(
      await startLearningSessionWrapped({
        childName: s.childName,
        goalTopic: s.goalTopic,
        ...learnerArgs(s),
      })
    );
    const now = Date.now();
    const res = await completeLearningSessionWrapped({
      sessionId: startBody.sessionId,
      childName: s.childName,
      goalTopic: s.goalTopic,
      engagementScores: [4, 5, 4, 4, 5],
      turnTimestamps: [
        now - 120_000,
        now - 90_000,
        now - 60_000,
        now - 30_000,
        now,
      ],
      assessmentResult: { passed: true, score: 2, maxScore: 2 },
      conceptsCovered: ["place value"],
      knownGaps: [],
      durationMinutes: 30,
      ...learnerArgs(s),
    });
    const body = parseResponse<{ receiptSummary: string }>(res);
    expect(body.receiptSummary).toMatch(/Aiden/);
    expect(body.receiptSummary).toMatch(/engagement|engaged|attentive/i);
    expect(body.receiptSummary).toMatch(/\$\d/);
    // No transcript markers
    expect(body.receiptSummary).not.toMatch(/Aiden:.*\n.*Tutor:/);
    expect(body.receiptSummary).not.toMatch(/Question \d+:/);
    // Confidence flag should be ok for normal pacing
    expect(body.receiptSummary).not.toMatch(/copy.paste|flagged/i);
  });
});

// ===== Math-only enforcement (Sprint Contract criterion 12) =====

describe("Sprint 4.0 math-only enforcement", () => {
  it("non-math studyPlan returns silent-with-note from start-learning-session", async () => {
    const s = await setupFamily({
      category: "reading",
      goalTopic: "Read Hamlet",
    });
    const res = await startLearningSessionWrapped({
      childName: s.childName,
      goalTopic: s.goalTopic,
      ...learnerArgs(s),
    });
    const body = parseResponse<{
      success: boolean;
      mathOnly?: boolean;
      message: string;
    }>(res);
    expect(body.success).toBe(false);
    expect(body.mathOnly).toBe(true);
    expect(body.message).toMatch(/math.only|tracker.only/i);
  });
});
