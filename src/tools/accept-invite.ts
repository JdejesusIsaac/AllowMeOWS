import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { InviteSystem } from "../invites/system.js";
import { RoleManager } from "../roles/manager.js";
import { MemberIndex } from "../identity/member-index.js";
import { SetupCodeStore } from "../identity/setup-codes.js";
import type { Invite, Member } from "../schemas.js";
import { withAccessControl, rbacFields } from "../middleware/access-control.js";

export function registerAcceptInviteTool(server: McpServer): void {
  server.tool(
    "accept-invite",
    "Accept a family invite using an invite code. This will connect you to the family's AllowanceAgent with the assigned role.",
    {
      code: z.string().describe("The invite code (e.g. MAYA-GIFT-7X2K)"),
      name: z.string().describe("Your name"),
      ...rbacFields,
    },
    withAccessControl("accept-invite", async (args, _caller) => {
      // Note: accept-invite is in UNIDENTIFIED_CALLER_TOOLS — caller may be
      // null (brand-new user) or an existing member of another family. In
      // either case, the invite itself carries the target familyId and that's
      // the family the new member is added to.
      const code = args.code as string;
      const name = args.name as string;
      try {
        const state = new StateManager();
        const inviteSystem = new InviteSystem();
        const roleManager = new RoleManager();
        const index = new MemberIndex();

        // Scan every family's invite list for this code. Invite codes are
        // globally unique (CHILD-ROLE-4CHAR), so at most one family matches.
        const familyIds = await state.listFamilies();
        let matchingInvite: Invite | null = null;
        let matchingFamilyId: string | null = null;
        for (const fid of familyIds) {
          const invites = await state.loadInvites(fid);
          const candidate = inviteSystem.validateInvite(code, invites);
          if (candidate) {
            matchingInvite = candidate;
            matchingFamilyId = fid;
            break;
          }
        }

        if (!matchingInvite || !matchingFamilyId) {
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

        const invite = matchingInvite;
        const familyId = matchingFamilyId;

        // Create OWS API key with role-mapped policy
        const apiKeyResult = await roleManager.createRoleApiKey(name, invite.role);

        // For learner invites, validate childName exists in target family config
        if (invite.role === "learner" && invite.childName) {
          const config = await state.loadFamilyConfig(familyId);
          if (config) {
            const childExists = config.children.some(
              (c) => c.name.toLowerCase() === invite.childName!.toLowerCase()
            );
            if (!childExists) {
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({ success: false, error: "child not found in family config" }),
                }],
              };
            }
          }
        }

        // Create member record (copy childName from invite for learner role)
        const memberId = randomUUID();
        const member: Member = {
          id: memberId,
          name,
          role: invite.role,
          childName: invite.role === "learner" ? invite.childName : undefined,
          apiKeyId: apiKeyResult?.id,
          joinedAt: new Date().toISOString(),
          active: true,
        };

        await state.addMember(familyId, member);

        // Register in global member-index so future requests from this member
        // (via X-Member-Id header, setup code, or _callerId arg) resolve to
        // the right family and role.
        await index.set(memberId, familyId, invite.role);

        // Mark invite as used — reload the target family's invite list, flip
        // the flag on the matching entry, and persist.
        const invites = await state.loadInvites(familyId);
        const toMark = invites.find((i) => i.code === invite.code);
        if (toMark) {
          toMark.used = true;
          toMark.usedBy = memberId;
          toMark.usedAt = new Date().toISOString();
          await state.saveInvites(familyId, invites);
        }

        // Audit
        await state.addAuditEntry(familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "invite-accepted",
          actor: memberId,
          details: {
            inviteCode: code,
            name,
            role: invite.role,
          },
        });

        // Issue a setup code so the new member can update their MCP URL and
        // authenticate on subsequent requests.
        const setupCodes = new SetupCodeStore();
        const setupCode = await setupCodes.issue(memberId);
        const baseUrl = process.env.ALLOWANCE_AGENT_URL || "https://allowme.dev";
        const mcpUrl = `${baseUrl}/mcp?setup=${setupCode}`;

        const roleDescription: Record<string, string> = {
          manager: "full control over the family economy",
          "co-parent": "verify achievements and view progress",
          family: "view progress and send gifts",
          advisor: "view the audit log",
          learner: "see your progress and savings, report achievements",
        };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              name,
              role: invite.role,
              childName: member.childName,
              familyId,
              memberId,
              setupCode,
              mcpUrl,
              message:
                `Welcome, ${name}! You're connected as a ${invite.role} member. ` +
                `You can ${roleDescription[invite.role]}. ` +
                `To continue using AllowanceAgent in your own Claude, update your MCP connector URL to:\n\n${mcpUrl}\n\n` +
                `The setup code expires in 48 hours.`,
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
    })
  );
}
