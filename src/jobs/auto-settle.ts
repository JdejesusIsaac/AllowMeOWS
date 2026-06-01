/**
 * Sprint 4.0.3 W7 — weekly auto-settle job.
 *
 * Schedules a Sunday 00:00 UTC run of `settle-balance` for every
 * family that has opted in via `FamilyConfig.autoSettleWeekly = true`.
 *
 * Schedule: cron expression `0 0 * * 0` (Sunday 00:00 UTC). Deployed
 * via Railway scheduled tasks rather than an in-process node-cron
 * because the latter ties the schedule to process lifecycle — a
 * restart between Sunday 00:00 and Sunday 00:01 would miss the run.
 * Railway scheduled tasks invoke this script as a separate process,
 * so the cron behavior is independent of the long-running MCP server.
 *
 * Kill switch (W7 + plan §4): `ALLOWME_AUTO_SETTLE_DISABLED=true`
 * makes this job a no-op without a deploy. Useful when a misconfigured
 * allowlist is discovered mid-week and operators want to pause
 * settlements until configure-policy lands.
 *
 * Per-family isolation (LS54): a thrown error in family F doesn't
 * abort the loop. We catch, log, optionally Sentry-tag with the
 * family, and continue to the next family.
 *
 * RBAC: auto-settle invokes `settleBalanceCore` with a synthesized
 * manager-equivalent CallerContext (caller.role = "manager",
 * memberId = "system:auto-settle"). The audit trail records this
 * actor so post-hoc analysis can distinguish auto-settle activity
 * from interactive parent-driven settlements.
 */

import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, ROLES } from "../constants.js";
import { StateManager } from "../engine/state.js";
import { isAutoSettleDisabled } from "../engine/ledger.js";
import { settleBalanceCore } from "../tools/settle-balance.js";
import type { CallerContext } from "../middleware/access-control.js";
import { initSentry } from "../observability/sentry.js";

/**
 * Cron expression for the Sunday 00:00 UTC schedule. Exported so
 * LS53 (scheduler-config sanity check) can assert the literal value.
 */
export const AUTO_SETTLE_CRON_EXPRESSION = "0 0 * * 0";

export interface AutoSettleFamilyResult {
  familyId: string;
  status:
    | "opted-in-settled"
    | "opted-in-partial"
    | "opted-in-failed"
    | "opted-in-blocked"
    | "opted-out"
    | "no-pending"
    | "error";
  settled?: number;
  failed?: number;
  preflightBlocked?: number;
  error?: string;
}

export interface AutoSettleRunSummary {
  ran: boolean;          // false when ALLOWME_AUTO_SETTLE_DISABLED=true
  familiesProcessed: number;
  familiesSkippedOptOut: number;
  familiesSettled: number;
  familiesFailed: number;
  perFamily: AutoSettleFamilyResult[];
  ranAtIso: string;
}

interface AutoSettleOptions {
  /** Override the data root (tests). */
  rootDir?: string;
}

function resolveDataDir(rootDir?: string): string {
  if (rootDir) return rootDir;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, "..", "..", DATA_DIR);
}

