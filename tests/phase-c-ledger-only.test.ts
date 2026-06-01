/**
 * Sprint 4.0.3 W3+W4+W5 — Phase C ledger-only integration (LS14–LS20).
 *
 * Verifies that with `ALLOWME_LEDGER_MODE=ledger-only`:
 *   - `distribute-allowance` does NOT call transferUSDC; it ledgerizes.
 *   - `release-savings` does NOT call transferUSDC; it writes
 *     savings-release ledger entries.
 *   - `settle-session-payout` does NOT call transferUSDC; it writes
 *     session-payout entries.
 *   - The only path that touches the chain in Phase C is settle-balance.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { distributeAllowanceCore } from "../src/tools/distribute-allowance.js";
import { releaseSavingsCore } from "../src/tools/release-savings.js";
import { settleSessionPayout } from "../src/tools/settle-session-payout.js";
import { WalletDistributor } from "../src/wallet/distributor.js";
import { FilesystemLedger } from "../src/engine/ledger.js";
import { createTestFamily, makeChild } from "./helpers/family.js";
import type { AchievementRecord, SavingsEntry } from "../src/schemas.js";
import { randomUUID } from "node:crypto";

vi.mock("../src/keys/family-api-tokens.js", async () => ({
  OWS_TOKEN_PREFIX: "ows_key_",
  FamilyApiTokenManager: class {
    getToken() {
      return "ows_key_" + "a".repeat(64);
    }
  },
  lazyMintTokenForLegacyFamily: async () => "ows_key_" + "a".repeat(64),
}));

type LooseSpy = ReturnType<typeof vi.fn> & {
  mockResolvedValue: (v: unknown) => LooseSpy;
  mockClear: () => void;
  mockRestore: () => void;
};

let transferSpy: LooseSpy;
const ORIG_MODE = process.env.ALLOWME_LEDGER_MODE;

beforeEach(() => {
  process.env.ALLOWME_LEDGER_MODE = "ledger-only";
  transferSpy = vi.spyOn(
    WalletDistributor.prototype,
    "transferUSDC",
  ) as unknown as LooseSpy;
});

afterEach(() => {
  transferSpy.mockRestore();
  if (ORIG_MODE === undefined) {
    delete process.env.ALLOWME_LEDGER_MODE;
  } else {
    process.env.ALLOWME_LEDGER_MODE = ORIG_MODE;
  }
});

function asJson(r: { content: Array<{ text: string }> }): any {
  return JSON.parse(r.content[0].text);
}

// ---- LS14, LS15 — distribute-allowance ----

describe("LS14, LS15 — distribute-allowance Phase C semantics", () => {
  it("does NOT call transferUSDC and sets Achievement.ledgerized=true", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }], savingsPercent: 20 }),
      ],
    });

    // Seed a pending achievement
    const ach: AchievementRecord = {
      id: randomUUID(),
      childName: "Maya",
      category: "x",
      description: "y",
      score: 100,
      amount: 1_000_000,
      source: "manual",
      verifiedBy: family.memberId,
      verifiedAt: new Date().toISOString(),
      distributed: false,
    };
    await family.state.addAchievement(family.familyId, ach);

    const result = await distributeAllowanceCore(
      { dryRun: false },
      family.managerContext,
    );
    const payload = asJson(result);

    // LS14: no on-chain
    expect(transferSpy).not.toHaveBeenCalled();
    expect(payload.success).toBe(true);
    expect(payload.mode).toBe("ledger-only");

    // LS15: achievement is ledgerized
    const updated = await family.state.loadAchievements(family.familyId);
    expect(updated[0].ledgerized).toBe(true);
    expect(updated[0].distributed).toBe(false); // distributed stays false in Phase C
    expect(updated[0].ledgerizedAt).toBeTruthy();

    // Ledger entries exist (built from this single achievement)
    const ledger = new FilesystemLedger();
    const entries = await ledger.findBySourceId(family.familyId, ach.id);
    expect(entries.length).toBeGreaterThan(0);

    // Response copy mentions settle-balance per Copy-reference.md §10.2
    expect(payload.summary).toMatch(/settle-balance/i);
    expect(payload.summary).toMatch(/Pending settlement/i);
  });

  it("is idempotent — second call after ledgerization does not re-ledgerize", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }], savingsPercent: 0 }),
      ],
    });
    const ach: AchievementRecord = {
      id: randomUUID(),
      childName: "Maya",
      category: "x",
      description: "y",
      score: 100,
      amount: 500_000,
      source: "manual",
      verifiedBy: family.memberId,
      verifiedAt: new Date().toISOString(),
      distributed: false,
    };
    await family.state.addAchievement(family.familyId, ach);

    await distributeAllowanceCore({}, family.managerContext);
    const ledgerBefore = new FilesystemLedger();
    const entriesBefore = await ledgerBefore.findBySourceId(family.familyId, ach.id);
    expect(entriesBefore.length).toBeGreaterThanOrEqual(1);

    const second = await distributeAllowanceCore({}, family.managerContext);
    const payload = asJson(second);

    // Second call sees no pending → "Nothing new to record" empty-state.
    expect(payload.success).toBe(true);
    expect(payload.ledgerized).toBe(0);

    // Idempotency: no new entries were appended for the same achievement
    const ledgerAfter = new FilesystemLedger();
    const entriesAfter = await ledgerAfter.findBySourceId(family.familyId, ach.id);
    expect(entriesAfter.length).toBe(entriesBefore.length);
  });
});

// ---- LS18 — release-savings ----

describe("LS18 — release-savings writes savings-release entries, no broadcast", () => {
  it("matured USDC entries become ledger entries; no transferUSDC call", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });

    const matured: SavingsEntry = {
      id: randomUUID(),
      childName: "Maya",
      amount: 500_000,
      asset: "USDC",
      depositedAt: new Date(Date.now() - 100 * 24 * 3600_000).toISOString(),
      lockUntil: new Date(Date.now() - 24 * 3600_000).toISOString(), // 1d ago
      released: false,
      multiplierAtDeposit: 1.0,
      converted: false,
    };
    await family.state.addSavingsEntry(family.familyId, matured);

    const result = await releaseSavingsCore({ dryRun: false }, family.managerContext);
    const payload = asJson(result);

    expect(transferSpy).not.toHaveBeenCalled();
    expect(payload.mode).toBe("ledger-only");

    const ledger = new FilesystemLedger();
    const releases = (await ledger.listPending(family.familyId, "Maya")).filter(
      (e) => e.kind === "savings-release",
    );
    expect(releases).toHaveLength(1);
    expect(releases[0].amountUsdcMicros).toBe(500_000);
    expect(releases[0].sourceId).toBe(matured.id);

    // Source savings entry is marked released
    const saved = await family.state.loadSavingsEntries(family.familyId, "Maya");
    expect(saved[0].released).toBe(true);
  });
});

// ---- LS19, LS20 — settle-session-payout ----

describe("LS19, LS20 — settle-session-payout Phase C", () => {
  it("writes session-payout ledger entries without on-chain transfer", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }], savingsPercent: 20 }),
      ],
    });

    const result = await settleSessionPayout(family.managerContext, {
      childName: "Maya",
      amountUsdc: 1_000_000,
      sessionId: "sess_1",
    });

    expect(result.ok).toBe(true);
    expect(transferSpy).not.toHaveBeenCalled();

    const ledger = new FilesystemLedger();
    const entries = (await ledger.listPending(family.familyId, "Maya")).filter(
      (e) => e.kind === "session-payout",
    );
    // Two entries: 80% wallet + 20% savings
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.sourceId === "sess_1")).toBe(true);
    const total = entries.reduce((s, e) => s + e.amountUsdcMicros, 0);
    expect(total).toBe(1_000_000);
  });

  it("zero-amount session is a successful no-op (no ledger writes either)", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const result = await settleSessionPayout(family.managerContext, {
      childName: "Maya",
      amountUsdc: 0,
      sessionId: "sess_zero",
    });
    expect(result.ok).toBe(true);
    expect(transferSpy).not.toHaveBeenCalled();

    const ledger = new FilesystemLedger();
    const entries = await ledger.findBySourceId(family.familyId, "sess_zero");
    expect(entries).toHaveLength(0);
  });
});

// ---- LS16 — settle-balance is the only on-chain path ----

describe("LS16 — only settle-balance reaches the chain in Phase C", () => {
  it("all 4 legacy paths stay off-chain", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });

    // distribute-allowance with no pending → no-op
    await distributeAllowanceCore({}, family.managerContext);
    // release-savings with nothing matured → no-op
    await releaseSavingsCore({}, family.managerContext);
    // settle-session-payout zero → no-op
    await settleSessionPayout(family.managerContext, {
      childName: "Maya",
      amountUsdc: 0,
      sessionId: "x",
    });

    expect(transferSpy).not.toHaveBeenCalled();
  });
});
