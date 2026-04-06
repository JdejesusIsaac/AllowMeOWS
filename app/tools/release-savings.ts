import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../../src/engine/state.js";
import { WalletDistributor } from "../../src/wallet/distributor.js";
import { FamilyKeyManager } from "../../src/keys/family-keys.js";
import { USDC, WALLET_NAMES } from "../../src/constants.js";
import { resolveHttpCaller, isHttpToolAuthorized, accessDenied } from "./_helpers.js";

const releaseSavings = tool({
  description:
    "Release matured savings entries: finds expired locks, applies streak multiplier, transfers to child wallet. Manager only.",
  inputSchema: z.object({
    childName: z.string().optional().describe("Release for a specific child, or all if omitted"),
    dryRun: z.boolean().default(false).describe("Preview without sending transactions"),
  }),
  execute: async (args) => {
    const caller = await resolveHttpCaller();
    if (!isHttpToolAuthorized("release-savings", caller.role)) {
      return accessDenied("release-savings", caller.role);
    }
    try {
      const state = new StateManager();
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

      const allEntries = await state.loadSavingsEntries();
      const now = new Date();

      const readyEntries = allEntries.filter((e) => {
        if (e.released) return false;
        if (new Date(e.lockUntil) > now) return false;
        if (args.childName && e.childName.toLowerCase() !== args.childName.toLowerCase()) return false;
        return true;
      });

      if (readyEntries.length === 0) {
        return JSON.stringify({ success: true, released: 0, message: "No savings ready for release." });
      }

      const byChild = new Map<string, typeof readyEntries>();
      for (const entry of readyEntries) {
        const list = byChild.get(entry.childName) || [];
        list.push(entry);
        byChild.set(entry.childName, list);
      }

      const results: Array<{ childName: string; entries: number; baseUsd: string; multipliedUsd: string; txHash?: string }> = [];

      for (const [childName, entries] of byChild) {
        const childConfig = config.children.find((c) => c.name.toLowerCase() === childName.toLowerCase());
        if (!childConfig) continue;

        let totalMultiplied = 0, totalBase = 0;
        for (const entry of entries) {
          totalMultiplied += Math.round(entry.amount * entry.multiplierAtDeposit);
          totalBase += entry.amount;
        }

        let txHash: string | undefined;
        if (!args.dryRun) {
          if (!passphrase) {
            return JSON.stringify({ success: false, error: "Family wallet not initialized. Run configure-policy first." });
          }
          if (totalMultiplied > 0) {
            const result = await distributor.transferUSDC(
              WALLET_NAMES.SAVINGS_VAULT,
              childConfig.walletAddress ? childName : WALLET_NAMES.childWallet(childName),
              totalMultiplied, config.chainId, config.usdcAddress, childConfig.walletAddress
            );
            txHash = result.txHash;
          }
          const releaseTime = new Date().toISOString();
          for (const entry of entries) { entry.released = true; entry.releasedAt = releaseTime; }
          await state.saveSavingsEntries(allEntries);

          await state.addAuditEntry({
            id: randomUUID(), timestamp: new Date().toISOString(), action: "savings-release",
            actor: caller.memberId,
            details: { childName, entriesReleased: entries.length, baseAmount: totalBase, multipliedAmount: totalMultiplied },
            txHash, amount: totalMultiplied,
          });
        }

        results.push({
          childName, entries: entries.length,
          baseUsd: (totalBase / 1e6).toFixed(2),
          multipliedUsd: (totalMultiplied / 1e6).toFixed(2),
          txHash,
        });
      }

      return JSON.stringify({
        success: true, dryRun: args.dryRun,
        released: results.reduce((s, r) => s + r.entries, 0),
        distributions: results,
        message: args.dryRun ? "Preview complete. Run with dryRun=false to execute." : "Savings released!",
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
});

export default releaseSavings;
