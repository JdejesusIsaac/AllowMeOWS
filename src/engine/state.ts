import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../constants.js";
import type {
  FamilyConfig,
  AchievementRecord,
  Member,
  Invite,
  StreakData,
  SavingsEntry,
  SavingsEntryInput,
  AuditEntry,
} from "../schemas.js";
import { STREAK } from "../constants.js";

// Resolve project root from this file's location (src/engine/state.ts → ../../)
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..");
const dataDir = join(projectRoot, DATA_DIR);

async function ensureDataDir(): Promise<void> {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
}

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  await ensureDataDir();
  const filepath = join(dataDir, filename);
  try {
    const raw = await readFile(filepath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(filename: string, data: T): Promise<void> {
  await ensureDataDir();
  const filepath = join(dataDir, filename);
  const tmpPath = filepath + `.tmp.${randomUUID().slice(0, 8)}`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmpPath, filepath);
}

export class StateManager {
  // === Family Config ===
  async loadFamilyConfig(): Promise<FamilyConfig | null> {
    return readJson<FamilyConfig | null>("family-config.json", null);
  }

  async saveFamilyConfig(config: FamilyConfig): Promise<void> {
    await writeJson("family-config.json", config);
  }

  // === Achievements ===
  async loadAchievements(): Promise<AchievementRecord[]> {
    return readJson<AchievementRecord[]>("achievements.json", []);
  }

  async saveAchievements(records: AchievementRecord[]): Promise<void> {
    await writeJson("achievements.json", records);
  }

  async addAchievement(record: AchievementRecord): Promise<void> {
    const records = await this.loadAchievements();
    records.push(record);
    await this.saveAchievements(records);
  }

  // === Members ===
  async loadMembers(): Promise<Member[]> {
    return readJson<Member[]>("members.json", []);
  }

  async saveMembers(members: Member[]): Promise<void> {
    await writeJson("members.json", members);
  }

  async addMember(member: Member): Promise<void> {
    const members = await this.loadMembers();
    members.push(member);
    await this.saveMembers(members);
  }

  // === Invites ===
  async loadInvites(): Promise<Invite[]> {
    return readJson<Invite[]>("invites.json", []);
  }

  async saveInvites(invites: Invite[]): Promise<void> {
    await writeJson("invites.json", invites);
  }

  async addInvite(invite: Invite): Promise<void> {
    const invites = await this.loadInvites();
    invites.push(invite);
    await this.saveInvites(invites);
  }

  // === Streaks ===
  async loadStreaks(): Promise<StreakData[]> {
    return readJson<StreakData[]>("streaks.json", []);
  }

  async saveStreaks(streaks: StreakData[]): Promise<void> {
    await writeJson("streaks.json", streaks);
  }

  async loadStreak(childName: string): Promise<StreakData | null> {
    const streaks = await this.loadStreaks();
    return streaks.find((s) => s.childName.toLowerCase() === childName.toLowerCase()) ?? null;
  }

  async initializeStreak(childName: string): Promise<void> {
    const streaks = await this.loadStreaks();
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
      await this.saveStreaks(streaks);
    }
  }

  async updateStreak(childName: string): Promise<StreakData> {
    const streaks = await this.loadStreaks();
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

    await this.saveStreaks(streaks);
    return streak;
  }

  // === Savings ===
  async loadSavingsEntries(childName?: string): Promise<SavingsEntry[]> {
    const all = await readJson<SavingsEntry[]>("savings.json", []);
    if (childName) {
      return all.filter((e) => e.childName.toLowerCase() === childName.toLowerCase());
    }
    return all;
  }

  async saveSavingsEntries(entries: SavingsEntry[]): Promise<void> {
    await writeJson("savings.json", entries);
  }

  async addSavingsEntry(entry: SavingsEntryInput): Promise<void> {
    const entries = await readJson<SavingsEntry[]>("savings.json", []);
    // Apply defaults for fields that have them
    const full: SavingsEntry = {
      asset: "USDC",
      released: false,
      multiplierAtDeposit: 1.0,
      converted: false,
      ...entry,
    } as SavingsEntry;
    entries.push(full);
    await this.saveSavingsEntries(entries);
  }

  // === Audit Log ===
  async loadAuditLog(): Promise<AuditEntry[]> {
    return readJson<AuditEntry[]>("audit-log.json", []);
  }

  async addAuditEntry(entry: AuditEntry): Promise<void> {
    const log = await this.loadAuditLog();
    log.push(entry);
    await writeJson("audit-log.json", log);
  }
}
