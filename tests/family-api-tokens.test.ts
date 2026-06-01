import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  FamilyApiTokenManager,
  OWS_TOKEN_PREFIX,
} from "../src/keys/family-api-tokens.js";
import { _clearMasterKeyCache } from "../src/keys/master-key.js";

const TEST_DATA_DIR = join(process.cwd(), "data-test-fat");
const STORE_FILE = join(TEST_DATA_DIR, "family-api-tokens.json");

function cleanTestDir() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

function fakeToken(seed: string): string {
  // 64 hex chars of seed-derived "entropy" — deterministic for assertions.
  const padded = seed.padEnd(64, seed).slice(0, 64);
  // Normalize to hex alphabet for realism (the prefix check + decryption
  // contract doesn't depend on hex, but the redaction regex AM49 does).
  const hex = padded.replace(/[^a-f0-9]/gi, "a");
  return OWS_TOKEN_PREFIX + hex;
}

describe("FamilyApiTokenManager (Sprint 4.1 W1, AM1–AM10)", () => {
  let originalMasterKey: string | undefined;

  beforeEach(() => {
    cleanTestDir();
    mkdirSync(TEST_DATA_DIR, { recursive: true });
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
    cleanTestDir();
  });

  // AM1 — Roundtrip preserves exact token string.
  it("AM1: saveToken + getToken roundtrip preserves the exact token byte-for-byte", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    const token = fakeToken("alpha");
    mgr.saveToken("family-1", token, "key-uuid-1");
    const retrieved = mgr.getToken("family-1");
    expect(retrieved).toBe(token);
  });

  // AM2 — hasToken before/after save.
  it("AM2: hasToken returns false before save and true after", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    expect(mgr.hasToken("family-1")).toBe(false);
    mgr.saveToken("family-1", fakeToken("beta"), "key-uuid-1");
    expect(mgr.hasToken("family-1")).toBe(true);
  });

  // AM3 — Cross-family isolation.
  it("AM3: tokens for different families decrypt independently and do not cross", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    const tA = fakeToken("aaaa");
    const tB = fakeToken("bbbb");
    mgr.saveToken("family-A", tA, "k1");
    mgr.saveToken("family-B", tB, "k2");
    expect(mgr.getToken("family-A")).toBe(tA);
    expect(mgr.getToken("family-B")).toBe(tB);
    expect(mgr.getToken("family-A")).not.toBe(mgr.getToken("family-B"));
  });

  // AM4 — Unknown family returns null (not throw).
  it("AM4: getToken returns null for an unknown family (no exception)", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    expect(mgr.getToken("never-existed")).toBeNull();
  });

  // AM5 — Corrupt JSON recovers as empty store.
  it("AM5: corrupt JSON file recovers as empty store, no overwrite on read", () => {
    writeFileSync(STORE_FILE, "{not valid json", "utf-8");
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    expect(mgr.getToken("anything")).toBeNull();
    expect(mgr.hasToken("anything")).toBe(false);
    // The corrupt file should remain in place (we don't silently overwrite
    // on read — the next saveToken atomic-write WILL replace it).
    expect(readFileSync(STORE_FILE, "utf-8")).toBe("{not valid json");
  });

  // AM6 — forgetToken removes entry and returns apiKeyId.
  it("AM6: forgetToken removes the row and returns the stored apiKeyId", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    mgr.saveToken("family-1", fakeToken("zeta"), "key-uuid-1");
    const returned = mgr.forgetToken("family-1");
    expect(returned).toBe("key-uuid-1");
    expect(mgr.hasToken("family-1")).toBe(false);
    // File no longer contains the family row.
    const raw = readFileSync(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed["family-1"]).toBeUndefined();
  });

  // AM7 — forgetToken on unknown family returns null + no mutation.
  it("AM7: forgetToken returns null for an unknown family and does not mutate the file", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    mgr.saveToken("family-keep", fakeToken("k"), "key-uuid-keep");
    const before = readFileSync(STORE_FILE, "utf-8");
    expect(mgr.forgetToken("never-existed")).toBeNull();
    const after = readFileSync(STORE_FILE, "utf-8");
    expect(after).toBe(before);
  });

  // AM8 — File mode is 0o600 after every write.
  it("AM8: store file is mode 0o600 after every write", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    mgr.saveToken("family-1", fakeToken("mode"), "k1");
    let mode = statSync(STORE_FILE).mode & 0o777;
    expect(mode).toBe(0o600);
    mgr.saveToken("family-2", fakeToken("mode2"), "k2");
    mode = statSync(STORE_FILE).mode & 0o777;
    expect(mode).toBe(0o600);
    mgr.forgetToken("family-2");
    mode = statSync(STORE_FILE).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  // AM9 — Repeated save overwrites in place (single row per family).
  it("AM9: repeated saveToken for the same familyId overwrites in place", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    const t1 = fakeToken("first");
    const t2 = fakeToken("second");
    mgr.saveToken("family-1", t1, "k1");
    mgr.saveToken("family-1", t2, "k2");
    expect(mgr.getToken("family-1")).toBe(t2);
    expect(mgr.forgetToken("family-1")).toBe("k2");
    // After forget, no rows for this family remain.
    const parsed = JSON.parse(readFileSync(STORE_FILE, "utf-8"));
    expect(Object.keys(parsed)).not.toContain("family-1");
  });

  // AM10 — Wrong master key yields null (not throw); recovery path.
  it("AM10: when master key rotates, getToken returns null instead of throwing", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    mgr.saveToken("family-1", fakeToken("rotate"), "k1");

    // Rotate the master key and clear cache, then construct a new manager.
    process.env.MASTER_KEY = randomBytes(32).toString("hex");
    _clearMasterKeyCache();

    const mgr2 = new FamilyApiTokenManager(TEST_DATA_DIR);
    expect(mgr2.getToken("family-1")).toBeNull();
    // hasToken still returns true (the row is on disk) — getToken is the
    // canonical health check the caller should use; the null return signals
    // "regenerate via lazy-mint".
    expect(mgr2.hasToken("family-1")).toBe(true);
  });

  // Extra invariant — the token store never contains the plaintext token.
  it("storage envelope never contains the plaintext token (encryption smoke)", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    const token = fakeToken("plaintext-check");
    mgr.saveToken("family-1", token, "k1");
    const raw = readFileSync(STORE_FILE, "utf-8");
    expect(raw).not.toContain(token);
  });

  // Extra invariant — saveToken refuses anything not prefixed with `ows_key_`.
  it("saveToken rejects non-OWS-token strings (fail-fast guard)", () => {
    const mgr = new FamilyApiTokenManager(TEST_DATA_DIR);
    expect(() => mgr.saveToken("family-1", "password123", "k1")).toThrow(
      /OWS API token/
    );
    expect(() => mgr.saveToken("family-1", "", "k1")).toThrow(/OWS API token/);
    expect(() =>
      mgr.saveToken("family-1", "ows_keyZZ" + "a".repeat(64), "k1")
    ).toThrow(/OWS API token/);
  });
});
