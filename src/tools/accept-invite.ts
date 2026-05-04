import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { acceptInviteCore, ROLE_DESCRIPTIONS } from "../core/accept-invite.js";
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
      // accept-invite is in UNIDENTIFIED_CALLER_TOOLS — caller may be null
      // (brand-new user) or an existing member. Either way, the invite itself
      // carries the target familyId.
      try {
        const result = await acceptInviteCore({
          code: args.code as string,
          name: args.name as string,
          // MCP inline acceptance path: no SIWE, no wallet address threaded.
          // The verify page's `/api/redeem-invite` endpoint (W1.9) will pass
          // the SIWE-verified address for adult invites.
        });

        if (!result.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: false, error: result.error }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                name: result.name,
                role: result.role,
                childName: result.childName,
                familyId: result.familyId,
                memberId: result.memberId,
                setupCode: result.setupCode,
                mcpUrl: result.mcpUrl,
                message:
                  `Welcome, ${result.name}! You're connected as a ${result.role} member. ` +
                  `You can ${ROLE_DESCRIPTIONS[result.role]}. ` +
                  `To continue using AllowanceAgent in your own Claude, update your MCP connector URL to:\n\n${result.mcpUrl}\n\n` +
                  `The setup code expires in 48 hours.`,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            },
          ],
        };
      }
    })
  );
}
