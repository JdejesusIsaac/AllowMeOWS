/**
 * Sprint 3.6 — `resend-invite` MCP tool (Deliverable 4 / failure-recovery).
 *
 * Manager-only. Resends an invite for an already-named family member.
 * Mechanic:
 *   1. Find any *active* invite (not used, not expired) matching the
 *      requested role and (for learners) childName.
 *   2. Remove it from the active invites list — revocation is implemented
 *      as deletion, no `revoked` field added to `InviteSchema` (contract C10).
 *   3. Emit an `invite-revoked` audit entry (Sprint 3.6 audit-enum addition).
 *   4. Delegate to `inviteMemberHandler` to issue a fresh invite (preserves
 *      response copy and the existing `invite-created` audit entry).
 *   5. Augment the response with `revokedInviteCode` so the caller sees
 *      both events surfaced.
 *
 * RBAC: Manager-only via `ROLE_TOOL_ACCESS[MANAGER]` (C11).
 *
 * Inner handler exported separately from the registration helper so tests
 * can call it directly without going through the MCP transport
 * (matches the Sprint 3.0.6 `view-policy` pattern).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { RoleEnum } from "../schemas.js";
import type { Role } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";
import { inviteMemberHandler } from "./invite-member.js";

function errResponse(msg: string): ToolResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: false, error: msg }),
      },
    ],
  };
}

export async function resendInviteHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null,
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("resend-invite");

  const role = args.role as Role;
  const argChildName = args.childName as string | undefined;

  try {
    const state = new StateManager();
    const familyId = caller.familyId;

    if (role === "learner" && !argChildName) {
      return errResponse("childName required for learner role");
    }

    const config = await state.loadFamilyConfig(familyId);
    if (!config) return errResponse("No family configured.");

    if (argChildName && role === "learner") {
      const childExists = config.children.some(
        (c) => c.name.toLowerCase() === argChildName.toLowerCase(),
      );
      if (!childExists) {
        return errResponse(`child "${argChildName}" not found in family config`);
      }
    }

    const invites = await state.loadInvites(familyId);
    const now = new Date();
    const existing = invites.find(
      (inv) =>
        !inv.used &&
        new Date(inv.expiresAt) > now &&
        inv.role === role &&
        (argChildName
          ? inv.childName?.toLowerCase() === argChildName.toLowerCase()
          : true),
    );

    if (!existing) {
      return errResponse(
        `no active invite found for ${role}${argChildName ? ` (${argChildName})` : ""}`,
      );
    }

    // Revoke: drop from active list. No `revoked` field on the schema — the
    // absence from `invites.json` IS the revoked state. The audit entry is
    // the durable record of what happened.
    const remaining = invites.filter((inv) => inv.code !== existing.code);
    await state.saveInvites(familyId, remaining);

    await state.addAuditEntry(familyId, {
      id: randomUUID(),
      timestamp: now.toISOString(),
      action: "invite-revoked",
      actor: caller.memberId,
      details: {
        inviteCode: existing.code,
        role: existing.role,
        childName: existing.childName,
        reason: "resend-invite",
      },
    });

    // Issue fresh invite via the existing inviteMemberHandler. This preserves
    // the full response shape (verifyUrl, joinMessage, message copy, RBAC
    // audit, etc.) and emits the standard `invite-created` audit entry —
    // so the audit log shows both events with consistent field shapes (C4).
    const issued = await inviteMemberHandler(
      {
        name: argChildName ?? existing.childName ?? "Member",
        role,
        childName: argChildName,
        // Pass through any RBAC fields the caller supplied so the handler
        // resolves the same caller identity.
        _callerRole: args._callerRole,
        _callerId: args._callerId,
        _familyId: args._familyId,
      },
      caller,
    );

    const issuedBody = JSON.parse(issued.content[0]!.text);
    if (!issuedBody.success) {
      // Inner handler refused (validation error etc.). Surface as-is — the
      // revoke already happened, so the caller's family is in a "no active
      // invite" state. The audit log records the revoke; the response surfaces
      // the error.
      return issued;
    }

    issuedBody.revokedInviteCode = existing.code;

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(issuedBody) },
      ],
    };
  } catch (error) {
    return errResponse(
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

export function registerResendInviteTool(server: McpServer): void {
  server.tool(
    "resend-invite",
    "Resend an invite for a family member. Revokes the active invite for the target role+child, then issues a fresh one. Manager-only.",
    {
      role: RoleEnum.describe(
        "Role of the member whose invite to resend (matches the original invite's role)",
      ),
      childName: z
        .string()
        .optional()
        .describe(
          "If role is 'learner', which child this resend is for (matches the original invite's childName)",
        ),
      ...rbacFields,
    },
    withAccessControl("resend-invite", resendInviteHandler),
  );
}
