/**
 * Sprint 4.0.3 W6 + W8 — `settle-balance` MCP tool.
 *
 * The only on-chain path after the Phase C cutover. Reads pending (and
 * retryable failed) LedgerEntries, groups by destination, runs the
 * Sprint 3.0.2 / 4.0.1 allowlist check PRE-broadcast, and issues one
 * `transferUSDC` per destination. Pre-existing settlement code paths
 * (`distribute-allowance`, `release-savings`, `settle-session-payout`)
 * become ledger-only in W3-W5.
 *
 * RBAC (LS22-LS25):
 *   - manager → can settle any child, or omit childName for family-wide.
 *   - learner → can settle only their own callerChildName; supplying a
 *     different `childName` returns an error.
 *   - family / advisor → rejected by the role-tool-access matrix in
 *     `src/constants.ts` (returns access-denied before reaching this
 *     handler).
 *
 * Failure semantics (W8):
 *   - Pre-broadcast allowlist rejection → entries stay `pending`, audit
 *     entry records the rejection, no on-chain attempt.
 *   - On-chain failure → entry moves to `status: "failed"` with a
 *     classified `failureReason` and `retryCount += 1`. After 3
 *     failures the entry transitions to `abandoned` and a Sentry event
 *     fires (when SENTRY_DSN is set).
 *   - Partial: per-destination batch is independent — wallet leg may
 *     succeed while savings leg fails (LS41).
 *
 * Copy: response bodies follow `Copy-reference.md` §7-§9 verbatim. W10
 * extends this surface with rich-card builders shared by check-progress.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import { WalletDistributor } from "../wallet/distributor.js";
import {
  FilesystemLedger,
  classifyFailure,
} from "../engine/ledger.js";
import {
  FamilyApiTokenManager,
  lazyMintTokenForLegacyFamily,
} from "../keys/family-api-tokens.js";
import { USDC, WALLET_NAMES } from "../constants.js";
import { checkDestinationAllowlist } from "../core/allowlist.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";
import type {
  ChildConfig,
  FamilyConfig,
  LedgerEntry,
  LedgerEntryDestination,
} from "../schemas.js";
import { initSentry } from "../observability/sentry.js";

/** After this many failed retries with the same destination, abandon. */
const RETRY_ABANDON_THRESHOLD = 3;

interface DestinationGroup {
  childName: string;
  destination: LedgerEntryDestination;
  /** Resolved EVM address (for external wallets) — undefined when the
   *  destination is an OWS-managed internal wallet. */
  externalAddress: string | undefined;
  /** OWS wallet name used by `WalletDistributor.transferUSDC`. */
  owsWalletName: string;
  entries: LedgerEntry[];
  totalMicros: number;
}

/**
 * Group pending+failed entries by (childName, destination). One
 * transferUSDC per group. The group key is (child, destination type)
 * because each child's wallet and the family's savings vault are
 * distinct on-chain addresses.
 */
function groupForSettlement(
  entries: LedgerEntry[],
  children: ChildConfig[],
): DestinationGroup[] {
  const byKey = new Map<string, DestinationGroup>();
  for (const e of entries) {
    const child = children.find(
      (c) => c.name.toLowerCase() === e.childName.toLowerCase(),
    );
    if (!child) continue; // orphan entry; ignored. Operator review.

    const key = `${e.childName.toLowerCase()}|${e.destination}`;
    let group = byKey.get(key);
    if (!group) {
      const owsWalletName =
        e.destination === "savings-vault"
          ? WALLET_NAMES.SAVINGS_VAULT
          : child.walletAddress
            ? child.name
            : WALLET_NAMES.childWallet(child.name);
      const externalAddress =
        e.destination === "child-wallet" ? child.walletAddress : undefined;
      group = {
        childName: child.name,
        destination: e.destination,
        externalAddress,
        owsWalletName,
        entries: [],
        totalMicros: 0,
      };
      byKey.set(key, group);
    }
    group.entries.push(e);
    group.totalMicros += e.amountUsdcMicros;
  }
  return Array.from(byKey.values());
}

interface PerGroupResult {
  childName: string;
  destination: LedgerEntryDestination;
  externalAddress: string | undefined;
  totalMicros: number;
  entryIds: string[];
  status: "settled" | "failed" | "rejected-by-allowlist";
  txHash?: string;
  failureReason?: string;
  abandonedEntryIds?: string[];
}

function fmtUsd(micros: number): string {
  return (micros / 10 ** USDC.DECIMALS).toFixed(2);
}

