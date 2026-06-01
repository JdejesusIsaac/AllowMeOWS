/**
 * Sprint 4.0.3 W10 — UX copy tests (LS61–LS65).
 *
 * Verifies the settlement-aware rich cards for check-progress and
 * check-savings render the earned / in-wallet / pending-settlement model
 * from Copy-reference.md §3–§6, and that the on-chain `balanceOf` lookup
 * is surfaced. The RPC is mocked so these stay hermetic.
 *
 * LS65 (nothing-to-settle copy) lives in settle-balance.test.ts; here we
 * cover the read-side cards. We re-assert the empty-state friendliness on
 * the check-progress side to keep the §0/§1 tone guarantees local.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock only the RPC; keep resolveChildWalletAddress real (external
// walletAddress path needs no OWS vault).
vi.mock("../src/utils/usdc-balance.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, fetchUsdcBalanceMicros: vi.fn() };
});

import { checkProgressHandler } from "../src/tools/check-progress.js";
import { checkSavingsHandler } from "../src/tools/check-savings.js";
import { fetchUsdcBalanceMicros } from "../src/utils/usdc-balance.js";
import { FilesystemLedger } from "../src/engine/ledger.js";
import { createTestFamily, makeChild } from "./helpers/family.js";
import { ROLES } from "../src/constants.js";
import type { AchievementRecord, LedgerEntryInput, SavingsEntryInput } from "../src/schemas.js";
import { randomUUID } from "node:crypto";

const EXTERNAL_WALLET = "0x1111111111111111111111111111111111111111";
const ORIG_MODE = process.env.ALLOWME_LEDGER_MODE;

const balanceMock = fetchUsdcBalanceMicros as unknown as {
  mockResolvedValue: (v: number | null) => void;
  mockReset: () => void;
};

beforeEach(() => {
  process.env.ALLOWME_LEDGER_MODE = "ledger-only";
  balanceMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIG_MODE === undefined) delete process.env.ALLOWME_LEDGER_MODE;
  else process.env.ALLOWME_LEDGER_MODE = ORIG_MODE;
});

function asJson(r: { content: Array<{ text: string }> }): any {
  return JSON.parse(r.content[0].text);
}

async function seedLedger(familyId: string, entries: Array<Partial<LedgerEntryInput> & {
  childName: string;
  destination: "child-wallet" | "savings-vault";
  amountUsdcMicros: number;
}>): Promise<void> {
  const ledger = new FilesystemLedger();
  for (const e of entries) {
    await ledger.append({
      id: randomUUID(),
      familyId,
      childName: e.childName,
      kind: e.kind ?? (e.destination === "savings-vault" ? "savings-deposit" : "achievement-credit"),
      destination: e.destination,
      amountUsdcMicros: e.amountUsdcMicros,
      status: e.status ?? "pending",
      createdAt: new Date().toISOString(),
      sourceId: e.sourceId ?? randomUUID(),
      retryCount: 0,
    });
  }
}

// ---- LS61 — kid-facing check-progress: earned + wallet + pending ----

describe("LS61 — kid-facing check-progress copy", () => {
  it("shows earned this week, in-wallet balance, and pending settlement", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 15,
          categories: [{ name: "reading", pct: 100 }],
          walletAddress: EXTERNAL_WALLET,
        }),
      ],
    });
    const learner = await family.addMember(ROLES.LEARNER, { childName: "Maya" });

    await seedLedger(family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 730_000 },
    ]);
    balanceMock.mockResolvedValue(3_500_000);

    const result = await checkProgressHandler({}, learner.context);
    const text = asJson(result).summary as string;

    expect(text).toMatch(/Earned this week/i);
    expect(text).toMatch(/In your wallet:.*\$3\.50/);
    expect(text).toMatch(/Pending settlement:.*\$0\.73/);
    expect(text).toMatch(/settle-balance/);
  });
});

// ---- LS62 — manager-facing check-progress: auto-settle option ----

describe("LS62 — manager-facing check-progress copy", () => {
  it("mentions the auto-settle option when pending balance exists", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 15,
          categories: [{ name: "reading", pct: 100 }],
          walletAddress: EXTERNAL_WALLET,
        }),
      ],
    });
    await seedLedger(family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000 },
    ]);
    balanceMock.mockResolvedValue(1_000_000);

    const result = await checkProgressHandler({ childName: "Maya" }, family.managerContext);
    const text = asJson(result).summary as string;

    expect(text).toMatch(/auto-settle/i);
    expect(text).toMatch(/settle-balance/);
  });
});

// ---- LS63 — auto-settle enabled shows next-Sunday countdown ----

describe("LS63 — check-progress countdown with auto-settle on", () => {
  it("shows the auto-settles Sunday countdown when autoSettleWeekly=true", async () => {
    // Fix only Date to a Wednesday so the countdown is deterministic while
    // leaving timers/microtasks real for filesystem IO.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-07T12:00:00Z")); // Wednesday

    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 15,
          categories: [{ name: "reading", pct: 100 }],
          walletAddress: EXTERNAL_WALLET,
        }),
      ],
    });
    // Enable auto-settle for the family.
    const config = await family.state.loadFamilyConfig(family.familyId);
    config!.autoSettleWeekly = true;
    await family.state.saveFamilyConfig(family.familyId, config!);

    const learner = await family.addMember(ROLES.LEARNER, { childName: "Maya" });
    await seedLedger(family.familyId, [
      { childName: "Maya", destination: "child-wallet", amountUsdcMicros: 500_000 },
    ]);
    balanceMock.mockResolvedValue(1_000_000);

    const result = await checkProgressHandler({}, learner.context);
    const text = asJson(result).summary as string;

    expect(text).toMatch(/auto-settles Sunday/i);
    // Auto-settle copy drops the manual "run settle-balance" push.
    expect(text).not.toMatch(/run \*\*settle-balance\*\* to move it/i);
  });
});

// ---- LS64 — check-savings locked / released / pending breakdown ----

describe("LS64 — check-savings copy", () => {
  it("renders locked, released, and pending-settlement rows", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 15,
          categories: [{ name: "reading", pct: 100 }],
          walletAddress: EXTERNAL_WALLET,
        }),
      ],
    });

    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

    const lockedEntry: SavingsEntryInput = {
      id: randomUUID(),
      childName: "Maya",
      amount: 1_500_000, // $1.50
      depositedAt: now.toISOString(),
      lockUntil: future,
    };
    const releasedEntry: SavingsEntryInput = {
      id: randomUUID(),
      childName: "Maya",
      amount: 2_000_000, // $2.00
      depositedAt: past,
      lockUntil: past,
      released: true,
    };
    await family.state.addSavingsEntry(family.familyId, lockedEntry);
    await family.state.addSavingsEntry(family.familyId, releasedEntry);

    await seedLedger(family.familyId, [
      { childName: "Maya", destination: "savings-vault", amountUsdcMicros: 300_000, kind: "savings-deposit" }, // $0.30
    ]);

    const learner = await family.addMember(ROLES.LEARNER, { childName: "Maya" });
    const result = await checkSavingsHandler({}, learner.context);
    const text = asJson(result).summary;

    expect(text).toMatch(/Locked.*\$1\.50/);
    expect(text).toMatch(/Released.*\$2\.00/);
    expect(text).toMatch(/Pending settlement:.*\$0\.30/);
  });
});

// ---- LS65 — read-side empty-state copy is friendly, not error-shaped ----

describe("LS65 — friendly empty-state copy", () => {
  it("check-progress with no pending is encouraging, not alarming", async () => {
    const family = await createTestFamily({
      children: [
        makeChild("Maya", {
          weeklyBudgetUsd: 15,
          categories: [{ name: "reading", pct: 100 }],
          walletAddress: EXTERNAL_WALLET,
        }),
      ],
    });
    const learner = await family.addMember(ROLES.LEARNER, { childName: "Maya" });
    balanceMock.mockResolvedValue(0);

    const result = await checkProgressHandler({}, learner.context);
    const text = asJson(result).summary as string;

    expect(text).not.toMatch(/error|fail|problem/i);
  });
});
