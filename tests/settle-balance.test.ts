/**
 * Sprint 4.0.3 W6 + W8 — settle-balance integration tests
 * (LS21-LS33, LS41-LS50, LS65).
 *
 * Approach: invoke `settleBalanceCore` directly with a CallerContext.
 * `WalletDistributor.prototype.transferUSDC` is mocked via `vi.spyOn`
 * so tests don't touch an OWS vault or a real RPC.
 *
 * Idempotent setup: every `describe` block uses a fresh family, so
 * test order doesn't matter and parallelization (when re-enabled) is
 * safe.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ROLES } from "../src/constants.js";
import { settleBalanceCore } from "../src/tools/settle-balance.js";
import { WalletDistributor } from "../src/wallet/distributor.js";
import { FilesystemLedger, buildLedgerEntriesForAchievement } from "../src/engine/ledger.js";
import { createTestFamily, makeChild } from "./helpers/family.js";
import type { CallerContext } from "../src/middleware/access-control.js";
import type { AchievementRecord, LedgerEntry } from "../src/schemas.js";
import { randomUUID } from "node:crypto";

function asJson(response: { content: Array<{ text: string }> }): any {
  return JSON.parse(response.content[0].text);
}

function makeAch(childName: string, amount: number): AchievementRecord {
  return {
    id: randomUUID(),
    childName,
    category: "reading",
    description: "x",
    score: 100,
    amount,
    source: "manual",
    verifiedBy: "manager",
    verifiedAt: new Date().toISOString(),
    distributed: false,
  };
}

interface SeedPartial {
  childName: string;
  destination: LedgerEntry["destination"];
  amountUsdcMicros: number;
  kind: LedgerEntry["kind"];
  status?: LedgerEntry["status"];
  sourceId?: string;
  retryCount?: number;
}

async function seedLedger(
  ledger: FilesystemLedger,
  familyId: string,
  entries: SeedPartial[],
): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  for (const partial of entries) {
    const e = await ledger.append({
      id: randomUUID(),
      familyId,
      childName: partial.childName,
      kind: partial.kind,
      destination: partial.destination,
      amountUsdcMicros: partial.amountUsdcMicros,
      status: partial.status ?? "pending",
      createdAt: new Date().toISOString(),
      sourceId: partial.sourceId ?? randomUUID(),
      retryCount: partial.retryCount ?? 0,
    });
    out.push(e);
  }
  return out;
}

// Mock token resolution so we don't need a real OWS vault. The
// FamilyApiTokenManager is bypassed via the lazy-mint catch path —
// we mock that surface to return a fake token, which the
// WalletDistributor mock then ignores.
vi.mock("../src/keys/family-api-tokens.js", async () => {
  return {
    OWS_TOKEN_PREFIX: "ows_key_",
    FamilyApiTokenManager: class {
      getToken() {
        return "ows_key_" + "a".repeat(64);
      }
    },
    lazyMintTokenForLegacyFamily: async () => "ows_key_" + "a".repeat(64),
  };
});

// vi.spyOn on a method with positional typed params trips on vitest's
// MockInstance unknown-args inference. Cast to a loose any-arg spy so
// we can use mockResolvedValue / mockImplementation freely.
type LooseSpy = {
  mockResolvedValue: (v: unknown) => LooseSpy;
  mockResolvedValueOnce: (v: unknown) => LooseSpy;
  mockRejectedValue: (e: unknown) => LooseSpy;
  mockRejectedValueOnce: (e: unknown) => LooseSpy;
  mockImplementation: (fn: (...args: never[]) => unknown) => LooseSpy;
  mockImplementationOnce: (fn: (...args: never[]) => unknown) => LooseSpy;
  mockClear: () => void;
  mockRestore: () => void;
  toHaveBeenCalledTimes: (n: number) => void;
} & ReturnType<typeof vi.fn>;

let transferSpy: LooseSpy;

beforeEach(() => {
  transferSpy = vi.spyOn(
    WalletDistributor.prototype,
    "transferUSDC",
  ) as unknown as LooseSpy;
});

afterEach(() => {
  transferSpy.mockRestore();
});

// ===========================================================================
// RBAC tests
// ===========================================================================

describe("LS22 — learner can call settle-balance for own childName", () => {
  it("returns success for a learner settling their own balance", async () => {
    transferSpy.mockResolvedValue({
      txHash: "0xabc1",
      from: "treasury",
      to: "child-maya",
      amount: 500_000,
    });

    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "reading", pct: 100 }],
          savingsPercent: 0,
        }),
      ],
    });
    const learner = await family.addMember(ROLES.LEARNER, {
      name: "Maya",
      childName: "Maya",
    });

    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
    ]);

    const result = await settleBalanceCore({}, learner.context);
    const payload = asJson(result);
    expect(payload.success).toBe(true);
    expect(payload.settled).toBe(1);
    expect(transferSpy).toHaveBeenCalledTimes(1);
  });
});

describe("LS23 — learner cannot settle for a different child", () => {
  it("returns error when learner supplies a sibling's childName", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
        makeChild("Diego", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const mayaLearner = await family.addMember(ROLES.LEARNER, {
      name: "Maya",
      childName: "Maya",
    });

    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Diego", destination: "child-wallet", amountUsdcMicros: 300_000, kind: "achievement-credit" },
    ]);

    const result = await settleBalanceCore({ childName: "Diego" }, mayaLearner.context);
    const payload = asJson(result);
    expect(payload.success).toBe(false);
    expect(payload.error.toLowerCase()).toContain("cannot settle for another child");
    expect(transferSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Happy path
// ===========================================================================

describe("LS21 — happy path: one tx per destination, shared batchId", () => {
  it("3 wallet entries + 1 savings entry → 2 transferUSDC calls + 4 settled", async () => {
    transferSpy.mockImplementation(async (_from, _to, amount: number) => ({
      txHash: amount === 800_000 ? "0xwallet" : "0xsavings",
      from: "treasury",
      to: "x",
      amount,
    }));

    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });

    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 300_000, kind: "achievement-credit" },
      { childName: "Maya", destination: "savings-vault", amountUsdcMicros: 200_000, kind: "savings-deposit" },
    ]);

    const result = await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    const payload = asJson(result);

    expect(payload.success).toBe(true);
    expect(payload.settled).toBe(2);
    expect(transferSpy).toHaveBeenCalledTimes(2);

    const settled = await ledger.listSettled(family.familyId);
    expect(settled).toHaveLength(3);
    const batchIds = new Set(settled.map((e) => e.settlementBatchId));
    expect(batchIds.size).toBe(1);
    expect(payload.batchId).toBeTruthy();
  });
});

describe("LS27 — family-wide settle without childName", () => {
  it("settles entries across multiple children", async () => {
    transferSpy.mockResolvedValue({
      txHash: "0xabc",
      from: "treasury",
      to: "x",
      amount: 0,
    });

    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
        makeChild("Diego", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });

    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
      { childName: "Diego", destination: "child-wallet", amountUsdcMicros: 300_000, kind: "achievement-credit" },
    ]);

    const result = await settleBalanceCore({}, family.managerContext);
    const payload = asJson(result);
    expect(payload.success).toBe(true);
    expect(payload.settled).toBe(2);

    const settled = await ledger.listSettled(family.familyId);
    expect(settled).toHaveLength(2);
  });
});

describe("LS26 — dry-run preview", () => {
  it("dryRun=true returns preview and does not call transferUSDC", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
    ]);

    const result = await settleBalanceCore(
      { childName: "Maya", dryRun: true },
      family.managerContext,
    );
    const payload = asJson(result);

    expect(payload.dryRun).toBe(true);
    expect(transferSpy).not.toHaveBeenCalled();
    expect(payload.summary.toLowerCase()).toContain("preview");
    expect(payload.summary).toContain("$0.50");
  });
});

describe("LS29 — nothing-to-settle is friendly, not error-shaped", () => {
  it("empty pending returns success with encouraging copy", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });

    const result = await settleBalanceCore(
      { childName: "Maya" },
      family.managerContext,
    );
    const payload = asJson(result);
    expect(payload.success).toBe(true);
    expect(payload.settled).toBe(0);

    const text = payload.summary.toLowerCase();
    // Banned words per Copy-reference.md §9.7 / §1.5
    expect(text).not.toMatch(/error|fail|problem/);
    expect(text).toMatch(/nothing to settle|all caught up/);
  });

  it("LS65 — same empty-state copy regardless of role", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const learner = await family.addMember(ROLES.LEARNER, {
      name: "Maya",
      childName: "Maya",
    });

    const result = await settleBalanceCore({}, learner.context);
    const text = asJson(result).summary.toLowerCase();
    expect(text).not.toMatch(/error|fail|problem/);
  });
});

// ===========================================================================
// Allowlist (LS31-LS33)
// ===========================================================================

describe("LS31, LS32, LS33 — allowlist pre-flight check", () => {
  it("rejects pre-broadcast when destination is not authorized; entries stay pending", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          walletAddress: "0xMayaExternalWallet0000000000000000000001",
        }),
      ],
    });
    // Empty authorizedDestinations — anything external is rejected.

    const ledger = new FilesystemLedger();
    const seeded = await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
    ]);

    const result = await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    const payload = asJson(result);

    expect(payload.success).toBe(false);
    expect(payload.settled).toBe(0);
    expect(payload.preflightBlocked).toBe(1);
    expect(transferSpy).not.toHaveBeenCalled();

    // LS32: entries stay pending
    const pending = await ledger.listPending(family.familyId, "Maya");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(seeded[0].id);
    expect(pending[0].status).toBe("pending");

    // LS33: response identifies the address and routes to configure-policy
    expect(payload.summary).toMatch(/not on the authorized/i);
    expect(payload.summary).toMatch(/configure-policy/i);
    expect(payload.summary).toContain("0xMaya"); // truncated address shown
  });

  it("kid-facing copy points to 'ask a parent' instead of configure-policy", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          walletAddress: "0xMayaExternalWallet0000000000000000000001",
        }),
      ],
    });
    const learner = await family.addMember(ROLES.LEARNER, {
      name: "Maya",
      childName: "Maya",
    });

    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
    ]);

    const result = await settleBalanceCore({}, learner.context);
    const text = asJson(result).summary;
    // Per Copy-reference.md §9.1: kid copy leads with "ask a parent"
    // and mentions configure-policy as the parent's action. Both must
    // be present.
    expect(text.toLowerCase()).toContain("ask a parent");
    expect(text).toMatch(/configure-policy/i);
    // The kid variant must NOT use the manager-facing table layout
    // (Copy-reference.md §9.2 uses "blocked by policy" header).
    expect(text).not.toMatch(/blocked by policy/i);
  });

  it("OWS-internal wallets (no walletAddress) are exempt from allowlist", async () => {
    transferSpy.mockResolvedValue({
      txHash: "0xabc",
      from: "treasury",
      to: "child-maya",
      amount: 500_000,
    });
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          // no walletAddress → OWS-managed internal wallet → exempt
        }),
      ],
    });

    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
    ]);

    const result = await settleBalanceCore({}, family.managerContext);
    expect(asJson(result).success).toBe(true);
    expect(transferSpy).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Partial failure (LS41-LS46)
// ===========================================================================

describe("LS41 — partial settlement: wallet succeeds, savings fails", () => {
  it("one destination settles, the other moves to failed; partial-success copy", async () => {
    transferSpy
      .mockResolvedValueOnce({ txHash: "0xabc", from: "treasury", to: "x", amount: 500_000 })
      .mockRejectedValueOnce(new Error("insufficient funds for gas"));

    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });

    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
      { childName: "Maya", destination: "savings-vault", amountUsdcMicros: 200_000, kind: "savings-deposit" },
    ]);

    const result = await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    const payload = asJson(result);
    expect(payload.settled).toBe(1);
    expect(payload.failed).toBe(1);

    const settled = await ledger.listSettled(family.familyId);
    const failed = await ledger.listFailed(family.familyId);
    expect(settled).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].failureReason).toBe("insufficient_gas");
    expect(failed[0].retryCount).toBe(1);
  });
});

describe("LS42 — failed entries retry on subsequent settle-balance calls", () => {
  it("a previously-failed entry is re-picked up and settles on the second call", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });

    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
    ]);

    // First call: fail
    transferSpy.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    expect((await ledger.listFailed(family.familyId)).length).toBe(1);

    // Second call: succeed (the failed entry should be re-picked up)
    transferSpy.mockResolvedValueOnce({ txHash: "0xdef", from: "treasury", to: "x", amount: 500_000 });
    await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    expect((await ledger.listSettled(family.familyId)).length).toBe(1);
    expect((await ledger.listFailed(family.familyId)).length).toBe(0);
  });
});

describe("LS44, LS46 — after 3 failures, entry is abandoned and not retried", () => {
  it("3 sequential failures transition the entry to abandoned status", async () => {
    transferSpy.mockRejectedValue(new Error("perma fail"));

    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
    ]);

    for (let i = 0; i < 3; i++) {
      await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    }

    const abandoned = await ledger.listAbandoned(family.familyId, "Maya");
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0].retryCount).toBe(3);

    // LS46: a 4th call must NOT re-pickup an abandoned entry
    transferSpy.mockClear();
    await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    expect(transferSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Sad-path defenses
// ===========================================================================

describe("settle-balance defenses", () => {
  it("returns clear error when childName does not exist", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const result = await settleBalanceCore(
      { childName: "Phantom" },
      family.managerContext,
    );
    const payload = asJson(result);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/No child named "Phantom"/i);
  });

  it("rejects when caller has no identity (null caller)", async () => {
    const result = await settleBalanceCore({}, null);
    const payload = asJson(result);
    expect(payload.success).toBe(false);
    expect(payload.toolName).toBe("settle-balance");
  });
});
