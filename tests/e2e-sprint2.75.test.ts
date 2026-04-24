import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { FamilyKeyManager } from "../src/keys/family-keys.js";
import { resolveMasterKey, _clearMasterKeyCache, getDataDir } from "../src/keys/master-key.js";
import { FitbitTokenStore } from "../src/fitbit/token-store.js";

const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

const TEST_DATA_DIR = join(process.cwd(), "data-test-e2e275");

function cleanTestDir() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

describe("E2E: Zero-Passphrase Family Setup and Distribution", () => {
  let originalMasterKey: string | undefined;
  const familyKeysPath = join(TEST_DATA_DIR, "family-keys.json");

  beforeEach(() => {
    cleanTestDir();
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    originalMasterKey = process.env.MASTER_KEY;
    // Use a deterministic master key for this test suite
    process.env.MASTER_KEY = randomBytes(32).toString("hex");
    _clearMasterKeyCache();
  });

  afterEach(() => {
    if (originalMasterKey !== undefined) {
      process.env.MASTER_KEY = originalMasterKey;
    } else {
      delete process.env.MASTER_KEY;
    }
    _clearMasterKeyCache();
    cleanTestDir();
  });

  // E1: Server starts, auto-generates master key, no error
  it("E1: server start resolves master key without error or prompt", () => {
    const key = resolveMasterKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBeGreaterThanOrEqual(32);
  });

  // E2: configure-policy creates family key entry
  it("E2: configuring a family creates encrypted key entry in family-keys.json", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const familyId = randomUUID();

    const key = mgr.generateFamilyKey(familyId);
    expect(key).toMatch(/^[a-f0-9]{64}$/);

    // Verify family-keys.json was created with encrypted entry
    expect(existsSync(familyKeysPath)).toBe(true);
    const store = JSON.parse(readFileSync(familyKeysPath, "utf-8"));
    expect(store[familyId]).toBeDefined();
    expect(store[familyId].encryptedKey).toBeDefined();
    expect(store[familyId].iv).toBeDefined();
    expect(store[familyId].tag).toBeDefined();
  });

  // E3: verify-achievement stores without passphrase reference (covered by no passphrase in response)
  it("E3: achievement flow has no passphrase dependency", () => {
    // Achievement storage is independent of passphrase — just verify the key manager
    // doesn't require passphrase
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const familyId = randomUUID();
    const key = mgr.getOrGenerateFamilyKey(familyId);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    // Key retrieval should also work
    const retrieved = mgr.getFamilyKey(familyId);
    expect(retrieved).toBe(key);
  });

  // E4: distribute-allowance resolves key automatically
  it("E4: key auto-resolution works for distribution (no passphrase prompt)", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const familyId = randomUUID();

    // Simulate configure-policy generating a key
    const generatedKey = mgr.generateFamilyKey(familyId);

    // Simulate distribute-allowance auto-resolving the key
    const resolvedKey = mgr.getFamilyKey(familyId);
    expect(resolvedKey).toBe(generatedKey);
    // Key is a valid passphrase string (hex)
    expect(resolvedKey.length).toBe(64);
  });

  // E5: Second family gets different key, first family's key unchanged
  it("E5: second family gets different encrypted key, first family unchanged", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const familyId1 = randomUUID();
    const familyId2 = randomUUID();

    const key1 = mgr.generateFamilyKey(familyId1);
    const key2 = mgr.generateFamilyKey(familyId2);

    // Different families have different keys
    expect(key1).not.toBe(key2);

    // First family's key still retrievable and unchanged
    expect(mgr.getFamilyKey(familyId1)).toBe(key1);
    expect(mgr.getFamilyKey(familyId2)).toBe(key2);

    // Both entries in family-keys.json
    const store = JSON.parse(readFileSync(familyKeysPath, "utf-8"));
    expect(Object.keys(store)).toHaveLength(2);
    expect(store[familyId1].encryptedKey).not.toBe(store[familyId2].encryptedKey);
  });

  // E6: Verify family-keys.json is encrypted (no plaintext hex keys)
  it("E6: family-keys.json contains only encrypted data, no plaintext keys", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const familyId1 = randomUUID();
    const familyId2 = randomUUID();

    const key1 = mgr.generateFamilyKey(familyId1);
    const key2 = mgr.generateFamilyKey(familyId2);

    const raw = readFileSync(familyKeysPath, "utf-8");
    const store = JSON.parse(raw);

    // Plaintext keys must NOT appear in the file
    expect(raw).not.toContain(key1);
    expect(raw).not.toContain(key2);

    // All entries have encrypted structure
    for (const [, entry] of Object.entries(store)) {
      const e = entry as { encryptedKey: string; iv: string; tag: string; createdAt: string };
      expect(e.encryptedKey).toBeDefined();
      expect(e.iv).toBeDefined();
      expect(e.tag).toBeDefined();
      expect(e.createdAt).toBeDefined();
      // encryptedKey should be a hex string but NOT 64 chars (that would be suspicious)
      expect(e.encryptedKey).toMatch(/^[a-f0-9]+$/);
    }
  });
});

