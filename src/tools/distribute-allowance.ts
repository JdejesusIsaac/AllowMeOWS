import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager } from "../engine/state.js";
import { PolicyEngine } from "../engine/policy.js";
import { WalletDistributor } from "../wallet/distributor.js";
import { USDC, WALLET_NAMES } from "../constants.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

export function registerDistributeAllowanceTool(server: McpServer): void {
  server.tool(
    "distribute-allowance",
    "Distribute pending achievement rewards to child wallets and savings vault via USDC transfers.",
    {
      childName: z.string().optional().describe("Distribute for a specific child, or all children if omitted"),
      dryRun: z.boolean().default(false).describe("Preview distribution without sending transactions"),
      passphrase: z.string().optional().describe("Wallet passphrase to authorize the transaction (required for real distributions)"),
      ...rbacFields,
    },
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("distribute-allowance", caller.role)) {
        return buildAccessDeniedResponse("distribute-allowance", caller.role);
      }
      try {
        const state = new StateManager();
        const engine = new PolicyEngine();
        const distributor = new WalletDistributor(args.passphrase);

        const config = await state.loadFamilyConfig();
        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured." }),
            }],
          };
        }

        // Get pending achievements
        const achievements = await state.loadAchievements();
        const pending = achievements.filter((a) => {
          if (a.distributed) return false;
          if (args.childName) return a.childName.toLowerCase() === args.childName.toLowerCase();
          return true;
        });

        if (pending.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: "No pending achievements to distribute.",
              }),
            }],
          };
        }

        // Group by child
        const byChild = new Map<string, typeof pending>();
        for (const ach of pending) {
          const list = byChild.get(ach.childName) || [];
          list.push(ach);
          byChild.set(ach.childName, list);
        }

        const results: Array<{
          childName: string;
          totalUsd: string;
          childAmountUsd: string;
          savingsAmountUsd: string;
          achievements: number;
          txHash?: string;
          savingsTxHash?: string;
          savingsError?: string;
        }> = [];

        for (const [childName, childAchievements] of byChild) {
          const childConfig = config.children.find(
            (c) => c.name.toLowerCase() === childName.toLowerCase()
          );
          if (!childConfig) continue;

          const totalAmount = childAchievements.reduce((sum, a) => sum + a.amount, 0);
          const { childAmount, savingsAmount } = engine.calculateSavingsSplit(
            totalAmount,
            childConfig.savingsPercent
          );

          let txHash: string | undefined;
          let savingsTxHash: string | undefined;
          let savingsError: string | undefined;

          if (!args.dryRun) {
            if (!args.passphrase) {
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    error: "A passphrase is required to send real transactions. Provide your wallet passphrase, or use dryRun=true to preview.",
                  }),
                }],
              };
            }

            // Transfer to child wallet (use external address if configured, else OWS wallet)
            if (childAmount > 0) {
              const childResult = await distributor.transferUSDC(
                WALLET_NAMES.TREASURY,
                childConfig.walletAddress ? childName : WALLET_NAMES.childWallet(childName),
                childAmount,
                config.chainId,
                config.usdcAddress,
                childConfig.walletAddress
              );
              txHash = childResult.txHash;
            }

            // Transfer to savings vault (non-fatal if this fails)
            if (savingsAmount > 0) {
              try {
                const savingsResult = await distributor.transferUSDC(
                  WALLET_NAMES.TREASURY,
                  WALLET_NAMES.SAVINGS_VAULT,
                  savingsAmount,
                  config.chainId,
                  config.usdcAddress
                );
                savingsTxHash = savingsResult.txHash;

                // Record savings entry
                await state.addSavingsEntry({
                  id: randomUUID(),
                  childName,
                  amount: savingsAmount,
                  depositedAt: new Date().toISOString(),
                  lockUntil: new Date(
                    Date.now() + childConfig.savingsLockDays * 24 * 60 * 60 * 1000
                  ).toISOString(),
                  released: false,
                  multiplierAtDeposit: (await state.loadStreak(childName))?.multiplier ?? 1.0,
                });
              } catch (savErr) {
                savingsError = savErr instanceof Error ? savErr.message : "Savings transfer failed";
              }
            }

            // Mark achievements as distributed (child transfer succeeded)
            const now = new Date().toISOString();
            for (const ach of childAchievements) {
              ach.distributed = true;
              ach.distributedAt = now;
              ach.txHash = txHash;
            }
            await state.saveAchievements(achievements);

            // Audit log
            await state.addAuditEntry({
              id: randomUUID(),
              timestamp: now,
              action: "distribute",
              actor: "manager",
              details: {
                childName,
                achievementCount: childAchievements.length,
                totalAmount,
                childAmount,
                savingsAmount,
                savingsError,
              },
              txHash,
              amount: totalAmount,
            });
          }

          results.push({
            childName,
            totalUsd: (totalAmount / 10 ** USDC.DECIMALS).toFixed(2),
            childAmountUsd: (childAmount / 10 ** USDC.DECIMALS).toFixed(2),
            savingsAmountUsd: (savingsAmount / 10 ** USDC.DECIMALS).toFixed(2),
            achievements: childAchievements.length,
            txHash,
            savingsTxHash,
            savingsError,
          });
        }

        const summary = results
          .map(
            (r) =>
              `${r.childName}: $${r.totalUsd} total (${r.achievements} achievements) → ` +
              `$${r.childAmountUsd} to wallet, $${r.savingsAmountUsd} to savings` +
              (r.txHash ? ` [tx: ${r.txHash.slice(0, 10)}...]` : "")
          )
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              dryRun: args.dryRun,
              distributions: results,
              message: args.dryRun
                ? `Preview:\n${summary}\n\nRun again with dryRun=false to execute.`
                : `Distributed:\n${summary}`,
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
