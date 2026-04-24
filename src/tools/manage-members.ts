import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { RoleManager } from "../roles/manager.js";
import { RoleEnum } from "../schemas.js";
import { MemberIndex } from "../identity/member-index.js";
import { SetupCodeStore } from "../identity/setup-codes.js";
import type { Role } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
} from "../middleware/access-control.js";

export function registerManageMembersTool(server: McpServer): void {
  server.tool(
    "manage-members",
    "List, update roles, or remove family members. Manager only.",
    {
      action: z.enum(["list", "change-role", "remove"]).describe("What to do"),
      memberName: z.string().optional().describe("Name of member (required for change-role and remove)"),
      newRole: RoleEnum.optional().describe("New role (required for change-role)"),
      ...rbacFields,
    },
    withAccessControl("manage-members", async (args, caller) => {
      if (!caller) return buildNoIdentityResponse("manage-members");
      const action = args.action as "list" | "change-role" | "remove";
      const memberName = args.memberName as string | undefined;
      const newRole = args.newRole as Role | undefined;
      try {
        const state = new StateManager();
        const roleManager = new RoleManager();
        const index = new MemberIndex();
        const setupCodes = new SetupCodeStore();
        const familyId = caller.familyId;
        const members = await state.loadMembers(familyId);

        // === LIST ===
        if (action === "list") {
          const memberList = members
            .filter((m) => m.active)
            .map((m) => ({
              name: m.name,
              role: m.role,
              joinedAt: m.joinedAt,
              lastActivity: m.lastActivity || "never",
            }));

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                members: memberList,
                totalActive: memberList.length,
              }),
            }],
          };
        }

        // === CHANGE ROLE ===
        if (action === "change-role") {
          if (!memberName || !newRole) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: "memberName and newRole are required for change-role.",
                }),
              }],
            };
          }

          const member = members.find(
            (m) => m.name.toLowerCase() === memberName.toLowerCase() && m.active
          );
          if (!member) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Active member "${memberName}" not found.`,
                }),
              }],
            };
          }

          // Revoke old key + create new one (revoke-and-recreate pattern)
          await roleManager.changeRole(member, newRole);

          const oldRole = member.role;
          member.role = newRole;
          await state.saveMembers(familyId, members);

          // Update global member-index to reflect the new role.
          await index.set(member.id, familyId, newRole);

          // Revoke any active setup codes — they encoded the old role and
          // should no longer be honored. The member must re-issue or accept
          // a fresh invite.
          const revoked = await setupCodes.revokeForMember(member.id);

          await state.addAuditEntry(familyId, {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            action: "role-changed",
            actor: caller.memberId,
            details: {
              memberName: member.name,
              oldRole,
              newRole,
              revokedSetupCodes: revoked,
            },
          });

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: `${member.name}'s role changed from ${oldRole} to ${newRole}. New access key issued.`,
              }),
            }],
          };
        }

        // === REMOVE ===
        if (action === "remove") {
          if (!memberName) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ success: false, error: "memberName is required for remove." }),
              }],
            };
          }

          const member = members.find(
            (m) => m.name.toLowerCase() === memberName.toLowerCase() && m.active
          );
          if (!member) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Active member "${memberName}" not found.`,
                }),
              }],
            };
          }

          // Revoke OWS API key
          if (member.apiKeyId) {
            await roleManager.revokeRoleApiKey(member.apiKeyId);
          }

          member.active = false;
          await state.saveMembers(familyId, members);

          // Remove from global member-index and revoke all setup codes.
          await index.remove(member.id);
          const revoked = await setupCodes.revokeForMember(member.id);

          await state.addAuditEntry(familyId, {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            action: "member-removed",
            actor: caller.memberId,
            details: { memberName: member.name, role: member.role, revokedSetupCodes: revoked },
          });

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: `${member.name} has been removed. Their access key has been revoked — they can no longer access the family economy.`,
              }),
            }],
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: false, error: "Unknown action." }),
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
    })
  );
}
