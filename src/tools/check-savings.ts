import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import { USDC } from "../constants.js";
import {
  withAccessControl,
  buildNoIdentityResponse,
  getChildScope,
  rbacFields,
} from "../middleware/access-control.js";

export function registerCheckSavingsTool(server: McpServer): void {
  server.tool(
    "check-savings",
    "Check savings vault details: locked amounts, release dates, and multiplier projections.",
    {
      childName: z.string().optional().describe("Name of the child (learners see only their own data)"),
      ...rbacFields,
    },
    withAccessControl("check-savings", async (args, caller) => {
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

        // Child-scoped filtering: learner sees only their own data
        const childScope = getChildScope(caller);
        const targetChild = childScope || requestedChild;

        if (!targetChild) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "childName is required (or connect as a learner for automatic scoping)." }),
            }],
          };
        }

        const entries = await state.loadSavingsEntries(familyId, targetChild);
        const streak = await state.loadStreak(familyId, targetChild);

        // Filter out converted entries (they've been consumed by a conversion)
        const active = entries.filter((e) => !e.converted);
        const locked = active.filter((e) => !e.released);
        const released = active.filter((e) => e.released);

        // Split by asset
        const usdcLocked = locked.filter((e) => (e.asset || "USDC") === "USDC");
        const paxgLocked = locked.filter((e) => e.asset === "PAXG");

        const totalUsdcLocked = usdcLocked.reduce((sum, e) => sum + e.amount, 0);
        const totalReleased = released
          .filter((e) => (e.asset || "USDC") === "USDC")
          .reduce((sum, e) => sum + e.amount, 0);

        // Calculate upcoming USDC releases
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
              (new Date(e.lockUntil).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
            ),
            multiplierAtDeposit: e.multiplierAtDeposit,
          }));

        // Ready to release (USDC only — PAXG requires orchestration)
        const readyToRelease = usdcLocked.filter((e) => new Date(e.lockUntil) <= now);

        // Build PAXG position
        const paxgPosition = paxgLocked.length > 0
          ? {
              totalAmount: `${paxgLocked.reduce((sum, e) => sum + parseFloat(e.receivedAmount || "0"), 0).toFixed(6)} oz`,
              valueAtConversion: `$${paxgLocked.reduce((sum, e) => sum + parseFloat(e.receivedAmount || "0") * (e.priceAtConversion || 0), 0).toFixed(2)}`,
              entries: paxgLocked.length,
              note: "Gold doesn't earn the savings multiplier — it earns price appreciation.",
            }
          : undefined;

        // Build response with multi-asset positions
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

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              childName: targetChild,
              positions,
              totalLockedUsd: (totalUsdcLocked / 10 ** USDC.DECIMALS).toFixed(2),
              totalReleasedUsd: (totalReleased / 10 ** USDC.DECIMALS).toFixed(2),
              lockedEntries: locked.length,
              readyToRelease: readyToRelease.length,
              currentMultiplier: streak?.multiplier ?? 1.0,
              message:
                readyToRelease.length > 0
                  ? `${readyToRelease.length} savings entries are ready to release!`
                  : `${locked.length} entries locked. Next release: ${upcoming.length > 0 ? `${upcoming[0].daysRemaining} days` : "none scheduled"}.`,
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
