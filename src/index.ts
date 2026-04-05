import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerConfigurePolicyTool } from "./tools/configure-policy.js";
import { registerVerifyAchievementTool } from "./tools/verify-achievement.js";
import { registerDistributeAllowanceTool } from "./tools/distribute-allowance.js";
import { registerCheckProgressTool } from "./tools/check-progress.js";
import { registerCheckSavingsTool } from "./tools/check-savings.js";
import { registerInviteMemberTool } from "./tools/invite-member.js";
import { registerAcceptInviteTool } from "./tools/accept-invite.js";
import { registerManageMembersTool } from "./tools/manage-members.js";
import { registerGetFundingAddressTool } from "./tools/get-funding-address.js";
import { registerReleaseSavingsTool } from "./tools/release-savings.js";
import { registerConnectFitbitTool } from "./tools/connect-fitbit.js";
const server = new McpServer({
  name: "allowance-agent",
  version: "0.1.0",
});

// Register all MCP tools (each tool enforces RBAC internally via withAccessControl)
registerConfigurePolicyTool(server);
registerVerifyAchievementTool(server);
registerDistributeAllowanceTool(server);
registerCheckProgressTool(server);
registerCheckSavingsTool(server);
registerInviteMemberTool(server);
registerAcceptInviteTool(server);
registerManageMembersTool(server);
registerGetFundingAddressTool(server);
registerReleaseSavingsTool(server);
registerConnectFitbitTool(server);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[AllowanceAgent] MCP server running on stdio");
