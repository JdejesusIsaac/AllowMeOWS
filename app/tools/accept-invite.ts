import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../../src/engine/state.js";
import { RoleManager } from "../../src/roles/manager.js";
import { resolveHttpCaller } from "./_helpers.js";

const acceptInvite = tool({
  description:
    "Accept a family invite using a human-readable code. Joins the family economy with the role specified in the invite.",
  inputSchema: z.object({
    inviteCode: z.string().describe("The invite code (e.g. MAYA-GIFT-7X2K)"),
    name: z.string().describe("Your name"),
  }),
  execute: async (args) => {
    try {
      const state = new StateManager();
      const roleManager = new RoleManager();
      const invites = await state.loadInvites();

      const invite = invites.find(
        (i) => i.code.toUpperCase() === args.inviteCode.toUpperCase() && !i.used
      );
      if (!invite) {
        return JSON.stringify({ success: false, error: "Invalid or expired invite code." });
      }

      if (new Date(invite.expiresAt) < new Date()) {
        return JSON.stringify({ success: false, error: "This invite has expired." });
      }

      // Resolve HTTP caller to get wallet address for member mapping
      const caller = await resolveHttpCaller();

      const memberId = randomUUID();
      const member = {
        id: memberId,
        name: args.name,
        role: invite.role,
        childName: invite.childName,
        walletAddress: caller.memberId !== "anonymous" ? caller.memberId : undefined,
        joinedAt: new Date().toISOString(),
        active: true,
      };

      // Create OWS API key for the new member
      const apiKeyId = await roleManager.createRoleApiKey(invite.role as any, memberId);
      (member as any).apiKeyId = apiKeyId;

      await state.addMember(member);

      // Mark invite as accepted
      invite.used = true;
      invite.usedBy = memberId;
      invite.usedAt = new Date().toISOString();
      await state.saveInvites(invites);

      await state.addAuditEntry({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        action: "invite-accepted",
        actor: memberId,
        details: { inviteCode: invite.code, name: args.name, role: invite.role, childName: invite.childName },
      });

      const roleDescription: Record<string, string> = {
        manager: "Full control — you can configure, verify, distribute, and invite.",
        "co-parent": "You can verify achievements and check progress.",
        family: "You can see progress and contribute gifts.",
        advisor: "You can view the audit log.",
        learner: "You can see your progress, savings, and report achievements.",
      };

      return JSON.stringify({
        success: true,
        memberId,
        role: invite.role,
        childName: invite.childName,
        message: `Welcome, ${args.name}! You've joined as ${invite.role}. ${roleDescription[invite.role]}`,
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
});

export default acceptInvite;