/**
 * Build the kid/manager-facing response markdown. Single source of
 * truth for the tool's user-visible copy; matches `Copy-reference.md`
 * §7-§9. Pure function — exported so unit tests can render variants
 * without the full handler stack.
 */
export function buildSettleBalanceResponse(input: {
  caller: { role: string; childName?: string };
  childNameScope: string | undefined; // undefined = family-wide
  results: PerGroupResult[];
  dryRun: boolean;
  batchId: string | null;
  preflightBlocked: PerGroupResult[];
  totalsAfter: { totalPendingMicros: number };
}): string {
  const { caller, childNameScope, results, dryRun, preflightBlocked } = input;
  const isKid = caller.role === "learner";

  if (dryRun) {
    return buildDryRunMarkdown({ childNameScope, results, preflightBlocked });
  }

  if (preflightBlocked.length > 0 && results.every((r) => r.status === "rejected-by-allowlist")) {
    return buildAllowlistBlockedMarkdown({ isKid, preflightBlocked });
  }

  const settled = results.filter((r) => r.status === "settled");
  const failed = results.filter((r) => r.status === "failed");

  if (results.length === 0 && preflightBlocked.length === 0) {
    return buildNothingToSettleMarkdown({ childNameScope });
  }

  const headerName = childNameScope ?? "the family";
  const totalSettled = settled.reduce((s, r) => s + r.totalMicros, 0);

  const lines: string[] = [];
  if (failed.length === 0 && preflightBlocked.length === 0) {
    lines.push(`**Settled $${fmtUsd(totalSettled)} for ${headerName}**`);
    lines.push("");
    for (const r of settled) {
      const dest =
        r.destination === "savings-vault" ? "Savings vault" : `${r.childName}'s wallet`;
      lines.push(
        `✅ ${dest}: $${fmtUsd(r.totalMicros)} moved` +
          (r.txHash ? ` (receipt: ${truncateHash(r.txHash)})` : ""),
      );
    }
    lines.push("");
    lines.push("All caught up — pending balance is now clear.");
  } else {
    lines.push(`**Partial settlement for ${headerName}**`);
    lines.push("");
    for (const r of settled) {
      const dest =
        r.destination === "savings-vault" ? "Savings vault" : `${r.childName}'s wallet`;
      lines.push(
        `✅ ${dest}: $${fmtUsd(r.totalMicros)} moved` +
          (r.txHash ? ` (receipt: ${truncateHash(r.txHash)})` : ""),
      );
    }
    for (const r of failed) {
      const dest =
        r.destination === "savings-vault" ? "Savings vault" : `${r.childName}'s wallet`;
      const abandonNote =
        r.abandonedEntryIds && r.abandonedEntryIds.length > 0
          ? " — marked abandoned after 3 retries; requires manual review"
          : "";
      lines.push(
        `⚠️ ${dest}: couldn't move $${fmtUsd(r.totalMicros)} — ${r.failureReason ?? "unknown"}${abandonNote}`,
      );
    }
    for (const r of preflightBlocked) {
      const dest =
        r.destination === "savings-vault" ? "Savings vault" : `${r.childName}'s wallet`;
      lines.push(
        `⚠️ ${dest}: not on the authorized destinations list` +
          (r.externalAddress ? ` (${truncateAddr(r.externalAddress)})` : "") +
          ` — ${isKid ? "ask a parent to update authorized destinations" : "run **configure-policy** to authorize"}`,
      );
    }
    lines.push("");
    lines.push("Don't worry — pending earnings stay safe and will retry on the next settle.");
  }

  return lines.join("\n");
}

function buildDryRunMarkdown(input: {
  childNameScope: string | undefined;
  results: PerGroupResult[];
  preflightBlocked: PerGroupResult[];
}): string {
  const total =
    input.results.reduce((s, r) => s + r.totalMicros, 0) +
    input.preflightBlocked.reduce((s, r) => s + r.totalMicros, 0);
  const lines: string[] = [
    `**Settlement preview for ${input.childNameScope ?? "the family"}**`,
    "",
    "Pending to settle:",
    "",
  ];
  for (const r of [...input.results, ...input.preflightBlocked]) {
    const dest =
      r.destination === "savings-vault" ? "savings vault" : `${r.childName}'s wallet`;
    lines.push(`- $${fmtUsd(r.totalMicros)} → ${dest} (${r.entryIds.length} entries)`);
  }
  lines.push("");
  lines.push(`**Total:** $${fmtUsd(total)} across ${input.results.length + input.preflightBlocked.length} transactions`);
  lines.push("");
  lines.push("Run again with `dryRun: false` to execute.");
  return lines.join("\n");
}

