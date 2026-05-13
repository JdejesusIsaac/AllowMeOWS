import { readFile, writeFile, mkdir, rename, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../constants.js";
import type {
  FamilyConfig,
  ChildConfig,
  AchievementRecord,
  Member,
  Invite,
  StreakData,
  SavingsEntry,
  SavingsEntryInput,
  AuditEntry,
} from "../schemas.js";
import { FamilyConfigSchema } from "../schemas.js";
import { STREAK } from "../constants.js";

// Resolve project root from this file's location (src/engine/state.ts → ../../)
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..");
const dataDir = join(projectRoot, DATA_DIR);

/**
 * Returns the absolute path to the data directory.
 */
export function getDataDir(): string {
  return dataDir;
}

/**
 * Returns the absolute path to a family's scoped data directory:
 * `{dataDir}/families/{familyId}/`.
 */
export function getFamilyDir(familyId: string): string {
  return join(dataDir, "families", familyId);
}

/**
 * Returns the absolute path to a family's OWS vault directory:
 * `{dataDir}/families/{familyId}/.ows/`.
 *
 * Each family gets its own isolated OWS vault so that wallet names like
 * `treasury` / `savings-vault` / `gift-fund` cannot collide across families,
 * and a leak in one family's vault file does not expose another family's
 * wallet inventory. Sprint 2.9.1 hotfix.
 */
export function getFamilyVaultPath(familyId: string): string {
  return join(dataDir, "families", familyId, ".ows");
}

async function ensureDataDir(): Promise<void> {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
}

async function ensureFamilyDir(familyId: string): Promise<void> {
  await ensureDataDir();
  const familyDir = getFamilyDir(familyId);
  if (!existsSync(familyDir)) {
    await mkdir(familyDir, { recursive: true, mode: 0o700 });
  }
}

async function readJson<T>(familyId: string, filename: string, fallback: T): Promise<T> {
  await ensureFamilyDir(familyId);
  const filepath = join(getFamilyDir(familyId), filename);
  try {
    const raw = await readFile(filepath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(familyId: string, filename: string, data: T): Promise<void> {
  await ensureFamilyDir(familyId);
  const filepath = join(getFamilyDir(familyId), filename);
  const tmpPath = filepath + `.tmp.${randomUUID().slice(0, 8)}`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmpPath, filepath);
}

/**
 * Auto-migrate legacy categoryBudgets → categories[] format.
 * If a child has categoryBudgets but no categories, convert and remove old field.
 */
function migrateLegacyCategories(config: FamilyConfig): { config: FamilyConfig; migrated: boolean } {
  let migrated = false;
  for (const child of config.children) {
    if (!child.categories && child.categoryBudgets) {
      const wb = child.weeklyBudget;
      child.categories = [
        { name: "education", pct: wb > 0 ? Math.round((child.categoryBudgets.education / wb) * 100) : 0, budget: child.categoryBudgets.education },
        { name: "health", pct: wb > 0 ? Math.round((child.categoryBudgets.health / wb) * 100) : 0, budget: child.categoryBudgets.health },
        { name: "personal", pct: wb > 0 ? Math.round((child.categoryBudgets.personal / wb) * 100) : 0, budget: child.categoryBudgets.personal },
      ];
      delete (child as Record<string, unknown>).categoryBudgets;
      console.error(`[state] Migrated legacy category format for ${child.name}`);
      migrated = true;
    }
  }
  return { config, migrated };
}

export class StateManager {
  // === Family Directory Management (Sprint 2.9) ===
  /**
   * Create a family's scoped data directory with restrictive permissions.
   * Safe to call repeatedly.
   */
  async createFamilyDir(familyId: string): Promise<void> {
    await ensureFamilyDir(familyId);
  }

  /**
   * List all family IDs that have directories under `data/families/`.
   * Returns an empty array if the families root does not exist.
   */
  async listFamilies(): Promise<string[]> {
    const familiesRoot = join(dataDir, "families");
    if (!existsSync(familiesRoot)) return [];
    const entries = await readdir(familiesRoot);
    const families: string[] = [];
    for (const entry of entries) {
      try {
        const s = await stat(join(familiesRoot, entry));
        if (s.isDirectory()) families.push(entry);
      } catch {
        // Skip entries we can't stat
      }
    }
    return families;
  }

  /**
   * Return true if the given family has been initialized (family-config.json exists).
   */
  async familyExists(familyId: string): Promise<boolean> {
    const configPath = join(getFamilyDir(familyId), "family-config.json");
    return existsSync(configPath);
  }

  // === Family Config ===
  async loadFamilyConfig(familyId: string): Promise<FamilyConfig | null> {
    const raw = await readJson<FamilyConfig | null>(familyId, "family-config.json", null);
    if (!raw) return null;
    const { config, migrated } = migrateLegacyCategories(raw);
    if (migrated) {
      await this.saveFamilyConfig(familyId, config);
    }
    // Sprint 3.0.2 — run the config through Zod parse so schema defaults
    // apply on load. Pre-3.0.2 configs missing `authorizedDestinations`
    // load with `[]`, which the subsequent `configure-policy` call
    // auto-populates (AL15 / migration test).
    return FamilyConfigSchema.parse(config);
  }

  async saveFamilyConfig(familyId: string, config: FamilyConfig): Promise<void> {
    await writeJson(familyId, "family-config.json", config);
  }

  // === Achievements ===
  async loadAchievements(familyId: string): Promise<AchievementRecord[]> {
    return readJson<AchievementRecord[]>(familyId, "achievements.json", []);
  }

  async saveAchievements(familyId: string, records: AchievementRecord[]): Promise<void> {
    await writeJson(familyId, "achievements.json", records);
  }

  async addAchievement(familyId: string, record: AchievementRecord): Promise<void> {
    const records = await this.loadAchievements(familyId);
    records.push(record);
    await this.saveAchievements(familyId, records);
  }

  // === Members ===
  async loadMembers(familyId: string): Promise<Member[]> {
    return readJson<Member[]>(familyId, "members.json", []);
  }

  async saveMembers(familyId: string, members: Member[]): Promise<void> {
    await writeJson(familyId, "members.json", members);
  }

  async addMember(familyId: string, member: Member): Promise<void> {
    const members = await this.loadMembers(familyId);
    members.push(member);
    await this.saveMembers(familyId, members);
  }

  /**
   * Lookup a single active member inside a family by id.
   * Returns null if the member does not exist or is inactive.
   */
  async loadMember(familyId: string, memberId: string): Promise<Member | null> {
    const members = await this.loadMembers(familyId);
    return members.find((m) => m.id === memberId && m.active) ?? null;
  }

  // === Invites ===
  async loadInvites(familyId: string): Promise<Invite[]> {
    return readJson<Invite[]>(familyId, "invites.json", []);
  }

  async saveInvites(familyId: string, invites: Invite[]): Promise<void> {
    await writeJson(familyId, "invites.json", invites);
  }

  async addInvite(familyId: string, invite: Invite): Promise<void> {
    const invites = await this.loadInvites(familyId);
    invites.push(invite);
    await this.saveInvites(familyId, invites);
  }

  // === Streaks ===
  async loadStreaks(familyId: string): Promise<StreakData[]> {
    return readJson<StreakData[]>(familyId, "streaks.json", []);
  }

  async saveStreaks(familyId: string, streaks: StreakData[]): Promise<void> {
    await writeJson(familyId, "streaks.json", streaks);
  }

  async loadStreak(familyId: string, childName: string): Promise<StreakData | null> {
    const streaks = await this.loadStreaks(familyId);
    return streaks.find((s) => s.childName.toLowerCase() === childName.toLowerCase()) ?? null;
  }

  async initializeStreak(familyId: string, childName: string): Promise<void> {
    const streaks = await this.loadStreaks(familyId);
    const existing = streaks.find(
      (s) => s.childName.toLowerCase() === childName.toLowerCase()
    );
    if (!existing) {
      streaks.push({
        childName,
        currentStreak: 0,
        longestStreak: 0,
        multiplier: 1.0,
        weeklyAchievements: 0,
      });
      await this.saveStreaks(familyId, streaks);
    }
  }

  async updateStreak(familyId: string, childName: string): Promise<StreakData> {
    const streaks = await this.loadStreaks(familyId);
    let streak = streaks.find(
      (s) => s.childName.toLowerCase() === childName.toLowerCase()
    );

    if (!streak) {
      streak = {
        childName,
        currentStreak: 0,
        longestStreak: 0,
        multiplier: 1.0,
        weeklyAchievements: 0,
      };
      streaks.push(streak);
    }

    const today = new Date().toISOString().split("T")[0];
    const lastDate = streak.lastActivityDate;

    if (lastDate === today) {
      // Same day — increment weekly count only
      streak.weeklyAchievements++;
    } else if (lastDate) {
      const lastMs = new Date(lastDate).getTime();
      const todayMs = new Date(today).getTime();
      const daysDiff = Math.round((todayMs - lastMs) / (24 * 60 * 60 * 1000));

      if (daysDiff === 1) {
        // Consecutive day — extend streak
        streak.currentStreak++;
        streak.weeklyAchievements++;
      } else {
        // Streak broken
        streak.currentStreak = 1;
        streak.weeklyAchievements = 1;
      }
    } else {
      // First activity
      streak.currentStreak = 1;
      streak.weeklyAchievements = 1;
    }

    streak.lastActivityDate = today;
    streak.longestStreak = Math.max(streak.longestStreak, streak.currentStreak);

    // Calculate multiplier based on streak
    const streakLevels = Math.floor(streak.currentStreak / STREAK.BONUS_THRESHOLD);
    streak.multiplier = Math.min(
      1.0 + streakLevels * STREAK.MULTIPLIER_INCREMENT,
      STREAK.MAX_MULTIPLIER
    );

    await this.saveStreaks(familyId, streaks);
    return streak;
  }

  // === Savings ===
  async loadSavingsEntries(familyId: string, childName?: string): Promise<SavingsEntry[]> {
    const all = await readJson<SavingsEntry[]>(familyId, "savings.json", []);
    if (childName) {
      return all.filter((e) => e.childName.toLowerCase() === childName.toLowerCase());
    }
    return all;
  }

  async saveSavingsEntries(familyId: string, entries: SavingsEntry[]): Promise<void> {
    await writeJson(familyId, "savings.json", entries);
  }

  async addSavingsEntry(familyId: string, entry: SavingsEntryInput): Promise<void> {
    const entries = await readJson<SavingsEntry[]>(familyId, "savings.json", []);
    // Apply defaults for fields that have them
    const full: SavingsEntry = {
      asset: "USDC",
      released: false,
      multiplierAtDeposit: 1.0,
      converted: false,
      ...entry,
    } as SavingsEntry;
    entries.push(full);
    await this.saveSavingsEntries(familyId, entries);
  }

  // === Audit Log ===
  async loadAuditLog(familyId: string): Promise<AuditEntry[]> {
    return readJson<AuditEntry[]>(familyId, "audit-log.json", []);
  }

  async addAuditEntry(familyId: string, entry: AuditEntry): Promise<void> {
    const log = await this.loadAuditLog(familyId);
    log.push(entry);
    await writeJson(familyId, "audit-log.json", log);
  }
}
