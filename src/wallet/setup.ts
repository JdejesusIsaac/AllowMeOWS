import {
  createWallet,
  createPolicy,
  createApiKey,
  listWallets,
  listPolicies,
} from "@open-wallet-standard/core";
import { WALLET_NAMES, CHAIN_IDS, POLICY_IDS, ROLES } from "../constants.js";
import type { FamilyConfig } from "../schemas.js";
import { StateManager } from "../engine/state.js";
import { randomUUID } from "node:crypto";

// Policy bundle JSON templates
function buildManagerPolicy(
  authorizedWallets: string[],
  maxWeeklyDistribution: number
) {
  return {
    id: POLICY_IDS.ALLOWANCE_FULL_ACCESS,
    name: "Full Manager Access",
    version: 1,
    created_at: new Date().toISOString(),
    rules: [
      {
        type: "allowed_chains",
        chain_ids: [CHAIN_IDS.BASE_MAINNET, CHAIN_IDS.BASE_SEPOLIA],
      },
    ],
    executable: null,
    config: {
      role: ROLES.MANAGER,
      max_weekly_distribution: maxWeeklyDistribution,
      authorized_wallets: authorizedWallets,
    },
    action: "deny",
  };
}

function buildCoParentPolicy() {
  return {
    id: POLICY_IDS.APPROVE_AND_READ_ONLY,
    name: "Co-Parent: Approve + Read",
    version: 1,
    created_at: new Date().toISOString(),
    rules: [
      {
        type: "allowed_chains",
        chain_ids: [CHAIN_IDS.BASE_MAINNET, CHAIN_IDS.BASE_SEPOLIA],
      },
    ],
    executable: null,
    config: {
      role: ROLES.CO_PARENT,
      allowed_actions: [
        "verify-achievement",
        "check-progress",
        "check-savings",
      ],
      denied_actions: [
        "distribute-allowance",
        "configure-policy",
        "invite-member",
      ],
    },
    action: "deny",
  };
}

function buildFamilyPolicy(maxGiftAmount: number) {
  return {
    id: POLICY_IDS.GIFT_CONTRIBUTE_ONLY,
    name: "Family: Gift + View Only",
    version: 1,
    created_at: new Date().toISOString(),
    rules: [
      {
        type: "allowed_chains",
        chain_ids: [CHAIN_IDS.BASE_MAINNET, CHAIN_IDS.BASE_SEPOLIA],
      },
    ],
    executable: null,
    config: {
      role: ROLES.FAMILY,
      max_gift_amount: maxGiftAmount,
      allowed_wallets: [WALLET_NAMES.GIFT_FUND],
      allowed_actions: ["check-progress", "contribute-gift"],
    },
    action: "deny",
  };
}

function buildAdvisorPolicy() {
  return {
    id: POLICY_IDS.AUDIT_READ_ONLY,
    name: "Advisor: Audit Log Read Only",
    version: 1,
    created_at: new Date().toISOString(),
    rules: [
      {
        type: "allowed_chains",
        chain_ids: [CHAIN_IDS.BASE_MAINNET, CHAIN_IDS.BASE_SEPOLIA],
      },
    ],
    executable: null,
    config: {
      role: ROLES.ADVISOR,
      allowed_actions: ["query-audit-log"],
      signing_allowed: false,
    },
    action: "deny",
  };
}

function buildLearnerPolicy() {
  return {
    id: POLICY_IDS.LEARNER_READ_ONLY,
    name: "Learner: Read Own Progress + Self-Report",
    version: 1,
    created_at: new Date().toISOString(),
    rules: [
      {
        type: "allowed_chains",
        chain_ids: [CHAIN_IDS.BASE_MAINNET, CHAIN_IDS.BASE_SEPOLIA],
      },
    ],
    executable: null,
    config: {
      role: ROLES.LEARNER,
      allowed_actions: [
        "check-progress",
        "check-savings",
        "verify-achievement",
        "accept-invite",
      ],
      signing_allowed: false,
    },
    action: "deny",
  };
}

/**
 * Handles first-time OWS wallet and policy setup for a family.
 */
export class WalletSetup {
  private vaultPath: string | undefined;

