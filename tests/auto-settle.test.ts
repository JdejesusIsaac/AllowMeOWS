/**
 * Sprint 4.0.3 W7 — auto-settle weekly job tests (LS51-LS55).
 *
 * Each test creates an isolated family in the shared data dir (each
 * with a fresh UUID, so multi-test runs do not collide). The
 * underlying `runAutoSettle` reads StateManager + FilesystemLedger
 * which both root at the project data dir — same as production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runAutoSettle,
  AUTO_SETTLE_CRON_EXPRESSION,
} from "../src/jobs/auto-settle.js";
import { WalletDistributor } from "../src/wallet/distributor.js";
import { FilesystemLedger } from "../src/engine/ledger.js";
import { createTestFamily, makeChild } from "./helpers/family.js";
import type { LedgerEntry } from "../src/schemas.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Mirror the family-api-tokens mock from settle-balance.test.ts so
// we don't need a real OWS vault to run the integration path.
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

type LooseSpy = ReturnType<typeof vi.fn> & {
  mockResolvedValue: (v: unknown) => LooseSpy;
  mockResolvedValueOnce: (v: unknown) => LooseSpy;
  mockRejectedValue: (e: unknown) => LooseSpy;
  mockImplementation: (fn: (...args: never[]) => unknown) => LooseSpy;
  mockRestore: () => void;
};

let transferSpy: LooseSpy;
const ORIG_DISABLED = process.env.ALLOWME_AUTO_SETTLE_DISABLED;

beforeEach(() => {
  transferSpy = vi.spyOn(
    WalletDistributor.prototype,
    "transferUSDC",
  ) as unknown as LooseSpy;
  transferSpy.mockResolvedValue({
    txHash: "0xabc",
    from: "treasury",
    to: "x",
    amount: 0,
  });
});

afterEach(() => {
  transferSpy.mockRestore();
  if (ORIG_DISABLED === undefined) {
    delete process.env.ALLOWME_AUTO_SETTLE_DISABLED;
  } else {
    process.env.ALLOWME_AUTO_SETTLE_DISABLED = ORIG_DISABLED;
  }
});

async function seedPendingEntry(
  ledger: FilesystemLedger,
  familyId: string,
  childName: string,
  micros: number,
): Promise<LedgerEntry> {
  return ledger.append({
    id: randomUUID(),
    familyId,
    childName,
    kind: "achievement-credit",
    destination: "child-wallet",
    amountUsdcMicros: micros,
    status: "pending",
    createdAt: new Date().toISOString(),
    sourceId: randomUUID(),
    retryCount: 0,
  });
}

describe("LS51 — auto-settle skips families with autoSettleWeekly=false", () => {
  it("opted-in family settles; opted-out family is left alone", async () => {
    const optIn = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const optOut = await createTestFamily({
      children: [
        makeChild("Diego", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });

    // Flip the in-family to opted-in. The out-family stays default-false (D4).
    const inConfig = await optIn.state.loadFamilyConfig(optIn.familyId);
    inConfig!.autoSettleWeekly = true;
    await optIn.state.saveFamilyConfig(optIn.familyId, inConfig!);

    const ledger = new FilesystemLedger();
    await seedPendingEntry(ledger, optIn.familyId, "Maya", 500_000);
    await seedPendingEntry(ledger, optOut.familyId, "Diego", 300_000);

    const summary = await runAutoSettle();

    // Find the two results
    const inResult = summary.perFamily.find((r) => r.familyId === optIn.familyId);
    const outResult = summary.perFamily.find((r) => r.familyId === optOut.familyId);
    expect(inResult?.status).toBe("opted-in-settled");
    expect(outResult?.status).toBe("opted-out");

    expect((await ledger.listSettled(optIn.familyId)).length).toBe(1);
    expect((await ledger.listSettled(optOut.familyId)).length).toBe(0);

    // The opt-out family's pending entries are preserved
    expect((await ledger.listPending(optOut.familyId)).length).toBe(1);
  });
});

describe("LS52 — ALLOWME_AUTO_SETTLE_DISABLED=true skips all families", () => {
  it("kill switch makes the job a no-op even for opted-in families", async () => {
    process.env.ALLOWME_AUTO_SETTLE_DISABLED = "true";

    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const config = await family.state.loadFamilyConfig(family.familyId);
    config!.autoSettleWeekly = true;
    await family.state.saveFamilyConfig(family.familyId, config!);

    const ledger = new FilesystemLedger();
    await seedPendingEntry(ledger, family.familyId, "Maya", 500_000);

    const summary = await runAutoSettle();
    expect(summary.ran).toBe(false);
    expect(summary.familiesProcessed).toBe(0);

    expect((await ledger.listPending(family.familyId)).length).toBe(1);
    expect((await ledger.listSettled(family.familyId)).length).toBe(0);
    expect(transferSpy).not.toHaveBeenCalled();
  });
});

describe("LS53 — auto-settle schedule is Sunday 00:00 UTC", () => {
  it("exported cron expression matches plan D6", () => {
    expect(AUTO_SETTLE_CRON_EXPRESSION).toBe("0 0 * * 0");
  });

  it("railway.toml cron job uses the same schedule", async () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const railwayPath = join(__dirname, "..", "railway.toml");
    const raw = await readFile(railwayPath, "utf-8");
    expect(raw).toMatch(/schedule\s*=\s*"0 0 \* \* 0"/);
    expect(raw).toMatch(/auto-settle\.ts/);
  });
});

describe("LS54 — failure in one family does not stop the run for others", () => {
  it("a thrown error in family A still lets family B settle", async () => {
    const broken = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 5,
          categories: [{ name: "x", pct: 100 }],
          walletAddress: "0xBrokenWallet0000000000000000000000000001",
        }),
      ],
    });
    const ok = await createTestFamily({
      children: [
        makeChild("Diego", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });

    for (const f of [broken, ok]) {
      const c = await f.state.loadFamilyConfig(f.familyId);
      c!.autoSettleWeekly = true;
      await f.state.saveFamilyConfig(f.familyId, c!);
    }

    const ledger = new FilesystemLedger();
    await seedPendingEntry(ledger, broken.familyId, "Maya", 500_000);
    await seedPendingEntry(ledger, ok.familyId, "Diego", 300_000);

    // Broken family's wallet is external + not in authorizedDestinations → allowlist rejects (no broadcast).
    // OK family has no external wallet → OWS-internal → bypasses allowlist + settles.
    const summary = await runAutoSettle();

    const brokenRes = summary.perFamily.find((r) => r.familyId === broken.familyId);
    const okRes = summary.perFamily.find((r) => r.familyId === ok.familyId);
    expect(okRes?.status).toBe("opted-in-settled");
    expect(brokenRes?.status).toBe("opted-in-blocked"); // not a thrown error, but a clear blocked status

    expect((await ledger.listSettled(ok.familyId)).length).toBe(1);
    // Broken family's pending stays pending
    expect((await ledger.listPending(broken.familyId)).length).toBe(1);
  });
});

describe("LS55 — auto-settle uses manager-equivalent context", () => {
  it("the resulting audit entry carries actor='system:auto-settle'", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const config = await family.state.loadFamilyConfig(family.familyId);
    config!.autoSettleWeekly = true;
    await family.state.saveFamilyConfig(family.familyId, config!);

    const ledger = new FilesystemLedger();
    await seedPendingEntry(ledger, family.familyId, "Maya", 500_000);

    await runAutoSettle();

    const audit = await family.state.loadAuditLog(family.familyId);
    const settleEntries = audit.filter(
      (e) => (e.details as { tool?: string })?.tool === "settle-balance",
    );
    expect(settleEntries.length).toBeGreaterThan(0);
    expect(settleEntries[0].actor).toBe("system:auto-settle");
  });
});

describe("auto-settle empty cases", () => {
  it("opted-in family with no pending entries reports 'no-pending'", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", { weeklyBudgetUsd: 5, categories: [{ name: "x", pct: 100 }] }),
      ],
    });
    const config = await family.state.loadFamilyConfig(family.familyId);
    config!.autoSettleWeekly = true;
    await family.state.saveFamilyConfig(family.familyId, config!);

    const summary = await runAutoSettle();
    const res = summary.perFamily.find((r) => r.familyId === family.familyId);
    expect(res?.status).toBe("no-pending");
  });
});