function buildAllowlistBlockedMarkdown(input: {
  isKid: boolean;
  preflightBlocked: PerGroupResult[];
}): string {
  const lines: string[] = [
    `**Settlement on hold**`,
    "",
    input.isKid
      ? "Your wallet isn't on the authorized destinations list yet. A parent needs to add it before you can settle."
      : "The following destinations are not on the authorized list:",
    "",
  ];
  if (!input.isKid) {
    lines.push("| Child | Wallet |");
    lines.push("|-------|--------|");
    for (const r of input.preflightBlocked) {
      lines.push(`| ${r.childName} | ${r.externalAddress ?? "(internal)"} |`);
    }
    lines.push("");
    lines.push(
      "Run **configure-policy** to authorize these destinations, then run **settle-balance** again.",
    );
  } else {
    lines.push("Your pending balance is safe — nothing was lost.");
    lines.push("");
    lines.push(
      "**What to do:** Ask a parent to run **configure-policy** and add your wallet to the authorized destinations.",
    );
  }
  return lines.join("\n");
}

function buildNothingToSettleMarkdown(input: {
  childNameScope: string | undefined;
}): string {
  const name = input.childNameScope ?? "the family";
  return [
    `**All caught up — nothing to settle**`,
    "",
    `No pending earnings for ${name} right now. Come back after the next achievement is verified!`,
  ].join("\n");
}

function truncateHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

function truncateAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// === Core handler (exported for direct integration tests) ===

