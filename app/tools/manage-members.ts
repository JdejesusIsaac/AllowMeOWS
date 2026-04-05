import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../../src/engine/state.js";
import { RoleManager } from "../../src/roles/manager.js";
import { RoleEnum } from "../../src/schemas.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";

const manageMembers = tool({
  description: "List, update roles, or remove family members. Manager only.",
  inputSchema: z.object({
    action: z.enum(["list", "change-role", "remove"]).describe("What to do"),
    memberName: z.string().optional().describe("Name of member (required for change-role and remove)"),
    newRole: RoleEnum.optional().describe("New role (required for change-role)"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("manage-members", caller.role)) {
      return accessDenied("manage-members", caller.role);
    }
    try {
      const state = new StateManager();
      const roleManager = new RoleManager();
      const members = await state.loadMembers();

      if (args.action === "list") {
        const memberList = members.filter((m) => m.active).map((m) => ({
          name: m.name, role: m.role, joinedAt: m.joinedAt, lastActivity: m.lastActivity || "never",
        }));
        return JSON.stringify({ success: true, members: memberList, totalActive: memberList.length });
      }

      if (args.action === "change-role") {
        if (!args.memberName || !args.newRole) {
          return JSON.stringify({ success: false, error: "memberName and newRole are required." });
        }
        const member = members.find((m) => m.name.toLowerCase() === args.memberName!.toLowerCase() && m.active);
        if (!member) return JSON.stringify({ success: false, error: `Active member "${args.memberName}" not found.` });

        await roleManager.changeRole(member, args.newRole);
        const oldRole = member.role;
        member.role = args.newRole;
        await state.saveMembers(members);

        await state.addAuditEntry({
          id: randomUUID(), timestamp: new Date().toISOString(), action: "role-changed",
          actor: caller.memberId, details: { memberName: member.name, oldRole, newRole: args.newRole },
        });

        return JSON.stringify({ success: true, message: `${member.name}'s role changed from ${oldRole} to ${args.newRole}.` });
      }

      if (args.action === "remove") {
        if (!args.memberName) return JSON.stringify({ success: false, error: "memberName is required." });
        const member = members.find((m) => m.name.toLowerCase() === args.memberName!.toLowerCase() && m.active);
        if (!member) return JSON.stringify({ success: false, error: `Active member "${args.memberName}" not found.` });

        if (member.apiKeyId) await roleManager.revokeRoleApiKey(member.apiKeyId);
        member.active = false;
        await state.saveMembers(members);

        await state.addAuditEntry({
          id: randomUUID(), timestamp: new Date().toISOString(), action: "member-removed",
          actor: caller.memberId, details: { memberName: member.name, role: member.role },
        });

        return JSON.stringify({ success: true, message: `${member.name} has been removed.` });
      }

      return JSON.stringify({ success: false, error: "Unknown action." });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
});

export default manageMembers;
