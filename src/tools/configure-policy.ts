import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { WalletSetup } from "../wallet/setup.js";
import { FamilyKeyManager } from "../keys/family-keys.js";
import { USDC, CHAIN_IDS, DEFAULT_SAVINGS_PERCENT } from "../constants.js";
import type { FamilyConfig, ChildConfig } from "../schemas.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

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
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("configure-policy", caller.role)) {
        return buildAccessDeniedResponse("configure-policy", caller.role);
      }
      try {
        const state = new StateManager();
        const chainId = args.useTestnet ? CHAIN_IDS.BASE_SEPOLIA : CHAIN_IDS.BASE_MAINNET;
        const usdcAddress = args.useTestnet ? USDC.BASE_SEPOLIA : USDC.BASE_MAINNET;

        // Validate category budget percentages sum ≤ 100
        for (const child of args.children) {
          const totalPct = child.categories.reduce((s, c) => s + c.pct, 0);
          if (totalPct > 100) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: `Category percentages for ${child.name} sum to ${totalPct}% — must be ≤ 100%.`,
                }),
              }],
            };
          }
        }

        // Convert USD to USDC 6-decimal units
        const children: ChildConfig[] = args.children.map((child) => {
          const weeklyBudget = Math.round(child.weeklyBudgetUsd * 10 ** USDC.DECIMALS);
          return {
            name: child.name,
            walletName: `child-${child.name.toLowerCase()}`,
            walletAddress: child.walletAddress, // undefined if OWS-managed
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

        // Resolve or create familyId for per-family key management
        const existingConfig = await state.loadFamilyConfig();
        const familyId = existingConfig?.familyId || randomUUID();

        const now = new Date().toISOString();
        const familyConfig: FamilyConfig = {
          familyId,
          familyName: args.familyName,
          children,
          createdAt: existingConfig?.createdAt || now,
          updatedAt: now,
          chainId,
          usdcAddress,
        };

        // Auto-resolve family encryption key (generates on first setup, retrieves on update)
        const keyManager = new FamilyKeyManager();
        const familyKey = keyManager.getOrGenerateFamilyKey(familyId);

        // Initialize wallets + policies via OWS using the per-family key
        const setup = new WalletSetup();
        await setup.initializeFamily(familyConfig, familyKey);

        // Save family config
        await state.saveFamilyConfig(familyConfig);

        // Initialize streak data for each child
        for (const child of children) {
          await state.initializeStreak(child.name);
        }

        const summary = children
          .map(
            (c) => {
              const catSummary = c.categories!.map(
                (cat) => `${cat.name}: $${(cat.budget / 10 ** USDC.DECIMALS).toFixed(2)}`
              ).join(", ");
              return `${c.name}: $${(c.weeklyBudget / 10 ** USDC.DECIMALS).toFixed(2)}/week (${catSummary}) — ${c.savingsPercent}% to savings`;
            }
          )
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                familyName: args.familyName,
                network: args.useTestnet ? "Base Sepolia (testnet)" : "Base (mainnet)",
                children: summary,
                walletsCreated: true,
                message: `Family "${args.familyName}" configured! Wallets and policies are set up. You're ready to verify achievements.`,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            },
          ],
        };
      }
    }
  );
}
