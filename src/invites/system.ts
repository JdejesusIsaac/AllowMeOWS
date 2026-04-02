import { randomUUID } from "node:crypto";
import { INVITE } from "../constants.js";
import type { Role } from "../constants.js";
import type { Invite } from "../schemas.js";

export class InviteSystem {
  /**
   * Generate a human-readable invite code.
   * Format: {CHILD_NAME}-{ROLE_HINT}-{4_ALPHANUMERIC}
   * Example: MAYA-GIFT-7X2K
   */
  generateCode(childName: string, role: Role): string {
    const namePrefix = childName.toUpperCase().slice(0, 4).replace(/[^A-Z]/g, "X");
    const roleHint = INVITE.ROLE_HINTS[role] || "JOIN";
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
    let suffix = "";
    for (let i = 0; i < INVITE.CODE_LENGTH; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${namePrefix}-${roleHint}-${suffix}`;
  }

  /**
   * Generate a full invite object.
   */
  generateInvite(
    role: Role,
    childName: string,
    familyId: string,
    createdBy: string
  ): Invite {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE.EXPIRY_HOURS * 60 * 60 * 1000);

    return {
      code: this.generateCode(childName, role),
      role,
      childName,
      familyId,
      createdBy,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      used: false,
    };
  }

  /**
   * Validate an invite code against the invite list.
   * Returns the invite if valid, null otherwise.
   */
  validateInvite(code: string, invites: Invite[]): Invite | null {
    const normalizedCode = code.toUpperCase().trim();
    const invite = invites.find((inv) => inv.code === normalizedCode);

    if (!invite) return null;
    if (invite.used) return null;
    if (new Date(invite.expiresAt) < new Date()) return null;

    return invite;
  }
}
