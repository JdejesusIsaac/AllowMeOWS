import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
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

// Sprint 3.0.2 — extracted core handler so integration tests (AL6, AL7) can
// invoke it directly with a mocked WalletDistributor.
async function releaseSavingsCore(
  args: Record<string, unknown>,
  caller: CallerContext | null
): Promise<ToolResponse> {
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
        // Per-family OWS vault (Sprint 2.9.1) — wallets live under data/families/<id>/.ows
        const distributor = new WalletDistributor(passphrase, getFamilyVaultPath(familyId));

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
          // Sprint 3.0.2 — set when the destination allowlist rejects this
          // child's release. When set, the entries remain locked
          // (released:false) and no on-chain transfer is attempted.
          rejectedReason?: string;
          attemptedDestination?: string;
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
            // leg. Decision 2: the savings-vault-as-source is exempt by
            // construction (fromWallet=SAVINGS_VAULT below); we constrain
            // only the destination. The OWS-internal-wallet path
            // (childConfig.walletAddress === undefined) is exempt — that
            // destination lives in the family's own OWS vault, not a
            // user-facing address that can be tampered with.
            //
            // On rejection: write audit entry with affectedEntryIds for the
            // parent's debugging trail, skip this child entirely (entries
            // remain `released: false`, no on-chain transfer, no PAXG
            // ledger update either — see "Mark PAXG entries as released"
            // below, which is also guarded by this rejection).
            if (totalMultiplied > 0 && childConfig.walletAddress) {
              const check = checkDestinationAllowlist(
                childConfig.walletAddress,
                config.authorizedDestinations
              );
              if (!check.allowed) {
                rejectedReason = check.reason;
                attemptedDestination = childConfig.walletAddress;
                const affectedEntryIds = [
                  ...usdcEntries.map((e) => e.id),
                  ...paxgEntries.map((e) => e.id),
                ];
                await state.addAuditEntry(familyId, {
                  id: randomUUID(),
                  timestamp: new Date().toISOString(),
                  action: "transfer-rejected-by-allowlist",
                  actor: caller.memberId,
                  details: {
                    tool: "release-savings",
                    childName,
                    attemptedDestination: childConfig.walletAddress,
                    reason: check.reason,
                    affectedEntryIds,
                    note: "savings entries remain locked",
                  },
                });
                results.push({
                  childName,
                  entriesReleased: 0,
                  baseAmountUsd: (totalBase / 10 ** USDC.DECIMALS).toFixed(2),
                  multipliedAmountUsd: (totalMultiplied / 10 ** USDC.DECIMALS).toFixed(2),
                  rejectedReason,
                  attemptedDestination,
                });
                continue;
              }
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
}

// Sprint 3.0.2 — wrapped handler exported for integration tests (AL6, AL7).
export const releaseSavingsHandler = withAccessControl(
  "release-savings",
  releaseSavingsCore
);

export function registerReleaseSavingsTool(server: McpServer): void {
  server.tool(
    "release-savings",
    "Release matured savings entries: finds expired locks, applies streak multiplier, transfers to child wallet, and marks released.",
    {
      childName: z.string().optional().describe("Release for a specific child, or all children if omitted"),
      dryRun: z.boolean().default(false).describe("Preview release without sending transactions"),
      ...rbacFields,
    },
    releaseSavingsHandler
  );
}