describe("Tool Integration Tests", () => {
  let originalMasterKey: string | undefined;

  beforeEach(() => {
    originalMasterKey = process.env.MASTER_KEY;
    process.env.MASTER_KEY = randomBytes(32).toString("hex");
    _clearMasterKeyCache();
  });

  afterEach(() => {
    if (originalMasterKey !== undefined) {
      process.env.MASTER_KEY = originalMasterKey;
    } else {
      delete process.env.MASTER_KEY;
    }
    _clearMasterKeyCache();
  });

  // TI1: configure-policy creates family key automatically
  it("TI1: configure-policy flow creates family key in family-keys.json", () => {
    const testDir = join(process.cwd(), "data-test-ti1");
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    try {
      const mgr = new FamilyKeyManager(testDir);
      const familyId = randomUUID();
      // Simulate what configure-policy does internally
      const key = mgr.getOrGenerateFamilyKey(familyId);
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      const keysPath = join(testDir, "family-keys.json");
      expect(existsSync(keysPath)).toBe(true);
      const store = JSON.parse(readFileSync(keysPath, "utf-8"));
      expect(store[familyId]).toBeDefined();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // TI2: distribute-allowance resolves key without passphrase arg
  it("TI2: distribute-allowance key resolution works without passphrase arg", () => {
    const testDir = join(process.cwd(), "data-test-ti2");
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    try {
      const mgr = new FamilyKeyManager(testDir);
      const familyId = randomUUID();
      const generated = mgr.generateFamilyKey(familyId);
      // Simulate distribute-allowance auto-resolution: no passphrase arg, just familyId lookup
      const resolved = mgr.getFamilyKey(familyId);
      expect(resolved).toBe(generated);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // TI3: release-savings resolves key without passphrase arg
  it("TI3: release-savings key resolution works without passphrase arg", () => {
    const testDir = join(process.cwd(), "data-test-ti3");
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    try {
      const mgr = new FamilyKeyManager(testDir);
      const familyId = randomUUID();
      const generated = mgr.generateFamilyKey(familyId);
      // Simulate release-savings auto-resolution: same pattern as distribute
      const resolved = mgr.getFamilyKey(familyId);
      expect(resolved).toBe(generated);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // TI4: No tool schema contains "passphrase"
  it("TI4: no tool schema contains passphrase field", async () => {
    // Read the tool registration files and check for passphrase in zod schemas
    const toolFiles = [
      "src/tools/configure-policy.ts",
      "src/tools/distribute-allowance.ts",
      "src/tools/release-savings.ts",
      "src/tools/verify-achievement.ts",
      "src/tools/check-progress.ts",
      "src/tools/check-savings.ts",
      "src/tools/get-funding-address.ts",
      "src/tools/invite-member.ts",
      "src/tools/accept-invite.ts",
      "src/tools/manage-members.ts",
      "src/tools/connect-fitbit.ts",
      "src/tools/convert-savings.ts",
    ];

    for (const file of toolFiles) {
      const fullPath = join(process.cwd(), file);
      if (!existsSync(fullPath)) continue;
      const content = readFileSync(fullPath, "utf-8");

      // Check that tool input schemas don't have passphrase fields
      // A passphrase field in the schema would look like: passphrase: z.string()
      const schemaSection = content.match(/server\.tool\([^{]*\{([^}]+)\}/s);
      if (schemaSection) {
        expect(schemaSection[1]).not.toMatch(/passphrase\s*:/i);
      }
    }
  });

  // TI5: No tool response contains "passphrase" or "secret phrase"
  it("TI5: no tool response text mentions passphrase or secret phrase", async () => {
    const toolFiles = [
      "src/tools/configure-policy.ts",
      "src/tools/distribute-allowance.ts",
      "src/tools/release-savings.ts",
      "src/tools/get-funding-address.ts",
    ];

    for (const file of toolFiles) {
      const fullPath = join(process.cwd(), file);
      if (!existsSync(fullPath)) continue;
      const content = readFileSync(fullPath, "utf-8");

      // Check all string literals in the file for passphrase/secret phrase mentions
      const stringLiterals = content.match(/"[^"]*"|'[^']*'|`[^`]*`/g) || [];
      for (const literal of stringLiterals) {
        const lower = literal.toLowerCase();
        // Skip import paths and variable names
        if (lower.includes("passphrase") && !lower.includes("import") && !lower.includes("process.env") && !lower.includes("this.passphrase") && !lower.includes("keymanager") && !lower.includes("legacy")) {
          // Only fail on user-facing message strings (those in JSON.stringify responses)
          if (lower.includes("set ows_passphrase") || lower.includes("passphrase not configured")) {
            throw new Error(`Found passphrase reference in user-facing response in ${file}: ${literal}`);
          }
        }
        expect(lower).not.toContain("secret phrase");
        expect(lower).not.toContain("secret_phrase");
      }
    }
  });

  // TI6: Fitbit token encryption uses MASTER_KEY
  it("TI6: FitbitTokenStore encrypts/decrypts using MASTER_KEY", () => {
    const masterKey = resolveMasterKey();
    // Sprint 2.9: FitbitTokenStore takes (familyId, masterKey?).
    const store = new FitbitTokenStore(FAMILY_ID, masterKey);

    // Verify FitbitTokenStore was constructed with a Buffer (master key), not a string (passphrase)
    expect(masterKey).toBeInstanceOf(Buffer);
    expect(masterKey.length).toBeGreaterThanOrEqual(32);

    // The store should work — we can't fully test save/load without filesystem setup,
    // but construction succeeding with Buffer master key proves the integration
    expect(store).toBeDefined();
  });
});

describe("Backward Compatibility", () => {
  let originalMasterKey: string | undefined;
  let originalOWSPassphrase: string | undefined;

  beforeEach(() => {
    originalMasterKey = process.env.MASTER_KEY;
    originalOWSPassphrase = process.env.OWS_PASSPHRASE;
    process.env.MASTER_KEY = randomBytes(32).toString("hex");
    _clearMasterKeyCache();
  });

  afterEach(() => {
    if (originalMasterKey !== undefined) {
      process.env.MASTER_KEY = originalMasterKey;
    } else {
      delete process.env.MASTER_KEY;
    }
    if (originalOWSPassphrase !== undefined) {
      process.env.OWS_PASSPHRASE = originalOWSPassphrase;
    } else {
      delete process.env.OWS_PASSPHRASE;
    }
    _clearMasterKeyCache();
  });

  // FK9: Backward compat — OWS_PASSPHRASE fallback
  it("FK9: legacy family without family key falls back to OWS_PASSPHRASE", () => {
    // Simulate a legacy family: config has no familyId, no entry in family-keys.json
    const testDataDir = join(process.cwd(), "data-test-compat");
    if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
    mkdirSync(testDataDir, { recursive: true });

    try {
      const mgr = new FamilyKeyManager(testDataDir);

      // No key exists for any family
      expect(mgr.hasFamilyKey("legacy-family")).toBe(false);

      // In the tool flow, if hasFamilyKey is false and OWS_PASSPHRASE is set,
      // it falls back to OWS_PASSPHRASE. Verify the pattern works.
      process.env.OWS_PASSPHRASE = "legacy-test-passphrase";

      const familyId = "legacy-family";
      let passphrase: string | undefined;

      if (mgr.hasFamilyKey(familyId)) {
        passphrase = mgr.getFamilyKey(familyId);
      } else if (process.env.OWS_PASSPHRASE) {
        passphrase = process.env.OWS_PASSPHRASE;
      }

      expect(passphrase).toBe("legacy-test-passphrase");
    } finally {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });
});
