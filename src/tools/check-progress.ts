import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager, getFamilyVaultPath } from "../engine/state.js";
import { USDC, WALLET_NAMES } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  getChildScope,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";
import { renderProgressBar, formatUsdFromMicro } from "../utils/card-formatting.js";
import { FilesystemLedger, isLedgerWriteEnabled } from "../engine/ledger.js";
import {
  fetchUsdcBalanceMicros,
  resolveChildWalletAddress,
} from "../utils/usdc-balance.js";

/**
 * Sprint 3.6 rich markdown card (contract C3 CARD1): progress bar + $ + 🔥/⏳ + 👉
 *
 * Sprint 4.0.3 W10 — extended with the load-bearing earned-vs-spendable
 * UX (Copy-reference.md §3-§5):
 *   • `walletBalanceMicro` — on-chain USDC balance via `balanceOf`.
 *     `null` when the lookup failed (RPC out, no resolvable address).
 *   • `pendingLedgerMicro` — sum of unsettled LedgerEntries; the gap
 *     between "earned" and "spendable".
 *   • `autoSettleOn` + `nextSundayDays` — selects manual vs auto-settle
 *     copy variants (Copy-reference.md §3 vs §4).
 *   • `role` — manager vs learner copy fork (§3 vs §5).
 *
 * All new fields are optional so pre-4.0.3 callers (and the
 * empty-state path) continue to render the legacy card.
 */
