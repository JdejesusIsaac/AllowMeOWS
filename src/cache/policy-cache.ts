/**
 * Sprint 3.0.6 — in-process FamilyConfig cache.
 *
 * Stores the decrypted, schema-parsed `FamilyConfig` keyed by `familyId`
 * with a 60-second TTL. The cache is single-process — Railway is single-
 * instance per [`view-policy-sprint/plan.md`](../../view-policy-sprint/plan.md).
 * If the deployment moves to multi-instance, swap the Map for Redis and
 * keep the API surface identical.
 *
 * Invalidation strategy: synchronous, called from `configureFamilyCore`
 * right after `state.saveFamilyConfig`. No `await` between save and
 * invalidate — this rules out stale-read races within a single process
 * (PC4 integration test locks this end-to-end). Both the MCP tool path
 * (`src/tools/configure-policy.ts`) AND the HTTP path
 * (`app/verify-routes.ts` → `/api/configure-family`) go through
 * `configureFamilyCore`, so a single invalidate call covers both write
 * surfaces.
 *
 * Sprint 3.0.6 W6.
 */
import type { FamilyConfig } from "../schemas.js";

const DEFAULT_TTL_MS = 60 * 1000; // 60s — matches plan D8

interface CacheEntry {
  value: FamilyConfig;
  expiresAt: number;
}

/**
 * Singleton cache. Exposed as a frozen object so callers can't reassign
 * the methods (defensive — tests reach into it for the test-only `clear`
 * helper, which is exported separately).
 */
const cache = new Map<string, CacheEntry>();
let ttlMs = DEFAULT_TTL_MS;

export const policyCache = {
  /**
   * Look up the cached FamilyConfig for a familyId. Returns undefined on
   * miss or expiry (and removes the expired entry from the map as a side
   * effect — sweepless eviction).
   */
  get(familyId: string): FamilyConfig | undefined {
    const entry = cache.get(familyId);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      cache.delete(familyId);
      return undefined;
    }
    return entry.value;
  },

  /**
   * Cache `value` for `familyId`. Resets the TTL on every call — last write
   * wins. The cache assumes `value` is already schema-parsed (i.e., post
   * `FamilyConfigSchema.parse` from `StateManager.loadFamilyConfig`); it
   * never re-parses on read.
   */
  set(familyId: string, value: FamilyConfig): void {
    cache.set(familyId, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  },

  /**
   * Drop any cached entry for `familyId`. Called by `configureFamilyCore`
   * (both bootstrap and update paths) synchronously after `saveFamilyConfig`
   * so the next `view-policy` call hits disk and re-caches.
   */
  invalidate(familyId: string): void {
    cache.delete(familyId);
  },
};

/**
 * Test-only: wipe the entire cache. Used by `policy-cache.test.ts` between
 * tests so cache state doesn't leak across `it` blocks. Not exposed via
 * the `policyCache` object so prod code can't accidentally call it.
 */
export function _clearPolicyCache(): void {
  cache.clear();
}

/**
 * Test-only: override the TTL for deterministic expiry tests. Restore by
 * calling with `DEFAULT_TTL_MS` or `null` (which resets to default).
 */
export function _setPolicyCacheTtl(ms: number | null): void {
  ttlMs = ms ?? DEFAULT_TTL_MS;
}
