import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveMasterKey } from "./keys/master-key.js";
import { migrateToMultiTenant } from "./migrations/2.9-multi-tenant.js";
import { registerConfigurePolicyTool } from "./tools/configure-policy.js";
import { registerViewPolicyTool } from "./tools/view-policy.js";
import { registerVerifyAchievementTool } from "./tools/verify-achievement.js";
import { registerDistributeAllowanceTool } from "./tools/distribute-allowance.js";
import { registerCheckProgressTool } from "./tools/check-progress.js";
import { registerCheckSavingsTool } from "./tools/check-savings.js";
import { registerCheckGoalsTool } from "./tools/check-goals.js";
import { registerInviteMemberTool } from "./tools/invite-member.js";
import { registerResendInviteTool } from "./tools/resend-invite.js";
import { registerAcceptInviteTool } from "./tools/accept-invite.js";
import { registerTestConnectionTool } from "./tools/test-connection.js";
import { registerViewMyLinkTool } from "./tools/view-my-link.js";
import { registerManageMembersTool } from "./tools/manage-members.js";
import { registerGetFundingAddressTool } from "./tools/get-funding-address.js";
import { registerReleaseSavingsTool } from "./tools/release-savings.js";
import { registerConnectFitbitTool } from "./tools/connect-fitbit.js";
import { registerConvertSavingsTool } from "./tools/convert-savings.js";

// Resolve master encryption key at startup (auto-generates if needed)
try {
  resolveMasterKey();
} catch (err) {
  console.error("[AllowanceAgent] FATAL: Could not resolve master key:", err);
  process.exit(1);
}

// Run Sprint 2.9 multi-tenant migration at startup. Idempotent — no-op if
// already migrated or if the installation is fresh. Failing startup on
// migration error is deliberate: partial state is recoverable, silent
// corruption is not.
try {
  await migrateToMultiTenant();
} catch (err) {
  console.error("[AllowanceAgent] FATAL: Sprint 2.9 migration failed:", err);
  process.exit(1);
}

const server = new McpServer({
  name: "allowance-agent",
  version: "0.1.0",
});

// Register all MCP tools (each tool enforces RBAC internally via withAccessControl)
registerConfigurePolicyTool(server);
registerViewPolicyTool(server);
registerVerifyAchievementTool(server);
registerDistributeAllowanceTool(server);
registerCheckProgressTool(server);
registerCheckSavingsTool(server);
registerCheckGoalsTool(server);
registerInviteMemberTool(server);
registerResendInviteTool(server);
registerTestConnectionTool(server);
registerViewMyLinkTool(server);
registerAcceptInviteTool(server);
registerManageMembersTool(server);
registerGetFundingAddressTool(server);
registerReleaseSavingsTool(server);
registerConnectFitbitTool(server);
registerConvertSavingsTool(server);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[AllowanceAgent] MCP server running on stdio");
console.error("[AllowanceAgent] MCP server running on stdio");
