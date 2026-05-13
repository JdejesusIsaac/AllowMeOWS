// Sprint 3.0.2 — Core allowlist unit tests (AL-CORE1 through AL-CORE8).
// Pure-function tests, no I/O, no mocks. Exercise src/core/allowlist.ts.
import { describe, it, expect } from "vitest";
import {
  checkDestinationAllowlist,
  computeRemovedDestinations,
  findBlockedRemovals,
} from "../src/core/allowlist.js";
import type { ChildConfig, SavingsEntry } from "../src/schemas.js";

// Valid EVM addresses used throughout. All stored in canonical lowercase.
const ADMIN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
// Vitalik's known-valid EIP-55 checksum + its lowercase canonical form.
// Using this pair lets AL-CORE5 exercise the mixed-case path with an
// address that actually passes viem's isAddress() checksum validation.
const CHILD1 = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const CHILD1_CHECKSUM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const CHILD2 = "0xcccccccccccccccccccccccccccccccccccccccc";
const ATTACK = "0xdddddddddddddddddddddddddddddddddddddddd";

// Test fixture: build a minimal ChildConfig with just the fields the
// allowlist module cares about.
function makeChild(name: string, walletAddress?: string): ChildConfig {
  return {
    name,
    walletName: `child-${name.toLowerCase()}`,
    walletAddress,
    weeklyBudget: 15_000_000,
    categories: [{ name: "general", pct: 100, budget: 15_000_000 }],
    savingsPercent: 20,
    savingsLockDays: 90,
  };
}

function makeSavings(
  overrides: Partial<SavingsEntry> & { id: string; childName: string; amount: number }
): SavingsEntry {
  return {
    id: overrides.id,
    childName: overrides.childName,
    amount: overrides.amount,
    asset: "USDC",
    depositedAt: "2025-01-01T00:00:00.000Z",
    lockUntil: "2025-04-01T00:00:00.000Z",
    released: false,
    multiplierAtDeposit: 1.0,
    converted: false,
    ...overrides,
  };
}

describe("checkDestinationAllowlist", () => {
  it("AL-CORE1: allows a destination present in the allowlist", () => {
    const result = checkDestinationAllowlist(CHILD1, [ADMIN, CHILD1, CHILD2]);
    expect(result).toEqual({ allowed: true });
  });

  it("AL-CORE2: rejects unknown destination with reason 'not-in-allowlist'", () => {
    const result = checkDestinationAllowlist(ATTACK, [ADMIN, CHILD1, CHILD2]);
    expect(result).toEqual({ allowed: false, reason: "not-in-allowlist" });
  });

  it("AL-CORE3: rejects malformed destination with reason 'malformed-address'", () => {
    expect(checkDestinationAllowlist("not-an-address", [ADMIN, CHILD1])).toEqual({
      allowed: false,
      reason: "malformed-address",
    });
    expect(checkDestinationAllowlist("0xdeadbeef", [ADMIN, CHILD1])).toEqual({
      allowed: false,
      reason: "malformed-address",
    });
    expect(checkDestinationAllowlist("", [ADMIN, CHILD1])).toEqual({
      allowed: false,
      reason: "malformed-address",
    });
  });

  it("AL-CORE4: rejects any destination when allowlist is empty with reason 'allowlist-empty'", () => {
    const result = checkDestinationAllowlist(CHILD1, []);
    expect(result).toEqual({ allowed: false, reason: "allowlist-empty" });
  });

  it("AL-CORE5: comparison is case-insensitive (EIP-55 checksum accepted)", () => {
    // destination checksum-cased, list lowercase
    expect(
      checkDestinationAllowlist(CHILD1_CHECKSUM, [ADMIN, CHILD1])
    ).toEqual({ allowed: true });
    // destination lowercase, list checksum-cased
    expect(
      checkDestinationAllowlist(CHILD1, [ADMIN, CHILD1_CHECKSUM])
    ).toEqual({ allowed: true });
    // both checksum-cased
    expect(
      checkDestinationAllowlist(CHILD1_CHECKSUM, [CHILD1_CHECKSUM])
    ).toEqual({ allowed: true });
  });
});

describe("computeRemovedDestinations", () => {
  it("AL-CORE6: returns addresses in current but not in proposed, case-insensitive, deduped, lowercased", () => {
    // Simple diff
    expect(
      computeRemovedDestinations([ADMIN, CHILD1, CHILD2], [ADMIN, CHILD2])
    ).toEqual([CHILD1]);

    // No removals
    expect(
      computeRemovedDestinations([ADMIN, CHILD1], [ADMIN, CHILD1, CHILD2])
    ).toEqual([]);

    // Full removal
    expect(computeRemovedDestinations([ADMIN, CHILD1], [])).toEqual([ADMIN, CHILD1]);

    // Case-insensitive match across sides: checksum in current, lowercase
    // in proposed → NOT removed.
    expect(
      computeRemovedDestinations([CHILD1_CHECKSUM, CHILD2], [CHILD1])
    ).toEqual([CHILD2]);

    // Duplicate entries in current are deduped in output.
    expect(
      computeRemovedDestinations(
        [CHILD1, CHILD1_CHECKSUM, CHILD1],
        []
      )
    ).toEqual([CHILD1]);
  });
});

describe("findBlockedRemovals", () => {
  it("AL-CORE7: emits a BlockedRemoval when a removed address has unreleased savings", () => {
    const children = [makeChild("Elina", CHILD1), makeChild("Sofia", CHILD2)];
    const savings: SavingsEntry[] = [
      makeSavings({ id: "s1", childName: "Elina", amount: 100_000, released: false, converted: false }),
      makeSavings({ id: "s2", childName: "Elina", amount: 50_000, released: true, releasedAt: "2025-02-01T00:00:00.000Z", converted: false }),
    ];
    const result = findBlockedRemovals([CHILD1], savings, children);
    expect(result).toHaveLength(1);
    expect(result[0].address).toBe(CHILD1);
    expect(result[0].childName).toBe("Elina");
    expect(result[0].entryIds).toEqual(["s1"]);
    expect(result[0].totalUsdcLocked).toBe(100_000);
  });

  it("AL-CORE8: emits nothing when all entries are released and/or converted", () => {
    const children = [makeChild("Elina", CHILD1)];
    const savings: SavingsEntry[] = [
      makeSavings({ id: "s1", childName: "Elina", amount: 100_000, released: true, converted: false }),
      makeSavings({ id: "s2", childName: "Elina", amount: 50_000, released: false, converted: true }),
      makeSavings({ id: "s3", childName: "Elina", amount: 25_000, released: true, converted: true }),
    ];
    const result = findBlockedRemovals([CHILD1], savings, children);
    expect(result).toEqual([]);
  });
});
