/**
 * Shared helpers for aixyz tool wrappers.
 * Underscore prefix — ignored by aixyz auto-discovery.
 *
 * Sprint 2.9 hotfix: aixyz tools are legacy and not wired into the primary
 * HTTP transport (app/server.ts uses src/tools/ directly). These helpers
 * continue to compile against the multi-tenant StateManager API but no
 * longer fall through to a single-family Manager fallback — that was a
 * public-SaaS security bypass. Unidentified callers return null; the
 * wrapper emits accessDenied so the caller is told to bootstrap via
 * configure-policy or provide an explicit setup code.
 *
 * Sprint 2.9 note on getPayer: earlier versions of aixyz shipped a session
 * plugin exposing a per-request payer getter. That export was removed in
 * aixyz v0.19+, and the primary HTTP transport no longer depends on it. We
 * stub getPayer to always return undefined; any aixyz request therefore
 * yields a null caller and must come through configure-policy first.
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
 * Priority chain (Sprint 2.9 hotfix):
 *   1. payer → MemberIndex lookup → CallerContext (multi-family safe)
 *   2. payer matches a member's walletAddress in any registered family
 *   3. No payer or no match → null (caller must bootstrap via configure-policy
 *      or supply an explicit setup code in the MCP URL)
 */
export async function resolveHttpCaller(): Promise<HttpCallerContext | null> {
  const state = new StateManager();
  const index = new MemberIndex();
  const payer = getPayer();

  if (!payer) {
    return null;
  }

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

  // Scan every registered family for a member whose walletAddress matches the
  // payer. Multi-family safe — if the payer is a member of two families, the
  // first match wins (unlikely in practice, but deterministic given a stable
  // family listing order).
  const families = await state.listFamilies();
  for (const familyId of families) {
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

  return null;
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
