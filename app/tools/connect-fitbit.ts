import { tool } from "ai";
import { z } from "zod";
import { FitbitClient } from "../../src/fitbit/client.js";
import { StateManager } from "../../src/engine/state.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";

const connectFitbit = tool({
  description:
    "Get the Fitbit OAuth connection URL for a child. The parent taps this link to authorize Fitbit data access. Manager only.",
  inputSchema: z.object({
    childName: z.string().describe("Name of the child to connect Fitbit for"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("connect-fitbit", caller.role)) {
      return accessDenied("connect-fitbit", caller.role);
    }
    try {
      if (!FitbitClient.isConfigured()) {
        return JSON.stringify({
          success: false,
          error: "Fitbit not configured. Set FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET env vars.",
        });
      }

      const state = new StateManager();
      const config = await state.loadFamilyConfig();
      if (!config) {
        return JSON.stringify({ success: false, error: "No family configured." });
      }

      const childConfig = config.children.find(
        (c) => c.name.toLowerCase() === args.childName.toLowerCase()
      );
      if (!childConfig) {
        return JSON.stringify({
          success: false,
          error: `Child "${args.childName}" not found.`,
        });
      }

      const client = new FitbitClient();
      const alreadyConnected = await client.isChildConnected(args.childName);
      const connectUrl = client.getAuthUrl(args.childName);

      return JSON.stringify({
        success: true,
        alreadyConnected,
        childName: args.childName,
        connectUrl,
        message: alreadyConnected
          ? `${args.childName}'s Fitbit is already connected. To reconnect, tap: ${connectUrl}`
          : `Tap this link to connect ${args.childName}'s Fitbit:\n${connectUrl}`,
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
});

export default connectFitbit;
