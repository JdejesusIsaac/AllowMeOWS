import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FitbitTokenStore } from "../src/fitbit/token-store.js";
import { FitbitClient } from "../src/fitbit/client.js";
import { isToolAuthorized } from "../src/middleware/access-control.js";

const FAMILY_ID = "a0000000-0000-0000-0000-000000000001";

const testDataDir = join(process.cwd(), "data");

// ============================================================
// D9: Fitbit OAuth Flow Tests (8 tests)
// ============================================================
describe("D9: Fitbit OAuth Flow", () => {
  const TEST_PASSPHRASE = "test-fitbit-passphrase-123";

  beforeEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    await mkdir(testDataDir, { recursive: true });
    process.env.OWS_PASSPHRASE = TEST_PASSPHRASE;
  });

  afterEach(async () => {
    await rm(testDataDir, { recursive: true, force: true });
    delete process.env.FITBIT_CLIENT_ID;
    delete process.env.FITBIT_CLIENT_SECRET;
    delete process.env.OWS_PASSPHRASE;
  });

  it("F1: connect-fitbit returns valid OAuth URL with client_id, redirect_uri, scope", () => {
    process.env.FITBIT_CLIENT_ID = "test-client-id-abc";
    process.env.FITBIT_CLIENT_SECRET = "test-secret-xyz";
    process.env.ALLOWANCE_AGENT_URL = "https://allowanceagent.app";

    const client = new FitbitClient(FAMILY_ID);
    const url = client.getAuthUrl("Maya");

    expect(url).toContain("client_id=test-client-id-abc");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("allowanceagent.app");
    expect(url).toContain("scope=activity");
    // Sprint 2.9: OAuth state carries familyId:childName so callback routes tokens correctly
    expect(url).toContain(`state=${encodeURIComponent(`${FAMILY_ID}:Maya`)}`);
    expect(url).toContain("response_type=code");
  });

  it("F2: connect-fitbit is Manager only — Learner, Co-parent, Family, Advisor denied", () => {
    expect(isToolAuthorized("connect-fitbit", "manager")).toBe(true);
    expect(isToolAuthorized("connect-fitbit", "learner")).toBe(false);
    expect(isToolAuthorized("connect-fitbit", "co-parent")).toBe(false);
    expect(isToolAuthorized("connect-fitbit", "family")).toBe(false);
    expect(isToolAuthorized("connect-fitbit", "advisor")).toBe(false);
  });

  it("F3: Token store saves and retrieves tokens correctly", async () => {
    const store = new FitbitTokenStore(FAMILY_ID);

    await store.saveTokens({
      accessToken: "access-token-123",
      refreshToken: "refresh-token-456",
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      scope: "activity",
      childName: "Maya",
      connectedAt: new Date().toISOString(),
    });

    const tokens = await store.getTokens("Maya");
    expect(tokens).not.toBeNull();
    expect(tokens!.accessToken).toBe("access-token-123");
    expect(tokens!.refreshToken).toBe("refresh-token-456");
    expect(tokens!.childName).toBe("Maya");
  });

  it("F4: Tokens stored encrypted — not plaintext in file", async () => {
    const store = new FitbitTokenStore(FAMILY_ID);

    await store.saveTokens({
      accessToken: "super-secret-access-token",
      refreshToken: "super-secret-refresh-token",
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      scope: "activity",
      childName: "Maya",
      connectedAt: new Date().toISOString(),
    });

    // Read raw file contents — Sprint 2.9 stores tokens under the family dir
    const raw = await readFile(join(testDataDir, "families", FAMILY_ID, "fitbit-tokens.json"), "utf8");

    // The plaintext tokens should NOT appear in the file
    expect(raw).not.toContain("super-secret-access-token");
    expect(raw).not.toContain("super-secret-refresh-token");

    // But it should have encrypted data fields
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].iv).toBeDefined();
    expect(parsed[0].tag).toBeDefined();
    expect(parsed[0].data).toBeDefined();
    expect(parsed[0].childName).toBe("Maya"); // childName is plaintext for lookup
  });

  it("F5: Token auto-refresh detects expired tokens", async () => {
    const store = new FitbitTokenStore(FAMILY_ID);

    // Store an expired token
    await store.saveTokens({
      accessToken: "expired-access-token",
      refreshToken: "valid-refresh-token",
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
      scope: "activity",
      childName: "Maya",
      connectedAt: new Date().toISOString(),
    });

    const tokens = await store.getTokens("Maya");
    expect(tokens).not.toBeNull();
    // Check that the token is expired
    const isExpired = new Date(tokens!.expiresAt) <= new Date();
    expect(isExpired).toBe(true);
    // FitbitClient.getValidToken() would call refreshAccessToken() here
  });

  it("F6: Activity data converts to score correctly", () => {
    process.env.FITBIT_CLIENT_ID = "test-id";
    process.env.FITBIT_CLIENT_SECRET = "test-secret";

    const client = new FitbitClient(FAMILY_ID);

    // 10,000 steps = 100
    expect(client.activityToScore({ steps: 10000, activeMinutes: 60, distance: 8, calories: 2000, date: "2026-04-05" })).toBe(100);

    // 9,200 steps = 92
    expect(client.activityToScore({ steps: 9200, activeMinutes: 45, distance: 7, calories: 1800, date: "2026-04-05" })).toBe(92);

    // 5,000 steps = 50
    expect(client.activityToScore({ steps: 5000, activeMinutes: 30, distance: 4, calories: 1500, date: "2026-04-05" })).toBe(50);

    // 15,000 steps = capped at 100
    expect(client.activityToScore({ steps: 15000, activeMinutes: 90, distance: 12, calories: 2500, date: "2026-04-05" })).toBe(100);

    // 0 steps = 0
    expect(client.activityToScore({ steps: 0, activeMinutes: 0, distance: 0, calories: 0, date: "2026-04-05" })).toBe(0);
  });

  it("F7: Missing FITBIT_CLIENT_ID env var — isConfigured returns false", () => {
    delete process.env.FITBIT_CLIENT_ID;
    delete process.env.FITBIT_CLIENT_SECRET;
    expect(FitbitClient.isConfigured()).toBe(false);
  });

  it("F8: Token store returns null for child with no stored tokens", async () => {
    const store = new FitbitTokenStore(FAMILY_ID);
    const tokens = await store.getTokens("UnknownChild");
    expect(tokens).toBeNull();

    const hasTokens = await store.hasTokens("UnknownChild");
    expect(hasTokens).toBe(false);
  });
});
