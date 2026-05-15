/**
 * Sprint 3.0.6 — `policyVersion` regression-bar tests (W1).
 *
 * Written FIRST per the harness pattern: they lock the contract before W2
 * touches the schema or the increment site.
 *
 *  - CP-VER1: bootstrap configure-policy → policyVersion === 1
 *  - CP-VER2: two consecutive configure-policy → policyVersion === 2 (++1)
 *  - CP-VER3: pre-3.0.6 family-config.json (missing field) → loads with 0
 *    via Zod default (lazy migration mirrors the Sprint 3.0.2
 *    `authorizedDestinations` precedent).
 *
 * Disk-shape-is-the-truth (Sprint 3.0.5 E-PB1). Every assertion loads via
 * `StateManager.loadFamilyConfig` rather than reading the configure return.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configureFamilyCore } from "../src/core/configure-family.js";
import { StateManager, getFamilyDir } from "../src/engine/state.js";
import { CHAIN_IDS, USDC, ROLES } from "../src/constants.js";
import type { ChildConfig } from "../src/schemas.js";
import type { CallerContext } from "../src/middleware/access-control.js";

const DATA_DIR = join(process.cwd(), "data");

function buildChild(name: string): ChildConfig {
  return {
    name,
    walletName: `child-${name.toLowerCase()}`,
    weeklyBudget: 15_000_000,
    categories: [
      { name: "education", pct: 50, budget: 7_500_000 },
      { name: "movement", pct: 50, budget: 7_500_000 },
    ],
    savingsPercent: 20,
    savingsLockDays: 90,
  };
}

describe("Sprint 3.0.6 — policyVersion regression bar (W1)", () => {
  beforeEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
    await mkdir(DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("CP-VER1: bootstrap configure-policy persists policyVersion === 1 (not 0)", async () => {
    const result = await configureFamilyCore(
      {
        familyName: "Garcia",
        children: [buildChild("Aiden")],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
      },
      null
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.bootstrap) {
      throw new Error("expected bootstrap success");
    }

    const state = new StateManager();
    const persisted = await state.loadFamilyConfig(result.familyId);
    expect(persisted).not.toBeNull();
    expect(persisted!.policyVersion).toBe(1);
  });

  it("CP-VER2: two consecutive configure-policy calls persist policyVersion === 2 (increments by exactly 1)", async () => {
    const bootstrap = await configureFamilyCore(
      {
        familyName: "Garcia",
        children: [buildChild("Aiden")],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
      },
      null
    );
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok || !bootstrap.bootstrap) {
      throw new Error("expected bootstrap success");
    }

    const state = new StateManager();
    const afterBootstrap = await state.loadFamilyConfig(bootstrap.familyId);
    expect(afterBootstrap!.policyVersion).toBe(1);

    const caller: CallerContext = {
      role: ROLES.MANAGER,
      memberId: bootstrap.memberId,
      familyId: bootstrap.familyId,
    };
    const update = await configureFamilyCore(
      {
        familyName: "Garcia Updated",
        children: [buildChild("Aiden"), buildChild("Maya")],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
      },
      caller
    );
    expect(update.ok).toBe(true);

    const afterUpdate = await state.loadFamilyConfig(bootstrap.familyId);
    expect(afterUpdate!.policyVersion).toBe(2);
  });

  it("CP-VER3: pre-3.0.6 family-config.json (missing policyVersion) loads with 0 via Zod default (lazy migration)", async () => {
    const FAMILY_ID = "c0000000-0000-0000-0000-000000000003";
    const state = new StateManager();
    await state.createFamilyDir(FAMILY_ID);

    // Hand-craft a pre-3.0.6 family-config.json — no policyVersion field.
    // Mirrors the on-disk shape that existed before this sprint touched
    // FamilyConfigSchema.
    const preSprint306Config = {
      familyId: FAMILY_ID,
      familyName: "Pre-3.0.6 Family",
      children: [
        {
          name: "Aiden",
          walletName: "child-aiden",
          weeklyBudget: 15_000_000,
          categories: [
            { name: "education", pct: 100, budget: 15_000_000 },
          ],
          savingsPercent: 20,
          savingsLockDays: 90,
        },
      ],
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      chainId: "eip155:84532",
      usdcAddress: USDC.BASE_SEPOLIA,
      authorizedDestinations: [],
    };
    await writeFile(
      join(getFamilyDir(FAMILY_ID), "family-config.json"),
      JSON.stringify(preSprint306Config, null, 2),
      "utf-8"
    );

    const loaded = await state.loadFamilyConfig(FAMILY_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.policyVersion).toBe(0);
  });
});
