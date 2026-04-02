import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { InviteSystem } from "../invites/system.js";
import { RoleManager } from "../roles/manager.js";
import type { Member } from "../schemas.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

export function registerAcceptInviteTool(server: McpServer): void {
  server.tool(
    "accept-invite",
    "Accept a family invite using an invite code. This will connect you to the family's AllowanceAgent with the assigned role.",
    {
      code: z.string().describe("The invite code (e.g. MAYA-GIFT-7X2K)"),
      name: z.string().describe("Your name"),
      ...rbacFields,
    },
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("accept-invite", caller.role)) {
        return buildAccessDeniedResponse("accept-invite", caller.role);
      }
      try {
        const state = new StateManager();
        const inviteSystem = new InviteSystem();
        const roleManager = new RoleManager();

        // Validate invite
        const invites = await state.loadInvites();
        const invite = inviteSystem.validateInvite(args.code, invites);

        if (!invite) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: "Invalid, expired, or already-used invite code.",
              }),
            }],
          };
        }

        // Create OWS API key with role-mapped policy
        const apiKeyResult = await roleManager.createRoleApiKey(
          args.name,
          invite.role
        );

        // Create member record
        const member: Member = {
          id: randomUUID(),
          name: args.name,
          role: invite.role,
          apiKeyId: apiKeyResult?.id,
          joinedAt: new Date().toISOString(),
          active: true,
        };

        await state.addMember(member);

        // Mark invite as used
        invite.used = true;
        invite.usedBy = member.id;
        invite.usedAt = new Date().toISOString();
        await state.saveInvites(invites);

        // Audit
        await state.addAuditEntry({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "invite-accepted",
          actor: member.id,
          details: {
            inviteCode: args.code,
            name: args.name,
            role: invite.role,
          },
        });

        const roleDescription = {
          manager: "full control over the family economy",
          "co-parent": "verify achievements and view progress",
          family: "view progress and send gifts",
          advisor: "view the audit log",
        }[invite.role];

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              name: args.name,
              role: invite.role,
              message: `Welcome, ${args.name}! You're connected as a ${invite.role} member. You can ${roleDescription}.`,
            }),
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
  );
}
