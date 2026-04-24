import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { WalletDistributor } from "../wallet/distributor.js";
import { FamilyKeyManager } from "../keys/family-keys.js";
import { USDC, WALLET_NAMES } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
} from "../middleware/access-control.js";

export function registerReleaseSavingsTool(server: McpServer): void {
  server.tool(
    "release-savings",
    "Release matured savings entries: finds expired locks, applies streak multiplier, transfers to child wallet, and marks released.",
    {
      childName: z.string().optional().describe("Release for a specific child, or all children if omitted"),
      dryRun: z.boolean().default(false).describe("Preview release without sending transactions"),
      ...rbacFields,
    },
    withAccessControl("release-savings", async (args, caller) => {
      if (!caller) return buildNoIdentityResponse("release-savings");
      const requestedChild = args.childName as string | undefined;
      const dryRun = args.dryRun as boolean;
      try {
        const state = new StateManager();
        const familyId = caller.familyId;

        const config = await state.loadFamilyConfig(familyId);
        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured." }),
            }],
          };
        }

        // Auto-resolve per-family encryption key scoped to this caller's family
        const keyManager = new FamilyKeyManager();
        let passphrase: string | undefined;
        if (keyManager.hasFamilyKey(familyId)) {
          passphrase = keyManager.getFamilyKey(familyId);
        } else if (process.env.OWS_PASSPHRASE) {
          passphrase = process.env.OWS_PASSPHRASE;
          console.error(`[keys] Using legacy OWS_PASSPHRASE for family. New families use per-family keys.`);
        }
        const distributor = new WalletDistributor(passphrase);

        // Load all savings entries for this family (not filtered by child yet,
        // so we can save them all back)
        const allEntries = await state.loadSavingsEntries(familyId);
        const now = new Date();

        // Find expired, unreleased, non-converted entries
        const readyEntries = allEntries.filter((e) => {
          if (e.released) return false;
          if (e.converted) return false;
          if (new Date(e.lockUntil) > now) return false;
          if (requestedChild && e.childName.toLowerCase() !== requestedChild.toLowerCase()) return false;
          return true;
        });

        if (readyEntries.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                released: 0,
                message: "No savings ready for release.",
              }),
            }],
          };
        }

        // Group by child
        const byChild = new Map<string, typeof readyEntries>();
        for (const entry of readyEntries) {
          const list = byChild.get(entry.childName) || [];
          list.push(entry);
          byChild.set(entry.childName, list);
        }

        const results: Array<{
          childName: string;
          entriesReleased: number;
          baseAmountUsd: string;
          multipliedAmountUsd: string;
          txHash?: string;
          paxgReleased?: { entries: number; totalOz: string; message: string };
        }> = [];

        for (const [childName, entries] of byChild) {
          const childConfig = config.children.find(
            (c) => c.name.toLowerCase() === childName.toLowerCase()
          );
          if (!childConfig) continue;

          // Split USDC vs PAXG entries
          const usdcEntries = entries.filter((e) => (e.asset || "USDC") === "USDC");
          const paxgEntries = entries.filter((e) => e.asset === "PAXG");

          // Apply multiplier at deposit time for USDC entries only
          let totalMultiplied = 0;
          let totalBase = 0;
          for (const entry of usdcEntries) {
            const multiplied = Math.round(entry.amount * entry.multiplierAtDeposit);
            totalMultiplied += multiplied;
            totalBase += entry.amount;
          }

          let txHash: string | undefined;

          if (!dryRun) {
            if (!passphrase) {
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    error: "Family wallet not initialized. Run configure-policy first.",
                  }),
                }],
              };
            }

            // Transfer USDC from savings vault to child wallet
            if (totalMultiplied > 0) {
              const result = await distributor.transferUSDC(
                WALLET_NAMES.SAVINGS_VAULT,
                childConfig.walletAddress ? childName : WALLET_NAMES.childWallet(childName),
                totalMultiplied,
                config.chainId,
                config.usdcAddress,
                childConfig.walletAddress
              );
              txHash = result.txHash;
            }

            // Mark USDC entries as released
            const releaseTime = new Date().toISOString();
            for (const entry of usdcEntries) {
              entry.released = true;
              entry.releasedAt = releaseTime;
            }

            // Mark PAXG entries as released (ledger only — no on-chain transfer)
            for (const entry of paxgEntries) {
              entry.released = true;
              entry.releasedAt = releaseTime;
            }

            await state.saveSavingsEntries(familyId, allEntries);

            // Audit log
            await state.addAuditEntry(familyId, {
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              action: "savings-release",
              actor: caller.memberId,
              details: {
                childName,
                usdcEntriesReleased: usdcEntries.length,
                paxgEntriesReleased: paxgEntries.length,
                baseAmount: totalBase,
                multipliedAmount: totalMultiplied,
              },
              txHash,
              amount: totalMultiplied,
            });
          }

          // Build PAXG release info
          const paxgReleased = paxgEntries.length > 0
            ? {
                entries: paxgEntries.length,
                totalOz: paxgEntries.reduce((sum, e) => sum + parseFloat(e.receivedAmount || "0"), 0).toFixed(6),
                message: "Gold release requires MoonPay swap — Claude will handle the conversion back to USDC for transfer to the child's wallet.",
              }
            : undefined;

          results.push({
            childName,
            entriesReleased: usdcEntries.length + paxgEntries.length,
            baseAmountUsd: (totalBase / 10 ** USDC.DECIMALS).toFixed(2),
            multipliedAmountUsd: (totalMultiplied / 10 ** USDC.DECIMALS).toFixed(2),
            txHash,
            paxgReleased,
          });
        }

        const totalReleased = results.reduce((sum, r) => sum + r.entriesReleased, 0);
        const summary = results
          .map((r) => {
            let line = `${r.childName}: ${r.entriesReleased} entries`;
            if (r.baseAmountUsd !== "0.00") {
              line += `, $${r.baseAmountUsd} base → $${r.multipliedAmountUsd} with multiplier`;
            }
            if (r.txHash) {
              line += ` [tx: ${r.txHash.slice(0, 10)}...]`;
            }
            if (r.paxgReleased) {
              line += `\n  PAXG: ${r.paxgReleased.totalOz} oz (${r.paxgReleased.entries} entries) — ${r.paxgReleased.message}`;
            }
            return line;
          })
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              dryRun,
              released: totalReleased,
              distributions: results,
              message: dryRun
                ? `Preview:\n${summary}\n\nRun again with dryRun=false to execute.`
                : `Released ${totalReleased} savings entries:\n${summary}`,
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          }],
        };
      }
    })
  );
}
