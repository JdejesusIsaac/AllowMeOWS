/**
 * Sprint 3.0.6 — policy-cache test suite (W6).
 *
 *   PC1: get-miss → set → get-hit returns the same value
 *   PC2: TTL expiry — after `_setPolicyCacheTtl` to a short window and
 *        time-advance via `vi.useFakeTimers`, get returns undefined
 *   PC3: invalidate drops the cached entry on demand
 *   PC4: integration — bootstrap → view-policy (v1) → configure-policy
 *        update → view-policy (v2). No stale read after a write that goes
 *        through `configureFamilyCore`. Locks the synchronous-invalidate
 *        invariant from D8.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  policyCache,
  _clearPolicyCache,
  _setPolicyCacheTtl,
} from "../src/cache/policy-cache.js";
import { configureFamilyCore } from "../src/core/configure-family.js";
import { viewPolicyHandler } from "../src/tools/view-policy.js";
import type { CallerContext } from "../src/middleware/access-control.js";
import { ROLES, CHAIN_IDS, USDC } from "../src/constants.js";
import type { ChildConfig, FamilyConfig } from "../src/schemas.js";

const DATA_DIR = join(process.cwd(), "data");

function buildChild(name: string, opts: Partial<ChildConfig> = {}): ChildConfig {
  return {
    name,
    walletName: `child-${name.toLowerCase()}`,
    weeklyBudget: opts.weeklyBudget ?? 15_000_000,
    categories: opts.categories ?? [
      { name: "education", pct: 100, budget: opts.weeklyBudget ?? 15_000_000 },
    ],
    savingsPercent: opts.savingsPercent ?? 20,
    savingsLockDays: opts.savingsLockDays ?? 90,
    walletAddress: opts.walletAddress,
  };
}

function buildConfig(familyId: string): FamilyConfig {
  return {
    familyId,
    familyName: "CacheTest",
    children: [],
    createdAt: "2026-05-15T10:00:00.000Z",
    updatedAt: "2026-05-15T10:00:00.000Z",
    chainId: CHAIN_IDS.BASE_SEPOLIA,
    usdcAddress: USDC.BASE_SEPOLIA,
    authorizedDestinations: [],
    policyVersion: 1,
  };
}

describe("Sprint 3.0.6 — policy-cache (W6)", () => {
  beforeEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
    await mkdir(DATA_DIR, { recursive: true });
    _clearPolicyCache();
    _setPolicyCacheTtl(null); // reset to 60s default
  });

  afterEach(async () => {
    await rm(DATA_DIR, { recursive: true, force: true });
    _clearPolicyCache();
    _setPolicyCacheTtl(null);
    vi.useRealTimers();
  });

  it("PC1: get-miss returns undefined; after set, get returns the cached value", () => {
    const familyId = "pc1-family-id";
    expect(policyCache.get(familyId)).toBeUndefined();

    const config = buildConfig(familyId);
    policyCache.set(familyId, config);

    expect(policyCache.get(familyId)).toBe(config);
  });

  it("PC2: get returns undefined after TTL expiry (60s window)", () => {
    vi.useFakeTimers();
    const familyId = "pc2-family-id";
    const config = buildConfig(familyId);

    // Use a deterministic short TTL so the test advances seconds, not the
    // production 60s.
    _setPolicyCacheTtl(1000);
    policyCache.set(familyId, config);

    // Just before expiry — still hit.
    vi.advanceTimersByTime(999);
    expect(policyCache.get(familyId)).toBe(config);

    // At expiry — miss (>= triggers eviction).
    vi.advanceTimersByTime(1);
    expect(policyCache.get(familyId)).toBeUndefined();
  });

  it("PC3: invalidate drops the cached entry on demand", () => {
    const familyId = "pc3-family-id";
    const config = buildConfig(familyId);
    policyCache.set(familyId, config);
    expect(policyCache.get(familyId)).toBe(config);

    policyCache.invalidate(familyId);
    expect(policyCache.get(familyId)).toBeUndefined();

    // Idempotent — second invalidate is a no-op.
    policyCache.invalidate(familyId);
    expect(policyCache.get(familyId)).toBeUndefined();
  });

  it("PC4: integration — view-policy reads v1, configure-policy update writes v2, next view-policy returns v2 (no stale read)", async () => {
    // Step 1: bootstrap → policyVersion = 1, cache empty.
    const bootstrap = await configureFamilyCore(
      {
        familyName: "PC4 Family",
        children: [buildChild("Aiden")],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
      },
      null
    );
    if (!bootstrap.ok || !bootstrap.bootstrap) {
      throw new Error("bootstrap failed");
    }
    const caller: CallerContext = {
      role: ROLES.MANAGER,
      memberId: bootstrap.memberId,
      familyId: bootstrap.familyId,
    };

    // Step 2: view-policy → reads v1 (cache miss → disk → cache populated).
    const firstView = await viewPolicyHandler({}, caller);
    const firstPayload = JSON.parse(firstView.content[0]!.text);
    expect(firstPayload.policyVersion).toBe(1);
    // Cache should now be populated.
    expect(policyCache.get(bootstrap.familyId)).toBeDefined();

    // Step 3: configure-policy update → policyVersion = 2 AND cache
    // invalidated synchronously inside configureFamilyCore.
    const update = await configureFamilyCore(
      {
        familyName: "PC4 Family Updated",
        children: [buildChild("Aiden"), buildChild("Maya")],
        chainId: CHAIN_IDS.BASE_SEPOLIA,
        usdcAddress: USDC.BASE_SEPOLIA,
        useTestnet: true,
      },
      caller
    );
    expect(update.ok).toBe(true);
    // Cache must be empty here — invalidate runs synchronously.
    expect(policyCache.get(bootstrap.familyId)).toBeUndefined();

    // Step 4: view-policy again → reads v2 (NOT a stale v1).
    const secondView = await viewPolicyHandler({}, caller);
    const secondPayload = JSON.parse(secondView.content[0]!.text);
    expect(secondPayload.policyVersion).toBe(2);
    expect(secondPayload.summary.childCount).toBe(2);
    // Cache repopulated with the new value.
    const cached = policyCache.get(bootstrap.familyId);
    expect(cached).toBeDefined();
    expect(cached!.policyVersion).toBe(2);
  });
});
