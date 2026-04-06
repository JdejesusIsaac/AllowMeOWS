import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { FamilyKeyManager } from "../src/keys/family-keys.js";
import { resolveMasterKey, _clearMasterKeyCache, getDataDir } from "../src/keys/master-key.js";

const TEST_DATA_DIR = join(process.cwd(), "data-test-fk");

function cleanTestDir() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

describe("FamilyKeyManager", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    cleanTestDir();
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    originalEnv = process.env.MASTER_KEY;
    // Set a deterministic master key for testing
    process.env.MASTER_KEY = randomBytes(32).toString("hex");
    _clearMasterKeyCache();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MASTER_KEY = originalEnv;
    } else {
      delete process.env.MASTER_KEY;
    }
    _clearMasterKeyCache();
    cleanTestDir();
  });

  // FK1: Generate family key produces 256-bit key
  it("FK1: generateFamilyKey returns a 64-char hex string (256-bit key)", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const key = mgr.generateFamilyKey("family-a");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(key, "hex").length).toBe(32);
  });

  // FK2: Generated key is stored encrypted in family-keys.json
  it("FK2: stored key is encrypted (not plaintext) in family-keys.json", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const plainKey = mgr.generateFamilyKey("family-b");

    const filePath = join(TEST_DATA_DIR, "family-keys.json");
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, "utf-8");
    const store = JSON.parse(raw);

    // The file should NOT contain the plaintext key
    expect(raw).not.toContain(plainKey);

    // Should have encrypted structure
    const entry = store["family-b"];
    expect(entry).toBeDefined();
    expect(entry.encryptedKey).toBeDefined();
    expect(entry.iv).toBeDefined();
    expect(entry.tag).toBeDefined();
    expect(entry.createdAt).toBeDefined();
  });

  // FK3: Retrieve key returns same key that was generated
  it("FK3: getFamilyKey returns the same key that was generated", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const original = mgr.generateFamilyKey("family-c");
    const retrieved = mgr.getFamilyKey("family-c");
    expect(retrieved).toBe(original);
  });

  // FK4: Different families get different keys
  it("FK4: different families get different keys", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const keyA = mgr.generateFamilyKey("family-alpha");
    const keyB = mgr.generateFamilyKey("family-beta");
    expect(keyA).not.toBe(keyB);
  });

  // FK5: Key not found returns clear error
  it("FK5: getFamilyKey throws descriptive error for nonexistent family", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    expect(() => mgr.getFamilyKey("nonexistent")).toThrow(
      /Family wallet not initialized.*No key found for family "nonexistent"/
    );
  });

  // FK8: Wrong master key fails decryption
  it("FK8: decryption fails if master key changes", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    mgr.generateFamilyKey("family-d");

    // Change master key
    process.env.MASTER_KEY = randomBytes(32).toString("hex");
    _clearMasterKeyCache();

    const mgr2 = new FamilyKeyManager(TEST_DATA_DIR);
    expect(() => mgr2.getFamilyKey("family-d")).toThrow(
      /Failed to decrypt family key/
    );
  });

  // hasFamilyKey
  it("hasFamilyKey returns true for existing, false for missing", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    expect(mgr.hasFamilyKey("family-e")).toBe(false);
    mgr.generateFamilyKey("family-e");
    expect(mgr.hasFamilyKey("family-e")).toBe(true);
  });

  // getOrGenerateFamilyKey
  it("getOrGenerateFamilyKey generates on first call, retrieves on second", () => {
    const mgr = new FamilyKeyManager(TEST_DATA_DIR);
    const key1 = mgr.getOrGenerateFamilyKey("family-f");
    const key2 = mgr.getOrGenerateFamilyKey("family-f");
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("resolveMasterKey", () => {
  let originalEnv: string | undefined;
  const dataDir = getDataDir();
  const masterKeyFile = join(dataDir, ".master-key");

  beforeEach(() => {
    originalEnv = process.env.MASTER_KEY;
    _clearMasterKeyCache();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MASTER_KEY = originalEnv;
    } else {
      delete process.env.MASTER_KEY;
    }
    _clearMasterKeyCache();
  });

  // FK6: No MASTER_KEY env var and no file → auto-generates
  it("FK6: auto-generates master key file when nothing is set", () => {
    delete process.env.MASTER_KEY;
    // Remove existing key file if present
    if (existsSync(masterKeyFile)) {
      rmSync(masterKeyFile);
    }
    _clearMasterKeyCache();

    const key = resolveMasterKey();
    expect(key.length).toBeGreaterThanOrEqual(32);
    expect(existsSync(masterKeyFile)).toBe(true);

    const fileContents = readFileSync(masterKeyFile);
    expect(fileContents.length).toBeGreaterThanOrEqual(32);
  });

  // FK7: Invalid MASTER_KEY length rejected
  it("FK7: rejects MASTER_KEY that is too short", () => {
    process.env.MASTER_KEY = randomBytes(16).toString("hex"); // 16 bytes = 128 bits, too short
    _clearMasterKeyCache();

    expect(() => resolveMasterKey()).toThrow(/MASTER_KEY must be at least 256 bits/);
  });

  // FK10: Master key from env var takes priority over file
  it("FK10: env var takes priority over file", () => {
    const envKey = randomBytes(32);
    process.env.MASTER_KEY = envKey.toString("hex");
    _clearMasterKeyCache();

    // Ensure a different key file exists
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(masterKeyFile, randomBytes(32), { mode: 0o600 });

    const resolved = resolveMasterKey();
    expect(resolved.toString("hex")).toBe(envKey.toString("hex"));
  });

  // FK11: Auto-generated file has restricted permissions (unix only)
  it("FK11: auto-generated .master-key has mode 0o600", () => {
    delete process.env.MASTER_KEY;
    if (existsSync(masterKeyFile)) {
      rmSync(masterKeyFile);
    }
    _clearMasterKeyCache();

    resolveMasterKey();

    const stats = statSync(masterKeyFile);
    // On macOS/Linux, check the permission bits (last 3 octal digits)
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
