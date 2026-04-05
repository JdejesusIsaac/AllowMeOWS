import { z } from "zod";
import { ROLE_TOOL_ACCESS, ROLES } from "../constants.js";
import type { Role } from "../constants.js";
import { StateManager } from "../engine/state.js";

// Optional fields each tool schema includes to support multi-user RBAC
export const rbacFields = {
  _callerRole: z.string().optional().describe("Internal: caller role override"),
  _callerId: z.string().optional().describe("Internal: caller member ID"),
};

export interface CallerContext {
  role: Role;
  memberId: string;
  childName?: string; // populated for learner role — scopes data access
}

export interface ToolResponse {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

/**
 * Resolve the caller's role from context.
 * 
 * In stdio mode (MVP), we check:
 * 1. An explicit `_callerRole` field in tool args (for testing/multi-user)
 * 2. An explicit `_callerId` field → look up member → get role
 * 3. Default to "manager" (single-user stdio = the parent who set it up)
 * 
 * In Sprint 2 (HTTP transport), this will use the API key from the
 * Authorization header to resolve the caller via OWS key lookup.
 */
export async function resolveCallerRole(
  args: Record<string, unknown>
): Promise<CallerContext> {
  // Explicit role override (testing / multi-user simulation)
  if (args._callerRole && typeof args._callerRole === "string") {
    const role = args._callerRole as Role;
    const memberId = (args._callerId as string) || "test-user";
    // For testing: look up childName if _callerId is provided
    if (args._callerId && typeof args._callerId === "string") {
      const state = new StateManager();
      const members = await state.loadMembers();
      const member = members.find((m) => m.id === args._callerId && m.active);
      if (member) {
        return { role, memberId, childName: member.childName };
      }
    }
    return { role, memberId };
  }

  // Look up member by ID
  if (args._callerId && typeof args._callerId === "string") {
    const state = new StateManager();
    const members = await state.loadMembers();
    const member = members.find(
      (m) => m.id === args._callerId && m.active
    );
    if (member) {
      return { role: member.role as Role, memberId: member.id, childName: member.childName };
    }
  }

  // Default: manager (stdio = single parent setup)
  return { role: ROLES.MANAGER, memberId: "manager" };
}

/**
 * Check if a role is authorized to call a specific tool.
 */
export function isToolAuthorized(toolName: string, role: Role): boolean {
  const allowedTools = ROLE_TOOL_ACCESS[role];
  if (!allowedTools) return false;
  return allowedTools.includes(toolName);
}

/**
 * Build a denied-access response for MCP tool calls.
 */
export function buildAccessDeniedResponse(toolName: string, role: Role): ToolResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          error: `Access denied. The "${role}" role cannot use "${toolName}".`,
          role,
          toolName,
        }),
      },
    ],
  };
}

/**
 * Strip internal fields (_callerRole, _callerId) from args before
 * passing to the actual tool handler. These are middleware-only.
 */
export function stripInternalArgs<T extends Record<string, unknown>>(
  args: T
): Omit<T, "_callerRole" | "_callerId"> {
  const { _callerRole, _callerId, ...rest } = args;
  return rest as Omit<T, "_callerRole" | "_callerId">;
}

/**
 * Get child scope for a caller. Returns the childName if the caller
 * is a learner (restricts data to their child only). Returns null
 * for manager/co-parent (see all children).
 */
export function getChildScope(callerCtx: CallerContext): string | null {
  if (callerCtx.role === ROLES.LEARNER && callerCtx.childName) {
    return callerCtx.childName;
  }
  // Manager and co-parent see all children
  // Family and advisor are limited by tool access, not child scope
  return null;
}

/**
 * Wrap a tool handler with role-based access control.
 * Use this in each tool registration to enforce RBAC before the handler runs.
 * 
 * @param toolName - The MCP tool name (must match ROLE_TOOL_ACCESS keys)
 * @param handler - The actual tool handler function
 * @returns A wrapped handler that checks RBAC first
 */
export function withAccessControl(
  toolName: string,
  handler: (args: Record<string, unknown>, callerCtx: CallerContext) => Promise<ToolResponse>
): (args: Record<string, unknown>) => Promise<ToolResponse> {
  return async (args: Record<string, unknown>): Promise<ToolResponse> => {
    const callerCtx = await resolveCallerRole(args);

    if (!isToolAuthorized(toolName, callerCtx.role)) {
      console.error(`[RBAC] DENIED: ${callerCtx.memberId} (${callerCtx.role}) → ${toolName}`);
      return buildAccessDeniedResponse(toolName, callerCtx.role);
    }

    console.error(`[RBAC] ALLOWED: ${callerCtx.memberId} (${callerCtx.role}) → ${toolName}`);

    // Strip internal args and call the real handler
    const cleanArgs = stripInternalArgs(args);
    return handler(cleanArgs, callerCtx);
  };
}
