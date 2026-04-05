import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FitbitClient } from "../fitbit/client.js";
import { StateManager } from "../engine/state.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

export function registerConnectFitbitTool(server: McpServer): void {
  server.tool(
    "connect-fitbit",
    "Get the Fitbit OAuth connection URL for a child. The parent taps this link to authorize Fitbit data access. Manager only.",
    {
      childName: z.string().describe("Name of the child to connect Fitbit for"),
      ...rbacFields,
    },
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("connect-fitbit", caller.role)) {
        return buildAccessDeniedResponse("connect-fitbit", caller.role);
      }
      try {
        // Check Fitbit env vars
        if (!FitbitClient.isConfigured()) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: "Fitbit is not configured. Set FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET environment variables.",
              }),
            }],
          };
        }

        // Verify child exists
        const state = new StateManager();
        const config = await state.loadFamilyConfig();
        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured." }),
            }],
          };
        }

        const childConfig = config.children.find(
          (c) => c.name.toLowerCase() === args.childName.toLowerCase()
        );
        if (!childConfig) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Child "${args.childName}" not found. Configured children: ${config.children.map((c) => c.name).join(", ")}`,
              }),
            }],
          };
        }

        const client = new FitbitClient();

        // Check if already connected
        const alreadyConnected = await client.isChildConnected(args.childName);
        if (alreadyConnected) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                alreadyConnected: true,
                childName: args.childName,
                message: `${args.childName}'s Fitbit is already connected! To reconnect, tap the link below.`,
                connectUrl: client.getAuthUrl(args.childName),
              }),
            }],
          };
        }

        const connectUrl = client.getAuthUrl(args.childName);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              alreadyConnected: false,
              childName: args.childName,
              connectUrl,
              message: `Tap this link to connect ${args.childName}'s Fitbit:\n${connectUrl}\n\nYou'll see Fitbit's consent screen — tap "Allow" to authorize step tracking.`,
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