export function buildCheckProgressRichMarkdown(input: {
  childName: string;
  weeklyBudgetMicro: number;
  totalEarnedMicro: number;
  pendingMicro: number;
  categories: Array<{ name: string; budget: number }>;
  byCatEarned: Record<string, number>;
  streak: { currentStreak: number; multiplier: number } | null;
  hasEarnedOrPending: boolean;
  // Sprint 4.0.3 W10
  walletBalanceMicro?: number | null;
  pendingLedgerMicro?: number;
  autoSettleOn?: boolean;
  nextSundayDays?: number;
  role?: string;
}): string {
  const streakDays = input.streak?.currentStreak ?? 0;
  const mult = input.streak?.multiplier ?? 1;
  const streakEmoji =
    streakDays >= 7 ? "🔥" : streakDays >= 1 ? "🔥" : "⏳";
  const weekBar = renderProgressBar(
    input.totalEarnedMicro,
    Math.max(input.weeklyBudgetMicro, 1),
    10,
  );

  // Sprint 4.0.3 W10 — settlement-aware fields. `pendingLedgerMicro` is
  // the source of truth for "pending settlement"; fall back to the legacy
  // achievement-based `pendingMicro` only when the ledger view is absent.
  const managerView = input.role !== undefined && input.role !== "learner";
  const walletMicro = input.walletBalanceMicro;
  const pendingSettleMicro = input.pendingLedgerMicro ?? input.pendingMicro ?? 0;
  const autoOn = input.autoSettleOn === true;
  const sundayDays = input.nextSundayDays ?? 0;

  const lines: string[] = [`**${input.childName}'s week so far**`, ""];

  /** Render the 💰 wallet row. Skipped entirely when balance is unknown
   *  (null) so a transient RPC outage never shows a misleading $0.00. */
  const pushWalletRow = (earnedThisWeekZero: boolean): void => {
    if (walletMicro === null || walletMicro === undefined) return;
    const amt = formatUsdFromMicro(walletMicro);
    if (managerView) {
      lines.push(`💰 **In ${input.childName}'s wallet:** ${amt} spendable`);
    } else if (earnedThisWeekZero && walletMicro > 0) {
      // Copy-reference §3.4 — no earnings this week but money carried over.
      lines.push(`💰 **In your wallet:** ${amt} from previous weeks`);
    } else {
      lines.push(`💰 **In your wallet:** ${amt} ready to spend`);
    }
  };

  /** Render the ⏳ pending-settlement row + any settlement-options block. */
  const pushPendingRows = (): void => {
    if (pendingSettleMicro <= 0) return;
    const amt = formatUsdFromMicro(pendingSettleMicro);
    if (managerView) {
      if (autoOn) {
        lines.push(`⏳ **Pending:** ${amt} — auto-settles Sunday 00:00 UTC (in ${sundayDays} days)`);
        lines.push(`✅ Auto-settle is enabled. Run **settle-balance** if you'd like to settle sooner.`);
      } else {
        lines.push(`⏳ **Pending:** ${amt} earned but not yet moved to wallet`);
      }
      return;
    }
    // Kid-facing pending copy.
    if (autoOn) {
      const when = sundayDays <= 0 ? "tonight" : `Sunday (in ${sundayDays} days)`;
      lines.push(`⏳ **Pending settlement:** ${amt} — auto-settles ${when}`);
    } else {
      lines.push(`⏳ **Pending settlement:** ${amt} — run **settle-balance** to move it to your wallet`);
    }
  };

  if (!input.hasEarnedOrPending) {
    lines.push(
      `Earned this week: ${formatUsdFromMicro(0)} / ${formatUsdFromMicro(input.weeklyBudgetMicro)} ${weekBar}`,
    );
    // Carry-over wallet balance can still exist with zero earnings.
    if (walletMicro && walletMicro > 0) {
      lines.push("Ready when you are.");
      lines.push("");
      pushWalletRow(true);
      lines.push("");
      lines.push("👉 Tell a parent what you accomplished and they can verify it.");
      return lines.join("\n");
    }
    lines.push(`Streak: ${streakDays} days ${streakEmoji} (${mult}x multiplier)`);
    lines.push("");
    lines.push("**Categories**");
    for (const cat of input.categories) {
      const bar = renderProgressBar(0, Math.max(cat.budget, 1), 10);
      lines.push(
        `${cat.name}   ${formatUsdFromMicro(0)} / ${formatUsdFromMicro(cat.budget)} ${bar}`,
      );
    }
    lines.push("");
    lines.push(
      "👉 Log your first achievement this week to start filling the bar and light the streak.",
    );
    return lines.join("\n");
  }

  lines.push(
    `Earned this week: ${formatUsdFromMicro(input.totalEarnedMicro)} / ${formatUsdFromMicro(input.weeklyBudgetMicro)} ${weekBar}`,
  );
  lines.push(
    `Streak: ${streakDays} days ${streakEmoji} (${mult}x multiplier)`,
  );

  // Wallet + pending-settlement block (Copy-reference §3 / §5).
  const earnedZero = input.totalEarnedMicro <= 0;
  const hasSettlementRows =
    (walletMicro !== null && walletMicro !== undefined) || pendingSettleMicro > 0;
  if (hasSettlementRows) {
    lines.push("");
    pushWalletRow(earnedZero);
    pushPendingRows();
    // Manager settlement-options block (Copy-reference §5.1, auto off).
    if (managerView && !autoOn && pendingSettleMicro > 0) {
      lines.push("");
      lines.push("**Settlement options:**");
      lines.push("- Run **settle-balance** now to push pending → wallet (~$0.02 gas, one transaction)");
      lines.push("- Enable weekly auto-settle via **configure-policy** to settle every Sunday automatically");
    }
  }

  lines.push("");
  lines.push("**Categories**");
  for (const cat of input.categories) {
    const e = input.byCatEarned[cat.name] ?? 0;
    const bar = renderProgressBar(e, Math.max(cat.budget, 1), 10);
    lines.push(
      `${cat.name}   ${formatUsdFromMicro(e)} / ${formatUsdFromMicro(cat.budget)} ${bar}`,
    );
  }
  lines.push("");
  lines.push("👉 Log something today to keep your streak going.");
  return lines.join("\n");
}

/**
 * Sprint 4.0.3 W10 — whole days until the next Sunday 00:00 UTC, the
 * auto-settle cadence (`AUTO_SETTLE_CRON_EXPRESSION`). Returns 0 when the
 * next boundary is less than 24h away (drives the "tonight" copy variant).
 */
