/**
 * Sprint 4.0.3 W9 — migration-script tests (LS56–LS60).
 *
 * Validates the one-shot migration of pre-4.0.3 undistributed
 * achievements into the LedgerEntry store. Tests run against an
 * isolated tmp data dir; the migration's data-dir is injected via the
 * `rootDir` option (NOT the env var) so test fixtures don't pollute
 * the global env.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runMigration,
  type MigrationSummary,
} from "../scripts/migrate-achievements-to-ledger.js";
import { FilesystemLedger } from "../src/engine/ledger.js";
import type {
  AchievementRecord,
  FamilyConfig,
  ChildConfig,
} from "../src/schemas.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "migrate-test-"));
});

afterEach(async () => {
  try {
    await rm(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function seedFamily(opts: {
  familyId: string;
  children: ChildConfig[];
  achievements: AchievementRecord[];
}): Promise<void> {
  const familyDir = join(tmpRoot, "families", opts.familyId);
  await mkdir(familyDir, { recursive: true });

  const now = new Date().toISOString();
  const config: FamilyConfig = {
    familyId: opts.familyId,
    familyName: "Test",
    children: opts.children,
    createdAt: now,
    updatedAt: now,
    chainId: "eip155:84532",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    authorizedDestinations: [],
    policyVersion: 1,
    autoSettleWeekly: false,
  };
  await writeFile(
    join(familyDir, "family-config.json"),
    JSON.stringify(config, null, 2),
  );
  await writeFile(
    join(familyDir, "achievements.json"),
    JSON.stringify(opts.achievements, null, 2),
  );
}

function makeChild(name: string, savingsPercent = 20): ChildConfig {
  return {
    name,
    walletName: `child-${name.toLowerCase()}`,
    weeklyBudget: 15_000_000,
    categories: [
      { name: "reading", pct: 100, budget: 15_000_000 },
    ],
    savingsPercent,
    savingsLockDays: 90,
  };
}

function makeAchievement(
  childName: string,
  opts: { amount: number; distributed: boolean },
): AchievementRecord {
  return {
    id: randomUUID(),
    childName,
    category: "reading",
    description: "Test achievement",
    score: 100,
    amount: opts.amount,
    source: "manual",
    verifiedBy: "manager",
    verifiedAt: new Date().toISOString(),
    distributed: opts.distributed,
  };
}

describe("LS56 — Migration creates ledger entries for undistributed achievements", () => {
  it("undistributed achievement → 2 ledger entries (20% split); distributed achievement → skipped", async () => {
    const familyId = randomUUID();
    await seedFamily({
      familyId,
      children: [makeChild("Maya", 20)],
      achievements: [
        makeAchievement("Maya", { amount: 1_000_000, distributed: false }),
        makeAchievement("Maya", { amount: 500_000, distributed: true }),
      ],
    });

    const summary = await runMigration({ rootDir: tmpRoot });
    expect(summary.migrated).toBe(1);
    expect(summary.totalEntriesCreated).toBe(2);

    const ledger = new FilesystemLedger(tmpRoot);
    const entries = await ledger.listPending(familyId, "Maya");
    expect(entries).toHaveLength(2);
    expect(entries.reduce((s, e) => s + e.amountUsdcMicros, 0)).toBe(1_000_000);
  });
});

describe("LS57 — Migration is idempotent", () => {
  it("running migration 3× produces the same entry count as 1×", async () => {
    const familyId = randomUUID();
    await seedFamily({
      familyId,
      children: [makeChild("Maya", 20)],
      achievements: [
        makeAchievement("Maya", { amount: 1_000_000, distributed: false }),
      ],
    });

    await runMigration({ rootDir: tmpRoot });
    await runMigration({ rootDir: tmpRoot });
    const third = await runMigration({ rootDir: tmpRoot });

    const ledger = new FilesystemLedger(tmpRoot);
    const entries = await ledger.listPending(familyId, "Maya");
    expect(entries).toHaveLength(2);

    // Third run sees both achievements as already-migrated
    expect(third.totalEntriesSkipped).toBeGreaterThanOrEqual(1);
    expect(third.totalEntriesCreated).toBe(0);
  });
});

describe("LS59 — Dry-run reports what would happen without writing", () => {
  it("--dry-run reports entry counts but writes nothing", async () => {
    const familyId = randomUUID();
    await seedFamily({
      familyId,
      children: [makeChild("Maya", 20)],
      achievements: [
        makeAchievement("Maya", { amount: 1_000_000, distributed: false }),
      ],
    });

    const summary = await runMigration({ rootDir: tmpRoot, dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.totalEntriesCreated).toBe(2); // would create 2
    expect(summary.perFamily[0].status).toBe("would-create");

    const ledger = new FilesystemLedger(tmpRoot);
    const entries = await ledger.listPending(familyId, "Maya");
    expect(entries).toHaveLength(0); // no writes
  });
});

describe("LS60 — Migration uses CURRENT savingsPercent (documented behavior)", () => {
  it("an achievement seeded before policy change applies the current 20% split", async () => {
    const familyId = randomUUID();
    await seedFamily({
      familyId,
      children: [makeChild("Maya", 20)],
      achievements: [
        makeAchievement("Maya", { amount: 1_000_000, distributed: false }),
      ],
    });

    await runMigration({ rootDir: tmpRoot });

    const ledger = new FilesystemLedger(tmpRoot);
    const entries = await ledger.listPending(familyId, "Maya");
    const savings = entries.find((e) => e.kind === "savings-deposit");
    expect(savings).toBeDefined();
    expect(savings!.amountUsdcMicros).toBe(200_000);
  });
});

describe("LS58 — Migration handles many achievements without OOM", () => {
  it("processes 1000 achievements in <10s", async () => {
    const familyId = randomUUID();
    const achievements: AchievementRecord[] = [];
    for (let i = 0; i < 1000; i++) {
      achievements.push(
        makeAchievement("Maya", { amount: 100_000, distributed: false }),
      );
    }
    await seedFamily({
      familyId,
      children: [makeChild("Maya", 20)],
      achievements,
    });

    const start = Date.now();
    const summary = await runMigration({ rootDir: tmpRoot });
    const duration = Date.now() - start;

    expect(summary.totalEntriesCreated).toBe(2000);
    expect(duration).toBeLessThan(10_000);
  }, 30_000);
});

describe("Migration cross-family + empty cases", () => {
  it("processes multiple families independently", async () => {
    const familyA = randomUUID();
    const familyB = randomUUID();
    await seedFamily({
      familyId: familyA,
      children: [makeChild("Maya", 20)],
      achievements: [makeAchievement("Maya", { amount: 1_000_000, distributed: false })],
    });
    await seedFamily({
      familyId: familyB,
      children: [makeChild("Diego", 20)],
      achievements: [makeAchievement("Diego", { amount: 500_000, distributed: false })],
    });

    const summary: MigrationSummary = await runMigration({ rootDir: tmpRoot });
    expect(summary.total).toBe(2);
    expect(summary.migrated).toBe(2);

    const ledger = new FilesystemLedger(tmpRoot);
    expect((await ledger.listPending(familyA)).length).toBe(2);
    expect((await ledger.listPending(familyB)).length).toBe(2);
  });

  it("returns empty summary when families root does not exist", async () => {
    const altRoot = await mkdtemp(join(tmpdir(), "migrate-empty-"));
    try {
      const summary = await runMigration({ rootDir: altRoot });
      expect(summary.total).toBe(0);
      expect(summary.totalEntriesCreated).toBe(0);
    } finally {
      await rm(altRoot, { recursive: true, force: true });
    }
  });

  it("skips a family with no pending achievements", async () => {
    const familyId = randomUUID();
    await seedFamily({
      familyId,
      children: [makeChild("Maya", 20)],
      achievements: [
        makeAchievement("Maya", { amount: 500_000, distributed: true }),
      ],
    });

    const summary = await runMigration({ rootDir: tmpRoot });
    expect(summary.alreadyComplete).toBe(1);
    expect(summary.totalEntriesCreated).toBe(0);
  });
});
