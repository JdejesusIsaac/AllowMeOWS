/**
 * Sprint 4.1 W5 — `lazyMintTokenForLegacyFamily` unit suite (AM21–AM25).
 *
 * Verifies idempotency, concurrency safety, error surfaces, wallet-name
 * resolution, and the post-mint usability invariant. The OWS
 * `createApiKey` is mocked so we don't write to a real OWS vault; the
 * StateManager and FamilyKeyManager are real (they read from a temp
 * data dir) so the wallet-name enumeration flow gets actual coverage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const { mockCreateApiKey } = vi.hoisted(() => ({
  mockCreateApiKey: vi.fn(),
}));

vi.mock("@open-wallet-standard/core", () => ({
  createApiKey: mockCreateApiKey,
}));

import { _clearMasterKeyCache } from "../src/keys/master-key.js";
import { FamilyKeyManager } from "../src/keys/family-keys.js";
import {
  lazyMintTokenForLegacyFamily,
  FamilyApiTokenManager,
} from "../src/keys/family-api-tokens.js";
import { StateManager } from "../src/engine/state.js";
import { WALLET_NAMES } from "../src/constants.js";
import type { FamilyConfig } from "../src/schemas.js";

const TEST_DATA_DIR = join(process.cwd(), "data-test-lazy");

function makeConfig(opts: {
  familyId: string;
  children?: Array<{ name: string; walletAddress?: string }>;
}): FamilyConfig {
  return {
    familyId: opts.familyId,
    familyName: "TestFam",
    children: (opts.children ?? []).map((c) => ({
      name: c.name,
      walletName: `child-${c.name.toLowerCase()}`,
      walletAddress: c.walletAddress,
      weeklyBudget: 5_000_000,
      categories: [{ name: "education", pct: 100, budget: 5_000_000 }],
      savingsPercent: 20,
      savingsLockDays: 90,
    })),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    chainId: "eip155:84532",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    authorizedDestinations: [],
    policyVersion: 1,
  };
}

describe("lazyMintTokenForLegacyFamily (Sprint 4.1 W5, AM21–AM25)", () => {
  let originalMasterKey: string | undefined;
  let originalDataDirEnv: string | undefined;

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    originalMasterKey = process.env.MASTER_KEY;
    originalDataDirEnv = process.env.ALLOWME_DATA_DIR;
    process.env.MASTER_KEY = randomBytes(32).toString("hex");
    _clearMasterKeyCache();
    mockCreateApiKey.mockReset();
    mockCreateApiKey.mockImplementation(
      (
        _name: string,
        _wallets: string[],
        _policies: string[],
        _passphrase: string
      ) => {
        const tokenSeed = randomBytes(32).toString("hex");
        return { token: "ows_key_" + tokenSeed, id: randomUUID(), name: _name };
      }
    );
  });

  afterEach(() => {
    if (originalMasterKey !== undefined) {
      process.env.MASTER_KEY = originalMasterKey;
    } else {
      delete process.env.MASTER_KEY;
    }
    if (originalDataDirEnv !== undefined) {
      process.env.ALLOWME_DATA_DIR = originalDataDirEnv;
    }
    _clearMasterKeyCache();
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  // AM21 — idempotency: second call returns cached, no second scrypt.
  it("AM21: first call mints + persists; second call returns cached token, createApiKey runs once", async () => {
    const familyId = randomUUID();
    // Bootstrap minimal family-key (real FamilyKeyManager).
    const keys = new FamilyKeyManager(TEST_DATA_DIR);
    keys.generateFamilyKey(familyId);
    // Persist a config so listFamilyWalletNames can resolve children.
    const state = new StateManager();
    await state.createFamilyDir(familyId);
    await state.saveFamilyConfig(
      familyId,
      makeConfig({ familyId, children: [{ name: "Aiden" }] })
    );

    const t1 = await lazyMintTokenForLegacyFamily(familyId, TEST_DATA_DIR);
    const t2 = await lazyMintTokenForLegacyFamily(familyId, TEST_DATA_DIR);
    expect(t1).toBe(t2);
    expect(t1.startsWith("ows_key_")).toBe(true);
    expect(mockCreateApiKey).toHaveBeenCalledTimes(1);
  });

  // AM22 — concurrent calls converge (both resolve to a token, store has one row).
  it("AM22: concurrent lazy-mint calls converge to one token in the store", async () => {
    const familyId = randomUUID();
    const keys = new FamilyKeyManager(TEST_DATA_DIR);
    keys.generateFamilyKey(familyId);
    const state = new StateManager();
    await state.createFamilyDir(familyId);
    await state.saveFamilyConfig(
      familyId,
      makeConfig({ familyId, children: [{ name: "Aiden" }] })
    );

    const [t1, t2, t3] = await Promise.all([
      lazyMintTokenForLegacyFamily(familyId, TEST_DATA_DIR),
      lazyMintTokenForLegacyFamily(familyId, TEST_DATA_DIR),
      lazyMintTokenForLegacyFamily(familyId, TEST_DATA_DIR),
    ]);
    // All three return the SAME token (lock serializes the mint).
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
    expect(t1.startsWith("ows_key_")).toBe(true);
    // The lock makes createApiKey fire exactly once.
    expect(mockCreateApiKey).toHaveBeenCalledTimes(1);
    // Store has exactly one row.
    const apiTokens = new FamilyApiTokenManager(TEST_DATA_DIR);
    expect(apiTokens.hasToken(familyId)).toBe(true);
    expect(apiTokens.getToken(familyId)).toBe(t1);
  });

  // AM23 — error path: family has no encryption key.
  it("AM23: throws a clear error when the family has no encryption key", async () => {
    const familyId = randomUUID();
    // No generateFamilyKey, no saveFamilyConfig.
    await expect(
      lazyMintTokenForLegacyFamily(familyId, TEST_DATA_DIR)
    ).rejects.toThrow(/configure-policy was never completed|no encryption key/);
    expect(mockCreateApiKey).not.toHaveBeenCalled();
  });

  // AM24 — wallet enumeration: BYO children are excluded.
  it("AM24: wallet name list includes treasury/savings-vault/gift-fund + OWS-managed children only", async () => {
    const familyId = randomUUID();
    const keys = new FamilyKeyManager(TEST_DATA_DIR);
    keys.generateFamilyKey(familyId);
    const state = new StateManager();
    await state.createFamilyDir(familyId);
    await state.saveFamilyConfig(
      familyId,
      makeConfig({
        familyId,
        children: [
          { name: "Maya" }, // OWS-managed (no walletAddress)
          {
            name: "Liam",
            walletAddress: "0x4444444444444444444444444444444444444444",
          }, // BYO
        ],
      })
    );

    await lazyMintTokenForLegacyFamily(familyId, TEST_DATA_DIR);
    expect(mockCreateApiKey).toHaveBeenCalledTimes(1);
    const walletsArg = mockCreateApiKey.mock.calls[0]![1] as string[];
    expect(walletsArg).toContain(WALLET_NAMES.TREASURY);
    expect(walletsArg).toContain(WALLET_NAMES.SAVINGS_VAULT);
    expect(walletsArg).toContain(WALLET_NAMES.GIFT_FUND);
    expect(walletsArg).toContain(WALLET_NAMES.childWallet("Maya"));
    // BYO child (Liam) is NOT included.
    expect(walletsArg).not.toContain(WALLET_NAMES.childWallet("Liam"));
  });

  // AM25 — post-mint usability: the saved token matches the storage entry's apiKeyId.
  it("AM25: the persisted (token, apiKeyId) pair survives a roundtrip via FamilyApiTokenManager", async () => {
    const familyId = randomUUID();
    const keys = new FamilyKeyManager(TEST_DATA_DIR);
    keys.generateFamilyKey(familyId);
    const state = new StateManager();
    await state.createFamilyDir(familyId);
    await state.saveFamilyConfig(
      familyId,
      makeConfig({ familyId, children: [{ name: "Aiden" }] })
    );

    const lazyMinted = await lazyMintTokenForLegacyFamily(
      familyId,
      TEST_DATA_DIR
    );
    const apiTokens = new FamilyApiTokenManager(TEST_DATA_DIR);
    expect(apiTokens.getToken(familyId)).toBe(lazyMinted);
    // forgetToken returns the apiKeyId that was stored — confirms the pair
    // is the same object the OWS mock returned.
    const storedApiKeyId = apiTokens.forgetToken(familyId);
    const expectedApiKeyId = mockCreateApiKey.mock.results[0]!.value.id;
    expect(storedApiKeyId).toBe(expectedApiKeyId);
  });
});
