import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../../src/engine/state.js";
import { WalletSetup } from "../../src/wallet/setup.js";
import { FamilyKeyManager } from "../../src/keys/family-keys.js";
import { CHAIN_IDS, USDC, DEFAULT_SAVINGS_PERCENT } from "../../src/constants.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";
import type { ChildConfig, FamilyConfig } from "../../src/schemas.js";

const configurePolicy = tool({
  description:
    "Configure allowance rules for a family. Sets up children, budgets, categories, savings percentages, and OWS wallets. Manager only.",
  inputSchema: z.object({
    familyName: z.string().describe("Family name (e.g. 'The Garcia Family')"),
    children: z.array(
      z.object({
        name: z.string().describe("Child's name"),
        walletAddress: z.string().optional().describe("External EVM wallet address"),
        weeklyBudgetUsd: z.number().positive().describe("Weekly allowance in USD"),
        categories: z.array(z.object({
          name: z.string().min(1).max(50).describe("Category name (e.g. 'reading', 'AI subscriptions')"),
          pct: z.number().min(0).max(100).describe("Percentage of weekly budget"),
        })).min(1).max(10).describe("Budget categories with percentages (must sum to ≤ 100%)"),
        savingsPercent: z.number().min(0).max(100).default(DEFAULT_SAVINGS_PERCENT),
      })
    ).describe("Children to configure"),
    useTestnet: z.boolean().default(true).describe("Use Base Sepolia testnet"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("configure-policy", caller.role)) {
      return accessDenied("configure-policy", caller.role);
    }
    try {
      const state = new StateManager();
      const chainId = args.useTestnet ? CHAIN_IDS.BASE_SEPOLIA : CHAIN_IDS.BASE_MAINNET;
      const usdcAddress = args.useTestnet ? USDC.BASE_SEPOLIA : USDC.BASE_MAINNET;

      // Validate category percentages sum ≤ 100
      for (const child of args.children) {
        const totalPct = child.categories.reduce((s, c) => s + c.pct, 0);
        if (totalPct > 100) {
          return JSON.stringify({
            success: false,
            error: `Category percentages for ${child.name} sum to ${totalPct}% — must be ≤ 100%.`,
          });
        }
      }

      const children: ChildConfig[] = args.children.map((child) => {
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

      const setup = new WalletSetup();
      await setup.initializeFamily(familyConfig, familyKey);

      await state.saveFamilyConfig(familyConfig);

      for (const child of children) {
        await state.initializeStreak(child.name);
      }

      const summary = children.map((c) => ({
        name: c.name,
        weeklyBudgetUsd: (c.weeklyBudget / 10 ** USDC.DECIMALS).toFixed(2),
        savingsPercent: c.savingsPercent,
        wallet: c.walletAddress || "OWS-managed",
      }));

      return JSON.stringify({
        success: true,
        familyName: args.familyName,
        network: args.useTestnet ? "Base Sepolia (testnet)" : "Base (mainnet)",
        children: summary,
        walletsCreated: true,
        message: `Family "${args.familyName}" configured! Wallets and policies are set up.`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});

export default configurePolicy;
