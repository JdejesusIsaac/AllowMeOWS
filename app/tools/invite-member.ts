import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../../src/engine/state.js";
import { InviteSystem } from "../../src/invites/system.js";
import { RoleEnum } from "../../src/schemas.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";
import type { Accepts } from "aixyz/accepts";

export const accepts: Accepts = {
  scheme: "exact",
  price: "$0.003",
};

const inviteMember = tool({
  description:
    "Invite a family member by name and role. Generates a human-readable invite code. " +
    "For learner role, childName is required to scope their data access.",
  inputSchema: z.object({
    name: z.string().describe("Name of the person to invite"),
    role: RoleEnum.describe("Role: manager, co-parent, family, advisor, or learner"),
    childName: z.string().optional().describe("Required for learner role — which child this invite is for"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("invite-member", caller.role)) {
      return accessDenied("invite-member", caller.role);
    }
    try {
      const state = new StateManager();
      const inviteSystem = new InviteSystem();
      const config = await state.loadFamilyConfig();

      if (!config) {
        return JSON.stringify({ success: false, error: "No family configured." });
      }

      if (args.role === "learner" && !args.childName) {
        return JSON.stringify({ success: false, error: "childName required for learner role" });
      }

      if (args.childName) {
        const childExists = config.children.some(
          (c) => c.name.toLowerCase() === args.childName!.toLowerCase()
        );
        if (!childExists) {
          return JSON.stringify({ success: false, error: `child "${args.childName}" not found in family config` });
        }
      }

      const childName = args.childName || (config.children.length > 0 ? config.children[0].name : "FAMILY");

      const invite = inviteSystem.generateInvite(args.role, childName, config.familyName, caller.memberId);
      await state.addInvite(invite);

      await state.addAuditEntry({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        action: "invite-created",
        actor: caller.memberId,
        details: { inviteCode: invite.code, invitedName: args.name, role: args.role, childName: args.childName },
      });

      const roleDescription: Record<string, string> = {
        manager: "full control — set rules, approve progress, manage funds",
        "co-parent": "approve achievements and see progress, no fund access",
        family: "see progress and send gifts",
        advisor: "view estate audit log only",
        learner: "see your progress and savings, report achievements",
      };

      const serverUrl = process.env.ALLOWANCE_AGENT_URL || undefined;
      const joinMessage = serverUrl
        ? `Your ${config.familyName} family set up your allowance! Connect your Claude to: ${serverUrl} — then tell Claude: ${invite.code}`
        : undefined;

      return JSON.stringify({
        success: true,
        inviteCode: invite.code,
        role: args.role,
        roleDescription: roleDescription[args.role],
        expiresAt: invite.expiresAt,
        serverUrl,
        joinMessage,
        message: `Invite code for ${args.name}: ${invite.code}\nRole: ${args.role} (${roleDescription[args.role]})\nValid for 48 hours.`,
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
});

export default inviteMember;
