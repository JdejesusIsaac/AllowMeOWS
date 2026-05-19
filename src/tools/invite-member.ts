import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { StateManager } from "../engine/state.js";
import { InviteSystem } from "../invites/system.js";
import { RoleEnum } from "../schemas.js";
import type { Role } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";

/**
 * Inner handler for `invite-member`. Exported separately from
 * `registerInviteMemberTool` so copy-contract tests can invoke it without
 * going through the McpServer transport. Matches the view-policy.ts pattern.
 */
export async function inviteMemberHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("invite-member");
  const inviteeName = args.name as string;
  const role = args.role as Role;
  const argChildName = args.childName as string | undefined;
  try {
    const state = new StateManager();
    const inviteSystem = new InviteSystem();
    const familyId = caller.familyId;

    const config = await state.loadFamilyConfig(familyId);
    if (!config) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: false, error: "No family configured." }),
        }],
      };
    }

    if (role === "learner" && !argChildName) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: false, error: "childName required for learner role" }),
        }],
      };
    }

    if (argChildName) {
      const childExists = config.children.some(
        (c) => c.name.toLowerCase() === argChildName.toLowerCase()
      );
      if (!childExists) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: false, error: `child "${argChildName}" not found in family config` }),
          }],
        };
      }
    }

    const childName = argChildName || (config.children.length > 0 ? config.children[0].name : "FAMILY");

    // Generate invite — familyId is stamped on the invite so accept-invite
    // can route the new member into the correct family regardless of who
    // accepts it.
    const invite = inviteSystem.generateInvite(
      role,
      childName,
      familyId,
      caller.memberId
    );

    await state.addInvite(familyId, invite);

    await state.addAuditEntry(familyId, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: "invite-created",
      actor: caller.memberId,
      details: {
        inviteCode: invite.code,
        invitedName: inviteeName,
        role,
        childName: argChildName,
      },
    });

    const roleDescription: Record<string, string> = {
      manager: "full control — set rules, approve progress, manage funds",
      "co-parent": "approve achievements and see progress, no fund access",
      family: "see progress and send gifts",
      advisor: "view estate audit log only",
      learner: "see your progress and savings, report achievements",
    };

    const serverUrl = process.env.ALLOWANCE_AGENT_URL || undefined;

    // Sprint 3.0 v4 (W2.5): surface the verify-page URL so Managers can
    // text/email a single link that auto-fills the invite code and role.
    const verifyBase = process.env.ALLOWANCE_AGENT_URL || "https://allowme.dev";
    const verifyUrl = `${verifyBase}/verify?invite=${invite.code}&role=${role}`;

    const familySuffix = config.familyName.toLowerCase().endsWith("family") ? "" : " family";
    const joinMessage = serverUrl
      ? `Hi ${argChildName ?? "there"}! Your ${config.familyName}${familySuffix} ` +
        `set up your allowance on AllowMe. ` +
        `Tap this link on your phone to join (open in Safari/Chrome, NOT in Claude/ChatGPT): ` +
        `${verifyUrl}`
      : undefined;

    const responsePayload: Record<string, unknown> = {
      success: true,
      inviteCode: invite.code,
      role,
      roleDescription: roleDescription[role],
      expiresAt: invite.expiresAt,
    };

    if (serverUrl) {
      responsePayload.serverUrl = serverUrl;
      responsePayload.joinMessage = joinMessage;
    }

    responsePayload.verifyUrl = verifyUrl;

    const inviteQrCode = await QRCode.toDataURL(verifyUrl, { width: 256, margin: 1 });
    responsePayload.inviteQrCode = inviteQrCode;

    const expiryHours = 48;
    const messageText =
      `${argChildName ? argChildName : "They"} are invited as a **${role}** ` +
      `(${roleDescription[role]}).\n\n` +
      `**Scan this QR code** with their phone camera (easiest), or send the link below.\n\n` +
      `![Scan with phone camera](${inviteQrCode})\n\n` +
      `**Send them this link.** They should tap it on their phone in a browser ` +
      `(Safari, Chrome, etc.), then follow the steps on the page.\n\n` +
      `🔗 ${verifyUrl}\n\n` +
      `The page will set them up and give them a personal AllowMe link to paste ` +
      `into Claude or ChatGPT. **They do NOT paste THIS link into Claude/ChatGPT directly** ` +
      `— this link is for their browser only.\n\n` +
      `*Invite expires in ${expiryHours} hours.*\n\n` +
      `_If the link doesn't work, the fallback is: connect them to ` +
      `https://allowme.dev/mcp first, then have them say "I have a code: ${invite.code}". ` +
      `This requires reinstalling the connector after, so the link above is much smoother._\n\n` +
      `Want me to draft a text message to send them?`;

    responsePayload.message = messageText;

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(responsePayload),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      }],
    };
  }
}

export function registerInviteMemberTool(server: McpServer): void {
  server.tool(
    "invite-member",
    "Invite a family member by name and role. Generates a human-readable invite code they can use to connect.",
    {
      name: z.string().describe("Name of the person to invite (e.g. 'Grandma Rosa')"),
      role: RoleEnum.describe("Role to assign: manager, co-parent, family, advisor, or learner"),
      childName: z.string().optional().describe("If relevant, which child this invite is associated with"),
      ...rbacFields,
    },
    withAccessControl("invite-member", inviteMemberHandler)
  );
}
