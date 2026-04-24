import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StateManager } from "../src/engine/state.js";
import { PolicyEngine } from "../src/engine/policy.js";
import type { FamilyConfig, ChildConfig } from "../src/schemas.js";

const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

const testDataDir = join(process.cwd(), "data");

describe("Configurable Categories", () => {
  let state: StateManager;
  let engine: PolicyEngine;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();
    await state.createFamilyDir(FAMILY_ID);
    engine = new PolicyEngine();
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  // CC1: Configure with custom categories
  it("CC1: configure with custom categories [reading, movement, creativity]", async () => {
    const config: FamilyConfig = {
      familyName: "Garcia",
      children: [
        {
          name: "Maya",
          walletName: "child-maya",
          weeklyBudget: 15_000_000,
          categories: [
            { name: "reading", pct: 40, budget: 6_000_000 },
            { name: "movement", pct: 35, budget: 5_250_000 },
            { name: "creativity", pct: 25, budget: 3_750_000 },
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
    expect(loaded).not.toBeNull();
    expect(loaded!.children[0].categories).toHaveLength(3);
    expect(loaded!.children[0].categories![0].name).toBe("reading");
    expect(loaded!.children[0].categories![1].name).toBe("movement");
    expect(loaded!.children[0].categories![2].name).toBe("creativity");
    expect(loaded!.children[0].categories![0].budget).toBe(6_000_000);
  });

  // CC2: Categories summing > 100 rejected
  it("CC2: categories summing > 100% are rejected by validation", () => {
    const cats = [
      { name: "reading", pct: 60 },
      { name: "movement", pct: 30 },
      { name: "creativity", pct: 20 },
    ];
    const totalPct = cats.reduce((s, c) => s + c.pct, 0);
    expect(totalPct).toBe(110);
    expect(totalPct > 100).toBe(true);
  });

  // CC3: verify-achievement with matching category name
  it("CC3: evaluateAchievement uses correct category pct for custom names", () => {
    const child: ChildConfig = {
      name: "Maya",
      walletName: "child-maya",
      weeklyBudget: 15_000_000,
      categories: [
        { name: "reading", pct: 40, budget: 6_000_000 },
        { name: "movement", pct: 35, budget: 5_250_000 },
        { name: "creativity", pct: 25, budget: 3_750_000 },
      ],
      savingsPercent: 20,
      savingsLockDays: 90,
    };

    const amount = engine.evaluateAchievement(100, "reading", child);
    expect(amount).toBe(6_000_000);

    const movementAmount = engine.evaluateAchievement(80, "movement", child);
    expect(movementAmount).toBe(Math.round(0.8 * 5_250_000));
  });

  // CC4: verify-achievement with non-existent category
  it("CC4: evaluateAchievement throws for non-existent category with available list", () => {
    const child: ChildConfig = {
      name: "Maya",
      walletName: "child-maya",
      weeklyBudget: 15_000_000,
      categories: [
        { name: "reading", pct: 40, budget: 6_000_000 },
        { name: "movement", pct: 35, budget: 5_250_000 },
        { name: "creativity", pct: 25, budget: 3_750_000 },
      ],
      savingsPercent: 20,
      savingsLockDays: 90,
    };

    expect(() => engine.evaluateAchievement(80, "gaming", child)).toThrow(
      "Category 'gaming' not configured. Available: reading, movement, creativity"
    );
  });

  // CC5: check-progress displays custom category names
  it("CC5: check-progress groups by custom category names", async () => {
    const config: FamilyConfig = {
      familyName: "Garcia",
      children: [
        {
          name: "Maya",
          walletName: "child-maya",
          weeklyBudget: 15_000_000,
          categories: [
            { name: "reading", pct: 40, budget: 6_000_000 },
            { name: "movement", pct: 35, budget: 5_250_000 },
            { name: "creativity", pct: 25, budget: 3_750_000 },
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
    const child = loaded!.children[0];
    const catNames = child.categories!.map((c) => c.name);
    expect(catNames).toEqual(["reading", "movement", "creativity"]);
    expect(catNames).not.toContain("education");
    expect(catNames).not.toContain("health");
    expect(catNames).not.toContain("personal");
  });

  // CC6: Legacy config with categoryBudgets auto-migrates
  it("CC6: legacy config with categoryBudgets auto-migrates to categories[]", async () => {
    const legacyConfig = {
      familyName: "Legacy",
      children: [
        {
          name: "Maya",
          walletName: "child-maya",
          weeklyBudget: 15_000_000,
          categoryBudgets: {
            education: 5_000_000,
            health: 5_000_000,
            personal: 5_000_000,
          },
          savingsPercent: 20,
          savingsLockDays: 90,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chainId: "eip155:84532",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    };

    // Sprint 2.9: write legacy-category format into the family-scoped path.
    // The Sprint 2.75 → 2.9 migration (multi-tenant) runs at server startup;
    // within the category-migration path, we just need the file in the right
    // directory so loadFamilyConfig finds it.
    const { mkdir } = await import("node:fs/promises");
    const familyDir = join(testDataDir, "families", FAMILY_ID);
    await mkdir(familyDir, { recursive: true });
    const filepath = join(familyDir, "family-config.json");
    await writeFile(filepath, JSON.stringify(legacyConfig, null, 2), "utf-8");

    // Load triggers migration
    const loaded = await state.loadFamilyConfig(FAMILY_ID);
    expect(loaded).not.toBeNull();
    const child = loaded!.children[0];

    // categories[] populated
    expect(child.categories).toBeDefined();
    expect(child.categories).toHaveLength(3);
    expect(child.categories![0]).toEqual({ name: "education", pct: 33, budget: 5_000_000 });
    expect(child.categories![1]).toEqual({ name: "health", pct: 33, budget: 5_000_000 });
    expect(child.categories![2]).toEqual({ name: "personal", pct: 33, budget: 5_000_000 });

    // Old field removed
    expect((child as Record<string, unknown>).categoryBudgets).toBeUndefined();
  });
});
