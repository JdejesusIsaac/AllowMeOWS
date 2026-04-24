/**
 * Shared helpers for aixyz tool wrappers.
 * Underscore prefix — ignored by aixyz auto-discovery.
 *
 * Sprint 2.9: aixyz tools are legacy and not wired into the primary HTTP
 * transport (app/server.ts uses src/tools/ directly). These helpers continue
 * to compile against the multi-tenant StateManager API by resolving familyId
 * through the single-family fallback (identical semantics to the legacy
 * resolver in src/middleware/access-control.ts).
 *
 * Sprint 2.9 note on getPayer: earlier versions of aixyz shipped a session
 * plugin exposing a per-request payer getter. That export was removed in
 * aixyz v0.19+, and the primary HTTP transport no longer depends on it. We
 * stub getPayer to always return undefined; callers fall through to the
 * single-family legacy fallback inside resolveHttpCaller, which is the
 * correct behavior for the remaining aixyz tool surface.
 */
import { StateManager } from "../../src/engine/state.js";
import { MemberIndex } from "../../src/identity/member-index.js";
import { ROLE_TOOL_ACCESS } from "../../src/constants.js";
import type { RoleType } from "../../src/schemas.js";

const getPayer: () => string | undefined = () => undefined;

export interface HttpCallerContext {
  memberId: string;
  role: RoleType;
  familyId: string;
  childName?: string;
}

/**
 * Resolve caller identity from x402 payer address.
 *
 * Priority chain:
 *   1. payer → MemberIndex lookup → CallerContext (multi-family safe)
 *   2. payer matches a member's walletAddress in the single remaining family
 *   3. No payer or no match → legacy single-family fallback as Manager
 *   4. No families registered → null (caller must call configure-policy)
 */
export async function resolveHttpCaller(): Promise<HttpCallerContext | null> {
  const state = new StateManager();
  const index = new MemberIndex();
  const payer = getPayer();

  if (payer) {
    const entry = await index.get(payer);
    if (entry) {
      const member = await state.loadMember(entry.familyId, payer);
      if (member) {
        return {
          memberId: payer,
          role: entry.role as RoleType,
          familyId: entry.familyId,
          childName: member.childName,
        };
      }
    }
  }

  const families = await state.listFamilies();
  if (families.length !== 1) {
    // 0 families → nothing to resolve. 2+ families → cannot disambiguate
    // without identity. Both yield null; the tool wrapper must handle it.
    return null;
  }
  const familyId = families[0];

  if (payer) {
    const members = await state.loadMembers(familyId);
    const member = members.find(
      (m) => m.active && m.walletAddress?.toLowerCase() === payer.toLowerCase()
    );
    if (member) {
      return {
        memberId: member.id,
        role: member.role as RoleType,
        familyId,
        childName: member.childName,
      };
    }
  }

  // Legacy single-family fallback (treats unidentified callers as Manager of
  // the sole family). Matches resolveCallerRole Priority 5.
  return {
    memberId: payer || "legacy-manager",
    role: "manager" as RoleType,
    familyId,
  };
}

/**
 * Resolve the caller, requiring a non-null result. Throws a caller-friendly
 * error string the tool can return directly when no family is registered.
 */
export async function requireHttpCaller(): Promise<HttpCallerContext> {
  const caller = await resolveHttpCaller();
  if (!caller) {
    throw new Error(
      "No family registered on this server. Call configure-policy first, or append ?setup=SETUP-XXXX-XXXX to your MCP URL."
    );
  }
  return caller;
}

/**
 * Check if a role is authorized for a given tool.
 */
export function isHttpToolAuthorized(toolName: string, role: RoleType): boolean {
  const allowed = ROLE_TOOL_ACCESS[role as keyof typeof ROLE_TOOL_ACCESS];
  return allowed ? allowed.includes(toolName) : false;
}

/**
 * Standard access denied response as JSON string.
 */
export function accessDenied(toolName: string, role: string): string {
  return JSON.stringify({
    success: false,
    error: `Access denied: role "${role}" cannot use "${toolName}".`,
  });
}
