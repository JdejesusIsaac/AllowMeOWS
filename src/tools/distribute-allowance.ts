import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import { PolicyEngine } from "../engine/policy.js";
import { WalletDistributor } from "../wallet/distributor.js";
import {
  FamilyApiTokenManager,
  lazyMintTokenForLegacyFamily,
} from "../keys/family-api-tokens.js";
import { USDC, WALLET_NAMES } from "../constants.js";
import { checkDestinationAllowlist } from "../core/allowlist.js";
import {
  FilesystemLedger,
  buildLedgerEntriesForAchievement,
  isLedgerOnlyMode,
} from "../engine/ledger.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";

/**
 * Sprint 4.0.3 W3 — Phase C ledger-only path for distribute-allowance.
 *
 * Replaces the on-chain broadcast with a ledger materialization step.
 * For each pending Achievement: ensure LedgerEntries exist (idempotent
 * via `findBySourceId`), then mark `Achievement.ledgerized=true`.
 * Returns a summary plus the §10.1/§10.2 copy from `Copy-reference.md`.
 *
 * NO on-chain transfer. NO allowlist check (the allowlist gate lives
 * on the settlement path, which is now `settle-balance`).
 */
async function distributeAllowanceLedgerOnly(
  state: StateManager,
  engine: PolicyEngine,
  config: Awaited<ReturnType<StateManager["loadFamilyConfig"]>>,
  familyId: string,
  requestedChild: string | undefined,
  caller: CallerContext,
): Promise<ToolResponse> {
  if (!config) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ success: false, error: "No family configured." }),
      }],
    };
  }
  const achievements = await state.loadAchievements(familyId);
  const pending = achievements.filter((a) => {
    if (a.distributed) return false;
    if (a.ledgerized) return false;
    if (requestedChild) return a.childName.toLowerCase() === requestedChild.toLowerCase();
    return true;
  });

  if (pending.length === 0) {
    const msg = "Nothing new to record. All recent achievements are already credited. Run **check-progress** to see the current week.";
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          ledgerized: 0,
          message: msg,
          summary: msg,
        }),
      }],
    };
  }

  const ledger = new FilesystemLedger();
  const perChild = new Map<string, { ledgerEntryCount: number; childMicros: number; savingsMicros: number; achievements: number }>();
  let totalEntriesCreated = 0;

  for (const ach of pending) {
    const childConfig = config.children.find(
      (c) => c.name.toLowerCase() === ach.childName.toLowerCase(),
    );
    if (!childConfig) continue;

    // Idempotent backfill: if entries already exist for this Achievement
    // (e.g. from Phase A dual-write), skip the build step but still
    // flip ledgerized=true.
    const existing = await ledger.findBySourceId(familyId, ach.id);
    let entries = existing;
    if (existing.length === 0) {
      const built = buildLedgerEntriesForAchievement(
        ach,
        childConfig.savingsPercent,
        familyId,
      );
      for (const entry of built) {
        await ledger.append(entry);
      }
      entries = built;
      totalEntriesCreated += built.length;
    }

    const childMicros = entries
      .filter((e) => e.destination === "child-wallet")
      .reduce((s, e) => s + e.amountUsdcMicros, 0);
    const savingsMicros = entries
      .filter((e) => e.destination === "savings-vault")
      .reduce((s, e) => s + e.amountUsdcMicros, 0);

    const slot = perChild.get(ach.childName) ?? {
      ledgerEntryCount: 0,
      childMicros: 0,
      savingsMicros: 0,
      achievements: 0,
    };
    slot.ledgerEntryCount += entries.length;
    slot.childMicros += childMicros;
    slot.savingsMicros += savingsMicros;
    slot.achievements += 1;
    perChild.set(ach.childName, slot);
  }

  // Mark all pending achievements as ledgerized in a single write.
  const nowIso = new Date().toISOString();
  for (const ach of pending) {
    ach.ledgerized = true;
    ach.ledgerizedAt = nowIso;
  }
  await state.saveAchievements(familyId, achievements);

  await state.addAuditEntry(familyId, {
    id: randomUUID(),
    timestamp: nowIso,
    action: "distribute",
    actor: caller.memberId,
    details: {
      tool: "distribute-allowance",
      mode: "ledger-only",
      ledgerizedAchievements: pending.length,
      entriesCreated: totalEntriesCreated,
    },
  });

  // Build Copy-reference.md §10.2 (steady-state) response. The §10.1
  // one-time hint variant is out of scope for the first cut — the
  // contract notes it as nice-to-have; copy can ship behind a flag
  // later without a schema change.
  const lines: string[] = [];
  const totalPendingMicros = Array.from(perChild.values()).reduce(
    (s, v) => s + v.childMicros + v.savingsMicros,
    0,
  );
  for (const [childName, v] of perChild) {
    lines.push(`**Allowance recorded for ${childName}**`);
    lines.push("");
    lines.push(`${v.achievements} achievement(s) credited.`);
    lines.push(
      `Split: $${(v.childMicros / 10 ** USDC.DECIMALS).toFixed(2)} to wallet, ` +
        `$${(v.savingsMicros / 10 ** USDC.DECIMALS).toFixed(2)} to savings`,
    );
    lines.push("");
    lines.push(
      `**Pending settlement:** $${((v.childMicros + v.savingsMicros) / 10 ** USDC.DECIMALS).toFixed(2)} — run **settle-balance** when ready.`,
    );
    lines.push("");
  }
  const summary = lines.join("\n").trimEnd();
  void engine; // engine is unused on the ledger-only path; kept in
  //              signature so the call-site stays symmetric with the
  //              legacy broadcast path.

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        success: true,
        mode: "ledger-only",
        ledgerizedAchievements: pending.length,
        entriesCreated: totalEntriesCreated,
        totalPendingMicros,
        perChild: Object.fromEntries(perChild),
        message: summary,
        summary,
      }),
    }],
  };
}

