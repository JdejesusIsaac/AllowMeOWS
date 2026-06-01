/**
 * Sprint 4.0.3 — LS-PERF-1 (contract C11 / SC4 / DEL17).
 *
 * Gas-reduction validation. A typical kid week is 7 verified
 * achievements; pre-4.0.3 each `distribute-allowance` broadcast 2 on-chain
 * transactions (wallet leg + savings leg), so the week cost 7 × 2 = 14 tx.
 *
 * Post-cutover, those 7 days produce 14 *ledger* entries (no broadcast),
 * and a single `settle-balance` call batches them by destination into
 * exactly 2 transfers (one child-wallet, one savings-vault). The
 * reduction is (14 − 2) / 14 = 85.7%, clearing the SC4 ≥80% threshold.
 *
 * The pre-cutover baseline (14) is deterministic from the pre-4.0.3
 * distribute-allowance behavior (2 broadcasts per distribute call), so it
 * is encoded as a constant rather than a captured baseline file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { settleBalanceCore } from "../../src/tools/settle-balance.js";
import { WalletDistributor } from "../../src/wallet/distributor.js";
import {
  FilesystemLedger,
  buildLedgerEntriesForAchievement,
} from "../../src/engine/ledger.js";
import { createTestFamily, makeChild } from "../helpers/family.js";
import type { AchievementRecord } from "../../src/schemas.js";
import { randomUUID } from "node:crypto";

vi.mock("../../src/keys/family-api-tokens.js", () => ({
  OWS_TOKEN_PREFIX: "ows_key_",
  FamilyApiTokenManager: class {
    getToken() {
      return "ows_key_" + "a".repeat(64);
    }
  },
  lazyMintTokenForLegacyFamily: async () => "ows_key_" + "a".repeat(64),
}));

function asJson(r: { content: Array<{ text: string }> }): any {
  return JSON.parse(r.content[0].text);
}

/** Pre-4.0.3: distribute-allowance broadcast 2 tx per verified achievement. */
const PRE_CUTOVER_TX_PER_DAY = 2;
const DAYS = 7;
const PRE_CUTOVER_TX = DAYS * PRE_CUTOVER_TX_PER_DAY; // 14

let transferSpy: any;

beforeEach(() => {
  transferSpy = vi.spyOn(WalletDistributor.prototype, "transferUSDC") as any;
});

afterEach(() => {
  transferSpy.mockRestore();
});

describe("LS-PERF-1 — weekly batched settlement gas reduction (SC4)", () => {
  it("settles a 7-day kid week in <= 2 transactions (>= 80% reduction)", async () => {
    transferSpy.mockResolvedValue({
      txHash: "0x" + "0".repeat(64),
      from: "treasury",
      to: "x",
      amount: 0,
    });

    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "learning", pct: 100 }],
          savingsPercent: 20, // each achievement → wallet leg + savings leg
        }),
      ],
    });

    const ledger = new FilesystemLedger();

    // Simulate the dual-write side-effect of 7 verified achievements.
    let expectedEntries = 0;
    for (let day = 0; day < DAYS; day++) {
      const ach: AchievementRecord = {
        id: randomUUID(),
        childName: "Maya",
        category: "learning",
        description: `day ${day}`,
        score: 100,
        amount: 150_000,
        source: "manual",
        verifiedBy: "manager",
        verifiedAt: new Date().toISOString(),
        distributed: false,
      };
      const entries = buildLedgerEntriesForAchievement(ach, 20, family.familyId);
      for (const e of entries) await ledger.append(e);
      expectedEntries += entries.length;
    }
    expect(expectedEntries).toBe(14); // 7 wallet + 7 savings

    // One settle-balance call for the whole family/week.
    const result = await settleBalanceCore({}, family.managerContext);
    const payload = asJson(result);
    expect(payload.success).toBe(true);
    // `settled` in the payload counts settlement *transactions* (one per
    // destination group), not entries — that batching is the gas win.
    expect(payload.settled).toBe(2);

    // All 14 ledger entries are settled despite only 2 transactions.
    const settledEntries = await ledger.listSettled(family.familyId);
    expect(settledEntries).toHaveLength(14);

    const txCount = transferSpy.mock.calls.length;
    expect(txCount).toBeLessThanOrEqual(2);

    const reduction = (PRE_CUTOVER_TX - txCount) / PRE_CUTOVER_TX;
    expect(reduction).toBeGreaterThanOrEqual(0.8);
    // Documented expectation: (14 - 2) / 14 = 0.857.
    expect(txCount).toBe(2);
  });
});
