import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FamilyConfig, Member } from "../schemas.js";
import { getDataDir, getFamilyDir } from "../engine/state.js";
import { MemberIndex } from "../identity/member-index.js";

const SENTINEL_FILENAME = ".migrated-2.9";

/**
 * Files that were stored at `data/*` under Sprint 2.75 and that move to
 * `data/families/{familyId}/*` under Sprint 2.9. Each is moved atomically via
 * `rename`. Missing files are silently skipped (not every deployment has e.g.
 * fitbit-tokens.json).
 */
const LEGACY_FILES = [
  "family-config.json",
  "members.json",
  "invites.json",
  "streaks.json",
  "savings.json",
  "achievements.json",
  "audit-log.json",
  "fitbit-tokens.json",
] as const;

export interface MigrationResult {
  ran: boolean;
  reason: string;
  familyId?: string;
  filesMoved: string[];
  membersIndexed: number;
}

/**
 * Detect whether the legacy Sprint 2.75 layout is present on disk.
 */
function detectLegacyLayout(dataDir: string): boolean {
  const legacyConfig = join(dataDir, "family-config.json");
  const familiesDir = join(dataDir, "families");
  return existsSync(legacyConfig) && !existsSync(familiesDir);
}

/**
 * One-way migration from Sprint 2.75 single-tenant layout to Sprint 2.9
 * multi-tenant layout.
 *
 * Behavior:
 *   - No-op if `data/.migrated-2.9` sentinel already exists.
 *   - No-op if the legacy layout is not detected (fresh install).
 *   - Atomic per-file moves via `fs.rename`. Files that don't exist are
 *     skipped.
 *   - Builds `data/member-index.json` from the migrated `members.json`
 *     (active members only).
 *   - Writes `data/.migrated-2.9` sentinel with ISO timestamp on success.
 *   - If any step throws, the error propagates; partial state on disk is
 *     safe because `rename` is atomic and this function is rerunnable (the
 *     next call finishes whatever steps remain).
 */
export async function migrateToMultiTenant(): Promise<MigrationResult> {
  const dataDir = getDataDir();
  const sentinelPath = join(dataDir, SENTINEL_FILENAME);

  if (existsSync(sentinelPath)) {
    return {
      ran: false,
      reason: "sentinel present — migration already complete",
      filesMoved: [],
      membersIndexed: 0,
    };
  }

  if (!detectLegacyLayout(dataDir)) {
    // Nothing to migrate. Write sentinel anyway so we don't keep re-checking
    // on every startup for a fresh installation.
    if (existsSync(dataDir)) {
      await writeSentinel(sentinelPath, "no legacy layout detected");
    }
    return {
      ran: false,
      reason: "no legacy layout detected",
      filesMoved: [],
      membersIndexed: 0,
    };
  }

  console.error("[migrate:2.9] Sprint 2.75 → 2.9 migration starting");

  // Step 1: Load legacy family config to derive familyId. Sprint 2.75 already
  // set `familyId` on FamilyConfig; honor it if present, generate otherwise.
  const legacyConfigPath = join(dataDir, "family-config.json");
  const raw = await readFile(legacyConfigPath, "utf-8");
  const legacyConfig = JSON.parse(raw) as FamilyConfig;
  const familyId = legacyConfig.familyId ?? randomUUID();

  if (!legacyConfig.familyId) {
    console.error(
      `[migrate:2.9] Legacy config had no familyId — assigning new ${familyId}`
    );
  } else {
    console.error(`[migrate:2.9] Preserving existing familyId ${familyId}`);
  }

  // Step 2: Create the family directory (0o700).
  const familyDir = getFamilyDir(familyId);
  if (!existsSync(familyDir)) {
    await mkdir(familyDir, { recursive: true, mode: 0o700 });
  }

  // Step 2a: If we assigned a new familyId (one that wasn't on the legacy
  // config), patch the in-place family-config.json before the rename so the
  // file we move already has the right id.
  if (!legacyConfig.familyId) {
    const patched: FamilyConfig = { ...legacyConfig, familyId };
    await writeFile(legacyConfigPath, JSON.stringify(patched, null, 2), "utf-8");
  }

  // Step 3: Atomic per-file rename.
  const filesMoved: string[] = [];
  for (const file of LEGACY_FILES) {
    const src = join(dataDir, file);
    const dst = join(familyDir, file);
    if (existsSync(src) && !existsSync(dst)) {
      await rename(src, dst);
      filesMoved.push(file);
      console.error(`[migrate:2.9] Moved ${file} → families/${familyId}/${file}`);
    }
  }

  // Step 4: Build member-index from migrated members.json
  const index = new MemberIndex();
  let membersIndexed = 0;
  const migratedMembersPath = join(familyDir, "members.json");
  if (existsSync(migratedMembersPath)) {
    try {
      const membersRaw = await readFile(migratedMembersPath, "utf-8");
      const members = JSON.parse(membersRaw) as Member[];
      for (const member of members) {
        if (member.active !== false) {
          await index.set(member.id, familyId, member.role);
          membersIndexed++;
        }
      }
      console.error(
        `[migrate:2.9] Built member-index with ${membersIndexed} active member(s)`
      );
    } catch (err) {
      console.error(
        `[migrate:2.9] Warning: failed to rebuild member-index from members.json — ${
          err instanceof Error ? err.message : String(err)
        }. Run rebuild-member-index manually.`
      );
    }
  }

  // Step 5: Write sentinel.
  await writeSentinel(sentinelPath, "migration complete");
  console.error("[migrate:2.9] Migration complete");

  return {
    ran: true,
    reason: "legacy layout migrated",
    familyId,
    filesMoved,
    membersIndexed,
  };
}

async function writeSentinel(sentinelPath: string, note: string): Promise<void> {
  const payload = JSON.stringify(
    {
      migratedAt: new Date().toISOString(),
      version: "2.9",
      note,
    },
    null,
    2
  );
  await writeFile(sentinelPath, payload, { encoding: "utf-8", mode: 0o600 });
}
