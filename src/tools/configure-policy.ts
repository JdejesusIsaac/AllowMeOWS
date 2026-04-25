import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import { WalletSetup } from "../wallet/setup.js";
import { FamilyKeyManager } from "../keys/family-keys.js";
import { MemberIndex } from "../identity/member-index.js";
import { SetupCodeStore } from "../identity/setup-codes.js";
import { USDC, CHAIN_IDS, DEFAULT_SAVINGS_PERCENT, ROLES } from "../constants.js";
import type { FamilyConfig, ChildConfig, Member } from "../schemas.js";
import {
  withAccessControl,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";

export function registerConfigurePolicyTool(server: McpServer): void {
  server.tool(
    "configure-policy",
    "Set up or update allowance rules for your family. Example: 'Maya gets $15/week: 40% reading, 35% movement, 25% creativity, 20% savings.'",
    {
      familyName: z.string().describe("Your family name"),
      children: z.array(
        z.object({
          name: z.string().describe("Child's name"),
          walletAddress: z.string().optional().describe("External EVM wallet address (e.g. MetaMask). If omitted, OWS creates a wallet for this child."),
          weeklyBudgetUsd: z.number().positive().describe("Weekly allowance in USD (e.g. 15 for $15)"),
          categories: z.array(z.object({
            name: z.string().min(1).max(50).describe("Category name (e.g. 'reading', 'movement', 'AI subscriptions')"),
            pct: z.number().min(0).max(100).describe("Percentage of weekly budget for this category"),
          })).min(1).max(10).describe("Budget categories with percentages (must sum to ≤ 100%)"),
          savingsPercent: z.number().min(0).max(100).default(DEFAULT_SAVINGS_PERCENT).describe("% of earned allowance routed to savings"),
        })
      ).describe("Children to configure"),
      useTestnet: z.boolean().default(true).describe("Use Base Sepolia testnet (recommended for setup)"),
      ...rbacFields,
    },
    withAccessControl("configure-policy", async (args, caller) => {
      try {
        const chainId = args.useTestnet ? CHAIN_IDS.BASE_SEPOLIA : CHAIN_IDS.BASE_MAINNET;
        const usdcAddress = args.useTestnet ? USDC.BASE_SEPOLIA : USDC.BASE_MAINNET;

        // Validate category budget percentages sum ≤ 100
        for (const child of args.children as ChildArgs[]) {
          const totalPct = child.categories.reduce((s, c) => s + c.pct, 0);
          if (totalPct > 100) {
            return jsonResponse({
              success: false,
              error: `Category percentages for ${child.name} sum to ${totalPct}% — must be ≤ 100%.`,
            });
          }
        }

        // Convert USD to USDC 6-decimal units
        const children: ChildConfig[] = (args.children as ChildArgs[]).map((child) => {
          const weeklyBudget = Math.round(child.weeklyBudgetUsd * 10 ** USDC.DECIMALS);
          return {
            name: child.name,
            walletName: `child-${child.name.toLowerCase()}`,
            walletAddress: child.walletAddress,
            weeklyBudget,
            categories: child.categories.map((cat) => ({
              name: cat.name,
              pct: cat.pct,
              budget: Math.round(weeklyBudget * (cat.pct / 100)),
            })),
            savingsPercent: child.savingsPercent,
            savingsLockDays: 90,
          };
        });

        if (caller === null) {
          // Sprint 2.9 null-caller bootstrap: create a brand-new family.
          return await bootstrapFamily(
            args.familyName as string,
            children,
            chainId,
            usdcAddress,
            args.useTestnet as boolean
          );
        }

        // Existing user path: update the caller's own family.
        return await updateExistingFamily(
          caller,
          args.familyName as string,
          children,
          chainId,
          usdcAddress,
          args.useTestnet as boolean
        );
      } catch (error) {
        return jsonResponse({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })
  );
}

interface ChildArgs {
  name: string;
  walletAddress?: string;
  weeklyBudgetUsd: number;
  categories: Array<{ name: string; pct: number }>;
  savingsPercent: number;
}

function jsonResponse(payload: unknown): ToolResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

async function bootstrapFamily(
  familyName: string,
  children: ChildConfig[],
  chainId: string,
  usdcAddress: string,
  useTestnet: boolean
): Promise<ToolResponse> {
  const state = new StateManager();
  const index = new MemberIndex();
  const setupCodes = new SetupCodeStore();

  const familyId = randomUUID();
  const memberId = randomUUID();
  const now = new Date().toISOString();

  const familyConfig: FamilyConfig = {
    familyId,
    familyName,
    children,
    createdAt: now,
    updatedAt: now,
    chainId,
    usdcAddress,
  };

  // Generate the per-family encryption key first — wallet setup needs it.
  const keyManager = new FamilyKeyManager();
  const familyKey = keyManager.getOrGenerateFamilyKey(familyId);

  // Create family directory (0o700), then initialize OWS wallets + policies
  // inside the per-family vault so wallet names cannot collide across families.
  await state.createFamilyDir(familyId);
  const setup = new WalletSetup(getFamilyVaultPath(familyId));
  await setup.initializeFamily(familyConfig, familyKey);

  await state.saveFamilyConfig(familyId, familyConfig);
  for (const child of children) {
    await state.initializeStreak(familyId, child.name);
  }

  // Create the Manager member record and register it globally.
  const manager: Member = {
    id: memberId,
    name: `${familyName} Manager`,
    role: ROLES.MANAGER,
    joinedAt: now,
    active: true,
  };
  await state.addMember(familyId, manager);
  await index.set(memberId, familyId, ROLES.MANAGER);

  await state.addAuditEntry(familyId, {
    id: randomUUID(),
    timestamp: now,
    action: "configure",
    actor: memberId,
    details: { bootstrap: true, familyName, childCount: children.length },
  });

  const setupCode = await setupCodes.issue(memberId);
  const baseUrl = process.env.ALLOWANCE_AGENT_URL || "https://allowme.dev";
  const mcpUrl = `${baseUrl}/mcp?setup=${setupCode}`;

  const summary = buildChildrenSummary(children);

  return jsonResponse({
    success: true,
    bootstrap: true,
    familyId,
    memberId,
    setupCode,
    mcpUrl,
    familyName,
    network: useTestnet ? "Base Sepolia (testnet)" : "Base (mainnet)",
    children: summary,
    walletsCreated: true,
    message:
      `Family "${familyName}" created! You are Manager. ` +
      `To continue using AllowanceAgent, update your MCP connector URL to:\n\n${mcpUrl}\n\n` +
      `The setup code expires in 48 hours. You can invite co-parents and learners from here.`,
  });
}

async function updateExistingFamily(
  caller: CallerContext,
  familyName: string,
  children: ChildConfig[],
  chainId: string,
  usdcAddress: string,
  useTestnet: boolean
): Promise<ToolResponse> {
  const state = new StateManager();
  const familyId = caller.familyId;

  const existingConfig = await state.loadFamilyConfig(familyId);

  const now = new Date().toISOString();
  const familyConfig: FamilyConfig = {
    familyId,
    familyName,
    children,
    createdAt: existingConfig?.createdAt || now,
    updatedAt: now,
    chainId,
    usdcAddress,
  };

  const keyManager = new FamilyKeyManager();
  const familyKey = keyManager.getOrGenerateFamilyKey(familyId);

  // Per-family OWS vault (Sprint 2.9.1) — wallet names like `treasury` are
  // namespaced by vault directory, so they don't collide with other families.
  const setup = new WalletSetup(getFamilyVaultPath(familyId));
  await setup.initializeFamily(familyConfig, familyKey);

  await state.saveFamilyConfig(familyId, familyConfig);
  for (const child of children) {
    await state.initializeStreak(familyId, child.name);
  }

  await state.addAuditEntry(familyId, {
    id: randomUUID(),
    timestamp: now,
    action: "configure",
    actor: caller.memberId,
    details: { bootstrap: false, familyName, childCount: children.length },
  });

  const summary = buildChildrenSummary(children);

  return jsonResponse({
    success: true,
    bootstrap: false,
    familyId,
    familyName,
    network: useTestnet ? "Base Sepolia (testnet)" : "Base (mainnet)",
    children: summary,
    walletsCreated: true,
    message: `Family "${familyName}" configured! Wallets and policies are set up. You're ready to verify achievements.`,
  });
}

function buildChildrenSummary(children: ChildConfig[]): string {
  return children
    .map((c) => {
      const catSummary = (c.categories ?? [])
        .map((cat) => `${cat.name}: $${(cat.budget / 10 ** USDC.DECIMALS).toFixed(2)}`)
        .join(", ");
      return `${c.name}: $${(c.weeklyBudget / 10 ** USDC.DECIMALS).toFixed(2)}/week (${catSummary}) — ${c.savingsPercent}% to savings`;
    })
    .join("\n");
}
