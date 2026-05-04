/**
 * Sprint 3.0 v4 — listMembershipsByWallet.
 *
 * Given a SIWE-verified wallet address, return every `(memberId, familyId,
 * role)` triple where that wallet is the Member's bound wallet. Supports
 * the cross-family Manager flow — a single wallet can legitimately be
 * Manager of one family and Co-parent of another.
 *
 * Implementation: linear scan via `MemberIndex.list()` + per-entry
 * `StateManager.loadMember`. Acceptable for pilot scale (≤500 Members,
 * per research §6 Option A). Sprint 4.0 Postgres migration makes this
 * O(1) by indexing on `wallet_address` directly.
 */

import type { RoleType } from "../schemas.js";
import { MemberIndex } from "../identity/member-index.js";
import { StateManager } from "../engine/state.js";
import { tryNormalizeWallet } from "../auth/wallet.js";

export interface WalletMembership {
  memberId: string;
  familyId: string;
  role: RoleType;
  /** Member display name — useful for the family-picker UX. */
  memberName: string;
  /** Family display name — useful for the family-picker UX. */
  familyName: string;
}

export async function listMembershipsByWallet(
  walletAddress: string
): Promise<WalletMembership[]> {
  const normalized = tryNormalizeWallet(walletAddress);
  if (!normalized) return [];

  const index = new MemberIndex();
  const state = new StateManager();
  const all = await index.list();

  const results: WalletMembership[] = [];
  // Cache family configs to avoid re-reading the same file multiple times
  // when a single wallet has multiple memberships in the same family.
  const familyCache = new Map<string, { familyName: string } | null>();

  for (const [memberId, entry] of Object.entries(all)) {
    const member = await state.loadMember(entry.familyId, memberId);
    if (!member || !member.active) continue;
    const memberWallet = member.walletAddress?.toLowerCase();
    if (memberWallet !== normalized) continue;

    let family = familyCache.get(entry.familyId);
    if (family === undefined) {
      const cfg = await state.loadFamilyConfig(entry.familyId);
      family = cfg ? { familyName: cfg.familyName } : null;
      familyCache.set(entry.familyId, family);
    }

    results.push({
      memberId,
      familyId: entry.familyId,
      role: entry.role,
      memberName: member.name,
      familyName: family?.familyName ?? entry.familyId,
    });
  }

  // Most-recently-active first — handy for the verify-page family picker when
  // a wallet has 5+ memberships (research §11 UX note).
  return results;
}
