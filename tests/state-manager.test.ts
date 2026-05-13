import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { StateManager } from "../src/engine/state.js";
import { randomUUID } from "node:crypto";

const testDataDir = join(process.cwd(), "data");
const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

describe("StateManager", () => {
  let state: StateManager;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();
    await state.createFamilyDir(FAMILY_ID);
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  // === Family Config ===
  describe("FamilyConfig", () => {
    it("returns null when no config exists", async () => {
      const config = await state.loadFamilyConfig(FAMILY_ID);
      expect(config).toBeNull();
    });

    it("saves and loads family config", async () => {
      const config = {
        familyId: FAMILY_ID,
        familyName: "TestFamily",
        children: [
          {
            name: "Maya",
            walletName: "child-maya",
            weeklyBudget: 15_000_000,
            categories: [
              { name: "education", pct: 33, budget: 5_000_000 },
              { name: "health", pct: 33, budget: 5_000_000 },
              { name: "personal", pct: 33, budget: 5_000_000 },
            ],
            savingsPercent: 20,
            savingsLockDays: 90,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        chainId: "eip155:84532",
        usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      };
      await state.saveFamilyConfig(FAMILY_ID, config);
      const loaded = await state.loadFamilyConfig(FAMILY_ID);
      // Sprint 3.0.2 — `loadFamilyConfig` now applies Zod schema defaults
      // so pre-3.0.2 configs missing `authorizedDestinations` load with
      // `[]`. The save→load round-trip is still identity-preserving on
      // every field that was actually written.
      expect(loaded).toEqual({ ...config, authorizedDestinations: [] });
    });
  });

  // === Achievements ===
  describe("Achievements", () => {
    it("returns empty array when no achievements", async () => {
      const achievements = await state.loadAchievements(FAMILY_ID);
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
        source: "manual" as const,
        verifiedBy: "manager",
        verifiedAt: new Date().toISOString(),
        distributed: false,
      };
      await state.addAchievement(FAMILY_ID, record);
      const loaded = await state.loadAchievements(FAMILY_ID);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].childName).toBe("Maya");
      expect(loaded[0].amount).toBe(4_500_000);
    });

    it("accumulates multiple achievements", async () => {
      for (let i = 0; i < 3; i++) {
        await state.addAchievement(FAMILY_ID, {
          id: randomUUID(),
          childName: "Maya",
          category: "health" as const,
          description: `Achievement ${i}`,
          score: 80,
          amount: 4_000_000,
          source: "manual" as const,
          verifiedBy: "manager",
          verifiedAt: new Date().toISOString(),
          distributed: false,
        });
      }
      const loaded = await state.loadAchievements(FAMILY_ID);
      expect(loaded).toHaveLength(3);
    });
  });

  // === Members ===
  describe("Members", () => {
    it("adds and loads members", async () => {
      await state.addMember(FAMILY_ID, {
        id: randomUUID(),
        name: "Rosa",
        role: "family",
        joinedAt: new Date().toISOString(),
        active: true,
      });
      const members = await state.loadMembers(FAMILY_ID);
      expect(members).toHaveLength(1);
      expect(members[0].name).toBe("Rosa");
      expect(members[0].role).toBe("family");
    });
  });

  // === Invites ===
  describe("Invites", () => {
    it("adds and loads invites", async () => {
      const now = new Date();
      await state.addInvite(FAMILY_ID, {
        code: "MAYA-GIFT-AB12",
        role: "family",
        childName: "Maya",
        familyId: FAMILY_ID,
        createdBy: "mgr",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
        used: false,
      });
      const invites = await state.loadInvites(FAMILY_ID);
      expect(invites).toHaveLength(1);
      expect(invites[0].code).toBe("MAYA-GIFT-AB12");
    });
  });

  // === Streaks ===
  describe("Streaks", () => {
    it("initializes streak data", async () => {
      await state.initializeStreak(FAMILY_ID, "Maya");
      const streak = await state.loadStreak(FAMILY_ID, "Maya");
      expect(streak).not.toBeNull();
      expect(streak!.currentStreak).toBe(0);
      expect(streak!.multiplier).toBe(1.0);
    });

    it("does not duplicate on re-initialize", async () => {
      await state.initializeStreak(FAMILY_ID, "Maya");
      await state.initializeStreak(FAMILY_ID, "Maya");
      const all = await state.loadStreaks(FAMILY_ID);
      const mayaStreaks = all.filter((s) => s.childName === "Maya");
      expect(mayaStreaks).toHaveLength(1);
    });

    it("updates streak on first activity", async () => {
      const streak = await state.updateStreak(FAMILY_ID, "Maya");
      expect(streak.currentStreak).toBe(1);
      expect(streak.lastActivityDate).toBeDefined();
    });

    it("increments weekly count on same day", async () => {
      const first = await state.updateStreak(FAMILY_ID, "Maya");
      const second = await state.updateStreak(FAMILY_ID, "Maya");
      expect(second.currentStreak).toBe(first.currentStreak); // same day, no streak change
      expect(second.weeklyAchievements).toBe(2);
    });

    it("case-insensitive child name lookup", async () => {
      await state.initializeStreak(FAMILY_ID, "Maya");
      const streak = await state.loadStreak(FAMILY_ID, "maya");
      expect(streak).not.toBeNull();
    });
  });

  // === Savings ===
  describe("Savings", () => {
    it("adds and loads savings entries", async () => {
      await state.addSavingsEntry(FAMILY_ID, {
        id: randomUUID(),
        childName: "Maya",
        amount: 1_000_000,
        depositedAt: new Date().toISOString(),
        lockUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        released: false,
        multiplierAtDeposit: 1.0,
      });
      const entries = await state.loadSavingsEntries(FAMILY_ID, "Maya");
      expect(entries).toHaveLength(1);
      expect(entries[0].amount).toBe(1_000_000);
    });

    it("filters savings by child name", async () => {
      await state.addSavingsEntry(FAMILY_ID, {
        id: randomUUID(),
        childName: "Maya",
        amount: 1_000_000,
        depositedAt: new Date().toISOString(),
        lockUntil: new Date().toISOString(),
        released: false,
        multiplierAtDeposit: 1.0,
      });
      await state.addSavingsEntry(FAMILY_ID, {
        id: randomUUID(),
        childName: "Alex",
        amount: 2_000_000,
        depositedAt: new Date().toISOString(),
        lockUntil: new Date().toISOString(),
        released: false,
        multiplierAtDeposit: 1.0,
      });
      const maya = await state.loadSavingsEntries(FAMILY_ID, "Maya");
      expect(maya).toHaveLength(1);
      const all = await state.loadSavingsEntries(FAMILY_ID);
      expect(all).toHaveLength(2);
    });
  });

  // === Audit Log ===
  describe("AuditLog", () => {
    it("adds and loads audit entries", async () => {
      await state.addAuditEntry(FAMILY_ID, {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        action: "configure",
        actor: "manager",
        details: { familyName: "Test" },
      });
      const log = await state.loadAuditLog(FAMILY_ID);
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe("configure");
    });
  });
});
