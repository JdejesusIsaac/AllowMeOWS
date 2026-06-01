/**
 * Sprint 4.0.3 W1 — Ledger module unit tests (LS1–LS10).
 *
 * Pure-module surface: schema validation, split arithmetic,
 * FilesystemLedger CRUD round-trips, durability across instances,
 * failure classifier. No tools, no RBAC, no on-chain.
 *
 * Each test uses an isolated tmp dir so concurrent runs don't collide.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FilesystemLedger,
  splitAchievement,
  buildLedgerEntriesForAchievement,
  classifyFailure,
} from "../src/engine/ledger.js";
import { LedgerEntrySchema, type AchievementRecord } from "../src/schemas.js";

function makeAchievement(overrides: Partial<AchievementRecord> = {}): AchievementRecord {
  return {
    id: randomUUID(),
    childName: "Maya",
    category: "reading",
    description: "Read 30 minutes",
    score: 100,
    amount: 1_000_000,
    source: "manual",
    verifiedBy: "manager-1",
    verifiedAt: new Date().toISOString(),
    distributed: false,
    ...overrides,
  };
}

let tmpRoot: string;
let ledger: FilesystemLedger;
const FAMILY = "fam_abc";

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "ledger-test-"));
  ledger = new FilesystemLedger(tmpRoot);
});

describe("LS1 — LedgerEntrySchema validation", () => {
  it("rejects an empty object", () => {
    expect(() => LedgerEntrySchema.parse({})).toThrow();
  });

  it("accepts a minimal valid entry (retryCount defaulted)", () => {
    const parsed = LedgerEntrySchema.parse({
      id: randomUUID(),
      familyId: FAMILY,
      childName: "Maya",
      kind: "achievement-credit",
      destination: "child-wallet",
      amountUsdcMicros: 100,
      status: "pending",
      createdAt: new Date().toISOString(),
      sourceId: "src1",
    });
    expect(parsed.retryCount).toBe(0);
  });

  it("rejects negative amounts", () => {
    expect(() =>
      LedgerEntrySchema.parse({
        id: randomUUID(),
        familyId: FAMILY,
        childName: "Maya",
        kind: "achievement-credit",
        destination: "child-wallet",
        amountUsdcMicros: -1,
        status: "pending",
        createdAt: new Date().toISOString(),
        sourceId: "src1",
      }),
    ).toThrow();
  });
});

describe("LS2 — splitAchievement preserves total under floor rounding", () => {
  it("80/20 split with floor on savings: 1_000_001 → 800_001 + 200_000", () => {
    const { childMicros, savingsMicros } = splitAchievement(1_000_001, 20);
    expect(savingsMicros).toBe(200_000);
    expect(childMicros).toBe(800_001);
    expect(childMicros + savingsMicros).toBe(1_000_001);
  });

  it("round-trip exact at clean numbers", () => {
    const { childMicros, savingsMicros } = splitAchievement(1_000_000, 20);
    expect(childMicros).toBe(800_000);
    expect(savingsMicros).toBe(200_000);
  });
});

describe("LS3 — splitAchievement 0% savings = all to child", () => {
  it("returns child=total, savings=0", () => {
    const { childMicros, savingsMicros } = splitAchievement(500_000, 0);
    expect(childMicros).toBe(500_000);
    expect(savingsMicros).toBe(0);
  });
});

describe("LS4 — splitAchievement 100% savings = all to savings", () => {
  it("returns child=0, savings=total", () => {
    const { childMicros, savingsMicros } = splitAchievement(500_000, 100);
    expect(childMicros).toBe(0);
    expect(savingsMicros).toBe(500_000);
  });

  it("rejects savingsPercent out of range", () => {
    expect(() => splitAchievement(1_000, 101)).toThrow();
    expect(() => splitAchievement(1_000, -1)).toThrow();
  });

  it("rejects negative totals", () => {
    expect(() => splitAchievement(-1, 20)).toThrow();
  });
});

describe("LS5 — buildLedgerEntriesForAchievement produces 2 entries on non-zero split", () => {
  it("achievement($1) at 20% → wallet $0.80 + savings $0.20", () => {
    const ach = makeAchievement({ amount: 1_000_000 });
    const entries = buildLedgerEntriesForAchievement(ach, 20, FAMILY);

    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("achievement-credit");
    expect(entries[0].destination).toBe("child-wallet");
    expect(entries[0].amountUsdcMicros).toBe(800_000);
    expect(entries[1].kind).toBe("savings-deposit");
    expect(entries[1].destination).toBe("savings-vault");
    expect(entries[1].amountUsdcMicros).toBe(200_000);

    // Both share the same sourceId (the achievement id)
    expect(entries[0].sourceId).toBe(ach.id);
    expect(entries[1].sourceId).toBe(ach.id);

    // Both inherit the family + child
    expect(entries[0].familyId).toBe(FAMILY);
    expect(entries[1].childName).toBe(ach.childName);
  });
});

describe("LS6 — buildLedgerEntriesForAchievement returns 1 entry when one side is zero", () => {
  it("100% savings → one savings-only entry", () => {
    const ach = makeAchievement({ amount: 500_000 });
    const entries = buildLedgerEntriesForAchievement(ach, 100, FAMILY);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("savings-deposit");
    expect(entries[0].amountUsdcMicros).toBe(500_000);
  });

  it("0% savings → one wallet-only entry", () => {
    const ach = makeAchievement({ amount: 500_000 });
    const entries = buildLedgerEntriesForAchievement(ach, 0, FAMILY);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("achievement-credit");
    expect(entries[0].destination).toBe("child-wallet");
  });

  it("zero-amount achievement → zero entries", () => {
    const ach = makeAchievement({ amount: 0 });
    const entries = buildLedgerEntriesForAchievement(ach, 20, FAMILY);
    expect(entries).toHaveLength(0);
  });
});

describe("LS7 — FilesystemLedger.append → listPending round-trip", () => {
  it("appended pending entry appears in listPending", async () => {
    const ach = makeAchievement();
    const entries = buildLedgerEntriesForAchievement(ach, 20, FAMILY);
    for (const e of entries) {
      await ledger.append(e);
    }

    const pending = await ledger.listPending(FAMILY, "Maya");
    expect(pending).toHaveLength(2);
    expect(pending.every((e) => e.status === "pending")).toBe(true);
  });

  it("childName filter excludes other siblings", async () => {
    const mayaAch = makeAchievement({ childName: "Maya" });
    const diegoAch = makeAchievement({ childName: "Diego" });
    for (const e of buildLedgerEntriesForAchievement(mayaAch, 20, FAMILY)) {
      await ledger.append(e);
    }
    for (const e of buildLedgerEntriesForAchievement(diegoAch, 20, FAMILY)) {
      await ledger.append(e);
    }

    const mayaPending = await ledger.listPending(FAMILY, "Maya");
    expect(mayaPending).toHaveLength(2);
    expect(mayaPending.every((e) => e.childName === "Maya")).toBe(true);
  });
});

describe("LS8 — markSettled updates status, txHash, settledAt, batchId", () => {
  it("populates all settlement fields", async () => {
    const ach = makeAchievement({ amount: 500_000 });
    const entries = buildLedgerEntriesForAchievement(ach, 0, FAMILY);
    const appended = await ledger.append(entries[0]);

    await ledger.markSettled(FAMILY, [appended.id], "0xabc", "batch_1");

    const all = await ledger.listAll(FAMILY);
    const found = all.find((e) => e.id === appended.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("settled");
    expect(found!.txHash).toBe("0xabc");
    expect(found!.settlementBatchId).toBe("batch_1");
    expect(found!.settledAt).toBeTruthy();
  });

  it("only mutates ids in the supplied list", async () => {
    const ach1 = makeAchievement({ amount: 500_000 });
    const ach2 = makeAchievement({ amount: 300_000 });
    const e1 = await ledger.append(buildLedgerEntriesForAchievement(ach1, 0, FAMILY)[0]);
    const e2 = await ledger.append(buildLedgerEntriesForAchievement(ach2, 0, FAMILY)[0]);

    await ledger.markSettled(FAMILY, [e1.id], "0xabc", "batch_1");

    const all = await ledger.listAll(FAMILY);
    expect(all.find((e) => e.id === e1.id)!.status).toBe("settled");
    expect(all.find((e) => e.id === e2.id)!.status).toBe("pending");
  });
});

describe("LS9 — findBySourceId enables idempotent dedup", () => {
  it("returns both entries for the same achievement source", async () => {
    const ach = makeAchievement();
    const entries = buildLedgerEntriesForAchievement(ach, 20, FAMILY);
    for (const e of entries) {
      await ledger.append(e);
    }

    const found = await ledger.findBySourceId(FAMILY, ach.id);
    expect(found).toHaveLength(2);
    expect(found.every((e) => e.sourceId === ach.id)).toBe(true);
  });

  it("returns empty for unknown sourceId", async () => {
    const found = await ledger.findBySourceId(FAMILY, "nonexistent");
    expect(found).toHaveLength(0);
  });
});

describe("LS10 — JSONL persistence survives restart", () => {
  it("a fresh FilesystemLedger instance reads entries from disk", async () => {
    const ach = makeAchievement();
    const entry = buildLedgerEntriesForAchievement(ach, 0, FAMILY)[0];
    await ledger.append(entry);

    // Simulate restart: a new instance pointing at the same root dir
    const ledger2 = new FilesystemLedger(tmpRoot);
    const found = await ledger2.listPending(FAMILY);
    expect(found.some((e) => e.id === entry.id)).toBe(true);
  });

  it("markFailed increments retryCount and persists across reads", async () => {
    const ach = makeAchievement();
    const entry = await ledger.append(buildLedgerEntriesForAchievement(ach, 0, FAMILY)[0]);

    await ledger.markFailed(FAMILY, [entry.id], "insufficient_gas");
    await ledger.markFailed(FAMILY, [entry.id], "insufficient_gas");

    const failed = await ledger.listFailed(FAMILY);
    expect(failed).toHaveLength(1);
    expect(failed[0].retryCount).toBe(2);
    expect(failed[0].failureReason).toBe("insufficient_gas");
  });

  it("markAbandoned moves entry to abandoned status", async () => {
    const ach = makeAchievement();
    const entry = await ledger.append(buildLedgerEntriesForAchievement(ach, 0, FAMILY)[0]);

    await ledger.markAbandoned(FAMILY, [entry.id]);

    const abandoned = await ledger.listAbandoned(FAMILY);
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0].id).toBe(entry.id);

    // Abandoned entries are NOT returned by listPendingOrFailed
    const pickup = await ledger.listPendingOrFailed(FAMILY);
    expect(pickup.find((e) => e.id === entry.id)).toBeUndefined();
  });

  it("summarizePending aggregates by kind and destination", async () => {
    const ach1 = makeAchievement({ amount: 1_000_000 });
    const ach2 = makeAchievement({ amount: 500_000, childName: "Diego" });
    for (const e of buildLedgerEntriesForAchievement(ach1, 20, FAMILY)) {
      await ledger.append(e);
    }
    for (const e of buildLedgerEntriesForAchievement(ach2, 0, FAMILY)) {
      await ledger.append(e);
    }

    const summary = await ledger.summarizePending(FAMILY);
    expect(summary.totalMicros).toBe(1_500_000);
    expect(summary.byKind["achievement-credit"]).toBe(800_000 + 500_000);
    expect(summary.byKind["savings-deposit"]).toBe(200_000);
    expect(summary.byDestination["child-wallet"]).toBe(800_000 + 500_000);
    expect(summary.byDestination["savings-vault"]).toBe(200_000);
  });
});

describe("classifyFailure (W8)", () => {
  it("LS47 — gas-related errors classify as insufficient_gas", () => {
    expect(classifyFailure(new Error("execution reverted: insufficient funds for gas"))).toBe("insufficient_gas");
    expect(classifyFailure(new Error("insufficient gas"))).toBe("insufficient_gas");
  });

  it("LS48 — timeout errors classify as rpc_timeout", () => {
    expect(classifyFailure(new Error("ETIMEDOUT"))).toBe("rpc_timeout");
    expect(classifyFailure(new Error("RPC request timed out"))).toBe("rpc_timeout");
  });

  it("LS49 — OWS policy_denied errors classify as policy_denied: recipient_not_authorized", () => {
    expect(classifyFailure(new Error("POLICY_DENIED: recipient not authorized"))).toBe(
      "policy_denied: recipient_not_authorized",
    );
    expect(classifyFailure(new Error("policy_denied"))).toBe("policy_denied");
  });

  it("LS50 — unknown errors fall back to raw message", () => {
    const reason = classifyFailure(new Error("something weird happened"));
    expect(reason).toContain("something weird");
  });

  it("non-Error inputs are stringified", () => {
    expect(classifyFailure("just a string")).toContain("just a string");
    expect(classifyFailure(42)).toContain("42");
  });

  it("over-long messages are truncated to 200 chars", () => {
    const long = "X".repeat(500);
    const reason = classifyFailure(new Error(long));
    expect(reason.length).toBeLessThanOrEqual(201); // 200 + "…"
  });
});

// Manual cleanup helper if tests start leaking tmp dirs
afterEach?.(async () => {
  try {
    await rm(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// Stub `afterEach` for environments where it's not auto-imported.
// Vitest exposes it globally with `globals: true` in vitest.config.ts.
declare function afterEach(fn: () => void | Promise<void>): void;
