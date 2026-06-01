#!/usr/bin/env tsx
/**
 * Sprint 4.0.2 W2 + D7 — one-shot bulk migration of audit logs from
 * the legacy JSON-array format to JSONL.
 *
 * The state-manager runtime already performs an inline migration on
 * the first `addAuditEntry` after deploy. This script exists for two
 * reasons:
 *
 *   1. Operators may want to migrate all families at boot rather than
 *      lazily on first append — useful for the W2/W3 Vector sidecar
 *      which expects JSONL across the board.
 *   2. A pre-deploy run gives operators visibility into which families
 *      will be migrated (and how large the .bak files will be).
 *
 * Behavior (matches contract C4):
 *   - For each family directory under `data/families/<id>/`:
 *     - If `audit-log.jsonl` exists → skip (already migrated).
 *     - If `audit-log.json` exists → parse entries, write JSONL,
 *       rename original to `.bak`.
 *     - If neither exists → skip silently.
 *   - Idempotent: running twice does not double-migrate.
 *   - Non-destructive: original file preserved as `.bak` for one
 *     release cycle.
 *
 * Usage:
 *   npx tsx scripts/migrate-audit-logs.ts
 *   AUDIT_MIGRATION_DATA_DIR=/custom/data npx tsx scripts/migrate-audit-logs.ts
 */

import { readFile, writeFile, rename, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "../src/constants.js";
import type { AuditEntry } from "../src/schemas.js";

export interface MigrationResult {
  familyId: string;
  status: "migrated" | "skipped-already-jsonl" | "skipped-no-legacy" | "error";
  entriesMigrated?: number;
  error?: string;
}

export async function migrateFamily(familyDir: string, familyId: string): Promise<MigrationResult> {
  const jsonlPath = join(familyDir, "audit-log.jsonl");
  const legacyPath = join(familyDir, "audit-log.json");

  if (existsSync(jsonlPath)) {
    return { familyId, status: "skipped-already-jsonl" };
  }
  if (!existsSync(legacyPath)) {
    return { familyId, status: "skipped-no-legacy" };
  }

  try {
    const raw = await readFile(legacyPath, "utf-8");
    const entries = JSON.parse(raw) as AuditEntry[];
    if (!Array.isArray(entries)) {
      return { familyId, status: "error", error: "legacy file is not an array" };
    }
    const jsonlBody =
      entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
    await writeFile(jsonlPath, jsonlBody, "utf-8");
    await rename(legacyPath, legacyPath + ".bak");
    return { familyId, status: "migrated", entriesMigrated: entries.length };
  } catch (err) {
    return {
      familyId,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runAuditLogMigration(dataDirOverride?: string): Promise<MigrationResult[]> {
  // Resolve data dir from override → env → constant default.
  let dataDir = dataDirOverride ?? process.env.AUDIT_MIGRATION_DATA_DIR;
  if (!dataDir) {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    dataDir = join(__dirname, "..", DATA_DIR);
  }
  const familiesRoot = join(dataDir, "families");
  if (!existsSync(familiesRoot)) {
    return [];
  }
  const results: MigrationResult[] = [];
  const entries = await readdir(familiesRoot);
  for (const entry of entries) {
    const familyDir = join(familiesRoot, entry);
    try {
      const s = await stat(familyDir);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }
    results.push(await migrateFamily(familyDir, entry));
  }
  return results;
}

// Direct-run guard so importing this from a test doesn't trigger the
// migration. `process.argv[1]` is the script's path when run via tsx.
const isDirectRun = process.argv[1] && process.argv[1].endsWith("migrate-audit-logs.ts");
if (isDirectRun) {
  void runAuditLogMigration()
    .then((results) => {
      const migrated = results.filter((r) => r.status === "migrated");
      const skipped = results.filter((r) => r.status.startsWith("skipped"));
      const errors = results.filter((r) => r.status === "error");
      console.log(`[audit-migration] migrated: ${migrated.length} families`);
      console.log(`[audit-migration] skipped: ${skipped.length} families`);
      if (errors.length > 0) {
        console.error(`[audit-migration] errors: ${errors.length}`);
        for (const e of errors) {
          console.error(`  ${e.familyId}: ${e.error}`);
        }
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("[audit-migration] fatal:", err);
      process.exit(1);
    });
}
