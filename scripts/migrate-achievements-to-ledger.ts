#!/usr/bin/env tsx
/**
 * Sprint 4.0.3 W9 — one-shot migration of pre-4.0.3 undistributed
 * achievements into the new LedgerEntry store.
 *
 * Behavior:
 *   - For each family directory under `data/families/<id>/`:
 *     - Load achievements via `StateManager.loadAchievements`.
 *     - Filter to records with `distributed === false`.
 *     - For each, check `ledger.findBySourceId(familyId, ach.id)` — if
 *       entries already exist for this sourceId, skip (idempotent).
 *     - Otherwise build LedgerEntries via
 *       `buildLedgerEntriesForAchievement` using the CHILD's CURRENT
 *       savingsPercent. This is the documented behavior (research §5.4
 *       caveat — pre-migration achievements have no preserved split, so
 *       we apply the current policy at migration time).
 *     - Append all built entries to the ledger.
 *   - Already-`distributed: true` achievements are NOT migrated (they
 *     are already on-chain; the ledger doesn't owe them anything per
 *     research §5.4).
 *
 * Idempotency: re-running the script does NOT create duplicate ledger
 * entries because the `findBySourceId` check skips achievements whose
 * entries already exist.
 *
 * Dry-run: pass `--dry-run` to report what WOULD be created without
 * writing anything. Returns the same MigrationResult structure but
 * with `status: "would-create"`.
 *
 * Usage:
 *   npx tsx scripts/migrate-achievements-to-ledger.ts
 *   npx tsx scripts/migrate-achievements-to-ledger.ts --dry-run
 *   ALLOWME_MIGRATION_DATA_DIR=/custom/data npx tsx scripts/migrate-achievements-to-ledger.ts
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "../src/constants.js";
import {
  FilesystemLedger,
  buildLedgerEntriesForAchievement,
} from "../src/engine/ledger.js";
import type {
  AchievementRecord,
  ChildConfig,
  FamilyConfig,
} from "../src/schemas.js";
import { DEFAULT_SAVINGS_PERCENT } from "../src/constants.js";

export interface FamilyMigrationResult {
  familyId: string;
  status:
    | "migrated"
    | "skipped-no-achievements"
    | "skipped-no-pending"
    | "would-create" // dry-run
    | "error";
  achievementsProcessed: number;
  entriesCreated: number;
  entriesSkippedAsDuplicate: number;
  error?: string;
}

export interface MigrationOptions {
  dryRun?: boolean;
  rootDir?: string;
}

export interface MigrationSummary {
  total: number;
  migrated: number;
  alreadyComplete: number;
  failed: number;
  totalEntriesCreated: number;
  totalEntriesSkipped: number;
  dryRun: boolean;
  perFamily: FamilyMigrationResult[];
}

function resolveDataDir(rootDir?: string): string {
  if (rootDir) return rootDir;
  const envDir = process.env.ALLOWME_MIGRATION_DATA_DIR;
  if (envDir) return envDir;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, "..", DATA_DIR);
}

async function loadJsonFile<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function migrateOneFamily(
  familyId: string,
  rootDir: string,
  ledger: FilesystemLedger,
  dryRun: boolean,
): Promise<FamilyMigrationResult> {
  try {
    const familyDir = join(rootDir, "families", familyId);
    const achievements = await loadJsonFile<AchievementRecord[]>(
      join(familyDir, "achievements.json"),
      [],
    );
    if (achievements.length === 0) {
      return {
        familyId,
        status: "skipped-no-achievements",
        achievementsProcessed: 0,
        entriesCreated: 0,
        entriesSkippedAsDuplicate: 0,
      };
    }

    const pending = achievements.filter((a) => a.distributed === false);
    if (pending.length === 0) {
      return {
        familyId,
        status: "skipped-no-pending",
        achievementsProcessed: 0,
        entriesCreated: 0,
        entriesSkippedAsDuplicate: 0,
      };
    }

    const config = await loadJsonFile<FamilyConfig | null>(
      join(familyDir, "family-config.json"),
      null,
    );
    if (!config) {
      return {
        familyId,
        status: "error",
        achievementsProcessed: 0,
        entriesCreated: 0,
        entriesSkippedAsDuplicate: 0,
        error: "family-config not found",
      };
    }

    let entriesCreated = 0;
    let entriesSkipped = 0;

    for (const ach of pending) {
      const existing = await ledger.findBySourceId(familyId, ach.id);
      if (existing.length > 0) {
        entriesSkipped++;
        continue;
      }
      const childConfig: ChildConfig | undefined = config.children.find(
        (c: ChildConfig) =>
          c.name.toLowerCase() === ach.childName.toLowerCase(),
      );
      const savingsPercent =
        childConfig?.savingsPercent ?? DEFAULT_SAVINGS_PERCENT;
      const entries = buildLedgerEntriesForAchievement(
        ach,
        savingsPercent,
        familyId,
      );
      if (!dryRun) {
        for (const entry of entries) {
          await ledger.append(entry);
        }
      }
      entriesCreated += entries.length;
    }

    return {
      familyId,
      status: dryRun ? "would-create" : "migrated",
      achievementsProcessed: pending.length,
      entriesCreated,
      entriesSkippedAsDuplicate: entriesSkipped,
    };
  } catch (err) {
    return {
      familyId,
      status: "error",
      achievementsProcessed: 0,
      entriesCreated: 0,
      entriesSkippedAsDuplicate: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runMigration(
  options: MigrationOptions = {},
): Promise<MigrationSummary> {
  const dryRun = options.dryRun ?? false;
  const dataDirAbs = resolveDataDir(options.rootDir);
  const familiesRoot = join(dataDirAbs, "families");

  const summary: MigrationSummary = {
    total: 0,
    migrated: 0,
    alreadyComplete: 0,
    failed: 0,
    totalEntriesCreated: 0,
    totalEntriesSkipped: 0,
    dryRun,
    perFamily: [],
  };

  if (!existsSync(familiesRoot)) {
    return summary;
  }

  const entries = await readdir(familiesRoot);
  const familyIds: string[] = [];
  for (const entry of entries) {
    try {
      const s = await stat(join(familiesRoot, entry));
      if (s.isDirectory()) familyIds.push(entry);
    } catch {
      /* skip unreadable */
    }
  }

  // Use a ledger rooted at the migration data dir so the script
  // honors `ALLOWME_MIGRATION_DATA_DIR` and test harnesses can point
  // at tmp directories. Family achievements + configs are read
  // directly from `rootDir` (StateManager hard-codes the project
  // data dir at module load, so we bypass it here for relocatable IO).
  const ledger = new FilesystemLedger(dataDirAbs);

  for (const familyId of familyIds) {
    summary.total++;
    const result = await migrateOneFamily(familyId, dataDirAbs, ledger, dryRun);
    summary.perFamily.push(result);
    summary.totalEntriesCreated += result.entriesCreated;
    summary.totalEntriesSkipped += result.entriesSkippedAsDuplicate;
    if (result.status === "migrated" || result.status === "would-create") {
      summary.migrated++;
    } else if (
      result.status === "skipped-no-achievements" ||
      result.status === "skipped-no-pending"
    ) {
      summary.alreadyComplete++;
    } else if (result.status === "error") {
      summary.failed++;
    }
  }

  return summary;
}

// === CLI entry point ===
//
// Only runs when invoked as a script, not on import (tests import
// `runMigration` directly).
const isMainModule = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const dryRun = process.argv.includes("--dry-run");
  runMigration({ dryRun })
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (summary.failed > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
