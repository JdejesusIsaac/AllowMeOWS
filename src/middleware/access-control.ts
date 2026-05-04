import { z } from "zod";
import { ROLE_TOOL_ACCESS, ROLES } from "../constants.js";
import type { Role } from "../constants.js";
import { StateManager } from "../engine/state.js";
import { MemberIndex } from "../identity/member-index.js";
import { SetupCodeStore, redactSetupCode } from "../identity/setup-codes.js";
import { getRequestContext } from "./request-context.js";
import { sessionTokens } from "../auth/session-tokens.js";

// Optional fields each tool schema includes to support multi-user RBAC + testing
export const rbacFields = {
  _callerRole: z.string().optional().describe("Internal: caller role override"),
  _callerId: z.string().optional().describe("Internal: caller member ID"),
  _familyId: z.string().optional().describe("Internal: caller family ID (test mode)"),
};

/**
 * CallerContext is the authenticated identity of the caller for a single tool
 * invocation. Sprint 2.9 makes `familyId` mandatory — every tool handler
 * scopes its data access by `caller.familyId`. There is no ambient "current
 * family" and no default-to-Manager fallback.
 */
export interface CallerContext {
  role: Role;
  memberId: string;
  familyId: string;
  childName?: string; // populated for learner role — scopes data access
}

export interface ToolResponse {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

/**
 * Tools that accept unidentified callers. Two legitimate bootstrap actions:
 *   - `configure-policy` — stranger creates a brand-new family (new Manager).
 *   - `accept-invite` — stranger redeems an invite code and joins the inviter's
 *     family (the invite itself carries the target familyId).
 *
 * Every other tool rejects null callers with `buildNoIdentityResponse`.
 */
export const UNIDENTIFIED_CALLER_TOOLS = new Set<string>([
  "configure-policy",
  "accept-invite",
]);

/**
 * Resolve the caller's identity for this invocation, or null if the caller
 * cannot be identified. Returning null is a first-class state — it means
 * "stranger, treat carefully". See `withAccessControl` for null-caller handling.
 *
 * Priority chain (Sprint 3.0 v4):
 *   0. `X-Session-Token` HTTP header — verify-page JWT issued post-SIWE.
 *      Short-lived (~10min), carries (memberId, walletAddress, familyId, role).
 *      Wins over all lower priorities when valid.
 *   1. `X-Member-Id` HTTP header (backward compat with Sprint 2 tests)
 *   2. `?setup=CODE` HTTP URL query param
 *   3. `_callerId` tool arg (stdio + test mode) — looked up in MemberIndex
 *   4. `_callerRole` + `_familyId` tool args (pure test mode — no persistence)
 *   5. null — no identity.
 *
 * The transitional "legacy single-family fallback" that previously promoted
 * unidentified callers to Manager of the sole family has been removed. It
 * was a security bypass when the server is exposed as a public SaaS
 * (any MCP client could reach the first family's treasury). Every tool call
 * on a multi-user deployment now requires an explicit identity via one of
 * Priorities 1-4, or falls into the UNIDENTIFIED_CALLER_TOOLS allow-list
 * (currently `configure-policy` and `accept-invite`).
 *
 * Sprint 3.0 will prepend Priority 0 — session tokens issued by the verify
 * page — pushing setup codes to Priority 2. Both paths coexist.
 */
export async function resolveCallerRole(
  args: Record<string, unknown>
): Promise<CallerContext | null> {
  const reqCtx = getRequestContext();
  const headers = reqCtx?.headers;
  const query = reqCtx?.query;
  const state = new StateManager();
  const index = new MemberIndex();

  // Priority 0: X-Session-Token header (Sprint 3.0 v4 — verify-page JWT).
  // If the token is valid and its claims map to a resolvable Member, Priority
  // 0 wins. If the token is missing, expired, tampered, or its claims don't
  // map to a real Member, fall through to Priority 1+ (graceful degradation
  // — the token itself never raises an error, it only upgrades identity).
  const sessionToken =
    headers?.["x-session-token"] ?? headers?.["X-Session-Token"];
  if (typeof sessionToken === "string" && sessionToken.length > 0) {
    const claims = sessionTokens.validate(sessionToken);
    if (claims?.memberId) {
      const ctx = await resolveFromMemberId(claims.memberId, state, index);
      if (ctx) return ctx;
    }
  }

  // Priority 1: X-Member-Id header (Sprint 2 HTTP backward compat)
  if (headers?.["x-member-id"]) {
    const memberId = String(headers["x-member-id"]);
    const ctx = await resolveFromMemberId(memberId, state, index);
    if (ctx) return ctx;
  }

  // Priority 2: ?setup=CODE URL query param (Sprint 2.9 HTTP)
  if (query?.setup) {
    const code = String(Array.isArray(query.setup) ? query.setup[0] : query.setup);
    const setupCodes = new SetupCodeStore();
    const resolved = await setupCodes.resolve(code);
    if (resolved) {
      const ctx = await resolveFromMemberId(resolved.memberId, state, index);
      if (ctx) return ctx;
      console.error(
        `[auth] Setup code ${redactSetupCode(code)} resolved to unknown or inactive member`
      );
    } else {
      console.error(`[auth] Invalid or expired setup code ${redactSetupCode(code)}`);
    }
  }

  // Priority 3: _callerId tool arg — look up in MemberIndex
  if (typeof args._callerId === "string" && args._callerId.length > 0) {
    const ctx = await resolveFromMemberId(args._callerId, state, index);
    if (ctx) return ctx;
  }

  // Priority 4: _callerRole + _familyId (pure test mode, no persistence).
  // If `_callerRole` is given without an explicit `_familyId`, infer the
  // familyId from `listFamilies()` when exactly one family is registered.
  // This keeps single-tenant tests working without boilerplate while keeping
  // multi-tenant isolation intact — with 2+ families, tests MUST supply
  // `_familyId` explicitly. When `_callerId` is also provided, try to look up
  // the matching Member record so `childName` is populated (learner scoping).
  if (typeof args._callerRole === "string") {
    let familyId: string | null = null;
    if (typeof args._familyId === "string" && args._familyId.length > 0) {
      familyId = args._familyId;
    } else {
      const fams = await state.listFamilies();
      if (fams.length === 1) {
        familyId = fams[0];
      }
    }
    if (familyId) {
      const memberId = (args._callerId as string) || "test-user";
      let childName: string | undefined;
      if (typeof args._callerChildName === "string") {
        childName = args._callerChildName;
      } else if (typeof args._callerId === "string") {
        const member = await state.loadMember(familyId, args._callerId);
        if (member) childName = member.childName;
      }
      return {
        role: args._callerRole as Role,
        memberId,
        familyId,
        childName,
      };
    }
  }

  // Priority 5: null — stranger. Only `configure-policy` and `accept-invite`
  // may proceed (see UNIDENTIFIED_CALLER_TOOLS). All other tools are rejected
  // by `withAccessControl` with `buildNoIdentityResponse`, which points the
  // caller at the two legitimate onboarding paths (configure-policy to create
  // a family, or ?setup=CODE to authenticate as an existing member).
  return null;
}

async function resolveFromMemberId(
  memberId: string,
  state: StateManager,
  index: MemberIndex
): Promise<CallerContext | null> {
  const entry = await index.get(memberId);
  if (!entry) return null;
  const member = await state.loadMember(entry.familyId, memberId);
  if (!member) return null;
  return {
    role: entry.role,
    memberId,
    familyId: entry.familyId,
    childName: member.childName,
  };
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
 * Build the response returned when a request arrives without identity and
 * the tool is not in UNIDENTIFIED_CALLER_TOOLS. Error message guides the
 * user toward the two legitimate auth paths.
 */
export function buildNoIdentityResponse(toolName: string): ToolResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          error:
            `No caller identity. Tool "${toolName}" requires an authenticated member. ` +
            "Call configure-policy to create a family, or add ?setup=SETUP-XXXX-XXXX to your MCP server URL.",
          toolName,
        }),
      },
    ],
  };
}

