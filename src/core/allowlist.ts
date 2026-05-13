/**
 * Sprint 3.0.2 — Destination allowlist core module.
 *
 * Pure functions (no I/O). Callers load state via StateManager and pass
 * arrays in.
 *
 * All address comparisons go through `tryNormalizeWallet` so that:
 *   - EIP-55 checksum capitalization is irrelevant (AL-CORE5, AL20, F4)
 *   - malformed input is rejected with a clear reason (AL-CORE3)
 *
 * Internal vault destinations (savings-vault, gift-fund) are never passed
 * in here — the caller checks only the child-wallet leg. Decision 2 is
 * enforced at the call site, not here.
 */

import { tryNormalizeWallet } from "../auth/wallet.js";
import type { ChildConfig, SavingsEntry } from "../schemas.js";

export type AllowlistRejectReason =
  | "malformed-address"
  | "allowlist-empty"
  | "not-in-allowlist";

export interface AllowlistCheckResult {
  allowed: boolean;
  reason?: AllowlistRejectReason;
}

/**
 * Check if a destination address is in the family's authorized-destinations
 * list.
 *
 * Returns `{allowed: true}` only when:
 *   - `destination` normalizes to a valid EVM address, AND
 *   - `list` is non-empty, AND
 *   - some entry in `list` normalizes to the same lowercase form.
 *
 * Malformed entries in `list` are silently skipped (they cannot match a
 * valid destination). A malformed `destination` itself causes
 * `{allowed: false, reason: "malformed-address"}`.
 */
export function checkDestinationAllowlist(
  destination: string,
  list: string[]
): AllowlistCheckResult {
  const normalized = tryNormalizeWallet(destination);
  if (!normalized) {
    return { allowed: false, reason: "malformed-address" };
  }
  if (list.length === 0) {
    return { allowed: false, reason: "allowlist-empty" };
  }
  for (const entry of list) {
    const e = tryNormalizeWallet(entry);
    if (e && e === normalized) {
      return { allowed: true };
    }
  }
  return { allowed: false, reason: "not-in-allowlist" };
}

/**
 * Compute the set of addresses present in `current` but absent from
 * `proposed`. Comparison is case-insensitive; invalid entries are skipped.
 * Returned addresses are in their canonical lowercase form.
 */
export function computeRemovedDestinations(
  current: string[],
  proposed: string[]
): string[] {
  const proposedSet = new Set<string>();
  for (const p of proposed) {
    const n = tryNormalizeWallet(p);
    if (n) proposedSet.add(n);
  }
  const removed: string[] = [];
  const seen = new Set<string>();
  for (const c of current) {
    const n = tryNormalizeWallet(c);
    if (!n) continue;
    if (proposedSet.has(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    removed.push(n);
  }
  return removed;
}

export interface BlockedRemoval {
  address: string; // lowercased
  childName: string;
  entryIds: string[];
  totalUsdcLocked: number; // sum of entry.amount in 6-decimal USDC units
}

/**
 * For each removed address, find the child(ren) whose `walletAddress`
 * matches (case-insensitively). For each such child, filter savings
 * entries that are BOTH `!released` AND `!converted`. If any match,
 * emit a `BlockedRemoval`.
 *
 * Decision 3 semantics: a released entry does NOT block (funds already
 * delivered). A converted entry does NOT block (funds moved to PAXG, the
 * child's USDC path is no longer active). Only non-released,
 * non-converted entries block a removal.
 *
 * Returns an empty array when no conflicts exist. Callers that expect
 * multi-child blocks (AL14) rely on this function emitting ONE entry per
 * affected (address, child) pair.
 */
export function findBlockedRemovals(
  removed: string[],
  savings: SavingsEntry[],
  children: ChildConfig[]
): BlockedRemoval[] {
  const blocked: BlockedRemoval[] = [];
  const removedNormalized = new Set<string>();
  for (const r of removed) {
    const n = tryNormalizeWallet(r);
    if (n) removedNormalized.add(n);
  }
  if (removedNormalized.size === 0) return blocked;

  for (const child of children) {
    if (!child.walletAddress) continue;
    const childAddr = tryNormalizeWallet(child.walletAddress);
    if (!childAddr) continue;
    if (!removedNormalized.has(childAddr)) continue;

    const matching = savings.filter(
      (e) =>
        e.childName === child.name &&
        e.released === false &&
        e.converted === false
    );
    if (matching.length === 0) continue;

    blocked.push({
      address: childAddr,
      childName: child.name,
      entryIds: matching.map((e) => e.id),
      totalUsdcLocked: matching.reduce((sum, e) => sum + e.amount, 0),
    });
  }

  return blocked;
}
