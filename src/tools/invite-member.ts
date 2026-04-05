import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { InviteSystem } from "../invites/system.js";
import { RoleEnum } from "../schemas.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

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
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("invite-member", caller.role)) {
        return buildAccessDeniedResponse("invite-member", caller.role);
      }
      try {
        const state = new StateManager();
        const inviteSystem = new InviteSystem();

        const config = await state.loadFamilyConfig();
        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured." }),
            }],
          };
        }

        // Learner role requires childName
        if (args.role === "learner" && !args.childName) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "childName required for learner role" }),
            }],
          };
        }

        // Validate childName exists in family config if provided
        if (args.childName) {
          const childExists = config.children.some(
            (c) => c.name.toLowerCase() === args.childName!.toLowerCase()
          );
          if (!childExists) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ success: false, error: `child "${args.childName}" not found in family config` }),
              }],
            };
          }
        }

        // Determine child name for invite code prefix
        const childName = args.childName || (config.children.length > 0 ? config.children[0].name : "FAMILY");

        // Generate invite
        const invite = inviteSystem.generateInvite(
          args.role,
          childName,
          config.familyName,
          caller.memberId
        );

        await state.addInvite(invite);

        // Audit
        await state.addAuditEntry({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "invite-created",
          actor: caller.memberId,
          details: {
            inviteCode: invite.code,
            invitedName: args.name,
            role: args.role,
            childName: args.childName,
          },
        });

        const roleDescription: Record<string, string> = {
          manager: "full control — set rules, approve progress, manage funds",
          "co-parent": "approve achievements and see progress, no fund access",
          family: "see progress and send gifts",
          advisor: "view estate audit log only",
          learner: "see your progress and savings, report achievements",
        };

        // Build response with optional serverUrl + joinMessage
        const serverUrl = process.env.ALLOWANCE_AGENT_URL || undefined;
        const joinMessage = serverUrl
          ? `Your ${config.familyName} family set up your allowance! Connect your Claude to: ${serverUrl} — then tell Claude: ${invite.code}`
          : undefined;

        const responsePayload: Record<string, unknown> = {
          success: true,
          inviteCode: invite.code,
          role: args.role,
          roleDescription: roleDescription[args.role],
          expiresAt: invite.expiresAt,
        };

        if (serverUrl) {
          responsePayload.serverUrl = serverUrl;
          responsePayload.joinMessage = joinMessage;
        }

        const messageText =
          `Invite code for ${args.name}: ${invite.code}\n\n` +
          `Role: ${args.role} (${roleDescription[args.role]})\n` +
          `Valid for 48 hours. They can tell their Claude: "I have a code: ${invite.code}"` +
          (serverUrl && args.role === "learner" ? `\n\nWant me to text this to ${args.childName || "them"}?` : "");

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
  );
}
