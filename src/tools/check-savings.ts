import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StateManager } from "../engine/state.js";
import { USDC } from "../constants.js";
import { resolveCallerRole, isToolAuthorized, buildAccessDeniedResponse, rbacFields } from "../middleware/access-control.js";

export function registerCheckSavingsTool(server: McpServer): void {
  server.tool(
    "check-savings",
    "Check savings vault details: locked amounts, release dates, and multiplier projections.",
    {
      childName: z.string().describe("Name of the child"),
      ...rbacFields,
    },
    async (args) => {
      const caller = await resolveCallerRole(args as Record<string, unknown>);
      if (!isToolAuthorized("check-savings", caller.role)) {
        return buildAccessDeniedResponse("check-savings", caller.role);
      }
      try {
        const state = new StateManager();
        const config = await state.loadFamilyConfig();

        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No family configured." }),
            }],
          };
        }

        const entries = await state.loadSavingsEntries(args.childName);
        const streak = await state.loadStreak(args.childName);

        const locked = entries.filter((e) => !e.released);
        const released = entries.filter((e) => e.released);

        const totalLocked = locked.reduce((sum, e) => sum + e.amount, 0);
        const totalReleased = released.reduce((sum, e) => sum + e.amount, 0);

        // Calculate upcoming releases
        const now = new Date();
        const upcoming = locked
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

        // Ready to release
        const readyToRelease = locked.filter((e) => new Date(e.lockUntil) <= now);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              childName: args.childName,
              totalLockedUsd: (totalLocked / 10 ** USDC.DECIMALS).toFixed(2),
              totalReleasedUsd: (totalReleased / 10 ** USDC.DECIMALS).toFixed(2),
              lockedEntries: locked.length,
              readyToRelease: readyToRelease.length,
              currentMultiplier: streak?.multiplier ?? 1.0,
              upcomingReleases: upcoming,
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
    }
  );
}