// Sprint 3.0.2 — extracted core handler so integration tests (AL1–AL5) can
// invoke it directly with a mocked WalletDistributor. The MCP server wires
// the same closure via `registerDistributeAllowanceTool` below.
// Sprint 4.0.3 — exported so Phase C integration tests can invoke
// directly with the ledger-only mode env flag.
export async function distributeAllowanceCore(
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

        // Sprint 4.0.3 W3 — Phase C ledger-only path. When the ledger
        // mode is `ledger-only`, distribute-allowance does ZERO on-chain
        // action. It (a) ensures LedgerEntries exist for every pending
        // achievement (idempotent backfill for any pre-cutover gap),
        // (b) marks each Achievement.ledgerized=true, and (c) returns a
        // summary directing the parent to run `settle-balance` for the
        // actual on-chain push. Phase A (`dual-write`) keeps the legacy
        // broadcast path below unchanged so the ledger model can be
        // validated against real production traffic.
        if (isLedgerOnlyMode()) {
          return await distributeAllowanceLedgerOnly(
            state,
            engine,
            config,
            familyId,
            requestedChild,
            caller,
          );
        }

        // Sprint 4.1 W6 — agent-mode signing. Resolve the OWS API token
        // for this family. Bootstrap path persists it at configure-policy
        // time; pre-4.1 families lazy-mint on first use (one-time scrypt
        // cost amortized over the family's lifetime). Owner-mode signing
        // (`OWS_PASSPHRASE` env var) is no longer supported here — the
        // env-var fallback shipped pre-4.1 cannot map to the correct
        // family in a multi-tenant deployment (Sprint 4.1 D6).
        const apiTokens = new FamilyApiTokenManager();
        let apiToken = apiTokens.getToken(familyId);
        if (!apiToken) {
          try {
            apiToken = await lazyMintTokenForLegacyFamily(familyId);
          } catch (mintErr) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error:
                    `Family wallet not initialized. Run configure-policy first. ` +
                    `(${mintErr instanceof Error ? mintErr.message : String(mintErr)})`,
                }),
              }],
            };
          }
        }
        // Per-family OWS vault (Sprint 2.9.1) — wallets live under data/families/<id>/.ows
        const distributor = new WalletDistributor(apiToken, getFamilyVaultPath(familyId));

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
            // Sprint 4.1 W6 — the previous `if (!passphrase) return ...`
            // guard is now structurally unreachable: the agent-token
            // resolution above either returns a valid token or returns
            // an error response before we reach this loop.
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