  constructor(vaultPath?: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Initialize all wallets and policies for a new family.
   * Creates: treasury, child wallets, savings-vault, gift-fund
   * Creates: all 4 policy bundles
   * Creates: initial Manager API key
   */
  async initializeFamily(
    config: FamilyConfig,
    passphrase: string
  ): Promise<{ managerToken: string; wallets: string[] }> {
    const state = new StateManager();
    const createdWallets: string[] = [];
    if (!config.familyId) {
      throw new Error("WalletSetup.initializeFamily requires config.familyId (Sprint 2.9)");
    }
    const familyId = config.familyId;
    await state.createFamilyDir(familyId);

    // 1. Create core wallets
    const coreWallets = [
      WALLET_NAMES.TREASURY,
      WALLET_NAMES.SAVINGS_VAULT,
      WALLET_NAMES.GIFT_FUND,
    ];

    for (const walletName of coreWallets) {
      try {
        const wallet = createWallet(walletName, passphrase, 12, this.vaultPath);
        createdWallets.push(walletName);
        console.error(`[Setup] Created wallet: ${walletName} (${wallet.id})`);

        await state.addAuditEntry(familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "wallet-created",
          actor: "system",
          details: { walletName, walletId: wallet.id },
        });
      } catch (error) {
        // Wallet may already exist — that's OK
        console.error(`[Setup] Wallet "${walletName}" may already exist: ${error}`);
        createdWallets.push(walletName);
      }
    }

    // 2. Create child wallets (skip if child has an external walletAddress)
    for (const child of config.children) {
      if (child.walletAddress) {
        console.error(`[Setup] Child "${child.name}" uses external address: ${child.walletAddress} — skipping OWS wallet creation`);
        await state.addAuditEntry(familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "external-wallet-registered",
          actor: "system",
          details: { childName: child.name, walletAddress: child.walletAddress },
        });
        continue;
      }

      const childWalletName = WALLET_NAMES.childWallet(child.name);
      try {
        const wallet = createWallet(childWalletName, passphrase, 12, this.vaultPath);
        createdWallets.push(childWalletName);
        console.error(`[Setup] Created child wallet: ${childWalletName} (${wallet.id})`);

        await state.addAuditEntry(familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "wallet-created",
          actor: "system",
          details: { walletName: childWalletName, walletId: wallet.id, childName: child.name },
        });
      } catch (error) {
        console.error(`[Setup] Child wallet "${childWalletName}" may already exist: ${error}`);
        createdWallets.push(childWalletName);
      }
    }

    // 3. Collect all authorized wallet addresses for manager policy
    const authorizedWallets = createdWallets.slice(); // wallet names for policy scope

    // 4. Calculate max weekly distribution (sum of all children's weekly budgets)
    const maxWeekly = config.children.reduce((sum, c) => sum + c.weeklyBudget, 0);

    // 5. Create policy bundles
    const policies = [
      buildManagerPolicy(authorizedWallets, maxWeekly),
      buildCoParentPolicy(),
      buildFamilyPolicy(100_000_000), // $100 max gift default
      buildAdvisorPolicy(),
      buildLearnerPolicy(),
    ];

    for (const policy of policies) {
      try {
        createPolicy(JSON.stringify(policy), this.vaultPath);
        console.error(`[Setup] Created policy: ${policy.id}`);

        await state.addAuditEntry(familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "policy-created",
          actor: "system",
          details: { policyId: policy.id, policyName: policy.name },
        });
      } catch (error) {
        console.error(`[Setup] Policy "${policy.id}" may already exist: ${error}`);
      }
    }

    // 6. Create initial Manager API key
    const managerKey = createApiKey(
      "allowance-agent-manager",
      createdWallets,
      [POLICY_IDS.ALLOWANCE_FULL_ACCESS],
      passphrase,
      undefined,
      this.vaultPath
    );

    console.error(`[Setup] Created Manager API key: ${managerKey.id}`);

    // 7. Register a sentinel member record for the OWS manager key. This is a
    // system-level record; the real per-user Manager Member is created by
    // configure-policy (bootstrap path) or by invite acceptance. Only add the
    // sentinel when no active Manager exists yet for this family.
    const existingMembers = await state.loadMembers(familyId);
    const hasActiveManager = existingMembers.some(
      (m) => m.role === "manager" && m.active
    );
    if (!hasActiveManager) {
      await state.addMember(familyId, {
        id: randomUUID(),
        name: config.familyName + " Manager",
        role: "manager",
        apiKeyId: managerKey.id,
        joinedAt: new Date().toISOString(),
        active: true,
      });
    }

    return {
      managerToken: managerKey.token,
      wallets: createdWallets,
    };
  }
}

// === CLI entry point for standalone setup ===
if (process.argv[1]?.endsWith("setup.ts") || process.argv[1]?.endsWith("setup.js")) {
  console.error("[Setup] Running standalone wallet setup...");
  console.error("[Setup] Use the configure-policy MCP tool for full setup.");
  console.error("[Setup] This script is for development/testing only.");
}
