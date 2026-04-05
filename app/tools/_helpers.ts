/**
 * Shared helpers for aixyz tool wrappers.
 * Underscore prefix — ignored by aixyz auto-discovery.
 */
let getPayer: () => string | undefined;
try {
  const session = await import("aixyz/app/plugins/session");
  getPayer = session.getPayer;
} catch {
  getPayer = () => undefined;
}

import { StateManager } from "../../src/engine/state.js";
import { ROLE_TOOL_ACCESS } from "../../src/constants.js";
import type { RoleType } from "../../src/schemas.js";

export interface HttpCallerContext {
  memberId: string;
  role: RoleType;
  childName?: string;
}

/**
 * Resolve caller identity from x402 payer address.
 * In HTTP mode, getPayer() returns the wallet address from the x402 payment proof.
 * We look up the member record that matches this wallet address.
 * Falls back to manager for free tools or when no payer (unauthenticated).
 */
export async function resolveHttpCaller(): Promise<HttpCallerContext> {
  const payer = getPayer();

  if (!payer) {
    // No x402 payer — could be a free tool or unauthenticated request.
    // Return a default context; tools that require auth should check this.
    return { memberId: "anonymous", role: "manager" as RoleType };
  }

  const state = new StateManager();
  const members = await state.loadMembers();

  // Match payer wallet address to a member's walletAddress field
  // Members get their wallet address stored when they accept an invite in HTTP mode
  const member = members.find(
    (m) => m.active && m.walletAddress?.toLowerCase() === payer.toLowerCase()
  );

  if (member) {
    return {
      memberId: member.id,
      role: member.role as RoleType,
      childName: member.childName,
    };
  }

  // Payer exists but no matching member — treat as first-time manager
  // (the wallet that deploys/configures is implicitly the manager)
  return { memberId: payer, role: "manager" as RoleType };
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
