/**
 * Sprint 4.0.3 fail-forward — BUG-2 / LS-COV-1 supplemental coverage for
 * `src/tools/settle-balance.ts`.
 *
 * Two surfaces the LS21–LS50 suite leaves dark:
 *   1. `buildSettleBalanceResponse` copy variants (pure function) —
 *      nothing-to-settle, dry-run, allowlist-blocked kid/manager,
 *      partial settlement with abandon notes, hash/address truncation.
 *   2. Handler edge paths — learner-missing-childName, no-config,
 *      allowlisted external-wallet settle, token-mint failure, outer
 *      catch, the Sentry-present abandon path, and tool registration.
 *
 * New tests only. Mocks are file-local (vitest isolates module mocks per
 * test file); `getToken` returns undefined here so the lazy-mint path is
 * exercised, and `initSentry` is controllable per-test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ROLES } from "../src/constants.js";
import {
  settleBalanceCore,
  buildSettleBalanceResponse,
  registerSettleBalanceTool,
} from "../src/tools/settle-balance.js";
import { WalletDistributor } from "../src/wallet/distributor.js";
import { StateManager } from "../src/engine/state.js";
import { FilesystemLedger } from "../src/engine/ledger.js";
import { initSentry } from "../src/observability/sentry.js";
import { lazyMintTokenForLegacyFamily } from "../src/keys/family-api-tokens.js";
import { createTestFamily, makeChild } from "./helpers/family.js";
import type { CallerContext } from "../src/middleware/access-control.js";
import type { LedgerEntry } from "../src/schemas.js";
import { randomUUID } from "node:crypto";

const EXTERNAL_ADDR = "0x1111111111111111111111111111111111111111";

vi.mock("../src/keys/family-api-tokens.js", () => ({
  OWS_TOKEN_PREFIX: "ows_key_",
  FamilyApiTokenManager: class {
    getToken() {
      return undefined; // force the lazy-mint path (covers the falsy branch)
    }
  },
  lazyMintTokenForLegacyFamily: vi.fn(async () => "ows_key_" + "a".repeat(64)),
}));

vi.mock("../src/observability/sentry.js", () => ({
  initSentry: vi.fn(async () => null),
}));

function asJson(response: { content: Array<{ text: string }> }): any {
  return JSON.parse(response.content[0].text);
}

interface SeedPartial {
  childName: string;
  destination: LedgerEntry["destination"];
  amountUsdcMicros: number;
  kind: LedgerEntry["kind"];
  status?: LedgerEntry["status"];
  retryCount?: number;
}

async function seedLedger(
  ledger: FilesystemLedger,
  familyId: string,
  entries: SeedPartial[],
): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  for (const p of entries) {
    out.push(
      await ledger.append({
        id: randomUUID(),
        familyId,
        childName: p.childName,
        kind: p.kind,
        destination: p.destination,
        amountUsdcMicros: p.amountUsdcMicros,
        status: p.status ?? "pending",
        createdAt: new Date().toISOString(),
        sourceId: randomUUID(),
        retryCount: p.retryCount ?? 0,
      }),
    );
  }
  return out;
}

type LooseSpy = {
  mockResolvedValue: (v: unknown) => LooseSpy;
  mockRejectedValue: (e: unknown) => LooseSpy;
  mockRestore: () => void;
} & ReturnType<typeof vi.fn>;

let transferSpy: LooseSpy;

beforeEach(() => {
  transferSpy = vi.spyOn(
    WalletDistributor.prototype,
    "transferUSDC",
  ) as unknown as LooseSpy;
  (initSentry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (lazyMintTokenForLegacyFamily as unknown as ReturnType<typeof vi.fn>)
    .mockResolvedValue("ows_key_" + "a".repeat(64));
});

afterEach(() => {
  transferSpy.mockRestore();
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. buildSettleBalanceResponse — pure copy variants
// ===========================================================================

describe("buildSettleBalanceResponse copy variants", () => {
  const base = {
    caller: { role: ROLES.MANAGER, childName: undefined },
    childNameScope: "Maya" as string | undefined,
    dryRun: false,
    batchId: "batch_1" as string | null,
    preflightBlocked: [] as any[],
    totalsAfter: { totalPendingMicros: 0 },
  };

  it("renders the nothing-to-settle empty state", () => {
    const text = buildSettleBalanceResponse({ ...base, results: [] });
    expect(text).toMatch(/nothing to settle/i);
    expect(text.toLowerCase()).not.toContain("error");
  });

  it("renders the dry-run preview", () => {
    const text = buildSettleBalanceResponse({
      ...base,
      dryRun: true,
      results: [
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: undefined,
          totalMicros: 500_000,
          entryIds: ["a", "b"],
          status: "settled",
        },
      ],
    });
    expect(text).toMatch(/Settlement preview/i);
    expect(text).toContain("$0.50");
    expect(text).toMatch(/Run again/i);
  });

  it("renders the all-blocked response for a manager (table)", () => {
    const text = buildSettleBalanceResponse({
      ...base,
      results: [],
      preflightBlocked: [
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: EXTERNAL_ADDR,
          totalMicros: 100_000,
          entryIds: ["x"],
          status: "rejected-by-allowlist",
        },
      ],
    });
    expect(text).toMatch(/Settlement on hold/i);
    expect(text).toMatch(/configure-policy/i);
    expect(text).toContain(EXTERNAL_ADDR);
  });

  it("renders the all-blocked response for a kid (ask-a-parent)", () => {
    const text = buildSettleBalanceResponse({
      ...base,
      caller: { role: ROLES.LEARNER, childName: "Maya" },
      results: [],
      preflightBlocked: [
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: undefined,
          totalMicros: 100_000,
          entryIds: ["x"],
          status: "rejected-by-allowlist",
        },
      ],
    });
    expect(text).toMatch(/Ask a parent/i);
    expect(text).toMatch(/safe/i);
  });

  it("renders a full-success settlement with mixed receipt presence", () => {
    const text = buildSettleBalanceResponse({
      ...base,
      results: [
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: undefined,
          totalMicros: 800_000,
          entryIds: ["a"],
          status: "settled",
          txHash: "0xabcdef0123456789abcdef", // > 14 → truncated
        },
        {
          childName: "Maya",
          destination: "savings-vault",
          externalAddress: undefined,
          totalMicros: 200_000,
          entryIds: ["b"],
          status: "settled",
          txHash: "0xshort", // <= 14 → not truncated
        },
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: undefined,
          totalMicros: 50_000,
          entryIds: ["c"],
          status: "settled",
          // no txHash → receipt clause omitted
        },
      ],
    });
    expect(text).toMatch(/Settled \$1\.05 for Maya/);
    expect(text).toContain("Savings vault");
    expect(text).toContain("0xabcd...cdef");
    expect(text).toContain("0xshort");
    expect(text).toMatch(/All caught up/i);
  });

  it("renders a partial settlement with failed, abandoned, and blocked legs", () => {
    const text = buildSettleBalanceResponse({
      ...base,
      childNameScope: undefined, // family-wide → "the family"
      results: [
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: undefined,
          totalMicros: 300_000,
          entryIds: ["a"],
          status: "settled",
          txHash: "0xfeedfacefeedfacefeed",
        },
        {
          childName: "Maya",
          destination: "savings-vault",
          externalAddress: undefined,
          totalMicros: 100_000,
          entryIds: ["b"],
          status: "failed",
          failureReason: "rpc_timeout",
        },
        {
          childName: "Diego",
          destination: "child-wallet",
          externalAddress: undefined,
          totalMicros: 70_000,
          entryIds: ["c"],
          status: "failed",
          // no failureReason → "unknown"; abandoned note present
          abandonedEntryIds: ["c"],
        },
      ],
      preflightBlocked: [
        {
          childName: "Noor",
          destination: "child-wallet",
          externalAddress: EXTERNAL_ADDR, // > 12 → truncateAddr
          totalMicros: 40_000,
          entryIds: ["d"],
          status: "rejected-by-allowlist",
        },
      ],
    });
    expect(text).toMatch(/Partial settlement for the family/);
    expect(text).toContain("rpc_timeout");
    expect(text).toContain("unknown");
    expect(text).toMatch(/abandoned after 3 retries/);
    expect(text).toMatch(/not on the authorized destinations/);
    expect(text).toContain("0x1111...1111"); // truncated external addr
    expect(text).toMatch(/configure-policy/);
  });
});

// ===========================================================================
// 2. Tool registration
// ===========================================================================

describe("registerSettleBalanceTool", () => {
  it("registers the settle-balance tool on the server", () => {
    const tool = vi.fn();
    registerSettleBalanceTool({ tool } as any);
    expect(tool).toHaveBeenCalledTimes(1);
    expect(tool.mock.calls[0][0]).toBe("settle-balance");
  });
});

// ===========================================================================
// 3. Handler edge paths
// ===========================================================================

describe("settle-balance handler edge paths", () => {
  it("returns a no-identity response when caller is null", async () => {
    const result = await settleBalanceCore({}, null);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("rejects a learner whose identity is missing childName", async () => {
    const caller: CallerContext = {
      role: ROLES.LEARNER,
      memberId: "m1",
      familyId: "f1",
      childName: undefined,
    };
    const result = await settleBalanceCore({}, caller);
    expect(asJson(result).error).toMatch(/missing childName/i);
  });

  it("returns a friendly error when the family has no config", async () => {
    const caller: CallerContext = {
      role: ROLES.MANAGER,
      memberId: "m1",
      familyId: "does-not-exist-" + randomUUID(),
    };
    const result = await settleBalanceCore({}, caller);
    expect(asJson(result).error).toMatch(/No family configured/i);
  });

  it("settles an allowlisted external child-wallet plus a savings leg", async () => {
    transferSpy.mockResolvedValue({
      txHash: "0xok",
      from: "treasury",
      to: "x",
      amount: 0,
    });
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          savingsPercent: 20,
          walletAddress: EXTERNAL_ADDR,
        }),
      ],
    });
    // Authorize the external destination so the allowlist check passes.
    const cfg = await family.state.loadFamilyConfig(family.familyId);
    cfg!.authorizedDestinations = [EXTERNAL_ADDR];
    await family.state.saveFamilyConfig(family.familyId, cfg!);

    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 800_000, kind: "achievement-credit" },
      { childName: "Maya", destination: "savings-vault", amountUsdcMicros: 200_000, kind: "savings-deposit" },
    ]);

    const result = await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    const payload = asJson(result);
    expect(payload.success).toBe(true);
    expect(payload.settled).toBe(2);
    expect(transferSpy).toHaveBeenCalledTimes(2);

    // The savings leg created a SavingsEntry.
    const savings = await family.state.loadSavingsEntries(family.familyId);
    expect(savings.some((e) => e.childName === "Maya")).toBe(true);
  });

  it("returns a wallet-not-initialized error when token mint fails", async () => {
    (lazyMintTokenForLegacyFamily as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("no encryption key for family"));
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          savingsPercent: 0,
        }),
      ],
    });
    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
    ]);

    const result = await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    const payload = asJson(result);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/not initialized/i);
    expect(transferSpy).not.toHaveBeenCalled();
  });

  it("catches an unexpected error from the state layer", async () => {
    const spy = vi
      .spyOn(StateManager.prototype, "loadFamilyConfig")
      .mockRejectedValue(new Error("disk exploded"));
    const caller: CallerContext = {
      role: ROLES.MANAGER,
      memberId: "m1",
      familyId: "f1",
    };
    const result = await settleBalanceCore({}, caller);
    const payload = asJson(result);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/disk exploded/);
    spy.mockRestore();
  });

  it("fires a Sentry event when an entry is abandoned after 3 retries", async () => {
    const captureException = vi.fn();
    (initSentry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ captureException });
    transferSpy.mockRejectedValue(new Error("perma fail"));

    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          savingsPercent: 0,
        }),
      ],
    });
    const ledger = new FilesystemLedger();
    // retryCount 2 → this failed attempt makes it 3 → abandoned.
    await seedLedger(ledger, family.familyId, [
      {
        childName: "Maya",
        destination: "child-wallet",
        amountUsdcMicros: 500_000,
        kind: "achievement-credit",
        status: "failed",
        retryCount: 2,
      },
    ]);

    await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    expect(captureException).toHaveBeenCalledTimes(1);
    const abandoned = await ledger.listAbandoned(family.familyId, "Maya");
    expect(abandoned).toHaveLength(1);
  });

  it("does not break settlement when the Sentry capture itself throws", async () => {
    (initSentry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      captureException: () => {
        throw new Error("sentry transport down");
      },
    });
    transferSpy.mockRejectedValue(new Error("perma fail"));

    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          savingsPercent: 0,
        }),
      ],
    });
    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      {
        childName: "Maya",
        destination: "child-wallet",
        amountUsdcMicros: 500_000,
        kind: "achievement-credit",
        status: "failed",
        retryCount: 2,
      },
    ]);

    // Must not throw despite the Sentry failure; entry still abandoned.
    await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    const abandoned = await ledger.listAbandoned(family.familyId, "Maya");
    expect(abandoned).toHaveLength(1);
  });
});

// ===========================================================================
// 4. Remaining copy + handler branch variants
// ===========================================================================

describe("buildSettleBalanceResponse remaining branches", () => {
  const base = {
    caller: { role: ROLES.MANAGER, childName: undefined as string | undefined },
    childNameScope: "Maya" as string | undefined,
    dryRun: false,
    batchId: "b" as string | null,
    totalsAfter: { totalPendingMicros: 0 },
  };

  it("partial: settled savings leg without receipt, blocked internal + short-addr legs", () => {
    const text = buildSettleBalanceResponse({
      ...base,
      results: [
        {
          childName: "Maya",
          destination: "savings-vault",
          externalAddress: undefined,
          totalMicros: 200_000,
          entryIds: ["s"],
          status: "settled", // no txHash → receipt clause omitted (196)
        },
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: undefined,
          totalMicros: 50_000,
          entryIds: ["f"],
          status: "failed",
          failureReason: "rpc_timeout",
        },
      ],
      preflightBlocked: [
        {
          childName: "Maya",
          destination: "savings-vault", // 212 savings ternary; 215 no-addr false
          externalAddress: undefined,
          totalMicros: 10_000,
          entryIds: ["b1"],
          status: "rejected-by-allowlist",
        },
        {
          childName: "Noor",
          destination: "child-wallet",
          externalAddress: "0xabc", // <= 12 → truncateAddr returns as-is (301)
          totalMicros: 20_000,
          entryIds: ["b2"],
          status: "rejected-by-allowlist",
        },
      ],
    });
    expect(text).toMatch(/Partial settlement/);
    expect(text).toContain("Savings vault");
    expect(text).toContain("0xabc");
  });

  it("partial as a kid renders the ask-a-parent blocked guidance", () => {
    const text = buildSettleBalanceResponse({
      ...base,
      caller: { role: ROLES.LEARNER, childName: "Maya" },
      results: [
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: undefined,
          totalMicros: 50_000,
          entryIds: ["f"],
          status: "failed",
          failureReason: "rpc_timeout",
        },
      ],
      preflightBlocked: [
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: undefined,
          totalMicros: 10_000,
          entryIds: ["b1"],
          status: "rejected-by-allowlist",
        },
      ],
    });
    expect(text).toMatch(/ask a parent/i);
  });

  it("dry-run family-wide preview with a savings leg", () => {
    const text = buildSettleBalanceResponse({
      ...base,
      childNameScope: undefined, // "the family" (235 right)
      dryRun: true,
      results: [
        {
          childName: "Maya",
          destination: "savings-vault", // "savings vault" (242)
          externalAddress: undefined,
          totalMicros: 200_000,
          entryIds: ["s"],
          status: "settled",
        },
      ],
      preflightBlocked: [],
    });
    expect(text).toMatch(/the family/);
    expect(text).toContain("savings vault");
  });

  it("all-blocked manager table renders (internal) for OWS wallets", () => {
    const text = buildSettleBalanceResponse({
      ...base,
      results: [],
      preflightBlocked: [
        {
          childName: "Maya",
          destination: "child-wallet",
          externalAddress: undefined, // "(internal)" (268 right)
          totalMicros: 10_000,
          entryIds: ["b1"],
          status: "rejected-by-allowlist",
        },
      ],
    });
    expect(text).toContain("(internal)");
  });
});

describe("settle-balance handler remaining branches", () => {
  it("skips orphan ledger entries whose child is not in the family config", async () => {
    transferSpy.mockResolvedValue({ txHash: "0xok", from: "t", to: "x", amount: 0 });
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          savingsPercent: 0,
        }),
      ],
    });
    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
      { childName: "Ghost", destination: "child-wallet", amountUsdcMicros: 999_000, kind: "achievement-credit" },
    ]);
    // Family-wide settle: Ghost has no config child → skipped in grouping.
    const result = await settleBalanceCore({}, family.managerContext);
    expect(asJson(result).settled).toBe(1);
    expect(transferSpy).toHaveBeenCalledTimes(1);
  });

  it("reports (none) available when the family has no children", async () => {
    const family = await createTestFamily({ children: [] });
    const result = await settleBalanceCore({ childName: "Ghost" }, family.managerContext);
    expect(asJson(result).error).toMatch(/\(none\)/);
  });

  it("handles a non-Error thrown from the token-mint path", async () => {
    (lazyMintTokenForLegacyFamily as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValue("string failure, not an Error");
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          savingsPercent: 0,
        }),
      ],
    });
    const ledger = new FilesystemLedger();
    await seedLedger(ledger, family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000, kind: "achievement-credit" },
    ]);
    const result = await settleBalanceCore({ childName: "Maya" }, family.managerContext);
    expect(asJson(result).success).toBe(false);
    expect(asJson(result).error).toMatch(/not initialized/i);
  });

  it("handles a non-Error thrown from the state layer (outer catch)", async () => {
    const spy = vi
      .spyOn(StateManager.prototype, "loadFamilyConfig")
      .mockRejectedValue("not an error object");
    const result = await settleBalanceCore(
      {},
      { role: ROLES.MANAGER, memberId: "m1", familyId: "f1" },
    );
    const payload = asJson(result);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/Unknown error/);
    spy.mockRestore();
  });
});
