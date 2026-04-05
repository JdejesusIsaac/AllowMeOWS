import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { WalletDistributor } from "../wallet/distributor.js";
import { USDC, WALLET_NAMES } from "../constants.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

export function registerReleaseSavingsTool(server: McpServer): void {
  server.tool(
    "release-savings",
    "Release matured savings entries: finds expired locks, applies streak multiplier, transfers to child wallet, and marks released.",
    {
      childName: z.string().optional().describe("Release for a specific child, or all children if omitted"),
      dryRun: z.boolean().default(false).describe("Preview release without sending transactions"),
      ...rbacFields,
    },
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("release-savings", caller.role)) {
        return buildAccessDeniedResponse("release-savings", caller.role);
      }
      try {
        const state = new StateManager();
        const passphrase = process.env.OWS_PASSPHRASE;
        const distributor = new WalletDistributor(passphrase);

        const config = await state.loadFamilyConfig();
        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured." }),
            }],
          };
        }

        // Load all savings entries (not filtered by child yet, so we can save them all back)
        const allEntries = await state.loadSavingsEntries();
        const now = new Date();

        // Find expired, unreleased entries
        const readyEntries = allEntries.filter((e) => {
          if (e.released) return false;
          if (new Date(e.lockUntil) > now) return false;
          if (args.childName && e.childName.toLowerCase() !== args.childName.toLowerCase()) return false;
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
        }> = [];

        for (const [childName, entries] of byChild) {
          const childConfig = config.children.find(
            (c) => c.name.toLowerCase() === childName.toLowerCase()
          );
          if (!childConfig) continue;

          // Apply multiplier at deposit time for each entry
          let totalMultiplied = 0;
          let totalBase = 0;
          for (const entry of entries) {
            const multiplied = Math.round(entry.amount * entry.multiplierAtDeposit);
            totalMultiplied += multiplied;
            totalBase += entry.amount;
          }

          let txHash: string | undefined;

          if (!args.dryRun) {
            if (!passphrase) {
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    error: "Wallet passphrase not configured. Set the OWS_PASSPHRASE environment variable.",
                  }),
                }],
              };
            }

            // Transfer from savings vault to child wallet
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

            // Mark entries as released
            const releaseTime = new Date().toISOString();
            for (const entry of entries) {
              entry.released = true;
              entry.releasedAt = releaseTime;
            }
            await state.saveSavingsEntries(allEntries);

            // Audit log
            await state.addAuditEntry({
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              action: "savings-release",
              actor: caller.memberId,
              details: {
                childName,
                entriesReleased: entries.length,
                baseAmount: totalBase,
                multipliedAmount: totalMultiplied,
              },
              txHash,
              amount: totalMultiplied,
            });
          }

          results.push({
            childName,
            entriesReleased: entries.length,
            baseAmountUsd: (totalBase / 10 ** USDC.DECIMALS).toFixed(2),
            multipliedAmountUsd: (totalMultiplied / 10 ** USDC.DECIMALS).toFixed(2),
            txHash,
          });
        }

        const totalReleased = results.reduce((sum, r) => sum + r.entriesReleased, 0);
        const summary = results
          .map(
            (r) =>
              `${r.childName}: ${r.entriesReleased} entries, $${r.baseAmountUsd} base → $${r.multipliedAmountUsd} with multiplier` +
              (r.txHash ? ` [tx: ${r.txHash.slice(0, 10)}...]` : "")
          )
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              dryRun: args.dryRun,
              released: totalReleased,
              distributions: results,
              message: args.dryRun
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
    }
  );
}
