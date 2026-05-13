import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import { PolicyEngine } from "../engine/policy.js";
import { WalletDistributor } from "../wallet/distributor.js";
import { FamilyKeyManager } from "../keys/family-keys.js";
import { USDC, WALLET_NAMES } from "../constants.js";
import { checkDestinationAllowlist } from "../core/allowlist.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";

// Sprint 3.0.2 — extracted core handler so integration tests (AL1–AL5) can
// invoke it directly with a mocked WalletDistributor. The MCP server wires
// the same closure via `registerDistributeAllowanceTool` below.
async function distributeAllowanceCore(
  args: Record<string, unknown>,
  caller: CallerContext | null
): Promise<ToolResponse> {
      if (!caller) return buildNoIdentityResponse("distribute-allowance");
      const requestedChild = args.childName as string | undefined;
      const dryRun = args.dryRun as boolean;
      try {
        const state = new StateManager();
        const engine = new PolicyEngine();
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
          // Backward compat: legacy family without per-family key
          passphrase = process.env.OWS_PASSPHRASE;
          console.error(`[keys] Using legacy OWS_PASSPHRASE for family. New families use per-family keys.`);
        }
        // Per-family OWS vault (Sprint 2.9.1) — wallets live under data/families/<id>/.ows
        const distributor = new WalletDistributor(passphrase, getFamilyVaultPath(familyId));

        // Get pending achievements
        const achievements = await state.loadAchievements(familyId);
        const pending = achievements.filter((a) => {
          if (a.distributed) return false;
          if (requestedChild) return a.childName.toLowerCase() === requestedChild.toLowerCase();
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
          // Sprint 3.0.2 — set when the destination allowlist rejects this
          // child's leg. When set, no on-chain transfer is attempted and
          // achievements remain undistributed (caller retries after
          // updating the allowlist).
          rejectedReason?: string;
          attemptedDestination?: string;
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
          let rejectedReason: string | undefined;
          let attemptedDestination: string | undefined;

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

            // Sprint 3.0.2 — Destination allowlist check on the child-wallet
            // leg. Decision 2: the savings-vault leg below is exempt (internal
            // vault plumbing). The check only applies when the child has an
            // external walletAddress configured — the OWS-internal-wallet path
            // (childConfig.walletAddress === undefined) is also exempt because
            // that destination lives in the family's own OWS vault, not a
            // user-facing address that can be tampered with.
            if (childAmount > 0 && childConfig.walletAddress) {
              const check = checkDestinationAllowlist(
                childConfig.walletAddress,
                config.authorizedDestinations
              );
              if (!check.allowed) {
                rejectedReason = check.reason;
                attemptedDestination = childConfig.walletAddress;
                await state.addAuditEntry(familyId, {
                  id: randomUUID(),
                  timestamp: new Date().toISOString(),
                  action: "transfer-rejected-by-allowlist",
                  actor: caller.memberId,
                  details: {
                    tool: "distribute-allowance",
                    childName,
                    attemptedDestination: childConfig.walletAddress,
                    reason: check.reason,
                  },
                });
                // Push the result and skip to the next child. Achievements
                // remain undistributed; treasury USDC unchanged.
                results.push({
                  childName,
                  totalUsd: (totalAmount / 10 ** USDC.DECIMALS).toFixed(2),
                  childAmountUsd: (childAmount / 10 ** USDC.DECIMALS).toFixed(2),
                  savingsAmountUsd: (savingsAmount / 10 ** USDC.DECIMALS).toFixed(2),
                  achievements: childAchievements.length,
                  rejectedReason,
                  attemptedDestination,
                });
                continue;
              }
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
                await state.addSavingsEntry(familyId, {
                  id: randomUUID(),
                  childName,
                  amount: savingsAmount,
                  depositedAt: new Date().toISOString(),
                  lockUntil: new Date(
                    Date.now() + childConfig.savingsLockDays * 24 * 60 * 60 * 1000
                  ).toISOString(),
                  released: false,
                  multiplierAtDeposit: (await state.loadStreak(familyId, childName))?.multiplier ?? 1.0,
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
            await state.saveAchievements(familyId, achievements);

            // Audit log
            await state.addAuditEntry(familyId, {
              id: randomUUID(),
              timestamp: now,
              action: "distribute",
              actor: caller.memberId,
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
              dryRun,
              distributions: results,
              message: dryRun
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

// Sprint 3.0.2 — wrapped handler that performs the standard access-control
// dance, then delegates to `distributeAllowanceCore`. Exported so AL1–AL5
// integration tests can invoke without spinning up an McpServer.
export const distributeAllowanceHandler = withAccessControl(
  "distribute-allowance",
  distributeAllowanceCore
);

export function registerDistributeAllowanceTool(server: McpServer): void {
  server.tool(
    "distribute-allowance",
    "Distribute pending achievement rewards to child wallets and savings vault via USDC transfers.",
    {
      childName: z.string().optional().describe("Distribute for a specific child, or all children if omitted"),
      dryRun: z.boolean().default(false).describe("Preview distribution without sending transactions"),
      ...rbacFields,
    },
    distributeAllowanceHandler
  );
}
