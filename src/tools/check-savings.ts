import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import { USDC } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  getChildScope,
  rbacFields,
  type CallerContext,
  type ToolResponse,
} from "../middleware/access-control.js";
import { renderProgressBar, formatUsdFromMicro } from "../utils/card-formatting.js";

/** Sprint 3.6 — rich markdown CARD2 (friendly empty-state, locked vs released). */
export function buildCheckSavingsRichMarkdown(input: {
  childName: string;
  totalUsdcLockedMicro: number;
  totalReleasedMicro: number;
  multiplier: number;
}): string {
  const lines: string[] = [`**${input.childName}'s savings vault**`, ""];
  if (input.totalUsdcLockedMicro === 0 && input.totalReleasedMicro === 0) {
    lines.push(
      `You're just getting started — you haven't tucked away allowance into savings yet, ${input.childName}. ` +
        `Nothing wrong with **$0.00 locked** today: complete an achievement and your streak will grow the vault.`,
    );
    lines.push("");
    lines.push(`Streak multiplier now: **${input.multiplier}x** — it boosts what lands in savings.`);
    lines.push("");
    lines.push(
      `👉 Ask a parent after your next allowance so you can watch **locked vs released** grow here.`,
    );
    return lines.join("\n");
  }

  const lockedStr = formatUsdFromMicro(input.totalUsdcLockedMicro);
  const releasedStr = formatUsdFromMicro(input.totalReleasedMicro);
  const totalSpendable = input.totalUsdcLockedMicro + input.totalReleasedMicro;
  const bar = renderProgressBar(
    input.totalUsdcLockedMicro,
    Math.max(totalSpendable, 1),
    10,
  );
  lines.push(`**Locked:** ${lockedStr}  ${bar}  (${input.multiplier}x streak when deposited)`);
  lines.push("");
  lines.push(`**Released (ready to spend):** ${releasedStr}`);
  lines.push("");
  lines.push(
    "👉 Mature savings show as **released** — ask a parent about **release-savings** when the lock ends.",
  );
  return lines.join("\n");
}

export async function checkSavingsHandler(
  args: Record<string, unknown>,
  caller: CallerContext | null,
): Promise<ToolResponse> {
  if (!caller) return buildNoIdentityResponse("check-savings");
  const requestedChild = args.childName as string | undefined;
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

    const childScope = getChildScope(caller);
    const targetChild = childScope || requestedChild;

    if (!targetChild) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: "childName is required (or connect as a learner for automatic scoping).",
          }),
        }],
      };
    }

    const entries = await state.loadSavingsEntries(familyId, targetChild);
    const streak = await state.loadStreak(familyId, targetChild);

    const active = entries.filter((e) => !e.converted);
    const locked = active.filter((e) => !e.released);
    const released = active.filter((e) => e.released);

    const usdcLocked = locked.filter((e) => (e.asset || "USDC") === "USDC");
    const paxgLocked = locked.filter((e) => e.asset === "PAXG");

    const totalUsdcLocked = usdcLocked.reduce((sum, e) => sum + e.amount, 0);
    const totalReleased = released
      .filter((e) => (e.asset || "USDC") === "USDC")
      .reduce((sum, e) => sum + e.amount, 0);

    const now = new Date();
    const upcoming = usdcLocked
      .filter((e) => new Date(e.lockUntil) > now)
      .sort((a, b) => new Date(a.lockUntil).getTime() - new Date(b.lockUntil).getTime())
      .slice(0, 5)
      .map((e) => ({
        amountUsd: (e.amount / 10 ** USDC.DECIMALS).toFixed(2),
        depositedAt: e.depositedAt,
        releasesAt: e.lockUntil,
        daysRemaining: Math.ceil(
          (new Date(e.lockUntil).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        ),
        multiplierAtDeposit: e.multiplierAtDeposit,
      }));

    const readyToRelease = usdcLocked.filter((e) => new Date(e.lockUntil) <= now);

    const paxgPosition = paxgLocked.length > 0
      ? {
          totalAmount: `${paxgLocked.reduce((sum, e) => sum + parseFloat(e.receivedAmount || "0"), 0).toFixed(6)} oz`,
          valueAtConversion: `$${paxgLocked.reduce((sum, e) => sum + parseFloat(e.receivedAmount || "0") * (e.priceAtConversion || 0), 0).toFixed(2)}`,
          entries: paxgLocked.length,
          note: "Gold doesn't earn the savings multiplier — it earns price appreciation.",
        }
      : undefined;

    const positions: Record<string, unknown> = {
      USDC: {
        totalLocked: `$${(totalUsdcLocked / 10 ** USDC.DECIMALS).toFixed(2)}`,
        entries: usdcLocked.length,
        readyToRelease: readyToRelease.length,
        upcomingReleases: upcoming,
      },
    };
    if (paxgPosition) {
      positions.PAXG = paxgPosition;
    }

    const hasAnyActivity = locked.length > 0 || released.length > 0;
    const hasReady = readyToRelease.length > 0;
    const nextReleaseDays = upcoming.length > 0 ? upcoming[0].daysRemaining : null;

    let message: string;
    if (!hasAnyActivity) {
      message =
        `You haven't saved anything yet, ${targetChild}! As you earn allowance, ` +
        `a portion gets set aside in your savings vault and grows with your streak. ` +
        `Complete an achievement to start building it up.`;
    } else if (hasReady) {
      const entriesWord = readyToRelease.length === 1 ? "entry is" : "entries are";
      message =
        `Good news, ${targetChild} — ${readyToRelease.length} savings ${entriesWord} ` +
        `ready to release! Ask your parent to run release-savings to send the matured ` +
        `funds to your wallet.`;
    } else if (nextReleaseDays !== null) {
      const dayWord = nextReleaseDays === 1 ? "day" : "days";
      message =
        `${targetChild}, you have $${(totalUsdcLocked / 10 ** USDC.DECIMALS).toFixed(2)} ` +
        `locked in savings. Your next release unlocks in ${nextReleaseDays} ${dayWord}. ` +
        `Keep your streak going to grow the multiplier before then.`;
    } else {
      message =
        `${targetChild}, you have $${(totalUsdcLocked / 10 ** USDC.DECIMALS).toFixed(2)} ` +
        `locked in savings. Nothing's scheduled to unlock yet — keep earning to start ` +
        `the 90-day lock clock.`;
    }

    const mult = streak?.multiplier ?? 1.0;
    const summary = buildCheckSavingsRichMarkdown({
      childName: targetChild,
      totalUsdcLockedMicro: totalUsdcLocked,
      totalReleasedMicro: totalReleased,
      multiplier: mult,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          childName: targetChild,
          summary,
          positions,
          lockedAmount: totalUsdcLocked,
          releasedAmount: totalReleased,
          totalLockedUsd: (totalUsdcLocked / 10 ** USDC.DECIMALS).toFixed(2),
          totalReleasedUsd: (totalReleased / 10 ** USDC.DECIMALS).toFixed(2),
          lockedEntries: locked.length,
          readyToRelease: readyToRelease.length,
          currentMultiplier: mult,
          message,
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

export function registerCheckSavingsTool(server: McpServer): void {
  server.tool(
    "check-savings",
    "Check savings vault details: locked amounts, release dates, and multiplier projections.",
    {
      childName: z.string().optional().describe("Name of the child (learners see only their own data)"),
      ...rbacFields,
    },
    withAccessControl("check-savings", checkSavingsHandler),
  );
}