async function listFamilyIds(rootDir: string): Promise<string[]> {
  const familiesRoot = join(rootDir, "families");
  if (!existsSync(familiesRoot)) return [];
  const entries = await readdir(familiesRoot);
  const out: string[] = [];
  for (const entry of entries) {
    try {
      const s = await stat(join(familiesRoot, entry));
      if (s.isDirectory()) out.push(entry);
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * Entry point. Returns a structured summary the operator dashboard
 * (and tests) can consume. Always resolves — never throws — even on
 * fatal init failures (returns `ran: false` + populated `perFamily`
 * with `status: "error"`).
 */
export async function runAutoSettle(
  options: AutoSettleOptions = {},
): Promise<AutoSettleRunSummary> {
  const startIso = new Date().toISOString();

  if (isAutoSettleDisabled()) {
    console.error(
      "[auto-settle] ALLOWME_AUTO_SETTLE_DISABLED=true — skipping run",
    );
    return {
      ran: false,
      familiesProcessed: 0,
      familiesSkippedOptOut: 0,
      familiesSettled: 0,
      familiesFailed: 0,
      perFamily: [],
      ranAtIso: startIso,
    };
  }

  const rootDir = resolveDataDir(options.rootDir);
  const familyIds = await listFamilyIds(rootDir);
  const state = new StateManager();

  // Lazy Sentry init so per-family errors aggregate to the operator
  // dashboard without breaking the job. Init returns null in environments
  // without SENTRY_DSN (local dev / CI).
  const sentry = await initSentry().catch(() => null);

  const perFamily: AutoSettleFamilyResult[] = [];
  let familiesSettled = 0;
  let familiesFailed = 0;
  let familiesSkippedOptOut = 0;

  for (const familyId of familyIds) {
    try {
      const config = await state.loadFamilyConfig(familyId);
      if (!config) {
        perFamily.push({ familyId, status: "error", error: "family-config not found" });
        familiesFailed++;
        continue;
      }
      if (config.autoSettleWeekly !== true) {
        perFamily.push({ familyId, status: "opted-out" });
        familiesSkippedOptOut++;
        continue;
      }

      // Synthesized manager-equivalent caller. Audit trail records
      // `actor: "system:auto-settle"` so post-hoc dashboards can split
      // interactive vs scheduled settlement.
      const caller: CallerContext = {
        role: ROLES.MANAGER,
        memberId: "system:auto-settle",
        familyId,
      };

      const response = await settleBalanceCore({}, caller);
      const payload = JSON.parse(response.content[0].text) as {
        success?: boolean;
        settled?: number;
        failed?: number;
        preflightBlocked?: number;
        error?: string;
      };

      const settled = payload.settled ?? 0;
      const failed = payload.failed ?? 0;
      const blocked = payload.preflightBlocked ?? 0;

      if (payload.success && settled > 0) {
        perFamily.push({
          familyId,
          status: "opted-in-settled",
          settled,
          failed,
          preflightBlocked: blocked,
        });
        familiesSettled++;
      } else if (settled === 0 && failed === 0 && blocked === 0) {
        perFamily.push({
          familyId,
          status: "no-pending",
        });
      } else if (settled > 0 && (failed > 0 || blocked > 0)) {
        perFamily.push({
          familyId,
          status: "opted-in-partial",
          settled,
          failed,
          preflightBlocked: blocked,
        });
        familiesSettled++;
      } else if (blocked > 0 && settled === 0) {
        perFamily.push({
          familyId,
          status: "opted-in-blocked",
          settled: 0,
          failed,
          preflightBlocked: blocked,
        });
      } else {
        perFamily.push({
          familyId,
          status: "opted-in-failed",
          settled,
          failed,
          preflightBlocked: blocked,
          error: payload.error,
        });
        familiesFailed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[auto-settle] family=${familyId} threw — continuing with next family`,
        err,
      );
      try {
        sentry?.captureException?.(
          new Error(`auto-settle failure for family=${familyId}: ${message}`),
        );
      } catch {
        /* ignore Sentry failures */
      }
      perFamily.push({ familyId, status: "error", error: message });
      familiesFailed++;
    }
  }

  return {
    ran: true,
    familiesProcessed: familyIds.length,
    familiesSkippedOptOut,
    familiesSettled,
    familiesFailed,
    perFamily,
    ranAtIso: startIso,
  };
}

// === CLI entry point ===

const isMainModule = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  runAutoSettle()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (summary.familiesFailed > 0) {
        process.exit(2); // soft-fail exit code: operator review needed
      }
    })
    .catch((err) => {
      console.error("[auto-settle] FATAL", err);
      process.exit(1);
    });
}
