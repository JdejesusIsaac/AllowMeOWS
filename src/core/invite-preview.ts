/**
 * Sprint 3.0 v4 — invite preview (read-only companion to acceptInviteCore).
 *
 * SECURITY CRITICAL: this module MUST NOT mutate state under any
 * circumstance. Consumption is the sole responsibility of
 * `acceptInviteCore` at the redemption path. A flaky preview must
 * never burn a parent-generated invite. See
 * `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/sprint-3.0/research-3.0-v4.md`
 * for the full threat-model writeup and the failure-mode table.
 */

import { StateManager } from "../engine/state.js";
import type { RoleType } from "../schemas.js";

/**
 * Canonical invite-code shape produced by
 * `@/Users/juanisaac/Desktop/allowmeOpenWalletStandard/src/invites/system.ts:12`:
 *   `{NAME_PREFIX}-{ROLE_HINT}-{SUFFIX}`
 * - NAME_PREFIX: 1-4 uppercase [A-Z]
 * - ROLE_HINT:   ADMIN | COPRT | GIFT | ADVSR | LEARN | JOIN (always uppercase, ≥3)
 * - SUFFIX:      exactly 4 chars from [A-HJ-NP-Z2-9] (Crockford-ish, no 0/O/1/I)
 *
 * We normalize case (uppercase) before matching — the rest of the system
 * already does (see `InviteSystem.validateInvite`).
 */
export const INVITE_CODE_REGEX = /^[A-Z]{1,4}-[A-Z]{3,5}-[A-HJ-NP-Z2-9]{4}$/;

export interface InvitePreview {
  familyName: string;
  role: RoleType;
  childName?: string; // Learner-role only
  expiresAt: string;
}

export class InviteUsedError extends Error {
  constructor() {
    super("Invite has already been redeemed");
    this.name = "InviteUsedError";
  }
}

export class InviteExpiredError extends Error {
  constructor() {
    super("Invite has expired");
    this.name = "InviteExpiredError";
  }
}

export class InviteMalformedError extends Error {
  constructor() {
    super("Invite code is malformed");
    this.name = "InviteMalformedError";
  }
}

/**
 * Resolve invite metadata for the verify page without consuming the invite.
 *
 * Returns `null` if the invite code does not match any known invite.
 * Throws `InviteUsedError`, `InviteExpiredError`, or
 * `InviteMalformedError` for other failure modes; the HTTP layer maps
 * these to status codes (400/404/410) per the research doc table.
 *
 * Implementation: linear scan over all families' invite files, identical
 * to the approach `acceptInviteCore` takes. Codes are globally unique by
 * construction (`NAME_PREFIX-ROLE_HINT-SUFFIX` with 20 bits of SUFFIX
 * entropy per (family, child, role) partition), so the first match is
 * authoritative.
 */
export async function previewInvite(
  code: string
): Promise<InvitePreview | null> {
  const normalized = typeof code === "string" ? code.toUpperCase().trim() : "";
  if (!INVITE_CODE_REGEX.test(normalized)) {
    throw new InviteMalformedError();
  }

  const state = new StateManager();
  const families = await state.listFamilies();
  for (const fid of families) {
    const invites = await state.loadInvites(fid);
    const match = invites.find((i) => i.code === normalized);
    if (!match) continue;

    // Order matters: an expired-AND-used invite surfaces as used (the
    // more-actionable failure for the recipient). `acceptInviteCore`'s
    // `InviteSystem.validateInvite` uses the same precedence.
    if (match.used) throw new InviteUsedError();
    if (new Date(match.expiresAt).getTime() <= Date.now()) {
      throw new InviteExpiredError();
    }

    const config = await state.loadFamilyConfig(fid);
    const preview: InvitePreview = {
      familyName: config?.familyName ?? "Unknown",
      role: match.role,
      expiresAt: match.expiresAt,
    };
    if (match.role === "learner" && match.childName) {
      preview.childName = match.childName;
    }
    return preview;
  }

  return null; // well-formed, unknown code
}
