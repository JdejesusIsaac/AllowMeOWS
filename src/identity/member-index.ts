import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Role } from "../constants.js";
import { getDataDir } from "../engine/state.js";

/**
 * A single row of the global member-index.json map.
 *
 * This file gives us O(1) lookup for "given a memberId, which family do they
 * belong to and what's their role?" without scanning every family directory.
 */
export interface MemberIndexEntry {
  familyId: string;
  role: Role;
}

const MEMBER_INDEX_FILENAME = "member-index.json";

/**
 * Global memberId → {familyId, role} lookup used by the identity layer.
 *
 * Persists to `data/member-index.json` (NOT scoped to a family — this is the
 * authoritative map that lets `resolveCallerRole` pick which family a caller
 * belongs to). Atomic writes via tmp + rename, file mode 0o600.
 */
/**
 * Per-process serialization lock for the member-index file. Chained via
 * `writeLock = writeLock.then(...)` so concurrent callers are processed in
 * arrival order. Prevents lost updates when multiple tool handlers call
 * `MemberIndex.set()` simultaneously (e.g. two parallel accept-invite calls).
 */
const writeLocks = new Map<string, Promise<void>>();

async function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => (release = resolve));
  writeLocks.set(key, prev.then(() => next));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    // If we're the tail of the chain, clean up the map entry to avoid leaks.
    if (writeLocks.get(key) === prev.then(() => next)) {
      writeLocks.delete(key);
    }
  }
}

export class MemberIndex {
  private indexPath: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? getDataDir();
    this.indexPath = join(dir, MEMBER_INDEX_FILENAME);
  }

  /**
   * Look up a member by id. Returns null if the member is not in the index.
   */
  async get(memberId: string): Promise<MemberIndexEntry | null> {
    const index = await this.load();
    return index[memberId] ?? null;
  }

  /**
   * Register (or update) a member. Overwrites any existing entry for the same id.
   * Serialized per file path to avoid read-modify-write races on the index.
   */
  async set(memberId: string, familyId: string, role: Role): Promise<void> {
    await withWriteLock(this.indexPath, async () => {
      const index = await this.load();
      index[memberId] = { familyId, role };
      await this.save(index);
    });
  }

  /**
   * Remove a member from the index. Idempotent.
   */
  async remove(memberId: string): Promise<void> {
    await withWriteLock(this.indexPath, async () => {
      const index = await this.load();
      if (memberId in index) {
        delete index[memberId];
        await this.save(index);
      }
    });
  }

  /**
   * Return the full index as a snapshot (do not mutate the returned object).
   */
  async list(): Promise<Record<string, MemberIndexEntry>> {
    return this.load();
  }

  /**
   * Return all members belonging to a specific family.
   */
  async listByFamily(familyId: string): Promise<Array<{ memberId: string; role: Role }>> {
    const index = await this.load();
    const matches: Array<{ memberId: string; role: Role }> = [];
    for (const [memberId, entry] of Object.entries(index)) {
      if (entry.familyId === familyId) {
        matches.push({ memberId, role: entry.role });
      }
    }
    return matches;
  }

  private async load(): Promise<Record<string, MemberIndexEntry>> {
    if (!existsSync(this.indexPath)) return {};
    try {
      const raw = await readFile(this.indexPath, "utf-8");
      return JSON.parse(raw) as Record<string, MemberIndexEntry>;
    } catch (err) {
      console.error(
        `[member-index] Warning: failed to read ${this.indexPath} — ${
          err instanceof Error ? err.message : String(err)
        }. Returning empty index.`
      );
      return {};
    }
  }

  private async save(index: Record<string, MemberIndexEntry>): Promise<void> {
    const dir = join(this.indexPath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmp = this.indexPath + `.tmp.${randomUUID().slice(0, 8)}`;
    await writeFile(tmp, JSON.stringify(index, null, 2), { encoding: "utf-8", mode: 0o600 });
    await rename(tmp, this.indexPath);
  }
}