/**
 * Strip internal fields (_callerRole, _callerId, _familyId, _callerChildName)
 * from args before passing to the actual tool handler. These are middleware-only.
 */
export function stripInternalArgs<T extends Record<string, unknown>>(
  args: T
): Omit<T, "_callerRole" | "_callerId" | "_familyId" | "_callerChildName"> {
  const { _callerRole, _callerId, _familyId, _callerChildName, ...rest } = args;
  return rest as Omit<T, "_callerRole" | "_callerId" | "_familyId" | "_callerChildName">;
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
 * Sprint 2.9 null-caller handling:
 *   - If `resolveCallerRole` returns null and the tool is in
 *     `UNIDENTIFIED_CALLER_TOOLS`, the handler is invoked with
 *     `callerCtx = null` so it can handle the bootstrap path (e.g.
 *     `configure-policy` creating a brand-new family).
 *   - If the tool is NOT in that set, the request is rejected with a clear
 *     `buildNoIdentityResponse` error.
 *
 * @param toolName - The MCP tool name (must match ROLE_TOOL_ACCESS keys)
 * @param handler - The actual tool handler function. Receives `null` only if
 *   the tool is listed in `UNIDENTIFIED_CALLER_TOOLS`.
 * @returns A wrapped handler that checks RBAC first
 */
export function withAccessControl(
  toolName: string,
  handler: (args: Record<string, unknown>, callerCtx: CallerContext | null) => Promise<ToolResponse>
): (args: Record<string, unknown>) => Promise<ToolResponse> {
  return async (args: Record<string, unknown>): Promise<ToolResponse> => {
    const callerCtx = await resolveCallerRole(args);

    if (!callerCtx) {
      // Unidentified caller: only a small allow-list of bootstrap tools may run.
      if (UNIDENTIFIED_CALLER_TOOLS.has(toolName)) {
        console.error(`[RBAC] BOOTSTRAP (null caller) → ${toolName}`);
        const cleanArgs = stripInternalArgs(args);
        return handler(cleanArgs, null);
      }
      console.error(`[RBAC] DENIED (null caller) → ${toolName}`);
      return buildNoIdentityResponse(toolName);
    }

    if (!isToolAuthorized(toolName, callerCtx.role)) {
      console.error(`[RBAC] DENIED: ${callerCtx.memberId} (${callerCtx.role}) → ${toolName}`);
      return buildAccessDeniedResponse(toolName, callerCtx.role);
    }

    console.error(
      `[RBAC] ALLOWED: ${callerCtx.memberId} (${callerCtx.role}, family=${callerCtx.familyId}) → ${toolName}`
    );

    // Strip internal args and call the real handler
    const cleanArgs = stripInternalArgs(args);
    return handler(cleanArgs, callerCtx);
  };
}
