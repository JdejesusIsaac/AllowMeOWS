import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import { WalletSetup } from "../wallet/setup.js";
import { USDC, CHAIN_IDS, DEFAULT_SAVINGS_PERCENT } from "../constants.js";
import type { FamilyConfig, ChildConfig } from "../schemas.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

export function registerConfigurePolicyTool(server: McpServer): void {
  server.tool(
    "configure-policy",
    "Set up or update allowance rules for your family. Example: 'Maya gets $15/week, $5 per category, 20% savings.'",
    {
      familyName: z.string().describe("Your family name"),
      children: z.array(
        z.object({
          name: z.string().describe("Child's name"),
          walletAddress: z.string().optional().describe("External EVM wallet address (e.g. MetaMask). If omitted, OWS creates a wallet for this child."),
          weeklyBudgetUsd: z.number().positive().describe("Weekly allowance in USD (e.g. 15 for $15)"),
          educationPct: z.number().min(0).max(100).default(34).describe("% of budget for education"),
          healthPct: z.number().min(0).max(100).default(33).describe("% of budget for health"),
          personalPct: z.number().min(0).max(100).default(33).describe("% of budget for personal development"),
          savingsPercent: z.number().min(0).max(100).default(DEFAULT_SAVINGS_PERCENT).describe("% of earned allowance routed to savings"),
        })
      ).describe("Children to configure"),
      useTestnet: z.boolean().default(true).describe("Use Base Sepolia testnet (recommended for setup)"),
      passphrase: z.string().optional().describe("Wallet passphrase for initial setup"),
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

        // Convert USD to USDC 6-decimal units
        const children: ChildConfig[] = args.children.map((child) => {
          const weeklyBudget = Math.round(child.weeklyBudgetUsd * 10 ** USDC.DECIMALS);
          return {
            name: child.name,
            walletName: `child-${child.name.toLowerCase()}`,
            walletAddress: child.walletAddress, // undefined if OWS-managed
            weeklyBudget,
            categoryBudgets: {
              education: Math.round(weeklyBudget * (child.educationPct / 100)),
              health: Math.round(weeklyBudget * (child.healthPct / 100)),
              personal: Math.round(weeklyBudget * (child.personalPct / 100)),
            },
            savingsPercent: child.savingsPercent,
            savingsLockDays: 90,
          };
        });

        const now = new Date().toISOString();
        const familyConfig: FamilyConfig = {
          familyName: args.familyName,
          children,
          createdAt: now,
          updatedAt: now,
          chainId,
          usdcAddress,
        };

        // Initialize wallets + policies via OWS if passphrase provided (first-time setup)
        if (args.passphrase) {
          const setup = new WalletSetup();
          await setup.initializeFamily(familyConfig, args.passphrase);
        }

        // Save family config
        await state.saveFamilyConfig(familyConfig);

        // Initialize streak data for each child
        for (const child of children) {
          await state.initializeStreak(child.name);
        }

        const summary = children
          .map(
            (c) =>
              `${c.name}: $${(c.weeklyBudget / 10 ** USDC.DECIMALS).toFixed(2)}/week ` +
              `(Ed: $${(c.categoryBudgets.education / 10 ** USDC.DECIMALS).toFixed(2)}, ` +
              `Health: $${(c.categoryBudgets.health / 10 ** USDC.DECIMALS).toFixed(2)}, ` +
              `Personal: $${(c.categoryBudgets.personal / 10 ** USDC.DECIMALS).toFixed(2)}) ` +
              `— ${c.savingsPercent}% to savings`
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
                walletsCreated: args.passphrase ? true : false,
                message: args.passphrase
                  ? `Family "${args.familyName}" configured! Wallets and policies are set up. You're ready to verify achievements.`
                  : `Family "${args.familyName}" configured! Run again with a passphrase to create wallets, or use the setup script.`,
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
