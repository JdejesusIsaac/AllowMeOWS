import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { RoleManager } from "../roles/manager.js";
import { RoleEnum } from "../schemas.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

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
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("manage-members", caller.role)) {
        return buildAccessDeniedResponse("manage-members", caller.role);
      }
      try {
        const state = new StateManager();
        const roleManager = new RoleManager();
        const members = await state.loadMembers();

        // === LIST ===
        if (args.action === "list") {
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
        if (args.action === "change-role") {
          if (!args.memberName || !args.newRole) {
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
            (m) => m.name.toLowerCase() === args.memberName!.toLowerCase() && m.active
          );
          if (!member) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Active member "${args.memberName}" not found.`,
                }),
              }],
            };
          }

          // Revoke old key + create new one (revoke-and-recreate pattern)
          await roleManager.changeRole(member, args.newRole);

          const oldRole = member.role;
          member.role = args.newRole;
          await state.saveMembers(members);

          await state.addAuditEntry({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            action: "role-changed",
            actor: "manager",
            details: {
              memberName: member.name,
              oldRole,
              newRole: args.newRole,
            },
          });

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: `${member.name}'s role changed from ${oldRole} to ${args.newRole}. New access key issued.`,
              }),
            }],
          };
        }

        // === REMOVE ===
        if (args.action === "remove") {
          if (!args.memberName) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ success: false, error: "memberName is required for remove." }),
              }],
            };
          }

          const member = members.find(
            (m) => m.name.toLowerCase() === args.memberName!.toLowerCase() && m.active
          );
          if (!member) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Active member "${args.memberName}" not found.`,
                }),
              }],
            };
          }

          // Revoke OWS API key
          if (member.apiKeyId) {
            await roleManager.revokeRoleApiKey(member.apiKeyId);
          }

          member.active = false;
          await state.saveMembers(members);

          await state.addAuditEntry({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            action: "member-removed",
            actor: "manager",
            details: { memberName: member.name, role: member.role },
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
    }
  );
}
