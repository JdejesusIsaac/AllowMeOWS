/**
 * Sprint 3.6 — `test-connection` MCP tool.
 *
 * No-arg connectivity / identity health check for whoever is authenticated.
 * Helps users confirm their MCP bearer path (setup code / session / member-id)
 * is wired before they debug richer tools.
 *
 * Exported handler mirrors the `invite-member` / `view-policy` pattern for tests.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StateManager } from "../engine/state.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";

function json(payload: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

export async function testConnectionHandler(
  _args: Record<string, unknown>,
  caller: CallerContext | null,
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("test-connection");

  try {
    const state = new StateManager();
    const familyId = caller.familyId;
    const config = await state.loadFamilyConfig(familyId);
    if (!config) {
      return json({ success: false, healthCheck: "error", error: "No family configured." });
    }

    const member = await state.loadMember(familyId, caller.memberId);
    if (!member) {
      return json({ success: false, healthCheck: "error", error: "Caller member record not found." });
    }

    const auditLog = await state.loadAuditLog(familyId);
    const actorEntries = auditLog.filter((e) => e.actor === caller.memberId);
    actorEntries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    const lastActionAt = actorEntries[0]?.timestamp ?? null;

    return json({
      success: true,
      callerName: member.name,
      role: caller.role,
      familyName: config.familyName,
      familyId,
      lastActionAt,
      healthCheck: "ok",
      ...(caller.childName ? { scopedChildName: caller.childName } : {}),
    });
  } catch (error) {
    return json({
      success: false,
      healthCheck: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function registerTestConnectionTool(server: McpServer): void {
  server.tool(
    "test-connection",
    "Ping your MCP session: verifies identity, role, family, and surfaces your most recent audit timestamp as caller.",
    { ...rbacFields },
    withAccessControl("test-connection", testConnectionHandler),
  );
}