export async function settleBalanceCore(
  args: Record<string, unknown>,
  caller: CallerContext | null,
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("settle-balance");
  const requestedChild = (args.childName as string | undefined)?.trim();
  const dryRun = Boolean(args.dryRun);

  try {
    // Scope enforcement (LS22, LS23): learners may only operate on
    // their own childName. A learner supplying a different child is
    // rejected with a friendly error.
    let scopeChildName: string | undefined;
    if (caller.role === "learner") {
      if (!caller.childName) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: "Learner identity missing childName — cannot settle.",
            }),
          }],
        };
      }
      if (requestedChild && requestedChild.toLowerCase() !== caller.childName.toLowerCase()) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: `You cannot settle for another child. You can run **settle-balance** for your own pending balance only.`,
            }),
          }],
        };
      }
      scopeChildName = caller.childName;
    } else {
      scopeChildName = requestedChild;
    }

    const state = new StateManager();
    const familyId = caller.familyId;
    const config: FamilyConfig | null = await state.loadFamilyConfig(familyId);
    if (!config) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: false, error: "No family configured." }),
        }],
      };
    }

    // Validate childName exists in family (for clearer error than empty
    // settlement result when name is misspelled).
    if (
      scopeChildName &&
      !config.children.some((c) => c.name.toLowerCase() === scopeChildName!.toLowerCase())
    ) {
      const available = config.children.map((c) => c.name).join(", ");
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: `No child named "${scopeChildName}" in this family. Available: ${available || "(none)"}`,
          }),
        }],
      };
    }

    const ledger = new FilesystemLedger();
    const pickup = await ledger.listPendingOrFailed(familyId, scopeChildName);

    if (pickup.length === 0) {
      const text = buildNothingToSettleMarkdown({ childNameScope: scopeChildName });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            settled: 0,
            failed: 0,
            preflightBlocked: 0,
            batchId: null,
            summary: text,
            message: text,
          }),
        }],
      };
    }

    const groups = groupForSettlement(pickup, config.children);

    // Pre-flight allowlist check. Sprint 3.0.2 Decision 2: the
    // savings-vault leg and OWS-internal child-wallet path are exempt.
    // Only external child-wallet destinations get the allowlist gate.
    const allowlistResults: Array<{ group: DestinationGroup; allowed: boolean; reason?: string }> = [];
    for (const g of groups) {
      if (g.destination === "savings-vault" || !g.externalAddress) {
        allowlistResults.push({ group: g, allowed: true });
        continue;
      }
      const check = checkDestinationAllowlist(
        g.externalAddress,
        config.authorizedDestinations,
      );
      if (check.allowed) {
        allowlistResults.push({ group: g, allowed: true });
      } else {
        allowlistResults.push({ group: g, allowed: false, reason: check.reason });
        await state.addAuditEntry(familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "transfer-rejected-by-allowlist",
          actor: caller.memberId,
          details: {
            tool: "settle-balance",
            childName: g.childName,
            attemptedDestination: g.externalAddress,
            reason: check.reason,
            affectedEntryIds: g.entries.map((e) => e.id),
            note: "ledger entries remain pending",
          },
        });
      }
    }

    const blockedGroups = allowlistResults.filter((r) => !r.allowed).map((r) => r.group);
    const eligibleGroups = allowlistResults.filter((r) => r.allowed).map((r) => r.group);

    const preflightBlockedResults: PerGroupResult[] = blockedGroups.map((g) => ({
      childName: g.childName,
      destination: g.destination,
      externalAddress: g.externalAddress,
      totalMicros: g.totalMicros,
      entryIds: g.entries.map((e) => e.id),
      status: "rejected-by-allowlist",
    }));

    // Dry-run preview: do NOT execute. Eligible + blocked appear in the
    // preview separately so the operator sees what would settle vs
    // what's blocked. No state mutation.
    if (dryRun) {
      const eligibleResults: PerGroupResult[] = eligibleGroups.map((g) => ({
        childName: g.childName,
        destination: g.destination,
        externalAddress: g.externalAddress,
        totalMicros: g.totalMicros,
        entryIds: g.entries.map((e) => e.id),
        status: "settled", // hypothetical; not actually settled
      }));
      const previewText = buildSettleBalanceResponse({
        caller: { role: caller.role, childName: caller.childName },
        childNameScope: scopeChildName,
        results: eligibleResults,
        dryRun: true,
        batchId: null,
        preflightBlocked: preflightBlockedResults,
        totalsAfter: { totalPendingMicros: 0 },
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            dryRun: true,
            previewGroups: eligibleResults.length,
            preflightBlocked: preflightBlockedResults.length,
            summary: previewText,
            message: previewText,
          }),
        }],
      };
    }

    // If every group is blocked, return the allowlist-only response
    // (no on-chain attempt, no batchId). LS31, LS32, LS33.
    if (eligibleGroups.length === 0) {
      const text = buildSettleBalanceResponse({
        caller: { role: caller.role, childName: caller.childName },
        childNameScope: scopeChildName,
        results: [],
        dryRun: false,
        batchId: null,
        preflightBlocked: preflightBlockedResults,
        totalsAfter: { totalPendingMicros: pickup.reduce((s, e) => s + e.amountUsdcMicros, 0) },
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            settled: 0,
            failed: 0,
            preflightBlocked: preflightBlockedResults.length,
            batchId: null,
            summary: text,
            message: text,
          }),
        }],
      };
    }

    // Resolve the OWS API token for signing. Sprint 4.0.1 agent-mode.
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
    const distributor = new WalletDistributor(apiToken, getFamilyVaultPath(familyId));

    // Execute one transferUSDC per eligible group.
    const batchId = randomUUID();
    const settlementResults: PerGroupResult[] = [];

    for (const group of eligibleGroups) {
      const entryIds = group.entries.map((e) => e.id);
      try {
        const result = await distributor.transferUSDC(
          WALLET_NAMES.TREASURY,
          group.owsWalletName,
          group.totalMicros,
          config.chainId,
          config.usdcAddress,
          group.externalAddress,
        );

        await ledger.markSettled(familyId, entryIds, result.txHash, batchId);

        // Side-effect: when settling savings-deposit entries, create
        // the corresponding SavingsEntry records (one per ledger entry
        // so the lock period + multiplier-at-deposit are preserved
        // per-deposit, matching pre-4.0.3 distribute-allowance shape).
        if (group.destination === "savings-vault") {
          for (const e of group.entries) {
            if (e.kind === "savings-deposit") {
              const childConfig = config.children.find(
                (c: ChildConfig) =>
                  c.name.toLowerCase() === e.childName.toLowerCase(),
              );
              const lockDays = childConfig?.savingsLockDays ?? 90;
              const streak = await state.loadStreak(familyId, e.childName);
              await state.addSavingsEntry(familyId, {
                id: randomUUID(),
                childName: e.childName,
                amount: e.amountUsdcMicros,
                depositedAt: new Date().toISOString(),
                lockUntil: new Date(
                  Date.now() + lockDays * 24 * 60 * 60 * 1000,
                ).toISOString(),
                released: false,
                multiplierAtDeposit: streak?.multiplier ?? 1.0,
              });
            }
          }
        }

        await state.addAuditEntry(familyId, {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          action: "distribute",
          actor: caller.memberId,
          details: {
            tool: "settle-balance",
            childName: group.childName,
            destination: group.destination,
            entryCount: group.entries.length,
            settlementBatchId: batchId,
          },
          txHash: result.txHash,
          amount: group.totalMicros,
        });

        settlementResults.push({
          childName: group.childName,
          destination: group.destination,
          externalAddress: group.externalAddress,
          totalMicros: group.totalMicros,
          entryIds,
          status: "settled",
          txHash: result.txHash,
        });
      } catch (err) {
        const reason = classifyFailure(err);
        await ledger.markFailed(familyId, entryIds, reason);

        // Re-read to check retryCount post-mark (we want POST-increment
        // value to decide abandon). Then transition any that have hit
        // the threshold to abandoned and fire Sentry.
        const refreshed = await ledger.listFailed(familyId, group.childName);
        const justFailed = refreshed.filter((e) => entryIds.includes(e.id));
        const toAbandon = justFailed.filter(
          (e) => e.retryCount >= RETRY_ABANDON_THRESHOLD,
        );
        if (toAbandon.length > 0) {
          await ledger.markAbandoned(
            familyId,
            toAbandon.map((e) => e.id),
          );
          await fireAbandonEvent({
            familyId,
            childName: group.childName,
            destination: group.destination,
            failureReason: reason,
            entryIds: toAbandon.map((e) => e.id),
          });
        }

        settlementResults.push({
          childName: group.childName,
          destination: group.destination,
          externalAddress: group.externalAddress,
          totalMicros: group.totalMicros,
          entryIds,
          status: "failed",
          failureReason: reason,
          abandonedEntryIds: toAbandon.length > 0 ? toAbandon.map((e) => e.id) : undefined,
        });
      }
    }

    const allResults = [...settlementResults, ...preflightBlockedResults];
    const settledCount = settlementResults.filter((r) => r.status === "settled").length;
    const failedCount = settlementResults.filter((r) => r.status === "failed").length;

    const text = buildSettleBalanceResponse({
      caller: { role: caller.role, childName: caller.childName },
      childNameScope: scopeChildName,
      results: settlementResults,
      dryRun: false,
      batchId,
      preflightBlocked: preflightBlockedResults,
      totalsAfter: { totalPendingMicros: 0 },
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: failedCount === 0 && preflightBlockedResults.length === 0,
          settled: settledCount,
          failed: failedCount,
          preflightBlocked: preflightBlockedResults.length,
          batchId,
          results: allResults,
          summary: text,
          message: text,
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

/**
 * Fire a Sentry event for an abandoned ledger entry. Sentry init is
 * lazy and safe to call from any tool handler — it returns null in
 * environments without `SENTRY_DSN`, in which case this function is a
 * no-op (the event is dropped silently; production has the DSN).
 */
async function fireAbandonEvent(input: {
  familyId: string;
  childName: string;
  destination: LedgerEntryDestination;
  failureReason: string;
  entryIds: string[];
}): Promise<void> {
  try {
    const sentry = await initSentry();
    if (!sentry?.captureException) return;
    const err = new Error(
      `Ledger entry abandoned after ${RETRY_ABANDON_THRESHOLD} retries: ` +
        `family=${input.familyId} child=${input.childName} ` +
        `destination=${input.destination} reason=${input.failureReason} ` +
        `entryIds=${input.entryIds.join(",")}`,
    );
    sentry.captureException(err);
  } catch {
    // Sentry failure must not break settlement. The ledger has the
    // abandoned status; an operator dashboard query will surface it.
  }
}

export const settleBalanceHandler = withAccessControl(
  "settle-balance",
  settleBalanceCore,
);

export function registerSettleBalanceTool(server: McpServer): void {
  server.tool(
    "settle-balance",
    "Push pending ledger entries on-chain. Batches transfers by destination so weekly settlement is one tx per wallet/vault instead of one per achievement.",
    {
      childName: z.string().optional().describe(
        "Settle only the named child's pending balance. Omit to settle " +
          "all children in the family. Learner role: must be your own " +
          "childName (or omit and settle yours by default).",
      ),
      dryRun: z.boolean().optional().default(false).describe(
        "Preview the settlement without broadcasting. Returns groups, " +
          "amounts, and allowlist results.",
      ),
      ...rbacFields,
    },
    settleBalanceHandler,
  );
}
