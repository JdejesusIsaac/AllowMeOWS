import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateManager, getDataDir, getFamilyDir } from "../src/engine/state.js";
import { MemberIndex } from "../src/identity/member-index.js";

const testDataDir = join(process.cwd(), "data");

const FAMILY_A = "aaaaaaaa-0000-0000-0000-000000000001";
const FAMILY_B = "bbbbbbbb-0000-0000-0000-000000000002";

describe("MT: Multi-tenant StateManager (Sprint 2.9)", () => {
  let state: StateManager;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    state = new StateManager();
    await state.createFamilyDir(FAMILY_A);
    await state.createFamilyDir(FAMILY_B);
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("MT1: loadFamilyConfig returns only that family's config", async () => {
    const configA = {
      familyId: FAMILY_A,
      familyName: "Alice",
      children: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chainId: "eip155:84532",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    };
    const configB = { ...configA, familyId: FAMILY_B, familyName: "Bob" };

    await state.saveFamilyConfig(FAMILY_A, configA);
    await state.saveFamilyConfig(FAMILY_B, configB);

    const loadedA = await state.loadFamilyConfig(FAMILY_A);
    const loadedB = await state.loadFamilyConfig(FAMILY_B);

    expect(loadedA?.familyName).toBe("Alice");
    expect(loadedB?.familyName).toBe("Bob");
    expect(loadedA?.familyId).not.toBe(loadedB?.familyId);
  });

  it("MT2: saveFamilyConfig writes to correct directory", async () => {
    const config = {
      familyId: FAMILY_A,
      familyName: "Alice",
      children: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chainId: "eip155:84532",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    };
    await state.saveFamilyConfig(FAMILY_A, config);

    const familyScopedPath = join(getFamilyDir(FAMILY_A), "family-config.json");
    const legacyPath = join(getDataDir(), "family-config.json");
    expect(existsSync(familyScopedPath)).toBe(true);
    expect(existsSync(legacyPath)).toBe(false);
  });

  it("MT3: loadMembers returns only that family's members", async () => {
    await state.addMember(FAMILY_A, {
      id: randomUUID(),
      name: "Alice Manager",
      role: "manager",
      joinedAt: new Date().toISOString(),
      active: true,
    });
    await state.addMember(FAMILY_B, {
      id: randomUUID(),
      name: "Bob Manager",
      role: "manager",
      joinedAt: new Date().toISOString(),
      active: true,
    });

    const membersA = await state.loadMembers(FAMILY_A);
    const membersB = await state.loadMembers(FAMILY_B);

    expect(membersA).toHaveLength(1);
    expect(membersB).toHaveLength(1);
    expect(membersA[0].name).toBe("Alice Manager");
    expect(membersB[0].name).toBe("Bob Manager");
    expect(membersA[0].id).not.toBe(membersB[0].id);
  });

  it("MT4: addAchievement appends to correct family only", async () => {
    const record = {
      id: randomUUID(),
      childName: "Maya",
      category: "education",
      description: "math hw",
      score: 90,
      amount: 4_500_000,
      source: "manual" as const,
      verifiedBy: "alice",
      verifiedAt: new Date().toISOString(),
      distributed: false,
    };
    await state.addAchievement(FAMILY_A, record);

    const achsA = await state.loadAchievements(FAMILY_A);
    const achsB = await state.loadAchievements(FAMILY_B);
    expect(achsA).toHaveLength(1);
    expect(achsB).toHaveLength(0);
  });

  it("MT5: createFamilyDir creates directory with 0o700 permissions", async () => {
    const ephemeralFamilyId = "cccccccc-0000-0000-0000-000000000003";
    await state.createFamilyDir(ephemeralFamilyId);
    const dir = getFamilyDir(ephemeralFamilyId);
    const s = await stat(dir);
    const mode = s.mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("MT6: listFamilies returns all familyIds under data/families/", async () => {
    const families = await state.listFamilies();
    expect(families.sort()).toEqual([FAMILY_A, FAMILY_B].sort());
  });

  it("MT7: concurrent writes to different families do not interfere", async () => {
    const ids = Array.from({ length: 10 }, (_, i) =>
      `dddddddd-0000-0000-0000-${String(i).padStart(12, "0")}`
    );
    await Promise.all(ids.map((id) => state.createFamilyDir(id)));
    await Promise.all(
      ids.map((id) =>
        state.saveFamilyConfig(id, {
          familyId: id,
          familyName: `Family ${id.slice(-3)}`,
          children: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          chainId: "eip155:84532",
          usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        })
      )
    );

    for (const id of ids) {
      const cfg = await state.loadFamilyConfig(id);
      expect(cfg?.familyId).toBe(id);
    }
  });

  it("MT8: reading a nonexistent family returns fallback (null or empty)", async () => {
    const nonexistent = "ffffffff-0000-0000-0000-000000000009";
    const cfg = await state.loadFamilyConfig(nonexistent);
    const members = await state.loadMembers(nonexistent);
    const achs = await state.loadAchievements(nonexistent);
    expect(cfg).toBeNull();
    expect(members).toEqual([]);
    expect(achs).toEqual([]);
  });

  it("familyExists returns true/false correctly", async () => {
    // FAMILY_A has directory but no config yet
    expect(await state.familyExists(FAMILY_A)).toBe(false);
    await state.saveFamilyConfig(FAMILY_A, {
      familyId: FAMILY_A,
      familyName: "X",
      children: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chainId: "eip155:84532",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    });
    expect(await state.familyExists(FAMILY_A)).toBe(true);
    expect(await state.familyExists("unknown-id")).toBe(false);
  });
});

describe("MI: MemberIndex (Sprint 2.9)", () => {
  let index: MemberIndex;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    index = new MemberIndex();
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
  });

  it("MI1: set persists to member-index.json", async () => {
    const memberId = randomUUID();
    await index.set(memberId, FAMILY_A, "manager");
    const indexPath = join(testDataDir, "member-index.json");
    expect(existsSync(indexPath)).toBe(true);
  });

  it("MI2: get returns the stored entry", async () => {
    const memberId = randomUUID();
    await index.set(memberId, FAMILY_A, "co-parent");
    const entry = await index.get(memberId);
    expect(entry).toEqual({ familyId: FAMILY_A, role: "co-parent" });
  });

  it("MI3: get for unknown memberId returns null", async () => {
    const entry = await index.get("unknown-id");
    expect(entry).toBeNull();
  });

  it("MI4: remove deletes the entry", async () => {
    const memberId = randomUUID();
    await index.set(memberId, FAMILY_A, "manager");
    await index.remove(memberId);
    const entry = await index.get(memberId);
    expect(entry).toBeNull();
  });

  it("MI5: list returns all entries", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) await index.set(id, FAMILY_A, "manager");
    const all = await index.list();
    expect(Object.keys(all)).toHaveLength(5);
  });

  it("MI6: concurrent set calls for different memberIds do not race", async () => {
    const ids = Array.from({ length: 10 }, () => randomUUID());
    await Promise.all(ids.map((id) => index.set(id, FAMILY_A, "manager")));
    const all = await index.list();
    expect(Object.keys(all)).toHaveLength(10);
  });

  it("MI7: member-index.json file permissions are 0o600", async () => {
    await index.set(randomUUID(), FAMILY_A, "manager");
    const indexPath = join(testDataDir, "member-index.json");
    const s = await stat(indexPath);
    const mode = s.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("listByFamily returns only members of the given family", async () => {
    const m1 = randomUUID();
    const m2 = randomUUID();
    const m3 = randomUUID();
    await index.set(m1, FAMILY_A, "manager");
    await index.set(m2, FAMILY_A, "co-parent");
    await index.set(m3, FAMILY_B, "manager");

    const inA = await index.listByFamily(FAMILY_A);
    const inB = await index.listByFamily(FAMILY_B);
    expect(inA).toHaveLength(2);
    expect(inB).toHaveLength(1);
    expect(inA.map((x) => x.memberId).sort()).toEqual([m1, m2].sort());
    expect(inB[0].memberId).toBe(m3);
  });
});