export function daysUntilNextSundayUtc(now: Date = new Date()): number {
  const dow = now.getUTCDay(); // 0 = Sunday
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Days until the upcoming Sunday boundary; if today is Sunday, target next week.
  const delta = dow === 0 ? 7 : 7 - dow;
  next.setUTCDate(next.getUTCDate() + delta);
  const ms = next.getTime() - now.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export async function checkProgressHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null,
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("check-progress");
  const requestedChildArg = args.childName as string | undefined;
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

    const achievements = await state.loadAchievements(familyId);

    const childScope = getChildScope(caller);
    const requestedChild = childScope || requestedChildArg;

    const children = requestedChild
      ? config.children.filter((c) => c.name.toLowerCase() === requestedChild.toLowerCase())
      : config.children;

    if (children.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: false, error: `Child "${requestedChildArg}" not found.` }),
        }],
      };
    }

    type ReportRow = Record<string, unknown>;
    const reports: ReportRow[] = [];
    const progressCardsForSingleScope: string[] = [];

    for (const child of children) {
      const childAchievements = achievements.filter(
        (a) => a.childName.toLowerCase() === child.name.toLowerCase(),
      );

      const weekStart = getWeekStart();
      const thisWeek = childAchievements.filter(
        (a) => new Date(a.verifiedAt) >= weekStart,
      );

      const totalEarned = thisWeek.reduce((sum, a) => sum + a.amount, 0);
      const distributed = thisWeek.filter((a) => a.distributed).reduce((sum, a) => sum + a.amount, 0);
      const pending = thisWeek.filter((a) => !a.distributed).reduce((sum, a) => sum + a.amount, 0);

      const byCat: Record<string, {
        earned: number;
        details: Array<{ description: string; score: number; amount: number; source: string; verifiedBy: string }>;
      }> = {};
      for (const cat of child.categories || []) {
        byCat[cat.name] = { earned: 0, details: [] };
      }
      for (const a of thisWeek) {
        if (!byCat[a.category]) {
          byCat[a.category] = { earned: 0, details: [] };
        }
        byCat[a.category].earned += a.amount;
        byCat[a.category].details.push({
          description: a.description,
          score: a.score,
          amount: a.amount,
          source: (a as Record<string, unknown>).source as string || "manual",
          verifiedBy: a.verifiedBy,
        });
      }

      const byCatEarned: Record<string, number> = {};
      for (const k of Object.keys(byCat)) {
        byCatEarned[k] = byCat[k].earned;
      }

      const streak = await state.loadStreak(familyId, child.name);

      const savings = await state.loadSavingsEntries(familyId, child.name);
      const totalSaved = savings.reduce((sum, s) => sum + s.amount, 0);
      const lockedSavings = savings.filter((s) => !s.released).reduce((sum, s) => sum + s.amount, 0);

      const goals = child.learningGoals ?? [];
      const completedGoals = goals.filter((g) => g.completed).length;
      const nextGoal = goals.find((g) => !g.completed)?.topic ?? null;

      const hasEarned = totalEarned > 0;
      const hasPendingOnly = pending > 0 && !hasEarned;
      const streakDays = streak?.currentStreak ?? 0;
      const streakMultiplier = streak?.multiplier ?? 1.0;
      const daysToNextStreakLevel = streakDays > 0 ? 7 - (streakDays % 7) : 7;
      const nextMultiplier = Math.min(2.0, streakMultiplier + 0.1);

      let summary: string;
      if (!hasEarned && childAchievements.length === 0) {
        summary =
          `Fresh start for ${child.name} this week! No achievements logged yet. ` +
          `Try saying "${child.name} read for 30 minutes today, score 85, reading" ` +
          `to log your first one and start a streak.`;
      } else if (!hasEarned && thisWeek.length === 0 && childAchievements.length > 0) {
        summary =
          `${child.name} hasn't logged anything this week yet. Your overall streak ` +
          `is ${streakDays} day${streakDays === 1 ? "" : "s"} at ${streakMultiplier}x — ` +
          `complete an achievement today to keep it going.`;
      } else if (hasPendingOnly) {
        summary =
          `${child.name} has $${(pending / 10 ** USDC.DECIMALS).toFixed(2)} pending ` +
          `distribution. Ask your parent to run distribute-allowance when ready.`;
      } else {
        const streakNote = streakDays > 0 && streakMultiplier < 2.0
          ? ` ${daysToNextStreakLevel} more day${daysToNextStreakLevel === 1 ? "" : "s"} ` +
            `at this pace and your multiplier goes to ${nextMultiplier}x.`
          : streakMultiplier >= 2.0
            ? ` You're at the max 2x streak multiplier — keep it going!`
            : "";
        summary =
          `${child.name} this week: $${(totalEarned / 10 ** USDC.DECIMALS).toFixed(2)} ` +
          `earned across ${thisWeek.length} achievement${thisWeek.length === 1 ? "" : "s"}. ` +
          `Streak: ${streakDays} day${streakDays === 1 ? "" : "s"} (${streakMultiplier}x).` +
          streakNote;
      }

      const categoriesStructured = Object.fromEntries(
        (child.categories || []).map((cat) => {
          const catData = byCat[cat.name] || { earned: 0, details: [] };
          return [cat.name, {
            earned: `$${(catData.earned / 10 ** USDC.DECIMALS).toFixed(2)}`,
            budget: `$${(cat.budget / 10 ** USDC.DECIMALS).toFixed(2)}`,
            achievements: catData.details.map((d) => ({
              description: d.description,
              score: d.score,
              amountUsd: (d.amount / 10 ** USDC.DECIMALS).toFixed(2),
              source: d.source,
            })),
          }];
        }),
      );

      // Sprint 4.0.3 W10 — settlement-aware enrichment. Only engaged when
      // ledger mode is on so legacy (pre-4.0.3) deployments keep the
      // original card and never incur the per-call balanceOf RPC.
      let pendingLedgerMicro: number | undefined;
      let walletBalanceMicro: number | null | undefined;
      let autoSettleOn: boolean | undefined;
      let nextSundayDays: number | undefined;
      if (isLedgerWriteEnabled()) {
        const ledger = new FilesystemLedger();
        const summary = await ledger.summarizePending(familyId, child.name);
        pendingLedgerMicro = summary.totalMicros;
        autoSettleOn = config.autoSettleWeekly === true;
        nextSundayDays = daysUntilNextSundayUtc();
        const address = resolveChildWalletAddress({
          childName: child.name,
          externalAddress: child.walletAddress,
          owsWalletName: WALLET_NAMES.childWallet(child.name),
          vaultPath: getFamilyVaultPath(familyId),
        });
        // null address (unresolvable wallet) → leave balance undefined so
        // the card omits the wallet row rather than showing a wrong $0.00.
        walletBalanceMicro = address
          ? await fetchUsdcBalanceMicros(address, config.chainId, config.usdcAddress)
          : undefined;
      }

      progressCardsForSingleScope.push(
        buildCheckProgressRichMarkdown({
          childName: child.name,
          weeklyBudgetMicro: child.weeklyBudget,
          totalEarnedMicro: totalEarned,
          pendingMicro: pending,
          categories: child.categories || [],
          byCatEarned,
          streak,
          // Render the full card (not the empty-state) whenever there's
          // anything to settle — ledger pending counts even with no
          // this-week achievement (e.g. carried-over earnings).
          hasEarnedOrPending: hasEarned || pending > 0 || (pendingLedgerMicro ?? 0) > 0,
          walletBalanceMicro,
          pendingLedgerMicro,
          autoSettleOn,
          nextSundayDays,
          role: caller.role,
        }),
      );

      reports.push({
        childName: child.name,
        summary,
        weeklyBudgetMicro: child.weeklyBudget,
        earnedMicro: totalEarned,
        pendingMicro: pending,
        weeklyBudgetUsd: (child.weeklyBudget / 10 ** USDC.DECIMALS).toFixed(2),
        totalEarnedUsd: (totalEarned / 10 ** USDC.DECIMALS).toFixed(2),
        distributedUsd: (distributed / 10 ** USDC.DECIMALS).toFixed(2),
        pendingUsd: (pending / 10 ** USDC.DECIMALS).toFixed(2),
        categories: categoriesStructured,
        achievementsThisWeek: thisWeek.length,
        totalAchievements: childAchievements.length,
        streak: streak
          ? {
              current: streak.currentStreak,
              longest: streak.longestStreak,
              multiplier: streak.multiplier,
            }
          : null,
        savingsTotalUsd: (totalSaved / 10 ** USDC.DECIMALS).toFixed(2),
        savingsLockedUsd: (lockedSavings / 10 ** USDC.DECIMALS).toFixed(2),
        learningGoals: goals,
        completedGoals,
        totalGoals: goals.length,
        nextGoal,
      });
    }

    const payload: Record<string, unknown> = { success: true, reports };

    if (reports.length === 1) {
      const r = reports[0]!;
      payload.summary = progressCardsForSingleScope[0]!;
      payload.earned = r.earnedMicro;
      payload.pending = r.pendingMicro;
      payload.streak = r.streak;
      payload.categories = r.categories;
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(payload),
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

export function registerCheckProgressTool(server: McpServer): void {
  server.tool(
    "check-progress",
    "Check a child's weekly progress, achievements, streaks, and savings balance.",
    {
      childName: z.string().optional().describe("Check a specific child, or all children if omitted"),
      ...rbacFields,
    },
    withAccessControl("check-progress", checkProgressHandler),
  );
}

function getWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}
