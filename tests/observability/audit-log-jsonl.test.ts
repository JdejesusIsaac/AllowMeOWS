/**
 * Sprint 4.0.2 W2 + D7 — audit log JSONL migration tests
 * (contract C3, C4).
 *
 * Coverage:
 *   - OB11: writes one JSONL line per addAuditEntry call.
 *   - OB12: migration converts legacy JSON-array to JSONL, preserves
 *           `.bak` of the original.
 *   - OB13: ordering preserved across migration (entries appear in
 *           the same order in JSONL as in the JSON array).
 *   - OB14: `family_id` is recoverable from the on-disk path
 *           (Vector parses it via regex on the file path).
 *   - C4 sub-conditions: idempotent migration, byte-for-byte .bak
 *           preservation.
 *
 * Tests use a temp data dir so they don't collide with real family
 * data.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

import { StateManager } from "../../src/engine/state.js";
import {
  migrateFamily,
  runAuditLogMigration,
} from "../../scripts/migrate-audit-logs.js";

// We use a sibling data dir under /tmp so the StateManager (which
// resolves data dir from its own module location) doesn't conflict.
// The StateManager-based assertions write to the real `data/` dir
// under a unique family id; we clean up in afterEach.

const realStateManager = new StateManager();
const tempFamilies: string[] = [];

async function realDataAuditPath(familyId: string): Promise<{ jsonl: string; legacy: string; bak: string; familyDir: string }> {
  // Match StateManager's path resolution exactly.
  const projectRoot = join(__dirname, "..", "..");
  const familyDir = join(projectRoot, "data", "families", familyId);
  return {
    familyDir,
    jsonl: join(familyDir, "audit-log.jsonl"),
    legacy: join(familyDir, "audit-log.json"),
    bak: join(familyDir, "audit-log.json.bak"),
  };
}

afterEach(async () => {
  for (const fid of tempFamilies.splice(0)) {
    const { familyDir } = await realDataAuditPath(fid);
    if (existsSync(familyDir)) {
      await rm(familyDir, { recursive: true, force: true });
    }
  }
});

describe("loadAuditLog + addAuditEntry — JSONL on-disk format (OB11)", () => {
  it("OB11: each addAuditEntry call appends exactly one line to audit-log.jsonl", async () => {
    const familyId = "obtest-" + randomUUID().slice(0, 8);
    tempFamilies.push(familyId);

    await realStateManager.addAuditEntry(familyId, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "configure",
      actor: "manager",
      details: { familyName: "Test" },
    });
    await realStateManager.addAuditEntry(familyId, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "verify-achievement",
      actor: "manager",
      details: { note: "second entry" },
    });

    const { jsonl } = await realDataAuditPath(familyId);
    expect(existsSync(jsonl)).toBe(true);
    const raw = await readFile(jsonl, "utf-8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    // Each line must be parseable JSON on its own (per the JSONL spec).
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // The trailing newline is preserved so additional appends produce
    // separate lines, not concatenated objects.
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("loadAuditLog round-trips the entries written by addAuditEntry", async () => {
    const familyId = "obtest-rt-" + randomUUID().slice(0, 8);
    tempFamilies.push(familyId);

    await realStateManager.addAuditEntry(familyId, {
      id: "id-1",
      timestamp: "2026-01-01T00:00:00Z",
      action: "configure",
      actor: "manager",
      details: {},
    });
    await realStateManager.addAuditEntry(familyId, {
      id: "id-2",
      timestamp: "2026-01-02T00:00:00Z",
      action: "distribute",
      actor: "manager-2",
      details: { childName: "Maya" },
      amount: 500,
    });

    const log = await realStateManager.loadAuditLog(familyId);
    expect(log).toHaveLength(2);
    expect(log[0].id).toBe("id-1");
    expect(log[1].id).toBe("id-2");
    expect(log[1].action).toBe("distribute");
  });
});

describe("Audit log migration — inline (C4)", () => {
  it("OB12: legacy JSON-array file is migrated to JSONL on first addAuditEntry", async () => {
    const familyId = "obtest-mig-" + randomUUID().slice(0, 8);
    tempFamilies.push(familyId);
    const { familyDir, jsonl, legacy, bak } = await realDataAuditPath(familyId);

    // Seed with the legacy format manually so we exercise the inline
    // migration path.
    await mkdir(familyDir, { recursive: true });
    const legacyEntries = [
      { id: "a", timestamp: "2026-01-01T00:00:00Z", action: "configure", actor: "m", details: {} },
      { id: "b", timestamp: "2026-01-02T00:00:00Z", action: "verify-achievement", actor: "m", details: {} },
    ];
    await writeFile(legacy, JSON.stringify(legacyEntries, null, 2), "utf-8");
    const legacyBytesBefore = (await readFile(legacy)).toString();

    // First addAuditEntry triggers migration before append.
    await realStateManager.addAuditEntry(familyId, {
      id: "c",
      timestamp: "2026-01-03T00:00:00Z",
      action: "distribute",
      actor: "m",
      details: {},
    });

    // Post-migration state: jsonl exists, .bak preserves the legacy
    // file byte-for-byte, legacy file is gone.
    expect(existsSync(jsonl)).toBe(true);
    expect(existsSync(bak)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect((await readFile(bak)).toString()).toBe(legacyBytesBefore);

    // JSONL has all three entries in order.
    const log = await realStateManager.loadAuditLog(familyId);
    expect(log).toHaveLength(3);
    expect(log[0].id).toBe("a");
    expect(log[1].id).toBe("b");
    expect(log[2].id).toBe("c");
  });

  it("C4 idempotency: running migrateFamily twice does not double-migrate", async () => {
    const familyId = "obtest-idem-" + randomUUID().slice(0, 8);
    tempFamilies.push(familyId);
    const { familyDir, jsonl, legacy, bak } = await realDataAuditPath(familyId);

    await mkdir(familyDir, { recursive: true });
    const legacyEntries = [{ id: "x", timestamp: "2026-01-01T00:00:00Z", action: "configure", actor: "m", details: {} }];
    await writeFile(legacy, JSON.stringify(legacyEntries, null, 2), "utf-8");

    const first = await migrateFamily(familyDir, familyId);
    expect(first.status).toBe("migrated");
    expect(first.entriesMigrated).toBe(1);

    // After first migration, the legacy file is gone; second call hits
    // the "skipped-no-legacy" branch.
    const jsonlBytesAfterFirst = (await readFile(jsonl)).toString();
    const bakBytesAfterFirst = (await readFile(bak)).toString();

    const second = await migrateFamily(familyDir, familyId);
    // After the first migration, the JSONL file exists — second call
    // hits the "already migrated" branch, NOT the "no legacy data"
    // branch (those are distinct, even though both indicate no work
    // was needed).
    expect(second.status).toBe("skipped-already-jsonl");
    // The files are byte-for-byte identical — nothing got re-migrated.
    expect((await readFile(jsonl)).toString()).toBe(jsonlBytesAfterFirst);
    expect((await readFile(bak)).toString()).toBe(bakBytesAfterFirst);
  });
});

describe("runAuditLogMigration — bulk script (DEL4)", () => {
  it("returns empty result list when families dir doesn't exist", async () => {
    const result = await runAuditLogMigration(join(tmpdir(), "nonexistent-" + randomUUID()));
    expect(result).toEqual([]);
  });

  it("walks family dirs and applies migration to each", async () => {
    const fakeRoot = join(tmpdir(), "audit-bulk-" + randomUUID().slice(0, 8));
    const famA = "fam-a";
    const famB = "fam-b";
    const familiesRoot = join(fakeRoot, "families");
    await mkdir(join(familiesRoot, famA), { recursive: true });
    await mkdir(join(familiesRoot, famB), { recursive: true });

    // famA has legacy data, famB has no audit log yet
    await writeFile(
      join(familiesRoot, famA, "audit-log.json"),
      JSON.stringify([{ id: "1", timestamp: "2026-01-01", action: "x", actor: "y" }]),
      "utf-8",
    );

    const results = await runAuditLogMigration(fakeRoot);
    expect(results).toHaveLength(2);
    const byFamily = Object.fromEntries(results.map((r) => [r.familyId, r]));
    expect(byFamily[famA].status).toBe("migrated");
    expect(byFamily[famA].entriesMigrated).toBe(1);
    expect(byFamily[famB].status).toBe("skipped-no-legacy");

    // Cleanup
    await rm(fakeRoot, { recursive: true, force: true });
  });
});

describe("OB14 — family_id is recoverable from path", () => {
  it("Vector-style regex extracts family_id from the audit log path", async () => {
    // This mirrors the Vector transform configured in observability/vector.toml
    // §[transforms.parse_audit]. The transform uses `parse_regex` on the
    // file path; the test verifies the regex itself is correct.
    const pathRe = /families\/(?<id>[^/]+)\/audit-log\.jsonl$/;
    const samplePath = "/app/data/families/fam_abc/audit-log.jsonl";
    const match = samplePath.match(pathRe);
    expect(match).not.toBeNull();
    expect(match?.groups?.id).toBe("fam_abc");
  });
});
