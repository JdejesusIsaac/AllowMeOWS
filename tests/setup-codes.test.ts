import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  SetupCodeStore,
  SETUP_CODE_PATTERN,
  redactSetupCode,
  DEFAULT_EXPIRY_MS,
} from "../src/identity/setup-codes.js";

const testDataDir = join(process.cwd(), "data");

describe("SC: Setup Codes (Sprint 2.9)", () => {
  let store: SetupCodeStore;

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    store = new SetupCodeStore();
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("SC1: issued setup code follows SETUP-XXXX-XXXX format", async () => {
    const memberId = randomUUID();
    const code = await store.issue(memberId);
    expect(code).toMatch(SETUP_CODE_PATTERN);
  });

  it("SC2: resolve returns the correct memberId", async () => {
    const memberId = randomUUID();
    const code = await store.issue(memberId);
    const resolved = await store.resolve(code);
    expect(resolved).not.toBeNull();
    expect(resolved!.memberId).toBe(memberId);
  });

  it("SC3: expired setup code returns null", async () => {
    vi.useFakeTimers();
    const memberId = randomUUID();
    const code = await store.issue(memberId, 1000); // 1-second lifetime
    vi.advanceTimersByTime(2000);
    const resolved = await store.resolve(code);
    expect(resolved).toBeNull();
  });

  it("SC4: malformed setup code returns null", async () => {
    expect(await store.resolve("FOO-BAR")).toBeNull();
    expect(await store.resolve("SETUP-XXX")).toBeNull();
    expect(await store.resolve("SETUP-1234-5678")).toBeNull(); // 1 is excluded from alphabet
    expect(await store.resolve("")).toBeNull();
  });

  it("SC5: revokeForMember invalidates all active codes", async () => {
    const memberId = randomUUID();
    const code1 = await store.issue(memberId);
    const code2 = await store.issue(memberId);
    expect(await store.resolve(code1)).not.toBeNull();
    expect(await store.resolve(code2)).not.toBeNull();

    const count = await store.revokeForMember(memberId);
    expect(count).toBe(2);

    expect(await store.resolve(code1)).toBeNull();
    expect(await store.resolve(code2)).toBeNull();
  });

  it("file permissions on setup-codes.json are 0o600", async () => {
    await store.issue(randomUUID());
    const s = await stat(join(testDataDir, "setup-codes.json"));
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("redactSetupCode hides the first group but keeps the last", () => {
    expect(redactSetupCode("SETUP-ABCD-EFGH")).toBe("SETUP-****-EFGH");
    expect(redactSetupCode("not-a-code")).toBe("SETUP-****-****");
  });

  it("revoke (single code) is idempotent", async () => {
    const code = await store.issue(randomUUID());
    await store.revoke(code);
    await store.revoke(code); // no throw
    expect(await store.resolve(code)).toBeNull();
  });

  it("issue with no expiry arg uses DEFAULT_EXPIRY_MS", async () => {
    const memberId = randomUUID();
    const code = await store.issue(memberId);
    const resolved = await store.resolve(code);
    expect(resolved).not.toBeNull();
    const msUntilExpiry = new Date(resolved!.expiresAt).getTime() - Date.now();
    // Should be within a few seconds of DEFAULT_EXPIRY_MS
    expect(msUntilExpiry).toBeGreaterThan(DEFAULT_EXPIRY_MS - 10_000);
    expect(msUntilExpiry).toBeLessThan(DEFAULT_EXPIRY_MS + 1_000);
  });
});
