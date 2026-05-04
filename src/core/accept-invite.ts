/**
 * Sprint 3.0 v4 — W1.12: extracted `accept-invite` / `redeem-invite` core.
 *
 * Both the MCP tool wrapper (`src/tools/accept-invite.ts`) and the HTTP
 * endpoint (`POST /api/redeem-invite`, W1.9) call into this module.
 *
 * Design contract: see `src/core/configure-family.ts` — same pattern. Core
 * owns state mutation + audit; callers translate domain results to their
 * own response formats.
 *
 * SIWE integration: when the caller path is the verify page (HTTP), the
 * SIWE-verified wallet address is threaded through as `acceptorWalletAddress`
 * and stored on the new Member record. Inline MCP invite acceptance (sprint
 * ≤2.9.1 behavior) passes `undefined`.
 */

import { randomUUID } from "node:crypto";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import { InviteSystem } from "../invites/system.js";
import { RoleManager } from "../roles/manager.js";
import { MemberIndex } from "../identity/member-index.js";
import { SetupCodeStore } from "../identity/setup-codes.js";
import type { Invite, Member, RoleType } from "../schemas.js";

export interface AcceptInviteInput {
  code: string;
  name: string;
  /**
   * Sprint 3.0 v4: threaded onto the new Member record when the invite is
   * redeemed via the verify page. `undefined` for Learner/Advisor paths and
   * for legacy inline MCP acceptance.
   */
  acceptorWalletAddress?: string;
}

export interface AcceptInviteSuccess {
  ok: true;
  name: string;
  role: RoleType;
  childName?: string;
  familyId: string;
  memberId: string;
  setupCode: string;
  mcpUrl: string;
}

export interface AcceptInviteFailure {
  ok: false;
  error: string;
  reason?:
    | "invite-not-found"
    | "child-not-found"
    | "invite-expired"
    | "invite-already-used";
}

export type AcceptInviteResult = AcceptInviteSuccess | AcceptInviteFailure;

/**
 * Core entry point for invite redemption. Scans all families' invite lists
 * for the provided code (codes are globally unique), validates the target
 * family's child config if the invite is Learner-scoped, creates the
 * Member record, registers in MemberIndex, marks the invite used, and
 * issues a setup code.
 */
export async function acceptInviteCore(
  input: AcceptInviteInput
): Promise<AcceptInviteResult> {
  const state = new StateManager();
  const inviteSystem = new InviteSystem();
  const index = new MemberIndex();

  const familyIds = await state.listFamilies();
  let matchingInvite: Invite | null = null;
  let matchingFamilyId: string | null = null;
  for (const fid of familyIds) {
    const invites = await state.loadInvites(fid);
    const candidate = inviteSystem.validateInvite(input.code, invites);
    if (candidate) {
      matchingInvite = candidate;
      matchingFamilyId = fid;
      break;
    }
  }

  if (!matchingInvite || !matchingFamilyId) {
    return {
      ok: false,
      error: "Invalid, expired, or already-used invite code.",
      reason: "invite-not-found",
    };
  }

  const invite = matchingInvite;
  const familyId = matchingFamilyId;

  if (invite.role === "learner" && invite.childName) {
    const config = await state.loadFamilyConfig(familyId);
    if (config) {
      const childExists = config.children.some(
        (c) => c.name.toLowerCase() === invite.childName!.toLowerCase()
      );
      if (!childExists) {
        return {
          ok: false,
          error: "child not found in family config",
          reason: "child-not-found",
        };
      }
    }
  }

  // Per-family OWS vault (Sprint 2.9.1) — the new member's API key is
  // scoped to the inviting family's vault, not a global one.
  const roleManager = new RoleManager(undefined, getFamilyVaultPath(familyId));
  const apiKeyResult = await roleManager.createRoleApiKey(input.name, invite.role);

  const memberId = randomUUID();
  const member: Member = {
    id: memberId,
    name: input.name,
    role: invite.role,
    childName: invite.role === "learner" ? invite.childName : undefined,
    walletAddress: input.acceptorWalletAddress?.toLowerCase(),
    apiKeyId: apiKeyResult?.id,
    joinedAt: new Date().toISOString(),
    active: true,
  };

  await state.addMember(familyId, member);
  await index.set(memberId, familyId, invite.role);

  const invites = await state.loadInvites(familyId);
  const toMark = invites.find((i) => i.code === invite.code);
  if (toMark) {
    toMark.used = true;
    toMark.usedBy = memberId;
    toMark.usedAt = new Date().toISOString();
    await state.saveInvites(familyId, invites);
  }

  await state.addAuditEntry(familyId, {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action: "invite-accepted",
    actor: memberId,
    details: {
      inviteCode: input.code,
      name: input.name,
      role: invite.role,
      ...(input.acceptorWalletAddress
        ? { walletAddress: input.acceptorWalletAddress.toLowerCase() }
        : {}),
    },
  });

  const setupCodes = new SetupCodeStore();
  const setupCode = await setupCodes.issue(memberId);
  const baseUrl = process.env.ALLOWANCE_AGENT_URL || "https://allowme.dev";
  const mcpUrl = `${baseUrl}/mcp?setup=${setupCode}`;

  return {
    ok: true,
    name: input.name,
    role: invite.role,
    childName: member.childName,
    familyId,
    memberId,
    setupCode,
    mcpUrl,
  };
}

/**
 * Human-readable role descriptions used by both the MCP tool response and
 * the verify-page success state. Exported so wrappers share the exact copy.
 */
export const ROLE_DESCRIPTIONS: Record<RoleType, string> = {
  manager: "full control over the family economy",
  "co-parent": "verify achievements and view progress",
  family: "view progress and send gifts",
  advisor: "view the audit log",
  learner: "see your progress and savings, report achievements",
};
