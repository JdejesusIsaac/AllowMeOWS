// @ts-nocheck — Sprint 2.9: aixyz legacy tool, superseded by src/tools/
import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../../src/engine/state.js";
import { PolicyEngine } from "../../src/engine/policy.js";
import { WalletDistributor } from "../../src/wallet/distributor.js";
import { FamilyKeyManager } from "../../src/keys/family-keys.js";
import { USDC, WALLET_NAMES } from "../../src/constants.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";
import type { Accepts } from "aixyz/accepts";

export const accepts: Accepts = {
  scheme: "exact",
  price: "$0.01",
};

const distributeAllowance = tool({
  description:
    "Distribute pending achievement rewards to child wallets and savings vault via USDC transfers. Manager only.",
  inputSchema: z.object({
    childName: z.string().optional().describe("Distribute for a specific child, or all if omitted"),
    dryRun: z.boolean().default(false).describe("Preview without sending transactions"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("distribute-allowance", caller.role)) {
      return accessDenied("distribute-allowance", caller.role);
    }
    try {
      const state = new StateManager();
      const engine = new PolicyEngine();
      const config = await state.loadFamilyConfig();

      if (!config) {
        return JSON.stringify({ success: false, error: "No family configured." });
      }

      // Auto-resolve per-family encryption key (no passphrase prompt)
      const keyManager = new FamilyKeyManager();
      const familyId = config.familyId;
      let passphrase: string | undefined;
      if (familyId && keyManager.hasFamilyKey(familyId)) {
        passphrase = keyManager.getFamilyKey(familyId);
      } else if (process.env.OWS_PASSPHRASE) {
        passphrase = process.env.OWS_PASSPHRASE;
        console.error(`[keys] Using legacy OWS_PASSPHRASE for family. New families use per-family keys.`);
      }
      const distributor = new WalletDistributor(passphrase);

      const achievements = await state.loadAchievements();
      const pending = achievements.filter((a) => !a.distributed);
      const targetChildren = args.childName
        ? config.children.filter((c) => c.name.toLowerCase() === args.childName!.toLowerCase())
        : config.children;

      const results = [];
      for (const childConfig of targetChildren) {
        const childName = childConfig.name;
        const childAch = pending.filter((a) => a.childName.toLowerCase() === childName.toLowerCase());
        if (childAch.length === 0) continue;

        const totalAmount = childAch.reduce((sum, a) => sum + a.amount, 0);
        const { childAmount, savingsAmount } = engine.calculateSavingsSplit(totalAmount, childConfig.savingsPercent);

        let txHash: string | undefined;

        if (!args.dryRun) {
          if (!passphrase) {
            return JSON.stringify({ success: false, error: "Family wallet not initialized. Run configure-policy first." });
          }

          if (childAmount > 0) {
            const result = await distributor.transferUSDC(
              WALLET_NAMES.TREASURY,
              childConfig.walletAddress ? childName : WALLET_NAMES.childWallet(childName),
              childAmount, config.chainId, config.usdcAddress, childConfig.walletAddress
            );
            txHash = result.txHash;
          }

          const now = new Date().toISOString();
          for (const ach of childAch) {
            ach.distributed = true;
            ach.distributedAt = now;
            ach.txHash = txHash;
          }
          await state.saveAchievements(achievements);

          await state.addAuditEntry({
            id: randomUUID(), timestamp: now, action: "distribute",
            actor: caller.memberId,
            details: { childName, achievementCount: childAch.length, totalAmount, childAmount, savingsAmount },
            txHash, amount: totalAmount,
          });
        }

        results.push({
          childName, achievements: childAch.length,
          totalUsd: (totalAmount / 1e6).toFixed(2),
          childUsd: (childAmount / 1e6).toFixed(2),
          savingsUsd: (savingsAmount / 1e6).toFixed(2),
          txHash,
        });
      }

      return JSON.stringify({
        success: true, dryRun: args.dryRun, distributions: results,
        message: results.length === 0
          ? "No pending achievements to distribute."
          : args.dryRun ? "Preview complete. Run with dryRun=false to execute." : "Distribution complete!",
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
});

export default distributeAllowance;
