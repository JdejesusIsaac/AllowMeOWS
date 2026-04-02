import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { StateManager } from "../src/engine/state.js";
import { randomUUID } from "node:crypto";

const testDataDir = join(process.cwd(), "data");

describe("StateManager", () => {
  let state: StateManager;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  // === Family Config ===
  describe("FamilyConfig", () => {
    it("returns null when no config exists", async () => {
      const config = await state.loadFamilyConfig();
      expect(config).toBeNull();
    });

    it("saves and loads family config", async () => {
      const config = {
        familyName: "TestFamily",
        children: [
          {
            name: "Maya",
            walletName: "child-maya",
            weeklyBudget: 15_000_000,
            categoryBudgets: { education: 5_000_000, health: 5_000_000, personal: 5_000_000 },
            savingsPercent: 20,
            savingsLockDays: 90,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        chainId: "eip155:84532",
        usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      };
      await state.saveFamilyConfig(config);
      const loaded = await state.loadFamilyConfig();
      expect(loaded).toEqual(config);
    });
  });

  // === Achievements ===
  describe("Achievements", () => {
    it("returns empty array when no achievements", async () => {
      const achievements = await state.loadAchievements();
      expect(achievements).toEqual([]);
    });

    it("adds and loads achievements", async () => {
      const record = {
        id: randomUUID(),
        childName: "Maya",
        category: "education" as const,
        description: "Finished math homework",
        score: 90,
        amount: 4_500_000,
        verifiedBy: "manager",
        verifiedAt: new Date().toISOString(),
        distributed: false,
      };
      await state.addAchievement(record);
      const loaded = await state.loadAchievements();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].childName).toBe("Maya");
      expect(loaded[0].amount).toBe(4_500_000);
    });

    it("accumulates multiple achievements", async () => {
      for (let i = 0; i < 3; i++) {
        await state.addAchievement({
          id: randomUUID(),
          childName: "Maya",
          category: "health" as const,
          description: `Achievement ${i}`,
          score: 80,
          amount: 4_000_000,
          verifiedBy: "manager",
          verifiedAt: new Date().toISOString(),
          distributed: false,
        });
      }
      const loaded = await state.loadAchievements();
      expect(loaded).toHaveLength(3);
    });
  });

  // === Members ===
  describe("Members", () => {
    it("adds and loads members", async () => {
      await state.addMember({
        id: randomUUID(),
        name: "Rosa",
        role: "family",
        joinedAt: new Date().toISOString(),
        active: true,
      });
      const members = await state.loadMembers();
      expect(members).toHaveLength(1);
      expect(members[0].name).toBe("Rosa");
      expect(members[0].role).toBe("family");
    });
  });

  // === Invites ===
  describe("Invites", () => {
    it("adds and loads invites", async () => {
      const now = new Date();
      await state.addInvite({
        code: "MAYA-GIFT-AB12",
        role: "family",
        childName: "Maya",
        familyId: "test",
        createdBy: "mgr",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
        used: false,
      });
      const invites = await state.loadInvites();
      expect(invites).toHaveLength(1);
      expect(invites[0].code).toBe("MAYA-GIFT-AB12");
    });
  });

  // === Streaks ===
  describe("Streaks", () => {
    it("initializes streak data", async () => {
      await state.initializeStreak("Maya");
      const streak = await state.loadStreak("Maya");
      expect(streak).not.toBeNull();
      expect(streak!.currentStreak).toBe(0);
      expect(streak!.multiplier).toBe(1.0);
    });

    it("does not duplicate on re-initialize", async () => {
      await state.initializeStreak("Maya");
      await state.initializeStreak("Maya");
      const all = await state.loadStreaks();
      const mayaStreaks = all.filter((s) => s.childName === "Maya");
      expect(mayaStreaks).toHaveLength(1);
    });

    it("updates streak on first activity", async () => {
      const streak = await state.updateStreak("Maya");
      expect(streak.currentStreak).toBe(1);
      expect(streak.lastActivityDate).toBeDefined();
    });

    it("increments weekly count on same day", async () => {
      const first = await state.updateStreak("Maya");
      const second = await state.updateStreak("Maya");
      expect(second.currentStreak).toBe(first.currentStreak); // same day, no streak change
      expect(second.weeklyAchievements).toBe(2);
    });

    it("case-insensitive child name lookup", async () => {
      await state.initializeStreak("Maya");
      const streak = await state.loadStreak("maya");
      expect(streak).not.toBeNull();
    });
  });

  // === Savings ===
  describe("Savings", () => {
    it("adds and loads savings entries", async () => {
      await state.addSavingsEntry({
        id: randomUUID(),
        childName: "Maya",
        amount: 1_000_000,
        depositedAt: new Date().toISOString(),
        lockUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        released: false,
        multiplierAtDeposit: 1.0,
      });
      const entries = await state.loadSavingsEntries("Maya");
      expect(entries).toHaveLength(1);
      expect(entries[0].amount).toBe(1_000_000);
    });

    it("filters savings by child name", async () => {
      await state.addSavingsEntry({
        id: randomUUID(),
        childName: "Maya",
        amount: 1_000_000,
        depositedAt: new Date().toISOString(),
        lockUntil: new Date().toISOString(),
        released: false,
        multiplierAtDeposit: 1.0,
      });
      await state.addSavingsEntry({
        id: randomUUID(),
        childName: "Alex",
        amount: 2_000_000,
        depositedAt: new Date().toISOString(),
        lockUntil: new Date().toISOString(),
        released: false,
        multiplierAtDeposit: 1.0,
      });
      const maya = await state.loadSavingsEntries("Maya");
      expect(maya).toHaveLength(1);
      const all = await state.loadSavingsEntries();
      expect(all).toHaveLength(2);
    });
  });

  // === Audit Log ===
  describe("AuditLog", () => {
    it("adds and loads audit entries", async () => {
      await state.addAuditEntry({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        action: "configure",
        actor: "manager",
        details: { familyName: "Test" },
      });
      const log = await state.loadAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe("configure");
    });
  });
});
