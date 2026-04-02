import {
  createApiKey,
  createPolicy,
  revokeApiKey,
  listApiKeys,
  getWallet,
} from "@open-wallet-standard/core";
import { ROLE_POLICY_MAP, POLICY_IDS, WALLET_NAMES } from "../constants.js";
import type { Role } from "../constants.js";
import type { Member } from "../schemas.js";

interface ApiKeyResult {
  token: string;
  id: string;
  name: string;
}

/**
 * Maps plain-language roles to OWS API key + policy bundles.
 * Handles key creation, revocation, and role changes.
 */
export class RoleManager {
  private passphrase: string | undefined;
  private vaultPath: string | undefined;

  constructor(passphrase?: string, vaultPath?: string) {
    this.passphrase = passphrase;
    this.vaultPath = vaultPath;
  }

  /**
   * Get wallet IDs that a role should have access to.
   */
  getWalletScopeForRole(role: Role, childNames: string[] = []): string[] {
    switch (role) {
      case "manager":
        return [
          WALLET_NAMES.TREASURY,
          ...childNames.map(WALLET_NAMES.childWallet),
          WALLET_NAMES.SAVINGS_VAULT,
          WALLET_NAMES.GIFT_FUND,
        ];
      case "co-parent":
        return [
          WALLET_NAMES.TREASURY,
          ...childNames.map(WALLET_NAMES.childWallet),
        ];
      case "family":
        return [WALLET_NAMES.GIFT_FUND];
      case "advisor":
        return []; // No wallet access — read-only via app layer
      default:
        return [];
    }
  }

  /**
   * Create an OWS API key with the role-mapped policy.
   * Returns null if OWS is not available (e.g., testing without wallets).
   */
  async createRoleApiKey(
    memberName: string,
    role: Role,
    childNames: string[] = []
  ): Promise<ApiKeyResult | null> {
    if (!this.passphrase) {
      console.error("[RoleManager] No passphrase — skipping OWS API key creation");
      return null;
    }

    try {
      const policyId = ROLE_POLICY_MAP[role];
      const walletIds = this.getWalletScopeForRole(role, childNames);

      if (walletIds.length === 0 && role !== "advisor") {
        console.error(`[RoleManager] No wallets in scope for role: ${role}`);
        return null;
      }

      const keyName = `${memberName.toLowerCase().replace(/\s+/g, "-")}-${role}`;

      const result = createApiKey(
        keyName,
        walletIds,
        [policyId],
        this.passphrase,
        undefined, // no expiry
        this.vaultPath
      );

      return result as ApiKeyResult;
    } catch (error) {
      console.error(`[RoleManager] Failed to create API key: ${error}`);
      return null;
    }
  }

  /**
   * Revoke an OWS API key by ID.
   */
  async revokeRoleApiKey(apiKeyId: string): Promise<void> {
    try {
      revokeApiKey(apiKeyId, this.vaultPath);
    } catch (error) {
      console.error(`[RoleManager] Failed to revoke API key ${apiKeyId}: ${error}`);
    }
  }

  /**
   * Change a member's role by revoking the old key and creating a new one.
   */
  async changeRole(
    member: Member,
    newRole: Role,
    childNames: string[] = []
  ): Promise<ApiKeyResult | null> {
    // Revoke old key
    if (member.apiKeyId) {
      await this.revokeRoleApiKey(member.apiKeyId);
    }

    // Create new key with new role
    const newKey = await this.createRoleApiKey(member.name, newRole, childNames);

    if (newKey) {
      member.apiKeyId = newKey.id;
    }

    return newKey;
  }
}
